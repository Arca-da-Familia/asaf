from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.governanca import TIPOS_ASSEMBLEIA


class AssembleiaCriar(BaseModel):
    tipo: str
    pauta: str
    data_hora_convocacao: datetime
    local_fisico: Optional[str] = None
    link_remoto: Optional[str] = None

    @field_validator("tipo")
    @classmethod
    def validar_tipo(cls, v):
        if v not in TIPOS_ASSEMBLEIA:
            raise ValueError(f"Tipo deve ser um de: {', '.join(sorted(TIPOS_ASSEMBLEIA))}.")
        return v

    @field_validator("pauta")
    @classmethod
    def validar_pauta(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe a ordem do dia.")
        return v.strip()


class PeticaoConvocacaoCriar(BaseModel):
    pauta_proposta: str

    @field_validator("pauta_proposta")
    @classmethod
    def validar_pauta(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Descreva a pauta proposta.")
        return v.strip()
