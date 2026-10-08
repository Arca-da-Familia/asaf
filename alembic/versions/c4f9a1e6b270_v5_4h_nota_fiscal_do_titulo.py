"""v5.4h (FASE 5): nota fiscal do título (a saída registrada já vem com a nota anexa)

Acrescenta `titulos_financeiros.nota_fiscal` (caminho do arquivo no armazenamento, nulo nos títulos antigos). Nenhum dado existente é tocado.

Revision ID: c4f9a1e6b270
Revises: b8e4c1a7d205
Create Date: 2026-10-08 10:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c4f9a1e6b270'
down_revision: Union[str, Sequence[str], None] = 'b8e4c1a7d205'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.add_column(sa.Column("nota_fiscal", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.drop_column("nota_fiscal")
