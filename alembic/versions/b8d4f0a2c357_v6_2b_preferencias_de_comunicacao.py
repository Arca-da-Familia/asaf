"""v6.2b (FASE 6): preferências de contato e descadastro de verdade

Cria `preferencias_de_comunicacao` (o que cada pessoa escolheu NÃO receber por e-mail: avisos não obrigatórios, lembretes de mensalidade e avisos de evento). Sem linha = recebe
(ninguém deixa de receber nada por causa desta migração). Nenhum dado existente é tocado.

Revision ID: b8d4f0a2c357
Revises: a7c3e9f1b246
Create Date: 2026-10-21 09:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b8d4f0a2c357'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9f1b246'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDICES = ("id_preferencia", "id_pessoa")


def upgrade() -> None:
    op.create_table(
        "preferencias_de_comunicacao",
        sa.Column("id_preferencia", sa.Integer(), primary_key=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False),
        sa.Column("tipo", sa.String(length=40), nullable=False),
        sa.Column("recebe", sa.Boolean(), nullable=False),
        sa.Column("origem", sa.String(length=20), nullable=False),
        sa.Column("alterado_em", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("id_pessoa", "tipo", name="uq_preferencia_de_comunicacao"),
    )
    for coluna in _INDICES:
        op.create_index(f"ix_preferencias_de_comunicacao_{coluna}", "preferencias_de_comunicacao", [coluna])


def downgrade() -> None:
    for coluna in reversed(_INDICES):
        op.drop_index(f"ix_preferencias_de_comunicacao_{coluna}", table_name="preferencias_de_comunicacao")
    op.drop_table("preferencias_de_comunicacao")
