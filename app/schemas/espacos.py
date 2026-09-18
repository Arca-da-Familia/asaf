from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator


class EspacoCriar(BaseModel):
    nome: str
    tipo: str
    capacidade: Optional[int] = None
    recursos_disponiveis: Optional[str] = None
    regras_uso: Optional[str] = None
    horario_funcionamento_inicio: Optional[str] = None
    horario_funcionamento_fim: Optional[str] = None
    exige_aprovacao: bool = False
    valor_reserva: Optional[Decimal] = None
    isento_para_associado_adimplente: bool = True
    id_conta_contabil_receita: Optional[int] = None
    prazo_cancelamento_horas: int = 24
    taxa_cancelamento_tardio: Optional[Decimal] = None
    limite_no_show_bloqueio: Optional[int] = None

    @field_validator("nome")
    @classmethod
    def validar_nome(cls, v):
        if len(v.strip()) < 2:
            raise ValueError("Informe o nome do espaço.")
        return v.strip()


class BloqueioEspacoCriar(BaseModel):
    data_hora_inicio: datetime
    data_hora_fim: datetime
    motivo: str
    descricao: Optional[str] = None


class ReservaCriar(BaseModel):
    id_espaco: int
    id_associado_solicitante: int
    data_hora_inicio: datetime
    data_hora_fim: datetime
    finalidade: str

    @field_validator("finalidade")
    @classmethod
    def validar_finalidade(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Descreva a finalidade da reserva.")
        return v.strip()


class ReservaRecorrenteCriar(BaseModel):
    id_espaco: int
    id_associado_solicitante: int
    data_hora_inicio: datetime
    data_hora_fim: datetime
    finalidade: str
    quantidade_semanas: int

    @field_validator("quantidade_semanas")
    @classmethod
    def validar_quantidade(cls, v):
        if v < 2:
            raise ValueError("Reserva recorrente exige pelo menos 2 semanas - para uma única data, use a reserva simples.")
        return v


class ReservaRecusar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o motivo.")
        return v.strip()


class ReservaCancelar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o motivo do cancelamento.")
        return v.strip()


class RegistrarRetirada(BaseModel):
    condicao_retirada: str


class RegistrarDevolucao(BaseModel):
    condicao_devolucao: str
    houve_avaria: bool = False
    descricao_avaria: Optional[str] = None
