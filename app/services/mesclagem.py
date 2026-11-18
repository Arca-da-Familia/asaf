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
import hashlib
import hmac
import json
from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
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
    ("preferencias_de_comunicacao", "id_pessoa"),
}


def _repontar_demais_referencias(db: Session, id_pessoa_mantida: int, id_pessoa_absorvida: int, contagens: dict) -> None:
    """v5.4c (achado AO VIVO na homologação, 2026-10-06): a mesclagem apagava a pessoa absorvida enquanto OUTRAS tabelas ainda apontavam para
    ela — a fila de revisão (de onde a mesclagem sempre parte), inscrições, presenças, beneficiários, documentos emitidos e isenções. No
    Postgres isso é violação de chave estrangeira (erro 500); nos testes em SQLite, que não confere chave estrangeira, passava. Aqui TODA
    referência a `pessoas` que não tem regra própria passa a apontar para a pessoa mantida (descobertas pelo próprio modelo, então tabela
    nova não escapa)."""
    from app.database import Base

    for tabela in Base.metadata.tables.values():
        for fk in tabela.foreign_keys:
            if fk.column.table.name != "pessoas" or (tabela.name, fk.parent.name) in _TRATADAS_UMA_A_UMA:
                continue
            resultado = db.execute(tabela.update().where(fk.parent == id_pessoa_absorvida).values({fk.parent.name: id_pessoa_mantida}))
            if resultado.rowcount:
                contagens[tabela.name] = contagens.get(tabela.name, 0) + resultado.rowcount


# o que a pessoa pode escolher na tela: os dados da pessoa, a categoria e o endereço do cadastro de associado
CAMPOS_ESCOLHIVEIS = ["nome_completo", *_CAMPOS_PESSOAIS, "categoria", "endereco"]
_CAMPOS_UNICOS = {"cpf"}  # dois cadastros não podem ter o mesmo ao mesmo tempo: a absorvida solta o dela antes
DESLIGADO = "Desligado"
SUSPENSO = "Suspenso (Estatuto)"
LICENCIADO = "Licenciado"

# v9.5 (conferência independente, 17/11): registros que só podem existir UMA vez por associado. "manter_um" = é o mesmo fato registrado duas
# vezes (a mesma pessoa habilitada, credenciada, avisada...): fica o do cadastro que fica, com o que o outro tinha a mais (lido, confirmado...).
# "recusar" = dois votos ou duas manifestações da mesma pessoa no mesmo assunto: isso não se resolve sozinho.
_UNICOS_POR_ASSOCIADO = {
    "habilitados_assembleia": (("id_assembleia",), "manter_um", None),
    "credenciamentos_assembleia": (("id_assembleia",), "manter_um", None),
    "justificativas_falta_assembleia": (("id_assembleia",), "manter_um", None),
    "adesoes_peticao": (("id_peticao",), "manter_um", None),
    "avisos_destinatarios": (("id_aviso",), "manter_um", None),
    "propostas_de_socios": (("id_proposta",), "manter_um", None),
    "votos_abertos": (("id_votacao",), "recusar", "um voto na mesma votação"),
    "comprovantes_voto_secreto": (("id_votacao",), "recusar", "um voto secreto na mesma votação"),
    "manifestacoes_diretoria_disciplinar": (("id_processo",), "recusar", "uma manifestação no mesmo processo disciplinar"),
}


# v9.5 (3ª conferência): no registro repetido que tem uma DECISÃO, a decisão não se perde. (coluna da decisão, valor de "ainda não decidido",
# colunas que vão junto com a decisão, o que dizer quando os dois decidiram diferente)
_DECISAO_DO_REPETIDO = {
    "justificativas_falta_assembleia": (
        "status", "Pendente", ("status", "motivo_decisao", "id_usuario_decisao", "decidido_em"),
        "decisões diferentes na mesma justificativa de falta",
    ),
    "propostas_de_socios": ("decisao", None, ("decisao", "observacao"), "respostas diferentes na mesma proposta de filiação"),
}


def _vazio(valor) -> bool:
    return valor is None or (isinstance(valor, str) and not valor.strip())


def _so_digitos(valor) -> str:
    return "".join(c for c in str(valor or "") if c.isdigit())


def _data_de_entrada(associado: Associado) -> date:
    """A data de entrada no dia de Belém (a hora não decide quem é mais antigo)."""
    from app.services.fuso import para_belem

    return para_belem(associado.data_admissao).date() if associado.data_admissao else date.max


def mais_antigo(associado: Associado) -> tuple:
    """A ordem de "quem é mais antigo": o DIA de entrada, depois o número de matrícula, depois o número interno."""
    return (
        _data_de_entrada(associado),
        associado.numero_matricula if associado.numero_matricula is not None else 10**9,
        associado.id_associado,
    )


def _endereco_de(db: Session, associado: Optional[Associado]):
    """O endereço com conteúdo (uma linha em branco, que a ficha cria ao salvar sem endereço, conta como sem endereço)."""
    if associado is None:
        return None
    for e in db.query(Endereco).filter(Endereco.id_associado == associado.id_associado).all():
        if any(not _vazio(getattr(e, c)) for c in ("cep", "logradouro", "numero", "bairro", "cidade", "estado")):
            return e
    return None


def texto_do_endereco(e) -> Optional[str]:
    if e is None:
        return None
    cidade = "/".join(p for p in [(e.cidade or "").strip(), (e.estado or "").strip()] if p)
    return ", ".join(p for p in [(e.logradouro or "").strip(), (e.numero or "").strip(), (e.bairro or "").strip(), cidade] if p) or None


def _data_iso(v):
    return v.date().isoformat() if isinstance(v, datetime) else (v.isoformat() if v else None)


def _comparaveis(db: Session, mantida: Pessoa, absorvida: Pessoa, assoc_m: Optional[Associado], assoc_a: Optional[Associado]) -> list[tuple]:
    """(chave, valor real de quem fica, valor real do juntado, como mostrar, como comparar): a base da comparação da tela, da junção e da
    assinatura da comparação."""
    from app.services import cpf_protegido

    def mesmo(v):
        return v

    def texto_igual(a, b):
        return a.strip().lower() == b.strip().lower()

    def digitos_iguais(a, b):
        return _so_digitos(a) == _so_digitos(b)

    def exato(a, b):
        return a == b

    itens = [
        ("nome_completo", mantida.nome_completo, absorvida.nome_completo, mesmo, texto_igual),
        ("cpf", mantida.cpf, absorvida.cpf, cpf_protegido.mascarar, digitos_iguais),
        ("data_nascimento", mantida.data_nascimento, absorvida.data_nascimento, _data_iso, lambda a, b: _data_iso(a) == _data_iso(b)),
        ("email_contato", mantida.email_contato, absorvida.email_contato, mesmo, texto_igual),
        ("telefone_whatsapp", mantida.telefone_whatsapp, absorvida.telefone_whatsapp, mesmo, digitos_iguais),
        ("estado_civil", mantida.estado_civil, absorvida.estado_civil, mesmo, exato),
        ("profissao", mantida.profissao, absorvida.profissao, mesmo, exato),
        ("naturalidade", mantida.naturalidade, absorvida.naturalidade, mesmo, exato),
        ("foto", mantida.foto, absorvida.foto, mesmo, exato),
    ]
    if assoc_m and assoc_a:
        itens.append(("categoria", assoc_m.categoria, assoc_a.categoria, mesmo, exato))
        itens.append((
            "endereco", texto_do_endereco(_endereco_de(db, assoc_m)), texto_do_endereco(_endereco_de(db, assoc_a)), mesmo, texto_igual,
        ))
    return itens


def classificar_campos(db: Session, mantida: Pessoa, absorvida: Pessoa, assoc_m: Optional[Associado], assoc_a: Optional[Associado]) -> list[dict]:
    """Uma linha por dado, com o valor de cada lado e o que acontece: "igual", "so_um" (só o que fica tem), "vem_do_juntado" (só o juntado tem:
    vem dele) ou "escolher" (os dois têm e são diferentes). A MESMA regra vale para a tela (comparar) e para a junção: o que a tela mostra em
    "Vai ficar assim" é o que o servidor grava. Os valores que vão para a tela já vêm escondidos onde precisa (o CPF) - a comparação usa o real."""
    linhas = []
    for chave, real_m, real_a, mostrar, igual in _comparaveis(db, mantida, absorvida, assoc_m, assoc_a):
        if _vazio(real_m) and _vazio(real_a):
            modo = "igual"
        elif _vazio(real_a):
            modo = "so_um"
        elif _vazio(real_m):
            modo = "vem_do_juntado" if chave != "nome_completo" else "escolher"
        elif igual(real_m, real_a):
            modo = "igual"
        else:
            modo = "escolher"
        linhas.append({
            "chave": chave,
            "fica": None if _vazio(real_m) else mostrar(real_m),
            "sai": None if _vazio(real_a) else mostrar(real_a),
            "modo": modo,
        })
    return linhas


def assinatura_da_comparacao(db: Session, mantida: Pessoa, absorvida: Pessoa, assoc_m: Optional[Associado], assoc_a: Optional[Associado]) -> str:
    """v9.5 (3ª conferência): a "impressão" do que a tela mostrou na comparação - os valores REAIS dos dois cadastros, a situação e o acesso. A
    junção confere de novo: se qualquer valor mudou depois da comparação (não só quais campos diferem), pede para comparar de novo. É um HMAC com
    a chave do servidor porque os valores incluem o CPF: a assinatura nunca pode servir para adivinhar o CPF que a tela esconde."""
    from app import security

    base = [[chave, None if _vazio(m) else str(m), None if _vazio(a) else str(a)] for chave, m, a, _, _ in _comparaveis(
        db, mantida, absorvida, assoc_m, assoc_a,
    )]
    from app.models.situacao import MudancaSituacao

    base.append(["pessoas", mantida.id_pessoa, absorvida.id_pessoa])
    for lado, associado in (("fica", assoc_m), ("sai", assoc_a)):
        if associado is None:
            continue
        # o que decide a situação e o acesso que a tela mostrou: a situação gravada, a última mudança registrada e o login (ativo? segundo passo?)
        login = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first() if associado.id_usuario else None
        ultima = db.query(func.max(MudancaSituacao.criado_em)).filter(MudancaSituacao.id_associado == associado.id_associado).scalar()
        base.append([
            lado, associado.id_associado, associado.status_arrolamento, str(associado.data_admissao), str(ultima), associado.id_usuario,
            None if login is None else [bool(login.ativo), bool(login.mfa_ativado)],
        ])
    texto = json.dumps(base, ensure_ascii=False, default=str)
    return hmac.new(security.JWT_SECRET.encode("utf-8"), f"juncao|{texto}".encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def _vem_da_absorvida(linha: dict, escolhas: dict) -> bool:
    escolha = escolhas.get(linha["chave"])
    if linha["modo"] == "escolher":
        return escolha == "absorvida"
    if linha["modo"] == "vem_do_juntado":
        return escolha != "mantida"
    return False


def _origem_da_situacao(db: Session, assoc_m: Associado, assoc_a: Associado) -> tuple[str, str]:
    """(de onde vem, explicação) da situação depois de juntar dois cadastros de associado. A matrícula mais antiga sempre fica, mas a situação
    ATUAL da pessoa vale. Suspensão (Estatuto) nunca some numa junção. Entre um cadastro desligado ou licenciado e um ativo, decide o que
    aconteceu POR ÚLTIMO (a mudança de situação mais recente registrada): uma licença pedida agora no cadastro antigo continua; um cadastro
    antigo desligado há anos, com o novo ativo, volta ativo. Desligamento ou licença sem registro de quando aconteceu conta como antigo."""
    from app.models.situacao import MudancaSituacao

    def ultima_mudanca(associado):
        return db.query(func.max(MudancaSituacao.criado_em)).filter(MudancaSituacao.id_associado == associado.id_associado).scalar()

    def atividade(associado):
        return ultima_mudanca(associado) or associado.data_admissao or datetime.min

    inativos = (DESLIGADO, LICENCIADO)
    m, a = assoc_m.status_arrolamento, assoc_a.status_arrolamento
    if SUSPENSO in (m, a):
        return "suspenso", f"Continua {SUSPENSO}: uma suspensão não some ao juntar"
    if m in inativos and a not in inativos:
        quando = ultima_mudanca(assoc_m)
        if quando and quando > atividade(assoc_a):
            return "mantida", f"Continua {m}: foi a mudança mais recente"
        return "juntado", f"Fica a do cadastro juntado ({a}), recalculada com as mensalidades das duas"
    if a in inativos and m not in inativos:
        quando = ultima_mudanca(assoc_a)
        if quando and quando > atividade(assoc_m):
            return "juntado", f"Fica {a}, do cadastro juntado: foi a mudança mais recente"
        return "recalcular", "Calculada de novo com as mensalidades das duas"
    if m in inativos and a in inativos:
        if (ultima_mudanca(assoc_a) or datetime.min) > (ultima_mudanca(assoc_m) or datetime.min):
            return "juntado", f"Fica {a}, do cadastro juntado: foi a mudança mais recente"
        return "mantida", f"Continua {m}"
    return "recalcular", "Calculada de novo com as mensalidades das duas"


_EFEITOS_DO_DESLIGAMENTO = (
    "como num desligamento, a carteirinha deixa de valer, o acesso ao painel é desligado (nunca o de quem está fazendo a junção) e as cobranças "
    "pendentes que vencem depois dele são canceladas"
)


def situacao_final(origem: str, assoc_m: Associado, assoc_a: Associado) -> Optional[str]:
    """A situação que fica gravada (None = calculada de novo com as mensalidades das duas, nunca Desligado nem Suspenso)."""
    return {"suspenso": SUSPENSO, "mantida": assoc_m.status_arrolamento, "juntado": assoc_a.status_arrolamento}.get(origem)


def situacao_depois(db: Session, assoc_m: Associado, assoc_a: Associado) -> tuple[str, str]:
    """(de onde vem, explicação) - ver `_origem_da_situacao`. v9.5 (3ª conferência): se o resultado é Desligado, a junção faz o que o
    desligamento faz (`_aplicar_desligamento`), e a explicação da tela diz isso."""
    origem, texto = _origem_da_situacao(db, assoc_m, assoc_a)
    if situacao_final(origem, assoc_m, assoc_a) == DESLIGADO:
        texto = f"{texto}; {_EFEITOS_DO_DESLIGAMENTO}"
    return origem, texto


def escolher_acesso(db: Session, assoc_m: Associado, assoc_a: Associado, id_operador: Optional[int]):
    """(login que fica, login que é desligado, explicação). Uma pessoa, um acesso: fica o login ATIVO; entre dois ativos, o de quem está
    operando (nunca se desliga o próprio acesso de quem junta), depois o que tem o segundo passo ligado, depois o do cadastro que fica. Login
    desligado nunca é herdado."""
    um = db.query(Usuario).filter(Usuario.id_usuario == assoc_m.id_usuario).first() if assoc_m.id_usuario else None
    dois = db.query(Usuario).filter(Usuario.id_usuario == assoc_a.id_usuario).first() if assoc_a.id_usuario else None
    if dois is None:
        return um, None, "Fica o acesso do cadastro que fica" if um else "Nenhum dos dois tem acesso ao painel"
    if um is None:
        if dois.ativo:
            return dois, None, "Passa para o cadastro que fica o acesso do juntado"
        return None, None, "O acesso do juntado já estava desligado: não passa"
    if um.ativo and not dois.ativo:
        return um, None, "Fica o acesso do cadastro que fica (o do juntado já estava desligado)"
    if dois.ativo and not um.ativo:
        return dois, None, "Fica o acesso ativo, que era do juntado (o do cadastro que fica estava desligado)"
    if not um.ativo and not dois.ativo:
        return um, None, "Os dois acessos estavam desligados"
    fica, sai = um, dois
    if id_operador == dois.id_usuario or (id_operador != um.id_usuario and dois.mfa_ativado and not um.mfa_ativado):
        fica, sai = dois, um
    return fica, sai, "As duas tinham acesso: fica um só e o outro é desligado"


def _resolver_unicos(db: Session, id_mantido: int, id_absorvido: int, contagens: dict) -> None:
    from app.database import Base

    for nome, (chaves, regra, descricao) in _UNICOS_POR_ASSOCIADO.items():
        tabela = Base.metadata.tables.get(nome)
        if tabela is None:
            continue
        coluna = next(fk.parent for fk in tabela.foreign_keys if fk.column.table.name == "associados")
        pk = list(tabela.primary_key.columns)[0]
        do_mantido = {tuple(r._mapping[c] for c in chaves): r for r in db.execute(tabela.select().where(coluna == id_mantido))}
        for r in db.execute(tabela.select().where(coluna == id_absorvido)).all():
            par = do_mantido.get(tuple(r._mapping[c] for c in chaves))
            if par is None:
                continue
            if regra == "recusar":
                raise HTTPException(
                    status_code=409,
                    detail=f"Os dois cadastros têm {descricao}: isso não se junta sozinho. Resolva antes de juntar; nada foi alterado.",
                )
            # o mesmo fato duas vezes: fica o do cadastro que fica, completado com as DATAS do que aconteceu que só o outro tinha (lido,
            # confirmado...) e com a decisão (abaixo). Nada mais vem sozinho - 4ª conferência: copiar qualquer coluna vazia levava o login do
            # juntado para a linha do aviso que fica (trava de um aviso por login: a junção era recusada) e a saída de um credenciamento para a
            # entrada de outro (a pessoa sumia do quórum)
            completar = {}
            decisao = _DECISAO_DO_REPETIDO.get(nome)
            if decisao is not None:
                coluna_decisao, ainda_nao, vao_junto, descricao_decisao = decisao
                vm, va = par._mapping[coluna_decisao], r._mapping[coluna_decisao]
                if vm != va and va != ainda_nao and not _vazio(va):
                    if vm != ainda_nao and not _vazio(vm):
                        raise HTTPException(
                            status_code=409,
                            detail=f"Os dois cadastros têm {descricao_decisao}: isso não se junta sozinho. Resolva antes de juntar; nada foi alterado.",
                        )
                    completar.update({c: r._mapping[c] for c in vao_junto})  # só o juntado tinha a decisão: ela vem
            da_decisao = set(decisao[2]) if decisao else set()
            for c in tabela.columns:
                if c.name.endswith("_em") and c.name not in da_decisao and par._mapping[c.name] is None and r._mapping[c.name] is not None:
                    completar[c.name] = r._mapping[c.name]
            # na lista de quem pode votar: se um dos dois estava habilitado, a pessoa está (Q1 da reconferência)
            if "habilitado" in tabela.c and r._mapping["habilitado"] and not par._mapping["habilitado"]:
                completar.update({
                    c: r._mapping[c] for c in ("habilitado", "motivo_inabilitacao", "status_arrolamento_no_momento") if c in tabela.c
                })
            # primeiro o que aponta para a linha repetida passa para a que fica, e a repetida sai; só então a que fica é completada (nenhuma trava
            # do banco vê as duas ao mesmo tempo com o mesmo valor)
            _repassar_filhos(db, tabela, r._mapping[pk.name], par._mapping[pk.name], contagens)
            db.execute(tabela.delete().where(pk == r._mapping[pk.name]))
            if completar:
                db.execute(tabela.update().where(pk == par._mapping[pk.name]).values(completar))
            contagens[f"repetidos_{nome}"] = contagens.get(f"repetidos_{nome}", 0) + 1


def _repassar_filhos(db: Session, tabela, id_que_sai, id_que_fica, contagens: dict) -> None:
    """O que aponta para a linha repetida que vai sair (as entregas por e-mail de um aviso, por exemplo - N1 da reconferência) passa para a
    linha que fica; o que já existe nela (o mesmo canal) fica uma vez só."""
    from sqlalchemy import UniqueConstraint

    from app.database import Base

    for filho in Base.metadata.tables.values():
        for fk in filho.foreign_keys:
            if fk.column.table is not tabela:
                continue
            unicos = [
                [c.name for c in u.columns if c.name != fk.parent.name]
                for u in filho.constraints if isinstance(u, UniqueConstraint) and fk.parent.name in [c.name for c in u.columns]
            ]
            ja_tem = [r._mapping for r in db.execute(filho.select().where(fk.parent == id_que_fica))]
            pk_filho = list(filho.primary_key.columns)[0]
            for r in db.execute(filho.select().where(fk.parent == id_que_sai)).all():
                repetido = any(all(r._mapping[c] == outro[c] for c in cols) for cols in unicos for outro in ja_tem)
                if repetido:
                    db.execute(filho.delete().where(pk_filho == r._mapping[pk_filho.name]))
                else:
                    db.execute(filho.update().where(pk_filho == r._mapping[pk_filho.name]).values({fk.parent.name: id_que_fica}))
                contagens[f"repassados_{filho.name}"] = contagens.get(f"repassados_{filho.name}", 0) + 1


def _resolver_mensalidades(db: Session, mantido: Associado, absorvido: Associado, contagens: dict) -> None:
    """A mesma pessoa não paga o mesmo mês duas vezes (os dois cadastros recebem a mensalidade todo mês). Regras (reconferência de 17/11):
    - o par é a mensalidade do MESMO plano e mês nos dois cadastros; planos diferentes só se cada cadastro tem uma única mensalidade naquele mês
      (categorias diferentes, a mesma cobrança). Vários planos da mesma categoria (mensalidade e fundo, por exemplo) não são repetição;
    - o mês de um pagamento antecipado em bloco (competência até competência_fim) conta em cada mês do bloco;
    - "com dinheiro" = paga, paga em parte (saldo menor que o valor) ou renegociada (a dívida foi para as parcelas);
    - com dinheiro dos DOIS lados no mesmo par: pagamento em dobro, a junção é recusada (devolver ou virar crédito é decisão do Financeiro);
    - com dinheiro de um lado: fica ela e a pendente intacta do outro lado é cancelada; sem dinheiro: fica a pendente do cadastro que fica;
    - um bloco nunca é cancelado pela metade: se o que sobraria é parte de um bloco ainda pendente, a junção é recusada explicando.
    A cancelada sai da trava de um título por plano e mês (fica sem plano, e a descrição diz por quê)."""
    from app.models.financeiro import TituloFinanceiro

    titulos = db.query(TituloFinanceiro).filter(
        TituloFinanceiro.id_associado.in_([mantido.id_associado, absorvido.id_associado]),
        TituloFinanceiro.competencia.isnot(None),
    ).all()

    def meses(t):
        ano, mes = int(t.competencia[:4]), int(t.competencia[5:7])
        fim = t.competencia_fim or t.competencia
        lista = []
        while f"{ano:04d}-{mes:02d}" <= fim and len(lista) < 120:
            lista.append(f"{ano:04d}-{mes:02d}")
            ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
        return lista

    def com_dinheiro(t):
        return t.status in ("Pago", "Renegociado") or (
            t.status == "Pendente" and t.valor_original is not None and t.saldo_devedor is not None and t.saldo_devedor < t.valor_original
        )

    def bloco(t):
        return bool(t.competencia_fim and t.competencia_fim != t.competencia)

    vivos = [t for t in titulos if t.status in ("Pago", "Pendente", "Renegociado")]
    cobertura: dict[int, dict[str, list]] = {mantido.id_associado: {}, absorvido.id_associado: {}}
    for t in vivos:
        for mes in meses(t):
            cobertura[t.id_associado].setdefault(mes, []).append(t)

    em_dobro, bloco_pela_metade, ambiguos, canceladas = [], [], [], {}
    for mes in sorted(set(cobertura[mantido.id_associado]) & set(cobertura[absorvido.id_associado])):
        lm, la = cobertura[mantido.id_associado][mes], cobertura[absorvido.id_associado][mes]
        comuns = {t.id_plano_contribuicao for t in lm} & {t.id_plano_contribuicao for t in la}
        pares = [[t for t in lm + la if t.id_plano_contribuicao == plano] for plano in comuns]
        # o que sobra em planos diferentes (categorias diferentes, a mesma cobrança): uma de cada lado forma par; mais que isso não dá para saber
        # qual cobrança repete qual (3ª conferência: antes ficava, calada, cobrada em dobro)
        resto_m = [t for t in lm if t.id_plano_contribuicao not in comuns]
        resto_a = [t for t in la if t.id_plano_contribuicao not in comuns]
        if resto_m and resto_a:
            if len(resto_m) == 1 and len(resto_a) == 1:
                pares.append(resto_m + resto_a)
            else:
                ambiguos.append(f"{mes[5:7]}/{mes[:4]}")
        for par in pares:
            par = [t for t in par if t.id_titulo not in canceladas]
            lados_com_dinheiro = {t.id_associado for t in par if com_dinheiro(t)}
            rotulo = f"{mes[5:7]}/{mes[:4]}"
            if len(lados_com_dinheiro) == 2:
                em_dobro.append(rotulo)
                continue
            if lados_com_dinheiro:
                ficam = [t for t in par if com_dinheiro(t)]
            else:
                ficam = [next((t for t in par if t.id_associado == mantido.id_associado), par[0])]
            for t in par:
                if t in ficam or com_dinheiro(t):
                    continue
                if bloco(t):
                    bloco_pela_metade.append(rotulo)
                    continue
                canceladas[t.id_titulo] = t
    if em_dobro:
        raise HTTPException(
            status_code=409,
            detail=f"Os dois cadastros pagaram (ou renegociaram) a mensalidade de {', '.join(sorted(set(em_dobro)))}. Resolva o pagamento em dobro "
                   "no Financeiro (devolução ou crédito) antes de juntar; nada foi alterado.",
        )
    if ambiguos:
        raise HTTPException(
            status_code=409,
            detail=f"A mensalidade de {', '.join(sorted(set(ambiguos)))} está nos dois cadastros em planos diferentes, e não dá para saber qual "
                   "cobrança repete a outra. Cancele a cobrança em dobro no Financeiro antes de juntar; nada foi alterado.",
        )
    if bloco_pela_metade:
        raise HTTPException(
            status_code=409,
            detail=f"A mensalidade de {', '.join(sorted(set(bloco_pela_metade)))} está nos dois cadastros e uma delas faz parte de um pagamento "
                   "antecipado ainda pendente. Resolva esse bloco no Financeiro antes de juntar; nada foi alterado.",
        )
    for t in canceladas.values():
        t.status = "Cancelado"
        t.descricao = f"{t.descricao or 'Mensalidade'} (cancelada: cobrança em dobro do mesmo mês, na junção de cadastros duplicados)"
        t.id_plano_contribuicao = None
    db.flush()
    # o que ainda esbarra na trava de plano e mês (um cancelado ou renegociado antigo de um lado contra um título do outro): o que não está mais
    # vivo sai do plano; se os dois estão vivos, é repetição que as regras acima não resolveram - recusa
    restantes = [t for t in titulos if t.id_plano_contribuicao is not None]
    do_mantido = {(t.id_plano_contribuicao, t.competencia): t for t in restantes if t.id_associado == mantido.id_associado}
    for t in restantes:
        if t.id_associado != absorvido.id_associado:
            continue
        outro = do_mantido.get((t.id_plano_contribuicao, t.competencia))
        if outro is None:
            continue
        sai = t if t.status == "Cancelado" else outro if outro.status == "Cancelado" else None
        if sai is None:
            raise HTTPException(
                status_code=409,
                detail=f"A mensalidade de {t.competencia[5:7]}/{t.competencia[:4]} está nos dois cadastros de um jeito que não se junta sozinho. "
                       "Resolva no Financeiro antes de juntar; nada foi alterado.",
            )
        sai.id_plano_contribuicao = None
    db.flush()
    if canceladas:
        contagens["mensalidades_em_dobro_canceladas"] = len(canceladas)
        contagens["ids_titulos_cancelados"] = sorted(canceladas)


def _conferir_blocos_e_categoria(db: Session, mantido: Associado, absorvido: Associado, categorias_antes: dict) -> None:
    """v9.5 (3ª conferência): a geração do mês pula quem tem pagamento antecipado (bloco) no MESMO plano. Se a junção deixa um bloco que ainda
    cobre este mês ou os seguintes num plano de uma categoria e o cadastro fica em outra, o mês já pago seria cobrado de novo - recusa
    explicando (escolher a categoria do bloco resolve)."""
    from app.models.financeiro import PlanoDeContribuicao, TituloFinanceiro
    from app.services.fuso import para_belem

    if mantido.status_arrolamento == DESLIGADO:
        return  # desligado não recebe a cobrança do mês
    mes_atual = para_belem(datetime.utcnow()).strftime("%Y-%m")
    blocos = db.query(TituloFinanceiro).filter(
        TituloFinanceiro.id_associado.in_([mantido.id_associado, absorvido.id_associado]),
        TituloFinanceiro.competencia_fim.isnot(None),
        TituloFinanceiro.competencia_fim >= mes_atual,
        TituloFinanceiro.status.in_(("Pago", "Pendente", "Renegociado")),
    ).all()
    for t in blocos:
        plano = db.query(PlanoDeContribuicao).filter(PlanoDeContribuicao.id_plano == t.id_plano_contribuicao).first() if t.id_plano_contribuicao else None
        if plano is None or plano.categoria != categorias_antes.get(t.id_associado) or plano.categoria == mantido.categoria:
            continue
        raise HTTPException(
            status_code=409,
            detail=f"Há um pagamento antecipado de {t.competencia[5:7]}/{t.competencia[:4]} a {t.competencia_fim[5:7]}/{t.competencia_fim[:4]} na "
                   f"categoria {plano.categoria}, e o cadastro ficaria na categoria {mantido.categoria}: os meses seguintes seriam cobrados de novo. "
                   f"Escolha a categoria {plano.categoria} na junção, ou resolva no Financeiro antes de juntar; nada foi alterado.",
        )


def _aplicar_desligamento(db: Session, mantido: Associado, id_operador: Optional[int], contagens: dict) -> None:
    """v9.5 (3ª conferência): a junção que termina em Desligado faz o que o desligamento faz (app/routers/situacao.py): o papel de associado
    fica inativo (a carteirinha deixa de valer), o acesso ao painel é desligado e as cobranças pendentes que vencem depois do desligamento são
    canceladas. Diferenças de propósito: nunca o acesso de quem está juntando, e nunca uma cobrança já paga em parte (dinheiro nunca some)."""
    from app.models.financeiro import TituloFinanceiro

    db.query(Papel).filter(Papel.id_pessoa == mantido.id_pessoa, Papel.tipo_papel == "associado").update({"ativo": False})
    if mantido.id_usuario and mantido.id_usuario != id_operador:
        db.query(Usuario).filter(Usuario.id_usuario == mantido.id_usuario).update({"ativo": False})
        contagens["acesso_desligado_pelo_desligamento"] = mantido.id_usuario
    limite = mantido.data_desligamento or datetime.utcnow()
    canceladas = 0
    for t in db.query(TituloFinanceiro).filter(
        TituloFinanceiro.id_associado == mantido.id_associado, TituloFinanceiro.status == "Pendente", TituloFinanceiro.data_vencimento > limite,
    ).all():
        if t.valor_original is not None and t.saldo_devedor is not None and t.saldo_devedor < t.valor_original:
            continue
        t.status = "Cancelado"
        canceladas += 1
    if canceladas:
        contagens["cobrancas_futuras_canceladas_pelo_desligamento"] = canceladas
    db.flush()


def _juntar_valores_de_campo(db: Session, entidade: str, id_fica: int, id_sai: int, contagens: dict) -> None:
    """v9.5 (3ª conferência): os campos personalizados guardam o número do registro sem chave estrangeira de verdade (o alvo depende do tipo de
    cadastro do campo) - por isso a busca das chaves não os achava e eles sumiam da ficha. Os do juntado passam para o que fica; o mesmo campo
    com valor nos dois: igual fica um, diferente recusa (escolher valor de campo criado pela associação não é coisa para a junção adivinhar)."""
    from app.models.core import DefinicaoCampo, ValorCampo

    definicoes = {d.id_definicao: d for d in db.query(DefinicaoCampo).all() if (d.entidade or "").strip().lower() == entidade}
    if not definicoes:
        return
    ids = list(definicoes)
    do_que_fica = {
        v.id_definicao: v for v in db.query(ValorCampo).filter(ValorCampo.id_registro == id_fica, ValorCampo.id_definicao.in_(ids)).all()
    }
    for v in db.query(ValorCampo).filter(ValorCampo.id_registro == id_sai, ValorCampo.id_definicao.in_(ids)).all():
        par = do_que_fica.get(v.id_definicao)
        if par is None:
            v.id_registro = id_fica
        else:
            if _vazio(par.valor):
                par.valor = v.valor
            elif not _vazio(v.valor) and par.valor.strip().lower() != v.valor.strip().lower():
                raise HTTPException(
                    status_code=409,
                    detail=f"O campo \"{definicoes[v.id_definicao].rotulo}\" tem valores diferentes nos dois cadastros. Deixe um valor só na ficha "
                           "antes de juntar; nada foi alterado.",
                )
            db.delete(v)
        contagens[f"campos_personalizados_{entidade}"] = contagens.get(f"campos_personalizados_{entidade}", 0) + 1
    db.flush()


def _juntar_preferencias(db: Session, id_pessoa_mantida: int, id_pessoa_absorvida: int, contagens: dict) -> None:
    """v9.5 (3ª conferência): a escolha de receber ou não cada tipo de e-mail é uma por pessoa. A mesma escolha nos dois cadastros fica uma só,
    com a MAIS RECENTE (a última vontade da pessoa) - antes a junção era recusada por erro de integridade."""
    from app.models.preferencias_de_comunicacao import PreferenciaDeComunicacao

    da_mantida = {p.tipo: p for p in db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == id_pessoa_mantida).all()}
    for p in db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == id_pessoa_absorvida).all():
        igual = da_mantida.get(p.tipo)
        if igual is None:
            p.id_pessoa = id_pessoa_mantida
        else:
            if (p.alterado_em or datetime.min) > (igual.alterado_em or datetime.min):
                igual.recebe, igual.origem, igual.alterado_em = p.recebe, p.origem, p.alterado_em
            db.delete(p)
        contagens["preferencias_de_comunicacao"] = contagens.get("preferencias_de_comunicacao", 0) + 1
    db.flush()


def _repontar_referencias_do_associado(db: Session, id_mantido: int, id_absorvido: int, contagens: dict) -> None:
    """Tudo que aponta para o cadastro de associado juntado passa a apontar para o que fica (descoberto pelo próprio modelo: tabela nova não
    escapa). O endereço tem regra própria (um só fica)."""
    from app.database import Base

    for tabela in Base.metadata.tables.values():
        if tabela.name == "enderecos":
            continue
        for fk in tabela.foreign_keys:
            if fk.column.table.name != "associados":
                continue
            resultado = db.execute(tabela.update().where(fk.parent == id_absorvido).values({fk.parent.name: id_mantido}))
            if resultado.rowcount:
                chave = f"associado_{tabela.name}"
                contagens[chave] = contagens.get(chave, 0) + resultado.rowcount


def _juntar_associados(
    db: Session, mantido: Associado, absorvido: Associado, linhas: list[dict], escolhas: dict, contagens: dict, id_operador: Optional[int],
) -> None:
    # endereço: fica um só, o que a classificação disser (o em branco não conta como endereço)
    linha_end = next((l for l in linhas if l["chave"] == "endereco"), None)
    usar_o_da_absorvida = bool(linha_end and _vem_da_absorvida(linha_end, escolhas))
    for endereco in db.query(Endereco).filter(
        Endereco.id_associado == (mantido.id_associado if usar_o_da_absorvida else absorvido.id_associado)
    ).all():
        db.delete(endereco)
    if usar_o_da_absorvida:
        for endereco in db.query(Endereco).filter(Endereco.id_associado == absorvido.id_associado).all():
            endereco.id_associado = mantido.id_associado
    db.flush()

    categorias_antes = {mantido.id_associado: mantido.categoria, absorvido.id_associado: absorvido.categoria}
    linha_cat = next((l for l in linhas if l["chave"] == "categoria"), None)
    if linha_cat and _vem_da_absorvida(linha_cat, escolhas):
        mantido.categoria = absorvido.categoria
    # observações: nenhuma se perde - juntam-se as duas
    if not _vazio(absorvido.observacoes_gerenciais):
        if _vazio(mantido.observacoes_gerenciais):
            mantido.observacoes_gerenciais = absorvido.observacoes_gerenciais
        elif absorvido.observacoes_gerenciais.strip() != mantido.observacoes_gerenciais.strip():
            mantido.observacoes_gerenciais = (
                f"{mantido.observacoes_gerenciais}\n— do cadastro juntado (matrícula {absorvido.numero_matricula}): {absorvido.observacoes_gerenciais}"
            )

    # a situação: suspensão nunca some; cadastro antigo desligado ou licenciado com o juntado ativo -> vale a do juntado (é a atual)
    origem, _ = situacao_depois(db, mantido, absorvido)
    if origem == "suspenso":
        mantido.status_arrolamento = SUSPENSO
    elif origem == "juntado":
        mantido.status_arrolamento = absorvido.status_arrolamento
        mantido.data_desligamento = absorvido.data_desligamento
        mantido.data_fim_licenca = absorvido.data_fim_licenca
        mantido.data_fim_experiencia = absorvido.data_fim_experiencia
        contagens["situacao_do_juntado"] = 1

    # acesso ao painel: uma pessoa, um acesso (ver escolher_acesso)
    fica, sai, _ = escolher_acesso(db, mantido, absorvido, id_operador)
    if sai is not None:
        sai.ativo = False
        contagens["acesso_ao_painel_desligado"] = sai.id_usuario
    if fica is not None and fica.id_usuario != mantido.id_usuario:
        contagens["acesso_ao_painel_passou"] = 1
    mantido.id_usuario = fica.id_usuario if fica is not None else mantido.id_usuario
    absorvido.id_usuario = None
    db.flush()

    _resolver_unicos(db, mantido.id_associado, absorvido.id_associado, contagens)
    _conferir_blocos_e_categoria(db, mantido, absorvido, categorias_antes)
    _resolver_mensalidades(db, mantido, absorvido, contagens)
    # v9.5i: uma credencial valendo por pessoa. Se o cadastro que fica já tem a dele, a do juntado deixa de valer (o QR dela passa a mostrar "não vale");
    # se não tem, a do juntado continua valendo e passa para o que fica (o cartão que a pessoa tem na mão não para de funcionar)
    from app.services.credencial import substituir_na_juncao, valendo

    if valendo(db, mantido.id_associado) is not None:
        substituidas = substituir_na_juncao(db, absorvido.id_associado)
        if substituidas:
            contagens["credenciais_substituidas"] = substituidas
    _repontar_referencias_do_associado(db, mantido.id_associado, absorvido.id_associado, contagens)
    _juntar_valores_de_campo(db, "associado", mantido.id_associado, absorvido.id_associado, contagens)
    if mantido.status_arrolamento == DESLIGADO:
        _aplicar_desligamento(db, mantido, id_operador, contagens)
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
    nome_confirmacao: str, usuario=None, escolhas: Optional[dict] = None, id_fila: Optional[int] = None, assinatura: Optional[str] = None,
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

    escolhas_dadas = escolhas is not None
    escolhas = dict(escolhas or {})
    desconhecidos = sorted(set(escolhas) - set(CAMPOS_ESCOLHIVEIS))
    if desconhecidos:
        raise HTTPException(status_code=400, detail=f"Campo que não se escolhe na junção: {', '.join(desconhecidos)}.")

    associado_mantida = db.query(Associado).filter(Associado.id_pessoa == id_pessoa_mantida).first()
    associado_absorvida = db.query(Associado).filter(Associado.id_pessoa == id_pessoa_absorvida).first()
    dois_associados = bool(associado_mantida and associado_absorvida)
    if associado_mantida or associado_absorvida:
        # v9.5 (conferência): juntar quando há cadastro de ASSOCIADO (o histórico dele vai junto) só a partir de um par que a fila de revisão
        # apontou e que ainda está pendente
        from app.models.qualidade_cadastro import PENDENTE, FilaRevisaoCadastro

        par = {id_pessoa_mantida, id_pessoa_absorvida}
        item = db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_fila == id_fila).first() if id_fila else None
        if item is None or item.status != PENDENTE or {item.id_pessoa_a, item.id_pessoa_b} != par:
            raise HTTPException(
                status_code=409,
                detail="Cadastro de associado só se junta a partir da fila da Qualidade da base (o par apontado como possível duplicado).",
            )
    if dois_associados:
        if mais_antigo(associado_absorvida) < mais_antigo(associado_mantida):
            desde = _data_de_entrada(associado_absorvida).strftime("%d/%m/%Y") if associado_absorvida.data_admissao else "a data mais antiga"
            raise HTTPException(
                status_code=409,
                detail=f"Fica a matrícula mais antiga: a nº {associado_absorvida.numero_matricula} (desde {desde}). "
                       "Escolha esse cadastro como o que fica e junte o outro a ele.",
            )
    matricula_mantida = associado_mantida.numero_matricula if associado_mantida else None
    matricula_liberada = associado_absorvida.numero_matricula if dois_associados else None

    funcionario_mantida = db.query(Funcionario).filter(Funcionario.id_pessoa == id_pessoa_mantida).first()
    funcionario_absorvida = db.query(Funcionario).filter(Funcionario.id_pessoa == id_pessoa_absorvida).first()
    if funcionario_mantida and funcionario_absorvida:
        raise HTTPException(
            status_code=409,
            detail="As duas pessoas já são Funcionário - resolva manualmente qual vínculo "
                   "empregatício deve prevalecer antes de mesclar.",
        )

    linhas = classificar_campos(db, mantida, absorvida, associado_mantida, associado_absorvida)
    if escolhas_dadas:
        # a tela manda as escolhas de tudo o que mostrou como diferente: se agora há um campo diferente sem escolha, o cadastro mudou depois
        # da comparação (N5 da reconferência) - nada de ficar, calado, com o valor de um dos lados
        sem_escolha = [l["chave"] for l in linhas if l["modo"] == "escolher" and l["chave"] not in escolhas]
        if sem_escolha:
            raise HTTPException(status_code=400, detail="O cadastro mudou depois da comparação: compare de novo antes de juntar.")
    if assinatura is not None and not hmac.compare_digest(
        # em bytes: texto com acento faria a comparação de texto dar erro (500) em vez de recusar
        assinatura.encode("utf-8"), assinatura_da_comparacao(db, mantida, absorvida, associado_mantida, associado_absorvida).encode("utf-8"),
    ):
        # 3ª conferência: algum valor mudou depois da comparação (não só quais campos diferem) - o que a tela mostrou não é mais o que seria gravado
        raise HTTPException(status_code=400, detail="O cadastro mudou depois da comparação: compare de novo antes de juntar.")
    fotos = (mantida.foto, absorvida.foto)
    contagens = {"papeis": 0, "associado": 0, "funcionario": 0, "termos_voluntariado": 0, "eventos_linha_do_tempo": 0, "dependentes": 0}
    trazidos: list[str] = []
    try:
        _juntar_tudo(
            db, mantida, absorvida, associado_mantida, associado_absorvida, funcionario_mantida, funcionario_absorvida,
            linhas, escolhas, contagens, trazidos, usuario,
        )
        db.commit()
    except HTTPException:
        db.rollback()  # recusa no meio (pagamento em dobro, voto repetido): nada foi gravado
        raise
    except IntegrityError as erro:
        # nada foi gravado até aqui (o commit é só neste ponto): desfaz tudo e explica, em vez de devolver erro 500
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="As duas pessoas têm registros que não dá para juntar sozinho (por exemplo, a mesma inscrição, presença, ficha de "
                   "beneficiário ou foto da Diretoria nas duas). Resolva esse registro manualmente antes de mesclar; nada foi alterado.",
        ) from erro

    # a foto que não ficou é apagada do armazenamento (depois do commit: falha aqui nunca desfaz a junção, só vai para o log)
    from app.services import armazenamento

    for foto in fotos:
        if foto and foto != mantida.foto:
            armazenamento.remover_url(foto)

    registrar_auditoria(
        db, usuario, "pessoas", "MESCLADO", id_registro_afetado=id_pessoa_mantida,
        # v7.0b: sem o nome (a pessoa pode ser criança; a Auditoria não tem prazo de guarda): o número basta para saber quem foi absorvido.
        # v9.5: as matrículas (a que fica e a que ficou livre), QUAIS campos vieram da absorvida (nunca os valores), o login desligado e as
        # mensalidades em dobro canceladas (pelo número)
        dados_depois={
            "id_pessoa_absorvida": id_pessoa_absorvida, "contagens": contagens, "id_fila": id_fila,
            "matricula_mantida": matricula_mantida, "matricula_liberada": matricula_liberada, "campos_da_absorvida": trazidos,
        },
    )
    if dois_associados:
        # a situação calculável (em dia, inadimplente, experiência, licença) é recalculada com as mensalidades das duas juntas
        from app.services.categoria_associado import recalcular_categoria_associado

        recalcular_categoria_associado(db, associado_mantida.id_associado, usuario=usuario)
    return {"id_pessoa_mantida": id_pessoa_mantida, "contagens": contagens, "matricula_mantida": matricula_mantida, "matricula_liberada": matricula_liberada}


def _juntar_tudo(
    db: Session, mantida: Pessoa, absorvida: Pessoa, associado_mantida, associado_absorvida, funcionario_mantida, funcionario_absorvida,
    linhas: list[dict], escolhas: dict, contagens: dict, trazidos: list, usuario,
) -> None:
    """Todas as mudanças da junção, sem commit: quem chama confirma tudo de uma vez ou desfaz tudo."""
    id_pessoa_mantida, id_pessoa_absorvida = mantida.id_pessoa, absorvida.id_pessoa

    # papéis: o mesmo papel nos dois fica um só - ATIVO se qualquer um dos dois estava ativo (a carteirinha de quem está ativo continua valendo)
    papeis_mantida = {p.tipo_papel: p for p in db.query(Papel).filter(Papel.id_pessoa == id_pessoa_mantida).all()}
    for papel in db.query(Papel).filter(Papel.id_pessoa == id_pessoa_absorvida).all():
        igual = papeis_mantida.get(papel.tipo_papel)
        if igual is not None:
            if papel.ativo and not igual.ativo:
                igual.ativo = True
            db.delete(papel)
        else:
            papel.id_pessoa = id_pessoa_mantida
            contagens["papeis"] += 1
    db.flush()

    if associado_absorvida and not associado_mantida:
        associado_absorvida.id_pessoa = id_pessoa_mantida
        contagens["associado"] = 1
    elif associado_absorvida and associado_mantida:
        _juntar_associados(
            db, associado_mantida, associado_absorvida, linhas, escolhas, contagens, usuario.id_usuario if usuario is not None else None,
        )

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

    # Os dados da pessoa, pela MESMA classificação que a tela mostrou (classificar_campos): o que difere, pela escolha; o que só a absorvida
    # tem, vem dela; o resto fica como está na mantida.
    for linha in linhas:
        campo = linha["chave"]
        if not _vem_da_absorvida(linha, escolhas):
            continue
        trazidos.append(campo)  # a Auditoria guarda QUAIS vieram do juntado (o endereço e a categoria também), nunca os valores
        if campo in ("categoria", "endereco"):
            continue  # gravados na junção dos cadastros de associado
        valor = getattr(absorvida, campo)
        if campo in _CAMPOS_UNICOS:
            setattr(absorvida, campo, None)
            db.flush()
        setattr(mantida, campo, valor)
    # habilidades (do voluntariado): ficam as dos dois
    if not _vazio(absorvida.habilidades):
        juntas = [h for h in (mantida.habilidades or "").split(",") if h.strip()]
        for h in absorvida.habilidades.split(","):
            if h.strip() and h.strip() not in [x.strip() for x in juntas]:
                juntas.append(h.strip())
        mantida.habilidades = ",".join(x.strip() for x in juntas)

    _juntar_valores_de_campo(db, "pessoa", id_pessoa_mantida, id_pessoa_absorvida, contagens)
    _juntar_preferencias(db, id_pessoa_mantida, id_pessoa_absorvida, contagens)
    _repontar_demais_referencias(db, id_pessoa_mantida, id_pessoa_absorvida, contagens)
    db.delete(absorvida)
    db.flush()
