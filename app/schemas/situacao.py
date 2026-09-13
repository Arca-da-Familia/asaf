from datetime import date
from typing import Optional

from pydantic import BaseModel, field_validator


class LicencaCriar(BaseModel):
    motivo: str
    data_inicio: date
    data_fim_prevista: date
    documento_referencia: Optional[str] = None

    @field_validator("data_fim_prevista")
    @classmethod
    def validar_fim_apos_inicio(cls, v, info):
        inicio = info.data.get("data_inicio")
        if inicio and v <= inicio:
            raise ValueError("Data de fim prevista precisa ser depois da data de início.")
        return v


class DesligamentoCriar(BaseModel):
    motivo: str
    data_efetiva: date
    documento_referencia: Optional[str] = None


class ReadmissaoCriar(BaseModel):
    cpf: Optional[str] = None
    email_contato: Optional[str] = None
    telefone_whatsapp: Optional[str] = None
