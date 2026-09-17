from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator


class CampanhaArrecadacaoCriar(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    meta_valor: Decimal
    prazo: Optional[datetime] = None
    id_centro_custo: Optional[int] = None

    @field_validator("titulo")
    @classmethod
    def validar_titulo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o título da campanha.")
        return v.strip()

    @field_validator("meta_valor")
    @classmethod
    def validar_meta(cls, v):
        if v <= 0:
            raise ValueError("Meta deve ser maior que zero.")
        return v


class DoacaoCriar(BaseModel):
    anonima: bool = False
    nome_doador: Optional[str] = None
    documento_doador: Optional[str] = None
    id_associado: Optional[int] = None
    tipo_doacao: str
    recorrente: bool = False
    valor: Decimal
    descricao_bem: Optional[str] = None
    id_campanha: Optional[int] = None
    id_centro_custo_destinacao: Optional[int] = None
    id_conta_contabil: int
    id_conta_contabil_caixa: Optional[int] = None

    @field_validator("tipo_doacao")
    @classmethod
    def validar_tipo(cls, v):
        if v not in ("Monetaria", "Bens"):
            raise ValueError("tipo_doacao precisa ser 'Monetaria' ou 'Bens'.")
        return v

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("Valor deve ser maior que zero.")
        return v


class RemanejamentoDestinacaoCriar(BaseModel):
    id_centro_custo_origem: int
    id_centro_custo_destino: int
    valor: Decimal
    motivo: str

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("Valor deve ser maior que zero.")
        return v

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Informe o motivo do remanejamento.")
        return v.strip()
