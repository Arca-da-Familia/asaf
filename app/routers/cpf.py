"""v7.3a - "Mostrar o CPF": o CPF completo de um registro, por clique, registrado na Auditoria (app/services/cpf_protegido.py). É POST porque deixa rastro."""
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.core import Usuario
from app.security import get_current_user
from app.services import cpf_protegido

router = APIRouter()


class PedidoDeCpf(BaseModel):
    origem: Literal["associado", "proposta", "doacao", "intencao", "atendimento"]
    id: int


@router.post("/api/cpf/revelar", summary="v7.3a - mostrar o CPF completo de um registro (registrado na Auditoria)")
def revelar_cpf(dados: PedidoDeCpf, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    cpf = cpf_protegido.revelar(db, usuario, dados.origem, dados.id, request.client.host if request.client else None)
    return {"cpf": cpf}
