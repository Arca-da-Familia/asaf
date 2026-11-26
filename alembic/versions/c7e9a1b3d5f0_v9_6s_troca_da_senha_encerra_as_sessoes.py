"""v9.6s: trocar a senha encerra todo token anterior da conta (I1 da revisão de portão de 25/11/2026, o resto do achado A3)

O access token (45 minutos) tirado antes da troca da senha continuava valendo depois dela: quem concedeu o acesso, e por isso conhecia a senha
provisória, entrava antes do dono, guardava o token e seguia operando a conta depois que o dono trocava a senha. Esta migração acrescenta
`usuarios.versao_da_sessao` (sobe a cada troca de senha; o número vai dentro do token, e o de versão anterior é recusado). Todos começam em 0, e
o token emitido antes desta subida, sem o número, vale como 0: ninguém cai fora na subida. Nenhum usuário, senha ou segredo muda.

Revision ID: c7e9a1b3d5f0
Revises: b4d6f8a0c2e9
Create Date: 2026-11-26 10:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c7e9a1b3d5f0'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c2e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("usuarios") as tabela:
        tabela.add_column(sa.Column("versao_da_sessao", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("usuarios") as tabela:
        tabela.drop_column("versao_da_sessao")
