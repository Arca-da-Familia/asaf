"""v0.3.1: motor genérico de catálogo (Catalogo/OpcaoCatalogo)

Cria o modelo definitivo de catálogo configurável, com código estável separado do rótulo
(ver DECISOES_CONGELADAS.md 1.5), e migra o dado que já existia em `opcoes_lista` (v0.1-v0.2)
para ele. A tabela antiga NÃO é apagada - fica como backup/rollback da migração; nada em código
novo lê dela depois desta versão.

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-09-12 00:00:00

"""
import re
import unicodedata
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, Sequence[str], None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Catálogos que existiam como tipo_lista em opcoes_lista (v0.1-v0.2), com o nome que a
# diretoria vê (nome_exibido) e se o código é "de sistema" (editavel_pelo_usuario=False) -
# livre pra ajustar aqui, não é regra congelada (ver PLANO_PROJETO.md v0.3.1: "livre dentro
# disso quais catálogos existem"). categoria_associado e status_arrolamento são de sistema
# porque o código hoje depende do rótulo específico existir (ver app/models/associados.py e
# o valor padrão em ConfiguracaoInstitucional.STATUS_ARROLAMENTO_PADRAO).
_CATALOGOS_MIGRADOS = {
    "categoria_associado": ("Categoria do associado", False),
    "status_arrolamento": ("Situação de arrolamento", False),
    "estado_civil": ("Estado civil", True),
    "grau_parentesco": ("Grau de parentesco", True),
    "categoria_fornecedor": ("Categoria de fornecedor", True),
    "tipo_conta_contabil": ("Tipo de conta contábil", True),
    "forma_pagamento": ("Forma de pagamento", True),
    "titulo_cargo": ("Título de cargo", True),
}


def _slug(valor: str) -> str:
    """Deriva um código técnico estável a partir do rótulo em texto livre que existia em
    opcoes_lista. Só roda uma vez, nesta migração - depois disso o código nunca mais deriva do
    rótulo, é o rótulo que pode mudar em cima do código já fixado."""
    sem_acento = unicodedata.normalize("NFKD", valor).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9]+", "_", sem_acento)).strip("_").upper()


def upgrade() -> None:
    op.create_table(
        "catalogos",
        sa.Column("id_catalogo", sa.Integer(), primary_key=True, index=True),
        sa.Column("chave", sa.String(length=50), nullable=False),
        sa.Column("nome_exibido", sa.String(length=100), nullable=True),
        sa.Column("descricao", sa.String(), nullable=True),
        sa.Column("editavel_pelo_usuario", sa.Boolean(), server_default=sa.true()),
        sa.UniqueConstraint("chave", name="uq_catalogo_chave"),
    )
    op.create_table(
        "opcoes_catalogo",
        sa.Column("id_opcao", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_catalogo", sa.Integer(), sa.ForeignKey("catalogos.id_catalogo"), index=True),
        sa.Column("id_pai", sa.Integer(), sa.ForeignKey("opcoes_catalogo.id_opcao"), nullable=True),
        sa.Column("codigo", sa.String(length=100), nullable=False),
        sa.Column("rotulo", sa.String(length=200), nullable=True),
        sa.Column("ordem", sa.Integer(), server_default="0"),
        sa.Column("ativo", sa.Boolean(), server_default=sa.true()),
        sa.Column("cor", sa.String(length=20), nullable=True),
        sa.Column("icone", sa.String(length=50), nullable=True),
        sa.Column(
            "metadados",
            JSONB().with_variant(sa.JSON(), "sqlite"),
            nullable=True,
        ),
        sa.UniqueConstraint("id_catalogo", "codigo", name="uq_opcao_catalogo_codigo"),
    )

    conexao = op.get_bind()
    inspetor = sa.inspect(conexao)
    if not inspetor.has_table("opcoes_lista"):
        return  # banco novo, sem dado v0.1/v0.2 pra migrar

    opcoes_lista = sa.table(
        "opcoes_lista",
        sa.column("id_opcao", sa.Integer),
        sa.column("tipo_lista", sa.String),
        sa.column("valor", sa.String),
        sa.column("ordem", sa.Integer),
        sa.column("ativo", sa.Boolean),
    )
    catalogos = sa.table(
        "catalogos",
        sa.column("id_catalogo", sa.Integer),
        sa.column("chave", sa.String),
        sa.column("nome_exibido", sa.String),
        sa.column("editavel_pelo_usuario", sa.Boolean),
    )
    opcoes_catalogo = sa.table(
        "opcoes_catalogo",
        sa.column("id_catalogo", sa.Integer),
        sa.column("codigo", sa.String),
        sa.column("rotulo", sa.String),
        sa.column("ordem", sa.Integer),
        sa.column("ativo", sa.Boolean),
    )

    linhas = conexao.execute(sa.select(
        opcoes_lista.c.tipo_lista, opcoes_lista.c.valor, opcoes_lista.c.ordem, opcoes_lista.c.ativo
    )).all()
    if not linhas:
        return

    id_catalogo_por_chave: dict[str, int] = {}
    for chave in sorted({linha.tipo_lista for linha in linhas}):
        nome_exibido, editavel = _CATALOGOS_MIGRADOS.get(chave, (chave.replace("_", " ").capitalize(), True))
        resultado = conexao.execute(
            catalogos.insert().values(chave=chave, nome_exibido=nome_exibido, editavel_pelo_usuario=editavel)
        )
        id_catalogo_por_chave[chave] = resultado.inserted_primary_key[0]

    codigos_usados: dict[int, set[str]] = {}
    for linha in linhas:
        id_catalogo = id_catalogo_por_chave[linha.tipo_lista]
        codigo = _slug(linha.valor) or f"OPCAO_{linha.tipo_lista}"
        usados = codigos_usados.setdefault(id_catalogo, set())
        codigo_final, sufixo = codigo, 2
        while codigo_final in usados:
            codigo_final = f"{codigo}_{sufixo}"
            sufixo += 1
        usados.add(codigo_final)
        conexao.execute(
            opcoes_catalogo.insert().values(
                id_catalogo=id_catalogo,
                codigo=codigo_final,
                rotulo=linha.valor,
                ordem=linha.ordem or 0,
                ativo=bool(linha.ativo),
            )
        )


def downgrade() -> None:
    op.drop_table("opcoes_catalogo")
    op.drop_table("catalogos")
