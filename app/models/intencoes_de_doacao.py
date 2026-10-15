"""v5.6a (FASE 5) - doar pelo site com Pix ESTÁTICO e confirmação manual da tesouraria.

Não existe Pix dinâmico para a ASAF (decisão do Presidente, 2026-10-15: exige convênio e API paga com banco), então o dinheiro cai direto na chave Pix da associação e nada avisa o sistema.
Quem quer ser identificado (e receber o recibo) deixa aqui, ANTES de pagar, o nome, o e-mail e o valor: ganha um protocolo e o código do Pix. A tesouraria acha o dinheiro no extrato do banco
e confirma no painel; só aí nasce a `Doacao` (com título, lançamento e recibo numerado, igual a qualquer doação). A intenção, sozinha, nunca é dinheiro: não entra em saldo, meta nem relatório."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String

from app.database import Base

PENDENTE = "PENDENTE"
CONFIRMADA = "CONFIRMADA"
NAO_LOCALIZADA = "NAO_LOCALIZADA"
EXPIRADA = "EXPIRADA"
SITUACOES = (PENDENTE, CONFIRMADA, NAO_LOCALIZADA, EXPIRADA)


class IntencaoDeDoacao(Base):
    __tablename__ = "intencoes_de_doacao"
    id_intencao = Column(Integer, primary_key=True, index=True)
    protocolo = Column(String(30), nullable=False, unique=True, index=True)  # DOA-2026-00001
    nome_doador = Column(String, nullable=False)
    email_doador = Column(String, nullable=False, index=True)
    documento_doador = Column(String, nullable=True)  # CPF só com dígitos, opcional (o recibo o mostra)
    valor_informado = Column(Numeric(14, 2), nullable=True)  # o que a pessoa disse que ia pagar; o valor que vale é o RECEBIDO, na confirmação
    id_campanha = Column(Integer, ForeignKey("campanhas_arrecadacao.id_campanha"), nullable=True)
    status = Column(String, nullable=False, default=PENDENTE, index=True)
    impressao_do_pedido = Column(String(64), nullable=True, index=True)  # o mesmo pedido mandado duas vezes (duplo clique) vira um protocolo só
    consentimento_lgpd_versao = Column(String, nullable=False)
    consentimento_lgpd_em = Column(DateTime, nullable=False)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    expira_em = Column(DateTime, nullable=False)
    resolvido_em = Column(DateTime, nullable=True)
    id_doacao = Column(Integer, ForeignKey("doacoes.id_doacao"), nullable=True)  # preenchido quando a tesouraria confirma
    id_usuario_resolucao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    observacao = Column(String(300), nullable=True)
    recibo_enviado_por_email = Column(Boolean, nullable=True)  # NULL = ainda não houve recibo
