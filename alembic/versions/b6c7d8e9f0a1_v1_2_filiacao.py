"""v1.2 (FASE 1): filiação - propostas_filiacao, matrícula sequencial, período de experiência

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-09-14 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b6c7d8e9f0a1'
down_revision: Union[str, Sequence[str], None] = 'a5b6c7d8e9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "propostas_filiacao",
        sa.Column("id_proposta", sa.Integer(), primary_key=True, index=True),
        sa.Column("nome_completo", sa.String(), nullable=False),
        sa.Column("cpf", sa.String(), nullable=False, index=True),
        sa.Column("email_contato", sa.String(), nullable=True),
        sa.Column("telefone_whatsapp", sa.String(), nullable=True),
        sa.Column("data_nascimento", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), server_default="Pendente", index=True),
        sa.Column("motivo_recusa", sa.String(), nullable=True),
        sa.Column("id_associado_efetivado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.Column("atualizado_em", sa.DateTime(), nullable=True),
    )

    op.add_column("associados", sa.Column("numero_matricula", sa.Integer(), nullable=True))
    op.create_unique_constraint("uq_associados_numero_matricula", "associados", ["numero_matricula"])
    op.add_column("associados", sa.Column("data_fim_experiencia", sa.DateTime(), nullable=True))

    # Backfill: associados já existentes ganham matrícula sequencial na ordem de id_associado -
    # o primeiro associado do sistema (id_associado=1) vira matrícula 1.
    bind = op.get_bind()
    associados = sa.table("associados", sa.column("id_associado", sa.Integer), sa.column("numero_matricula", sa.Integer))
    linhas = bind.execute(sa.select(associados.c.id_associado).order_by(associados.c.id_associado)).fetchall()
    for numero, linha in enumerate(linhas, start=1):
        bind.execute(
            sa.text("UPDATE associados SET numero_matricula = :numero WHERE id_associado = :id"),
            {"numero": numero, "id": linha.id_associado},
        )

    # "Em Experiência" é opção nova no catálogo de sistema status_arrolamento (editavel_pelo_usuario=False,
    # não aceita opção nova via API) - inserida direto, idempotente (não duplica se já existir).
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
                opcoes.c.id_catalogo == catalogo_status.id_catalogo, opcoes.c.codigo == "EM_EXPERIENCIA"
            )
        ).first()
        if not ja_existe:
            bind.execute(
                opcoes.insert().values(
                    id_catalogo=catalogo_status.id_catalogo, codigo="EM_EXPERIENCIA",
                    rotulo="Em Experiência", ordem=0, ativo=True,
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    catalogos = sa.table("catalogos", sa.column("id_catalogo", sa.Integer), sa.column("chave", sa.String))
    opcoes = sa.table("opcoes_catalogo", sa.column("id_catalogo", sa.Integer), sa.column("codigo", sa.String))
    catalogo_status = bind.execute(sa.select(catalogos.c.id_catalogo).where(catalogos.c.chave == "status_arrolamento")).first()
    if catalogo_status:
        bind.execute(
            opcoes.delete().where(opcoes.c.id_catalogo == catalogo_status.id_catalogo, opcoes.c.codigo == "EM_EXPERIENCIA")
        )

    with op.batch_alter_table("associados") as batch_op:
        batch_op.drop_column("data_fim_experiencia")
        batch_op.drop_constraint("uq_associados_numero_matricula", type_="unique")
        batch_op.drop_column("numero_matricula")

    op.drop_table("propostas_filiacao")
