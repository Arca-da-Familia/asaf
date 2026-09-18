from datetime import datetime
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


class InscricaoPublicaCriar(BaseModel):
    """v4.6 - formulário de inscrição pública (site institucional, sem login). `pagina_web` é o
    campo-armadilha (honeypot): invisível pra gente de verdade (escondido via CSS no site), só
    um robô preenche - quando vem preenchido, a inscrição finge sucesso mas não grava nada (nunca
    revela pro robô que foi pego, senão ele só troca de tática)."""
    nome_completo: str
    cpf: str
    email: EmailStr
    telefone: str
    id_sessao: Optional[int] = None
    respostas: dict[str, Any] = {}
    consentimento_lgpd: bool
    versao_texto_consentimento: str
    pagina_web: Optional[str] = None

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
