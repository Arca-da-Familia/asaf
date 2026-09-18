"""v4.5 (FASE 4): evento como entidade unica e pontual - eventos, sessoes_evento (programacao),
edicoes recorrentes ligadas entre si (id_edicao_anterior)

Revision ID: d6f8a0c2e4b6
Revises: c5e7f9b1d3a4
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd6f8a0c2e4b6'
down_revision: Union[str, Sequence[str], None] = 'c5e7f9b1d3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "eventos",
        sa.Column("id_evento", sa.Integer(), primary_key=True, index=True),
        sa.Column("titulo", sa.String(), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("categoria", sa.String(), nullable=False),
        sa.Column("data_hora_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_hora_fim", sa.DateTime(), nullable=True),
        sa.Column("id_espaco", sa.Integer(), sa.ForeignKey("espacos.id_espaco"), nullable=True),
        sa.Column("endereco_avulso", sa.String(), nullable=True),
        sa.Column("id_associado_responsavel", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=True),
        sa.Column("vagas", sa.Integer(), nullable=True),
        sa.Column("gratuito", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("visibilidade", sa.String(), nullable=False, server_default="Interna"),
        sa.Column("id_edicao_anterior", sa.Integer(), sa.ForeignKey("eventos.id_evento"), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "sessoes_evento",
        sa.Column("id_sessao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_evento", sa.Integer(), sa.ForeignKey("eventos.id_evento"), nullable=False, index=True),
        sa.Column("titulo", sa.String(), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("data_hora_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_hora_fim", sa.DateTime(), nullable=True),
        sa.Column("vagas", sa.Integer(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("sessoes_evento")
    op.drop_table("eventos")
