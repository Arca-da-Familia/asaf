"""v1.4 (FASE 1) - registro append-only de toda mudança de situação de um associado (licença,
desligamento, readmissão). Serve de base real para a linha do tempo da v1.5 (ainda não
construída - a UI vem depois, mas o dado já existe desde já, um evento por vez, nunca perdido)."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base

LICENCA = "licenca"
DESLIGAMENTO = "desligamento"
READMISSAO = "readmissao"


class MudancaSituacao(Base):
    __tablename__ = "mudancas_situacao"
    id_mudanca = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    tipo = Column(String(30), nullable=False)
    motivo = Column(String(50), nullable=True)  # código do catálogo motivo_desligamento, quando aplicável
    data_efetiva = Column(DateTime, nullable=False)
    data_fim_prevista = Column(DateTime, nullable=True)  # licença: previsão de retorno
    documento_referencia = Column(String, nullable=True)
    id_usuario_registrou = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
