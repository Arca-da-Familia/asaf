"""v7.2c (FASE 7): a ENTREGA do relatório dos dados ao titular pela Minha conta - o relatório que o encarregado conferiu e liberou, congelado, para a pessoa
baixar em PDF e no arquivo da portabilidade por 15 dias; vencido, o conteúdo é apagado e ficam só as datas (decisão 2 do Presidente, 2026-10-28).

Revision ID: 12f16313d972
Revises: b0227d30a6a9
Create Date: 2026-10-29 00:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '12f16313d972'
down_revision: Union[str, Sequence[str], None] = 'b0227d30a6a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "entregas_ao_titular",
        sa.Column("id_entrega", sa.Integer(), nullable=False),
        sa.Column("id_atendimento", sa.Integer(), nullable=False),
        sa.Column("conteudo", sa.Text(), nullable=True),
        sa.Column("liberado_em", sa.DateTime(), nullable=False),
        sa.Column("valido_ate", sa.DateTime(), nullable=False),
        sa.Column("apagado_em", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["id_atendimento"], ["atendimentos.id_atendimento"]),
        sa.PrimaryKeyConstraint("id_entrega"),
    )
    op.create_index("ix_entregas_ao_titular_id_entrega", "entregas_ao_titular", ["id_entrega"])
    op.create_index("ix_entregas_ao_titular_id_atendimento", "entregas_ao_titular", ["id_atendimento"])
    op.create_index("ix_entregas_ao_titular_valido_ate", "entregas_ao_titular", ["valido_ate"])


def downgrade() -> None:
    op.drop_index("ix_entregas_ao_titular_valido_ate", table_name="entregas_ao_titular")
    op.drop_index("ix_entregas_ao_titular_id_atendimento", table_name="entregas_ao_titular")
    op.drop_index("ix_entregas_ao_titular_id_entrega", table_name="entregas_ao_titular")
    op.drop_table("entregas_ao_titular")
