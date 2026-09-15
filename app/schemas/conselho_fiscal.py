from pydantic import BaseModel, field_validator

from app.models.conselho_fiscal import TIPOS_PARECER


class ParecerCriar(BaseModel):
    ano_exercicio: int
    tipo: str
    texto: str

    @field_validator("ano_exercicio")
    @classmethod
    def validar_ano(cls, v):
        if v < 2013 or v > 2100:  # 2013 = fundação da ASAF (Art. 1º)
            raise ValueError("Ano de exercício inválido.")
        return v

    @field_validator("tipo")
    @classmethod
    def validar_tipo(cls, v):
        if v not in TIPOS_PARECER:
            raise ValueError(f"Tipo deve ser um de: {', '.join(sorted(TIPOS_PARECER))}.")
        return v

    @field_validator("texto")
    @classmethod
    def validar_texto(cls, v):
        if len(v.strip()) < 10:
            raise ValueError("Descreva o parecer.")
        return v.strip()


class QuestionamentoCriar(BaseModel):
    pergunta: str

    @field_validator("pergunta")
    @classmethod
    def validar_pergunta(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva o questionamento.")
        return v.strip()


class RespostaCriar(BaseModel):
    texto: str

    @field_validator("texto")
    @classmethod
    def validar_texto(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Escreva a resposta.")
        return v.strip()
