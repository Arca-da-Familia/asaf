"""v7.4b (FASE 7): o registro de incidentes de segurança - a tabela `incidentes_de_seguranca` e o primeiro precedente

Cria `incidentes_de_seguranca` (LGPD art. 48; Resolução CD/ANPD nº 15/2024: todo incidente, comunicado ou não, fica registrado por pelo menos 5 anos) e registra o
precedente que o PLANO_PROJETO.md manda documentar e que tem os fatos conferidos: o e-mail da conta que administrava o Azure nos registros públicos do GitHub
Actions (achado e tratado em 2026-10-30, sem dado de associado, sem risco relevante às pessoas, por isso sem comunicação). O texto não traz o e-mail. O outro
precedente citado no plano (senha exposta numa transcrição, trocada na hora) não tem data nem detalhe escritos: fica para o encarregado registrar pela tela.
O `downgrade` apaga a tabela (e o precedente com ela).

Revision ID: b74b2e6c1d40
Revises: a73c9f1e5b20
Create Date: 2026-11-02 12:00:00

"""
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b74b2e6c1d40'
down_revision: Union[str, Sequence[str], None] = 'a73c9f1e5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PRECEDENTE = {
    "numero": 1,
    "ensaio": False,
    "titulo": "E-mail da conta que administrava o Azure nos registros públicos do GitHub",
    "descricao": (
        "Os registros (logs) das publicações automáticas no GitHub Actions, que ficam abertos ao público por até 90 dias porque o repositório é público, "
        "mostravam o e-mail da conta que criou o servidor no Azure (o campo \"criado por\" que o comando de publicação imprimia). Achado na auditoria de "
        "segurança da v7.3d. A senha do banco e as demais credenciais estavam mascaradas; nenhum dado de associado aparecia."
    ),
    "ocorrido_em": None,
    "conhecido_em": datetime(2026, 10, 30, 12, 0),
    "dados_afetados": "Só o endereço de e-mail institucional da conta que administrava o Azure. Nenhum dado de associado, doador, beneficiário ou visitante.",
    "pessoas_afetadas": "Nenhuma pessoa atendida pela associação; só a conta institucional do administrador do servidor.",
    "quantidade_estimada": 0,
    "contencao": (
        "A publicação deixou de imprimir esse dado (v7.3d, -o none); a senha do banco passou a ser mascarada sozinha; as rotinas passaram a registrar erros sem a "
        "mensagem; o texto dos 314 registros que mostravam o e-mail foi apagado no GitHub (com o sim do Presidente) e conferido direto no GitHub; as cópias "
        "locais desses registros também foram apagadas; depois, a conta que administra o Azure passou para um e-mail do domínio nacional."
    ),
    "risco": "SEM_RISCO_RELEVANTE",
    "motivo_do_risco": (
        "Não envolveu dado pessoal de quem a associação atende; o e-mail exposto é institucional e a conta tem segundo passo (MFA). Sem risco ou dano "
        "relevante às pessoas: não há comunicação à ANPD nem a titulares, fica só no registro."
    ),
    "licao_aprendida": (
        "Repositório público exige que todo registro automático seja tratado como público: nada de JSON completo de recursos, nada de mensagem de erro com "
        "valores. Passou a ser regra (app/registro_seguro.py e os testes dos fluxos)."
    ),
    "acao_corretiva": "v7.3d (registro seguro, -o none, senha mascarada), apagamento dos registros antigos e troca do e-mail da conta administradora.",
    "situacao": "ENCERRADO",
    "encerrado_em": datetime(2026, 11, 2, 12, 0),
    "registrado_em": datetime(2026, 11, 2, 12, 0),
}


def upgrade() -> None:
    tabela = op.create_table(
        "incidentes_de_seguranca",
        sa.Column("id_incidente", sa.Integer(), nullable=False),
        sa.Column("numero", sa.Integer(), nullable=False),
        sa.Column("ensaio", sa.Boolean(), nullable=False),
        sa.Column("titulo", sa.String(length=200), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=False),
        sa.Column("ocorrido_em", sa.DateTime(), nullable=True),
        sa.Column("conhecido_em", sa.DateTime(), nullable=False),
        sa.Column("dados_afetados", sa.Text(), nullable=True),
        sa.Column("pessoas_afetadas", sa.Text(), nullable=True),
        sa.Column("quantidade_estimada", sa.Integer(), nullable=True),
        sa.Column("contencao", sa.Text(), nullable=True),
        sa.Column("risco", sa.String(length=20), nullable=False),
        sa.Column("motivo_do_risco", sa.Text(), nullable=True),
        sa.Column("comunicado_anpd_em", sa.DateTime(), nullable=True),
        sa.Column("protocolo_anpd", sa.String(length=100), nullable=True),
        sa.Column("comunicado_pessoas_em", sa.DateTime(), nullable=True),
        sa.Column("como_pessoas", sa.Text(), nullable=True),
        sa.Column("licao_aprendida", sa.Text(), nullable=True),
        sa.Column("acao_corretiva", sa.Text(), nullable=True),
        sa.Column("situacao", sa.String(length=20), nullable=False),
        sa.Column("encerrado_em", sa.DateTime(), nullable=True),
        sa.Column("registrado_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_registro", sa.Integer(), nullable=True),
        sa.Column("atualizado_em", sa.DateTime(), nullable=True),
        sa.Column("id_usuario_atualizacao", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["id_usuario_atualizacao"], ["usuarios.id_usuario"]),
        sa.ForeignKeyConstraint(["id_usuario_registro"], ["usuarios.id_usuario"]),
        sa.PrimaryKeyConstraint("id_incidente"),
        sa.UniqueConstraint("numero"),
    )
    op.create_index(op.f("ix_incidentes_de_seguranca_id_incidente"), "incidentes_de_seguranca", ["id_incidente"], unique=False)
    op.create_index(op.f("ix_incidentes_de_seguranca_situacao"), "incidentes_de_seguranca", ["situacao"], unique=False)
    op.bulk_insert(tabela, [PRECEDENTE])


def downgrade() -> None:
    op.drop_index(op.f("ix_incidentes_de_seguranca_situacao"), table_name="incidentes_de_seguranca")
    op.drop_index(op.f("ix_incidentes_de_seguranca_id_incidente"), table_name="incidentes_de_seguranca")
    op.drop_table("incidentes_de_seguranca")
