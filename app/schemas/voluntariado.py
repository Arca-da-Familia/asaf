from datetime import date
from typing import Optional

from pydantic import BaseModel, field_validator


class TermoAdesaoCriar(BaseModel):
    atividade: str
    carga_horaria_semanal: float
    local: Optional[str] = None
    data_inicio: date
    data_fim_vigencia: date
    documento_referencia: Optional[str] = None
    autorizacao_responsavel_referencia: Optional[str] = None

    @field_validator("data_fim_vigencia")
    @classmethod
    def validar_fim_apos_inicio(cls, v, info):
        inicio = info.data.get("data_inicio")
        if inicio and v <= inicio:
            raise ValueError("Data de fim de vigência precisa ser depois da data de início.")
        return v

    @field_validator("carga_horaria_semanal")
    @classmethod
    def validar_carga_horaria_positiva(cls, v):
        if v <= 0:
            raise ValueError("Carga horária semanal precisa ser maior que zero.")
        return v


class HorasVoluntariadoCriar(BaseModel):
    data: date
    horas: float
    descricao_atividade: Optional[str] = None
    id_projeto: Optional[int] = None

    @field_validator("horas")
    @classmethod
    def validar_horas_positivas(cls, v):
        if v <= 0:
            raise ValueError("Horas precisam ser maiores que zero.")
        return v


class FuncionarioCriar(BaseModel):
    cargo: str
    id_conta_centro_custo: Optional[int] = None
    data_admissao: date
