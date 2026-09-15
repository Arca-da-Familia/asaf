"""Infraestrutura de teste do backend (v0.3, achado do Ponto de Revisão FASE 0/v0.3): antes
disso, TODA verificação de v0.3.1-v0.3.5 (e de fato de todo o projeto) era manual via curl,
nunca virou suíte repetível - `pytest` estava instalado desde sempre em requirements-dev.txt
mas nenhum teste de backend existia. Isso viola o item 2 do checklist padrão de revisão (seção
4.1 do PLANO_PROJETO.md): "testes automatizados existem e passam contra dado/ambiente real".

Estratégia: um processo de banco SQLite por sessão de teste (arquivo descartável, apagado antes
de importar `app.main` - os seeds/preparar_banco rodam na importação do módulo, então
DATABASE_URL/JWT_SECRET precisam existir ANTES do primeiro `import app.main` em qualquer teste).
Não é isolamento perfeito por teste (sem rollback por transação) - cada teste usa CPF/chave
únicos pra não colidir com outro; suficiente para o estágio atual do projeto, sem construir
máquina de savepoint que ninguém pediu ainda.
"""
import os
import uuid
from pathlib import Path

_DB_PATH = Path(__file__).parent / "test_asaf.db"
if _DB_PATH.exists():
    _DB_PATH.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH.as_posix()}"
os.environ["JWT_SECRET"] = "segredo-de-teste-pytest-nao-usar-em-producao"

import pytest
from fastapi.testclient import TestClient

from app.main import app

_client = TestClient(app)


@pytest.fixture(scope="session")
def client():
    return _client


def _cpf_unico() -> str:
    """CPF de teste sem validação de dígito verificador real (bootstrap-admin não exige -
    ver BootstrapAdminRequest) - só precisa ser único por teste."""
    return str(uuid.uuid4().int)[:11]


@pytest.fixture(scope="session")
def admin_token(client):
    """Um único admin (Presidente) criado uma vez por sessão de teste via bootstrap-admin -
    reaproveitado por todo teste que precisar de permissão administrativa. bootstrap-admin só
    funciona uma vez por banco (trava de segurança real, testada em separado), por isso é
    session-scoped, não per-test."""
    cpf = _cpf_unico()
    senha = "SenhaForte123456"
    resposta = client.post(
        "/auth/bootstrap-admin",
        json={"cpf": cpf, "nome_completo": "Admin de Teste", "email": f"{cpf}@teste.local", "senha": senha},
    )
    assert resposta.status_code == 200, resposta.text

    login = client.post("/auth/login", json={"cpf": cpf, "senha": senha})
    assert login.status_code == 200, login.text
    assert login.json()["requer_mfa"] is False  # bootstrap-admin não ativa MFA
    return login.json()["access_token"]


@pytest.fixture()
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture()
def db():
    """Sessão direta pro banco de teste - usada só quando o teste precisa manipular algo que
    nenhum endpoint HTTP expõe ainda (ex.: v1.6, criar uma Pessoa pura sem nenhum Papel, pra
    testar voluntário/funcionário que nunca chegou a ser associado)."""
    from app.database import SessaoLocal

    sessao = SessaoLocal()
    try:
        yield sessao
    finally:
        sessao.close()
