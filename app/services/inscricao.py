"""v4.0 (FASE 4) - motor de inscrição genérico: pré-inscrito → confirmado (ou lista de espera,
quando o consumidor controla vaga) → presente/ausente (marcado depois do evento acontecer) ou
cancelado a qualquer momento antes disso. O motor não sabe o que é "vaga cheia" - isso é decisão
de quem chama (v4.7, vagas e lista de espera), o motor só guarda o status que foi decidido."""
import json
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.motores import AUSENTE, CANCELADO, CONFIRMADO, LISTA_DE_ESPERA, PRESENTE, PRE_INSCRITO, STATUS_INSCRICAO, Inscricao
from app.models.pessoas import Pessoa

_TRANSICOES_VALIDAS = {
    PRE_INSCRITO: {CONFIRMADO, LISTA_DE_ESPERA, CANCELADO},
    CONFIRMADO: {CANCELADO, PRESENTE, AUSENTE},
    LISTA_DE_ESPERA: {CONFIRMADO, CANCELADO},
    CANCELADO: {PRE_INSCRITO},
    PRESENTE: set(),
    AUSENTE: set(),
}


def inscrever(
    db: Session, *, contexto_tipo: str, id_contexto: int, id_pessoa: int,
    respostas_formulario: Optional[dict], id_usuario_operador: Optional[int] = None,
) -> Inscricao:
    if not db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first():
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    existente = db.query(Inscricao).filter(
        Inscricao.contexto_tipo == contexto_tipo, Inscricao.id_contexto == id_contexto, Inscricao.id_pessoa == id_pessoa,
    ).first()
    if existente:
        if existente.status != CANCELADO:
            raise HTTPException(status_code=400, detail=f"Esta pessoa já está inscrita neste contexto (status '{existente.status}').")
        existente.status = PRE_INSCRITO
        existente.respostas_formulario = json.dumps(respostas_formulario) if respostas_formulario else None
        existente.data_inscricao = datetime.utcnow()
        db.commit()
        db.refresh(existente)
        return existente

    inscricao = Inscricao(
        contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa, status=PRE_INSCRITO,
        respostas_formulario=json.dumps(respostas_formulario) if respostas_formulario else None,
    )
    db.add(inscricao)
    db.commit()
    db.refresh(inscricao)
    return inscricao


def alterar_status(db: Session, *, id_inscricao: int, novo_status: str) -> Inscricao:
    if novo_status not in STATUS_INSCRICAO:
        raise HTTPException(status_code=400, detail=f"Status inválido - use um de: {', '.join(sorted(STATUS_INSCRICAO))}.")
    inscricao = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao).first()
    if not inscricao:
        raise HTTPException(status_code=404, detail="Inscrição não encontrada.")
    if novo_status not in _TRANSICOES_VALIDAS[inscricao.status]:
        raise HTTPException(status_code=400, detail=f"Não é possível mudar de '{inscricao.status}' para '{novo_status}'.")
    inscricao.status = novo_status
    db.commit()
    db.refresh(inscricao)
    return inscricao


def vincular_cobranca(db: Session, *, id_inscricao: int, id_titulo: int) -> Inscricao:
    inscricao = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao).first()
    if not inscricao:
        raise HTTPException(status_code=404, detail="Inscrição não encontrada.")
    inscricao.id_titulo_cobranca = id_titulo
    db.commit()
    db.refresh(inscricao)
    return inscricao


def listar_inscricoes(db: Session, *, contexto_tipo: str, id_contexto: int) -> list[Inscricao]:
    return (
        db.query(Inscricao)
        .filter(Inscricao.contexto_tipo == contexto_tipo, Inscricao.id_contexto == id_contexto)
        .order_by(Inscricao.data_inscricao)
        .all()
    )
