from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.disciplina import PENAS


class ProcessoCriar(BaseModel):
    id_associado: int
    motivo_codigo: str
    descricao: str

    @field_validator("descricao")
    @classmethod
    def validar_descricao(cls, v):
        if len(v.strip()) < 10:
            raise ValueError("Descreva os fatos que motivam o processo.")
        return v.strip()


class DefesaApresentar(BaseModel):
    texto: str

    @field_validator("texto")
    @classmethod
    def validar_texto(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Apresente a defesa.")
        return v.strip()


class ManifestacaoCriar(BaseModel):
    pena_proposta: Optional[str] = None  # None = propõe arquivar, sem pena
    justificativa: Optional[str] = None

    @field_validator("pena_proposta")
    @classmethod
    def validar_pena(cls, v):
        if v is not None and v not in PENAS:
            raise ValueError(f"Pena proposta deve ser uma de: {', '.join(sorted(PENAS))} (ou omitida para propor arquivamento).")
        return v


class DecisaoExecutar(BaseModel):
    texto_decisao: str
    suspensao_dias: Optional[int] = None

    @field_validator("texto_decisao")
    @classmethod
    def validar_texto(cls, v):
        if len(v.strip()) < 10:
            raise ValueError("Fundamente a decisão.")
        return v.strip()

    @field_validator("suspensao_dias")
    @classmethod
    def validar_suspensao_dias(cls, v):
        if v is not None and not (30 <= v <= 365):
            raise ValueError("Suspensão deve ser entre 30 dias e 1 ano (365 dias), conforme Art. 17, II.")
        return v


class HomologarRequest(BaseModel):
    aprovado: bool
    justificativa: str

    @field_validator("justificativa")
    @classmethod
    def validar_justificativa(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Justifique a homologação (ou recusa).")
        return v.strip()
