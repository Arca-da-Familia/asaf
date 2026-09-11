from pydantic import BaseModel, field_validator
from typing import Optional

class OpcaoCriar(BaseModel):
    valor: str

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Informe um valor.")
        return v.strip()

class OpcaoAtualizar(BaseModel):
    valor: Optional[str] = None
    ativo: Optional[bool] = None
