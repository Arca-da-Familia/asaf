from typing import Optional

from pydantic import BaseModel, field_validator


class ProcessoDissolucaoCriar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 10:
            raise ValueError("Descreva o motivo da dissolução (Art. 31: impossibilidade de manutenção dos objetivos, desvirtuamento de finalidade, ou carência de recursos).")
        return v.strip()


class DeliberarRequest(BaseModel):
    id_deliberacao: int


class LiquidacaoConcluirRequest(BaseModel):
    observacao: str

    @field_validator("observacao")
    @classmethod
    def validar_observacao(cls, v):
        if len(v.strip()) < 10:
            raise ValueError("Descreva como o passivo foi liquidado.")
        return v.strip()


class DestinarPatrimonioRequest(BaseModel):
    entidade_nome: str
    entidade_cnpj: Optional[str] = None
    justificativa: str
    confirma_sede_parauapebas: bool
    confirma_anos_minimos: bool
    confirma_credenciada: bool

    @field_validator("entidade_nome")
    @classmethod
    def validar_nome(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o nome da entidade destinatária.")
        return v.strip()

    @field_validator("justificativa")
    @classmethod
    def validar_justificativa(cls, v):
        if len(v.strip()) < 10:
            raise ValueError("Justifique por que a entidade atende aos critérios do Art. 31, Parágrafo Único.")
        return v.strip()


class BaixaCadastralRequest(BaseModel):
    observacao: str

    @field_validator("observacao")
    @classmethod
    def validar_observacao(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva a baixa cadastral realizada.")
        return v.strip()


class CancelarProcessoRequest(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva o motivo do cancelamento.")
        return v.strip()
