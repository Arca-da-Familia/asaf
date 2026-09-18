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
