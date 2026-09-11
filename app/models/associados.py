from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, UniqueConstraint

from app.database import Base

class Associado(Base):
    __tablename__ = "associados"
    id_associado = Column(Integer, primary_key=True, index=True)
    nome_completo = Column(String, index=True)
    cpf = Column(String, unique=True, index=True)
    email_contato = Column(String)
    telefone_whatsapp = Column(String)
    categoria = Column(String, default="Efetivo")
    status_arrolamento = Column(String, default="Ativo - Em Dia")
    observacoes_gerenciais = Column(String, nullable=True)
    data_admissao = Column(DateTime, default=datetime.utcnow)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    data_nascimento = Column(DateTime, nullable=True)
    estado_civil = Column(String(50), nullable=True)
    profissao = Column(String(100), nullable=True)
    naturalidade = Column(String(100), nullable=True)
    foto = Column(String, nullable=True)

class Endereco(Base):
    __tablename__ = "enderecos"
    id_endereco = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    cep = Column(String)
    logradouro = Column(String)
    numero = Column(String)
    bairro = Column(String)
    cidade = Column(String)
    estado = Column(String)

class DependenteFamiliar(Base):
    """Vínculo de parentesco entre dois associados já cadastrados (o sistema não registra pessoas de fora)."""
    __tablename__ = "dependentes_familiares"
    __table_args__ = (UniqueConstraint("id_titular", "id_associado_vinculado", name="uq_familia_titular_vinculado"),)
    id_dependente = Column(Integer, primary_key=True, index=True)
    id_titular = Column(Integer, ForeignKey("associados.id_associado"))
    id_associado_vinculado = Column(Integer, ForeignKey("associados.id_associado"))
    grau_parentesco = Column(String(50))

class DocumentoAnexo(Base):
    __tablename__ = "documentos_anexos"
    id_documento = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    tipo_documento = Column(String)
    caminho_arquivo = Column(String)
    data_upload = Column(DateTime, default=datetime.utcnow)

class HistoricoCargo(Base):
    __tablename__ = "historico_cargos"
    id_historico = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    titulo_cargo = Column(String)
    data_posse = Column(DateTime)
    data_saida = Column(DateTime, nullable=True)

