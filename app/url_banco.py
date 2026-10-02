"""Normalização da URL do banco (sem efeito colateral: importável por `app/database.py` e pelo
`alembic/env.py` antes de qualquer conexão).

POR QUE EXISTE (achado de 2026-10-02, atualização do SQLAlchemy 2.0 → 2.1): o `DATABASE_URL` de
produção é `postgresql://…` (sem driver). No SQLAlchemy 2.0 isso significava **psycopg2**; no 2.1 o
padrão passou a ser **psycopg 3**, que não está instalado - a API não subiria e o `alembic upgrade head`
do CI quebraria, e a suíte (que roda em SQLite) passaria verde. Escolher o driver de forma explícita
tira a dependência do padrão de cada versão da biblioteca. Trocar para o psycopg 3 é decisão à parte
(muda binding de parâmetros num banco que a suíte não exercita), registrada no PLANO."""

_DRIVER = "postgresql+psycopg2"


def normalizar_url_banco(url: str) -> str:
    """`postgresql://…` / `postgres://…` -> `postgresql+psycopg2://…`. URL que já traz driver
    (`postgresql+psycopg://`, `sqlite://`…) passa intacta."""
    for esquema in ("postgresql://", "postgres://"):
        if url.startswith(esquema):
            return f"{_DRIVER}://{url[len(esquema):]}"
    return url
