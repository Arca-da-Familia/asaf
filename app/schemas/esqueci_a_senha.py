"""Esqueci a minha senha (ver app/services/esqueci_a_senha.py)."""
from pydantic import BaseModel, Field


class PedirCodigoDeNovaSenha(BaseModel):
    cpf: str = Field(..., max_length=20)


class TrocarSenhaPeloCodigo(BaseModel):
    cpf: str = Field(..., max_length=20)
    codigo: str = Field(..., max_length=20)
    senha_nova: str = Field(..., max_length=200)
