"""O IP que vale para o limite por IP e para a auditoria dos formulários públicos. Achado pelo teste de carga da homologação (2026-10-08): o sistema usava o PRIMEIRO item de
`X-Forwarded-For`, que é do cliente — qualquer um manda um valor diferente a cada chamada e nunca é barrado. Atrás do ingress do Container App, o último item é o que a
infraestrutura anotou."""
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.protecao_publica import ip_publico

RAIZ = Path(__file__).resolve().parent.parent


def _pedido(xff=None, host="10.0.0.9"):
    cabecalhos = {} if xff is None else {"x-forwarded-for": xff}
    return SimpleNamespace(headers=cabecalhos, client=SimpleNamespace(host=host))


def test_vale_o_ultimo_item_e_nao_o_que_o_cliente_inventou(monkeypatch):
    monkeypatch.delenv("CONFIAR_NO_PRIMEIRO_IP", raising=False)
    assert ip_publico(_pedido("1.2.3.4, 203.0.113.50")) == "203.0.113.50"
    assert ip_publico(_pedido("falso, outro-falso,   203.0.113.50 ")) == "203.0.113.50"
    assert ip_publico(_pedido("203.0.113.50")) == "203.0.113.50"


def test_sem_o_cabecalho_vale_o_endereco_da_conexao(monkeypatch):
    monkeypatch.delenv("CONFIAR_NO_PRIMEIRO_IP", raising=False)
    assert ip_publico(_pedido(None, host="198.51.100.7")) == "198.51.100.7"
    assert ip_publico(_pedido("", host="198.51.100.7")) == "198.51.100.7"
    assert ip_publico(SimpleNamespace(headers={}, client=None)) == "desconhecido"


def test_so_com_a_variavel_da_homologacao_o_primeiro_item_conta(monkeypatch):
    monkeypatch.setenv("CONFIAR_NO_PRIMEIRO_IP", "1")
    assert ip_publico(_pedido("1.2.3.4, 203.0.113.50")) == "1.2.3.4"
    monkeypatch.setenv("CONFIAR_NO_PRIMEIRO_IP", "0")
    assert ip_publico(_pedido("1.2.3.4, 203.0.113.50")) == "203.0.113.50"


def test_o_limite_nao_se_burla_trocando_o_primeiro_item(client, monkeypatch):
    """Pela rota de verdade: 11 pedidos com um primeiro item diferente cada um, mas o mesmo último item, são UMA pessoa para o limite (10 por hora)."""
    from tests.apoio_filiacao import corpo_do_pedido
    from tests.test_pessoas import _cpf_unico

    monkeypatch.delenv("CONFIAR_NO_PRIMEIRO_IP", raising=False)
    ultimo = "203.0.113.201"
    codigos = []
    for i in range(11):
        corpo = corpo_do_pedido(cpf=_cpf_unico(), nome_completo=f"Pessoa do mesmo IP {i}")
        r = client.post("/api/filiacao/propor", json=corpo, headers={"X-Forwarded-For": f"10.99.0.{i}, {ultimo}"})
        codigos.append(r.status_code)
    assert codigos[:10] == [200] * 10, codigos
    assert codigos[10] == 429, codigos


def test_a_variavel_de_confianca_so_existe_na_api_de_teste():
    hml = (RAIZ / ".github" / "workflows" / "deploy-homologacao.yml").read_text(encoding="utf-8")
    assert len(re.findall(r"--set-env-vars [^\n]*CONFIAR_NO_PRIMEIRO_IP=1", hml)) == 1
    for arquivo in (RAIZ / ".github" / "workflows").glob("*.yml"):
        if arquivo.name != "deploy-homologacao.yml":
            assert "CONFIAR_NO_PRIMEIRO_IP" not in arquivo.read_text(encoding="utf-8"), arquivo.name
    for arquivo in ("Dockerfile", ".env.example", "docker-compose.yml"):
        caminho = RAIZ / arquivo
        if caminho.exists():
            assert "CONFIAR_NO_PRIMEIRO_IP" not in caminho.read_text(encoding="utf-8"), arquivo
