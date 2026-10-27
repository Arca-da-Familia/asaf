"""v7.0a (FASE 7) - o programa de privacidade: o ato de designação do encarregado pelo tratamento de dados pessoais (LGPD, art. 41).

A Resolução CD/ANPD nº 18/2024 (regulamento do encarregado) pede um ATO FORMAL: "documento escrito, datado e assinado" (art. 3º, § 1º), com as formas de atuação e as
atividades, apresentado à ANPD quando ela pedir (art. 3º, § 2º), e um SUBSTITUTO formalmente designado (art. 4º). O sistema gera o texto com os nomes dos mandatos
vigentes e GUARDA o texto como foi gerado (é a prova do que se assinou: o mandato pode mudar depois); a cópia assinada (PDF ou foto do papel) fica no armazenamento
privado e é ela que torna o ato vigente. Nada se apaga: o ato substituído e o rascunho descartado ficam no histórico. Ver app/services/encarregado.py."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text

from app.database import Base
from app.models.core import _TipoJson

RASCUNHO = "Aguardando assinatura"
VIGENTE = "Vigente"
SUBSTITUIDO = "Substituído"
DESCARTADO = "Descartado"
SITUACOES = (RASCUNHO, VIGENTE, SUBSTITUIDO, DESCARTADO)


class AtoDoEncarregado(Base):
    __tablename__ = "atos_do_encarregado"
    id_ato = Column(Integer, primary_key=True, index=True)
    numero = Column(Integer, nullable=False, unique=True)  # "Ato nº 1", "Ato nº 2"... nunca reaproveitado
    situacao = Column(String(30), nullable=False, index=True)
    texto = Column(Text, nullable=False)  # o texto exato que foi gerado e impresso
    # quem o ato nomeia, como estava no dia (os mandatos podem mudar depois; o aviso de "ato de outra pessoa" compara com eles)
    id_associado_encarregado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False)
    nome_encarregado = Column(String(200), nullable=False)
    id_associado_substituto = Column(Integer, ForeignKey("associados.id_associado"), nullable=True)
    nome_substituto = Column(String(200), nullable=True)
    cargo_substituto = Column(String(80), nullable=True)
    gerado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_usuario_geracao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=False)
    # a cópia assinada, no armazenamento PRIVADO (`documentos-originais`): só sai pela rota do módulo, com a permissão e a Auditoria
    assinado_arquivo = Column(String(150), nullable=True)
    assinado_nome_arquivo = Column(String(200), nullable=True)
    assinado_sha256 = Column(String(64), nullable=True)
    assinado_tamanho = Column(Integer, nullable=True)
    assinatura_registrada_em = Column(DateTime, nullable=True)
    id_usuario_assinatura = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    encerrado_em = Column(DateTime, nullable=True)  # substituído por outro ato vigente, ou rascunho descartado ao gerar outro

    # No máximo UM ato aguardando assinatura e UM vigente, garantido pelo próprio banco (índice único parcial): dois cliques ao mesmo tempo que escapem da trava
    # de linha viram 409 (app/services/encarregado.py::_gravar), nunca dois atos valendo (achado da conferência independente).
    __table_args__ = (
        Index("uq_atos_do_encarregado_um_aguardando", "situacao", unique=True,
              postgresql_where=text(f"situacao = '{RASCUNHO}'"), sqlite_where=text(f"situacao = '{RASCUNHO}'")),
        Index("uq_atos_do_encarregado_um_vigente", "situacao", unique=True,
              postgresql_where=text(f"situacao = '{VIGENTE}'"), sqlite_where=text(f"situacao = '{VIGENTE}'")),
    )


class VersaoDeAtividadeDeTratamento(Base):
    """v7.0c - o inventário de dados (registro das operações de tratamento, LGPD art. 37): as atividades de tratamento ficam no CÓDIGO
    (app/services/inventario.py: quais tabelas, de quem, com que prazo de guarda), e o que o encarregado ajusta (finalidade, base legal, com quem se compartilha,
    medidas de segurança, observações e se a base legal foi conferida) fica aqui, SÓ POR ACRÉSCIMO: cada gravação é uma versão nova; a vigente é a de maior
    número; sem nenhuma, vale a proposta do sistema (versão 0). É o histórico de quem mudou o quê, e quando."""
    __tablename__ = "versoes_de_atividade_de_tratamento"
    id_versao = Column(Integer, primary_key=True, index=True)
    codigo_atividade = Column(String(40), nullable=False, index=True)
    versao = Column(Integer, nullable=False)
    campos = Column(_TipoJson, nullable=False)
    alterado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=False)

    __table_args__ = (UniqueConstraint("codigo_atividade", "versao", name="uq_versao_de_atividade"),)


# --- situação do relatório de impacto
RIPD_RASCUNHO = "Rascunho"
RIPD_APROVADO = "Aprovado"
RIPD_SUSPENSO = "Suspenso"  # o tratamento fica fechado até nova aprovação
RIPD_SUBSTITUIDO = "Substituído"


class RelatorioDeImpacto(Base):
    """v7.0d - o RELATÓRIO DE IMPACTO à proteção de dados pessoais (RIPD; LGPD art. 5º, XVII, e art. 38) de um tratamento de alto risco
    (app/services/relatorio_de_impacto.py::TRATAMENTOS). Sem uma versão APROVADA o tratamento não roda (o servidor recusa gravar). Cada versão guarda as seções
    como estavam; aprovar torna a versão a vigente e a anterior fica "Substituído"; suspender fecha o tratamento até aprovar de novo."""
    __tablename__ = "relatorios_de_impacto"
    id_relatorio = Column(Integer, primary_key=True, index=True)
    codigo_tratamento = Column(String(40), nullable=False, index=True)
    versao = Column(Integer, nullable=False)
    situacao = Column(String(20), nullable=False, index=True)
    secoes = Column(_TipoJson, nullable=False)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=False)
    atualizado_em = Column(DateTime, nullable=True)
    aprovado_em = Column(DateTime, nullable=True)
    id_usuario_aprovacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    suspenso_em = Column(DateTime, nullable=True)
    id_usuario_suspensao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    motivo_suspensao = Column(String(500), nullable=True)

    __table_args__ = (UniqueConstraint("codigo_tratamento", "versao", name="uq_versao_de_relatorio_de_impacto"),)


class TextoDePrivacidade(Base):
    """v7.1a - cada versão de um aviso ou termo de consentimento, com o texto exato que a pessoa leu (app/textos_de_privacidade.py). Gravada na primeira vez que o
    sistema sobe com ela e NUNCA reescrita: se o catálogo do código divergir do que está aqui, vale o que está aqui (é o que foi mostrado) e o sistema avisa no registro."""
    __tablename__ = "textos_de_privacidade"
    __table_args__ = (UniqueConstraint("ponto", "versao", name="uq_texto_de_privacidade"),)
    id_texto = Column(Integer, primary_key=True, index=True)
    ponto = Column(String(40), nullable=False, index=True)
    versao = Column(String(10), nullable=False)
    tipo = Column(String(20), nullable=False)  # aviso ou consentimento, como era QUANDO esta versão foi mostrada
    texto = Column(Text, nullable=False)
    caixa = Column(Text, nullable=True)  # o que a caixa de marcar dizia nesta versão
    impressao = Column(String(64), nullable=False)  # SHA-256 do texto
    vigente_desde = Column(DateTime, nullable=False)
    reconstituido = Column(Boolean, nullable=False, default=False)  # tirado do histórico do código do site (versões anteriores à v7.1a)
    observacao = Column(Text, nullable=True)
    registrado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
