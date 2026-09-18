"""v4.5 (FASE 4) - Evento como entidade única e pontual, com sessões (programação) e edições
recorrentes ligadas entre si. Inscrição reaproveita o motor genérico da v4.0
(`app/services/inscricao.py`) - nenhum mecanismo de inscrição próprio aqui."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.core import Usuario
from app.models.eventos import Evento, SessaoEvento
from app.models.espacos import Espaco
from app.services import inscricao as servico_inscricao
from app.services.catalogos import validar_codigo_em_catalogo
from app.services.projetos import associado_do_usuario_ou_403

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
