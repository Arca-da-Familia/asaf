from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.models.eventos import TIPOS_PERGUNTA_EVENTO
from app.validadores import somente_digitos, validar_cpf, validar_telefone_br


class EventoCriar(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    categoria: str
    data_hora_inicio: datetime
    data_hora_fim: Optional[datetime] = None
    id_espaco: Optional[int] = None
    endereco_avulso: Optional[str] = None
    id_associado_responsavel: Optional[int] = None
    vagas: Optional[int] = None
    gratuito: bool = True
    visibilidade: str = "Interna"

    @field_validator("visibilidade")
    @classmethod
    def validar_visibilidade(cls, v):
        if v not in ("Pública", "Interna"):
            raise ValueError("Visibilidade deve ser 'Pública' ou 'Interna'.")
        return v


class SessaoEventoCriar(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    data_hora_inicio: datetime
    data_hora_fim: Optional[datetime] = None
    vagas: Optional[int] = None


class NovaEdicaoEventoCriar(BaseModel):
    data_hora_inicio: datetime
    data_hora_fim: Optional[datetime] = None
    titulo: Optional[str] = None


class PerguntaEventoCriar(BaseModel):
    enunciado: str
    tipo: str
    opcoes: Optional[str] = None  # CSV - obrigatório (validado no service) pra tipos de seleção
    obrigatoria: bool = True
    ordem: int = 0

    @field_validator("tipo")
    @classmethod
    def validar_tipo(cls, v):
        if v not in TIPOS_PERGUNTA_EVENTO:
            raise ValueError(f"Tipo de pergunta inválido - use um de: {', '.join(sorted(TIPOS_PERGUNTA_EVENTO))}.")
        return v


class ParticipanteAdicionalCriar(BaseModel):
    """v4.7 - inscrição em grupo (família/delegação): cada participante adicional vira uma
    inscrição própria (código de check-in individual), compartilhando e-mail/telefone/
    consentimento do pedido principal - só nome/CPF/respostas são por pessoa."""
    nome_completo: str
    cpf: str
    respostas: dict[str, Any] = {}

    @field_validator("cpf")
    @classmethod
    def validar_cpf_campo(cls, v):
        if not validar_cpf(v):
            raise ValueError("CPF inválido (dígito verificador não confere).")
        return somente_digitos(v)


class InscricaoPublicaCriar(BaseModel):
    """v4.6 - formulário de inscrição pública (site institucional, sem login). `pagina_web` é o
    campo-armadilha (honeypot): invisível pra gente de verdade (escondido via CSS no site), só
    um robô preenche - quando vem preenchido, a inscrição finge sucesso mas não grava nada (nunca
    revela pro robô que foi pego, senão ele só troca de tática).

    v4.7 - `participantes_adicionais` é a inscrição em grupo: o pedido principal (nome/cpf/
    respostas acima) é o primeiro participante, cada item de `participantes_adicionais` é mais
    um - telefone/e-mail/consentimento são sempre do pedido como um todo (uma família, um
    contato)."""
    nome_completo: str
    cpf: str
    email: EmailStr
    telefone: str
    id_sessao: Optional[int] = None
    respostas: dict[str, Any] = {}
    participantes_adicionais: list[ParticipanteAdicionalCriar] = []
    consentimento_lgpd: bool
    versao_texto_consentimento: str
    pagina_web: Optional[str] = None
    codigo_cupom: Optional[str] = None  # v4.9 - cupom de desconto (opcional, evento pago)

    @field_validator("cpf")
    @classmethod
    def validar_cpf_campo(cls, v):
        if not validar_cpf(v):
            raise ValueError("CPF inválido (dígito verificador não confere).")
        return somente_digitos(v)

    @field_validator("telefone")
    @classmethod
    def validar_telefone_campo(cls, v):
        if not validar_telefone_br(v):
            raise ValueError("Telefone inválido - use DDD + número (10 ou 11 dígitos).")
        return somente_digitos(v)

    @field_validator("consentimento_lgpd")
    @classmethod
    def exigir_consentimento(cls, v):
        if not v:
            raise ValueError("É necessário aceitar o termo de consentimento LGPD para se inscrever.")
        return v


class CotaInscricaoCriar(BaseModel):
    categoria: str
    vagas_limite: int


class EventoElegibilidadeConfig(BaseModel):
    """v4.8 - sobrescrita por evento da regra de elegibilidade ao certificado. `None` explícito
    em qualquer campo volta a usar o padrão global (`ConfiguracaoInstitucional`)."""
    percentual_minimo: Optional[Decimal] = None
    carga_horaria_horas: Optional[Decimal] = None


class EventoCobrancaConfig(BaseModel):
    """v4.9 - cobrança de inscrição. `valor_base=None` volta o evento a gratuito de fato."""
    valor_base: Optional[Decimal] = None
    id_conta_contabil_receita: Optional[int] = None
    id_centro_custo: Optional[int] = None


class EventoReembolsoConfig(BaseModel):
    """v4.9 - política de reembolso por cancelamento deste evento. `percentual_reembolso_
    cancelamento=None` usa o padrão global (`PERCENTUAL_REEMBOLSO_CANCELAMENTO_PADRAO`)."""
    prazo_cancelamento_horas: int = 24
    percentual_reembolso_cancelamento: Optional[Decimal] = None


class FaixaPrecoEventoCriar(BaseModel):
    categoria: str
    valor: Decimal
    data_vigencia_inicio: Optional[datetime] = None
    data_vigencia_fim: Optional[datetime] = None

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if v < 0:
            raise ValueError("Valor não pode ser negativo.")
        return v


class CupomDescontoCriar(BaseModel):
    codigo: str
    tipo_desconto: str
    valor_desconto: Decimal
    limite_uso: Optional[int] = None
    data_vigencia_inicio: Optional[datetime] = None
    data_vigencia_fim: Optional[datetime] = None


class IsencaoTaxaCriar(BaseModel):
    id_pessoa: int
    motivo: str
    percentual_isencao: Decimal
