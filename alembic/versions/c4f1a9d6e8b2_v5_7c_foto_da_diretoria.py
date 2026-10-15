"""v5.7c (FASE 5): foto pública de quem está na Diretoria e no Conselho

Cria `fotos_da_diretoria` (uma foto por pessoa, regravada em JPEG sem metadado, com a autorização de uso de imagem registrada). Nenhum dado existente é tocado.

Revision ID: c4f1a9d6e8b2
Revises: b3e8c5a1d7f4
Create Date: 2026-10-15 22:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c4f1a9d6e8b2'
down_revision: Union[str, Sequence[str], None] = 'b3e8c5a1d7f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fotos_da_diretoria",
        sa.Column("id_foto", sa.Integer(), primary_key=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False),
        sa.Column("arquivo_nome", sa.String(length=150), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("tamanho", sa.Integer(), nullable=False),
        sa.Column("largura", sa.Integer(), nullable=False),
        sa.Column("altura", sa.Integer(), nullable=False),
        sa.Column("alt", sa.String(length=300), nullable=False),
        sa.Column("autorizacao_imagem", sa.Boolean(), nullable=False),
        sa.Column("id_documento_autorizacao", sa.Integer(), sa.ForeignKey("documentos_institucionais.id_documento"), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_fotos_da_diretoria_id_foto", "fotos_da_diretoria", ["id_foto"])
    op.create_index("ix_fotos_da_diretoria_id_pessoa", "fotos_da_diretoria", ["id_pessoa"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_fotos_da_diretoria_id_pessoa", table_name="fotos_da_diretoria")
    op.drop_index("ix_fotos_da_diretoria_id_foto", table_name="fotos_da_diretoria")
    op.drop_table("fotos_da_diretoria")
