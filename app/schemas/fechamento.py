from decimal import Decimal

from pydantic import BaseModel, field_validator


class FechamentoMensalCriar(BaseModel):
    competencia: str
    id_conta_financeira: int
    saldo_extrato_bancario: Decimal

    @field_validator("competencia")
    @classmethod
    def validar_competencia(cls, v):
        partes = v.split("-")
        if len(partes) != 2 or len(partes[0]) != 4 or not partes[0].isdigit() or not partes[1].isdigit():
            raise ValueError("Competência inválida - use o formato AAAA-MM.")
        return v
