"""v8.4a (FASE 8) - o exame de saúde da API, de verdade (não um 200 fixo), ligado às sondas do Container App e ao monitor externo.

- `/health/live`: o processo está vivo e respondendo. É a sonda de VIDA do Container App: se falhar várias vezes, o Azure reinicia a cópia. Não confere banco nem
  armazenamento de propósito: com o banco fora do ar, reiniciar a API não ajuda e só a faria entrar em ciclo de reinício (a causa do incidente de crash-loop
  da FASE 0).
- `/health/ready` (e `/health`, o mesmo exame, para o monitor): o banco responde (`SELECT 1`) e o armazenamento grava, lê e apaga uma sonda. É a sonda de
  PRONTIDÃO: enquanto falhar, o Azure não manda pedidos para aquela cópia. 503 quando algo falha, dizendo O QUÊ (banco ou armazenamento), nunca o erro em si
  (o detalhe fica no registro privado do servidor).
O resultado do armazenamento vale por 5 minutos (a sonda escreve um arquivo; a sonda de prontidão roda a cada 30 segundos)."""
from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter()
LOG = logging.getLogger(__name__)

SEGUNDOS_DO_ARMAZENAMENTO = 300
_ultimo_armazenamento: dict = {"quando": 0.0, "ok": False}


def _banco_ok() -> bool:
    from app.database import engine

    try:
        with engine.connect() as conexao:
            conexao.execute(text("SELECT 1"))
        return True
    except Exception:
        LOG.exception("Exame de saúde: o banco não respondeu")
        return False


def _armazenamento_ok(agora: Optional[float] = None) -> bool:
    agora = agora if agora is not None else time.monotonic()
    if _ultimo_armazenamento["ok"] and agora - _ultimo_armazenamento["quando"] < SEGUNDOS_DO_ARMAZENAMENTO:
        return True
    from app.services import armazenamento

    try:
        armazenamento.obter().verificar()
        ok = True
    except Exception:
        LOG.exception("Exame de saúde: o armazenamento não respondeu")
        ok = False
    _ultimo_armazenamento.update(quando=agora, ok=ok)
    return ok


def _exame() -> JSONResponse:
    banco, arquivos = _banco_ok(), _armazenamento_ok()
    corpo = {"status": "ok" if banco and arquivos else "falha", "banco": "ok" if banco else "falha", "armazenamento": "ok" if arquivos else "falha"}
    return JSONResponse(corpo, status_code=200 if banco and arquivos else 503, headers={"Cache-Control": "no-store"})


@router.get("/health/live", summary="v8.4a - a API está viva (sonda de vida do Container App; não confere banco nem armazenamento)")
def vivo():
    return JSONResponse({"status": "ok"}, headers={"Cache-Control": "no-store"})


@router.get("/health/ready", summary="v8.4a - a API está pronta: o banco responde e o armazenamento grava e lê (sonda de prontidão; 503 se não)")
def pronto():
    return _exame()


@router.get("/health", summary="v8.4a - o exame de saúde completo (o mesmo de /health/ready), para o monitor externo")
def saude():
    return _exame()
