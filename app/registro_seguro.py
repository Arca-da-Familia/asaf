"""v7.3d (FASE 7) - o REGISTRO SEGURO das rotinas que rodam no GitHub Actions contra o banco de produção.

O repositório é público e os registros (logs) das execuções podem ser lidos por qualquer pessoa por até 90 dias. Uma rotina que falha imprime o
traceback, e a mensagem de um erro de banco traz os valores da linha (`DETAIL: Key (cpf)=(...) already exists`, `[parameters: ...]`): seria dado pessoal
de produção num lugar público (achado da auditoria de 2026-10-30; até então nada tinha vazado - as rotinas só imprimem contagens).

Com `ASAF_REGISTRO_SEGURO=1` no ambiente (os fluxos de produção ligam), `app/database.py` chama `configurar()`: todo registro de erro (`LOG.exception`) e todo
erro que ninguém capturou saem só com o TIPO do erro e ONDE ele aconteceu (os quadros do código), nunca com a mensagem. Quem precisa do detalhe roda a mesma
rotina na homologação ou olha o registro da API no Azure (privado). A conexão do banco também deixou de pôr os valores nas mensagens (`hide_parameters`)."""
from __future__ import annotations

import logging
import os
import sys
import traceback

AVISO = "a mensagem fica fora do registro: pode trazer dado pessoal"


def sem_valores(tipo, valor, tb) -> str:
    """O traceback com os quadros (arquivo, linha, código) e o tipo do erro - sem a mensagem, nem a das causas encadeadas."""
    quadros = "".join(traceback.format_tb(tb)) if tb is not None else ""
    return f"Traceback (most recent call last):\n{quadros}{tipo.__module__}.{tipo.__qualname__} ({AVISO})"


class FormatoSemValores(logging.Formatter):
    def formatException(self, ei) -> str:  # noqa: N802 - nome do logging
        return sem_valores(*ei)


def ligado() -> bool:
    return os.environ.get("ASAF_REGISTRO_SEGURO", "").strip() == "1"


def configurar() -> None:
    manipulador = logging.StreamHandler(sys.stderr)
    manipulador.setFormatter(FormatoSemValores("%(levelname)s %(name)s: %(message)s"))
    raiz = logging.getLogger()
    raiz.handlers[:] = [manipulador]
    raiz.setLevel(logging.INFO)

    def erro_sem_captura(tipo, valor, tb):
        sys.stderr.write(sem_valores(tipo, valor, tb) + "\n")

    sys.excepthook = erro_sem_captura
