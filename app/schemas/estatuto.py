from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class RegraEstatutariaReformar(BaseModel):
    """v2.0 - o que uma reforma de estatuto informa ao alterar um parâmetro: o novo valor é
    obrigatório, o resto é opcional e herda da linha vigente quando omitido (ver
    `app.services.estatuto.reformar_regra`)."""
    valor: str
    artigo_origem: Optional[str] = None
    descricao: Optional[str] = None
    id_documento_estatuto: Optional[int] = None

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if not v.strip():
            raise ValueError("Informe o novo valor do parâmetro.")
        return v.strip()


class DocumentoEstatutoCriar(BaseModel):
    versao: str
    numero_registro_cartorio: str
    comarca_registro: Optional[str] = None
    data_registro: Optional[date] = None

    @field_validator("versao", "numero_registro_cartorio")
    @classmethod
    def validar_obrigatorio(cls, v):
        if not v.strip():
            raise ValueError("Campo obrigatório.")
        return v.strip()
