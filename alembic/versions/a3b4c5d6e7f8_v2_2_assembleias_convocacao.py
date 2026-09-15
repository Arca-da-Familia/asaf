"""v2.2 (FASE 2): assembleias, habilitados_assembleia, peticoes_convocacao, adesoes_peticao

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, Sequence[str], None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "peticoes_convocacao",
        sa.Column("id_peticao", sa.Integer(), primary_key=True, index=True),
        sa.Column("pauta_proposta", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="Coletando adesões", index=True),
        sa.Column("data_quorum_atingido", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "assembleias",
        sa.Column("id_assembleia", sa.Integer(), primary_key=True, index=True),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("pauta", sa.Text(), nullable=False),
        sa.Column("data_hora_convocacao", sa.DateTime(), nullable=False),
        sa.Column("local_fisico", sa.String(), nullable=True),
        sa.Column("link_remoto", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="Rascunho", index=True),
        sa.Column("origem_convocacao", sa.String(length=20), server_default="Presidente"),
        sa.Column("id_peticao_origem", sa.Integer(), sa.ForeignKey("peticoes_convocacao.id_peticao"), nullable=True),
        sa.Column("edital_texto", sa.Text(), nullable=True),
        sa.Column("convocada_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "habilitados_assembleia",
        sa.Column("id_habilitado", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_assembleia", sa.Integer(), sa.ForeignKey("assembleias.id_assembleia"), nullable=False, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("habilitado", sa.Boolean(), nullable=False),
        sa.Column("motivo_inabilitacao", sa.String(), nullable=True),
        sa.Column("status_arrolamento_no_momento", sa.String(), nullable=True),
        sa.Column("congelado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_assembleia", "id_associado", name="uq_habilitado_assembleia_associado"),
    )

    op.create_table(
        "adesoes_peticao",
        sa.Column("id_adesao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_peticao", sa.Integer(), sa.ForeignKey("peticoes_convocacao.id_peticao"), nullable=False, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_peticao", "id_associado", name="uq_adesao_peticao_associado"),
    )


def downgrade() -> None:
    op.drop_table("adesoes_peticao")
    op.drop_table("habilitados_assembleia")
    op.drop_table("assembleias")
    op.drop_table("peticoes_convocacao")
