from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Table, UniqueConstraint

from app.database import Base

perfil_permissao = Table(
    'perfil_permissao', Base.metadata,
    Column('id_nivel', Integer, ForeignKey('niveis_acesso.id_nivel')),
    Column('id_permissao', Integer, ForeignKey('permissoes_sistema.id_permissao'))
)

class PermissaoSistema(Base):
    __tablename__ = "permissoes_sistema"
    id_permissao = Column(Integer, primary_key=True, index=True)
    modulo = Column(String)
    codigo_permissao = Column(String, unique=True, index=True)
    descricao = Column(String)

class NivelAcesso(Base):
    __tablename__ = "niveis_acesso"
    id_nivel = Column(Integer, primary_key=True, index=True)
    nome_nivel = Column(String, unique=True, index=True) 
    is_conselho_fiscal = Column(Boolean, default=False)
    descricao = Column(String)

class ConfiguracaoInstitucional(Base):
    __tablename__ = "configuracoes_institucionais"
    id_config = Column(Integer, primary_key=True, index=True)
    chave_configuracao = Column(String, unique=True)
    valor_configuracao = Column(String)

class OpcaoLista(Base):
    """Valores de listas configuráveis pelo admin (categorias, status, etc.), sem precisar alterar código."""
    __tablename__ = "opcoes_lista"
    __table_args__ = (UniqueConstraint("tipo_lista", "valor", name="uq_opcao_tipo_valor"),)
    id_opcao = Column(Integer, primary_key=True, index=True)
    tipo_lista = Column(String(50), index=True)
    valor = Column(String(100))
    ordem = Column(Integer, default=0)
    ativo = Column(Boolean, default=True)

class ModeloDocumento(Base):
    __tablename__ = "modelos_documentos"
    id_modelo = Column(Integer, primary_key=True, index=True)
    tipo_documento = Column(String)
    nome_modelo = Column(String)
    codigo_html_layout = Column(String, nullable=True)
    exige_qr_code = Column(Boolean, default=True)

class Usuario(Base):
    __tablename__ = "usuarios"
    id_usuario = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    senha_hash = Column(String) 
    id_nivel = Column(Integer, ForeignKey("niveis_acesso.id_nivel"))
    ativo = Column(Boolean, default=True)
    data_criacao = Column(DateTime, default=datetime.utcnow)

class TokenAcesso(Base):
    __tablename__ = "tokens_acesso"
    id_token = Column(Integer, primary_key=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"))
    token = Column(String, unique=True, index=True)
    data_expiracao = Column(DateTime)

