"""v8.4a (FASE 8) - liga as sondas (probes) da API no Container App: VIDA em /health/live (reinicia a cópia que travou), PRONTIDÃO em /health/ready (não manda
pedidos à cópia sem banco ou sem armazenamento) e PARTIDA em /health/live (dá tempo à cópia que acorda do zero). Lê a configuração atual, troca SÓ as sondas
do contêiner e manda de volta; não toca em imagem, variáveis, segredos nem escala. Se as sondas já estão iguais, não faz nada.

Uso (no fluxo de publicação, depois de atualizar a imagem; ou à mão): python infra/aplicar_sondas.py <grupo> <container-app>
Precisa de a imagem já ter as rotas /health/* (v8.4a): ligar as sondas numa imagem sem elas faria o Azure reiniciar a API sem parar."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

PORTA = 8000
API = "2024-03-01"
SONDAS = [
    {"type": "Startup", "httpGet": {"path": "/health/live", "port": PORTA}, "initialDelaySeconds": 3, "periodSeconds": 5, "timeoutSeconds": 5,
     "failureThreshold": 24},
    {"type": "Liveness", "httpGet": {"path": "/health/live", "port": PORTA}, "initialDelaySeconds": 10, "periodSeconds": 30, "timeoutSeconds": 5,
     "failureThreshold": 3},
    {"type": "Readiness", "httpGet": {"path": "/health/ready", "port": PORTA}, "initialDelaySeconds": 5, "periodSeconds": 30, "timeoutSeconds": 15,
     "failureThreshold": 3},
]


def com_as_sondas(template: dict) -> tuple[dict, bool]:
    """O mesmo `template` com as sondas no primeiro contêiner (o da API). Devolve (template, mudou). Tira o sufixo de revisão (reaproveitá-lo daria conflito)."""
    novo = json.loads(json.dumps(template))
    novo.pop("revisionSuffix", None)
    conteiner = novo["containers"][0]
    mudou = conteiner.get("probes") != SONDAS
    conteiner["probes"] = SONDAS
    return novo, mudou


def _az(*args: str) -> str:
    r = subprocess.run(["az", *args], capture_output=True, text=True, shell=os.name == "nt")
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-2000:])
        raise SystemExit(f"az falhou: {' '.join(args[:3])}")
    return r.stdout


def main(grupo: str, app: str) -> int:
    recurso = _az("containerapp", "show", "--name", app, "--resource-group", grupo, "--query", "id", "-o", "tsv").strip()
    url = f"https://management.azure.com{recurso}?api-version={API}"
    atual = json.loads(_az("rest", "--method", "get", "--url", url))
    template, mudou = com_as_sondas(atual["properties"]["template"])
    if not mudou:
        print(f"As sondas de {app} já estão como deviam.")
        return 0
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as arquivo:
        json.dump({"properties": {"template": template}}, arquivo)
        caminho = arquivo.name
    try:
        _az("rest", "--method", "patch", "--url", url, "--body", f"@{caminho}", "-o", "none")
    finally:
        os.remove(caminho)
    print(f"Sondas ligadas em {app}: partida e vida em /health/live, prontidão em /health/ready.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("uso: python infra/aplicar_sondas.py <grupo> <container-app>")
    sys.exit(main(sys.argv[1], sys.argv[2]))
