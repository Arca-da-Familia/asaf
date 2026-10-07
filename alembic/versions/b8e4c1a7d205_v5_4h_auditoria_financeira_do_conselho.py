"""v5.4h (FASE 5): auditoria financeira do Conselho Fiscal (decisão por título)

Cria `auditorias_de_titulo`: cada decisão (Aprovado, Reprovado, Com ressalva) de um conselheiro sobre um título é uma linha nova; a
decisão vigente é a mais recente dele. Reprovar e ressalvar apontam para o questionamento que a tesouraria responde. Nada de dado
existente é tocado.

Revision ID: b8e4c1a7d205
Revises: a7d2f4c8b931
Create Date: 2026-10-07 20:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b8e4c1a7d205'
down_revision: Union[str, Sequence[str], None] = 'a7d2f4c8b931'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDICES = ("id_auditoria", "id_titulo", "id_associado_conselheiro")


def upgrade() -> None:
    op.create_table(
        "auditorias_de_titulo",
        sa.Column("id_auditoria", sa.Integer(), primary_key=True),
        sa.Column("id_titulo", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=False),
        sa.Column("id_associado_conselheiro", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("decisao", sa.String(length=20), nullable=False),
        sa.Column("observacao", sa.Text(), nullable=True),
        sa.Column("id_questionamento", sa.Integer(), sa.ForeignKey("questionamentos_lancamento.id_questionamento"), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )
    for coluna in _INDICES:
        op.create_index(f"ix_auditorias_de_titulo_{coluna}", "auditorias_de_titulo", [coluna])


def downgrade() -> None:
    for coluna in reversed(_INDICES):
        op.drop_index(f"ix_auditorias_de_titulo_{coluna}", table_name="auditorias_de_titulo")
    op.drop_table("auditorias_de_titulo")
