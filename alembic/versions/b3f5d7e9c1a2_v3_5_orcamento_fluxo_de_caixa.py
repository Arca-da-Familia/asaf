"""v3.5 (FASE 3): orcamento e fluxo de caixa - orcamentos, reservas_contingencia

Revision ID: b3f5d7e9c1a2
Revises: a7c9e1f3b5d6
Create Date: 2026-09-17 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b3f5d7e9c1a2'
down_revision: Union[str, Sequence[str], None] = 'a7c9e1f3b5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "orcamentos",
        sa.Column("id_orcamento", sa.Integer(), primary_key=True, index=True),
        sa.Column("ano", sa.Integer(), nullable=False, index=True),
        sa.Column("id_conta_contabil", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False),
        sa.Column("id_centro_custo", sa.Integer(), sa.ForeignKey("centros_de_custo.id_centro_custo"), nullable=True),
        sa.Column("valor_previsto", sa.Numeric(14, 2), nullable=False),
        sa.Column("id_deliberacao", sa.Integer(), sa.ForeignKey("deliberacoes.id_deliberacao"), nullable=False),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("ano", "id_conta_contabil", "id_centro_custo", name="uq_orcamento_ano_conta_centro"),
    )

    op.create_table(
        "reservas_contingencia",
        sa.Column("id_reserva", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_conta_financeira", sa.Integer(), sa.ForeignKey("contas_financeiras.id_conta_financeira"), nullable=False, unique=True),
        sa.Column("regra_uso", sa.Text(), nullable=False),
        sa.Column("valor_minimo", sa.Numeric(14, 2), nullable=True),
        sa.Column("id_deliberacao", sa.Integer(), sa.ForeignKey("deliberacoes.id_deliberacao"), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("reservas_contingencia")
    op.drop_table("orcamentos")
