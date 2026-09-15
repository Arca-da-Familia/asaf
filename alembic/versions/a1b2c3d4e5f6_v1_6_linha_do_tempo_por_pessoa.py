"""v1.6 (FASE 1): eventos_linha_do_tempo passa a ser chaveado por id_pessoa, não id_associado

Achado corrigido nesta versão: a v1.5 nasceu com `id_associado`, mas voluntário/funcionário
(v1.6) são papéis que uma Pessoa pode ter SEM nunca ser Associado - é exatamente o que o modelo
Pessoa/Papel da v1.0 foi desenhado para permitir. Corrigido antes que outro módulo passasse a
depender da chave errada.

Revision ID: a1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-09-15 09:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'f0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("eventos_linha_do_tempo", sa.Column("id_pessoa", sa.Integer(), nullable=True))

    bind = op.get_bind()
    eventos = sa.table(
        "eventos_linha_do_tempo",
        sa.column("id_evento", sa.Integer), sa.column("id_associado", sa.Integer), sa.column("id_pessoa", sa.Integer),
    )
    associados = sa.table("associados", sa.column("id_associado", sa.Integer), sa.column("id_pessoa", sa.Integer))

    mapa_associado_pessoa = dict(bind.execute(sa.select(associados.c.id_associado, associados.c.id_pessoa)).fetchall())
    total_eventos = 0
    total_migrados = 0
    for id_evento, id_associado in bind.execute(sa.select(eventos.c.id_evento, eventos.c.id_associado)):
        total_eventos += 1
        id_pessoa = mapa_associado_pessoa.get(id_associado)
        if id_pessoa is not None:
            bind.execute(eventos.update().where(eventos.c.id_evento == id_evento).values(id_pessoa=id_pessoa))
            total_migrados += 1

    # Mesma trava de segurança das migrações anteriores (ex.: a5b6c7d8e9f0): se algum evento não
    # encontrou o id_pessoa correspondente (associado apagado sem cascade, dado corrompido), a
    # migração aborta em vez de silenciosamente perder o vínculo do evento com sua pessoa.
    if total_migrados != total_eventos:
        raise RuntimeError(
            f"Backfill de id_pessoa incompleto: {total_migrados}/{total_eventos} eventos migrados. "
            "Abortando para não perder o vínculo de nenhum evento."
        )

    with op.batch_alter_table("eventos_linha_do_tempo") as batch_op:
        batch_op.alter_column("id_pessoa", nullable=False)
        batch_op.create_foreign_key("fk_eventos_linha_do_tempo_pessoa", "pessoas", ["id_pessoa"], ["id_pessoa"])
        # O índice original (`ix_eventos_linha_do_tempo_id_associado`, criado em f0a1b2c3d4e5)
        # precisa cair explicitamente ANTES da coluna - senão o batch mode do SQLite tenta
        # recriar um índice sobre uma coluna que acabou de ser removida na mesma tacada.
        batch_op.drop_index("ix_eventos_linha_do_tempo_id_associado")
        batch_op.drop_column("id_associado")
        batch_op.create_index("ix_eventos_linha_do_tempo_id_pessoa", ["id_pessoa"])


def downgrade() -> None:
    op.add_column("eventos_linha_do_tempo", sa.Column("id_associado", sa.Integer(), nullable=True))

    bind = op.get_bind()
    eventos = sa.table(
        "eventos_linha_do_tempo",
        sa.column("id_evento", sa.Integer), sa.column("id_associado", sa.Integer), sa.column("id_pessoa", sa.Integer),
    )
    associados = sa.table("associados", sa.column("id_associado", sa.Integer), sa.column("id_pessoa", sa.Integer))
    mapa_pessoa_associado = dict(bind.execute(sa.select(associados.c.id_pessoa, associados.c.id_associado)).fetchall())
    for id_evento, id_pessoa in bind.execute(sa.select(eventos.c.id_evento, eventos.c.id_pessoa)):
        id_associado = mapa_pessoa_associado.get(id_pessoa)
        if id_associado is not None:
            bind.execute(eventos.update().where(eventos.c.id_evento == id_evento).values(id_associado=id_associado))
        # Evento de pessoa que nunca foi associado (voluntário/funcionário puro, v1.6) não tem
        # id_associado pra voltar - fica NULL no downgrade (perda aceitável, é rollback).

    with op.batch_alter_table("eventos_linha_do_tempo") as batch_op:
        batch_op.create_foreign_key("fk_eventos_linha_do_tempo_associado", "associados", ["id_associado"], ["id_associado"])
        batch_op.drop_index("ix_eventos_linha_do_tempo_id_pessoa")
        batch_op.drop_column("id_pessoa")
        batch_op.create_index("ix_eventos_linha_do_tempo_id_associado", ["id_associado"])
