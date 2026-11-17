from typing import Literal, Optional

from pydantic import BaseModel


class MesclarPessoasRequest(BaseModel):
    id_pessoa_absorvida: int
    nome_confirmacao: str
    # v9.5 (Qualidade da base passo a passo, desenho aprovado pelo Presidente): para cada dado que difere entre os dois cadastros, qual fica -
    # "mantida" (o cadastro que fica) ou "absorvida" (o que é juntado a ele). Sem escolha, vale a regra de sempre: fica o da mantida e só o que
    # ela não tem vem da absorvida. Campos aceitos: os da pessoa, "categoria" e "endereco".
    escolhas: Optional[dict[str, Literal["mantida", "absorvida"]]] = None
    # v9.5 (conferência): dois cadastros de ASSOCIADO só se juntam a partir do item pendente da fila de revisão que aponta esse par
    id_fila: Optional[int] = None
    # v9.5 (3ª conferência): a assinatura que a comparação devolveu - se algum valor mudou depois dela, a junção pede para comparar de novo
    assinatura: Optional[str] = None


class MarcarEmailSuspeitoRequest(BaseModel):
    motivo: str
