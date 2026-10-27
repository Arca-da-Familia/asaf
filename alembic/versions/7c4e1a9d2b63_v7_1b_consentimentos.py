"""v7.1b (FASE 7): o registro dos consentimentos - a tabela `consentimentos`

A prova de cada consentimento (app/models/privacidade.py::Consentimento): o termo e a versão, quem consentiu, como, quando e, se acabou, quando e por quê. As fotos que
JÁ existem (da Diretoria, de evento e de etapa de parceria) ganham, cada uma, o registro do que havia: a DECLARAÇÃO de quem enviou a foto (versão 1 dos termos de imagem),
com o termo assinado se ele foi informado, a data e quem enviou. Nenhum dado existente muda. O `downgrade` apaga a tabela.

Revision ID: 7c4e1a9d2b63
Revises: 5b2d7e9c41f0
Create Date: 2026-10-27 18:00:00

"""
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '7c4e1a9d2b63'
down_revision: Union[str, Sequence[str], None] = '5b2d7e9c41f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TITULAR_DAS_FOTOS_DE_ATIVIDADE = "Pessoas que aparecem na foto (declaração de quem a enviou)"


def upgrade() -> None:
    op.create_table(
        "consentimentos",
        sa.Column("id_consentimento", sa.Integer(), primary_key=True),
        sa.Column("ponto", sa.String(length=40), nullable=False),
        sa.Column("versao", sa.String(length=10), nullable=False),
        sa.Column("titular", sa.String(length=300), nullable=False),
        sa.Column("id_pessoa", sa.Integer(), sa.ForeignKey("pessoas.id_pessoa"), nullable=True),
        sa.Column("dado_por", sa.String(length=20), nullable=True),
        sa.Column("nome_responsavel", sa.String(length=200), nullable=True),
        sa.Column("vinculo_responsavel", sa.String(length=60), nullable=True),
        sa.Column("meio", sa.String(length=40), nullable=False),
        sa.Column("id_documento", sa.Integer(), sa.ForeignKey("documentos_institucionais.id_documento"), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("dado_em", sa.DateTime(), nullable=False),
        sa.Column("id_usuario_registro", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
        sa.Column("registrado_em", sa.DateTime(), nullable=False),
        sa.Column("origem", sa.String(length=40), nullable=False),
        sa.Column("id_origem", sa.Integer(), nullable=False),
        sa.Column("encerrado_em", sa.DateTime(), nullable=True),
        sa.Column("encerramento", sa.String(length=20), nullable=True),
        sa.Column("motivo_encerramento", sa.String(length=500), nullable=True),
        sa.Column("id_usuario_encerramento", sa.Integer(), sa.ForeignKey("usuarios.id_usuario"), nullable=True),
    )
    op.create_index("ix_consentimentos_id_consentimento", "consentimentos", ["id_consentimento"])
    op.create_index("ix_consentimentos_id_pessoa", "consentimentos", ["id_pessoa"])
    op.create_index("ix_consentimentos_origem", "consentimentos", ["origem", "id_origem"])
    op.create_index("uq_consentimento_ativo_por_origem", "consentimentos", ["origem", "id_origem"], unique=True,
                    sqlite_where=sa.text("encerrado_em IS NULL"), postgresql_where=sa.text("encerrado_em IS NULL"))

    # as fotos que já existem: o que havia era a declaração de quem enviou (versão 1 dos termos de imagem)
    conexao = op.get_bind()
    agora = datetime.utcnow()
    inserir = sa.text(
        "INSERT INTO consentimentos (ponto, versao, titular, id_pessoa, dado_por, meio, id_documento, dado_em, id_usuario_registro, registrado_em, origem, id_origem) "
        "VALUES (:ponto, '1', :titular, :id_pessoa, :dado_por, 'declaracao_antiga', :id_documento, :dado_em, :id_usuario, :agora, :origem, :id_origem)")
    for id_foto, id_pessoa, nome, id_documento, criado_em, id_usuario in conexao.execute(sa.text(
            "SELECT f.id_foto, f.id_pessoa, p.nome_completo, f.id_documento_autorizacao, f.criado_em, f.id_usuario_criacao "
            "FROM fotos_da_diretoria f LEFT JOIN pessoas p ON p.id_pessoa = f.id_pessoa")).all():
        conexao.execute(inserir, {"ponto": "IMAGEM_DIRETORIA", "titular": (nome or "Pessoa da Diretoria")[:300], "id_pessoa": id_pessoa, "dado_por": "titular",
                                  "id_documento": id_documento, "dado_em": criado_em or agora, "id_usuario": id_usuario, "agora": agora,
                                  "origem": "foto_da_diretoria", "id_origem": id_foto})
    for tabela, origem in (("fotos_evento", "foto_de_evento"), ("fotos_etapa_parceria", "foto_de_etapa_de_parceria")):
        for id_foto, id_documento, criado_em, id_usuario in conexao.execute(sa.text(
                f"SELECT id_foto, id_documento_autorizacao, criado_em, id_usuario_criacao FROM {tabela}")).all():
            conexao.execute(inserir, {"ponto": "IMAGEM_ATIVIDADE", "titular": TITULAR_DAS_FOTOS_DE_ATIVIDADE, "id_pessoa": None, "dado_por": None,
                                      "id_documento": id_documento, "dado_em": criado_em or agora, "id_usuario": id_usuario, "agora": agora,
                                      "origem": origem, "id_origem": id_foto})


def downgrade() -> None:
    op.drop_index("uq_consentimento_ativo_por_origem", table_name="consentimentos")
    op.drop_index("ix_consentimentos_origem", table_name="consentimentos")
    op.drop_index("ix_consentimentos_id_pessoa", table_name="consentimentos")
    op.drop_index("ix_consentimentos_id_consentimento", table_name="consentimentos")
    op.drop_table("consentimentos")
