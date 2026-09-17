from pydantic import BaseModel, field_validator
from datetime import datetime
from decimal import Decimal
from typing import Optional
import re

class PlanoContaCriar(BaseModel):
    codigo_contabil: str
    descricao_conta: str
    tipo: str
    # v3.1 - hierarquia (sintética x analítica): quando informado, esta conta se torna filha da
    # conta de código `codigo_contabil_pai`, que passa a ser sintética (não recebe mais
    # lançamento direto - ver app/services/contabilidade.py::exigir_conta_analitica).
    codigo_contabil_pai: Optional[str] = None

    @field_validator("codigo_contabil")
    @classmethod
    def validar_codigo(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Informe o código contábil.")
        return v.strip()

    @field_validator("codigo_contabil_pai")
    @classmethod
    def validar_codigo_pai(cls, v):
        if v is None:
            return v
        v = v.strip()
        return v or None


class CentroDeCustoCriar(BaseModel):
    codigo: str
    nome: str
    id_projeto: Optional[int] = None

    @field_validator("codigo", "nome")
    @classmethod
    def validar_texto(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Campo obrigatório.")
        return v.strip()


class ContaFinanceiraCriar(BaseModel):
    id_conta: int
    tipo_conta_financeira: str
    banco: Optional[str] = None
    agencia: Optional[str] = None
    numero_conta: Optional[str] = None

    @field_validator("tipo_conta_financeira")
    @classmethod
    def validar_tipo(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Informe o tipo da conta financeira.")
        return v.strip()


class PlanoDeContribuicaoCriar(BaseModel):
    categoria: str
    descricao: str
    periodicidade: str = "Mensal"
    dia_vencimento: int
    cobranca_por_nucleo_familiar: bool = False
    id_conta_contabil: int
    valor_inicial: Decimal

    @field_validator("dia_vencimento")
    @classmethod
    def validar_dia_vencimento(cls, v):
        if not (1 <= v <= 31):
            raise ValueError("Dia de vencimento deve ser entre 1 e 31.")
        return v

    @field_validator("valor_inicial")
    @classmethod
    def validar_valor_inicial(cls, v):
        if v <= 0:
            raise ValueError("O valor deve ser maior que zero.")
        return v


class ReajusteCriar(BaseModel):
    valor: Decimal
    data_vigencia_inicio: datetime
    motivo: str

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("O valor deve ser maior que zero.")
        return v

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o motivo do reajuste.")
        return v.strip()


class IsencaoCriar(BaseModel):
    id_associado: int
    id_plano: Optional[int] = None
    motivo: str
    percentual_desconto: Decimal
    data_inicio: Optional[datetime] = None
    data_fim: Optional[datetime] = None

    @field_validator("percentual_desconto")
    @classmethod
    def validar_percentual(cls, v):
        if not (0 < v <= 100):
            raise ValueError("Percentual de desconto deve ser maior que zero e no máximo 100.")
        return v


class GerarCobrancasRequest(BaseModel):
    competencia: str
    confirmar: bool = False

    @field_validator("competencia")
    @classmethod
    def validar_competencia(cls, v):
        if not re.match(r"^\d{4}-\d{2}$", v):
            raise ValueError("Competência deve estar no formato AAAA-MM.")
        return v


class AplicarCreditoRequest(BaseModel):
    id_credito: int
    id_titulo: int
    id_conta_contabil_adiantamento: int


class TransferenciaCriar(BaseModel):
    id_conta_financeira_origem: int
    id_conta_financeira_destino: int
    valor: Decimal
    historico: str
    id_centro_custo: Optional[int] = None
    data_competencia: Optional[datetime] = None
    comprovante: Optional[str] = None

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("O valor deve ser maior que zero.")
        return v

    @field_validator("historico")
    @classmethod
    def validar_historico(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o histórico da transferência.")
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
    # v3.0 - contrapartida da partida dobrada: a conta do Plano de Contas do outro lado do
    # lançamento (ex.: "Caixa"/"Conta Corrente"); pode ser (e deveria, a partir da v3.1) uma
    # conta com `ContaFinanceira` formal, mas continua aceitando qualquer conta Ativo por
    # compatibilidade com baixas já cadastradas antes da v3.1.
    id_conta_contabil_contrapartida: int
    id_centro_custo: Optional[int] = None
    data_competencia: Optional[datetime] = None
    # v3.1 - comprovante já enviado por `POST /api/comprovantes/` (caminho retornado). Obrigatório
    # quando o tipo de conta do título exige (catálogo `tipo_conta_contabil`, ver
    # app/services/contabilidade.py::exige_comprovante) - checado no endpoint, não aqui, porque
    # depende de uma consulta ao banco.
    comprovante: Optional[str] = None
    # v3.2 - "pagamento a maior (crédito em conta do associado)": obrigatório só quando
    # `valor_pago` > saldo devedor do título - o excedente vira `CreditoAssociado`, contabilizado
    # nesta conta (Passivo - "Adiantamento de Associados"), nunca perdido nem devolvido informal.
    id_conta_contabil_adiantamento: Optional[int] = None

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

class CampanhaDescontoAntecipadoCriar(BaseModel):
    percentual_desconto: Decimal
    quantidade_meses: int
    meses_gatilho: list[int]
    id_conta_contabil_receita_diferida: int
    motivo: Optional[str] = None

    @field_validator("percentual_desconto")
    @classmethod
    def validar_percentual(cls, v):
        if not (0 < v <= 100):
            raise ValueError("Percentual de desconto deve ser maior que zero e no máximo 100.")
        return v

    @field_validator("quantidade_meses")
    @classmethod
    def validar_quantidade_meses(cls, v):
        if not (2 <= v <= 12):
            raise ValueError("Quantidade de meses do bloco deve ser entre 2 e 12.")
        return v

    @field_validator("meses_gatilho")
    @classmethod
    def validar_meses_gatilho(cls, v):
        if not v:
            raise ValueError("Informe ao menos um mês-gatilho.")
        if any(not (1 <= mes <= 12) for mes in v):
            raise ValueError("Mês-gatilho deve ser entre 1 e 12.")
        if len(set(v)) != len(v):
            raise ValueError("Meses-gatilho não podem se repetir.")
        return sorted(set(v))


class GerarCobrancaBlocoRequest(BaseModel):
    id_associado: int
    id_plano_contribuicao: int
    competencia_inicio: str

    @field_validator("competencia_inicio")
    @classmethod
    def validar_competencia(cls, v):
        if not re.match(r"^\d{4}-\d{2}$", v):
            raise ValueError("Competência deve estar no formato AAAA-MM.")
        return v


class ExercicioAbrir(BaseModel):
    ano: int

    @field_validator("ano")
    @classmethod
    def validar_ano(cls, v):
        if v < 2000 or v > 2200:
            raise ValueError("Ano de exercício inválido.")
        return v
