"""v3.4 (FASE 3): doacoes, captacao e recibos - campanhas_arrecadacao, doacoes,
remanejamentos_destinacao; centros_de_custo.saldo_restrito

Revision ID: a7c9e1f3b5d6
Revises: f6a8b0c2e4d5
Create Date: 2026-09-17 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a7c9e1f3b5d6'
down_revision: Union[str, Sequence[str], None] = 'f6a8b0c2e4d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("centros_de_custo") as batch_op:
        batch_op.add_column(sa.Column("saldo_restrito", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.create_table(
        "campanhas_arrecadacao",
        sa.Column("id_campanha", sa.Integer(), primary_key=True, index=True),
        sa.Column("titulo", sa.String(), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("meta_valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("prazo", sa.DateTime(), nullable=True),
        sa.Column("id_centro_custo", sa.Integer(), sa.ForeignKey("centros_de_custo.id_centro_custo"), nullable=True),
        sa.Column("ativa", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "doacoes",
        sa.Column("id_doacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("anonima", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("nome_doador", sa.String(), nullable=True),
        sa.Column("documento_doador", sa.String(), nullable=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=True),
        sa.Column("tipo_doacao", sa.String(), nullable=False),
        sa.Column("recorrente", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("descricao_bem", sa.String(), nullable=True),
        sa.Column("id_campanha", sa.Integer(), sa.ForeignKey("campanhas_arrecadacao.id_campanha"), nullable=True),
        sa.Column("id_centro_custo_destinacao", sa.Integer(), sa.ForeignKey("centros_de_custo.id_centro_custo"), nullable=True),
        sa.Column("id_conta_contabil", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False),
        sa.Column("id_titulo", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=True),
        sa.Column("numero_recibo", sa.Integer(), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("data_doacao", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("numero_recibo", name="uq_doacoes_numero_recibo"),
    )

    op.create_table(
        "remanejamentos_destinacao",
        sa.Column("id_remanejamento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_centro_custo_origem", sa.Integer(), sa.ForeignKey("centros_de_custo.id_centro_custo"), nullable=False),
        sa.Column("id_centro_custo_destino", sa.Integer(), sa.ForeignKey("centros_de_custo.id_centro_custo"), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("motivo", sa.Text(), nullable=False),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("data_remanejamento", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("remanejamentos_destinacao")
    op.drop_table("doacoes")
    op.drop_table("campanhas_arrecadacao")

    with op.batch_alter_table("centros_de_custo") as batch_op:
        batch_op.drop_column("saldo_restrito")
