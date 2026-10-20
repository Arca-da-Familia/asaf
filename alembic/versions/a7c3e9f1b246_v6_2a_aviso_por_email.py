"""v6.2a (FASE 6): o aviso também por e-mail, com o registro de entrega por pessoa

`avisos` ganha `por_email` (falso em todos os avisos que já existem: nenhum vai por e-mail de repente) e nasce `entregas_de_aviso` (a entrega de cada pessoa por um canal além do
painel: na fila, enviado, falhou, sem e-mail no cadastro ou cancelado; sem guardar o endereço). No catálogo `categoria_aviso`, as categorias que o Presidente decidiu que são OBRIGATÓRIAS
(2026-10-20: Convocação e Mudança de regra) ganham a marca `obrigatoria` nos metadados: a caixa "também por e-mail" vem marcada nelas e, na v6.2b, a pessoa não pode desligá-las. Nada é apagado.

Revision ID: a7c3e9f1b246
Revises: e5b1d7a3c820
Create Date: 2026-10-20 20:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a7c3e9f1b246'
down_revision: Union[str, Sequence[str], None] = 'e5b1d7a3c820'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
_INDICES = ("id_entrega", "id_destinatario", "situacao", "enviado_em")
OBRIGATORIAS = ("CONVOCACAO", "MUDANCA_DE_REGRA")

_catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
_opcoes = sa.table("opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String), sa.column("metadados", _JSON))


def _marcar(conexao, valor: bool) -> None:
    id_catalogo = conexao.execute(sa.select(_catalogos.c.id_catalogo).where(_catalogos.c.chave == "categoria_aviso")).scalar()
    if id_catalogo is None:
        return
    for opcao in conexao.execute(sa.select(_opcoes.c.id_opcao, _opcoes.c.codigo, _opcoes.c.metadados).where(_opcoes.c.id_catalogo == id_catalogo)).all():
        if opcao.codigo not in OBRIGATORIAS:
            continue
        metadados = dict(opcao.metadados) if isinstance(opcao.metadados, dict) else {}
        if valor:
            metadados["obrigatoria"] = True
        else:
            metadados.pop("obrigatoria", None)
        conexao.execute(sa.update(_opcoes).where(_opcoes.c.id_opcao == opcao.id_opcao).values(metadados=metadados))


def upgrade() -> None:
    with op.batch_alter_table("avisos") as lote:
        lote.add_column(sa.Column("por_email", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "entregas_de_aviso",
        sa.Column("id_entrega", sa.Integer(), primary_key=True),
        sa.Column("id_destinatario", sa.Integer(), sa.ForeignKey("avisos_destinatarios.id_destinatario"), nullable=False),
        sa.Column("canal", sa.String(length=20), nullable=False),
        sa.Column("situacao", sa.String(length=30), nullable=False),
        sa.Column("tentativas", sa.Integer(), nullable=False),
        sa.Column("proxima_tentativa_em", sa.DateTime(), nullable=True),
        sa.Column("pego_em", sa.DateTime(), nullable=True),
        sa.Column("ultimo_erro", sa.String(length=300), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("enviado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_destinatario", "canal", name="uq_entrega_de_aviso_canal"),
    )
    for coluna in _INDICES:
        op.create_index(f"ix_entregas_de_aviso_{coluna}", "entregas_de_aviso", [coluna])
    _marcar(op.get_bind(), True)


def downgrade() -> None:
    _marcar(op.get_bind(), False)
    for coluna in reversed(_INDICES):
        op.drop_index(f"ix_entregas_de_aviso_{coluna}", table_name="entregas_de_aviso")
    op.drop_table("entregas_de_aviso")
    with op.batch_alter_table("avisos") as lote:
        lote.drop_column("por_email")
