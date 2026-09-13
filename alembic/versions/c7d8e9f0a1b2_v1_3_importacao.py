"""v1.3 (FASE 1): lotes_importacao + Associado.id_lote_importacao

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-09-14 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'b6c7d8e9f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lotes_importacao",
        sa.Column("id_lote", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_usuario_criador", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("total_linhas", sa.Integer(), server_default="0"),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("desfeito", sa.Boolean(), server_default=sa.false()),
        sa.Column("desfeito_em", sa.DateTime(), nullable=True),
    )
    op.add_column("associados", sa.Column("id_lote_importacao", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_associados_lote_importacao", "associados", "lotes_importacao",
        ["id_lote_importacao"], ["id_lote"],
    )


def downgrade() -> None:
    with op.batch_alter_table("associados") as batch_op:
        batch_op.drop_constraint("fk_associados_lote_importacao", type_="foreignkey")
        batch_op.drop_column("id_lote_importacao")
    op.drop_table("lotes_importacao")
