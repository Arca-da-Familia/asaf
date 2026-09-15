"""v2.8 (FASE 2): processos_dissolucao

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a9b0c1d2e3f4'
down_revision: Union[str, Sequence[str], None] = 'f8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "processos_dissolucao",
        sa.Column("id_processo_dissolucao", sa.Integer(), primary_key=True, index=True),
        sa.Column("motivo", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="Aberto", index=True),
        sa.Column("id_deliberacao", sa.Integer(), sa.ForeignKey("deliberacoes.id_deliberacao"), nullable=True),
        sa.Column("deliberada_em", sa.DateTime(), nullable=True),
        sa.Column("liquidacao_observacao", sa.Text(), nullable=True),
        sa.Column("liquidacao_concluida_em", sa.DateTime(), nullable=True),
        sa.Column("entidade_destinataria_nome", sa.String(), nullable=True),
        sa.Column("entidade_destinataria_cnpj", sa.String(), nullable=True),
        sa.Column("entidade_destinataria_justificativa", sa.Text(), nullable=True),
        sa.Column("confirma_sede_parauapebas", sa.Boolean(), nullable=True),
        sa.Column("confirma_anos_minimos", sa.Boolean(), nullable=True),
        sa.Column("confirma_credenciada", sa.Boolean(), nullable=True),
        sa.Column("patrimonio_destinado_em", sa.DateTime(), nullable=True),
        sa.Column("baixa_cadastral_observacao", sa.Text(), nullable=True),
        sa.Column("baixa_cadastral_em", sa.DateTime(), nullable=True),
        sa.Column("motivo_cancelamento", sa.Text(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("processos_dissolucao")
