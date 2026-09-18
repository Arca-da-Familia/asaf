"""v4.0 (FASE 4) - motor de agenda/conflito: verificação de sobreposição de horário escrita uma
vez, reutilizada por reserva de espaço (v4.3), aula (FASE 14) e evento (v4.5) - regra de conflito
nunca reimplementada em cada consumidor. Sobreposição real (não só "mesmo horário exato"): dois
intervalos colidem quando um começa antes do outro terminar E termina depois do outro começar."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.motores import CompromissoAgenda


def verificar_conflito(
    db: Session, *, recurso_tipo: str, id_recurso: int, data_hora_inicio: datetime, data_hora_fim: datetime,
    excluir_id_compromisso: Optional[int] = None,
) -> list[CompromissoAgenda]:
    if data_hora_fim <= data_hora_inicio:
        raise HTTPException(status_code=400, detail="Data/hora de fim precisa ser depois da de início.")

    consulta = db.query(CompromissoAgenda).filter(
        CompromissoAgenda.recurso_tipo == recurso_tipo, CompromissoAgenda.id_recurso == id_recurso,
        CompromissoAgenda.data_hora_inicio < data_hora_fim, CompromissoAgenda.data_hora_fim > data_hora_inicio,
    )
    if excluir_id_compromisso is not None:
        consulta = consulta.filter(CompromissoAgenda.id_compromisso != excluir_id_compromisso)
    return consulta.all()


def criar_compromisso(
    db: Session, *, recurso_tipo: str, id_recurso: int, contexto_tipo: str, id_contexto: int,
    data_hora_inicio: datetime, data_hora_fim: datetime, id_usuario: Optional[int],
) -> CompromissoAgenda:
    conflitos = verificar_conflito(db, recurso_tipo=recurso_tipo, id_recurso=id_recurso, data_hora_inicio=data_hora_inicio, data_hora_fim=data_hora_fim)
    if conflitos:
        raise HTTPException(
            status_code=400,
            detail=f"Conflito de agenda: já existe compromisso para '{recurso_tipo}' #{id_recurso} nesse horário (compromisso #{conflitos[0].id_compromisso}).",
        )
    compromisso = CompromissoAgenda(
        recurso_tipo=recurso_tipo, id_recurso=id_recurso, contexto_tipo=contexto_tipo, id_contexto=id_contexto,
        data_hora_inicio=data_hora_inicio, data_hora_fim=data_hora_fim, id_usuario_registro=id_usuario,
    )
    db.add(compromisso)
    db.commit()
    db.refresh(compromisso)
    return compromisso


def listar_compromissos(db: Session, *, recurso_tipo: str, id_recurso: int) -> list[CompromissoAgenda]:
    return (
        db.query(CompromissoAgenda)
        .filter(CompromissoAgenda.recurso_tipo == recurso_tipo, CompromissoAgenda.id_recurso == id_recurso)
        .order_by(CompromissoAgenda.data_hora_inicio)
        .all()
    )
