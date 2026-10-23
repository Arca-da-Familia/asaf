"""v7.0c (FASE 7): o inventário de dados - a tabela `versoes_de_atividade_de_tratamento`

As atividades de tratamento ficam no código (app/services/inventario.py); o que o encarregado ajusta em cada uma (finalidade, base legal, operadores, medidas,
observações e se conferiu a base legal) fica nesta tabela, só por acréscimo (cada gravação é uma versão nova). Nos bancos que já existem, atualiza a DESCRIÇÃO das
permissões `privacidade` e `privacidade_gerir` (o semeador não reescreve descrição), que passam a cobrir o inventário. O `downgrade` apaga a tabela e devolve as
descrições da v7.0a.

Revision ID: 30a03a70ba56
Revises: 6f679ca3b6bd
Create Date: 2026-10-23 19:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '30a03a70ba56'
down_revision: Union[str, Sequence[str], None] = '6f679ca3b6bd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = postgresql.JSONB().with_variant(sa.JSON(), "sqlite")
_permissoes = sa.table("permissoes_sistema", sa.column("codigo_permissao", sa.String), sa.column("descricao", sa.String))
DESCRICOES = {
    "privacidade": ('Programa de privacidade (LGPD): ver o encarregado, o substituto e o ato de designação (e baixar a cópia assinada) e ver e exportar o inventário de dados (v7.0a/v7.0c).', 'Programa de privacidade (LGPD): ver o encarregado pelo tratamento de dados, o substituto e o ato de designação, e baixar a cópia assinada (v7.0a).'),
    "privacidade_gerir": ("Programa de privacidade (LGPD): gerar o ato de designação do encarregado, registrar a cópia assinada e ajustar o inventário de dados (v7.0a/v7.0c - separada de 'privacidade' de propósito: só o Presidente).", "Programa de privacidade (LGPD): gerar o ato de designação do encarregado e registrar a cópia assinada (v7.0a - separada de 'privacidade' de propósito: só o Presidente)."),
}


def _descrever(posicao: int) -> None:
    for codigo, textos in DESCRICOES.items():
        op.get_bind().execute(sa.update(_permissoes).where(_permissoes.c.codigo_permissao == codigo).values(descricao=textos[posicao]))


def upgrade() -> None:
    op.create_table(
        "versoes_de_atividade_de_tratamento",
        sa.Column("id_versao", sa.Integer(), primary_key=True),
        sa.Column("codigo_atividade", sa.String(length=40), nullable=False),
        sa.Column("versao", sa.Integer(), nullable=False),
        sa.Column("campos", _JSON, nullable=False),
        sa.Column("alterado_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.UniqueConstraint("codigo_atividade", "versao", name="uq_versao_de_atividade"),
    )
    op.create_index("ix_versoes_de_atividade_de_tratamento_id_versao", "versoes_de_atividade_de_tratamento", ["id_versao"])
    op.create_index("ix_versoes_de_atividade_de_tratamento_codigo_atividade", "versoes_de_atividade_de_tratamento", ["codigo_atividade"])
    _descrever(0)


def downgrade() -> None:
    _descrever(1)
    op.drop_index("ix_versoes_de_atividade_de_tratamento_codigo_atividade", table_name="versoes_de_atividade_de_tratamento")
    op.drop_index("ix_versoes_de_atividade_de_tratamento_id_versao", table_name="versoes_de_atividade_de_tratamento")
    op.drop_table("versoes_de_atividade_de_tratamento")
