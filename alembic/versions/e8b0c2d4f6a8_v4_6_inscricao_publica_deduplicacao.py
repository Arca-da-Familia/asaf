"""v4.6 (FASE 4): inscricao publica com deduplicacao - perguntas_evento, tentativas_acesso_publico
(rate limiting por IP), codigo_checkin/token_cancelamento/consentimento_lgpd_versao em inscricoes

Revision ID: e8b0c2d4f6a8
Revises: d6f8a0c2e4b6
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e8b0c2d4f6a8'
down_revision: Union[str, Sequence[str], None] = 'd6f8a0c2e4b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "perguntas_evento",
        sa.Column("id_pergunta", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_evento", sa.Integer(), sa.ForeignKey("eventos.id_evento"), nullable=False, index=True),
        sa.Column("enunciado", sa.String(), nullable=False),
        sa.Column("tipo", sa.String(), nullable=False),
        sa.Column("opcoes", sa.Text(), nullable=True),
        sa.Column("obrigatoria", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ordem", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "tentativas_acesso_publico",
        sa.Column("id_tentativa", sa.Integer(), primary_key=True, index=True),
        sa.Column("ip", sa.String(), nullable=False, index=True),
        sa.Column("rota", sa.String(), nullable=False, index=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True, index=True),
    )

    with op.batch_alter_table("inscricoes") as batch_op:
        batch_op.add_column(sa.Column("codigo_checkin", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("token_cancelamento", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("consentimento_lgpd_versao", sa.String(), nullable=True))
        batch_op.create_unique_constraint("uq_inscricoes_codigo_checkin", ["codigo_checkin"])
        batch_op.create_unique_constraint("uq_inscricoes_token_cancelamento", ["token_cancelamento"])


def downgrade() -> None:
    with op.batch_alter_table("inscricoes") as batch_op:
        batch_op.drop_constraint("uq_inscricoes_token_cancelamento", type_="unique")
        batch_op.drop_constraint("uq_inscricoes_codigo_checkin", type_="unique")
        batch_op.drop_column("consentimento_lgpd_versao")
        batch_op.drop_column("token_cancelamento")
        batch_op.drop_column("codigo_checkin")

    op.drop_table("tentativas_acesso_publico")
    op.drop_table("perguntas_evento")
