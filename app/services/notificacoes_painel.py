"""v5.4h - Central de notificações do painel (o "sino"): cria, lista, conta e marca como lida. Quem avisa (a filiação, hoje) chama `notificar`;
cada pessoa só vê e mexe nos avisos dela."""
from datetime import datetime
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.notificacoes_painel import NotificacaoPainel

LIMITE_DA_LISTA = 50


def notificar(db: Session, ids_usuarios: Iterable[int], *, tipo: str, titulo: str, texto: Optional[str] = None, link: Optional[str] = None) -> int:
    """Um aviso para cada usuário (sem repetir o mesmo usuário). Devolve quantos foram criados. Não faz commit: quem chama decide."""
    vistos: set[int] = set()
    for id_usuario in ids_usuarios:
        if id_usuario in vistos:
            continue
        vistos.add(id_usuario)
        db.add(NotificacaoPainel(id_usuario=id_usuario, tipo=tipo, titulo=titulo[:150], texto=(texto or "")[:500] or None, link=link))
    return len(vistos)


def listar_do_usuario(db: Session, id_usuario: int) -> list[NotificacaoPainel]:
    """Mais novas primeiro; as não lidas aparecem antes das lidas."""
    return (
        db.query(NotificacaoPainel).filter(NotificacaoPainel.id_usuario == id_usuario)
        .order_by(NotificacaoPainel.lida_em.isnot(None), NotificacaoPainel.criado_em.desc(), NotificacaoPainel.id_notificacao.desc())
        .limit(LIMITE_DA_LISTA).all()
    )


def contar_nao_lidas(db: Session, id_usuario: int) -> int:
    return db.query(NotificacaoPainel).filter(NotificacaoPainel.id_usuario == id_usuario, NotificacaoPainel.lida_em.is_(None)).count()


def marcar_como_lida(db: Session, id_usuario: int, id_notificacao: int) -> NotificacaoPainel:
    aviso = db.query(NotificacaoPainel).filter(NotificacaoPainel.id_notificacao == id_notificacao, NotificacaoPainel.id_usuario == id_usuario).first()
    if aviso is None:
        raise HTTPException(status_code=404, detail="Aviso não encontrado.")
    if aviso.lida_em is None:
        aviso.lida_em = datetime.utcnow()
        db.commit()
    return aviso


def marcar_todas_como_lidas(db: Session, id_usuario: int) -> int:
    agora = datetime.utcnow()
    n = db.query(NotificacaoPainel).filter(NotificacaoPainel.id_usuario == id_usuario, NotificacaoPainel.lida_em.is_(None)).update({"lida_em": agora})
    db.commit()
    return n


def serializar(a: NotificacaoPainel) -> dict:
    return {
        "id_notificacao": a.id_notificacao, "tipo": a.tipo, "titulo": a.titulo, "texto": a.texto, "link": a.link,
        "criado_em": a.criado_em, "lida": a.lida_em is not None,
    }
