"""v2.5.3b (FASE 2.5): codigo_chamada em assembleias, justificativas_falta_assembleia

Revision ID: accfd3edfd97
Revises: 710b32fe31d0
Create Date: 2026-09-15 21:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'accfd3edfd97'
down_revision: Union[str, Sequence[str], None] = '710b32fe31d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("assembleias") as batch_op:
        batch_op.add_column(sa.Column("codigo_chamada", sa.String(length=10), nullable=True))

    op.create_table(
        "justificativas_falta_assembleia",
        sa.Column("id_justificativa", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_assembleia", sa.Integer(), sa.ForeignKey("assembleias.id_assembleia"), nullable=False, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("motivo", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="Pendente", index=True),
        sa.Column("motivo_decisao", sa.Text(), nullable=True),
        sa.Column("id_usuario_decisao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("decidido_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_assembleia", "id_associado", name="uq_justificativa_assembleia_associado"),
    )


def downgrade() -> None:
    op.drop_table("justificativas_falta_assembleia")
    with op.batch_alter_table("assembleias") as batch_op:
        batch_op.drop_column("codigo_chamada")
