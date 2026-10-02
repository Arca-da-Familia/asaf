"""Índices que os modelos declaram (`index=True`) e o banco de produção nunca teve

Achado de 2026-10-02: o `alembic check` só passou a funcionar depois que `app/models/__init__.py` passou
a importar todos os módulos, e mostrou 7 índices declarados nos modelos que o banco real não tem (o schema
de produção nasceu em etapas, e estas colunas ganharam `index=True` depois de a tabela existir). Todos são
colunas de chave estrangeira / busca - sem efeito funcional com o volume de hoje, mas viram lentidão
silenciosa quando houver dado. As 3 unicidades que o `alembic check` também apontava (matrícula, chave de
catálogo, número de recibo) já existem em produção como constraints `uq_*`: foi o MODELO que passou a
declará-las assim, nada muda no banco.

Idempotente (`if_not_exists`): rodar em um banco que já tem o índice (ex.: um banco novo criado pelo
`create_all`) não faz nada.

Revision ID: 9d4e1b7c2a60
Revises: 85a120a27eb7
Create Date: 2026-10-02 00:00:00

"""
from typing import Sequence, Union

from alembic import op

revision: str = '9d4e1b7c2a60'
down_revision: Union[str, Sequence[str], None] = '85a120a27eb7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDICES = (
    ("ix_aprovacoes_compra_id_solicitacao", "aprovacoes_compra", "id_solicitacao"),
    ("ix_associados_id_pessoa", "associados", "id_pessoa"),
    ("ix_cotacoes_compra_id_solicitacao", "cotacoes_compra", "id_solicitacao"),
    ("ix_dados_bancarios_fornecedor_id_fornecedor", "dados_bancarios_fornecedor", "id_fornecedor"),
    ("ix_dependentes_familiares_id_pessoa_titular", "dependentes_familiares", "id_pessoa_titular"),
    ("ix_dependentes_familiares_id_pessoa_vinculada", "dependentes_familiares", "id_pessoa_vinculada"),
    ("ix_opcoes_catalogo_codigo", "opcoes_catalogo", "codigo"),
)


def upgrade() -> None:
    for nome, tabela, coluna in _INDICES:
        op.create_index(nome, tabela, [coluna], unique=False, if_not_exists=True)


def downgrade() -> None:
    for nome, tabela, _coluna in reversed(_INDICES):
        op.drop_index(nome, table_name=tabela, if_exists=True)
