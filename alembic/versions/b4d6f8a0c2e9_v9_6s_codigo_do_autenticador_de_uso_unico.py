"""v9.6s: o código do aplicativo autenticador vale uma vez só (achado A2 da revisão de 23/11/2026)

O mesmo código de 6 dígitos do segundo passo do login valia duas vezes na mesma janela de 30 segundos. Esta migração acrescenta
`usuarios.mfa_ultimo_passo_totp` (a janela do último código aceito no login de cada pessoa; vazia até o próximo login com o segundo passo).
Nenhum usuário, senha ou segredo existente muda: quem já tem o segundo passo continua entrando com o código do aplicativo, como sempre.

Revision ID: b4d6f8a0c2e9
Revises: a9c3e5f7b1d2
Create Date: 2026-11-25 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b4d6f8a0c2e9'
down_revision: Union[str, Sequence[str], None] = 'a9c3e5f7b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("usuarios") as tabela:
        tabela.add_column(sa.Column("mfa_ultimo_passo_totp", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("usuarios") as tabela:
        tabela.drop_column("mfa_ultimo_passo_totp")
