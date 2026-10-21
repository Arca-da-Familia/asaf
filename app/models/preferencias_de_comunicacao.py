"""v6.2b (FASE 6) - o que cada PESSOA escolheu não receber por e-mail (o descadastro de verdade). Só os e-mails que NÃO são obrigatórios podem ser desligados
(decisão do Presidente, 2026-10-20): avisos do mural fora das categorias obrigatórias, lembretes de mensalidade e avisos de evento em que a pessoa se inscreveu. Convocação
e mudança de regra não se desligam; o e-mail que a própria pessoa pediu (código, recibo, resposta) é resposta, não comunicação, e não entra aqui.

Sem linha = recebe (o padrão). A escolha guarda de onde veio (o link do e-mail ou o painel) e quando; a Auditoria guarda quem mudou."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from app.database import Base

# os tipos que a pessoa pode desligar (o código é estável; o rótulo para a tela está em app/services/preferencias_de_comunicacao.py)
AVISOS = "avisos"
LEMBRETES_DE_MENSALIDADE = "lembretes_de_mensalidade"
EVENTOS = "eventos"
TIPOS = (AVISOS, LEMBRETES_DE_MENSALIDADE, EVENTOS)

ORIGEM_LINK = "link do e-mail"
ORIGEM_PAINEL = "painel"


class PreferenciaDeComunicacao(Base):
    __tablename__ = "preferencias_de_comunicacao"
    __table_args__ = (UniqueConstraint("id_pessoa", "tipo", name="uq_preferencia_de_comunicacao"),)
    id_preferencia = Column(Integer, primary_key=True, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, index=True)
    tipo = Column(String(40), nullable=False)
    recebe = Column(Boolean, nullable=False)
    origem = Column(String(20), nullable=False)
    alterado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
