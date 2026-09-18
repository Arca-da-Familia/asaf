"""v4.1 (FASE 4): projeto como entidade unica e configuravel - novas colunas em
projetos_eventos, itens_cronograma_projeto, equipe_projeto, relatorios_finais_projeto

Revision ID: f1c3d5e7a9b0
Revises: e9b1c3d5f7a8
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f1c3d5e7a9b0'
down_revision: Union[str, Sequence[str], None] = 'e9b1c3d5f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projetos_eventos") as batch_op:
        batch_op.add_column(sa.Column("descricao", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("tipo_projeto", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("status", sa.String(), nullable=False, server_default="PLANEJAMENTO"))
        batch_op.add_column(sa.Column(
            "id_associado_responsavel", sa.Integer(),
            sa.ForeignKey("associados.id_associado", name="fk_projetos_eventos_id_associado_responsavel"), nullable=True,
        ))
        batch_op.add_column(sa.Column("publico_alvo", sa.String(), nullable=True))
        batch_op.add_column(sa.Column(
            "id_centro_custo", sa.Integer(),
            sa.ForeignKey("centros_de_custo.id_centro_custo", name="fk_projetos_eventos_id_centro_custo"), nullable=True,
        ))
        batch_op.add_column(sa.Column("visibilidade", sa.String(), nullable=False, server_default="Interna"))
        batch_op.add_column(sa.Column(
            "id_usuario_criacao", sa.Integer(),
            sa.ForeignKey("usuarios.id_usuario", name="fk_projetos_eventos_id_usuario_criacao"), nullable=True,
        ))
        batch_op.add_column(sa.Column("criado_em", sa.DateTime(), nullable=True))

    op.create_table(
        "itens_cronograma_projeto",
        sa.Column("id_item", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_projeto", sa.Integer(), sa.ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True),
        sa.Column("tipo", sa.String(), nullable=False),
        sa.Column("titulo", sa.String(), nullable=False),
        sa.Column("id_associado_responsavel", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=True),
        sa.Column("prazo", sa.DateTime(), nullable=False),
        sa.Column("concluido_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "equipe_projeto",
        sa.Column("id_membro", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_projeto", sa.Integer(), sa.ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("papel", sa.String(), nullable=False),
        sa.Column("data_inicio", sa.DateTime(), nullable=True),
        sa.Column("data_fim", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )

    op.create_table(
        "relatorios_finais_projeto",
        sa.Column("id_relatorio", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_projeto", sa.Integer(), sa.ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True),
        sa.Column("versao", sa.Integer(), nullable=False),
        sa.Column("conteudo", sa.Text(), nullable=False),
        sa.Column("id_usuario_geracao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("gerado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_projeto", "versao", name="uq_relatorio_final_projeto_versao"),
    )


def downgrade() -> None:
    op.drop_table("relatorios_finais_projeto")
    op.drop_table("equipe_projeto")
    op.drop_table("itens_cronograma_projeto")

    with op.batch_alter_table("projetos_eventos") as batch_op:
        batch_op.drop_column("criado_em")
        batch_op.drop_column("id_usuario_criacao")
        batch_op.drop_column("visibilidade")
        batch_op.drop_column("id_centro_custo")
        batch_op.drop_column("publico_alvo")
        batch_op.drop_column("id_associado_responsavel")
        batch_op.drop_column("status")
        batch_op.drop_column("tipo_projeto")
        batch_op.drop_column("descricao")
