from typing import Optional

from pydantic import BaseModel, field_validator


class PesquisaSatisfacaoResponder(BaseModel):
    nota: int
    comentario: Optional[str] = None

    @field_validator("nota")
    @classmethod
    def validar_nota(cls, v):
        if v < 0 or v > 10:
            raise ValueError("A nota precisa estar entre 0 e 10.")
        return v
