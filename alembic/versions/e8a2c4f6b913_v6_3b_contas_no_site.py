"""v6.3b (FASE 6): as contas do exercício no site — documento gerado pelo sistema com os números em JSON

Acrescenta `documentos_institucionais.dados_publicos_json` e `lancamentos_contabeis.registrado_em` (nulos no que já existe: nenhum dado é tocado;
um lançamento sem a hora do registro conta como anterior a qualquer Assembleia).

Revision ID: e8a2c4f6b913
Revises: d3f6b2c8e571
Create Date: 2026-10-22 13:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e8a2c4f6b913'
down_revision: Union[str, Sequence[str], None] = 'd3f6b2c8e571'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documentos_institucionais", sa.Column("dados_publicos_json", sa.Text(), nullable=True))
    op.add_column("lancamentos_contabeis", sa.Column("registrado_em", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("documentos_institucionais") as lote:
        lote.drop_column("dados_publicos_json")
    with op.batch_alter_table("lancamentos_contabeis") as lote:
        lote.drop_column("registrado_em")
