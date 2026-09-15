from typing import Optional

from pydantic import BaseModel, field_validator, model_validator

from app.models.votacao import ESCRUTINIOS, OPCOES_RESERVADAS, QUALIFICADA, TIPOS_VOTACAO


class VotacaoAbrir(BaseModel):
    titulo: str
    tipo: str
    escrutinio: str
    opcoes: list[str]
    fracao_qualificada: Optional[str] = None
    considerar_abstencao_na_base: bool = False

    @field_validator("titulo")
    @classmethod
    def validar_titulo(cls, v):
        if len(v.strip()) < 2:
            raise ValueError("Informe o título da votação.")
        return v.strip()

    @field_validator("tipo")
    @classmethod
    def validar_tipo(cls, v):
        if v not in TIPOS_VOTACAO:
            raise ValueError(f"Tipo deve ser um de: {', '.join(sorted(TIPOS_VOTACAO))}.")
        return v

    @field_validator("escrutinio")
    @classmethod
    def validar_escrutinio(cls, v):
        if v not in ESCRUTINIOS:
            raise ValueError(f"Escrutínio deve ser um de: {', '.join(sorted(ESCRUTINIOS))}.")
        return v

    @field_validator("opcoes")
    @classmethod
    def validar_opcoes(cls, v):
        if len(v) < 2:
            raise ValueError("Informe ao menos 2 opções.")
        if any(o in OPCOES_RESERVADAS for o in v):
            raise ValueError(f"Opções {sorted(OPCOES_RESERVADAS)} são reservadas - sempre disponíveis, não precisam ser informadas.")
        if len(set(v)) != len(v):
            raise ValueError("Opções não podem se repetir.")
        return v

    @model_validator(mode="after")
    def validar_fracao_qualificada(self):
        if self.escrutinio == QUALIFICADA and not self.fracao_qualificada:
            raise ValueError("Escrutínio qualificado exige a fração (ex.: '2/3').")
        return self


class VotoRegistrar(BaseModel):
    opcao: str

    @field_validator("opcao")
    @classmethod
    def validar_opcao(cls, v):
        if not v.strip():
            raise ValueError("Informe a opção escolhida.")
        return v.strip()


class ImpugnacaoCriar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Descreva o motivo da impugnação.")
        return v.strip()


class ImpugnacaoResolver(BaseModel):
    resolucao: str

    @field_validator("resolucao")
    @classmethod
    def validar_resolucao(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Descreva a resolução da impugnação.")
        return v.strip()


class ResolverEmpate(BaseModel):
    vencedor: str
    justificativa: str

    @field_validator("justificativa")
    @classmethod
    def validar_justificativa(cls, v):
        if len(v.strip()) < 5:
            raise ValueError("Justifique a resolução do empate.")
        return v.strip()
