"""v7.0a (FASE 7): o encarregado pelo tratamento de dados com ato formal e substituto - a tabela `atos_do_encarregado` e as permissões `privacidade` e `privacidade_gerir`

Cria `atos_do_encarregado` (o ato de designação gerado pelo sistema, com o texto guardado como foi gerado e a cópia assinada no armazenamento privado). Nenhum dado
existente é apagado.

NOS BANCOS QUE JÁ EXISTEM esta migração faz o que o semeador não faz (o semeador repõe, a cada partida, as atribuições padrão dos NÍVEIS, mas nunca mexe nos cargos de
um catálogo que já existe):
  1. garante as permissões `privacidade` (ver o módulo) e `privacidade_gerir` (gerar o ato e registrar a cópia assinada), módulo `privacidade`;
  2. dá as duas a todo nível de acesso que tem `gerenciar_acesso` (a Presidência);
  3. no catálogo `titulo_cargo`: as duas ao cargo PRESIDENTE (o encarregado, decisão do Presidente de 2026-10-09) e só `privacidade` (ver) aos cargos VICE_PRESIDENTE
     e VICE_PRESIDENTE_2 (os Vice-Presidentes substituem o Presidente, Estatuto art. 21, parágrafo único; privilégio mínimo: não trocam o ato que o Presidente assinou).
Nenhuma outra permissão, nível ou cargo é tocado. O `downgrade` retira as duas de tudo, apaga as permissões e a tabela.

Revision ID: 56d7ae211884
Revises: e8a2c4f6b913
Create Date: 2026-10-23 15:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '56d7ae211884'
down_revision: Union[str, Sequence[str], None] = 'e8a2c4f6b913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

_permissoes = sa.table(
    "permissoes_sistema", sa.column("id_permissao", sa.Integer), sa.column("modulo", sa.String), sa.column("codigo_permissao", sa.String), sa.column("descricao", sa.String),
)
_perfil = sa.table("perfil_permissao", sa.column("id_nivel", sa.Integer), sa.column("id_permissao", sa.Integer))
_catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
_opcoes = sa.table("opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String), sa.column("metadados", _JSON))

BASE = "gerenciar_acesso"
# permissão -> (descrição, cargos que a recebem)
NOVAS = {
    "privacidade": (
        "Programa de privacidade (LGPD): ver o encarregado pelo tratamento de dados, o substituto e o ato de designação, e baixar a cópia assinada (v7.0a).",
        ("PRESIDENTE", "VICE_PRESIDENTE", "VICE_PRESIDENTE_2"),
    ),
    "privacidade_gerir": (
        "Programa de privacidade (LGPD): gerar o ato de designação do encarregado e registrar a cópia assinada (v7.0a - separada de 'privacidade' de propósito: só o Presidente).",
        ("PRESIDENTE",),
    ),
}


def _criar_tabela() -> None:
    op.create_table(
        "atos_do_encarregado",
        sa.Column("id_ato", sa.Integer(), primary_key=True),
        sa.Column("numero", sa.Integer(), nullable=False),
        sa.Column("situacao", sa.String(length=30), nullable=False),
        sa.Column("texto", sa.Text(), nullable=False),
        sa.Column("id_associado_encarregado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("nome_encarregado", sa.String(length=200), nullable=False),
        sa.Column("id_associado_substituto", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=True),
        sa.Column("nome_substituto", sa.String(length=200), nullable=True),
        sa.Column("cargo_substituto", sa.String(length=80), nullable=True),
        sa.Column("gerado_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_geracao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.Column("assinado_arquivo", sa.String(length=150), nullable=True),
        sa.Column("assinado_nome_arquivo", sa.String(length=200), nullable=True),
        sa.Column("assinado_sha256", sa.String(length=64), nullable=True),
        sa.Column("assinado_tamanho", sa.Integer(), nullable=True),
        sa.Column("assinatura_registrada_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_assinatura", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("encerrado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("numero"),
    )
    op.create_index("ix_atos_do_encarregado_id_ato", "atos_do_encarregado", ["id_ato"])
    op.create_index("ix_atos_do_encarregado_situacao", "atos_do_encarregado", ["situacao"])
    # no máximo UM ato aguardando assinatura e UM vigente (índice único parcial; ver app/models/privacidade.py)
    for nome, situacao in (("uq_atos_do_encarregado_um_aguardando", "Aguardando assinatura"), ("uq_atos_do_encarregado_um_vigente", "Vigente")):
        condicao = sa.text(f"situacao = '{situacao}'")
        op.create_index(nome, "atos_do_encarregado", ["situacao"], unique=True, postgresql_where=condicao, sqlite_where=condicao)


def _id_da_permissao(conexao, codigo: str):
    return conexao.execute(sa.select(_permissoes.c.id_permissao).where(_permissoes.c.codigo_permissao == codigo)).scalar()


def _cargos(conexao):
    id_catalogo = conexao.execute(sa.select(_catalogos.c.id_catalogo).where(_catalogos.c.chave == "titulo_cargo")).scalar()
    if id_catalogo is None:
        return []
    achados = conexao.execute(sa.select(_opcoes.c.id_opcao, _opcoes.c.codigo, _opcoes.c.metadados).where(_opcoes.c.id_catalogo == id_catalogo)).all()
    return [a for a in achados if isinstance(a.metadados, dict)]


def _trocar_permissoes_do_cargo(conexao, cargo, novas: list[str]) -> None:
    conexao.execute(sa.update(_opcoes).where(_opcoes.c.id_opcao == cargo.id_opcao).values(metadados={**cargo.metadados, "permissoes": novas}))


def upgrade() -> None:
    _criar_tabela()
    conexao = op.get_bind()
    id_base = _id_da_permissao(conexao, BASE)
    niveis = [linha.id_nivel for linha in conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_permissao == id_base)).all()] if id_base is not None else []
    for codigo, (descricao, cargos) in NOVAS.items():
        id_nova = _id_da_permissao(conexao, codigo)
        if id_nova is None:
            conexao.execute(sa.insert(_permissoes).values(modulo="privacidade", codigo_permissao=codigo, descricao=descricao))
            id_nova = _id_da_permissao(conexao, codigo)
        for id_nivel in niveis:
            ja_tem = conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_nivel == id_nivel, _perfil.c.id_permissao == id_nova)).first()
            if ja_tem is None:
                conexao.execute(sa.insert(_perfil).values(id_nivel=id_nivel, id_permissao=id_nova))
        for cargo in _cargos(conexao):  # relido a cada permissão: a anterior pode ter mudado os metadados do cargo
            atuais = list(cargo.metadados.get("permissoes") or [])
            if cargo.codigo in cargos and codigo not in atuais:
                _trocar_permissoes_do_cargo(conexao, cargo, [*atuais, codigo])


def downgrade() -> None:
    conexao = op.get_bind()
    for cargo in _cargos(conexao):
        atuais = list(cargo.metadados.get("permissoes") or [])
        if any(p in NOVAS for p in atuais):
            _trocar_permissoes_do_cargo(conexao, cargo, [p for p in atuais if p not in NOVAS])
    for codigo in NOVAS:
        id_nova = _id_da_permissao(conexao, codigo)
        if id_nova is not None:
            conexao.execute(sa.delete(_perfil).where(_perfil.c.id_permissao == id_nova))
            conexao.execute(sa.delete(_permissoes).where(_permissoes.c.id_permissao == id_nova))
    op.drop_index("uq_atos_do_encarregado_um_vigente", table_name="atos_do_encarregado")
    op.drop_index("uq_atos_do_encarregado_um_aguardando", table_name="atos_do_encarregado")
    op.drop_index("ix_atos_do_encarregado_situacao", table_name="atos_do_encarregado")
    op.drop_index("ix_atos_do_encarregado_id_ato", table_name="atos_do_encarregado")
    op.drop_table("atos_do_encarregado")
