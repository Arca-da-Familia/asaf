"""v2.5.8 (FASE 2.5): permissão de gerenciamento por catálogo, não mais só gerenciar_acesso

Revision ID: 75fa21fb920d
Revises: 5a24a5918625
Create Date: 2026-09-16 18:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '75fa21fb920d'
down_revision: Union[str, Sequence[str], None] = '5a24a5918625'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# chave do catálogo -> código de PermissaoSistema que passa a poder gerenciar suas opções
# (além de gerenciar_acesso, que continua podendo gerenciar qualquer catálogo - ver
# _exigir_permissao_catalogo em app/routers/core.py). Catálogo fora deste mapa (ex.:
# status_arrolamento, de sistema) mantém permissao_gerenciamento nula -> só gerenciar_acesso.
_DONO_POR_CATALOGO = {
    "categoria_associado": "associados",
    "estado_civil": "associados",
    "grau_parentesco": "associados",
    "tipo_documento": "associados",
    "motivo_desligamento": "associados",
    "motivo_licenca": "associados",
    "categoria_fornecedor": "financeiro",
    "tipo_conta_contabil": "financeiro",
    "forma_pagamento": "financeiro",
    "titulo_cargo": "governanca",
    "orgao_direcao": "governanca",
    "categoria_evento_calendario": "governanca",
    "motivo_processo_disciplinar": "governanca",
    "tipo_projeto": "projetos",
    "tipo_evento": "projetos",
    "tipo_protocolo": "projetos",
    "tipo_requerimento": "projetos",
    "unidade_medida_indicador": "projetos",
}


def upgrade() -> None:
    with op.batch_alter_table("catalogos") as batch_op:
        batch_op.add_column(sa.Column("permissao_gerenciamento", sa.String(length=50), nullable=True))

    conexao = op.get_bind()
    tabela = sa.table(
        "catalogos",
        sa.column("chave", sa.String),
        sa.column("permissao_gerenciamento", sa.String),
    )
    for chave, permissao in _DONO_POR_CATALOGO.items():
        conexao.execute(tabela.update().where(tabela.c.chave == chave).values(permissao_gerenciamento=permissao))


def downgrade() -> None:
    with op.batch_alter_table("catalogos") as batch_op:
        batch_op.drop_column("permissao_gerenciamento")
