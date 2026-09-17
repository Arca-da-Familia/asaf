"""v3.7 (FASE 3): fechamento mensal (conciliacao obrigatoria) + trava de DELETE no banco para
lancamentos_contabeis, partidas_contabeis e audit_log - nenhum usuario, em nenhum nivel
(inclusive Presidente), consegue apagar lancamento ou log, garantido por trigger no proprio
banco, nao so na aplicacao (a aplicacao ja nao expoe nenhuma rota de DELETE para essas tabelas -
isto fecha a lacuna de quem tivesse acesso direto ao banco, ou de um bug futuro na aplicacao).

Revision ID: d7f9b1c3e5a6
Revises: c5e7a9b1d3f4
Create Date: 2026-09-18 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd7f9b1c3e5a6'
down_revision: Union[str, Sequence[str], None] = 'c5e7a9b1d3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABELAS_IMUTAVEIS = ("lancamentos_contabeis", "partidas_contabeis", "audit_log")


def _nome_trigger(tabela: str) -> str:
    return f"trg_bloquear_delete_{tabela}"


def upgrade() -> None:
    op.create_table(
        "fechamentos_mensais",
        sa.Column("id_fechamento", sa.Integer(), primary_key=True, index=True),
        sa.Column("competencia", sa.String(7), nullable=False, index=True),
        sa.Column("id_conta_financeira", sa.Integer(), sa.ForeignKey("contas_financeiras.id_conta_financeira"), nullable=False),
        sa.Column("saldo_sistema", sa.Numeric(14, 2), nullable=False),
        sa.Column("saldo_extrato_bancario", sa.Numeric(14, 2), nullable=False),
        sa.Column("divergencia", sa.Numeric(14, 2), nullable=False),
        sa.Column("id_usuario_conferencia", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("assinado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("competencia", "id_conta_financeira", name="uq_fechamento_competencia_conta"),
    )

    conexao = op.get_bind()
    if conexao.dialect.name == "postgresql":
        op.execute(
            "CREATE OR REPLACE FUNCTION bloquear_delete_financeiro() RETURNS trigger AS $$ "
            "BEGIN RAISE EXCEPTION "
            "'Registro imutável (tabela %) - correção é sempre por estorno/novo registro, nunca exclusão.', TG_TABLE_NAME; "
            "RETURN NULL; "
            "END; $$ LANGUAGE plpgsql;"
        )
        for tabela in _TABELAS_IMUTAVEIS:
            op.execute(
                f"CREATE TRIGGER {_nome_trigger(tabela)} BEFORE DELETE ON {tabela} "
                f"FOR EACH ROW EXECUTE FUNCTION bloquear_delete_financeiro();"
            )
    else:
        for tabela in _TABELAS_IMUTAVEIS:
            op.execute(
                f"CREATE TRIGGER {_nome_trigger(tabela)} BEFORE DELETE ON {tabela} "
                f"BEGIN SELECT RAISE(ABORT, 'Registro imutável ({tabela}) - correção é sempre por estorno/novo registro, nunca exclusão.'); END;"
            )


def downgrade() -> None:
    conexao = op.get_bind()
    eh_postgres = conexao.dialect.name == "postgresql"
    for tabela in _TABELAS_IMUTAVEIS:
        if eh_postgres:
            op.execute(f"DROP TRIGGER IF EXISTS {_nome_trigger(tabela)} ON {tabela};")
        else:
            op.execute(f"DROP TRIGGER IF EXISTS {_nome_trigger(tabela)};")
    if eh_postgres:
        op.execute("DROP FUNCTION IF EXISTS bloquear_delete_financeiro();")

    op.drop_table("fechamentos_mensais")
