"""v2.9 (FASE 2): eventos_calendario

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b0c1d2e3f4a5'
down_revision: Union[str, Sequence[str], None] = 'a9b0c1d2e3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "eventos_calendario",
        sa.Column("id_evento", sa.Integer(), primary_key=True, index=True),
        sa.Column("titulo", sa.String(), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("categoria", sa.String(length=50), nullable=False),
        sa.Column("data_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_fim", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("eventos_calendario")
