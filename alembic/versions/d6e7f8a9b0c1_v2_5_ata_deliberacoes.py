"""v2.5 (FASE 2): atas, deliberacoes, certidoes_deliberacao

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd6e7f8a9b0c1'
down_revision: Union[str, Sequence[str], None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "atas",
        sa.Column("id_ata", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_assembleia", sa.Integer(), sa.ForeignKey("assembleias.id_assembleia"), nullable=False, index=True),
        sa.Column("numero_sequencial", sa.Integer(), nullable=True),
        sa.Column("corpo_texto", sa.Text(), nullable=False),
        sa.Column("relato_secretaria", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="Rascunho", index=True),
        sa.Column("assinada_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_assinatura", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("id_ata_retificada", sa.Integer(), sa.ForeignKey("atas.id_ata"), nullable=True),
        sa.Column("motivo_retificacao", sa.Text(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("numero_sequencial", name="uq_atas_numero_sequencial"),
    )

    op.create_table(
        "deliberacoes",
        sa.Column("id_deliberacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_ata", sa.Integer(), sa.ForeignKey("atas.id_ata"), nullable=False, index=True),
        sa.Column("id_item_pauta", sa.Integer(), sa.ForeignKey("itens_pauta.id_item"), nullable=True),
        sa.Column("id_votacao", sa.Integer(), sa.ForeignKey("votacoes.id_votacao"), nullable=True),
        sa.Column("tipo", sa.String(length=30), nullable=False),
        sa.Column("texto", sa.Text(), nullable=False),
        sa.Column("status_execucao", sa.String(length=20), server_default="Pendente", index=True),
        sa.Column("id_associado_responsavel", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=True),
        sa.Column("prazo_execucao", sa.DateTime(), nullable=True),
        sa.Column("concluida_em", sa.DateTime(), nullable=True),
        sa.Column("observacao_conclusao", sa.Text(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "certidoes_deliberacao",
        sa.Column("id_certidao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_deliberacao", sa.Integer(), sa.ForeignKey("deliberacoes.id_deliberacao"), nullable=False, index=True),
        sa.Column("numero_sequencial", sa.Integer(), nullable=False),
        sa.Column("texto_gerado", sa.Text(), nullable=False),
        sa.Column("id_usuario_emissao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("emitida_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("numero_sequencial", name="uq_certidoes_numero_sequencial"),
    )


def downgrade() -> None:
    op.drop_table("certidoes_deliberacao")
    op.drop_table("deliberacoes")
    op.drop_table("atas")
