from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Table, UniqueConstraint, Text

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
    # v0.2.2 - MFA obrigatório configurável por nível (catálogo v0.1.5), nunca hardcoded
    # no código: /auth/me devolve mfa_pendente quando exige_mfa && !mfa_ativado.
    exige_mfa = Column(Boolean, default=False)
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
    # v0.1 - bloqueio por força bruta (guardado no banco, não em memória do processo)
    tentativas_falhas = Column(Integer, default=0)
    bloqueado_ate = Column(DateTime, nullable=True)
    # v0.1 - MFA (TOTP), obrigatório só para níveis administrativos/financeiros (ver plano v0.1.4)
    mfa_secret = Column(String, nullable=True)
    mfa_ativado = Column(Boolean, default=False)

class TokenAcesso(Base):
    __tablename__ = "tokens_acesso"
    id_token = Column(Integer, primary_key=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"))
    token = Column(String, unique=True, index=True)
    data_expiracao = Column(DateTime)

class CodigoRecuperacaoMFA(Base):
    """Códigos de recuperação de MFA (v0.2.2d): gerados na ativação, mostrados UMA única vez,
    guardados só como hash bcrypt (nunca o valor em texto). Cada um é de uso único - queimado
    no primeiro uso. Sem isso, perder o celular = perder o acesso de Presidente."""
    __tablename__ = "codigos_recuperacao_mfa"
    id_codigo = Column(Integer, primary_key=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"), index=True)
    codigo_hash = Column(String, unique=True, index=True)
    usado = Column(Boolean, default=False)
    criado_em = Column(DateTime, default=datetime.utcnow)

class AuditLog(Base):
    """Quem mudou o quê, quando, antes/depois - base para LGPD (FASE 7) e segregação de
    funções do Financeiro (FASE 3). Login/logout também geram entrada (acao=LOGIN/LOGOUT),
    não só mutação de dado."""
    __tablename__ = "audit_log"
    id_log = Column(Integer, primary_key=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    tabela_afetada = Column(String, index=True)
    id_registro_afetado = Column(Integer, nullable=True)
    acao = Column(String, index=True)  # LOGIN, LOGOUT, CREATE, UPDATE, DELETE
    dados_antes = Column(Text, nullable=True)
    dados_depois = Column(Text, nullable=True)
    ip_origem = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)

