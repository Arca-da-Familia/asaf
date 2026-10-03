"""Corrige a referência dos versículos-base: o Estatuto grafa "II Crônicas 4:9-10" por engano; é I Crônicas

O Art. 33, II do Estatuto (cláusula pétrea) cita "II Crônicas"; os versículos 9 e 10 do capítulo 4 são do
livro de I Crônicas (a oração oficial do Art. 33, III é o versículo 10). Confirmado pelo usuário em
2026-10-03. O valor guardado na configuração institucional `VERSICULOS_BASE` foi copiado do Estatuto.

Só altera o valor se ele ainda for EXATAMENTE o que o seed gravou: se alguém já o editou pelo painel, a
migração não mexe (nunca sobrescreve decisão humana). Idempotente.

Revision ID: c3f8a1d07b94
Revises: 9d4e1b7c2a60
Create Date: 2026-10-03 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c3f8a1d07b94'
down_revision: Union[str, Sequence[str], None] = '9d4e1b7c2a60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CHAVE = "VERSICULOS_BASE"
_ERRADO = "II Crônicas 4:9-10"
_CERTO = "I Crônicas 4:9-10"


def _trocar(de: str, para: str) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE configuracoes_institucionais SET valor_configuracao = :para "
            "WHERE chave_configuracao = :chave AND valor_configuracao = :de"
        ),
        {"chave": _CHAVE, "de": de, "para": para},
    )


def upgrade() -> None:
    _trocar(_ERRADO, _CERTO)


def downgrade() -> None:
    _trocar(_CERTO, _ERRADO)
