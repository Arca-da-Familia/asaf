"""A suíte roda em SQLite, mas a produção é Postgres: este arquivo guarda o caminho de produção que a
suíte nunca exercitava. Achado de 2026-10-02: no SQLAlchemy 2.1 o `postgresql://` puro passou a
significar psycopg 3 (não instalado) e a API não subiria; `create_engine` NÃO conecta, mas já importa o
driver - por isso estes testes pegam o problema sem precisar de banco."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app.url_banco import normalizar_url_banco

_DSN_PRODUCAO = "postgresql://asafadmin:s3nha@asaf-pg-server.postgres.database.azure.com:5432/asaf_db?sslmode=require"


def test_postgresql_puro_vira_psycopg2_explicito():
    url = make_url(normalizar_url_banco(_DSN_PRODUCAO))
    assert url.drivername == "postgresql+psycopg2"
    assert url.get_driver_name() == "psycopg2"
    assert url.host == "asaf-pg-server.postgres.database.azure.com" and url.database == "asaf_db"
    assert url.query["sslmode"] == "require"
    assert url.password == "s3nha"


def test_postgres_curto_tambem_e_normalizado():
    assert normalizar_url_banco("postgres://u:p@h/db").startswith("postgresql+psycopg2://u:p@h/db")


@pytest.mark.parametrize("url", [
    "sqlite:///./erp_asaf.db",
    "sqlite:///:memory:",
    "postgresql+psycopg2://u:p@h/db",
    "postgresql+psycopg://u:p@h/db",   # quem pedir psycopg 3 de propósito continua tendo
])
def test_url_que_ja_tem_driver_ou_nao_e_postgres_passa_intacta(url):
    assert normalizar_url_banco(url) == url


def test_engine_de_producao_e_criada_sem_exigir_psycopg3():
    """O teste que teria pegado o defeito: sem a normalização, no SQLAlchemy 2.1 isto levanta
    `ModuleNotFoundError: No module named 'psycopg'`. Não conecta em nada."""
    engine = create_engine(normalizar_url_banco(_DSN_PRODUCAO))
    assert engine.dialect.driver == "psycopg2"
    engine.dispose()


def test_a_engine_real_da_aplicacao_usa_a_url_normalizada():
    from app import database

    assert database.URL_BANCO_DADOS == normalizar_url_banco(database.URL_BANCO_DADOS)
