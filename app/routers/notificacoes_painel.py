"""v5.4h - O sino do painel: cada pessoa lê e marca como lidos só os avisos dela (ver app/services/notificacoes_painel.py)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.core import Usuario
from app.security import get_current_user
from app.services import notificacoes_painel

router = APIRouter()


@router.get("/api/minhas-notificacoes/", summary="Meus avisos do painel (o sino): os mais novos, os não lidos primeiro, e quantos faltam ler")
def minhas_notificacoes(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return {
        "nao_lidas": notificacoes_painel.contar_nao_lidas(db, usuario.id_usuario),
        "avisos": [notificacoes_painel.serializar(a) for a in notificacoes_painel.listar_do_usuario(db, usuario.id_usuario)],
    }


@router.post("/api/minhas-notificacoes/marcar-todas-lidas", summary="Marcar todos os meus avisos como lidos")
def marcar_todas_lidas(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return {"marcadas": notificacoes_painel.marcar_todas_como_lidas(db, usuario.id_usuario)}


@router.post("/api/minhas-notificacoes/{id_notificacao}/lida", summary="Marcar um aviso meu como lido")
def marcar_lida(id_notificacao: int, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return notificacoes_painel.serializar(notificacoes_painel.marcar_como_lida(db, usuario.id_usuario, id_notificacao))
