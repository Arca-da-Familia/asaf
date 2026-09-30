from typing import Optional

from pydantic import BaseModel, field_validator


class TokenPortariaCriar(BaseModel):
    descricao: Optional[str] = None
    horas_validade: int = 48


class CheckinPortariaCriar(BaseModel):
    chave_idempotencia: str
    metodo: str  # "codigo" | "carteirinha"
    codigo: Optional[str] = None
    token_carteirinha: Optional[str] = None
    id_sessao: Optional[int] = None

    @field_validator("chave_idempotencia")
    @classmethod
    def validar_chave(cls, v):
        if len(v.strip()) < 8:
            raise ValueError("chave_idempotencia inválida.")
        return v.strip()


class CheckoutPortariaCriar(BaseModel):
    chave_idempotencia: str
    metodo: str  # "codigo" | "carteirinha"
    codigo: Optional[str] = None
    token_carteirinha: Optional[str] = None
    id_sessao: Optional[int] = None

    @field_validator("chave_idempotencia")
    @classmethod
    def validar_chave(cls, v):
        if len(v.strip()) < 8:
            raise ValueError("chave_idempotencia inválida.")
        return v.strip()
