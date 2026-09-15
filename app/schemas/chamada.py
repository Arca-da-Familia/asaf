from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.sessao_assembleia import MODALIDADES_CREDENCIAMENTO


class BaterPresencaRequest(BaseModel):
    codigo: str
    modalidade: str

    @field_validator("codigo")
    @classmethod
    def validar_codigo(cls, v):
        if not v.strip():
            raise ValueError("Informe o código de chamada.")
        return v.strip()

    @field_validator("modalidade")
    @classmethod
    def validar_modalidade(cls, v):
        if v not in MODALIDADES_CREDENCIAMENTO:
            raise ValueError(f"Modalidade deve ser uma de: {', '.join(sorted(MODALIDADES_CREDENCIAMENTO))}.")
        return v


class CredenciamentoManualCriar(BaseModel):
    id_associado: int
    modalidade: str

    @field_validator("modalidade")
    @classmethod
    def validar_modalidade(cls, v):
        if v not in MODALIDADES_CREDENCIAMENTO:
            raise ValueError(f"Modalidade deve ser uma de: {', '.join(sorted(MODALIDADES_CREDENCIAMENTO))}.")
        return v


class JustificativaCriar(BaseModel):
    motivo: str
    # Presente só quando quem tem a permissão `governanca` lança em nome de outro associado
    # (achado do usuário: "app pode ter falhado, secretário lança manualmente"). Omitido, é o
    # próprio associado do usuário logado se justificando.
    id_associado: Optional[int] = None

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva o motivo da justificativa.")
        return v.strip()


class JustificativaDecidir(BaseModel):
    aceitar: bool
    motivo_decisao: Optional[str] = None
