"""v0.4 (adendo pós-fechamento da FASE 0): credenciais_webauthn (passkey)

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-09-14 20:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e9f0a1b2c3d4'
down_revision: Union[str, Sequence[str], None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "credenciais_webauthn",
        sa.Column("id_credencial", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_usuario", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False, index=True),
        sa.Column("credential_id", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("chave_publica_cose", sa.String(), nullable=False),
        sa.Column("contador_assinatura", sa.Integer(), nullable=True),
        sa.Column("apelido", sa.String(), nullable=True),
        sa.Column("transports", sa.String(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("ultimo_uso_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("credenciais_webauthn")
