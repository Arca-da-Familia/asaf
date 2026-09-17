"""v3.2 (FASE 3): PlanoDeContribuicao/ValorPlanoContribuicao/IsencaoContribuicao/CreditoAssociado,
id_plano_contribuicao/competencia em TituloFinanceiro (idempotencia de geracao em lote)

Revision ID: c24c04ccd948
Revises: 5278bf9ee537
Create Date: 2026-09-17 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c24c04ccd948'
down_revision: Union[str, Sequence[str], None] = '5278bf9ee537'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planos_contribuicao",
        sa.Column("id_plano", sa.Integer(), primary_key=True, index=True),
        sa.Column("categoria", sa.String(), nullable=False),
        sa.Column("descricao", sa.String(), nullable=False),
        sa.Column("periodicidade", sa.String(), nullable=False, server_default="Mensal"),
        sa.Column("dia_vencimento", sa.Integer(), nullable=False),
        sa.Column("cobranca_por_nucleo_familiar", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("id_conta_contabil", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "valores_plano_contribuicao",
        sa.Column("id_valor", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_plano", sa.Integer(), sa.ForeignKey("planos_contribuicao.id_plano"), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("data_vigencia_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_vigencia_fim", sa.DateTime(), nullable=True),
        sa.Column("motivo_reajuste", sa.String(), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )

    op.create_table(
        "isencoes_contribuicao",
        sa.Column("id_isencao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("id_plano", sa.Integer(), sa.ForeignKey("planos_contribuicao.id_plano"), nullable=True),
        sa.Column("motivo", sa.String(), nullable=False),
        sa.Column("percentual_desconto", sa.Numeric(5, 2), nullable=False),
        sa.Column("data_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_fim", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_aprovador", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )

    op.create_table(
        "creditos_associado",
        sa.Column("id_credito", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("valor_original", sa.Numeric(14, 2), nullable=False),
        sa.Column("origem", sa.String(), nullable=False),
        sa.Column("id_titulo_origem", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=True),
        sa.Column("data_criacao", sa.DateTime(), nullable=True),
    )

    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.add_column(sa.Column(
            "id_plano_contribuicao", sa.Integer(),
            sa.ForeignKey("planos_contribuicao.id_plano", name="fk_titulos_financeiros_id_plano_contribuicao"),
            nullable=True,
        ))
        batch_op.add_column(sa.Column("competencia", sa.String(length=7), nullable=True))
        batch_op.create_unique_constraint(
            "uq_titulo_cobranca_por_competencia", ["id_associado", "id_plano_contribuicao", "competencia"],
        )


def downgrade() -> None:
    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.drop_constraint("uq_titulo_cobranca_por_competencia", type_="unique")
        batch_op.drop_column("competencia")
        batch_op.drop_column("id_plano_contribuicao")

    op.drop_table("creditos_associado")
    op.drop_table("isencoes_contribuicao")
    op.drop_table("valores_plano_contribuicao")
    op.drop_table("planos_contribuicao")
