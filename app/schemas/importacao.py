from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.validadores import somente_digitos, validar_cpf, validar_data_nascimento_coerente, validar_telefone_br


class LinhaVerificarDuplicidade(BaseModel):
    nome_completo: str
    cpf: str
    data_nascimento: Optional[date] = None


class VerificarDuplicidadeRequest(BaseModel):
    linhas: List[LinhaVerificarDuplicidade]


class LinhaImportar(BaseModel):
    """v1.3 - uma linha já mapeada e revisada pelo assistente (front resolveu a duplicidade
    antes de mandar pra cá: `resolucao` diz o que fazer com esta linha específica)."""
    nome_completo: str
    cpf: str
    email_contato: Optional[EmailStr] = None
    telefone_whatsapp: Optional[str] = None
    data_nascimento: Optional[date] = None
    categoria: str = "Efetivo"
    resolucao: Literal["nova", "ignorar"] = "nova"

    @field_validator("nome_completo")
    @classmethod
    def validar_nome(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o nome completo.")
        return v.strip()

    @field_validator("cpf")
    @classmethod
    def validar_cpf_campo(cls, v):
        if not validar_cpf(v):
            raise ValueError("CPF inválido (dígito verificador não confere).")
        return somente_digitos(v)

    @field_validator("telefone_whatsapp")
    @classmethod
    def validar_telefone_campo(cls, v):
        if v and not validar_telefone_br(v):
            raise ValueError("Telefone inválido - use DDD + número (10 ou 11 dígitos).")
        return v

    @field_validator("data_nascimento")
    @classmethod
    def validar_nascimento_campo(cls, v):
        if not validar_data_nascimento_coerente(v):
            raise ValueError("Data de nascimento inválida.")
        return v


class ImportarLoteRequest(BaseModel):
    linhas: List[LinhaImportar]
