"""v1.8 (FASE 1) - mesclagem de dois cadastros de `Pessoa` que a fila de revisão aponta como
duplicados. Operação IRREVERSÍVEL (a pessoa absorvida é apagada ao final) - por isso exige
`nome_confirmacao` batendo exatamente com o nome de quem vai ser absorvida (mesmo princípio de
"digite o nome pra confirmar" usado em operações destrutivas de qualquer sistema sério), nunca
roda sozinha (sempre a partir de uma entrada da fila, decidida por uma pessoa) e preserva o
histórico dos dois lados - nada é apagado, tudo que pertencia à pessoa absorvida passa a
pertencer à pessoa mantida.

**Dois cadastros de associado da mesma pessoa** (v9.5, decisão do Presidente de 13/11/2026): fica a matrícula MAIS ANTIGA (pela data de entrada;
empate, o número menor) - a pessoa mantida tem de ser a dona dela, senão a junção é recusada dizendo qual fica. Tudo do cadastro de associado
juntado passa para o que fica (mensalidades e pagamentos, histórico, cargos, votos, inscrições...) e ele é apagado: o número dele fica LIVRE e vai
para o próximo associado novo (`app/services/matricula.py`). Se as duas pessoas já tinham acesso ao painel, o acesso da juntada é desligado (uma
pessoa, um acesso). Registro que não dá para juntar sozinho (o mesmo voto ou credenciamento nos dois cadastros) desfaz tudo e explica.

**Escolhas campo a campo** (v9.5): para cada dado que difere, quem decide é a pessoa na tela (`escolhas`: "mantida" ou "absorvida"); sem escolha,
fica o da mantida e só o que ela não tem vem da absorvida. A situação (em dia, inadimplente...) não se escolhe: é recalculada depois, com as
mensalidades das duas juntas.

**Limite de segurança deliberado**: se as duas pessoas já são `Funcionario` ao mesmo tempo, a mesclagem é RECUSADA - qual vínculo empregatício
prevalece é decisão que este serviço não tenta adivinhar."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.associados import Associado, DependenteFamiliar, Endereco
from app.models.core import Usuario
from app.models.linha_do_tempo import EventoLinhaDoTempo
from app.models.pessoas import Papel, Pessoa
from app.models.voluntariado import Funcionario, TermoAdesaoVoluntario

_CAMPOS_PESSOAIS = [
    "cpf", "data_nascimento", "email_contato", "telefone_whatsapp",
    "estado_civil", "profissao", "naturalidade", "foto",
]


# Referências a `pessoas` que a mesclagem trata UMA A UMA (regra própria de cada uma). Todas as outras são só "passa a apontar para a pessoa
# mantida" (ver `_repontar_demais_referencias`).
_TRATADAS_UMA_A_UMA = {
    ("associados", "id_pessoa"), ("papeis", "id_pessoa"), ("funcionarios", "id_pessoa"), ("termos_adesao_voluntario", "id_pessoa"),
    ("eventos_linha_do_tempo", "id_pessoa"), ("dependentes_familiares", "id_pessoa_titular"), ("dependentes_familiares", "id_pessoa_vinculada"),
}


def _repontar_demais_referencias(db: Session, id_pessoa_mantida: int, id_pessoa_absorvida: int, contagens: dict) -> None:
    """v5.4c (achado AO VIVO na homologação, 2026-10-06): a mesclagem apagava a pessoa absorvida enquanto OUTRAS tabelas ainda apontavam para
    ela — a fila de revisão (de onde a mesclagem sempre parte), inscrições, presenças, beneficiários, documentos emitidos e isenções. No
    Postgres isso é violação de chave estrangeira (erro 500); nos testes em SQLite, que não confere chave estrangeira, passava. Aqui TODA
    referência a `pessoas` que não tem regra própria passa a apontar para a pessoa mantida (descobertas pelo próprio modelo, então tabela
    nova não escapa)."""
    from app.database import Base

    for tabela in Base.metadata.sorted_tables:
        for fk in tabela.foreign_keys:
            if fk.column.table.name != "pessoas" or (tabela.name, fk.parent.name) in _TRATADAS_UMA_A_UMA:
                continue
            resultado = db.execute(tabela.update().where(fk.parent == id_pessoa_absorvida).values({fk.parent.name: id_pessoa_mantida}))
            if resultado.rowcount:
                contagens[tabela.name] = contagens.get(tabela.name, 0) + resultado.rowcount


# o que a pessoa pode escolher na tela: os dados da pessoa, a categoria e o endereço do cadastro de associado
CAMPOS_ESCOLHIVEIS = ["nome_completo", *_CAMPOS_PESSOAIS, "categoria", "endereco"]
_CAMPOS_UNICOS = {"cpf"}  # dois cadastros não podem ter o mesmo ao mesmo tempo: a absorvida solta o dela antes


def mais_antigo(associado: Associado) -> tuple:
    """A ordem de "quem é mais antigo": data de entrada, depois o número de matrícula (nunca muda o resultado de quem já tinha data)."""
    return (
        associado.data_admissao or datetime.max,
        associado.numero_matricula if associado.numero_matricula is not None else 10**9,
        associado.id_associado,
    )


def _repontar_referencias_do_associado(db: Session, id_mantido: int, id_absorvido: int, contagens: dict) -> None:
    """Tudo que aponta para o cadastro de associado juntado passa a apontar para o que fica (descoberto pelo próprio modelo: tabela nova não
    escapa). O endereço tem regra própria (um só fica)."""
    from app.database import Base

    for tabela in Base.metadata.sorted_tables:
        if tabela.name == "enderecos":
            continue
        for fk in tabela.foreign_keys:
            if fk.column.table.name != "associados":
                continue
            resultado = db.execute(tabela.update().where(fk.parent == id_absorvido).values({fk.parent.name: id_mantido}))
            if resultado.rowcount:
                chave = f"associado_{tabela.name}"
                contagens[chave] = contagens.get(chave, 0) + resultado.rowcount


def _juntar_associados(db: Session, mantido: Associado, absorvido: Associado, escolhas: dict, contagens: dict) -> None:
    # endereço: fica um só - o escolhido, ou o da mantida (se ela não tiver, o da absorvida)
    enderecos_mantido = db.query(Endereco).filter(Endereco.id_associado == mantido.id_associado).all()
    enderecos_absorvido = db.query(Endereco).filter(Endereco.id_associado == absorvido.id_associado).all()
    usar_o_da_absorvida = enderecos_absorvido and (escolhas.get("endereco") == "absorvida" or not enderecos_mantido)
    for endereco in enderecos_mantido if usar_o_da_absorvida else enderecos_absorvido:
        db.delete(endereco)
    if usar_o_da_absorvida:
        for endereco in enderecos_absorvido:
            endereco.id_associado = mantido.id_associado
    db.flush()

    if escolhas.get("categoria") == "absorvida" and absorvido.categoria:
        mantido.categoria = absorvido.categoria
    if not mantido.observacoes_gerenciais and absorvido.observacoes_gerenciais:
        mantido.observacoes_gerenciais = absorvido.observacoes_gerenciais

    # acesso ao painel: uma pessoa, um acesso
    if absorvido.id_usuario and not mantido.id_usuario:
        mantido.id_usuario = absorvido.id_usuario
        contagens["acesso_ao_painel_passou"] = 1
    elif absorvido.id_usuario and absorvido.id_usuario != mantido.id_usuario:
        usuario = db.query(Usuario).filter(Usuario.id_usuario == absorvido.id_usuario).first()
        if usuario is not None:
            usuario.ativo = False
            contagens["acesso_ao_painel_desligado"] = 1
    absorvido.id_usuario = None
    db.flush()

    _repontar_referencias_do_associado(db, mantido.id_associado, absorvido.id_associado, contagens)
    db.delete(absorvido)
    db.flush()
    contagens["associado"] = 1


def _buscar_pessoa_ou_404(db: Session, id_pessoa: int) -> Pessoa:
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    return pessoa


def mesclar_pessoas(
    db: Session, id_pessoa_mantida: int, id_pessoa_absorvida: int,
    nome_confirmacao: str, usuario=None, escolhas: Optional[dict] = None,
) -> dict:
    if id_pessoa_mantida == id_pessoa_absorvida:
        raise HTTPException(status_code=400, detail="Não é possível mesclar uma pessoa consigo mesma.")

    mantida = _buscar_pessoa_ou_404(db, id_pessoa_mantida)
    absorvida = _buscar_pessoa_ou_404(db, id_pessoa_absorvida)

    if nome_confirmacao.strip().lower() != (absorvida.nome_completo or "").strip().lower():
        raise HTTPException(
            status_code=400,
            detail="Nome de confirmação não confere com o nome da pessoa que será absorvida - "
                   "mesclagem é irreversível, confirme o nome exato antes de prosseguir.",
        )

    escolhas = dict(escolhas or {})
    desconhecidos = sorted(set(escolhas) - set(CAMPOS_ESCOLHIVEIS))
    if desconhecidos:
        raise HTTPException(status_code=400, detail=f"Campo que não se escolhe na junção: {', '.join(desconhecidos)}.")

    associado_mantida = db.query(Associado).filter(Associado.id_pessoa == id_pessoa_mantida).first()
    associado_absorvida = db.query(Associado).filter(Associado.id_pessoa == id_pessoa_absorvida).first()
    if associado_mantida and associado_absorvida and mais_antigo(associado_absorvida) < mais_antigo(associado_mantida):
        desde = associado_absorvida.data_admissao.strftime("%d/%m/%Y") if associado_absorvida.data_admissao else "a data mais antiga"
        raise HTTPException(
            status_code=409,
            detail=f"Fica a matrícula mais antiga: a nº {associado_absorvida.numero_matricula} (desde {desde}). "
                   "Escolha esse cadastro como o que fica e junte o outro a ele.",
        )
    matricula_mantida = associado_mantida.numero_matricula if associado_mantida else None
    matricula_liberada = associado_absorvida.numero_matricula if (associado_mantida and associado_absorvida) else None

    funcionario_mantida = db.query(Funcionario).filter(Funcionario.id_pessoa == id_pessoa_mantida).first()
    funcionario_absorvida = db.query(Funcionario).filter(Funcionario.id_pessoa == id_pessoa_absorvida).first()
    if funcionario_mantida and funcionario_absorvida:
        raise HTTPException(
            status_code=409,
            detail="As duas pessoas já são Funcionário - resolva manualmente qual vínculo "
                   "empregatício deve prevalecer antes de mesclar.",
        )

    contagens = {"papeis": 0, "associado": 0, "funcionario": 0, "termos_voluntariado": 0, "eventos_linha_do_tempo": 0, "dependentes": 0}

    tipos_papel_mantida = {
        p.tipo_papel for p in db.query(Papel).filter(Papel.id_pessoa == id_pessoa_mantida).all()
    }
    for papel in db.query(Papel).filter(Papel.id_pessoa == id_pessoa_absorvida).all():
        if papel.tipo_papel in tipos_papel_mantida:
            db.delete(papel)  # mantida já tem o mesmo papel - descarta a duplicata
        else:
            papel.id_pessoa = id_pessoa_mantida
            contagens["papeis"] += 1

    if associado_absorvida and not associado_mantida:
        associado_absorvida.id_pessoa = id_pessoa_mantida
        contagens["associado"] = 1
    elif associado_absorvida and associado_mantida:
        try:
            _juntar_associados(db, associado_mantida, associado_absorvida, escolhas, contagens)
        except IntegrityError as erro:
            # o mesmo voto, credenciamento ou voto de sócio nos dois cadastros: nada foi gravado (o commit é só no fim)
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="Os dois cadastros de associado têm registros que não dá para juntar sozinho (por exemplo, o mesmo voto ou o mesmo "
                       "credenciamento de assembleia nos dois). Resolva esse registro antes de juntar; nada foi alterado.",
            ) from erro

    if funcionario_absorvida and not funcionario_mantida:
        funcionario_absorvida.id_pessoa = id_pessoa_mantida
        contagens["funcionario"] = 1

    termo_ativo_mantida = (
        db.query(TermoAdesaoVoluntario)
        .filter(TermoAdesaoVoluntario.id_pessoa == id_pessoa_mantida, TermoAdesaoVoluntario.ativo == True)
        .first()
    )
    for termo in db.query(TermoAdesaoVoluntario).filter(TermoAdesaoVoluntario.id_pessoa == id_pessoa_absorvida).all():
        if termo_ativo_mantida and termo.ativo:
            # Nunca dois termos ativos ao mesmo tempo para a mesma pessoa (mesma regra da
            # v1.6) - o da absorvida vira histórico inativo, preservado, não apagado.
            termo.ativo = False
        termo.id_pessoa = id_pessoa_mantida
        contagens["termos_voluntariado"] += 1

    contagens["eventos_linha_do_tempo"] = (
        db.query(EventoLinhaDoTempo)
        .filter(EventoLinhaDoTempo.id_pessoa == id_pessoa_absorvida)
        .update({"id_pessoa": id_pessoa_mantida}, synchronize_session=False)
    )

    for dep in db.query(DependenteFamiliar).filter(
        or_(DependenteFamiliar.id_pessoa_titular == id_pessoa_absorvida, DependenteFamiliar.id_pessoa_vinculada == id_pessoa_absorvida)
    ).all():
        novo_titular = id_pessoa_mantida if dep.id_pessoa_titular == id_pessoa_absorvida else dep.id_pessoa_titular
        novo_vinculada = id_pessoa_mantida if dep.id_pessoa_vinculada == id_pessoa_absorvida else dep.id_pessoa_vinculada
        if novo_titular == novo_vinculada:
            db.delete(dep)  # virou vínculo de alguém consigo mesmo depois da mesclagem - descarta
            continue
        duplicata = db.query(DependenteFamiliar).filter(
            DependenteFamiliar.id_pessoa_titular == novo_titular,
            DependenteFamiliar.id_pessoa_vinculada == novo_vinculada,
            DependenteFamiliar.id_dependente != dep.id_dependente,
        ).first()
        if duplicata:
            db.delete(dep)
            continue
        dep.id_pessoa_titular = novo_titular
        dep.id_pessoa_vinculada = novo_vinculada
        contagens["dependentes"] += 1

    # Os dados da pessoa: o que a tela escolheu; sem escolha, fica o da mantida e só o que ela não tem vem da absorvida (nunca sobrescreve
    # um valor que a mantida já tem sem alguém ter escolhido). Escolher "absorvida" num campo vazio dela não apaga o da mantida.
    trazidos = []
    for campo in ["nome_completo", *_CAMPOS_PESSOAIS]:
        valor = getattr(absorvida, campo)
        if valor is None or valor == "":
            continue
        escolha = escolhas.get(campo)
        if escolha == "absorvida" or (escolha is None and campo != "nome_completo" and getattr(mantida, campo) is None):
            if campo in _CAMPOS_UNICOS:
                setattr(absorvida, campo, None)
                db.flush()
            setattr(mantida, campo, valor)
            trazidos.append(campo)

    try:
        _repontar_demais_referencias(db, id_pessoa_mantida, id_pessoa_absorvida, contagens)
        db.delete(absorvida)
        db.commit()
    except IntegrityError as erro:
        # nada foi gravado até aqui (o commit é só neste ponto): desfaz tudo e explica, em vez de devolver erro 500
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="As duas pessoas têm registros que não dá para juntar sozinho (por exemplo, a mesma inscrição, presença ou ficha de "
                   "beneficiário nas duas). Resolva esse registro manualmente antes de mesclar; nada foi alterado.",
        ) from erro

    registrar_auditoria(
        db, usuario, "pessoas", "MESCLADO", id_registro_afetado=id_pessoa_mantida,
        # v7.0b: sem o nome (a pessoa pode ser criança; a Auditoria não tem prazo de guarda): o número basta para saber quem foi absorvido.
        # v9.5: as matrículas (a que fica e a que ficou livre) e QUAIS campos vieram da absorvida - os nomes dos campos, nunca os valores
        dados_depois={
            "id_pessoa_absorvida": id_pessoa_absorvida, "contagens": contagens,
            "matricula_mantida": matricula_mantida, "matricula_liberada": matricula_liberada, "campos_da_absorvida": trazidos,
        },
    )
    if associado_mantida and associado_absorvida:
        # a situação não se escolhe: com as mensalidades das duas juntas, é calculada de novo (só nos estados que o sistema calcula)
        from app.services.categoria_associado import recalcular_categoria_associado

        recalcular_categoria_associado(db, associado_mantida.id_associado, usuario=usuario)
    return {"id_pessoa_mantida": id_pessoa_mantida, "contagens": contagens, "matricula_mantida": matricula_mantida, "matricula_liberada": matricula_liberada}
