"""Normalização da URL do banco (sem efeito colateral: importável por `app/database.py` e pelo
`alembic/env.py` antes de qualquer conexão).

POR QUE EXISTE (achado de 2026-10-02, atualização do SQLAlchemy 2.0 → 2.1): o `DATABASE_URL` de
produção é `postgresql://…` (sem driver). No SQLAlchemy 2.0 isso significava psycopg2; no 2.1 o padrão
passou a ser psycopg 3. A API quase não subiu em produção na troca, e a suíte (que roda em SQLite)
passaria verde. Escolher o driver de forma explícita tira a dependência do padrão de cada versão da
biblioteca.

Driver atual: **psycopg 3** (`postgresql+psycopg`), adotado em 2026-10-02 por pedido do usuário (regra
"tudo na última versão"; o psycopg2 está em modo de manutenção). A troca foi provada com a suíte inteira
contra um Postgres de verdade no CI antes de chegar à produção."""

_DRIVER = "postgresql+psycopg"


def normalizar_url_banco(url: str) -> str:
    """`postgresql://…` / `postgres://…` -> `postgresql+psycopg://…`. URL que já traz driver
    (`postgresql+psycopg2://`, `sqlite://`…) passa intacta."""
    for esquema in ("postgresql://", "postgres://"):
        if url.startswith(esquema):
            return f"{_DRIVER}://{url[len(esquema):]}"
    return url
