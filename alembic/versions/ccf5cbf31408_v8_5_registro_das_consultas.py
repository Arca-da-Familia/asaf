"""v8.5 (FASE 8): instala o `pg_stat_statements` (o registro das consultas que o próprio Postgres faz) no banco

Autorizado pelo Presidente em 2026-11-03. O servidor já carrega a biblioteca e passou a gravar (`pg_stat_statements.track = top`; `track_utility = off`, para
não guardar comandos de administração, que podem trazer senha; `azure.extensions` liberando a extensão). Falta criá-la DENTRO do banco para que a revisão de
desempenho (scripts/revisao_de_desempenho.py) consiga ler as consultas mais pesadas. Guarda só o texto das consultas com os valores trocados por $1, $2... e
quanto tempo levaram: nenhum dado de pessoa.

Só no Postgres. Se o papel do banco não puder criar extensão (o papel do banco de TESTE não pode), a migração segue sem ela e avisa: a revisão diz
"instalado: não". O `downgrade` remove a extensão.

Revision ID: ccf5cbf31408
Revises: d75b1a9e4c72
Create Date: 2026-11-03 20:00:00

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'ccf5cbf31408'
down_revision: Union[str, Sequence[str], None] = 'd75b1a9e4c72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# o bloco com EXCEPTION roda numa subtransação: a falha (sem permissão, extensão não liberada) não derruba a migração inteira
CRIAR = """
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_stat_statements nao instalado neste banco (%): a revisao de desempenho segue sem as consultas', SQLSTATE;
END
$$;
"""


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(CRIAR)


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP EXTENSION IF EXISTS pg_stat_statements;")
