"""Ponto de Revisão FASE 7 (1/3): trava no banco dos TEXTOS DE PRIVACIDADE (avisos e termos com versão, v7.1a). A versão gravada é a prova do que a pessoa viu
ou assinou: nenhum UPDATE nem DELETE em `textos_de_privacidade` (a versão nova é sempre um registro novo). Antes era só o código que não reescrevia; agora o banco
recusa, como já faz com o lançamento contábil e a Auditoria (migração d7f9b1c3e5a6). Espelhada em app/database.py::criar_trava_dos_textos_de_privacidade.

Revision ID: a3c5e7f9b1d2
Revises: 9d1b6c3e5f27
Create Date: 2026-10-28 00:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a3c5e7f9b1d2'
down_revision: Union[str, Sequence[str], None] = '9d1b6c3e5f27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABELA = "textos_de_privacidade"
TRAVA = "trg_bloquear_mudanca_textos_de_privacidade"
MENSAGEM = "Texto de privacidade gravado não muda nem é apagado: a versão nova é sempre um registro novo."


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE OR REPLACE FUNCTION bloquear_mudanca_texto_de_privacidade() RETURNS trigger AS $$ "
                   f"BEGIN RAISE EXCEPTION '{MENSAGEM}'; RETURN NULL; END; $$ LANGUAGE plpgsql;")
        op.execute(f"DROP TRIGGER IF EXISTS {TRAVA} ON {TABELA}")
        op.execute(f"CREATE TRIGGER {TRAVA} BEFORE UPDATE OR DELETE ON {TABELA} FOR EACH ROW EXECUTE FUNCTION bloquear_mudanca_texto_de_privacidade();")
    else:
        for operacao in ("UPDATE", "DELETE"):
            op.execute(f"CREATE TRIGGER IF NOT EXISTS {TRAVA}_{operacao.lower()} BEFORE {operacao} ON {TABELA} BEGIN SELECT RAISE(ABORT, '{MENSAGEM}'); END;")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(f"DROP TRIGGER IF EXISTS {TRAVA} ON {TABELA}")
        op.execute("DROP FUNCTION IF EXISTS bloquear_mudanca_texto_de_privacidade()")
    else:
        for operacao in ("update", "delete"):
            op.execute(f"DROP TRIGGER IF EXISTS {TRAVA}_{operacao}")
