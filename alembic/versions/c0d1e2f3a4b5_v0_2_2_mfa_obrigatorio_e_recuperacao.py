"""v0.2.2: MFA obrigatório por nível (niveis_acesso.exige_mfa) + códigos de recuperação

Revision ID: c0d1e2f3a4b5
Revises: 3cdd1f03f29c
Create Date: 2026-09-11 22:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c0d1e2f3a4b5'
down_revision: Union[str, Sequence[str], None] = '3cdd1f03f29c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # MFA obrigatório configurável por nível (catálogo v0.1.5).
    op.add_column('niveis_acesso', sa.Column('exige_mfa', sa.Boolean(), nullable=True))

    # Códigos de recuperação de MFA (v0.2.2d) - guardados só como hash bcrypt.
    op.create_table('codigos_recuperacao_mfa',
        sa.Column('id_codigo', sa.Integer(), nullable=False),
        sa.Column('id_usuario', sa.Integer(), nullable=True),
        sa.Column('codigo_hash', sa.String(), nullable=True),
        sa.Column('usado', sa.Boolean(), nullable=True),
        sa.Column('criado_em', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['id_usuario'], ['usuarios.id_usuario'], ),
        sa.PrimaryKeyConstraint('id_codigo')
    )
    op.create_index(op.f('ix_codigos_recuperacao_mfa_codigo_hash'), 'codigos_recuperacao_mfa', ['codigo_hash'], unique=True)
    op.create_index(op.f('ix_codigos_recuperacao_mfa_id_codigo'), 'codigos_recuperacao_mfa', ['id_codigo'], unique=False)
    op.create_index(op.f('ix_codigos_recuperacao_mfa_id_usuario'), 'codigos_recuperacao_mfa', ['id_usuario'], unique=False)

    # Seed único (só na migração, não a cada boot): Presidente e Diretoria exigem MFA.
    op.execute("UPDATE niveis_acesso SET exige_mfa = true WHERE nome_nivel IN ('Presidente', 'Diretoria')")
    op.execute("UPDATE niveis_acesso SET exige_mfa = false WHERE exige_mfa IS NULL")


def downgrade() -> None:
    op.drop_index(op.f('ix_codigos_recuperacao_mfa_id_usuario'), table_name='codigos_recuperacao_mfa')
    op.drop_index(op.f('ix_codigos_recuperacao_mfa_id_codigo'), table_name='codigos_recuperacao_mfa')
    op.drop_index(op.f('ix_codigos_recuperacao_mfa_codigo_hash'), table_name='codigos_recuperacao_mfa')
    op.drop_table('codigos_recuperacao_mfa')
    op.drop_column('niveis_acesso', 'exige_mfa')