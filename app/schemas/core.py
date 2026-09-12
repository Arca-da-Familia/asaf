from pydantic import BaseModel, field_validator
from typing import Any, Optional

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
    exige_mfa: bool = False


class NivelAcessoAtualizar(BaseModel):
    nome_nivel: Optional[str] = None
    descricao: Optional[str] = None
    is_conselho_fiscal: Optional[bool] = None
    exige_mfa: Optional[bool] = None


class PermissaoCriar(BaseModel):
    modulo: str
    codigo_permissao: str
    descricao: Optional[str] = None


# v0.3.1 - motor genérico de catálogo (ver DECISOES_CONGELADAS.md 1.5).
class CatalogoCriar(BaseModel):
    chave: str
    nome_exibido: str
    descricao: Optional[str] = None
    editavel_pelo_usuario: bool = True

    @field_validator("chave")
    @classmethod
    def validar_chave(cls, v):
        if not v.strip() or not v.replace("_", "").isalnum():
            raise ValueError("Chave deve conter só letras, números e underscore.")
        return v.strip().lower()


class OpcaoCatalogoCriar(BaseModel):
    codigo: str
    rotulo: str
    ordem: int = 0
    ativo: bool = True
    cor: Optional[str] = None
    icone: Optional[str] = None
    id_pai: Optional[int] = None
    metadados: Optional[dict[str, Any]] = None

    @field_validator("codigo")
    @classmethod
    def validar_codigo(cls, v):
        if not v.strip():
            raise ValueError("Informe o código.")
        return v.strip().upper()


# Nunca inclui `codigo`: uma vez criado, o código é estável de propósito (é o que o banco
# referencia) - só o rótulo e os demais atributos de exibição podem ser reescritos.
class OpcaoCatalogoAtualizar(BaseModel):
    rotulo: Optional[str] = None
    ordem: Optional[int] = None
    ativo: Optional[bool] = None
    cor: Optional[str] = None
    icone: Optional[str] = None
    metadados: Optional[dict[str, Any]] = None
