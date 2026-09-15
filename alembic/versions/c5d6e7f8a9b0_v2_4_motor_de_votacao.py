"""v2.4 (FASE 2): votacoes, votos_abertos, comprovantes_voto_secreto, registros_voto_secreto, impugnacoes_votacao

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c5d6e7f8a9b0'
down_revision: Union[str, Sequence[str], None] = 'b4c5d6e7f8a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "votacoes",
        sa.Column("id_votacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_item_pauta", sa.Integer(), sa.ForeignKey("itens_pauta.id_item"), nullable=False, index=True),
        sa.Column("titulo", sa.String(), nullable=False),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("escrutinio", sa.String(length=20), nullable=False),
        sa.Column("fracao_qualificada", sa.String(length=20), nullable=True),
        sa.Column("opcoes_validas", sa.Text(), nullable=False),
        sa.Column("considerar_abstencao_na_base", sa.Boolean(), server_default=sa.false()),
        sa.Column("status", sa.String(length=20), server_default="Aberta", index=True),
        sa.Column("quorum_instalacao_minimo", sa.Integer(), nullable=True),
        sa.Column("aberta_em", sa.DateTime(), nullable=True),
        sa.Column("encerrada_em", sa.DateTime(), nullable=True),
        sa.Column("resultado_contagem", sa.Text(), nullable=True),
        sa.Column("resultado_hash", sa.String(length=64), nullable=True),
        sa.Column("vencedor", sa.String(), nullable=True),
        sa.Column("aprovado", sa.Boolean(), nullable=True),
        sa.Column("empate", sa.Boolean(), server_default=sa.false()),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )

    op.create_table(
        "votos_abertos",
        sa.Column("id_voto", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_votacao", sa.Integer(), sa.ForeignKey("votacoes.id_votacao"), nullable=False, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("opcao", sa.String(), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_votacao", "id_associado", name="uq_voto_aberto_votacao_associado"),
    )

    op.create_table(
        "comprovantes_voto_secreto",
        sa.Column("id_comprovante", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_votacao", sa.Integer(), sa.ForeignKey("votacoes.id_votacao"), nullable=False, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_votacao", "id_associado", name="uq_comprovante_votacao_associado"),
    )

    # Sem FK/coluna nenhuma que ligue de volta a comprovantes_voto_secreto - é o que garante que
    # nem uma consulta SQL direta de administrador reconstrói pessoa↔voto (ver app/models/votacao.py).
    op.create_table(
        "registros_voto_secreto",
        sa.Column("id_registro", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_votacao", sa.Integer(), sa.ForeignKey("votacoes.id_votacao"), nullable=False, index=True),
        sa.Column("identificador_aleatorio", sa.String(length=64), unique=True, index=True, nullable=False),
        sa.Column("opcao", sa.String(), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "impugnacoes_votacao",
        sa.Column("id_impugnacao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_votacao", sa.Integer(), sa.ForeignKey("votacoes.id_votacao"), nullable=False, index=True),
        sa.Column("id_associado_impugnante", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("motivo", sa.Text(), nullable=False),
        sa.Column("prazo_recurso_ate", sa.DateTime(), nullable=True),
        sa.Column("resolvida", sa.Boolean(), server_default=sa.false()),
        sa.Column("resolucao", sa.Text(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("impugnacoes_votacao")
    op.drop_table("registros_voto_secreto")
    op.drop_table("comprovantes_voto_secreto")
    op.drop_table("votos_abertos")
    op.drop_table("votacoes")
