"""v4.3 (FASE 4): reserva de espaco - espacos, bloqueios_espaco, reservas_espaco,
checklists_devolucao_espaco + EXCLUDE constraint real em compromissos_agenda (Postgres)

Revision ID: b4d6f8a0c2e3
Revises: a2c4e6f8b0d1
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b4d6f8a0c2e3'
down_revision: Union[str, Sequence[str], None] = 'a2c4e6f8b0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NOME_EXCLUDE = "excl_compromissos_agenda_sobreposicao"


def upgrade() -> None:
    op.create_table(
        "espacos",
        sa.Column("id_espaco", sa.Integer(), primary_key=True, index=True),
        sa.Column("nome", sa.String(), nullable=False),
        sa.Column("tipo", sa.String(), nullable=False),
        sa.Column("capacidade", sa.Integer(), nullable=True),
        sa.Column("recursos_disponiveis", sa.Text(), nullable=True),
        sa.Column("regras_uso", sa.Text(), nullable=True),
        sa.Column("horario_funcionamento_inicio", sa.String(5), nullable=True),
        sa.Column("horario_funcionamento_fim", sa.String(5), nullable=True),
        sa.Column("exige_aprovacao", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("valor_reserva", sa.Numeric(14, 2), nullable=True),
        sa.Column("isento_para_associado_adimplente", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id_conta_contabil_receita", sa.Integer(), sa.ForeignKey("plano_de_contas.id_conta"), nullable=True),
        sa.Column("prazo_cancelamento_horas", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("taxa_cancelamento_tardio", sa.Numeric(14, 2), nullable=True),
        sa.Column("limite_no_show_bloqueio", sa.Integer(), nullable=True),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "bloqueios_espaco",
        sa.Column("id_bloqueio", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_espaco", sa.Integer(), sa.ForeignKey("espacos.id_espaco"), nullable=False, index=True),
        sa.Column("data_hora_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_hora_fim", sa.DateTime(), nullable=False),
        sa.Column("motivo", sa.String(), nullable=False),
        sa.Column("descricao", sa.String(), nullable=True),
        sa.Column("id_compromisso_agenda", sa.Integer(), sa.ForeignKey("compromissos_agenda.id_compromisso"), nullable=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "reservas_espaco",
        sa.Column("id_reserva", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_espaco", sa.Integer(), sa.ForeignKey("espacos.id_espaco"), nullable=False, index=True),
        sa.Column("id_associado_solicitante", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("data_hora_inicio", sa.DateTime(), nullable=False),
        sa.Column("data_hora_fim", sa.DateTime(), nullable=False),
        sa.Column("finalidade", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("motivo_status", sa.Text(), nullable=True),
        sa.Column("id_titulo_cobranca", sa.Integer(), sa.ForeignKey("titulos_financeiros.id_titulo"), nullable=True),
        sa.Column("id_compromisso_agenda", sa.Integer(), sa.ForeignKey("compromissos_agenda.id_compromisso"), nullable=True),
        sa.Column("identificador_serie", sa.String(), nullable=True, index=True),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "checklists_devolucao_espaco",
        sa.Column("id_checklist", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_reserva", sa.Integer(), sa.ForeignKey("reservas_espaco.id_reserva"), nullable=False, unique=True, index=True),
        sa.Column("condicao_retirada", sa.Text(), nullable=True),
        sa.Column("data_retirada", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_retirada", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("condicao_devolucao", sa.Text(), nullable=True),
        sa.Column("houve_avaria", sa.Boolean(), nullable=True),
        sa.Column("descricao_avaria", sa.Text(), nullable=True),
        sa.Column("data_devolucao", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_devolucao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )

    # v4.3 - "conflito impedido no banco, não só na tela": a checagem em Python
    # (app/services/agenda.py::verificar_conflito) não garante nada sob concorrência real - duas
    # requisições simultâneas podem passar pelo SELECT antes de qualquer uma fazer o INSERT. A
    # EXCLUDE constraint é a garantia de verdade, só existe em Postgres (SQLite não tem
    # gist/range) - documentado, não escondido (ver docstring de app/models/espacos.py).
    conexao = op.get_bind()
    if conexao.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")
        # `tsrange` (sem fuso), não `tstzrange` - `compromissos_agenda.data_hora_inicio`/`_fim`
        # são `DateTime` sem `timezone=True` (TIMESTAMP WITHOUT TIME ZONE de verdade no Postgres,
        # mesmo padrão ingênuo-UTC usado em todo o resto do projeto).
        op.execute(
            f"ALTER TABLE compromissos_agenda ADD CONSTRAINT {_NOME_EXCLUDE} "
            "EXCLUDE USING gist ("
            "recurso_tipo WITH =, "
            "id_recurso WITH =, "
            "tsrange(data_hora_inicio, data_hora_fim) WITH &&"
            ");"
        )


def downgrade() -> None:
    conexao = op.get_bind()
    if conexao.dialect.name == "postgresql":
        op.execute(f"ALTER TABLE compromissos_agenda DROP CONSTRAINT IF EXISTS {_NOME_EXCLUDE};")

    op.drop_table("checklists_devolucao_espaco")
    op.drop_table("reservas_espaco")
    op.drop_table("bloqueios_espaco")
    op.drop_table("espacos")
