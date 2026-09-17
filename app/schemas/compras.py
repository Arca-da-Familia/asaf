from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator


class DadosBancariosFornecedorCriar(BaseModel):
    id_fornecedor: int
    banco: str
    agencia: str
    conta: str
    tipo_conta: str
    titular: str

    @field_validator("banco", "agencia", "conta", "tipo_conta", "titular")
    @classmethod
    def validar_texto(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Campo obrigatório.")
        return v.strip()


class RejeitarDadosBancariosRequest(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o motivo da rejeição.")
        return v.strip()


class AlcadaAprovacaoCriar(BaseModel):
    valor_minimo: Decimal
    valor_maximo: Optional[Decimal] = None
    cargos_autorizados: list[str]
    exige_dupla_assinatura: bool = False

    @field_validator("valor_minimo")
    @classmethod
    def validar_valor_minimo(cls, v):
        if v < 0:
            raise ValueError("Valor mínimo não pode ser negativo.")
        return v

    @field_validator("cargos_autorizados")
    @classmethod
    def validar_cargos(cls, v):
        if not v:
            raise ValueError("Informe ao menos um cargo autorizado.")
        return v


class DelegacaoAprovacaoCriar(BaseModel):
    id_associado_delegante: int
    id_associado_delegado: int
    data_inicio: Optional[str] = None
    data_fim: str
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Informe o motivo da delegação.")
        return v.strip()


class SolicitacaoCompraCriar(BaseModel):
    descricao: str
    justificativa: Optional[str] = None
    id_fornecedor: Optional[int] = None
    valor_estimado: Decimal
    id_conta_contabil: int
    id_centro_custo: Optional[int] = None

    @field_validator("descricao")
    @classmethod
    def validar_descricao(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe a descrição da compra.")
        return v.strip()

    @field_validator("valor_estimado")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("Valor estimado deve ser maior que zero.")
        return v


class CotacaoCompraCriar(BaseModel):
    id_fornecedor: int
    valor: Decimal
    anexo: Optional[str] = None

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("Valor deve ser maior que zero.")
        return v


class ReprovarSolicitacaoRequest(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o motivo da reprovação.")
        return v.strip()


class ReembolsoDespesaCriar(BaseModel):
    id_associado: int
    descricao: str
    valor: Decimal
    comprovante: str
    id_conta_contabil: int

    @field_validator("descricao")
    @classmethod
    def validar_descricao(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe a descrição da despesa.")
        return v.strip()

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("Valor deve ser maior que zero.")
        return v


class ContaAPagarRecorrenteCriar(BaseModel):
    descricao: str
    valor: Decimal
    id_conta_contabil: int
    id_fornecedor: Optional[int] = None
    dia_vencimento: int

    @field_validator("descricao")
    @classmethod
    def validar_descricao(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe a descrição da conta recorrente.")
        return v.strip()

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("Valor deve ser maior que zero.")
        return v

    @field_validator("dia_vencimento")
    @classmethod
    def validar_dia_vencimento(cls, v):
        if not (1 <= v <= 31):
            raise ValueError("Dia de vencimento deve ser entre 1 e 31.")
        return v


class GerarContasAPagarRequest(BaseModel):
    competencia: str
    confirmar: bool = False

    @field_validator("competencia")
    @classmethod
    def validar_competencia(cls, v):
        import re
        if not re.match(r"^\d{4}-\d{2}$", v):
            raise ValueError("Competência deve estar no formato AAAA-MM.")
        return v
