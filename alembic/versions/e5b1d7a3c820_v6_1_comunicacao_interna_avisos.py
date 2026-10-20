"""v6.1 (FASE 6): comunicação interna no painel - avisos, quem os recebeu e a permissão `comunicar`

Cria `avisos` (o aviso do mural, com a regra do grupo que o recebe) e `avisos_destinatarios` (quem estava no grupo quando o aviso foi publicado, e quando leu e confirmou: a prova).
Nenhum dado existente é apagado.

Decisão do Presidente (2026-10-20): quem publica são o Presidente e os Secretários. NOS BANCOS QUE JÁ EXISTEM esta migração faz o que o semeador não faz (o semeador repõe, a cada
partida, as atribuições padrão dos NÍVEIS, mas nunca mexe nos cargos de um catálogo que já existe):
  1. garante a permissão `comunicar` (módulo `comunicacao`);
  2. dá `comunicar` a todo nível de acesso que tem `gerenciar_acesso` (a Presidência);
  3. acrescenta `comunicar` aos cargos PRESIDENTE, SECRETARIO (1º Secretário) e VICE_SECRETARIO (2º Secretário) do catálogo `titulo_cargo` (o cargo concede permissões enquanto o mandato vale).
Nenhuma outra permissão, nível ou cargo é tocado. O `downgrade` retira `comunicar` de tudo, apaga a permissão e as duas tabelas.

Revision ID: e5b1d7a3c820
Revises: c4a8e2f6d913
Create Date: 2026-10-20 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'e5b1d7a3c820'
down_revision: Union[str, Sequence[str], None] = 'c4a8e2f6d913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

_INDICES_AVISOS = ("id_aviso", "valido_ate", "publicado_em")
_INDICES_DESTINATARIOS = ("id_destinatario", "id_aviso", "id_associado", "id_usuario")

_permissoes = sa.table(
    "permissoes_sistema", sa.column("id_permissao", sa.Integer), sa.column("modulo", sa.String), sa.column("codigo_permissao", sa.String), sa.column("descricao", sa.String),
)
_perfil = sa.table("perfil_permissao", sa.column("id_nivel", sa.Integer), sa.column("id_permissao", sa.Integer))
_catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
_opcoes = sa.table("opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String), sa.column("metadados", _JSON))

NOVA = "comunicar"
BASE = "gerenciar_acesso"
CARGOS = ("PRESIDENTE", "SECRETARIO", "VICE_SECRETARIO")
DESCRICAO = "Publicar avisos no mural do painel para um grupo calculado, ver quem leu e confirmou, incluir quem entrou no grupo depois e retirar o aviso (v6.1)."


def _criar_tabelas() -> None:
    op.create_table(
        "avisos",
        sa.Column("id_aviso", sa.Integer(), primary_key=True),
        sa.Column("titulo", sa.String(length=150), nullable=False),
        sa.Column("texto", sa.Text(), nullable=False),
        sa.Column("categoria", sa.String(length=40), nullable=False),
        sa.Column("exige_confirmacao", sa.Boolean(), nullable=False),
        sa.Column("valido_ate", sa.Date(), nullable=False),
        sa.Column("publico", _JSON, nullable=False),
        sa.Column("publico_descricao", sa.String(length=400), nullable=False),
        sa.Column("total_destinatarios", sa.Integer(), nullable=False),
        sa.Column("id_usuario_autor", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=False),
        sa.Column("publicado_em", sa.DateTime(), nullable=False),
        sa.Column("retirado_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_retirada", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("motivo_retirada", sa.String(length=500), nullable=True),
        sa.Column("leitura_apagada_em", sa.DateTime(), nullable=True),
        sa.Column("total_lidos", sa.Integer(), nullable=True),
        sa.Column("total_confirmados", sa.Integer(), nullable=True),
    )
    for coluna in _INDICES_AVISOS:
        op.create_index(f"ix_avisos_{coluna}", "avisos", [coluna])

    op.create_table(
        "avisos_destinatarios",
        sa.Column("id_destinatario", sa.Integer(), primary_key=True),
        sa.Column("id_aviso", sa.Integer(), sa.ForeignKey("avisos.id_aviso"), nullable=False),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=True),
        sa.Column("id_usuario", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("tinha_acesso", sa.Boolean(), nullable=False),
        sa.Column("incluido_em", sa.DateTime(), nullable=False),
        sa.Column("lido_em", sa.DateTime(), nullable=True),
        sa.Column("confirmado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_aviso", "id_associado", name="uq_aviso_destinatario_associado"),
        sa.UniqueConstraint("id_aviso", "id_usuario", name="uq_aviso_destinatario_usuario"),
    )
    for coluna in _INDICES_DESTINATARIOS:
        op.create_index(f"ix_avisos_destinatarios_{coluna}", "avisos_destinatarios", [coluna])


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
    _criar_tabelas()
    conexao = op.get_bind()
    id_nova = _id_da_permissao(conexao, NOVA)
    if id_nova is None:
        conexao.execute(sa.insert(_permissoes).values(modulo="comunicacao", codigo_permissao=NOVA, descricao=DESCRICAO))
        id_nova = _id_da_permissao(conexao, NOVA)
    id_base = _id_da_permissao(conexao, BASE)
    if id_base is not None:
        niveis = [linha.id_nivel for linha in conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_permissao == id_base)).all()]
        for id_nivel in niveis:
            ja_tem = conexao.execute(sa.select(_perfil.c.id_nivel).where(_perfil.c.id_nivel == id_nivel, _perfil.c.id_permissao == id_nova)).first()
            if ja_tem is None:
                conexao.execute(sa.insert(_perfil).values(id_nivel=id_nivel, id_permissao=id_nova))
    for cargo in _cargos(conexao):
        atuais = list(cargo.metadados.get("permissoes") or [])
        if cargo.codigo in CARGOS and NOVA not in atuais:
            _trocar_permissoes_do_cargo(conexao, cargo, [*atuais, NOVA])


def downgrade() -> None:
    conexao = op.get_bind()
    for cargo in _cargos(conexao):
        atuais = list(cargo.metadados.get("permissoes") or [])
        if NOVA in atuais:
            _trocar_permissoes_do_cargo(conexao, cargo, [p for p in atuais if p != NOVA])
    id_nova = _id_da_permissao(conexao, NOVA)
    if id_nova is not None:
        conexao.execute(sa.delete(_perfil).where(_perfil.c.id_permissao == id_nova))
        conexao.execute(sa.delete(_permissoes).where(_permissoes.c.id_permissao == id_nova))
    for coluna in reversed(_INDICES_DESTINATARIOS):
        op.drop_index(f"ix_avisos_destinatarios_{coluna}", table_name="avisos_destinatarios")
    op.drop_table("avisos_destinatarios")
    for coluna in reversed(_INDICES_AVISOS):
        op.drop_index(f"ix_avisos_{coluna}", table_name="avisos")
    op.drop_table("avisos")
