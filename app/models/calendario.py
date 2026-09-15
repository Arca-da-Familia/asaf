"""v2.9 (FASE 2) - calendário institucional. A maior parte do calendário é CALCULADA na leitura a
partir de dado que já existe em outro lugar (Assembleia, Mandato, Deliberacao, ProjetoEvento) -
nunca duplicado aqui (ver app/services/calendario.py). `EventoCalendario` é só para o que
genuinamente não tem modelo próprio ainda: reuniões periódicas de diretoria/conselho (o estatuto
não define cadência nenhuma para elas - Art. 20 lista competências, não frequência) e datas
institucionais que a diretoria queira marcar."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base


class EventoCalendario(Base):
    __tablename__ = "eventos_calendario"
    id_evento = Column(Integer, primary_key=True, index=True)
    titulo = Column(String, nullable=False)
    descricao = Column(Text, nullable=True)
    categoria = Column(String(50), nullable=False)  # catálogo categoria_evento_calendario
    data_inicio = Column(DateTime, nullable=False)
    data_fim = Column(DateTime, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
