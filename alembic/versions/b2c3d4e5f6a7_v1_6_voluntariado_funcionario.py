"""v1.6 (FASE 1): termos_adesao_voluntario, registros_horas_voluntariado, funcionarios

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-15 10:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "termos_adesao_voluntario",
        sa.Column("id_termo", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False, index=True),
        sa.Column("atividade", sa.String(), nullable=False),
        sa.Column("carga_horaria_semanal", sa.Float(), nullable=False),
        sa.Column("local", sa.String(), nullable=True),
        sa.Column("data_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_fim_vigencia", sa.DateTime(), nullable=False),
        sa.Column("documento_referencia", sa.String(), nullable=True),
        sa.Column("autorizacao_responsavel_referencia", sa.String(), nullable=True),
        sa.Column("versao", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ativo", sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column("id_usuario_registrou", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "registros_horas_voluntariado",
        sa.Column("id_registro", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_termo", sa.Integer(), sa.ForeignKey("termos_adesao_voluntario.id_termo"), nullable=False, index=True),
        sa.Column("data", sa.DateTime(), nullable=False),
        sa.Column("horas", sa.Float(), nullable=False),
        sa.Column("descricao_atividade", sa.String(), nullable=True),
        sa.Column("id_projeto", sa.Integer(), sa.ForeignKey("projetos_eventos.id_projeto"), nullable=True),
        sa.Column("id_usuario_registrou", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "funcionarios",
        sa.Column("id_funcionario", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False, unique=True, index=True),
        sa.Column("cargo", sa.String(), nullable=False),
        sa.Column("id_conta_centro_custo", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=True),
        sa.Column("data_admissao", sa.DateTime(), nullable=False),
        sa.Column("data_desligamento", sa.DateTime(), nullable=True),
        sa.Column("ativo", sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("registros_horas_voluntariado")
    op.drop_table("funcionarios")
    op.drop_table("termos_adesao_voluntario")
