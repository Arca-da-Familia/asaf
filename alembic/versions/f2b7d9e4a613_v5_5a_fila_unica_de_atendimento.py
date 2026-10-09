"""v5.5a (FASE 5): a fila única de atendimento (contato, pedido de informação, solicitação de titular LGPD)

Cria `atendimentos`: cada pedido que uma pessoa de fora manda pelo site, com protocolo, situação, responsável e prazo. Nenhum dado existente é tocado.

Revision ID: f2b7d9e4a613
Revises: e7c3d9a4b158
Create Date: 2026-10-09 17:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f2b7d9e4a613'
down_revision: Union[str, Sequence[str], None] = 'e7c3d9a4b158'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDICES = ("id_atendimento", "tipo", "id_pessoa", "chave_remetente", "impressao_do_pedido", "status", "prazo_em", "criado_em")


def upgrade() -> None:
    op.create_table(
        "atendimentos",
        sa.Column("id_atendimento", sa.Integer(), primary_key=True),
        sa.Column("protocolo", sa.String(length=24), nullable=False),
        sa.Column("tipo", sa.String(length=24), nullable=False),
        sa.Column("subtipo", sa.String(length=40), nullable=True),
        sa.Column("assunto", sa.String(length=150), nullable=True),
        sa.Column("mensagem", sa.Text(), nullable=False),
        sa.Column("nome_completo", sa.String(length=150), nullable=False),
        sa.Column("email_contato", sa.String(length=150), nullable=True),
        sa.Column("telefone_whatsapp", sa.String(length=30), nullable=True),
        sa.Column("cpf", sa.String(length=11), nullable=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=True),
        sa.Column("chave_remetente", sa.String(length=150), nullable=True),
        sa.Column("impressao_do_pedido", sa.String(length=64), nullable=True),
        sa.Column("origem", sa.String(length=20), nullable=False),
        sa.Column("consentimento_lgpd_em", sa.DateTime(), nullable=True),
        sa.Column("consentimento_lgpd_versao", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("prazo_dias", sa.Integer(), nullable=False),
        sa.Column("prazo_em", sa.DateTime(), nullable=False),
        sa.Column("id_responsavel", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("assumido_em", sa.DateTime(), nullable=True),
        sa.Column("resposta", sa.Text(), nullable=True),
        sa.Column("respondido_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_resposta", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("resposta_enviada_por_email", sa.Boolean(), nullable=True),
        sa.Column("motivo_encerramento", sa.String(length=300), nullable=True),
        sa.Column("encerrado_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_encerramento", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("atualizado_em", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_atendimentos_protocolo", "atendimentos", ["protocolo"], unique=True)
    for coluna in _INDICES:
        op.create_index(f"ix_atendimentos_{coluna}", "atendimentos", [coluna])


def downgrade() -> None:
    for coluna in reversed(_INDICES):
        op.drop_index(f"ix_atendimentos_{coluna}", table_name="atendimentos")
    op.drop_index("ix_atendimentos_protocolo", table_name="atendimentos")
    op.drop_table("atendimentos")
