"""v4.5 (FASE 4) - Evento como entidade única e pontual, com sessões (programação) e edições
recorrentes ligadas entre si. Inscrição reaproveita o motor genérico da v4.0
(`app/services/inscricao.py`) - nenhum mecanismo de inscrição próprio aqui."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.core import Usuario
from app.models.eventos import (
    TIPO_PERGUNTA_SELECAO_MULTIPLA,
    TIPO_PERGUNTA_SELECAO_UNICA,
    Evento,
    PerguntaEvento,
    SessaoEvento,
)
from app.models.espacos import Espaco
from app.models.pessoas import Papel, Pessoa
from app.services import inscricao as servico_inscricao
from app.services import notificacoes
from app.services.catalogos import validar_codigo_em_catalogo
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
    gratuito: bool, visibilidade: str, id_usuario: Optional[int],
) -> Evento:
    validar_codigo_em_catalogo(db, "tipo_evento", categoria, "Categoria do evento")
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
        visibilidade=visibilidade, id_usuario_criacao=id_usuario,
    )
    db.add(evento)
    db.commit()
    db.refresh(evento)
    return evento


def obter_evento(db: Session, id_evento: int) -> Evento:
    evento = db.query(Evento).filter(Evento.id_evento == id_evento).first()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado.")
    return evento


def listar_eventos(db: Session) -> list[Evento]:
    return db.query(Evento).order_by(Evento.data_hora_inicio.desc()).all()


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
    obter_evento(db, id_evento)
    if data_hora_fim is not None and data_hora_fim <= data_hora_inicio:
        raise HTTPException(status_code=422, detail="O fim da sessão precisa ser depois do início.")

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

    nova_edicao = Evento(
        titulo=titulo or anterior.titulo, descricao=anterior.descricao, categoria=anterior.categoria,
        data_hora_inicio=data_hora_inicio, data_hora_fim=data_hora_fim, id_espaco=anterior.id_espaco,
        endereco_avulso=anterior.endereco_avulso, id_associado_responsavel=anterior.id_associado_responsavel,
        vagas=anterior.vagas, gratuito=anterior.gratuito, visibilidade=anterior.visibilidade,
        id_edicao_anterior=anterior.id_evento, id_usuario_criacao=id_usuario,
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
def inscrever_no_evento(db: Session, *, id_evento: int, usuario: Usuario):
    obter_evento(db, id_evento)
    associado = associado_do_usuario_ou_403(db, usuario)
    return servico_inscricao.inscrever(
        db, contexto_tipo=CONTEXTO_EVENTO, id_contexto=id_evento, id_pessoa=associado.id_pessoa,
        respostas_formulario=None, id_usuario_operador=usuario.id_usuario,
    )


def inscrever_na_sessao(db: Session, *, id_sessao: int, usuario: Usuario):
    obter_sessao(db, id_sessao)
    associado = associado_do_usuario_ou_403(db, usuario)
    return servico_inscricao.inscrever(
        db, contexto_tipo=CONTEXTO_SESSAO_EVENTO, id_contexto=id_sessao, id_pessoa=associado.id_pessoa,
        respostas_formulario=None, id_usuario_operador=usuario.id_usuario,
    )


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
# INSCRIÇÃO PÚBLICA COM DEDUPLICAÇÃO (v4.6) - formulário do site, sem login. Rate limiting e
# honeypot são checados no router (antes de chegar aqui); aqui é regra de negócio pura.
# ==========================================
def _texto_email_confirmacao(db: Session, *, evento: Evento, codigo_checkin: str, token_cancelamento: str) -> str:
    url_base = obter_configuracao(db, "URL_BASE_SITE_PUBLICO", "")
    if url_base:
        linha_cancelamento = f"Para cancelar sua inscrição, acesse: {url_base.rstrip('/')}/cancelar-inscricao?token={token_cancelamento}"
    else:
        linha_cancelamento = f"Para cancelar sua inscrição, entre em contato com a secretaria informando o código {codigo_checkin}."
    return (
        f"Sua inscrição em \"{evento.titulo}\" foi registrada com sucesso.\n\n"
        f"Código de check-in: {codigo_checkin}\n"
        f"Apresente este código na entrada do evento.\n\n"
        f"{linha_cancelamento}"
    )


def _validar_respostas_obrigatorias(db: Session, *, id_evento: int, respostas: dict) -> None:
    for pergunta in listar_perguntas(db, id_evento=id_evento):
        if not pergunta.obrigatoria:
            continue
        valor = respostas.get(str(pergunta.id_pergunta))
        if valor is None or valor == "" or valor == []:
            raise HTTPException(status_code=422, detail=f"A pergunta \"{pergunta.enunciado}\" é obrigatória.")


def inscrever_publicamente(
    db: Session, *, id_evento: int, id_sessao: Optional[int], nome_completo: str, cpf: str,
    email: str, telefone: str, respostas: dict, versao_texto_consentimento: str,
) -> dict:
    """CPF já conhecido → inscrição vinculada ao cadastro existente, sem pedir dado que o sistema
    já tem (só completa contato que estivesse vazio - nunca sobrescreve o que já tinha). CPF novo
    → pessoa nova com papel "participante_externo", que NUNCA vira associado automaticamente
    (isso continua exigindo o fluxo de filiação de sempre, decisão humana, não um efeito colateral
    de inscrição em evento)."""
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
    _validar_respostas_obrigatorias(db, id_evento=id_evento, respostas=respostas)

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

    codigo_checkin = gerar_codigo_checkin()
    token_cancelamento = gerar_token_cancelamento()
    inscricao_criada = servico_inscricao.inscrever(
        db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=pessoa.id_pessoa,
        respostas_formulario=respostas or None, codigo_checkin=codigo_checkin,
        token_cancelamento=token_cancelamento, consentimento_lgpd_versao=versao_texto_consentimento,
    )

    email_enviado = False
    try:
        notificacoes.enviar_email(
            email, assunto=f"Confirmação de inscrição - {evento.titulo}",
            corpo_texto=_texto_email_confirmacao(
                db, evento=evento, codigo_checkin=inscricao_criada.codigo_checkin or codigo_checkin,
                token_cancelamento=inscricao_criada.token_cancelamento or token_cancelamento,
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
        "id_inscricao": inscricao_criada.id_inscricao, "status": inscricao_criada.status,
        "codigo_checkin": inscricao_criada.codigo_checkin, "email_enviado": email_enviado,
    }
