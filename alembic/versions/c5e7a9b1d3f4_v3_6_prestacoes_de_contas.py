"""v3.6 (FASE 3): relatorios e prestacao de contas - prestacoes_de_contas

Revision ID: c5e7a9b1d3f4
Revises: b3f5d7e9c1a2
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c5e7a9b1d3f4'
down_revision: Union[str, Sequence[str], None] = 'b3f5d7e9c1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prestacoes_de_contas",
        sa.Column("id_prestacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("ano_exercicio", sa.Integer(), nullable=False, index=True),
        sa.Column("versao", sa.Integer(), nullable=False),
        sa.Column("conteudo", sa.Text(), nullable=False),
        sa.Column("id_parecer", sa.Integer(), sa.ForeignKey("pareceres_prestacao_contas.id_parecer"), nullable=True),
        sa.Column("id_usuario_geracao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("gerada_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("ano_exercicio", "versao", name="uq_prestacao_ano_versao"),
    )


def downgrade() -> None:
    op.drop_table("prestacoes_de_contas")
