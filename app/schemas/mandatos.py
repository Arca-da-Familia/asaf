from datetime import date
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.mandatos import MOTIVOS_ENCERRAMENTO_ANTECIPADO


class MandatoCriar(BaseModel):
    id_associado: int
    orgao_codigo: str
    cargo_codigo: str
    data_inicio: date
    # Opcional: quando omitido, usa DURACAO_MANDATO_ANOS (RegraEstatutaria, v2.0) a partir de data_inicio.
    data_fim_previsto: Optional[date] = None
    ato_origem: Optional[str] = None

    @field_validator("orgao_codigo", "cargo_codigo")
    @classmethod
    def normalizar_codigo(cls, v):
        if not v.strip():
            raise ValueError("Informe o código.")
        return v.strip().upper()


class MandatoEncerrar(BaseModel):
    motivo: str
    referencia_ato: Optional[str] = None

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if v not in MOTIVOS_ENCERRAMENTO_ANTECIPADO:
            raise ValueError(f"Motivo deve ser um de: {', '.join(sorted(MOTIVOS_ENCERRAMENTO_ANTECIPADO))}.")
        return v


class DeclaracaoConflitoInteresseCriar(BaseModel):
    id_associado: int
    descricao: str

    @field_validator("descricao")
    @classmethod
    def validar_descricao(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Descreva o conflito de interesse.")
        return v.strip()
