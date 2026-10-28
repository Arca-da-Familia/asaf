from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class BeneficiarioCriar(BaseModel):
    id_pessoa: Optional[int] = None
    nome_completo: Optional[str] = None
    data_nascimento: Optional[datetime] = None
    # v7.1c: o consentimento não vem mais aqui (era uma marca); é o termo assinado, registrado à parte (ConsentimentoDoBeneficiario)

    @model_validator(mode="after")
    def validar_pessoa_ou_nome(self):
        if self.id_pessoa is None and not self.nome_completo:
            raise ValueError("Informe 'id_pessoa' (pessoa já cadastrada) ou 'nome_completo' (nova pessoa).")
        return self


class BeneficiarioAtualizar(BaseModel):
    """v4.10 - edição da tela cross-projeto nova (`Beneficiarios.tsx`). Campos de `Pessoa`
    (nome/nascimento) - nunca o prontuário, que é imutável de propósito (`registrar_atendimento`, sem endpoint de edição). v7.1c: o consentimento saiu daqui
    (era uma marca): é o termo assinado, registrado à parte."""
    nome_completo: Optional[str] = None
    data_nascimento: Optional[datetime] = None


class ConsentimentoDoBeneficiario(BaseModel):
    """v7.1c - o termo de consentimento do atendimento social, assinado pela pessoa atendida ou por um dos pais / o responsável."""
    dado_por: str  # titular ou responsavel
    nome_responsavel: Optional[str] = Field(None, max_length=200)
    vinculo: Optional[str] = None  # mae, pai ou responsavel_legal
    meio: str
    id_documento: Optional[int] = None
    assinado_em: str  # aaaa-mm-dd
    versao_do_termo: str


class EliminarProntuario(BaseModel):
    """v7.1d: o protocolo da solicitação do titular de dados que pede a eliminação (com a identidade validada)."""
    protocolo: str = Field(..., min_length=4, max_length=24)


class RevogarConsentimento(BaseModel):
    motivo: Optional[str] = Field(None, max_length=500)


class BeneficiarioProjetoCriar(BaseModel):
    id_beneficiario: int
    id_projeto: int
    papel: str
    atendimento_por_familia: bool = False


class RegistroAtendimentoCriar(BaseModel):
    relato: str

    @field_validator("relato")
    @classmethod
    def validar_relato(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva o atendimento (mínimo 5 caracteres).")
        return v.strip()


class EncaminhamentoRedeExternaCriar(BaseModel):
    tipo_rede: str
    descricao: str

    @field_validator("descricao")
    @classmethod
    def validar_descricao(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva o encaminhamento (mínimo 5 caracteres).")
        return v.strip()
