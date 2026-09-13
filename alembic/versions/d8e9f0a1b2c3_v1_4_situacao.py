"""v1.4 (FASE 1): mudancas_situacao, licença/desligamento, catálogo LICENCIADO

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-09-14 18:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mudancas_situacao",
        sa.Column("id_mudanca", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False, index=True),
        sa.Column("tipo", sa.String(length=30), nullable=False),
        sa.Column("motivo", sa.String(length=50), nullable=True),
        sa.Column("data_efetiva", sa.DateTime(), nullable=False),
        sa.Column("data_fim_prevista", sa.DateTime(), nullable=True),
        sa.Column("documento_referencia", sa.String(), nullable=True),
        sa.Column("id_usuario_registrou", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )
    op.add_column("associados", sa.Column("data_fim_licenca", sa.DateTime(), nullable=True))
    op.add_column("associados", sa.Column("data_desligamento", sa.DateTime(), nullable=True))

    # "Licenciado" é opção nova no catálogo de sistema status_arrolamento (mesmo padrão da
    # migração b6c7d8e9f0a1 que inseriu "Em Experiência") - idempotente.
    bind = op.get_bind()
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
    opcoes = sa.table(
        "opcoes_catalogo", sa.column("id_opcao", sa.Integer), sa.column("id_catalogo", sa.Integer),
        sa.column("codigo", sa.String), sa.column("rotulo", sa.String), sa.column("ordem", sa.Integer),
        sa.column("ativo", sa.Boolean),
    )
    catalogo_status = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "status_arrolamento")).first()
    if catalogo_status:
        ja_existe = bind.execute(
            sa.select(opcoes.c.id_opcao).where(
                opcoes.c.id_catalogo == catalogo_status.id_catalogo, opcoes.c.codigo == "LICENCIADO"
            )
        ).first()
        if not ja_existe:
            bind.execute(
                opcoes.insert().values(
                    id_catalogo=catalogo_status.id_catalogo, codigo="LICENCIADO",
                    rotulo="Licenciado", ordem=0, ativo=True,
                )
            )

    # Catálogo motivo_licenca é inteiramente novo (não uma opção a mais num catálogo existente)
    # - idempotente: só cria se ainda não existir (mesmo raciocínio de seed_catalogos).
    ja_existe_catalogo = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "motivo_licenca")).first()
    if not ja_existe_catalogo:
        catalogos_completa = sa.table(
            "catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String),
            sa.column("nome_exibido", sa.String), sa.column("editavel_pelo_usuario", sa.Boolean),
        )
        resultado = bind.execute(
            catalogos_completa.insert().values(
                chave="motivo_licenca", nome_exibido="Motivo de licença", editavel_pelo_usuario=True,
            ).returning(catalogos_completa.c.id_catalogo)
        )
        id_catalogo_licenca = resultado.scalar_one()
        for i, (codigo, rotulo) in enumerate([
            ("SAUDE", "Saúde"), ("MOTIVO_PESSOAL", "Motivo pessoal"),
            ("MUDANCA_TEMPORARIA", "Mudança temporária de cidade"), ("ESTUDO", "Estudo"),
        ]):
            bind.execute(opcoes.insert().values(id_catalogo=id_catalogo_licenca, codigo=codigo, rotulo=rotulo, ordem=i, ativo=True))


def downgrade() -> None:
    bind = op.get_bind()
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
    opcoes = sa.table("opcoes_catalogo", sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String))
    catalogo_status = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "status_arrolamento")).first()
    if catalogo_status:
        bind.execute(opcoes.delete().where(opcoes.c.id_catalogo == catalogo_status.id_catalogo, opcoes.c.codigo == "LICENCIADO"))

    catalogo_licenca = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "motivo_licenca")).first()
    if catalogo_licenca:
        bind.execute(opcoes.delete().where(opcoes.c.id_catalogo == catalogo_licenca.id_catalogo))
        bind.execute(catalogos.delete().where(catalogos.c.id_catalogo == catalogo_licenca.id_catalogo))

    with op.batch_alter_table("associados") as batch_op:
        batch_op.drop_column("data_desligamento")
        batch_op.drop_column("data_fim_licenca")

    op.drop_table("mudancas_situacao")
