"""v7.1a (FASE 7): os textos de privacidade com versão - a tabela `textos_de_privacidade`

Cada versão de cada aviso que o titular lê ao entregar dado pessoal (app/textos_de_privacidade.py), com o texto exato. A API grava as versões do catálogo ao subir
(seed_textos_de_privacidade) e nunca reescreve uma já gravada. O texto da inscrição em evento deixa de ser uma configuração editável (TEXTO_CONSENTIMENTO_LGPD_INSCRICAO e a
sua versão): se alguém o editou neste banco, o texto editado é gravado aqui como a versão que valia (é o que as pessoas leram). As duas configurações NÃO saem aqui: a API
que ainda está no ar durante a publicação as lê; a API nova as tira ao subir (seed_textos_de_privacidade).
Se o texto foi editado e a versão dele não é a 1, a migração PARA (não grava nada): o número coincidiria com uma versão nova do catálogo e o painel mostraria o texto
errado para quem aceitou um ou outro; nesse caso o catálogo precisa receber antes a versão editada (com o texto lido do banco).
O `downgrade` apaga a tabela e devolve as duas configurações (com o texto padrão) se não existirem.

Revision ID: 5b2d7e9c41f0
Revises: 13948ce981ad
Create Date: 2026-10-27 12:00:00

"""
from datetime import datetime
from typing import Sequence, Union
import hashlib

import sqlalchemy as sa
from alembic import op

revision: str = '5b2d7e9c41f0'
down_revision: Union[str, Sequence[str], None] = '13948ce981ad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TEXTO_PADRAO = ("Ao me inscrever, autorizo o uso dos meus dados pessoais (nome, CPF, e-mail, telefone e respostas deste formulário) para fins de organização deste "
                "evento, nos termos da LGPD.")
CHAVES = ("TEXTO_CONSENTIMENTO_LGPD_INSCRICAO", "VERSAO_TEXTO_CONSENTIMENTO_LGPD_INSCRICAO")


def upgrade() -> None:
    conexao = op.get_bind()
    config = {c: v for c, v in conexao.execute(
        sa.text("SELECT chave_configuracao, valor_configuracao FROM configuracoes_institucionais WHERE chave_configuracao IN (:a, :b)"), {"a": CHAVES[0], "b": CHAVES[1]})}
    texto = (config.get(CHAVES[0]) or "").strip()
    versao = (config.get(CHAVES[1]) or "1").strip()[:10] or "1"
    # a trava vem ANTES de criar a tabela: parar aqui não deixa nada pela metade
    editado = bool(texto) and texto != TEXTO_PADRAO
    if editado and versao != "1":
        raise RuntimeError(
            f"v7.1a: o texto da inscrição em evento foi editado neste banco com a versão {versao!r}; o catálogo (app/textos_de_privacidade.py) já usa a versão 2 "
            "para o aviso novo. Acrescente ao catálogo a versão editada (com o texto do banco) e renumere o aviso novo antes de migrar.")

    op.create_table(
        "textos_de_privacidade",
        sa.Column("id_texto", sa.Integer(), primary_key=True),
        sa.Column("ponto", sa.String(length=40), nullable=False),
        sa.Column("versao", sa.String(length=10), nullable=False),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("texto", sa.Text(), nullable=False),
        sa.Column("caixa", sa.Text(), nullable=True),
        sa.Column("impressao", sa.String(length=64), nullable=False),
        sa.Column("vigente_desde", sa.DateTime(), nullable=False),
        sa.Column("reconstituido", sa.Boolean(), nullable=False),
        sa.Column("observacao", sa.Text(), nullable=True),
        sa.Column("registrado_em", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("ponto", "versao", name="uq_texto_de_privacidade"),
    )
    op.create_index("ix_textos_de_privacidade_id_texto", "textos_de_privacidade", ["id_texto"])
    op.create_index("ix_textos_de_privacidade_ponto", "textos_de_privacidade", ["ponto"])

    if editado:
        conexao.execute(sa.text(
            "INSERT INTO textos_de_privacidade (ponto, versao, tipo, texto, caixa, impressao, vigente_desde, reconstituido, observacao, registrado_em) "
            "VALUES ('INSCRICAO_EVENTO', '1', 'consentimento', :texto, 'Li e aceito.', :impressao, :desde, :reconstituido, :observacao, :agora)"),
            {"texto": texto, "impressao": hashlib.sha256(texto.encode("utf-8")).hexdigest(), "desde": datetime(2026, 9, 18), "reconstituido": True,
             "agora": datetime.utcnow(),
             "observacao": "Texto editado na configuração TEXTO_CONSENTIMENTO_LGPD_INSCRICAO deste banco (versão 1), gravado ao migrar (v7.1a)."})


def downgrade() -> None:
    op.drop_index("ix_textos_de_privacidade_ponto", table_name="textos_de_privacidade")
    op.drop_index("ix_textos_de_privacidade_id_texto", table_name="textos_de_privacidade")
    op.drop_table("textos_de_privacidade")
    conexao = op.get_bind()
    existentes = {k for (k,) in conexao.execute(sa.text("SELECT chave_configuracao FROM configuracoes_institucionais"))}
    for chave, valor, descricao in (
        (CHAVES[0], TEXTO_PADRAO, "Texto de consentimento LGPD exibido no formulário público de inscrição em evento."),
        (CHAVES[1], "1", "Versão do texto de consentimento LGPD de inscrição - mude este valor sempre que o texto acima for editado de forma relevante."),
    ):
        if chave in existentes:
            continue
        conexao.execute(sa.text(
            "INSERT INTO configuracoes_institucionais (chave_configuracao, valor_configuracao, tipo, categoria, descricao, atualizado_em) VALUES (:c, :v, 'texto', 'regras', :d, :agora)"),
            {"c": chave, "v": valor, "d": descricao, "agora": datetime.utcnow()})
