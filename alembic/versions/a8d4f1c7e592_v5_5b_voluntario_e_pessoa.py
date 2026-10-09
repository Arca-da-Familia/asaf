"""v5.5b (FASE 5): o voluntário é uma pessoa (não precisa ser associado) e o pedido de voluntariado pelo site

`alocacoes_voluntarios` ganha `id_pessoa` (a pessoa que vai ser escalada; preenchida a partir do associado de cada alocação que já existe; `id_associado` continua e fica
preenchido só quando a pessoa também é associada) e `atendimentos` ganha `data_nascimento` (só no pedido de voluntariado, para a secretaria saber se o termo de adesão
precisa da autorização de um responsável). Nenhum dado existente é apagado.

Revision ID: a8d4f1c7e592
Revises: f2b7d9e4a613
Create Date: 2026-10-09 21:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a8d4f1c7e592'
down_revision: Union[str, Sequence[str], None] = 'f2b7d9e4a613'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("atendimentos") as lote:
        lote.add_column(sa.Column("data_nascimento", sa.DateTime(), nullable=True))

    with op.batch_alter_table("alocacoes_voluntarios") as lote:
        lote.add_column(sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa", name="fk_alocacoes_voluntarios_id_pessoa"), nullable=True))
    # cada alocação que já existe aponta para a pessoa do seu associado
    op.execute(
        "UPDATE alocacoes_voluntarios SET id_pessoa = (SELECT a.id_pessoa FROM associados a WHERE a.id_associado = alocacoes_voluntarios.id_associado)"
    )
    sobrando = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM alocacoes_voluntarios WHERE id_pessoa IS NULL")).scalar()
    if sobrando:
        # nunca apaga nem inventa: uma alocação sem associado (e portanto sem pessoa) pede conferência manual antes de seguir
        raise RuntimeError(f"{sobrando} alocação(ões) de voluntário sem associado: não dá para descobrir a pessoa. Confira antes de migrar.")
    with op.batch_alter_table("alocacoes_voluntarios") as lote:
        lote.alter_column("id_pessoa", existing_type=sa.Integer(), nullable=False)
        lote.create_index("ix_alocacoes_voluntarios_id_pessoa", ["id_pessoa"])


def downgrade() -> None:
    with op.batch_alter_table("alocacoes_voluntarios") as lote:
        lote.drop_index("ix_alocacoes_voluntarios_id_pessoa")
        lote.drop_constraint("fk_alocacoes_voluntarios_id_pessoa", type_="foreignkey")
        lote.drop_column("id_pessoa")
    with op.batch_alter_table("atendimentos") as lote:
        lote.drop_column("data_nascimento")
