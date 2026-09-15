from typing import Optional

from pydantic import BaseModel, field_validator, model_validator

from app.models.sessao_assembleia import MODALIDADES_CREDENCIAMENTO


class CredenciarRequest(BaseModel):
    modalidade: str
    token_carteirinha: Optional[str] = None
    id_associado: Optional[int] = None

    @field_validator("modalidade")
    @classmethod
    def validar_modalidade(cls, v):
        if v not in MODALIDADES_CREDENCIAMENTO:
            raise ValueError(f"Modalidade deve ser uma de: {', '.join(sorted(MODALIDADES_CREDENCIAMENTO))}.")
        return v

    @model_validator(mode="after")
    def validar_um_dos_dois(self):
        if bool(self.token_carteirinha) == bool(self.id_associado):
            raise ValueError("Informe token_carteirinha (QR) OU id_associado (busca manual) - exatamente um dos dois.")
        return self


class ItemPautaCriar(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    tempo_fala_minutos: Optional[int] = None
    ordem: int = 0

    @field_validator("titulo")
    @classmethod
    def validar_titulo(cls, v):
        if len(v.strip()) < 2:
            raise ValueError("Informe o título do item de pauta.")
        return v.strip()


class OcorrenciaCriar(BaseModel):
    descricao: str
    id_item_pauta: Optional[int] = None

    @field_validator("descricao")
    @classmethod
    def validar_descricao(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Descreva a ocorrência.")
        return v.strip()
