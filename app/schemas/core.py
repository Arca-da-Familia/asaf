from pydantic import BaseModel, field_validator
from typing import Optional

class OpcaoCriar(BaseModel):
    valor: str

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Informe um valor.")
        return v.strip()

class OpcaoAtualizar(BaseModel):
    valor: Optional[str] = None
    ativo: Optional[bool] = None


class NivelAcessoCriar(BaseModel):
    nome_nivel: str
    descricao: Optional[str] = None
    is_conselho_fiscal: bool = False


class NivelAcessoAtualizar(BaseModel):
    nome_nivel: Optional[str] = None
    descricao: Optional[str] = None
    is_conselho_fiscal: Optional[bool] = None


class PermissaoCriar(BaseModel):
    modulo: str
    codigo_permissao: str
    descricao: Optional[str] = None
