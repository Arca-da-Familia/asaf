"""v9.5j: quando a credencial foi impressa pela última vez (a tela de credenciais emitidas)

Acrescenta `credenciais.impressa_em` (vazio = ainda não impressa, só no celular). Nenhum dado existente muda.

Revision ID: d5f9b2c8e3a1
Revises: c4e8a1f7d2b9
Create Date: 2026-11-19 11:30:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd5f9b2c8e3a1'
down_revision: Union[str, Sequence[str], None] = 'c4e8a1f7d2b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("credenciais", sa.Column("impressa_em", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("credenciais", "impressa_em")
