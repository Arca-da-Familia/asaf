"""v2.7 (FASE 2): processos_disciplinares, manifestacoes_diretoria_disciplinar

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f8a9b0c1d2e3'
down_revision: Union[str, Sequence[str], None] = 'e7f8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "processos_disciplinares",
        sa.Column("id_processo", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("motivo_codigo", sa.String(length=50), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=40), server_default="Aberto", index=True),
        sa.Column("data_abertura", sa.DateTime(), nullable=True),
        sa.Column("prazo_defesa_ate", sa.DateTime(), nullable=False),
        sa.Column("defesa_texto", sa.Text(), nullable=True),
        sa.Column("defesa_apresentada_em", sa.DateTime(), nullable=True),
        sa.Column("pena_aplicada", sa.String(length=40), nullable=True),
        sa.Column("escalada_automatica", sa.Boolean(), server_default=sa.false()),
        sa.Column("suspensao_dias", sa.Integer(), nullable=True),
        sa.Column("data_fim_suspensao", sa.DateTime(), nullable=True),
        sa.Column("decisao_texto", sa.Text(), nullable=True),
        sa.Column("decidido_em", sa.DateTime(), nullable=True),
        sa.Column("id_deliberacao_homologacao", sa.Integer(), sa.ForeignKey("deliberacoes.id_deliberacao"), nullable=True),
        sa.Column("homologado_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_abertura", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "manifestacoes_diretoria_disciplinar",
        sa.Column("id_manifestacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_processo", sa.Integer(), sa.ForeignKey("processos_disciplinares.id_processo"), nullable=False, index=True),
        sa.Column("id_associado_diretor", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("pena_proposta", sa.String(length=40), nullable=True),
        sa.Column("justificativa", sa.Text(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_processo", "id_associado_diretor", name="uq_manifestacao_processo_diretor"),
    )


def downgrade() -> None:
    op.drop_table("manifestacoes_diretoria_disciplinar")
    op.drop_table("processos_disciplinares")
