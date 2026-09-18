from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class EventoCriar(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    categoria: str
    data_hora_inicio: datetime
    data_hora_fim: Optional[datetime] = None
    id_espaco: Optional[int] = None
    endereco_avulso: Optional[str] = None
    id_associado_responsavel: Optional[int] = None
    vagas: Optional[int] = None
    gratuito: bool = True
    visibilidade: str = "Interna"

    @field_validator("visibilidade")
    @classmethod
    def validar_visibilidade(cls, v):
        if v not in ("Pública", "Interna"):
            raise ValueError("Visibilidade deve ser 'Pública' ou 'Interna'.")
        return v


class SessaoEventoCriar(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    data_hora_inicio: datetime
    data_hora_fim: Optional[datetime] = None
    vagas: Optional[int] = None


class NovaEdicaoEventoCriar(BaseModel):
    data_hora_inicio: datetime
    data_hora_fim: Optional[datetime] = None
    titulo: Optional[str] = None
