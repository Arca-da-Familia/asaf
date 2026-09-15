from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.ata import TIPOS_DELIBERACAO
from app.schemas.mandatos import MandatoCriar


class AtaRetificar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva o motivo da retificação.")
        return v.strip()


class DeliberacaoCriar(BaseModel):
    tipo: str
    texto: str
    id_item_pauta: Optional[int] = None
    id_votacao: Optional[int] = None
    id_associado_responsavel: Optional[int] = None
    prazo_execucao: Optional[datetime] = None

    @field_validator("tipo")
    @classmethod
    def validar_tipo(cls, v):
        if v not in TIPOS_DELIBERACAO:
            raise ValueError(f"Tipo deve ser um de: {', '.join(sorted(TIPOS_DELIBERACAO))}.")
        return v

    @field_validator("texto")
    @classmethod
    def validar_texto(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva a deliberação.")
        return v.strip()


class DeliberacaoConcluir(BaseModel):
    observacao: Optional[str] = None
    # Só usado quando a deliberação é do tipo "Eleição" - cria os Mandatos de uma vez (v2.1).
    mandatos_criar: list[MandatoCriar] = []


class DeliberacaoRevogar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva o motivo da revogação.")
        return v.strip()
