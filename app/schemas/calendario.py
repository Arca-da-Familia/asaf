from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator


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

    @model_validator(mode="after")
    def validar_fim_depois_do_inicio(self):
        if self.data_fim is not None and self.data_fim <= self.data_inicio:
            raise ValueError("O fim do evento precisa ser depois do início.")
        return self
