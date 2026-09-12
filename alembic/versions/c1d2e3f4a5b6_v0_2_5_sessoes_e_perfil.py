"""v0.2.5: metadados de sessão em tokens_acesso (Sessões ativas do Meu Perfil)

Revision ID: c1d2e3f4a5b6
Revises: c0d1e2f3a4b5
Create Date: 2026-09-12 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'c0d1e2f3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tokens_acesso', sa.Column('ip_origem', sa.String(), nullable=True))
    op.add_column('tokens_acesso', sa.Column('user_agent', sa.String(), nullable=True))
    op.add_column('tokens_acesso', sa.Column('criado_em', sa.DateTime(), nullable=True))
    op.add_column('tokens_acesso', sa.Column('ultimo_uso_em', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('tokens_acesso', 'ultimo_uso_em')
    op.drop_column('tokens_acesso', 'criado_em')
    op.drop_column('tokens_acesso', 'user_agent')
    op.drop_column('tokens_acesso', 'ip_origem')