"""v4.7 (FASE 4): vagas com trava real sob concorrencia, cotas por categoria, lista de espera
com promocao automatica e inscricao em grupo

Revision ID: f0a2c4e6b8d0
Revises: e8b0c2d4f6a8
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f0a2c4e6b8d0'
down_revision: Union[str, Sequence[str], None] = 'e8b0c2d4f6a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("eventos") as batch_op:
        batch_op.add_column(sa.Column("vagas_ocupadas", sa.Integer(), nullable=False, server_default="0"))

    with op.batch_alter_table("sessoes_evento") as batch_op:
        batch_op.add_column(sa.Column("vagas_ocupadas", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "cotas_inscricao_evento",
        sa.Column("id_cota", sa.Integer(), primary_key=True, index=True),
        sa.Column("contexto_tipo", sa.String(), nullable=False, index=True),
        sa.Column("id_contexto", sa.Integer(), nullable=False, index=True),
        sa.Column("categoria", sa.String(), nullable=False),
        sa.Column("vagas_limite", sa.Integer(), nullable=False),
        sa.Column("vagas_ocupadas", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("contexto_tipo", "id_contexto", "categoria", name="uq_cota_inscricao_contexto_categoria"),
    )

    with op.batch_alter_table("inscricoes") as batch_op:
        batch_op.add_column(sa.Column("categoria_cota", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("prazo_confirmacao", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("identificador_grupo", sa.String(), nullable=True))
        batch_op.create_index("ix_inscricoes_identificador_grupo", ["identificador_grupo"])


def downgrade() -> None:
    with op.batch_alter_table("inscricoes") as batch_op:
        batch_op.drop_index("ix_inscricoes_identificador_grupo")
        batch_op.drop_column("identificador_grupo")
        batch_op.drop_column("prazo_confirmacao")
        batch_op.drop_column("categoria_cota")

    op.drop_table("cotas_inscricao_evento")

    with op.batch_alter_table("sessoes_evento") as batch_op:
        batch_op.drop_column("vagas_ocupadas")

    with op.batch_alter_table("eventos") as batch_op:
        batch_op.drop_column("vagas_ocupadas")
