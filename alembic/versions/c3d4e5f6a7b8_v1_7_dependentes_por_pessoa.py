"""v1.7 (FASE 1): dependentes_familiares passa a ser chaveado por Pessoa, não Associado

Até aqui, um dependente só podia ser registrado se JÁ fosse Associado - o que impedia o caso
mais comum (filho menor sem cadastro nenhum ainda). Migra id_titular/id_associado_vinculado
(associados) para id_pessoa_titular/id_pessoa_vinculada (pessoas), via join, com verificação de
contagem (mesmo rigor de a5b6c7d8e9f0/a1b2c3d4e5f6).

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-15 11:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("dependentes_familiares", sa.Column("id_pessoa_titular", sa.Integer(), nullable=True))
    op.add_column("dependentes_familiares", sa.Column("id_pessoa_vinculada", sa.Integer(), nullable=True))

    bind = op.get_bind()
    dependentes = sa.table(
        "dependentes_familiares",
        sa.column("id_dependente", sa.Integer), sa.column("id_titular", sa.Integer),
        sa.column("id_associado_vinculado", sa.Integer),
        sa.column("id_pessoa_titular", sa.Integer), sa.column("id_pessoa_vinculada", sa.Integer),
    )
    associados = sa.table("associados", sa.column("id_associado", sa.Integer), sa.column("id_pessoa", sa.Integer))
    mapa_associado_pessoa = dict(bind.execute(sa.select(associados.c.id_associado, associados.c.id_pessoa)).fetchall())

    total = 0
    migrados = 0
    for id_dependente, id_titular, id_associado_vinculado in bind.execute(
        sa.select(dependentes.c.id_dependente, dependentes.c.id_titular, dependentes.c.id_associado_vinculado)
    ):
        total += 1
        id_pessoa_titular = mapa_associado_pessoa.get(id_titular)
        id_pessoa_vinculada = mapa_associado_pessoa.get(id_associado_vinculado)
        if id_pessoa_titular is not None and id_pessoa_vinculada is not None:
            bind.execute(
                dependentes.update().where(dependentes.c.id_dependente == id_dependente)
                .values(id_pessoa_titular=id_pessoa_titular, id_pessoa_vinculada=id_pessoa_vinculada)
            )
            migrados += 1

    if migrados != total:
        raise RuntimeError(
            f"Backfill de dependentes_familiares incompleto: {migrados}/{total} migrados. "
            "Abortando para não perder o vínculo de nenhum dependente."
        )

    with op.batch_alter_table("dependentes_familiares") as batch_op:
        batch_op.alter_column("id_pessoa_titular", nullable=False)
        batch_op.alter_column("id_pessoa_vinculada", nullable=False)
        batch_op.create_foreign_key("fk_dependentes_pessoa_titular", "pessoas", ["id_pessoa_titular"], ["id_pessoa"])
        batch_op.create_foreign_key("fk_dependentes_pessoa_vinculada", "pessoas", ["id_pessoa_vinculada"], ["id_pessoa"])
        batch_op.drop_constraint("uq_familia_titular_vinculado", type_="unique")
        batch_op.create_unique_constraint("uq_familia_titular_vinculado", ["id_pessoa_titular", "id_pessoa_vinculada"])
        batch_op.drop_column("id_titular")
        batch_op.drop_column("id_associado_vinculado")


def downgrade() -> None:
    op.add_column("dependentes_familiares", sa.Column("id_titular", sa.Integer(), nullable=True))
    op.add_column("dependentes_familiares", sa.Column("id_associado_vinculado", sa.Integer(), nullable=True))

    bind = op.get_bind()
    dependentes = sa.table(
        "dependentes_familiares",
        sa.column("id_dependente", sa.Integer), sa.column("id_titular", sa.Integer),
        sa.column("id_associado_vinculado", sa.Integer),
        sa.column("id_pessoa_titular", sa.Integer), sa.column("id_pessoa_vinculada", sa.Integer),
    )
    associados = sa.table("associados", sa.column("id_associado", sa.Integer), sa.column("id_pessoa", sa.Integer))
    mapa_pessoa_associado = dict(bind.execute(sa.select(associados.c.id_pessoa, associados.c.id_associado)).fetchall())

    for id_dependente, id_pessoa_titular, id_pessoa_vinculada in bind.execute(
        sa.select(dependentes.c.id_dependente, dependentes.c.id_pessoa_titular, dependentes.c.id_pessoa_vinculada)
    ):
        id_titular = mapa_pessoa_associado.get(id_pessoa_titular)
        id_associado_vinculado = mapa_pessoa_associado.get(id_pessoa_vinculada)
        if id_titular is not None and id_associado_vinculado is not None:
            bind.execute(
                dependentes.update().where(dependentes.c.id_dependente == id_dependente)
                .values(id_titular=id_titular, id_associado_vinculado=id_associado_vinculado)
            )
        # Dependente de pessoa que nunca foi associada (o próprio motivo da v1.7) não tem como
        # voltar pro formato antigo - fica NULL no downgrade (perda aceitável, é rollback).

    with op.batch_alter_table("dependentes_familiares") as batch_op:
        batch_op.create_foreign_key("fk_dependentes_titular", "associados", ["id_titular"], ["id_associado"])
        batch_op.create_foreign_key("fk_dependentes_vinculado", "associados", ["id_associado_vinculado"], ["id_associado"])
        batch_op.drop_constraint("uq_familia_titular_vinculado", type_="unique")
        batch_op.create_unique_constraint("uq_familia_titular_vinculado", ["id_titular", "id_associado_vinculado"])
        batch_op.drop_column("id_pessoa_titular")
        batch_op.drop_column("id_pessoa_vinculada")
