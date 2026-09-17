from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator


class OrcamentoCriar(BaseModel):
    ano: int
    id_conta_contabil: int
    id_centro_custo: Optional[int] = None
    valor_previsto: Decimal
    id_deliberacao: int

    @field_validator("ano")
    @classmethod
    def validar_ano(cls, v):
        if v < 2000 or v > 2200:
            raise ValueError("Ano inválido.")
        return v

    @field_validator("valor_previsto")
    @classmethod
    def validar_valor_previsto(cls, v):
        if v <= 0:
            raise ValueError("Valor previsto precisa ser maior que zero.")
        return v


class ReservaContingenciaCriar(BaseModel):
    id_conta_financeira: int
    regra_uso: str
    valor_minimo: Optional[Decimal] = None
    id_deliberacao: Optional[int] = None

    @field_validator("regra_uso")
    @classmethod
    def validar_regra_uso(cls, v):
        if len(v.strip()) < 10:
            raise ValueError("Descreva a regra de uso da reserva (mínimo 10 caracteres) - nunca fica sem registro de quando pode ser usada.")
        return v.strip()
