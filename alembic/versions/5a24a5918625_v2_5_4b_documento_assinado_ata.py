"""v2.5.4b (FASE 2.5): documento assinado/protocolado anexado à ata

Revision ID: 5a24a5918625
Revises: accfd3edfd97
Create Date: 2026-09-16 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '5a24a5918625'
down_revision: Union[str, Sequence[str], None] = 'accfd3edfd97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("atas") as batch_op:
        batch_op.add_column(sa.Column("arquivo_documento_assinado", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("numero_protocolo_cartorio", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("data_protocolo_cartorio", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("atas") as batch_op:
        batch_op.drop_column("data_protocolo_cartorio")
        batch_op.drop_column("numero_protocolo_cartorio")
        batch_op.drop_column("arquivo_documento_assinado")
