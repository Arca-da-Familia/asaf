"""v5.6b (FASE 5) - conta de visitante: entrar pelo e-mail, com um código de uso único, SEM senha.

Quem se inscreveu num evento, doou pelo site ou recebeu um certificado não tem login no painel (é de quem trabalha na associação). Para consultar o que é seu, pede um código: o sistema o manda para o
e-mail, a pessoa o digita e abre uma sessão curta. Nada disto cria cadastro, papel ou permissão: a conta é só uma janela de leitura sobre o que já existe ligado àquele e-mail.

O código nunca fica guardado: só a impressão dele (HMAC com o segredo do servidor), que vale 10 minutos, aceita poucas tentativas e morre no primeiro uso. A sessão é um código aleatório longo; o banco guarda só
a impressão (SHA-256), então quem lê o banco não consegue entrar. Um e-mail por linha, sempre em minúsculas."""
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from app.database import Base


class CodigoDeVisitante(Base):
    __tablename__ = "codigos_de_visitante"
    id_codigo = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    codigo_hash = Column(String(64), nullable=False)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    expira_em = Column(DateTime, nullable=False)
    tentativas = Column(Integer, nullable=False, default=0)
    usado_em = Column(DateTime, nullable=True)


class SessaoDeVisitante(Base):
    __tablename__ = "sessoes_de_visitante"
    id_sessao = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    expira_em = Column(DateTime, nullable=False)
    encerrada_em = Column(DateTime, nullable=True)
