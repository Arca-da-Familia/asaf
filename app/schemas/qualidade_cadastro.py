from pydantic import BaseModel


class MesclarPessoasRequest(BaseModel):
    id_pessoa_absorvida: int
    nome_confirmacao: str


class MarcarEmailSuspeitoRequest(BaseModel):
    motivo: str
