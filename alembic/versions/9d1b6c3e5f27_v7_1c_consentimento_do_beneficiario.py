"""v7.1c (FASE 7): o consentimento do atendimento social - os beneficiários que tinham a MARCA "Consentimento LGPD registrado" ganham o registro dela

A partir da v7.1c o prontuário e o encaminhamento só gravam com um consentimento vigente na tabela `consentimentos` (o termo assinado, com a versão). Quem tinha a marca
no cadastro (`beneficiarios.consentimento_lgpd_registrado`) ganha um registro "declaração antiga" (versão 1 do termo: a marca do painel), com a data e quem marcou, para o
prontuário dessas pessoas não fechar de repente; o painel mostra que é a declaração antiga e convida a registrar o termo. As colunas antigas ficam como estavam (nada se
apaga). O `downgrade` tira só os registros criados aqui.

Revision ID: 9d1b6c3e5f27
Revises: 7c4e1a9d2b63
Create Date: 2026-10-27 21:00:00

"""
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '9d1b6c3e5f27'
down_revision: Union[str, Sequence[str], None] = '7c4e1a9d2b63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MOTIVO_DA_MIGRACAO = "v7.1c"


def upgrade() -> None:
    conexao = op.get_bind()
    agora = datetime.utcnow()
    linhas = conexao.execute(sa.text(
        "SELECT b.id_beneficiario, b.id_pessoa, p.nome_completo, b.data_consentimento, b.criado_em, b.id_usuario_registro_consentimento "
        "FROM beneficiarios b LEFT JOIN pessoas p ON p.id_pessoa = b.id_pessoa WHERE b.consentimento_lgpd_registrado = :sim"), {"sim": True}).all()
    for id_beneficiario, id_pessoa, nome, data_consentimento, criado_em, id_usuario in linhas:
        conexao.execute(sa.text(
            "INSERT INTO consentimentos (ponto, versao, titular, id_pessoa, meio, dado_em, id_usuario_registro, registrado_em, origem, id_origem) "
            "VALUES ('ATENDIMENTO_SOCIAL', '1', :titular, :id_pessoa, 'declaracao_antiga', :dado_em, :id_usuario, :agora, 'beneficiario', :id_origem)"),
            {"titular": (nome or "Pessoa atendida")[:300], "id_pessoa": id_pessoa, "dado_em": data_consentimento or criado_em or agora,
             "id_usuario": id_usuario, "agora": agora, "id_origem": id_beneficiario})


def downgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM consentimentos WHERE origem = 'beneficiario' AND meio = 'declaracao_antiga'"))
