from typing import Literal, Optional

from pydantic import BaseModel


class MesclarPessoasRequest(BaseModel):
    id_pessoa_absorvida: int
    nome_confirmacao: str
    # v9.5 (Qualidade da base passo a passo, desenho aprovado pelo Presidente): para cada dado que difere entre os dois cadastros, qual fica -
    # "mantida" (o cadastro que fica) ou "absorvida" (o que é juntado a ele). Sem escolha, vale a regra de sempre: fica o da mantida e só o que
    # ela não tem vem da absorvida. Campos aceitos: os da pessoa, "categoria" e "endereco".
    escolhas: Optional[dict[str, Literal["mantida", "absorvida"]]] = None


class MarcarEmailSuspeitoRequest(BaseModel):
    motivo: str
