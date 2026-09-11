from pydantic import BaseModel, EmailStr, field_validator
from datetime import date
from typing import Optional
import re

class AssociadoMasterCriar(BaseModel):
    nome_completo: str
    cpf: str
    email_contato: EmailStr
    telefone_whatsapp: str
    categoria: str
    cep: str
    logradouro: str
    numero: str
    bairro: str
    cidade: str
    estado: str
    data_nascimento: Optional[date] = None
    estado_civil: Optional[str] = None
    profissao: Optional[str] = None
    naturalidade: Optional[str] = None

    @field_validator("nome_completo")
    @classmethod
    def validar_nome(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o nome completo.")
        return v.strip()

    @field_validator("cpf")
    @classmethod
    def validar_cpf(cls, v):
        digitos = re.sub(r"\D", "", v)
        if len(digitos) != 11:
            raise ValueError("CPF deve conter 11 dígitos.")
        return digitos

class AssociadoAdminUpdate(BaseModel):
    nome_completo: str
    email_contato: EmailStr
    telefone_whatsapp: str
    categoria: str
    status_arrolamento: str
    cep: str = ""
    logradouro: str = ""
    numero: str = ""
    bairro: str = ""
    cidade: str = ""
    estado: str = ""
    data_nascimento: Optional[date] = None
    estado_civil: Optional[str] = None
    profissao: Optional[str] = None
    naturalidade: Optional[str] = None

class AssociadoPerfilUpdate(BaseModel):
    email_contato: EmailStr
    telefone_whatsapp: str
    logradouro: str
    numero: str
    bairro: str
    cidade: str
    estado: str
    data_nascimento: Optional[date] = None
    estado_civil: Optional[str] = None
    profissao: Optional[str] = None
    naturalidade: Optional[str] = None

class DependenteCriar(BaseModel):
    id_associado_vinculado: int
    grau_parentesco: str

class DependenteAtualizar(BaseModel):
    grau_parentesco: str

class HistoricoCargoCriar(BaseModel):
    titulo_cargo: str
    data_posse: date

class HistoricoCargoEncerrar(BaseModel):
    data_saida: date
