"""v9.2c (FASE 9) - a PAGINAÇÃO NO SERVIDOR das listas que crescem com o número de pessoas e com os anos.

Padrão (o mesmo para toda lista): com `pagina`, a rota devolve só aquela página, mais recente primeiro, e o total no cabeçalho `X-Total-Count` (o painel lê e
mostra "Página 1 de 8"); sem `pagina`, devolve tudo, como antes, porque algumas telas usam a lista inteira como opções de um seletor. A trava
`tests/test_toda_lista_pagina.py` confere que toda lista do sistema ou pagina ou está registrada com o motivo de não precisar.
"""
from typing import Optional

from fastapi import Query, Response

CABECALHO_DO_TOTAL = "X-Total-Count"
POR_PAGINA_PADRAO = 25
POR_PAGINA_MAXIMO = 200

PAGINA = Query(None, ge=1, description="Com ela, só esta página (a partir de 1); o total vem no cabeçalho X-Total-Count")
POR_PAGINA = Query(POR_PAGINA_PADRAO, ge=1, le=POR_PAGINA_MAXIMO)


def aplicar(consulta, pagina: Optional[int], por_pagina: int, resposta: Response) -> list:
    """A página pedida da consulta (já ordenada), com o total no cabeçalho; sem `pagina`, a consulta inteira."""
    if pagina is None:
        return consulta.all()
    resposta.headers[CABECALHO_DO_TOTAL] = str(consulta.order_by(None).count())
    return consulta.offset((pagina - 1) * por_pagina).limit(por_pagina).all()
