from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator


class RegistrarEntradaCriar(BaseModel):
    contexto_tipo: str
    id_contexto: int
    id_pessoa: int
    meio_registro: str

    @field_validator("contexto_tipo", "meio_registro")
    @classmethod
    def validar_texto(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Campo obrigatório.")
        return v.strip()


class InscricaoCriar(BaseModel):
    contexto_tipo: str
    id_contexto: int
    id_pessoa: int
    respostas_formulario: Optional[dict] = None


class InscricaoAlterarStatus(BaseModel):
    status: str


class InscricaoVincularCobranca(BaseModel):
    id_titulo: int


class TemplateDocumentoCriar(BaseModel):
    codigo: str
    nome: str
    corpo_texto: str

    @field_validator("codigo")
    @classmethod
    def validar_codigo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Código do template precisa ter ao menos 3 caracteres.")
        return v.strip().upper()


class DocumentoEmitir(BaseModel):
    codigo_template: str
    variaveis: dict
    contexto_tipo: Optional[str] = None
    id_contexto: Optional[int] = None
    id_pessoa: Optional[int] = None


class IndicadorCriar(BaseModel):
    nome: str
    unidade: str
    meta: Optional[Decimal] = None
    periodicidade: str
    contexto_tipo: Optional[str] = None
    id_contexto: Optional[int] = None


class MedicaoIndicadorCriar(BaseModel):
    valor: Decimal
    periodo: str
    fonte: Optional[str] = None


class CompromissoAgendaCriar(BaseModel):
    recurso_tipo: str
    id_recurso: int
    contexto_tipo: str
    id_contexto: int
    data_hora_inicio: datetime
    data_hora_fim: datetime


class VerificarConflitoRequest(BaseModel):
    recurso_tipo: str
    id_recurso: int
    data_hora_inicio: datetime
    data_hora_fim: datetime
    excluir_id_compromisso: Optional[int] = None
