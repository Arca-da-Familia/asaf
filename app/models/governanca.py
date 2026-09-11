from datetime import datetime
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime

from app.database import Base

class Assembleia(Base):
    __tablename__ = "assembleias"
    id_assembleia = Column(Integer, primary_key=True, index=True)
    titulo_edital = Column(String)
    pauta_principal = Column(String)
    data_realizacao = Column(DateTime)
    status = Column(String, default="Agendada")
    data_encerramento = Column(DateTime, nullable=True)

class RegistroVoto(Base):
    __tablename__ = "registros_votos"
    id_voto = Column(Integer, primary_key=True, index=True)
    id_assembleia = Column(Integer, ForeignKey("assembleias.id_assembleia"))
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    data_entrada = Column(DateTime, default=datetime.utcnow)
    decisao = Column(String)
    tipo_assinatura = Column(String)
    protocolo_autenticacao = Column(String, nullable=True)

class DocumentoInstitucional(Base):
    __tablename__ = "documentos_institucionais"
    id_documento = Column(Integer, primary_key=True, index=True)
    titulo = Column(String)
    tipo_documento = Column(String)
    id_assembleia = Column(Integer, ForeignKey("assembleias.id_assembleia"), nullable=True)
    caminho_arquivo = Column(String)
    data_upload = Column(DateTime, default=datetime.utcnow)

