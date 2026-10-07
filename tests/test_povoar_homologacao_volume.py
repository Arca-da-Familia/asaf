"""O povoamento em volume da HOMOLOGAÇÃO roda de verdade, de ponta a ponta, num banco SQLite DESCARTÁVEL e num processo à parte: primeiro o roteiro
básico (`popular_homologacao.py`), depois o volume. Prova que todas as áreas passam pelas rotas reais, que os números prometidos batem
(30 cadastros novos em vários status, mensalidades, financeiro, atas, projetos, eventos), que rodar duas vezes é recusado e que qualquer
banco que não seja o de teste é recusado."""
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
POPULAR = RAIZ / "scripts" / "popular_homologacao.py"
VOLUME = RAIZ / "scripts" / "povoar_homologacao_volume.py"

MOTORISTA = textwrap.dedent(
    """
    import importlib.util, json, os, sys
    sys.path.insert(0, {raiz!r})
    os.environ.update(DATABASE_URL={url!r}, JWT_SECRET="segredo-de-teste-do-volume", RUN_DB_MIGRATION="true")
    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from app.database import SessaoLocal
    from app.main import app

    def carregar(nome, caminho):
        esp = importlib.util.spec_from_file_location(nome, caminho)
        modulo = importlib.util.module_from_spec(esp); esp.loader.exec_module(modulo)
        return modulo

    ph = carregar("popular_homologacao", {popular!r})
    pv = carregar("povoar_homologacao_volume", {volume!r})
    saidas = []
    with SessaoLocal() as db, TestClient(app) as client:
        ph.popular(client, db, admin_senha="Senha-De-Teste-Do-Volume-1", escrever=lambda *_: None)
        resultado = pv.povoar(client, db, escrever=saidas.append)
        contagem = lambda sql: db.execute(text(sql)).scalar()
        resumo = {{
            "associados": contagem("select count(*) from associados"),
            "em_experiencia": contagem("select count(*) from associados where status_arrolamento = 'Em Experiência'"),
            "licenciados": contagem("select count(*) from associados where status_arrolamento = 'Licenciado'"),
            "desligados": contagem("select count(*) from associados where status_arrolamento = 'Desligado'"),
            "inadimplentes": contagem("select count(*) from associados where status_arrolamento = 'Ativo - Inadimplente'"),
            "em_dia": contagem("select count(*) from associados where status_arrolamento = 'Ativo - Em Dia'"),
            "titulos_pagos": contagem("select count(*) from titulos_financeiros where status = 'Pago'"),
            "titulos_abertos": contagem("select count(*) from titulos_financeiros where status = 'Pendente'"),
            "fornecedores": contagem("select count(*) from fornecedores"),
            "doacoes": contagem("select count(*) from doacoes"),
            "atas": contagem("select count(*) from atas"),
            "atas_assinadas": contagem("select count(*) from atas where status = 'Assinada'"),
            "projetos": contagem("select count(*) from projetos_eventos"),
            "eventos": contagem("select count(*) from eventos"),
            "inscricoes": contagem("select count(*) from inscricoes"),
            "reservas": contagem("select count(*) from reservas_espaco"),
            "propostas": contagem("select count(*) from propostas_filiacao"),
        }}
        try:
            pv.povoar(client, db, escrever=lambda *_: None)
            segunda = "rodou de novo"
        except SystemExit as erro:
            segunda = str(erro)
    print("@@" + json.dumps({{"resultado": resultado, "resumo": resumo, "saidas": saidas, "segunda": segunda}}, default=str))
    """
)


@pytest.fixture(scope="module")
def execucao(tmp_path_factory):
    pasta = tmp_path_factory.mktemp("volume-hml")
    banco = pasta / "banco.db"
    codigo = MOTORISTA.format(raiz=str(RAIZ), url=f"sqlite:///{banco.as_posix()}", popular=str(POPULAR), volume=str(VOLUME))
    r = subprocess.run([sys.executable, "-c", codigo], cwd=pasta, capture_output=True, text=True, encoding="utf-8", timeout=900)
    linhas = [l for l in r.stdout.splitlines() if l.startswith("@@")]
    assert linhas, f"o povoamento não terminou:\n{r.stdout[-1500:]}\n{r.stderr[-2500:]}"
    return json.loads(linhas[-1][2:])


def test_todas_as_areas_do_volume_passam_sem_falha(execucao):
    assert execucao["resultado"]["falhas"] == [], execucao["resultado"]["falhas"]
    assert len(execucao["resultado"]["feito"]) == 11


def test_o_que_foi_criado_bate_com_o_prometido(execucao):
    r = execucao["resumo"]
    assert r["associados"] == 16 + 30, "os 16 do roteiro básico (com o administrador) + 30 novos"
    assert r["em_experiencia"] == 5 and r["licenciados"] == 3 and r["desligados"] == 2
    assert r["inadimplentes"] >= 6, "os que ficaram com mensalidade vencida e nunca paga"
    assert r["em_dia"] >= 10
    assert r["titulos_pagos"] >= 60 and r["titulos_abertos"] > 20
    assert r["fornecedores"] == 3 and r["doacoes"] == 4
    assert r["atas"] >= 2 and r["atas_assinadas"] >= 1
    assert r["projetos"] >= 3 + 2 and r["eventos"] >= 3 + 3 and r["inscricoes"] >= 30
    assert r["reservas"] == 3
    assert r["propostas"] >= 9


def test_rodar_duas_vezes_e_recusado(execucao):
    assert "já foi feito" in execucao["segunda"], execucao["segunda"]


def test_so_roda_no_banco_de_teste():
    ambiente = {**os.environ, "DATABASE_URL": "postgresql://u:p@host/asaf_db", "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, str(VOLUME)], capture_output=True, text=True, encoding="utf-8", env=ambiente, cwd=RAIZ)
    assert r.returncode != 0 and "RECUSADO" in ((r.stdout or "") + (r.stderr or ""))
