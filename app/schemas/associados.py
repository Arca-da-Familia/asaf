from pydantic import BaseModel, EmailStr, field_validator, model_validator
from datetime import date
from typing import Optional

from app.validadores import validar_cpf, validar_data_nascimento_coerente, validar_telefone_br, somente_digitos


def _validar_telefone_campo(v: Optional[str]) -> Optional[str]:
    if v and not validar_telefone_br(v):
        raise ValueError("Telefone inválido - use DDD + número (10 ou 11 dígitos).")
    return v


def _validar_nascimento_campo(v: Optional[date]) -> Optional[date]:
    if not validar_data_nascimento_coerente(v):
        raise ValueError("Data de nascimento inválida (não pode ser futura nem implicar idade implausível).")
    return v


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
    def validar_cpf_campo(cls, v):
        if not validar_cpf(v):
            raise ValueError("CPF inválido (dígito verificador não confere).")
        return somente_digitos(v)

    @field_validator("cep")
    @classmethod
    def validar_cep_formato(cls, v):
        if len(somente_digitos(v)) != 8:
            raise ValueError("CEP deve conter 8 dígitos.")
        return somente_digitos(v)

    _validar_telefone = field_validator("telefone_whatsapp")(classmethod(lambda cls, v: _validar_telefone_campo(v)))
    _validar_nascimento = field_validator("data_nascimento")(classmethod(lambda cls, v: _validar_nascimento_campo(v)))

class AssociadoAdminUpdate(BaseModel):
    """v1.1 - `status_arrolamento` saiu daqui de propósito: categoria deixou de ser coluna
    editável à mão pelo admin, vira função (`recalcular_categoria_associado`, app/services/
    categoria_associado.py) disparada por evento financeiro. Estados que essa função ainda não
    sabe calcular (Suspenso/Desligado) ficam pendentes de fluxo próprio nas versões que os
    tratam de verdade (v1.2 filiação/experiência, v1.4 licença/desligamento) - ver nota nessas
    versões no PLANO_PROJETO.md."""
    nome_completo: str
    email_contato: EmailStr
    telefone_whatsapp: str
    categoria: str
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

    _validar_telefone = field_validator("telefone_whatsapp")(classmethod(lambda cls, v: _validar_telefone_campo(v)))
    _validar_nascimento = field_validator("data_nascimento")(classmethod(lambda cls, v: _validar_nascimento_campo(v)))

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

    _validar_telefone = field_validator("telefone_whatsapp")(classmethod(lambda cls, v: _validar_telefone_campo(v)))
    _validar_nascimento = field_validator("data_nascimento")(classmethod(lambda cls, v: _validar_nascimento_campo(v)))

class DependenteCriar(BaseModel):
    id_associado_vinculado: int
    grau_parentesco: str

class DependenteAtualizar(BaseModel):
    grau_parentesco: str

class DependentePessoaCriar(BaseModel):
    """v1.7 - vincula um dependente por `Pessoa` já existente (`id_pessoa_vinculada`) OU cria uma
    `Pessoa` nova na hora (`nome_completo`/`data_nascimento`) - é assim que um filho menor que
    ainda não tem cadastro nenhum entra no sistema pela primeira vez, sem precisar já ser
    associado."""
    id_pessoa_vinculada: Optional[int] = None
    nome_completo: Optional[str] = None
    data_nascimento: Optional[date] = None
    grau_parentesco: str

    _validar_nascimento = field_validator("data_nascimento")(classmethod(lambda cls, v: _validar_nascimento_campo(v)))

    @model_validator(mode="after")
    def validar_referencia_ou_nome(self):
        # model_validator (não field_validator) de propósito: precisa disparar mesmo quando a
        # chave nem aparece no JSON (os dois campos são opcionais e ficam None por default) -
        # um field_validator em campo com default só roda se o valor vier explícito no corpo.
        if not self.nome_completo and not self.id_pessoa_vinculada:
            raise ValueError("Informe id_pessoa_vinculada (pessoa já existente) ou nome_completo (pessoa nova).")
        return self

class HistoricoCargoCriar(BaseModel):
    titulo_cargo: str
    data_posse: date

class HistoricoCargoEncerrar(BaseModel):
    data_saida: date
