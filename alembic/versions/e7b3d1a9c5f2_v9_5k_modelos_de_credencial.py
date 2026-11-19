"""v9.5k: os modelos de credencial (o criador de credencial)

Cria `modelos_credencial`: o desenho do cartão (onde fica cada parte, o tamanho e a cor), sem dado de pessoa. No máximo um em uso; sem nenhum, vale
o modelo pronto "Faixa no alto" (o cartão da v9.5j), então nada muda no que já se imprime. Nenhum dado existente muda.

Revision ID: e7b3d1a9c5f2
Revises: d5f9b2c8e3a1
Create Date: 2026-11-19 15:40:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'e7b3d1a9c5f2'
down_revision: Union[str, Sequence[str], None] = 'd5f9b2c8e3a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "modelos_credencial",
        sa.Column("id_modelo", sa.Integer(), primary_key=True),
        sa.Column("nome", sa.String(60), nullable=False),
        sa.Column("desenho", _JSON, nullable=False),
        sa.Column("em_uso", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("usado_desde", sa.DateTime(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_atualizacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )
    op.create_index("ix_modelos_credencial_id_modelo", "modelos_credencial", ["id_modelo"])


def downgrade() -> None:
    op.drop_index("ix_modelos_credencial_id_modelo", table_name="modelos_credencial")
    op.drop_table("modelos_credencial")
