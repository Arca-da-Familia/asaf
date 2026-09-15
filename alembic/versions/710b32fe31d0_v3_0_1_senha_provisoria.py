"""v3.0.1 (achado 2026-09-15): usuarios.senha_provisoria - conceder acesso a associado

Revision ID: 710b32fe31d0
Revises: 1a735681510a
Create Date: 2026-09-15 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '710b32fe31d0'
down_revision: Union[str, Sequence[str], None] = '1a735681510a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("usuarios", sa.Column("senha_provisoria", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("usuarios", "senha_provisoria")
