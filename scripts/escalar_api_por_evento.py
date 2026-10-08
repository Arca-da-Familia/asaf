"""Decide quantas réplicas MÍNIMAS a API precisa ter agora: 1 perto de um evento (a API não dorme, ninguém espera ela acordar na hora de inscrever ou de fazer o
check-in), 0 no resto do tempo (a API escala a zero para não custar sem uso: decisão de custo do plano).

    python scripts/escalar_api_por_evento.py --api-url https://api.asaf.org.br --saida decisao.json

Só DECIDE (lê a lista pública de eventos e escreve a decisão); quem aplica é o fluxo `escalar-api-em-dia-de-evento.yml`, que só mexe nesse número. A regra é uma
função pura (`decidir`), testada sem rede. Se a API não responder, a decisão é MANTER como está: um erro de leitura nunca liga nem desliga nada.

Janela de um evento: de 24 horas ANTES do começo (a abertura das inscrições e o dia anterior costumam concentrar o acesso) até 12 horas DEPOIS do fim (ou do
começo, se o evento não tem fim: o check-in, o certificado, a lista de presença)."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ANTES_DO_EVENTO = timedelta(hours=24)
DEPOIS_DO_EVENTO = timedelta(hours=12)
FUSO_DOS_EVENTOS = ZoneInfo("America/Sao_Paulo")  # a API entrega o horário local do evento, sem fuso (mesmo fuso do sistema: FUSO_HORARIO)
MANTER = None


@dataclass(frozen=True)
class Decisao:
    minimo: int | None  # None = manter como está
    motivo: str


def _local(texto: str) -> datetime | None:
    try:
        return datetime.fromisoformat(texto).replace(tzinfo=FUSO_DOS_EVENTOS)
    except (TypeError, ValueError):
        return None


def decidir(eventos: list[dict], agora: datetime) -> Decisao:
    """1 se algum evento público está na janela; 0 caso contrário. `agora` precisa ter fuso."""
    for evento in eventos:
        inicio = _local(evento.get("data_hora_inicio", ""))
        if inicio is None:
            continue
        fim = _local(evento.get("data_hora_fim") or "") or inicio
        if inicio - ANTES_DO_EVENTO <= agora <= fim + DEPOIS_DO_EVENTO:
            titulo = str(evento.get("titulo", "evento"))[:60]
            return Decisao(1, f"o evento «{titulo}» começa em {inicio:%d/%m/%Y %H:%M}: a API fica ligada de 24 h antes até 12 h depois")
    return Decisao(0, "nenhum evento público nas próximas 24 horas nem nas últimas 12: a API pode dormir")


def ler_eventos(api_url: str, tempo: float = 60.0) -> list[dict]:
    pedido = urllib.request.Request(f"{api_url.rstrip('/')}/api/publico/eventos", headers={"Accept": "application/json"})
    with urllib.request.urlopen(pedido, timeout=tempo) as resposta:  # noqa: S310 - endereço fixo passado pelo fluxo
        dados = json.loads(resposta.read().decode("utf-8"))
    if not isinstance(dados, list):
        raise ValueError("a lista de eventos não veio como lista")
    return dados


def main() -> int:
    parser = argparse.ArgumentParser(description="Decide as réplicas mínimas da API por evento.")
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--saida", default="")
    parser.add_argument("--forcar", choices=["", "0", "1"], default="", help="ignora os eventos e decide este número (teste do mecanismo na homologação)")
    args = parser.parse_args()

    if args.forcar:
        decisao = Decisao(int(args.forcar), f"decisão forçada à mão: {args.forcar}")
    else:
        try:
            eventos = ler_eventos(args.api_url)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as erro:
            decisao = Decisao(MANTER, f"não consegui ler os eventos ({type(erro).__name__}): mantém como está")
        else:
            decisao = decidir(eventos, datetime.now(timezone.utc))
    resultado = {"minimo": decisao.minimo, "manter": decisao.minimo is None, "motivo": decisao.motivo}
    print(json.dumps(resultado, ensure_ascii=False))
    if args.saida:
        with open(args.saida, "w", encoding="utf-8") as arquivo:
            json.dump(resultado, arquivo, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
