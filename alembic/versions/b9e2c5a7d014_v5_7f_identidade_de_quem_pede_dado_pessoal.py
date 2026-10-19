"""v5.7f (FASE 5): a identidade de quem pede dado pessoal é validada antes de a equipe responder

Decisão do Presidente (2026-10-19): a resposta de uma solicitação de titular (LGPD) não pode ir para quem apenas digitou o CPF de outra pessoa. `atendimentos` ganha quatro colunas, todas
vazias nos pedidos que já existem (nenhum dado é apagado nem inventado): `identidade_validacao` (como foi validada: AUTOMATICA_CADASTRO, CODIGO_NO_EMAIL ou MANUAL), `identidade_validada_em`,
`id_usuario_validacao` (quem validou à mão) e `identidade_nota` (o que a equipe conferiu), mais `motivo_visivel_ao_titular` (o motivo de encerramento só aparece para a pessoa se foi escrito sabendo disso).

Revision ID: b9e2c5a7d014
Revises: f7c4d0e3a915
Create Date: 2026-10-19 17:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b9e2c5a7d014'
down_revision: Union[str, Sequence[str], None] = 'f7c4d0e3a915'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("atendimentos") as lote:
        lote.add_column(sa.Column("identidade_validacao", sa.String(length=24), nullable=True))
        lote.add_column(sa.Column("identidade_validada_em", sa.DateTime(), nullable=True))
        lote.add_column(sa.Column("id_usuario_validacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario", name="fk_atendimentos_id_usuario_validacao"), nullable=True))
        lote.add_column(sa.Column("identidade_nota", sa.String(length=500), nullable=True))
        lote.add_column(sa.Column("motivo_visivel_ao_titular", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("atendimentos") as lote:
        lote.drop_constraint("fk_atendimentos_id_usuario_validacao", type_="foreignkey")
        lote.drop_column("motivo_visivel_ao_titular")
        lote.drop_column("identidade_nota")
        lote.drop_column("id_usuario_validacao")
        lote.drop_column("identidade_validada_em")
        lote.drop_column("identidade_validacao")
