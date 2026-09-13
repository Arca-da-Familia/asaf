from datetime import date
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.validadores import somente_digitos, validar_cpf, validar_data_nascimento_coerente, validar_telefone_br


class PropostaFiliacaoCriar(BaseModel):
    """v1.2 - o que uma pessoa de fora informa ao propor filiação: só o essencial pra
    triagem. Endereço e demais dados do cadastro completo (v1.1) ficam pra secretaria
    preencher na conferência documental, via os mesmos endpoints de edição já existentes."""
    nome_completo: str
    cpf: str
    email_contato: Optional[EmailStr] = None
    telefone_whatsapp: Optional[str] = None
    data_nascimento: Optional[date] = None

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
            raise ValueError("Data de nascimento inválida (não pode ser futura nem implicar idade implausível).")
        return v


class PropostaRecusar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o motivo da recusa.")
        return v.strip()


class PropostaAprovar(BaseModel):
    categoria: str = "Efetivo"
