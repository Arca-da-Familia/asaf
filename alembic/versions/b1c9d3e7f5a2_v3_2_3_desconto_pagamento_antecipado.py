"""v3.2.3 (FASE 3): CampanhaDescontoAntecipado/ReconhecimentoReceitaDiferida,
competencia_fim/id_campanha_desconto_antecipado em TituloFinanceiro (titulo-bloco de pagamento
antecipado com desconto configuravel)

Revision ID: b1c9d3e7f5a2
Revises: c24c04ccd948
Create Date: 2026-09-17 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b1c9d3e7f5a2'
down_revision: Union[str, Sequence[str], None] = 'c24c04ccd948'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campanhas_desconto_antecipado",
        sa.Column("id_campanha", sa.Integer(), primary_key=True, index=True),
        sa.Column("percentual_desconto", sa.Numeric(5, 2), nullable=False),
        sa.Column("quantidade_meses", sa.Integer(), nullable=False),
        sa.Column("meses_gatilho", sa.String(), nullable=False),
        sa.Column("id_conta_contabil_receita_diferida", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=False),
        sa.Column("motivo", sa.String(), nullable=True),
        sa.Column("data_vigencia_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_vigencia_fim", sa.DateTime(), nullable=True),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("data_criacao", sa.DateTime(), nullable=True),
    )

    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.add_column(sa.Column("competencia_fim", sa.String(length=7), nullable=True))
        batch_op.add_column(sa.Column(
            "id_campanha_desconto_antecipado", sa.Integer(),
            sa.ForeignKey("campanhas_desconto_antecipado.id_campanha", name="fk_titulos_financeiros_id_campanha_desconto_antecipado"),
            nullable=True,
        ))

    op.create_table(
        "reconhecimentos_receita_diferida",
        sa.Column("id_reconhecimento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_titulo", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=False),
        sa.Column("competencia", sa.String(length=7), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("id_lancamento", sa.Integer(), sa.ForeignKey("lancamentos_contabeis.id_lancamento"), nullable=False),
        sa.Column("data_criacao", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_titulo", "competencia", name="uq_reconhecimento_por_competencia"),
    )


def downgrade() -> None:
    op.drop_table("reconhecimentos_receita_diferida")

    with op.batch_alter_table("titulos_financeiros") as batch_op:
        batch_op.drop_constraint("fk_titulos_financeiros_id_campanha_desconto_antecipado", type_="foreignkey")
        batch_op.drop_column("id_campanha_desconto_antecipado")
        batch_op.drop_column("competencia_fim")

    op.drop_table("campanhas_desconto_antecipado")
