"""v1.3 (FASE 1) - importação de base existente em lote. Cada linha criada por uma importação
carrega `Associado.id_lote_importacao`, permitindo desfazer a importação inteira de uma vez
(`LoteImportacao.desfeito`) sem precisar reidentificar linha por linha manualmente."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class LoteImportacao(Base):
    __tablename__ = "lotes_importacao"
    id_lote = Column(Integer, primary_key=True, index=True)
    id_usuario_criador = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    total_linhas = Column(Integer, default=0)
    criado_em = Column(DateTime, default=datetime.utcnow)
    desfeito = Column(Boolean, default=False)
    desfeito_em = Column(DateTime, nullable=True)
