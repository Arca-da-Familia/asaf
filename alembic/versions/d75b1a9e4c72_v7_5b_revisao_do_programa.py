"""v7.5b (FASE 7): a revisão anual do programa de privacidade - a tabela `revisoes_do_programa`

Guarda o retrato do programa montado pelo sistema (inventário, prazos de guarda, quem tem acesso a quê, incidentes, pedidos de titular, treinamento, ensaio,
encarregado), as observações do encarregado e a aprovação (decisão do Presidente de 2026-11-02: todo janeiro). Nenhum dado existente é tocado. O `downgrade`
apaga a tabela.

Revision ID: d75b1a9e4c72
Revises: c75a8d3f2b61
Create Date: 2026-11-03 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'd75b1a9e4c72'
down_revision: Union[str, Sequence[str], None] = 'c75a8d3f2b61'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = postgresql.JSONB().with_variant(sa.JSON(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "revisoes_do_programa",
        sa.Column("id_revisao", sa.Integer(), nullable=False),
        sa.Column("situacao", sa.String(length=20), nullable=False),
        sa.Column("retrato", _JSON, nullable=False),
        sa.Column("observacoes", sa.Text(), nullable=True),
        sa.Column("montada_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_montagem", sa.Integer(), nullable=False),
        sa.Column("aprovada_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_aprovacao", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["id_usuario_aprovacao"], ["usuarios.id_usuario"]),
        sa.ForeignKeyConstraint(["id_usuario_montagem"], ["usuarios.id_usuario"]),
        sa.PrimaryKeyConstraint("id_revisao"),
    )
    op.create_index(op.f("ix_revisoes_do_programa_id_revisao"), "revisoes_do_programa", ["id_revisao"], unique=False)
    op.create_index(op.f("ix_revisoes_do_programa_situacao"), "revisoes_do_programa", ["situacao"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_revisoes_do_programa_situacao"), table_name="revisoes_do_programa")
    op.drop_index(op.f("ix_revisoes_do_programa_id_revisao"), table_name="revisoes_do_programa")
    op.drop_table("revisoes_do_programa")
