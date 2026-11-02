"""v7.5a (FASE 7): o treinamento de privacidade - a tabela `treinamentos_de_privacidade`

Guarda quem confirmou "Li e entendi" no material de privacidade, quando e qual versão (decisões do Presidente de 2026-11-02: Diretoria Executiva e Conselho Fiscal
ao entrar no cargo e a cada 2 anos; os demais com acesso a dado todo ano). Nenhum dado existente é tocado. O `downgrade` apaga a tabela.

Revision ID: c75a8d3f2b61
Revises: b74b2e6c1d40
Create Date: 2026-11-02 16:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c75a8d3f2b61'
down_revision: Union[str, Sequence[str], None] = 'b74b2e6c1d40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "treinamentos_de_privacidade",
        sa.Column("id_treinamento", sa.Integer(), nullable=False),
        sa.Column("id_usuario", sa.Integer(), nullable=False),
        sa.Column("versao_material", sa.String(length=20), nullable=False),
        sa.Column("concluido_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["id_usuario"], ["usuarios.id_usuario"]),
        sa.PrimaryKeyConstraint("id_treinamento"),
    )
    op.create_index(op.f("ix_treinamentos_de_privacidade_id_treinamento"), "treinamentos_de_privacidade", ["id_treinamento"], unique=False)
    op.create_index(op.f("ix_treinamentos_de_privacidade_id_usuario"), "treinamentos_de_privacidade", ["id_usuario"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_treinamentos_de_privacidade_id_usuario"), table_name="treinamentos_de_privacidade")
    op.drop_index(op.f("ix_treinamentos_de_privacidade_id_treinamento"), table_name="treinamentos_de_privacidade")
    op.drop_table("treinamentos_de_privacidade")
