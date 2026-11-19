"""v9.5i: a credencial do associado com QR que vale sempre (decisão do Presidente, 14/11/2026)

Cria `credenciais`: cada credencial tem um código sorteado (o que vai no QR), quando foi emitida e por quem, e quando deixou de valer (ao "emitir outra"
ou na junção de cadastros). Nenhum dado existente é tocado: a credencial de cada associado nasce quando ela é aberta pela primeira vez.

A descrição da regra DIAS_VALIDADE_CARTEIRINHA (Regras do sistema) passa a dizer que ela vale só para o QR antigo - SÓ se ainda for exatamente o texto que
o sistema gravou (descrição editada por alguém fica como está); o `downgrade` volta o texto do mesmo jeito.

Revision ID: c4e8a1f7d2b9
Revises: 9e3f1a7c5b20
Create Date: 2026-11-18 15:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c4e8a1f7d2b9'
down_revision: Union[str, Sequence[str], None] = '9e3f1a7c5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_REGRA = "DIAS_VALIDADE_CARTEIRINHA"
_TEXTO_ANTIGO = 'Dias que o QR da carteirinha digital vale a partir do momento em que é gerado, de 1 a 20 (a verificação pública, a foto dela, a portaria e o credenciamento deixam de aceitá-lo depois disso).'
_TEXTO_NOVO = 'Só para o QR antigo da carteirinha (o de antes da credencial, até 19/11/2026): dias que ele ainda vale a partir de quando foi gerado, de 1 a 20. A credencial nova não vence: quem lê o QR dela vê a situação de agora.'


def _trocar_descricao(de: str, para: str) -> None:
    op.get_bind().execute(
        sa.text("UPDATE configuracoes_institucionais SET descricao = :para WHERE chave_configuracao = :chave AND descricao = :de"),
        {"para": para, "chave": _REGRA, "de": de},
    )


def upgrade() -> None:
    op.create_table(
        "credenciais",
        sa.Column("id_credencial", sa.Integer(), primary_key=True),
        sa.Column("id_associado", sa.Integer(), sa.ForeignKey("associados.id_associado"), nullable=False),
        sa.Column("codigo", sa.String(length=40), nullable=False),
        sa.Column("emitida_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_emissao", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("substituida_em", sa.DateTime(), nullable=True),
        sa.Column("motivo_substituicao", sa.String(length=30), nullable=True),
    )
    op.create_index("ix_credenciais_id_credencial", "credenciais", ["id_credencial"])
    op.create_index("ix_credenciais_id_associado", "credenciais", ["id_associado"])
    op.create_index("ix_credenciais_codigo", "credenciais", ["codigo"], unique=True)
    _trocar_descricao(_TEXTO_ANTIGO, _TEXTO_NOVO)


def downgrade() -> None:
    _trocar_descricao(_TEXTO_NOVO, _TEXTO_ANTIGO)
    op.drop_index("ix_credenciais_codigo", table_name="credenciais")
    op.drop_index("ix_credenciais_id_associado", table_name="credenciais")
    op.drop_index("ix_credenciais_id_credencial", table_name="credenciais")
    op.drop_table("credenciais")
