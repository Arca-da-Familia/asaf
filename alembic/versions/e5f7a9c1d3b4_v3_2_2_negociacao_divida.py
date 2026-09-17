"""v3.2.2 (FASE 3): negociacoes_divida - negociacao/parcelamento de debito em atraso, com
termo de confissao de divida em texto (assinatura eletronica fica pra FASE 20)

Revision ID: e5f7a9c1d3b4
Revises: d4e6f8a0c2b3
Create Date: 2026-09-17 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e5f7a9c1d3b4'
down_revision: Union[str, Sequence[str], None] = 'd4e6f8a0c2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "negociacoes_divida",
        sa.Column("id_negociacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("valor_total", sa.Numeric(14, 2), nullable=False),
        sa.Column("quantidade_parcelas", sa.Integer(), nullable=False),
        sa.Column("termo", sa.Text(), nullable=False),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("data_negociacao", sa.DateTime(), nullable=True),
    )

    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.add_column(sa.Column(
            "id_negociacao_origem", sa.Integer(),
            sa.ForeignKey("negociacoes_divida.id_negociacao", name="fk_titulos_financeiros_id_negociacao_origem"),
            nullable=True,
        ))
        batch_op.add_column(sa.Column(
            "id_negociacao_parcela", sa.Integer(),
            sa.ForeignKey("negociacoes_divida.id_negociacao", name="fk_titulos_financeiros_id_negociacao_parcela"),
            nullable=True,
        ))


def downgrade() -> None:
    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.drop_constraint("fk_titulos_financeiros_id_negociacao_parcela", type_="foreignkey")
        batch_op.drop_column("id_negociacao_parcela")
        batch_op.drop_constraint("fk_titulos_financeiros_id_negociacao_origem", type_="foreignkey")
        batch_op.drop_column("id_negociacao_origem")

    op.drop_table("negociacoes_divida")
