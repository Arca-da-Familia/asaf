"""v7.0b (FASE 7): o motivo da licença e do desligamento sai da linha do tempo da pessoa

Até a v7.0a, registrar uma licença ou um desligamento escrevia na linha do tempo "Motivo: SAUDE. Retorno previsto em ..." e "Motivo: X.". A linha do tempo sai na
ficha 360, que não é leitura auditada, e a anonimização não a limpava: o motivo de saúde (dado pessoal SENSÍVEL, LGPD art. 5º, II) ficava exposto e para sempre.
O motivo continua no histórico de situação (`mudancas_situacao.motivo`, de leitura auditada). Esta migração tira o "Motivo: ..." das linhas já gravadas:
  - LICENCA_REGISTRADA: fica só "Retorno previsto em ...";
  - DESLIGAMENTO: a descrição fica vazia (o título "Desligamento registrado" continua).
Nenhuma linha é apagada. O `downgrade` não devolve o motivo (de propósito: não se recria dado sensível que se tirou); só mantém a cadeia.

Revision ID: 6f679ca3b6bd
Revises: 56d7ae211884
Create Date: 2026-10-23 17:00:00

"""
import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '6f679ca3b6bd'
down_revision: Union[str, Sequence[str], None] = '56d7ae211884'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_linhas = sa.table(
    "eventos_linha_do_tempo", sa.column("id_evento", sa.Integer), sa.column("modulo_origem", sa.String), sa.column("tipo", sa.String),
    sa.column("descricao", sa.Text),
)
_MOTIVO = re.compile(r"^Motivo: [^.]*\.\s*")


def sem_motivo(descricao):
    """O texto sem o "Motivo: X." do começo (vazio vira None)."""
    if not descricao:
        return descricao
    resto = _MOTIVO.sub("", descricao, count=1).strip()
    return resto or None


def upgrade() -> None:
    conexao = op.get_bind()
    linhas = conexao.execute(
        sa.select(_linhas.c.id_evento, _linhas.c.descricao).where(
            _linhas.c.modulo_origem == "situacao", _linhas.c.tipo.in_(("LICENCA_REGISTRADA", "DESLIGAMENTO")), _linhas.c.descricao.like("Motivo: %"),
        )
    ).all()
    for linha in linhas:
        conexao.execute(sa.update(_linhas).where(_linhas.c.id_evento == linha.id_evento).values(descricao=sem_motivo(linha.descricao)))


def downgrade() -> None:
    pass
