from pydantic import BaseModel, field_validator
from datetime import datetime
from decimal import Decimal
from typing import Optional
import re

class PlanoContaCriar(BaseModel):
    codigo_contabil: str
    descricao_conta: str
    tipo: str

    @field_validator("codigo_contabil")
    @classmethod
    def validar_codigo(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Informe o código contábil.")
        return v.strip()

class FornecedorCriar(BaseModel):
    razao_social: str
    cnpj: str
    categoria_servico: str
    telefone: str

    @field_validator("cnpj")
    @classmethod
    def validar_cnpj(cls, v):
        digitos = re.sub(r"\D", "", v)
        if len(digitos) != 14:
            raise ValueError("CNPJ deve conter 14 dígitos.")
        return digitos

class TituloCriar(BaseModel):
    tipo_titulo: str
    id_conta_contabil: int
    id_associado: Optional[int] = None
    id_fornecedor: Optional[int] = None
    descricao: str
    valor_original: Decimal
    data_vencimento: datetime

    @field_validator("valor_original")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("O valor deve ser maior que zero.")
        return v

class BaixarTitulo(BaseModel):
    id_titulo: int
    valor_pago: Decimal
    forma_pagamento: str
    # v3.0 - contrapartida da partida dobrada simplificada: a conta do Plano de Contas do outro
    # lado do lançamento (ex.: "Caixa"/"Conta Corrente") - até a v3.1 criar `ContaFinanceira`
    # formal, a diretoria cadastra essa conta como qualquer outra no Plano de Contas.
    id_conta_contabil_contrapartida: int

    @field_validator("valor_pago")
    @classmethod
    def validar_valor_pago(cls, v):
        if v <= 0:
            raise ValueError("O valor pago deve ser maior que zero.")
        return v

class EstornoCriar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Informe o motivo do estorno (mínimo 5 caracteres).")
        return v.strip()

class ExercicioAbrir(BaseModel):
    ano: int

    @field_validator("ano")
    @classmethod
    def validar_ano(cls, v):
        if v < 2000 or v > 2200:
            raise ValueError("Ano de exercício inválido.")
        return v
