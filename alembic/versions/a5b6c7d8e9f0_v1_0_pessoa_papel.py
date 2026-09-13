"""v1.0 (FASE 1): Pessoa/Papel - Associado deixa de duplicar dado pessoal

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-09-13 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, Sequence[str], None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "pessoas",
        sa.Column("id_pessoa", sa.Integer(), primary_key=True, index=True),
        sa.Column("nome_completo", sa.String(), index=True),
        sa.Column("cpf", sa.String(), unique=True, index=True, nullable=True),
        sa.Column("data_nascimento", sa.DateTime(), nullable=True),
        sa.Column("email_contato", sa.String(), nullable=True),
        sa.Column("telefone_whatsapp", sa.String(), nullable=True),
        sa.Column("estado_civil", sa.String(length=50), nullable=True),
        sa.Column("profissao", sa.String(length=100), nullable=True),
        sa.Column("naturalidade", sa.String(length=100), nullable=True),
        sa.Column("foto", sa.String(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "papeis",
        sa.Column("id_papel", sa.Integer(), primary_key=True, index=True),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=False, index=True),
        sa.Column("tipo_papel", sa.String(length=30), nullable=False),
        sa.Column("ativo", sa.Boolean(), server_default=sa.true()),
        sa.Column("criado_em", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("id_pessoa", "tipo_papel", name="uq_papel_pessoa_tipo"),
    )

    associados = sa.table(
        "associados",
        sa.column("id_associado", sa.Integer),
        sa.column("nome_completo", sa.String),
        sa.column("cpf", sa.String),
        sa.column("email_contato", sa.String),
        sa.column("telefone_whatsapp", sa.String),
        sa.column("data_nascimento", sa.DateTime),
        sa.column("estado_civil", sa.String),
        sa.column("profissao", sa.String),
        sa.column("naturalidade", sa.String),
        sa.column("foto", sa.String),
    )
    pessoas = sa.table(
        "pessoas",
        sa.column("id_pessoa", sa.Integer),
        sa.column("nome_completo", sa.String),
        sa.column("cpf", sa.String),
        sa.column("email_contato", sa.String),
        sa.column("telefone_whatsapp", sa.String),
        sa.column("data_nascimento", sa.DateTime),
        sa.column("estado_civil", sa.String),
        sa.column("profissao", sa.String),
        sa.column("naturalidade", sa.String),
        sa.column("foto", sa.String),
    )
    papeis = sa.table(
        "papeis",
        sa.column("id_pessoa", sa.Integer),
        sa.column("tipo_papel", sa.String),
    )

    linhas_associado = bind.execute(sa.select(
        associados.c.id_associado, associados.c.nome_completo, associados.c.cpf,
        associados.c.email_contato, associados.c.telefone_whatsapp, associados.c.data_nascimento,
        associados.c.estado_civil, associados.c.profissao, associados.c.naturalidade, associados.c.foto,
    )).fetchall()

    total_associados_antes = len(linhas_associado)

    op.add_column("associados", sa.Column("id_pessoa", sa.Integer(), nullable=True))

    for linha in linhas_associado:
        resultado = bind.execute(
            pessoas.insert().values(
                nome_completo=linha.nome_completo, cpf=linha.cpf, email_contato=linha.email_contato,
                telefone_whatsapp=linha.telefone_whatsapp, data_nascimento=linha.data_nascimento,
                estado_civil=linha.estado_civil, profissao=linha.profissao, naturalidade=linha.naturalidade,
                foto=linha.foto,
            ).returning(pessoas.c.id_pessoa)
        )
        id_pessoa = resultado.scalar_one()

        bind.execute(
            sa.text('UPDATE associados SET id_pessoa = :id_pessoa WHERE id_associado = :id_associado'),
            {"id_pessoa": id_pessoa, "id_associado": linha.id_associado},
        )
        bind.execute(papeis.insert().values(id_pessoa=id_pessoa, tipo_papel="associado"))

    # Verificação de contagem antes/depois (mesmo rigor da migração de catálogo v0.3.1): toda
    # linha de associados tem que ter virado exatamente uma pessoa e um papel "associado".
    total_pessoas_depois = bind.execute(sa.select(sa.func.count()).select_from(pessoas)).scalar_one()
    total_papeis_depois = bind.execute(sa.select(sa.func.count()).select_from(papeis)).scalar_one()
    if total_pessoas_depois != total_associados_antes or total_papeis_depois != total_associados_antes:
        raise RuntimeError(
            f"Migração de Pessoa/Papel inconsistente: {total_associados_antes} associados, "
            f"{total_pessoas_depois} pessoas criadas, {total_papeis_depois} papéis criados - "
            "deveria ser igual nos três. Abortando (transação será revertida)."
        )

    with op.batch_alter_table("associados") as batch_op:
        batch_op.alter_column("id_pessoa", nullable=False)
        batch_op.create_foreign_key("fk_associados_pessoa", "pessoas", ["id_pessoa"], ["id_pessoa"])
        batch_op.drop_column("nome_completo")
        batch_op.drop_column("cpf")
        batch_op.drop_column("email_contato")
        batch_op.drop_column("telefone_whatsapp")
        batch_op.drop_column("data_nascimento")
        batch_op.drop_column("estado_civil")
        batch_op.drop_column("profissao")
        batch_op.drop_column("naturalidade")
        batch_op.drop_column("foto")


def downgrade() -> None:
    with op.batch_alter_table("associados") as batch_op:
        batch_op.add_column(sa.Column("nome_completo", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("cpf", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("email_contato", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("telefone_whatsapp", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("data_nascimento", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("estado_civil", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("profissao", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("naturalidade", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("foto", sa.String(), nullable=True))

    bind = op.get_bind()
    bind.execute(sa.text("""
        UPDATE associados SET
            nome_completo = pessoas.nome_completo, cpf = pessoas.cpf,
            email_contato = pessoas.email_contato, telefone_whatsapp = pessoas.telefone_whatsapp,
            data_nascimento = pessoas.data_nascimento, estado_civil = pessoas.estado_civil,
            profissao = pessoas.profissao, naturalidade = pessoas.naturalidade, foto = pessoas.foto
        FROM pessoas WHERE pessoas.id_pessoa = associados.id_pessoa
    """))

    with op.batch_alter_table("associados") as batch_op:
        batch_op.drop_constraint("fk_associados_pessoa", type_="foreignkey")
        batch_op.drop_column("id_pessoa")

    op.drop_table("papeis")
    op.drop_table("pessoas")
