"""A suíte roda em SQLite, mas a produção é Postgres: este arquivo guarda o caminho de produção que a
suíte nunca exercitava. Achado de 2026-10-02: no SQLAlchemy 2.1 o `postgresql://` puro passou a
significar psycopg 3 (então não instalado) e a API quase não subiu; `create_engine` NÃO conecta, mas já
importa o driver - por isso estes testes pegam o problema sem precisar de banco. Desde a troca para o
psycopg 3 (2026-10-02) o driver é explícito e é o psycopg 3."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app.url_banco import normalizar_url_banco

_DSN_PRODUCAO = "postgresql://asafadmin:s3nha@asaf-pg-server.postgres.database.azure.com:5432/asaf_db?sslmode=require"


def test_postgresql_puro_vira_psycopg3_explicito():
    url = make_url(normalizar_url_banco(_DSN_PRODUCAO))
    assert url.drivername == "postgresql+psycopg"
    assert url.get_driver_name() == "psycopg"
    assert url.host == "asaf-pg-server.postgres.database.azure.com" and url.database == "asaf_db"
    assert url.query["sslmode"] == "require"
    assert url.password == "s3nha"


def test_postgres_curto_tambem_e_normalizado():
    assert normalizar_url_banco("postgres://u:p@h/db").startswith("postgresql+psycopg://u:p@h/db")


@pytest.mark.parametrize("url", [
    "sqlite:///./erp_asaf.db",
    "sqlite:///:memory:",
    "postgresql+psycopg://u:p@h/db",
    "postgresql+psycopg2://u:p@h/db",   # quem pedir o psycopg2 de propósito continua tendo
])
def test_url_que_ja_tem_driver_ou_nao_e_postgres_passa_intacta(url):
    assert normalizar_url_banco(url) == url


def test_engine_de_producao_e_criada_com_o_driver_instalado():
    """Sem o driver instalado (ou sem a normalização), `create_engine` levanta
    `ModuleNotFoundError`. Não conecta em nada."""
    engine = create_engine(normalizar_url_banco(_DSN_PRODUCAO))
    assert engine.dialect.driver == "psycopg"
    engine.dispose()


def test_a_engine_real_da_aplicacao_usa_a_url_normalizada():
    from app import database

    assert database.URL_BANCO_DADOS == normalizar_url_banco(database.URL_BANCO_DADOS)


def test_psycopg2_nao_e_mais_dependencia_da_aplicacao():
    """Trava: ninguém volta a importar o driver antigo em app/ (a produção não o instala mais)."""
    import ast
    from pathlib import Path

    raiz = Path(__file__).resolve().parent.parent
    for pasta in ("app", "scripts", "alembic"):
        for arquivo in (raiz / pasta).rglob("*.py"):
            for no in ast.walk(ast.parse(arquivo.read_text(encoding="utf-8"))):
                nomes = [a.name for a in no.names] if isinstance(no, ast.Import) else [getattr(no, "module", "") or ""] if isinstance(no, ast.ImportFrom) else []
                assert not any(n.split(".")[0] == "psycopg2" for n in nomes), f"{arquivo.relative_to(raiz)} importa psycopg2"
