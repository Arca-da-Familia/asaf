from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Table, UniqueConstraint, Text, JSON
from sqlalchemy.dialects.postgresql import JSONB

from app.database import Base

# JSONB de verdade em produção (Postgres), cai para JSON genérico em dev local (SQLite, que não
# tem tipo JSONB) - mesmo padrão usado em DATABASE_URL (Postgres em produção, sqlite:// de dev).
_TipoJson = JSONB().with_variant(JSON(), "sqlite")

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
    """v0.3.4 - chave/valor tipado (era só string livre em v0.1). `tipo` orienta validação e
    renderização (não guarda histórico completo de vigência - isso é `RegraEstatutaria`, v0.7;
    aqui é só "o valor atual", com quem mudou e quando, auditado via AuditLog a cada escrita)."""
    __tablename__ = "configuracoes_institucionais"
    id_config = Column(Integer, primary_key=True, index=True)
    chave_configuracao = Column(String, unique=True)
    valor_configuracao = Column(String, nullable=True)
    tipo = Column(String(20), default="texto")  # texto, numero, booleano, email, cor, data
    categoria = Column(String(50), default="geral")
    descricao = Column(String, nullable=True)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    id_usuario_atualizacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)

class OpcaoLista(Base):
    """v0.1-v0.2: valores de lista configurável pelo admin. SUBSTITUÍDO por Catalogo/OpcaoCatalogo
    na v0.3.1 (motor genérico de verdade, com código estável separado do rótulo - ver
    DECISOES_CONGELADAS.md 1.5). Tabela e classe mantidas de propósito, sem uso em nenhuma rota
    nova: é o backup/rollback da migração de dado (nunca apagar dado só porque o código parou de
    ler). Uma limpeza futura pode dropar isto depois de confirmado estável em produção."""
    __tablename__ = "opcoes_lista"
    __table_args__ = (UniqueConstraint("tipo_lista", "valor", name="uq_opcao_tipo_valor"),)
    id_opcao = Column(Integer, primary_key=True, index=True)
    tipo_lista = Column(String(50), index=True)
    valor = Column(String(100))
    ordem = Column(Integer, default=0)
    ativo = Column(Boolean, default=True)


class Catalogo(Base):
    """v0.3.1 - motor genérico de catálogo: em vez de um enum novo no código toda vez que a
    associação quer uma categoria/motivo/tipo novo, o valor vive aqui e a diretoria ajusta sem
    programador (ver DECISOES_CONGELADAS.md 1.5 e PLANO_PROJETO.md v0.3.1)."""
    __tablename__ = "catalogos"
    id_catalogo = Column(Integer, primary_key=True, index=True)
    # Chave técnica estável (ex.: "categoria_associado") - é o que o código usa para achar o
    # catálogo certo; nunca é exibida à diretoria, que só vê nome_exibido.
    chave = Column(String(50), unique=True, index=True)
    nome_exibido = Column(String(100))
    descricao = Column(String, nullable=True)
    # Catálogo "de sistema" (False): o código depende de opções específicas existirem (ex.:
    # status_arrolamento) - a diretoria pode renomear rótulo e reordenar, mas não apagar opção
    # nem criar código novo por conta própria (ver ROTULO_CATALOGOS_SISTEMA em routers/core.py).
    editavel_pelo_usuario = Column(Boolean, default=True)


class OpcaoCatalogo(Base):
    """v0.3.1 - uma opção de um Catalogo. `codigo` é o que o banco referencia e NUNCA muda -
    `rotulo` é só o que a tela mostra e pode ser reescrito livremente pela diretoria sem quebrar
    nenhum registro histórico que já use este código."""
    __tablename__ = "opcoes_catalogo"
    __table_args__ = (UniqueConstraint("id_catalogo", "codigo", name="uq_opcao_catalogo_codigo"),)
    id_opcao = Column(Integer, primary_key=True, index=True)
    id_catalogo = Column(Integer, ForeignKey("catalogos.id_catalogo"), index=True)
    # Hierarquia opcional (plano de contas, tipo com subtipo, estrutura de cargo) - sem tabela nova.
    id_pai = Column(Integer, ForeignKey("opcoes_catalogo.id_opcao"), nullable=True)
    codigo = Column(String(100), index=True)
    rotulo = Column(String(200))
    ordem = Column(Integer, default=0)
    ativo = Column(Boolean, default=True)
    cor = Column(String(20), nullable=True)
    icone = Column(String(50), nullable=True)
    # Atributos específicos do catálogo que não merecem coluna própria (ex.: teto de alçada de
    # um cargo, dias de tolerância de um status) - livre por catálogo, sem migração nova cada vez.
    metadados = Column(_TipoJson, nullable=True)


class DefinicaoCampo(Base):
    """v0.3.3 - campo personalizado sem deploy: a diretoria acrescenta um campo extra num
    módulo (associado, projeto/evento, beneficiário) sem precisar de programador. Renderizado
    automaticamente pelo FormShell (v0.2.4) via lib/campos-personalizados.ts no painel.
    De propósito NUNCA entra em regra de negócio automatizada (cálculo de mensalidade, quórum) -
    se um campo personalizado vira regra, vira coluna de verdade com migração Alembic; isso
    impede o sistema de virar uma planilha disfarçada (ver PLANO_PROJETO.md v0.3.3)."""
    __tablename__ = "definicoes_campo"
    id_definicao = Column(Integer, primary_key=True, index=True)
    # Só os valores validados em schemas/core.py (ENTIDADES_CAMPO_PERSONALIZADO) - não é um
    # catálogo, porque adicionar uma entidade nova sempre exige código novo (a tabela alvo
    # precisa existir) - nunca é coisa que a diretoria configura sozinha.
    entidade = Column(String(50), index=True)
    rotulo = Column(String(200))
    # texto | numero | data | booleano | selecao | arquivo
    tipo = Column(String(20))
    # Só usado quando tipo="selecao" - a opção escolhida referencia um OpcaoCatalogo deste catálogo.
    id_catalogo = Column(Integer, ForeignKey("catalogos.id_catalogo"), nullable=True)
    obrigatorio = Column(Boolean, default=False)
    ordem = Column(Integer, default=0)
    ativo = Column(Boolean, default=True)
    # Lista de id_nivel (JSON) que enxergam este campo - vazio/null = todo mundo que acessa o
    # módulo enxerga. Não é permissão de escrita (isso continua sendo a permissão do módulo),
    # só visibilidade do campo em si (ex.: um campo só relevante para o Conselho Fiscal).
    niveis_visiveis = Column(_TipoJson, nullable=True)


class ValorCampo(Base):
    """v0.3.3 - valor de um DefinicaoCampo para um registro específico. `id_registro` é FK "por
    convenção" (não há FK de banco de verdade - o alvo depende de `DefinicaoCampo.entidade`,
    que pode ser qualquer tabela). Guardado sempre como texto (o tipo já foi validado na escrita
    pelo schema Pydantic, conforme `DefinicaoCampo.tipo`) - simples e uniforme, sem precisar de
    uma coluna por tipo de dado."""
    __tablename__ = "valores_campo"
    __table_args__ = (UniqueConstraint("id_definicao", "id_registro", name="uq_valor_campo_registro"),)
    id_valor = Column(Integer, primary_key=True, index=True)
    id_definicao = Column(Integer, ForeignKey("definicoes_campo.id_definicao"), index=True)
    id_registro = Column(Integer, index=True)
    valor = Column(String, nullable=True)


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
    # v3.0 (achado 2026-09-15) - True quando a senha foi definida por outra pessoa (secretaria
    # concedendo acesso a um associado, `POST /api/associados/{id}/conceder-acesso`), nunca pelo
    # próprio titular. `POST /auth/login` devolve essa flag pro front-end forçar troca no
    # primeiro acesso - zerada em `POST /auth/senha/alterar`.
    senha_provisoria = Column(Boolean, default=False)

class TokenAcesso(Base):
    __tablename__ = "tokens_acesso"
    id_token = Column(Integer, primary_key=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"))
    token = Column(String, unique=True, index=True)
    data_expiracao = Column(DateTime)
    # v0.2.5 - metadados de sessão (alimentam a tela "Sessões ativas" do Meu Perfil)
    ip_origem = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    ultimo_uso_em = Column(DateTime, nullable=True)

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

class CredencialWebAuthn(Base):
    """v0.4 (adendo pós-fechamento da FASE 0) - passkey: credencial FIDO2/WebAuthn atrelada a
    um dispositivo (Windows Hello, Face ID/Touch ID, chave de segurança física). Guarda só a
    chave PÚBLICA (`chave_publica_cose`, formato COSE_Key) e o contador de assinatura - a chave
    privada nunca sai do dispositivo do usuário, é o que torna esse mecanismo mais seguro que
    senha. `contador_assinatura` detecta clonagem de autenticador (deveria sempre crescer a
    cada uso; se um valor recebido for menor ou igual ao guardado, é sinal de credencial
    duplicada/clonada - ver `verificar_autenticacao_webauthn`)."""
    __tablename__ = "credenciais_webauthn"
    id_credencial = Column(Integer, primary_key=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"), index=True, nullable=False)
    credential_id = Column(String, unique=True, index=True, nullable=False)
    chave_publica_cose = Column(String, nullable=False)  # bytes da COSE_Key, guardado em base64
    contador_assinatura = Column(Integer, default=0)
    apelido = Column(String, nullable=True)  # ex.: "Notebook do trabalho" - o usuário escolhe
    transports = Column(String, nullable=True)  # CSV: "internal,hybrid" etc., vindo do navegador
    criado_em = Column(DateTime, default=datetime.utcnow)
    ultimo_uso_em = Column(DateTime, nullable=True)


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

