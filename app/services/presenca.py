"""v4.0 (FASE 4) - motor de presença/check-in único, consumido por qualquer contexto novo
(projeto/evento desta fase, aula da FASE 14). `Credenciamento` (assembleia, v2.5.3) continua como
está - ver o docstring de `app/models/motores.py` pro porquê."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.motores import RegistroPresenca
from app.models.pessoas import Pessoa


def registrar_entrada(
    db: Session, *, contexto_tipo: str, id_contexto: int, id_pessoa: int, meio_registro: str, id_usuario_operador: Optional[int],
) -> RegistroPresenca:
    if not db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first():
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    aberto = db.query(RegistroPresenca).filter(
        RegistroPresenca.contexto_tipo == contexto_tipo, RegistroPresenca.id_contexto == id_contexto,
        RegistroPresenca.id_pessoa == id_pessoa, RegistroPresenca.hora_saida.is_(None),
    ).first()
    if aberto:
        raise HTTPException(status_code=400, detail="Já existe um registro de presença em aberto (sem saída) para esta pessoa neste contexto.")

    registro = RegistroPresenca(
        contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa,
        meio_registro=meio_registro, id_usuario_operador=id_usuario_operador,
    )
    db.add(registro)
    db.commit()
    db.refresh(registro)
    return registro


def registrar_saida(db: Session, *, id_registro: int, id_usuario_operador: Optional[int]) -> RegistroPresenca:
    registro = db.query(RegistroPresenca).filter(RegistroPresenca.id_registro == id_registro).first()
    if not registro:
        raise HTTPException(status_code=404, detail="Registro de presença não encontrado.")
    if registro.hora_saida is not None:
        raise HTTPException(status_code=400, detail="Este registro já tem saída marcada.")
    registro.hora_saida = datetime.utcnow()
    if id_usuario_operador is not None:
        registro.id_usuario_operador = id_usuario_operador
    db.commit()
    db.refresh(registro)
    return registro


def listar_presencas(db: Session, *, contexto_tipo: str, id_contexto: int) -> list[RegistroPresenca]:
    return (
        db.query(RegistroPresenca)
        .filter(RegistroPresenca.contexto_tipo == contexto_tipo, RegistroPresenca.id_contexto == id_contexto)
        .order_by(RegistroPresenca.hora_entrada)
        .all()
    )
