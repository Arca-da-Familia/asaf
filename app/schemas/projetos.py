from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class ProjetoCriar(BaseModel):
    nome_projeto: str
    tipo_foco: str
    necessita_alvara_bombeiros: bool
    data_inicio: datetime
    data_fim_prevista: datetime
    descricao: Optional[str] = None
    tipo_projeto: Optional[str] = None
    id_associado_responsavel: Optional[int] = None
    publico_alvo: Optional[str] = None
    id_centro_custo: Optional[int] = None
    visibilidade: str = "Interna"

    @field_validator("visibilidade")
    @classmethod
    def validar_visibilidade(cls, v):
        if v not in ("Pública", "Interna"):
            raise ValueError("Visibilidade deve ser 'Pública' ou 'Interna'.")
        return v


class ProjetoAlterarStatus(BaseModel):
    status: str


class VoluntarioAlocar(BaseModel):
    id_projeto: int
    id_associado: int
    funcao_desempenhada: str
    turno_data_hora_inicio: Optional[datetime] = None
    turno_data_hora_fim: Optional[datetime] = None
    habilidades_exigidas: Optional[str] = None
    horas_previstas: float = 0.0


class VagaEscalaCriar(BaseModel):
    funcao_desempenhada: str
    turno_data_hora_inicio: datetime
    turno_data_hora_fim: datetime
    habilidades_exigidas: Optional[str] = None
    vagas_disponiveis: int = 1
    horas_previstas: float = 0.0


class TrocaTurnoCriar(BaseModel):
    id_associado_substituto: int
    motivo: Optional[str] = None


class ItemCronogramaCriar(BaseModel):
    tipo: str
    titulo: str
    prazo: datetime
    id_associado_responsavel: Optional[int] = None

    @field_validator("tipo")
    @classmethod
    def validar_tipo(cls, v):
        if v not in ("Marco", "Tarefa"):
            raise ValueError("Tipo deve ser 'Marco' ou 'Tarefa'.")
        return v


class EquipeProjetoCriar(BaseModel):
    id_associado: int
    papel: str


class RelatorioFinalProjetoGerar(BaseModel):
    id_projeto: int
