"""v5.6b - corpo das rotas da conta de visitante (público: pedir o código e entrar)."""
from typing import Optional

from pydantic import BaseModel, field_validator


def _email_em_portugues(v) -> str:
    try:
        from email_validator import EmailNotValidError, validate_email

        return validate_email(str(v or "").strip(), check_deliverability=False).normalized
    except EmailNotValidError:
        raise ValueError("Esse e-mail não parece certo: confira se está escrito sem erro.")


class PedirCodigoDeVisitante(BaseModel):
    """`pagina_web` é a armadilha para robôs (um campo que a pessoa nunca vê nem preenche)."""
    email: str
    pagina_web: Optional[str] = None

    @field_validator("email", mode="before")
    @classmethod
    def validar_email(cls, v):
        return _email_em_portugues(v)


class EntrarComCodigo(BaseModel):
    email: str
    codigo: str

    @field_validator("email", mode="before")
    @classmethod
    def validar_email(cls, v):
        return _email_em_portugues(v)

    @field_validator("codigo")
    @classmethod
    def validar_tamanho(cls, v):
        if len(v or "") > 20:
            raise ValueError("O código tem 6 números.")
        return v
