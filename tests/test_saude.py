"""v8.4a - o exame de saúde da API (/health/live, /health/ready, /health) e as sondas do Container App (infra/aplicar_sondas.py)."""
import importlib.util
from pathlib import Path

import pytest

from app.routers import saude

RAIZ = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def _sem_cache():
    saude._ultimo_armazenamento.update(quando=0.0, ok=False)
    yield
    saude._ultimo_armazenamento.update(quando=0.0, ok=False)


def test_vivo_responde_sem_olhar_banco_nem_armazenamento(client, monkeypatch):
    monkeypatch.setattr(saude, "_banco_ok", lambda: pytest.fail("a sonda de vida não pode depender do banco"))
    r = client.get("/health/live")
    assert r.status_code == 200 and r.json() == {"status": "ok"} and r.headers["cache-control"] == "no-store"


def test_pronto_confere_banco_e_armazenamento_de_verdade(client):
    for rota in ("/health/ready", "/health"):
        r = client.get(rota)
        assert r.status_code == 200, r.text
        assert r.json() == {"status": "ok", "banco": "ok", "armazenamento": "ok"}


def test_banco_fora_do_ar_da_503_dizendo_o_que_sem_o_erro(client, monkeypatch):
    from sqlalchemy.exc import OperationalError

    class _Motor:
        def connect(self):
            raise OperationalError("SELECT 1", {}, Exception("senha errada para o usuario asafadmin"))

    import app.database

    monkeypatch.setattr(app.database, "engine", _Motor())
    r = client.get("/health/ready")
    assert r.status_code == 503 and r.json() == {"status": "falha", "banco": "falha", "armazenamento": "ok"}
    assert "asafadmin" not in r.text and "senha" not in r.text


def test_armazenamento_falhando_da_503_e_o_bom_resultado_vale_5_minutos(client, monkeypatch):
    from app.services import armazenamento

    chamadas = []

    class _Quebrado:
        def verificar(self):
            chamadas.append(1)
            raise RuntimeError("sem permissão na conta de armazenamento")

    monkeypatch.setattr(armazenamento, "obter", lambda: _Quebrado())
    r = client.get("/health")
    assert r.status_code == 503 and r.json()["armazenamento"] == "falha"
    # um resultado BOM fica 5 minutos guardado (a sonda escreve um arquivo); um ruim é conferido de novo a cada vez
    assert saude._armazenamento_ok(agora=1000.0) is False and len(chamadas) == 2
    saude._ultimo_armazenamento.update(quando=1000.0, ok=True)
    assert saude._armazenamento_ok(agora=1000.0 + 299) is True and len(chamadas) == 2
    assert saude._armazenamento_ok(agora=1000.0 + 301) is False and len(chamadas) == 3


def _script():
    especificacao = importlib.util.spec_from_file_location("aplicar_sondas", RAIZ / "infra" / "aplicar_sondas.py")
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def test_as_sondas_trocam_so_as_sondas_do_conteiner_da_api():
    s = _script()
    template = {"revisionSuffix": "abc", "scale": {"maxReplicas": 2},
                "containers": [{"name": "api", "image": "reg/asaf-api:1", "env": [{"name": "DATABASE_URL", "secretRef": "database-url"}], "probes": None}]}
    novo, mudou = s.com_as_sondas(template)
    assert mudou and "revisionSuffix" not in novo and novo["scale"] == {"maxReplicas": 2}
    conteiner = novo["containers"][0]
    assert conteiner["image"] == "reg/asaf-api:1" and conteiner["env"] == template["containers"][0]["env"]
    tipos = {p["type"]: p["httpGet"]["path"] for p in conteiner["probes"]}
    assert tipos == {"Startup": "/health/live", "Liveness": "/health/live", "Readiness": "/health/ready"}
    assert template["containers"][0]["probes"] is None, "não altera o original"
    _, de_novo = s.com_as_sondas(novo)
    assert de_novo is False, "aplicar duas vezes não muda nada"
    # como o Azure devolve: em outra ordem e com o esquema HTTP acrescentado - continua igual (não cria revisão nova a cada publicação)
    devolvido = {"containers": [{"probes": [dict(p, httpGet={**p["httpGet"], "scheme": "HTTP"}) for p in reversed(conteiner["probes"])]}]}
    assert s.com_as_sondas(devolvido)[1] is False
    assert all(p["httpGet"]["port"] == 8000 for p in conteiner["probes"])
    assert "8000" in (RAIZ / "Dockerfile").read_text(encoding="utf-8")


def test_toda_resposta_diz_quanto_o_servidor_levou(client):
    """v9.2b: o cabeçalho Server-Timing (app;dur=<ms>) é o que o robô de desempenho mede: o tempo do servidor, sem a rede."""
    import re

    r = client.get("/health/live")
    assert re.fullmatch(r"app;dur=\d+\.\d", r.headers["server-timing"])
