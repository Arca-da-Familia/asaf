from pydantic import BaseModel, field_validator


class PrestacaoDeContasCriar(BaseModel):
    ano_exercicio: int

    @field_validator("ano_exercicio")
    @classmethod
    def validar_ano(cls, v):
        if v < 2000 or v > 2200:
            raise ValueError("Ano inválido.")
        return v
