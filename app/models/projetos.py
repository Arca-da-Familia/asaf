from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Float, DateTime

from app.database import Base

class ProjetoEvento(Base):
    __tablename__ = "projetos_eventos"
    id_projeto = Column(Integer, primary_key=True, index=True)
    nome_projeto = Column(String, index=True)
    tipo_foco = Column(String)
    fase_pdca = Column(String, default="Plan (Planejamento)") 
    data_inicio = Column(DateTime)
    data_fim_prevista = Column(DateTime)
    necessita_alvara_bombeiros = Column(Boolean, default=False)
    status_liberacao = Column(String, default="Não Aplicável")

class AlocacaoVoluntario(Base):
    __tablename__ = "alocacoes_voluntarios"
    id_alocacao = Column(Integer, primary_key=True, index=True)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"))
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    funcao_desempenhada = Column(String)
    horas_dedicadas = Column(Float, default=0.0)

