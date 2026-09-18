"""v4.4 (FASE 4): voluntariado vinculado a projeto - escala com turno/habilidades, autocandidatura,
troca de turno entre voluntarios, aprovacao de horas pelo coordenador

Revision ID: c5e7f9b1d3a4
Revises: b4d6f8a0c2e3
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c5e7f9b1d3a4'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("pessoas") as batch_op:
        batch_op.add_column(sa.Column("habilidades", sa.String(), nullable=True))

    # Precisa existir antes de alocacoes_voluntarios.id_vaga poder referenciar.
    op.create_table(
        "vagas_escala_voluntario",
        sa.Column("id_vaga", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_projeto", sa.Integer(), sa.ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True),
        sa.Column("funcao_desempenhada", sa.String(), nullable=False),
        sa.Column("habilidades_exigidas", sa.String(), nullable=True),
        sa.Column("turno_data_hora_inicio", sa.DateTime(), nullable=False),
        sa.Column("turno_data_hora_fim", sa.DateTime(), nullable=False),
        sa.Column("vagas_disponiveis", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("horas_previstas", sa.Float(), nullable=True, server_default="0"),
        sa.Column("id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    with op.batch_alter_table("alocacoes_voluntarios") as batch_op:
        batch_op.drop_column("horas_dedicadas")  # nunca usada (nenhum call site escrevia nela) - substituída abaixo
        batch_op.add_column(sa.Column(
            "id_vaga", sa.Integer(), sa.ForeignKey("vagas_escala_voluntario.id_vaga", name="fk_alocacoes_voluntarios_id_vaga"), nullable=True,
        ))
        batch_op.add_column(sa.Column("turno_data_hora_inicio", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("turno_data_hora_fim", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("habilidades_exigidas", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("horas_previstas", sa.Float(), nullable=True, server_default="0"))
        batch_op.add_column(sa.Column("horas_realizadas", sa.Float(), nullable=True, server_default="0"))
        batch_op.add_column(sa.Column("status", sa.String(), nullable=False, server_default="CONFIRMADA"))
        batch_op.add_column(sa.Column(
            "id_usuario_criacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario", name="fk_alocacoes_voluntarios_id_usuario_criacao"), nullable=True,
        ))
        batch_op.add_column(sa.Column("criado_em", sa.DateTime(), nullable=True))

    op.create_table(
        "trocas_turno_voluntario",
        sa.Column("id_troca", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_alocacao", sa.Integer(), sa.ForeignKey("alocacoes_voluntarios.id_alocacao"), nullable=False, index=True),
        sa.Column("id_associado_substituto", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="SOLICITADA"),
        sa.Column("motivo", sa.String(), nullable=True),
        sa.Column("id_usuario_solicitacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("id_usuario_resolucao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("resolvido_em", sa.DateTime(), nullable=True),
    )

    with op.batch_alter_table("registros_horas_voluntariado") as batch_op:
        batch_op.add_column(sa.Column(
            "id_alocacao", sa.Integer(), sa.ForeignKey("alocacoes_voluntarios.id_alocacao", name="fk_registros_horas_voluntariado_id_alocacao"), nullable=True,
        ))
        batch_op.add_column(sa.Column("status", sa.String(), nullable=False, server_default="APROVADO"))
        batch_op.add_column(sa.Column(
            "id_usuario_aprovacao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario", name="fk_registros_horas_voluntariado_id_usuario_aprovacao"), nullable=True,
        ))
        batch_op.add_column(sa.Column("aprovado_em", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("registros_horas_voluntariado") as batch_op:
        batch_op.drop_column("aprovado_em")
        batch_op.drop_column("id_usuario_aprovacao")
        batch_op.drop_column("status")
        batch_op.drop_column("id_alocacao")

    op.drop_table("trocas_turno_voluntario")

    with op.batch_alter_table("alocacoes_voluntarios") as batch_op:
        batch_op.drop_column("criado_em")
        batch_op.drop_column("id_usuario_criacao")
        batch_op.drop_column("status")
        batch_op.drop_column("horas_realizadas")
        batch_op.drop_column("horas_previstas")
        batch_op.drop_column("habilidades_exigidas")
        batch_op.drop_column("turno_data_hora_fim")
        batch_op.drop_column("turno_data_hora_inicio")
        batch_op.drop_column("id_vaga")
        batch_op.add_column(sa.Column("horas_dedicadas", sa.Float(), nullable=True, server_default="0"))

    op.drop_table("vagas_escala_voluntario")

    with op.batch_alter_table("pessoas") as batch_op:
        batch_op.drop_column("habilidades")
