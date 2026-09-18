"""v4.6 (FASE 4) - proteção do endpoint público de inscrição em evento: rate limiting por IP
(seção do plano exige isso "sem CAPTCHA comercial pago") - guarda cada tentativa e conta quantas
aconteceram numa janela recente pro mesmo IP/rota (ver `app/services/protecao_publica.py`).
Simples de propósito: nenhuma dependência nova, mesmo raciocínio de `Usuario.tentativas_falhas`/
`bloqueado_ate` (v0.1) pra força bruta de login, só que por IP em vez de por usuário."""
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from app.database import Base


class TentativaAcessoPublico(Base):
    __tablename__ = "tentativas_acesso_publico"
    id_tentativa = Column(Integer, primary_key=True, index=True)
    ip = Column(String, nullable=False, index=True)
    rota = Column(String, nullable=False, index=True)
    criado_em = Column(DateTime, default=datetime.utcnow, index=True)
