from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class EventoCalendarioCriar(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    categoria: str
    data_inicio: datetime
    data_fim: Optional[datetime] = None

    @field_validator("titulo")
    @classmethod
    def validar_titulo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o título do evento.")
        return v.strip()
