"""v5.4h - Central de notificações do painel: um aviso para uma pessoa (usuário), com um texto e o endereço da tela a abrir. É a base do "sino" do
painel; a filiação a usa para chamar os sócios a propor um candidato (Estatuto Art. 12, par. único VI) e o mural de avisos da FASE 6 pode reaproveitá-la.
O aviso fica guardado até a pessoa abrir; ler não apaga (a data da leitura fica)."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class NotificacaoPainel(Base):
    __tablename__ = "notificacoes_painel"
    id_notificacao = Column(Integer, primary_key=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=False, index=True)
    tipo = Column(String(40), nullable=False)
    titulo = Column(String(150), nullable=False)
    texto = Column(String(500), nullable=True)
    link = Column(String(200), nullable=True)  # a tela do painel que o aviso abre (ex.: /filiacao/para-propor)
    criado_em = Column(DateTime, default=datetime.utcnow, index=True)
    lida_em = Column(DateTime, nullable=True)
