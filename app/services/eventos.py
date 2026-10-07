"""v4.5 (FASE 4) - Evento como entidade única e pontual, com sessões (programação) e edições
recorrentes ligadas entre si. Inscrição reaproveita o motor genérico da v4.0
(`app/services/inscricao.py`) - nenhum mecanismo de inscrição próprio aqui."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

import uuid

from app.models.associados import Associado
from app.models.core import Usuario
from app.models.eventos import (
    TIPO_PERGUNTA_SELECAO_MULTIPLA,
    TIPO_PERGUNTA_SELECAO_UNICA,
    CotaInscricaoEvento,
    Evento,
    PerguntaEvento,
    SessaoEvento,
)
from app.models.espacos import Espaco
from app.models.projetos import ProjetoEvento
from app.models.pessoas import Papel, Pessoa
from app.services import inscricao as servico_inscricao
from app.services import notificacoes
from app.services import vagas as servico_vagas
from app.services.catalogos import validar_codigo_em_catalogo
from app.services.documentos_verificacao import exigir_texto_sem_dado_pessoal
from app.services.projetos import associado_do_usuario_ou_403
from app.services.protecao_publica import gerar_codigo_checkin, gerar_token_cancelamento
from app.config_cache import obter_configuracao

TIPO_PAPEL_PARTICIPANTE_EXTERNO = "participante_externo"

CONTEXTO_EVENTO = "Evento"
CONTEXTO_SESSAO_EVENTO = "SessaoEvento"


def criar_evento(
    db: Session, *, titulo: str, descricao: Optional[str], categoria: str,
    data_hora_inicio: datetime, data_hora_fim: Optional[datetime], id_espaco: Optional[int],
    endereco_avulso: Optional[str], id_associado_responsavel: Optional[int], vagas: Optional[int],
    gratuito: bool, visibilidade: str, id_usuario: Optional[int], id_projeto: Optional[int] = None,
) -> Evento:
    validar_codigo_em_catalogo(db, "tipo_evento", categoria, "Categoria do evento")
    _exigir_projeto_existente(db, id_projeto)
    if visibilidade == "Pública":
        exigir_texto_sem_dado_pessoal({"título": titulo, "descrição": descricao, "local": endereco_avulso})
    if visibilidade not in ("Pública", "Interna"):
        raise HTTPException(status_code=422, detail="Visibilidade deve ser 'Pública' ou 'Interna'.")
    if data_hora_fim is not None and data_hora_fim <= data_hora_inicio:
        raise HTTPException(status_code=422, detail="O fim do evento precisa ser depois do início.")
    if id_espaco is not None and not db.query(Espaco).filter(Espaco.id_espaco == id_espaco).first():
        raise HTTPException(status_code=404, detail="Espaço não encontrado.")
    if id_associado_responsavel is not None and not db.query(Associado).filter(Associado.id_associado == id_associado_responsavel).first():
        raise HTTPException(status_code=404, detail="Associado responsável não encontrado.")

    evento = Evento(
        titulo=titulo, descricao=descricao, categoria=categoria, data_hora_inicio=data_hora_inicio,
        data_hora_fim=data_hora_fim, id_espaco=id_espaco, endereco_avulso=endereco_avulso,
        id_associado_responsavel=id_associado_responsavel, vagas=vagas, gratuito=gratuito,
        visibilidade=visibilidade, id_usuario_criacao=id_usuario, id_projeto=id_projeto,
    )
    db.add(evento)
    db.commit()
    db.refresh(evento)
    return evento


def _exigir_projeto_existente(db: Session, id_projeto: Optional[int]) -> None:
    if id_projeto is not None and not db.query(ProjetoEvento.id_projeto).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail=f"Projeto nº {id_projeto} não encontrado.")


CAMPOS_EDITAVEIS = (
    "titulo", "descricao", "categoria", "data_hora_inicio", "data_hora_fim", "id_espaco", "endereco_avulso", "vagas", "visibilidade",
    "id_projeto",
)


def editar_evento(db: Session, id_evento: int, campos: dict) -> tuple[Evento, dict]:
    """Edita o cadastro do evento (só os campos enviados). Devolve o evento e o `antes` do que mudou, para a auditoria.
    Evento que já está no site continua no site: a edição entra na próxima sincronização (a cada 15 minutos)."""
    evento = obter_evento(db, id_evento)
    campos = {k: v for k, v in campos.items() if k in CAMPOS_EDITAVEIS}
    if campos.get("titulo") is not None and len(campos["titulo"].strip()) < 3:
        raise HTTPException(status_code=422, detail="O título do evento precisa ter pelo menos 3 letras.")
    if "titulo" in campos and campos["titulo"] is None:
        raise HTTPException(status_code=422, detail="O título do evento não pode ficar vazio.")
    for obrigatorio in ("categoria", "data_hora_inicio", "visibilidade"):
        if obrigatorio in campos and campos[obrigatorio] is None:
            raise HTTPException(status_code=422, detail=f"O campo {obrigatorio} não pode ficar vazio.")
    if campos.get("categoria") is not None:
        validar_codigo_em_catalogo(db, "tipo_evento", campos["categoria"], "Categoria do evento")
    if campos.get("id_espaco") is not None and not db.query(Espaco).filter(Espaco.id_espaco == campos["id_espaco"]).first():
        raise HTTPException(status_code=404, detail="Espaço não encontrado.")
    if campos.get("id_projeto") is not None:
        _exigir_projeto_existente(db, campos["id_projeto"])
    inicio = campos.get("data_hora_inicio", evento.data_hora_inicio)
    fim = campos.get("data_hora_fim", evento.data_hora_fim)
    if fim is not None and fim <= inicio:
        raise HTTPException(status_code=422, detail="O fim do evento precisa ser depois do início.")
    if campos.get("vagas") is not None and campos["vagas"] < (evento.vagas_ocupadas or 0):
        raise HTTPException(status_code=422, detail=f"O evento já tem {evento.vagas_ocupadas} vagas ocupadas: o limite não pode ser menor que isso.")
    final = {c: campos.get(c, getattr(evento, c)) for c in CAMPOS_EDITAVEIS}
    if final["visibilidade"] == "Pública":
        exigir_texto_sem_dado_pessoal({"título": final["titulo"], "descrição": final["descricao"], "local": final["endereco_avulso"]})
    antes = {c: getattr(evento, c) for c in campos if getattr(evento, c) != campos[c]}
    for campo in antes:
        setattr(evento, campo, campos[campo])
    db.commit()
    db.refresh(evento)
    return evento, antes


def obter_evento(db: Session, id_evento: int) -> Evento:
    evento = db.query(Evento).filter(Evento.id_evento == id_evento).first()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado.")
    return evento


def listar_eventos(db: Session) -> list[Evento]:
    return db.query(Evento).order_by(Evento.data_hora_inicio.desc()).all()


def atualizar_configuracao_elegibilidade(
    db: Session, *, id_evento: int, percentual_minimo: Optional[Decimal], carga_horaria_horas: Optional[Decimal],
) -> Evento:
    """v4.8 - sobrescrita por evento da regra de elegibilidade ao certificado
    (app/services/certificados.py). `None` explícito em qualquer campo volta a usar o padrão
    global."""
    evento = obter_evento(db, id_evento)
    evento.percentual_minimo_certificado = percentual_minimo
    evento.carga_horaria_horas = carga_horaria_horas
    db.commit()
    db.refresh(evento)
    return evento


def configurar_cobranca_evento(
    db: Session, *, id_evento: int, valor_base: Optional[Decimal], id_conta_contabil_receita: Optional[int],
    id_centro_custo: Optional[int],
) -> Evento:
    """v4.9 - cobrança de inscrição (app/services/cobranca_evento.py). `valor_base=None` volta o
    evento a gratuito de fato (nenhum caminho de inscrição cobra nada - ver
    `inscrever_com_controle_de_vaga`). `id_conta_contabil_receita` é obrigatório pra cobrar de
    verdade (é pra lá que `criar_lancamento` credita o valor recebido) - validado aqui, não só
    silenciosamente ignorado na hora de cobrar."""
    from app.models.financeiro import CentroDeCusto, PlanoDeContas
    from app.services import contabilidade

    evento = obter_evento(db, id_evento)
    if valor_base is not None:
        if valor_base <= 0:
            raise HTTPException(status_code=422, detail="Valor base da inscrição precisa ser maior que zero (ou nulo, para evento gratuito).")
        if not id_conta_contabil_receita:
            raise HTTPException(status_code=422, detail="Informe a conta contábil de receita para cobrar inscrição.")
        conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta_contabil_receita).first()
        if not conta:
            raise HTTPException(status_code=404, detail="Conta contábil de receita não encontrada.")
        contabilidade.exigir_tipo_conta(conta, ["Receita"], "A conta contábil de receita de um evento")
    if id_centro_custo is not None and not db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_centro_custo).first():
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")

    evento.valor_base = valor_base
    evento.id_conta_contabil_receita = id_conta_contabil_receita if valor_base is not None else None
    evento.id_centro_custo = id_centro_custo
    evento.gratuito = valor_base is None
    db.commit()
    db.refresh(evento)
    return evento


def listar_eventos_publicos(db: Session) -> list[Evento]:
    """v4.5 - o que o site institucional consome (leitura pública, sem autenticação) - só o que
    a diretoria marcou `visibilidade="Pública"`, nunca evento interno vazando pra fora."""
    return (
        db.query(Evento)
        .filter(Evento.visibilidade == "Pública")
        .order_by(Evento.data_hora_inicio)
        .all()
    )


# ==========================================
# SESSÕES (programação do evento)
# ==========================================
def criar_sessao(
    db: Session, *, id_evento: int, titulo: str, descricao: Optional[str],
    data_hora_inicio: datetime, data_hora_fim: Optional[datetime], vagas: Optional[int],
    id_usuario: Optional[int],
) -> SessaoEvento:
    evento = obter_evento(db, id_evento)
    if data_hora_fim is not None and data_hora_fim <= data_hora_inicio:
        raise HTTPException(status_code=422, detail="O fim da sessão precisa ser depois do início.")
    # a programação cabe no período do evento: sessão dois dias antes do início, ou depois do fim, é erro de digitação. Os instantes ficam em UTC
    # sem fuso: a hora que chega com fuso (o painel manda com "Z") é trazida para UTC antes de comparar, senão a comparação dá erro 500
    inicio_utc = data_hora_inicio.astimezone(timezone.utc).replace(tzinfo=None) if data_hora_inicio.tzinfo else data_hora_inicio
    if inicio_utc < evento.data_hora_inicio.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=3):
        raise HTTPException(status_code=422, detail="A sessão não pode começar antes do dia do evento.")
    if evento.data_hora_fim is not None and inicio_utc > evento.data_hora_fim:
        raise HTTPException(status_code=422, detail="A sessão não pode começar depois do fim do evento.")
    if evento.visibilidade == "Pública":  # a programação aparece na página do evento
        exigir_texto_sem_dado_pessoal({"título da sessão": titulo, "descrição da sessão": descricao})

    sessao = SessaoEvento(
        id_evento=id_evento, titulo=titulo, descricao=descricao, data_hora_inicio=data_hora_inicio,
        data_hora_fim=data_hora_fim, vagas=vagas, id_usuario_criacao=id_usuario,
    )
    db.add(sessao)
    db.commit()
    db.refresh(sessao)
    return sessao


def listar_sessoes(db: Session, *, id_evento: int) -> list[SessaoEvento]:
    return db.query(SessaoEvento).filter(SessaoEvento.id_evento == id_evento).order_by(SessaoEvento.data_hora_inicio).all()


def obter_sessao(db: Session, id_sessao: int) -> SessaoEvento:
    sessao = db.query(SessaoEvento).filter(SessaoEvento.id_sessao == id_sessao).first()
    if not sessao:
        raise HTTPException(status_code=404, detail="Sessão de evento não encontrada.")
    return sessao


# ==========================================
# EDIÇÕES RECORRENTES ("a 3ª edição conhece as anteriores")
# ==========================================
def criar_nova_edicao(
    db: Session, *, id_evento_anterior: int, data_hora_inicio: datetime, data_hora_fim: Optional[datetime],
    titulo: Optional[str], id_usuario: Optional[int],
) -> Evento:
    anterior = obter_evento(db, id_evento_anterior)
    if data_hora_fim is not None and data_hora_fim <= data_hora_inicio:
        raise HTTPException(status_code=422, detail="O fim do evento precisa ser depois do início.")
    if titulo and anterior.visibilidade == "Pública":  # a edição nova herda a visibilidade: o título novo vai ao site
        exigir_texto_sem_dado_pessoal({"título da nova edição": titulo})

    nova_edicao = Evento(
        titulo=titulo or anterior.titulo, descricao=anterior.descricao, categoria=anterior.categoria,
        data_hora_inicio=data_hora_inicio, data_hora_fim=data_hora_fim, id_espaco=anterior.id_espaco,
        endereco_avulso=anterior.endereco_avulso, id_associado_responsavel=anterior.id_associado_responsavel,
        vagas=anterior.vagas, gratuito=anterior.gratuito, visibilidade=anterior.visibilidade,
        id_edicao_anterior=anterior.id_evento, id_usuario_criacao=id_usuario, id_projeto=anterior.id_projeto,  # a edição nova segue no mesmo projeto
    )
    db.add(nova_edicao)
    db.commit()
    db.refresh(nova_edicao)
    return nova_edicao


def listar_cadeia_edicoes(db: Session, *, id_evento: int) -> list[Evento]:
    """Toda a família de edições deste evento, do mais antigo pro mais novo - percorre pra trás
    (ancestrais) e pra frente (descendentes) a partir do evento pedido, não só um dos dois lados."""
    atual = obter_evento(db, id_evento)
    ancestrais = []
    cursor = atual
    while cursor.id_edicao_anterior is not None:
        anterior = db.query(Evento).filter(Evento.id_evento == cursor.id_edicao_anterior).first()
        if not anterior:
            break
        ancestrais.append(anterior)
        cursor = anterior
    ancestrais.reverse()

    descendentes = []
    cursor = atual
    while True:
        proxima = db.query(Evento).filter(Evento.id_edicao_anterior == cursor.id_evento).first()
        if not proxima:
            break
        descendentes.append(proxima)
        cursor = proxima

    return [*ancestrais, atual, *descendentes]


# ==========================================
# INSCRIÇÃO (reaproveita o motor genérico da v4.0, nunca um mecanismo próprio)
# ==========================================
def _cobrar_inscricao_se_devido(
    db: Session, *, evento: Evento, inscricao, id_pessoa: int,
    categoria_preco: Optional[str] = None, codigo_cupom: Optional[str] = None, id_usuario: Optional[int] = None,
):
    """v4.9 - nunca cobra quem caiu na lista de espera (vaga ainda não é real - ver
    app/services/vagas.py::inscrever_com_controle_de_vaga); evento sem `valor_base` continua
    gratuito, comportamento preservado desde a v4.5."""
    from app.models.motores import CONFIRMADO, PRE_INSCRITO
    from app.services import cobranca_evento as servico_cobranca_evento

    if inscricao.status not in (PRE_INSCRITO, CONFIRMADO) or evento.valor_base is None:
        return None
    calculo = servico_cobranca_evento.calcular_valor_inscricao(
        db, evento=evento, id_pessoa=id_pessoa, categoria_preco=categoria_preco, codigo_cupom=codigo_cupom,
    )
    return servico_cobranca_evento.gerar_titulo_inscricao(
        db, evento=evento, inscricao=inscricao, id_pessoa=id_pessoa, valor=calculo["valor_final"], id_usuario=id_usuario,
    )


def inscrever_no_evento(db: Session, *, id_evento: int, usuario: Usuario, codigo_cupom: Optional[str] = None):
    evento = obter_evento(db, id_evento)
    associado = associado_do_usuario_ou_403(db, usuario)
    inscricao_criada = servico_vagas.inscrever_com_controle_de_vaga(
        db, contexto_tipo=CONTEXTO_EVENTO, id_contexto=id_evento, id_pessoa=associado.id_pessoa,
        respostas_formulario=None,
    )
    _cobrar_inscricao_se_devido(db, evento=evento, inscricao=inscricao_criada, id_pessoa=associado.id_pessoa, codigo_cupom=codigo_cupom, id_usuario=usuario.id_usuario)
    return inscricao_criada


def inscrever_na_sessao(db: Session, *, id_sessao: int, usuario: Usuario, codigo_cupom: Optional[str] = None):
    sessao = obter_sessao(db, id_sessao)
    evento = obter_evento(db, sessao.id_evento)
    associado = associado_do_usuario_ou_403(db, usuario)
    inscricao_criada = servico_vagas.inscrever_com_controle_de_vaga(
        db, contexto_tipo=CONTEXTO_SESSAO_EVENTO, id_contexto=id_sessao, id_pessoa=associado.id_pessoa,
        respostas_formulario=None,
    )
    _cobrar_inscricao_se_devido(db, evento=evento, inscricao=inscricao_criada, id_pessoa=associado.id_pessoa, codigo_cupom=codigo_cupom, id_usuario=usuario.id_usuario)
    return inscricao_criada


def minhas_inscricoes_em_eventos(db: Session, *, usuario: Usuario) -> list:
    from app.models.motores import Inscricao

    associado = associado_do_usuario_ou_403(db, usuario)
    return (
        db.query(Inscricao)
        .filter(Inscricao.contexto_tipo.in_([CONTEXTO_EVENTO, CONTEXTO_SESSAO_EVENTO]), Inscricao.id_pessoa == associado.id_pessoa)
        .order_by(Inscricao.data_inscricao.desc())
        .all()
    )


# ==========================================
# PERGUNTAS PERSONALIZADAS DO FORMULÁRIO DE INSCRIÇÃO (v4.6)
# ==========================================
def criar_pergunta(
    db: Session, *, id_evento: int, enunciado: str, tipo: str, opcoes: Optional[str],
    obrigatoria: bool, ordem: int,
) -> PerguntaEvento:
    obter_evento(db, id_evento)
    if tipo in (TIPO_PERGUNTA_SELECAO_UNICA, TIPO_PERGUNTA_SELECAO_MULTIPLA) and not opcoes:
        raise HTTPException(status_code=422, detail="Perguntas de seleção precisam de ao menos uma opção (CSV).")

    pergunta = PerguntaEvento(
        id_evento=id_evento, enunciado=enunciado, tipo=tipo, opcoes=opcoes,
        obrigatoria=obrigatoria, ordem=ordem,
    )
    db.add(pergunta)
    db.commit()
    db.refresh(pergunta)
    return pergunta


def listar_perguntas(db: Session, *, id_evento: int) -> list[PerguntaEvento]:
    return db.query(PerguntaEvento).filter(PerguntaEvento.id_evento == id_evento).order_by(PerguntaEvento.ordem).all()


# ==========================================
# COTAS POR CATEGORIA (v4.7) - opcional; sem nenhuma cota configurada, o limite genérico
# `Evento.vagas`/`SessaoEvento.vagas` vale pra todo mundo (ver app/services/vagas.py).
# ==========================================
def criar_cota(db: Session, *, contexto_tipo: str, id_contexto: int, categoria: str, vagas_limite: int) -> CotaInscricaoEvento:
    if contexto_tipo == CONTEXTO_EVENTO:
        obter_evento(db, id_contexto)
    elif contexto_tipo == CONTEXTO_SESSAO_EVENTO:
        obter_sessao(db, id_contexto)
    else:
        raise HTTPException(status_code=422, detail="contexto_tipo deve ser 'Evento' ou 'SessaoEvento'.")
    validar_codigo_em_catalogo(db, "categoria_cota_inscricao", categoria, "Categoria de cota")
    if vagas_limite < 1:
        raise HTTPException(status_code=422, detail="O limite de vagas da cota precisa ser maior que zero.")
    if db.query(CotaInscricaoEvento).filter(
        CotaInscricaoEvento.contexto_tipo == contexto_tipo, CotaInscricaoEvento.id_contexto == id_contexto,
        CotaInscricaoEvento.categoria == categoria,
    ).first():
        raise HTTPException(status_code=400, detail="Já existe uma cota desta categoria para este contexto.")

    cota = CotaInscricaoEvento(contexto_tipo=contexto_tipo, id_contexto=id_contexto, categoria=categoria, vagas_limite=vagas_limite)
    db.add(cota)
    db.commit()
    db.refresh(cota)
    return cota


def listar_cotas(db: Session, *, contexto_tipo: str, id_contexto: int) -> list[CotaInscricaoEvento]:
    return db.query(CotaInscricaoEvento).filter(
        CotaInscricaoEvento.contexto_tipo == contexto_tipo, CotaInscricaoEvento.id_contexto == id_contexto,
    ).order_by(CotaInscricaoEvento.categoria).all()


# ==========================================
# INSCRIÇÃO PÚBLICA COM DEDUPLICAÇÃO (v4.6) - formulário do site, sem login. Rate limiting e
# honeypot são checados no router (antes de chegar aqui); aqui é regra de negócio pura.
# ==========================================
def _texto_email_confirmacao(db: Session, *, evento: Evento, codigo_checkin: str, token_cancelamento: str, status: str) -> str:
    url_base = obter_configuracao(db, "URL_BASE_SITE_PUBLICO", "")
    if url_base:
        linha_cancelamento = f"Para cancelar sua inscrição, acesse: {url_base.rstrip('/')}/cancelar-inscricao?token={token_cancelamento}"
    else:
        linha_cancelamento = f"Para cancelar sua inscrição, entre em contato com a secretaria informando o código {codigo_checkin}."

    if status == "Lista de Espera":
        # v4.7 - sem vaga agora, mas na fila - nunca tratado como recusa; a promoção automática
        # (com prazo pra confirmar) manda um segundo e-mail quando uma vaga abrir de verdade.
        linha_status = "Não havia vaga disponível no momento - você está na lista de espera e será avisado(a) por e-mail se uma vaga abrir."
    else:
        linha_status = f"Código de check-in: {codigo_checkin}\nApresente este código na entrada do evento."

    return (
        f"Sua inscrição em \"{evento.titulo}\" foi registrada com sucesso.\n\n"
        f"{linha_status}\n\n"
        f"{linha_cancelamento}"
    )


def _validar_respostas_obrigatorias(db: Session, *, id_evento: int, respostas: dict) -> None:
    for pergunta in listar_perguntas(db, id_evento=id_evento):
        if not pergunta.obrigatoria:
            continue
        valor = respostas.get(str(pergunta.id_pergunta))
        if valor is None or valor == "" or valor == []:
            raise HTTPException(status_code=422, detail=f"A pergunta \"{pergunta.enunciado}\" é obrigatória.")


def _dedupicar_pessoa_por_cpf(db: Session, *, nome_completo: str, cpf: str, email: str, telefone: str) -> Pessoa:
    """CPF já conhecido → inscrição vinculada ao cadastro existente, sem pedir dado que o sistema
    já tem (só completa contato que estivesse vazio - nunca sobrescreve o que já tinha). CPF novo
    → pessoa nova com papel "participante_externo", que NUNCA vira associado automaticamente
    (isso continua exigindo o fluxo de filiação de sempre, decisão humana, não um efeito colateral
    de inscrição em evento)."""
    pessoa = db.query(Pessoa).filter(Pessoa.cpf == cpf).first()
    if pessoa:
        if not pessoa.email_contato:
            pessoa.email_contato = email
        if not pessoa.telefone_whatsapp:
            pessoa.telefone_whatsapp = telefone
    else:
        pessoa = Pessoa(nome_completo=nome_completo, cpf=cpf, email_contato=email, telefone_whatsapp=telefone)
        db.add(pessoa)
        db.flush()
        db.add(Papel(id_pessoa=pessoa.id_pessoa, tipo_papel=TIPO_PAPEL_PARTICIPANTE_EXTERNO))
    db.commit()
    db.refresh(pessoa)
    return pessoa


def _inscrever_um_participante(
    db: Session, *, evento: Evento, contexto_tipo: str, id_contexto: int, nome_completo: str, cpf: str,
    email: str, telefone: str, respostas: dict, versao_texto_consentimento: str, identificador_grupo: Optional[str],
    codigo_cupom: Optional[str] = None,
) -> dict:
    _validar_respostas_obrigatorias(db, id_evento=evento.id_evento, respostas=respostas)
    pessoa = _dedupicar_pessoa_por_cpf(db, nome_completo=nome_completo, cpf=cpf, email=email, telefone=telefone)

    codigo_checkin = gerar_codigo_checkin()
    token_cancelamento = gerar_token_cancelamento()
    inscricao_criada = servico_vagas.inscrever_com_controle_de_vaga(
        db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=pessoa.id_pessoa,
        respostas_formulario=respostas or None, codigo_checkin=codigo_checkin,
        token_cancelamento=token_cancelamento, consentimento_lgpd_versao=versao_texto_consentimento,
        identificador_grupo=identificador_grupo,
    )
    titulo_cobranca = _cobrar_inscricao_se_devido(
        db, evento=evento, inscricao=inscricao_criada, id_pessoa=pessoa.id_pessoa, codigo_cupom=codigo_cupom,
    )

    email_enviado = False
    try:
        notificacoes.enviar_email(
            email, assunto=f"Confirmação de inscrição - {evento.titulo}",
            corpo_texto=_texto_email_confirmacao(
                db, evento=evento, codigo_checkin=inscricao_criada.codigo_checkin or codigo_checkin,
                token_cancelamento=inscricao_criada.token_cancelamento or token_cancelamento,
                status=inscricao_criada.status,
            ),
        )
        email_enviado = True
    except Exception:
        # Nunca deixa a inscrição em si falhar por causa do e-mail (SMTP fora do ar, não
        # configurado, etc.) - a inscrição já está gravada, o e-mail é conveniência, não trava.
        # WhatsApp fica pendente pra v11.3 (API oficial Meta Cloud/BSP - ver DECISOES_CONGELADAS.md
        # seção 7), não fingido aqui.
        pass

    return {
        "nome_completo": nome_completo, "id_inscricao": inscricao_criada.id_inscricao,
        "status": inscricao_criada.status, "codigo_checkin": inscricao_criada.codigo_checkin,
        "email_enviado": email_enviado,
        "valor_cobrado": titulo_cobranca.valor_original if titulo_cobranca else None,
    }


def inscrever_publicamente(
    db: Session, *, id_evento: int, id_sessao: Optional[int], nome_completo: str, cpf: str,
    email: str, telefone: str, respostas: dict, versao_texto_consentimento: str,
    participantes_adicionais: Optional[list[dict]] = None, codigo_cupom: Optional[str] = None,
) -> dict:
    """v4.7 - acima do limite de vagas (ou da cota da categoria), vira lista de espera
    automaticamente - nunca um erro pra quem se inscreve. Inscrição em grupo
    (`participantes_adicionais`): CADA nome vira uma inscrição própria, com seu próprio código de
    check-in - "tratamento individual", mesmo raciocínio já usado na reserva recorrente de espaço
    (v4.3): um da família ficar na lista de espera nunca impede os outros de serem confirmados."""
    evento = obter_evento(db, id_evento)
    if evento.visibilidade != "Pública":
        raise HTTPException(status_code=404, detail="Evento não encontrado.")

    versao_atual = obter_configuracao(db, "VERSAO_TEXTO_CONSENTIMENTO_LGPD_INSCRICAO", "1")
    if versao_texto_consentimento != versao_atual:
        raise HTTPException(
            status_code=422,
            detail="O texto de consentimento LGPD foi atualizado - recarregue a página e aceite a versão atual.",
        )

    contexto_tipo = CONTEXTO_SESSAO_EVENTO if id_sessao is not None else CONTEXTO_EVENTO
    id_contexto = id_sessao if id_sessao is not None else id_evento
    if id_sessao is not None:
        obter_sessao(db, id_sessao)

    participantes_adicionais = participantes_adicionais or []
    identificador_grupo = str(uuid.uuid4()) if participantes_adicionais else None

    resultados = [
        _inscrever_um_participante(
            db, evento=evento, contexto_tipo=contexto_tipo, id_contexto=id_contexto, nome_completo=nome_completo,
            cpf=cpf, email=email, telefone=telefone, respostas=respostas,
            versao_texto_consentimento=versao_texto_consentimento, identificador_grupo=identificador_grupo,
            codigo_cupom=codigo_cupom,
        )
    ]
    for participante in participantes_adicionais:
        resultados.append(
            _inscrever_um_participante(
                db, evento=evento, contexto_tipo=contexto_tipo, id_contexto=id_contexto,
                nome_completo=participante["nome_completo"], cpf=participante["cpf"], email=email, telefone=telefone,
                respostas=participante.get("respostas") or {}, versao_texto_consentimento=versao_texto_consentimento,
                identificador_grupo=identificador_grupo, codigo_cupom=codigo_cupom,
            )
        )

    primeiro = resultados[0]
    return {
        "identificador_grupo": identificador_grupo, "participantes": resultados,
        "id_inscricao": primeiro["id_inscricao"], "status": primeiro["status"],
        "codigo_checkin": primeiro["codigo_checkin"], "email_enviado": primeiro["email_enviado"],
        "valor_cobrado": primeiro["valor_cobrado"],
    }
