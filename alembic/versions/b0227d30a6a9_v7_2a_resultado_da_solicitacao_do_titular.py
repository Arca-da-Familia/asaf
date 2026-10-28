"""v7.2a (FASE 7): o RESULTADO de cada solicitação do titular (atendido, em parte, não atendido, encerrado sem resposta), o FUNDAMENTO de quando ela não é
atendida por inteiro e se o pedido foi feito por um dos pais ou pelo responsável legal (decisões do Presidente, 2026-10-28).

Revision ID: b0227d30a6a9
Revises: a3c5e7f9b1d2
Create Date: 2026-10-28 00:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b0227d30a6a9'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("atendimentos") as tabela:
        tabela.add_column(sa.Column("resultado", sa.String(30), nullable=True))
        tabela.add_column(sa.Column("fundamento", sa.String(40), nullable=True))
        tabela.add_column(sa.Column("por_representante", sa.Boolean(), nullable=True))
    # o pedido já encerrado sem resposta ganha o resultado que ele teve; o respondido antes da v7.2a fica sem resultado (não se adivinha se foi atendido por inteiro)
    op.execute("UPDATE atendimentos SET resultado = 'ENCERRADO_SEM_RESPOSTA' WHERE tipo = 'TITULAR_LGPD' AND status = 'Encerrado' AND respondido_em IS NULL")
    # a regra do prazo diz o teto (a descrição gravada no banco que já existe não é reescrita pela carga inicial)
    op.execute("UPDATE configuracoes_institucionais SET descricao = 'Nunca mais que 15 dias (LGPD, art. 19, II): um valor maior é ignorado. ' || descricao "
               "WHERE chave_configuracao = 'PRAZO_DIAS_TITULAR_LGPD' AND descricao NOT LIKE 'Nunca mais que 15 dias%'")


def downgrade() -> None:
    with op.batch_alter_table("atendimentos") as tabela:
        tabela.drop_column("por_representante")
        tabela.drop_column("fundamento")
        tabela.drop_column("resultado")
