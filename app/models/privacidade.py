"""v7.0a (FASE 7) - o programa de privacidade: o ato de designação do encarregado pelo tratamento de dados pessoais (LGPD, art. 41).

A Resolução CD/ANPD nº 18/2024 (regulamento do encarregado) pede um ATO FORMAL: "documento escrito, datado e assinado" (art. 3º, § 1º), com as formas de atuação e as
atividades, apresentado à ANPD quando ela pedir (art. 3º, § 2º), e um SUBSTITUTO formalmente designado (art. 4º). O sistema gera o texto com os nomes dos mandatos
vigentes e GUARDA o texto como foi gerado (é a prova do que se assinou: o mandato pode mudar depois); a cópia assinada (PDF ou foto do papel) fica no armazenamento
privado e é ela que torna o ato vigente. Nada se apaga: o ato substituído e o rascunho descartado ficam no histórico. Ver app/services/encarregado.py."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, text

from app.database import Base

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
