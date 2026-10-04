"""v5.4b (FASE 5): versão pública de documento em TEXTO (além do PDF)

Documento pode ter como versão pública um PDF (com texto pesquisável) OU o próprio texto, colado no sistema: o caso do
estatuto, que existe como PDF registrado em cartório (com assinaturas, original INTERNO) e como transcrição em texto (que o
site mostra, sem assinaturas). Acrescenta `documentos_institucionais.publico_formato` ("PDF" | "TEXTO") e marca como PDF o que
já tem versão pública guardada em arquivo. Nada mais é tocado.

Revision ID: e8b3c5a1f720
Revises: d3f7a9c2e154
Create Date: 2026-10-04 16:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e8b3c5a1f720'
down_revision: Union[str, Sequence[str], None] = 'd3f7a9c2e154'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documentos_institucionais", sa.Column("publico_formato", sa.String(length=5), nullable=True))
    op.execute("UPDATE documentos_institucionais SET publico_formato = 'PDF' WHERE publico_nome IS NOT NULL")


def downgrade() -> None:
    # Versão pública em texto não existe sem a coluna: quem tinha só o texto volta a "sem versão pública" (o texto se perde;
    # o original e o histórico ficam).
    op.execute(
        "UPDATE documentos_institucionais SET publico_texto = NULL, publico_sha256 = NULL, publico_tamanho = NULL, "
        "verificacao_ok = NULL, verificacao_json = NULL, verificacao_em = NULL, situacao = 'Rascunho' "
        "WHERE publico_formato = 'TEXTO'"
    )
    op.drop_column("documentos_institucionais", "publico_formato")
