"""v4.2 (FASE 4): beneficiarios e atendimento - beneficiarios, beneficiarios_projeto,
registros_atendimento, encaminhamentos_rede_externa

Revision ID: a2c4e6f8b0d1
Revises: f1c3d5e7a9b0
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a2c4e6f8b0d1'
down_revision: Union[str, Sequence[str], None] = 'f1c3d5e7a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "beneficiarios",
        sa.Column("id_beneficiario", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False, unique=True, index=True),
        sa.Column("consentimento_lgpd_registrado", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("observacao_consentimento", sa.String(), nullable=True),
        sa.Column("data_consentimento", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_registro_consentimento", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "beneficiarios_projeto",
        sa.Column("id_vinculo", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_beneficiario", sa.Integer(), sa.ForeignKey("beneficiarios.id_beneficiario"), nullable=False, index=True),
        sa.Column("id_projeto", sa.Integer(), sa.ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True),
        sa.Column("papel", sa.String(), nullable=False),
        sa.Column("atendimento_por_familia", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("data_inicio", sa.DateTime(), nullable=True),
        sa.Column("data_fim", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.UniqueConstraint("id_beneficiario", "id_projeto", name="uq_beneficiario_projeto"),
    )

    op.create_table(
        "registros_atendimento",
        sa.Column("id_registro", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_vinculo", sa.Integer(), sa.ForeignKey("beneficiarios_projeto.id_vinculo"), nullable=False, index=True),
        sa.Column("data_atendimento", sa.DateTime(), nullable=True),
        sa.Column("relato", sa.Text(), nullable=False),
        sa.Column("id_usuario_autor", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "encaminhamentos_rede_externa",
        sa.Column("id_encaminhamento", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_vinculo", sa.Integer(), sa.ForeignKey("beneficiarios_projeto.id_vinculo"), nullable=False, index=True),
        sa.Column("tipo_rede", sa.String(), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=False),
        sa.Column("data_encaminhamento", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("encaminhamentos_rede_externa")
    op.drop_table("registros_atendimento")
    op.drop_table("beneficiarios_projeto")
    op.drop_table("beneficiarios")
