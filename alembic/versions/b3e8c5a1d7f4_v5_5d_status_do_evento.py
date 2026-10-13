"""v5.5d (FASE 5): status do evento (Programado / Adiado / Cancelado / Realizado), com motivo

`eventos` ganha `status` (todo evento que já existe fica `Programado`), `motivo_status`, `status_alterado_em` e `data_hora_inicio_anterior` (o começo de antes de uma remarcação).
Nenhum dado existente é apagado nem mudado.

Revision ID: b3e8c5a1d7f4
Revises: a8d4f1c7e592
Create Date: 2026-10-13 18:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b3e8c5a1d7f4'
down_revision: Union[str, Sequence[str], None] = 'a8d4f1c7e592'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("eventos") as lote:
        lote.add_column(sa.Column("status", sa.String(), nullable=False, server_default="Programado"))
        lote.add_column(sa.Column("motivo_status", sa.Text(), nullable=True))
        lote.add_column(sa.Column("status_alterado_em", sa.DateTime(), nullable=True))
        lote.add_column(sa.Column("data_hora_inicio_anterior", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("eventos") as lote:
        lote.drop_column("data_hora_inicio_anterior")
        lote.drop_column("status_alterado_em")
        lote.drop_column("motivo_status")
        lote.drop_column("status")
