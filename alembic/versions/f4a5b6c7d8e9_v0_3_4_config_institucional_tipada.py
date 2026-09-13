"""v0.3.4: configuracoes_institucionais tipada (tipo/categoria/descricao/auditoria)

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-09-12 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, Sequence[str], None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("configuracoes_institucionais", sa.Column("tipo", sa.String(length=20), server_default="texto"))
    op.add_column("configuracoes_institucionais", sa.Column("categoria", sa.String(length=50), server_default="geral"))
    op.add_column("configuracoes_institucionais", sa.Column("descricao", sa.String(), nullable=True))
    op.add_column("configuracoes_institucionais", sa.Column("atualizado_em", sa.DateTime(), nullable=True))
    # coluna e FK em passos separados (não em sa.Column(..., sa.ForeignKey(...)) direto no
    # add_column): Postgres aceita as duas formas, mas testar contra SQLite localmente (dialeto
    # não suporta ALTER ADD COLUMN com constraint numa tacada só) só funciona separado - mesmo
    # sem SQLite rodar essa migração de verdade (schema de dev vem de create_all, não do
    # Alembic), separar os passos é o padrão mais portável e não custa nada em Postgres.
    op.add_column("configuracoes_institucionais", sa.Column("id_usuario_atualizacao", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_config_institucional_usuario", "configuracoes_institucionais", "usuarios",
        ["id_usuario_atualizacao"], ["id_usuario"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_config_institucional_usuario", "configuracoes_institucionais", type_="foreignkey")
    op.drop_column("configuracoes_institucionais", "id_usuario_atualizacao")
    op.drop_column("configuracoes_institucionais", "atualizado_em")
    op.drop_column("configuracoes_institucionais", "descricao")
    op.drop_column("configuracoes_institucionais", "categoria")
    op.drop_column("configuracoes_institucionais", "tipo")
