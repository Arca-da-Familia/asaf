"""v3.2.1 (adaptado, FASE 3): lembretes_mensalidade_enviados - lembrete automatico de
mensalidade por e-mail (Pix pronto), substitui Pix Automatico (exige PSP pago, sem orcamento)

Revision ID: d4e6f8a0c2b3
Revises: b1c9d3e7f5a2
Create Date: 2026-09-17 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd4e6f8a0c2b3'
down_revision: Union[str, Sequence[str], None] = 'b1c9d3e7f5a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lembretes_mensalidade_enviados",
        sa.Column("id_lembrete", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_titulo", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=False),
        sa.Column("tipo_lembrete", sa.String(), nullable=False),
        sa.Column("data_envio", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_titulo", "tipo_lembrete", name="uq_lembrete_por_titulo_e_tipo"),
    )


def downgrade() -> None:
    op.drop_table("lembretes_mensalidade_enviados")
