"""v1.8 (FASE 1) - mesclagem de dois cadastros de `Pessoa` que a fila de revisão aponta como
duplicados. Operação IRREVERSÍVEL (a pessoa absorvida é apagada ao final) - por isso exige
`nome_confirmacao` batendo exatamente com o nome de quem vai ser absorvida (mesmo princípio de
"digite o nome pra confirmar" usado em operações destrutivas de qualquer sistema sério), nunca
roda sozinha (sempre a partir de uma entrada da fila, decidida por uma pessoa) e preserva o
histórico dos dois lados - nada é apagado, tudo que pertencia à pessoa absorvida passa a
pertencer à pessoa mantida.

**Limite de segurança deliberado**: se as duas pessoas já são `Associado` (ou já são
`Funcionario`) ao mesmo tempo, a mesclagem automática é RECUSADA - decidir qual matrícula/
vínculo empregatício prevalece é uma decisão de negócio que este serviço não tenta adivinhar;
a secretaria resolve manualmente qual dos dois cadastros de associado/funcionário fica antes de
mesclar as `Pessoa`s."""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.associados import Associado, DependenteFamiliar
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


def _buscar_pessoa_ou_404(db: Session, id_pessoa: int) -> Pessoa:
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    return pessoa


def mesclar_pessoas(
    db: Session, id_pessoa_mantida: int, id_pessoa_absorvida: int,
    nome_confirmacao: str, usuario=None,
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

    associado_mantida = db.query(Associado).filter(Associado.id_pessoa == id_pessoa_mantida).first()
    associado_absorvida = db.query(Associado).filter(Associado.id_pessoa == id_pessoa_absorvida).first()
    if associado_mantida and associado_absorvida:
        raise HTTPException(
            status_code=409,
            detail="As duas pessoas já são Associado - resolva manualmente qual cadastro de "
                   "associado deve prevalecer antes de mesclar.",
        )

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

    # Preenche só os campos pessoais que a mantida ainda não tinha - nunca sobrescreve um valor
    # já existente (a mantida é quem "ganha", em caso de divergência real).
    for campo in _CAMPOS_PESSOAIS:
        if getattr(mantida, campo) is None and getattr(absorvida, campo) is not None:
            setattr(mantida, campo, getattr(absorvida, campo))

    nome_absorvida = absorvida.nome_completo
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
        dados_depois={"id_pessoa_absorvida": id_pessoa_absorvida, "nome_absorvida": nome_absorvida, "contagens": contagens},
    )
    return {"id_pessoa_mantida": id_pessoa_mantida, "contagens": contagens}
