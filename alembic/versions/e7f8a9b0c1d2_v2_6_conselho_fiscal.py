"""v2.6 (FASE 2): pareceres_prestacao_contas, questionamentos_lancamento, respostas_questionamento, deliberacoes.ano_exercicio

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, Sequence[str], None] = 'd6e7f8a9b0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "pareceres_prestacao_contas",
        sa.Column("id_parecer", sa.Integer(), primary_key=True, index=True),
        sa.Column("ano_exercicio", sa.Integer(), nullable=False, index=True),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("texto", sa.Text(), nullable=False),
        sa.Column("id_associado_conselheiro", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "questionamentos_lancamento",
        sa.Column("id_questionamento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_titulo", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=False, index=True),
        sa.Column("id_associado_questionador", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("pergunta", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="Aberto", index=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "respostas_questionamento",
        sa.Column("id_resposta", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_questionamento", sa.Integer(), sa.ForeignKey("questionamentos_lancamento.id_questionamento"), nullable=False, index=True),
        sa.Column("texto", sa.Text(), nullable=False),
        sa.Column("id_usuario_resposta", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.add_column("deliberacoes", sa.Column("ano_exercicio", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("deliberacoes", "ano_exercicio")
    op.drop_table("respostas_questionamento")
    op.drop_table("questionamentos_lancamento")
    op.drop_table("pareceres_prestacao_contas")
