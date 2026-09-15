"""v1.8 (FASE 1): pessoas.data_ultima_confirmacao/contato_suspeito, fila_revisao_cadastro

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-15 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("pessoas", sa.Column("data_ultima_confirmacao", sa.DateTime(), nullable=True))
    op.add_column("pessoas", sa.Column("contato_suspeito", sa.Boolean(), nullable=True, server_default=sa.false()))

    op.create_table(
        "fila_revisao_cadastro",
        sa.Column("id_fila", sa.Integer(), primary_key=True, index=True),
        sa.Column("tipo_sinal", sa.String(length=30), nullable=False),
        sa.Column("id_pessoa_a", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False, index=True),
        sa.Column("id_pessoa_b", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=True, index=True),
        sa.Column("detalhe", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pendente"),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("resolvido_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_resolveu", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("fila_revisao_cadastro")
    with op.batch_alter_table("pessoas") as batch_op:
        batch_op.drop_column("contato_suspeito")
        batch_op.drop_column("data_ultima_confirmacao")
