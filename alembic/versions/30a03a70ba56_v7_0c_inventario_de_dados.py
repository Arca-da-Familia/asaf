"""v7.0c (FASE 7): o inventário de dados - a tabela `versoes_de_atividade_de_tratamento`

As atividades de tratamento ficam no código (app/services/inventario.py); o que o encarregado ajusta em cada uma (finalidade, base legal, operadores, medidas,
observações e se conferiu a base legal) fica nesta tabela, só por acréscimo (cada gravação é uma versão nova). Nenhum dado existente é tocado. O `downgrade`
apaga a tabela.

Revision ID: 30a03a70ba56
Revises: 6f679ca3b6bd
Create Date: 2026-10-23 19:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '30a03a70ba56'
down_revision: Union[str, Sequence[str], None] = '6f679ca3b6bd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = postgresql.JSONB().with_variant(sa.JSON(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "versoes_de_atividade_de_tratamento",
        sa.Column("id_versao", sa.Integer(), primary_key=True),
        sa.Column("codigo_atividade", sa.String(length=40), nullable=False),
        sa.Column("versao", sa.Integer(), nullable=False),
        sa.Column("campos", _JSON, nullable=False),
        sa.Column("alterado_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.UniqueConstraint("codigo_atividade", "versao", name="uq_versao_de_atividade"),
    )
    op.create_index("ix_versoes_de_atividade_de_tratamento_id_versao", "versoes_de_atividade_de_tratamento", ["id_versao"])
    op.create_index("ix_versoes_de_atividade_de_tratamento_codigo_atividade", "versoes_de_atividade_de_tratamento", ["codigo_atividade"])


def downgrade() -> None:
    op.drop_index("ix_versoes_de_atividade_de_tratamento_codigo_atividade", table_name="versoes_de_atividade_de_tratamento")
    op.drop_index("ix_versoes_de_atividade_de_tratamento_id_versao", table_name="versoes_de_atividade_de_tratamento")
    op.drop_table("versoes_de_atividade_de_tratamento")
