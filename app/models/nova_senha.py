"""Esqueci a minha senha (pedido do Presidente em 21/10, junto da troca obrigatória da senha provisória): o código de uso único que vai por e-mail para quem tem acesso ao painel
trocar a senha sem depender da secretaria. Guarda só a impressão (HMAC) do código, nunca o código; vale minutos e conta as tentativas (ver app/services/esqueci_a_senha.py)."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class CodigoDeNovaSenha(Base):
    __tablename__ = "codigos_de_nova_senha"
    id_codigo = Column(Integer, primary_key=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario", ondelete="CASCADE", name="fk_codigos_de_nova_senha_id_usuario"), nullable=False, index=True)
    codigo_hash = Column(String(64), nullable=False)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    expira_em = Column(DateTime, nullable=False)
    tentativas = Column(Integer, nullable=False, default=0)
    usado_em = Column(DateTime, nullable=True)
