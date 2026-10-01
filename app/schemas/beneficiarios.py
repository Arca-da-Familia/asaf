from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator


class BeneficiarioCriar(BaseModel):
    id_pessoa: Optional[int] = None
    nome_completo: Optional[str] = None
    data_nascimento: Optional[datetime] = None
    consentimento_lgpd_registrado: bool = False
    observacao_consentimento: Optional[str] = None

    @model_validator(mode="after")
    def validar_pessoa_ou_nome(self):
        if self.id_pessoa is None and not self.nome_completo:
            raise ValueError("Informe 'id_pessoa' (pessoa já cadastrada) ou 'nome_completo' (nova pessoa).")
        return self


class BeneficiarioAtualizar(BaseModel):
    """v4.10 - edição da tela cross-projeto nova (`Beneficiarios.tsx`). Campos de `Pessoa`
    (nome/nascimento) e os dois campos próprios de `Beneficiario` (consentimento) - nunca o
    prontuário, que é imutável de propósito (`registrar_atendimento`, sem endpoint de edição)."""
    nome_completo: Optional[str] = None
    data_nascimento: Optional[datetime] = None
    consentimento_lgpd_registrado: Optional[bool] = None
    observacao_consentimento: Optional[str] = None


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
