"""v5.4h (FASE 5): filiação proposta por 3 sócios (Estatuto Art. 12, par. único VI) e central de notificações do painel

Cria `propostas_de_socios` (a decisão de cada sócio apto sobre um pedido de filiação: propõe ou recusa, com o motivo) e `notificacoes_painel` (o aviso
que cada usuário vê no sino do painel). Nenhum dado existente é tocado.

Revision ID: d5a2b8c3e641
Revises: c4f9a1e6b270
Create Date: 2026-10-08 11:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd5a2b8c3e641'
down_revision: Union[str, Sequence[str], None] = 'c4f9a1e6b270'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDICES_SOCIOS = ("id_proposta_socio", "id_proposta", "id_associado")
_INDICES_NOTIFICACOES = ("id_notificacao", "id_usuario", "criado_em")


def upgrade() -> None:
    op.create_table(
        "propostas_de_socios",
        sa.Column("id_proposta_socio", sa.Integer(), primary_key=True),
        sa.Column("id_proposta", sa.Integer(), sa.ForeignKey("propostas_filiacao.id_proposta"), nullable=False),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("decisao", sa.String(length=10), nullable=False),
        sa.Column("observacao", sa.String(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("atualizado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_proposta", "id_associado", name="uq_proposta_de_socio"),
    )
    for coluna in _INDICES_SOCIOS:
        op.create_index(f"ix_propostas_de_socios_{coluna}", "propostas_de_socios", [coluna])

    op.create_table(
        "notificacoes_painel",
        sa.Column("id_notificacao", sa.Integer(), primary_key=True),
        sa.Column("id_usuario", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.Column("tipo", sa.String(length=40), nullable=False),
        sa.Column("titulo", sa.String(length=150), nullable=False),
        sa.Column("texto", sa.String(length=500), nullable=True),
        sa.Column("link", sa.String(length=200), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("lida_em", sa.DateTime(), nullable=True),
    )
    for coluna in _INDICES_NOTIFICACOES:
        op.create_index(f"ix_notificacoes_painel_{coluna}", "notificacoes_painel", [coluna])


def downgrade() -> None:
    for coluna in reversed(_INDICES_NOTIFICACOES):
        op.drop_index(f"ix_notificacoes_painel_{coluna}", table_name="notificacoes_painel")
    op.drop_table("notificacoes_painel")
    for coluna in reversed(_INDICES_SOCIOS):
        op.drop_index(f"ix_propostas_de_socios_{coluna}", table_name="propostas_de_socios")
    op.drop_table("propostas_de_socios")
