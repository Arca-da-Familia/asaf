"""v5.4h (FASE 5): o que a pessoa declara no formulário público de filiação do site

Acrescenta a `propostas_filiacao` a ciência do aviso de privacidade (quando e qual versão do texto) e a declaração de autorização dos pais ou
responsáveis (16 a 17 anos, Estatuto Art. 12). Colunas opcionais: nenhum pedido existente é tocado.

Revision ID: e7c3d9a4b158
Revises: d5a2b8c3e641
Create Date: 2026-10-08 15:30:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e7c3d9a4b158'
down_revision: Union[str, Sequence[str], None] = 'd5a2b8c3e641'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("propostas_filiacao") as lote:
        lote.add_column(sa.Column("consentimento_lgpd_em", sa.DateTime(), nullable=True))
        lote.add_column(sa.Column("consentimento_lgpd_versao", sa.String(length=20), nullable=True))
        lote.add_column(sa.Column("autorizacao_responsavel_declarada", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("propostas_filiacao") as lote:
        lote.drop_column("autorizacao_responsavel_declarada")
        lote.drop_column("consentimento_lgpd_versao")
        lote.drop_column("consentimento_lgpd_em")
