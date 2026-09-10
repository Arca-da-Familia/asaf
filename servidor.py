from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, DateTime, Float, Table, UniqueConstraint, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime, date
from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
import hashlib
import html
import re
import os

# ==========================================
# CONFIGURAÇÃO DO BANCO DE DADOS
# ==========================================
URL_BANCO_DADOS = "sqlite:///./erp_asaf.db"
engine = create_engine(URL_BANCO_DADOS, connect_args={"check_same_thread": False})
SessaoLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ==========================================
# TABELAS: MÓDULO 1 (O CÉREBRO)
# ==========================================
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

# ==========================================
# TABELAS: MÓDULO 2 (PESSOAS E VOLUNTÁRIOS)
# ==========================================
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

# ==========================================
# TABELAS: MÓDULO 3 (FINANCEIRO ENTERPRISE)
# ==========================================
class PlanoDeContas(Base):
    __tablename__ = "plano_de_contas"
    id_conta = Column(Integer, primary_key=True, index=True)
    codigo_contabil = Column(String, unique=True, index=True)
    descricao_conta = Column(String) 
    tipo = Column(String) 

class Fornecedor(Base):
    __tablename__ = "fornecedores"
    id_fornecedor = Column(Integer, primary_key=True, index=True)
    razao_social = Column(String, index=True)
    cnpj = Column(String, unique=True, index=True)
    categoria_servico = Column(String) 
    telefone = Column(String)

class TituloFinanceiro(Base):
    __tablename__ = "titulos_financeiros"
    id_titulo = Column(Integer, primary_key=True, index=True)
    tipo_titulo = Column(String) 
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"))
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=True) 
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=True)
    descricao = Column(String)
    valor_original = Column(Float)
    saldo_devedor = Column(Float)
    data_emissao = Column(DateTime, default=datetime.utcnow)
    data_vencimento = Column(DateTime)
    status = Column(String, default="Pendente") 

class TransacaoCaixa(Base):
    __tablename__ = "livro_caixa_auditoria"
    id_transacao = Column(Integer, primary_key=True, index=True)
    id_titulo = Column(Integer, ForeignKey("titulos_financeiros.id_titulo"), nullable=True) 
    id_conta_contabil = Column(Integer, ForeignKey("plano_de_contas.id_conta"))
    tipo_movimento = Column(String) 
    valor_efetivado = Column(Float)
    data_registro_servidor = Column(DateTime, default=datetime.utcnow) 
    forma_pagamento = Column(String) 
    status_auditoria = Column(String, default="Pendente de Conciliação") 
    observacao_auditoria = Column(String, nullable=True)

# ==========================================
# TABELAS: MÓDULO 4 (GOVERNANÇA E ATAS)
# ==========================================
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

# ==========================================
# TABELAS: MÓDULO 5 (OPERAÇÕES E PROJETOS - PDCA)
# ==========================================
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

# ------------------------------------------
# CRIAÇÃO FÍSICA DO BANCO DE DADOS
# ------------------------------------------
def preparar_banco():
    """Cria tabelas novas e adiciona colunas novas em tabelas já existentes, sem apagar dados."""
    inspetor = inspect(engine)

    # dependentes_familiares mudou de "nome livre + data" para "vínculo obrigatório com associado"; só recriamos se ainda estiver vazia.
    if inspetor.has_table("dependentes_familiares"):
        with engine.begin() as conn:
            total = conn.execute(text("SELECT COUNT(*) FROM dependentes_familiares")).scalar()
            if total == 0:
                colunas = {c["name"] for c in inspetor.get_columns("dependentes_familiares")}
                if "nome_completo" in colunas:
                    conn.execute(text("DROP TABLE dependentes_familiares"))

    # RG foi removido do cadastro (documento sendo substituído pela CIN); tira a coluna se ainda existir.
    if inspetor.has_table("associados"):
        colunas_associado = {c["name"] for c in inspetor.get_columns("associados")}
        if "rg" in colunas_associado:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE associados DROP COLUMN rg"))

    Base.metadata.create_all(bind=engine)

    inspetor = inspect(engine)
    with engine.begin() as conn:
        for tabela in Base.metadata.tables.values():
            if not inspetor.has_table(tabela.name):
                continue
            colunas_existentes = {c["name"] for c in inspetor.get_columns(tabela.name)}
            for coluna in tabela.columns:
                if coluna.name not in colunas_existentes:
                    tipo_sql = coluna.type.compile(engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{tabela.name}" ADD COLUMN "{coluna.name}" {tipo_sql}'))

preparar_banco()

def seed_opcoes_lista():
    """Preenche valores padrão de cada lista configurável, apenas se ela ainda estiver vazia."""
    padroes = {
        "categoria_associado": ["Efetivo", "Contribuinte", "Fundador"],
        "status_arrolamento": ["Ativo - Em Dia", "Ativo - Inadimplente", "Suspenso (Estatuto)", "Desligado"],
        "estado_civil": ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)", "União Estável"],
        "grau_parentesco": ["Cônjuge", "Filho(a)", "Pai", "Mãe", "Irmão(ã)", "Neto(a)", "Outro"],
        "categoria_fornecedor": ["Material de Construção", "Serviços Gráficos", "Alimentação", "Tecnologia", "Manutenção e Reparos", "Transporte", "Outros"],
        "tipo_conta_contabil": ["Receita", "Despesa"],
        "forma_pagamento": ["Pix", "Dinheiro", "Cartão", "Transferência Bancária", "Boleto"],
        "titulo_cargo": ["Presidente", "Vice-Presidente", "Tesoureiro", "Vice-Tesoureiro", "Secretário", "Vice-Secretário", "Conselho Fiscal", "Diretor de Patrimônio", "Diretor Social"],
    }
    db = SessaoLocal()
    try:
        for tipo_lista, valores in padroes.items():
            if db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista).first():
                continue
            for i, valor in enumerate(valores):
                db.add(OpcaoLista(tipo_lista=tipo_lista, valor=valor, ordem=i))
        db.commit()
    finally:
        db.close()

seed_opcoes_lista()

os.makedirs("uploads/fotos", exist_ok=True)

# ==========================================
# INICIALIZAÇÃO DO SERVIDOR E FRONTEND
# ==========================================
app = FastAPI(title="ERP ASAF - Versão Enterprise", version="2.0")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

def get_db():
    db = SessaoLocal()
    try:
        yield db
    finally:
        db.close()

def criptografar_senha(senha_pura: str):
    return hashlib.sha256(senha_pura.encode()).hexdigest()

def esc(valor):
    """Escapa valores antes de embuti-los em HTML/atributos, evitando XSS."""
    if valor is None:
        return ""
    return html.escape(str(valor), quote=True)

def iniciais(nome):
    partes = [p for p in (nome or "").strip().split() if p]
    if not partes:
        return "?"
    if len(partes) == 1:
        return partes[0][0].upper()
    return (partes[0][0] + partes[-1][0]).upper()

def avatar_html(pessoa, tamanho="w-9 h-9 text-xs"):
    if getattr(pessoa, "foto", None):
        return f'<img src="{esc(pessoa.foto)}" class="{tamanho} rounded-full object-cover border border-slate-200">'
    cor_ini = "bg-blue-100 text-blue-700"
    return f'<div class="{tamanho} rounded-full {cor_ini} flex items-center justify-center font-bold border border-slate-200">{esc(iniciais(pessoa.nome_completo))}</div>'

# ==========================================
# MODELOS DE ENTRADA (PYDANTIC)
# ==========================================
class AssociadoMasterCriar(BaseModel):
    nome_completo: str
    cpf: str
    email_contato: EmailStr
    telefone_whatsapp: str
    categoria: str
    cep: str
    logradouro: str
    numero: str
    bairro: str
    cidade: str
    estado: str
    data_nascimento: Optional[date] = None
    estado_civil: Optional[str] = None
    profissao: Optional[str] = None
    naturalidade: Optional[str] = None

    @field_validator("nome_completo")
    @classmethod
    def validar_nome(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o nome completo.")
        return v.strip()

    @field_validator("cpf")
    @classmethod
    def validar_cpf(cls, v):
        digitos = re.sub(r"\D", "", v)
        if len(digitos) != 11:
            raise ValueError("CPF deve conter 11 dígitos.")
        return digitos

class PlanoContaCriar(BaseModel):
    codigo_contabil: str
    descricao_conta: str
    tipo: str

    @field_validator("codigo_contabil")
    @classmethod
    def validar_codigo(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Informe o código contábil.")
        return v.strip()

class FornecedorCriar(BaseModel):
    razao_social: str
    cnpj: str
    categoria_servico: str
    telefone: str

    @field_validator("cnpj")
    @classmethod
    def validar_cnpj(cls, v):
        digitos = re.sub(r"\D", "", v)
        if len(digitos) != 14:
            raise ValueError("CNPJ deve conter 14 dígitos.")
        return digitos

class TituloCriar(BaseModel):
    tipo_titulo: str
    id_conta_contabil: int
    id_associado: Optional[int] = None
    id_fornecedor: Optional[int] = None
    descricao: str
    valor_original: float
    data_vencimento: datetime

    @field_validator("valor_original")
    @classmethod
    def validar_valor(cls, v):
        if v <= 0:
            raise ValueError("O valor deve ser maior que zero.")
        return v

class BaixarTitulo(BaseModel):
    id_titulo: int
    valor_pago: float
    forma_pagamento: str

    @field_validator("valor_pago")
    @classmethod
    def validar_valor_pago(cls, v):
        if v <= 0:
            raise ValueError("O valor pago deve ser maior que zero.")
        return v

class HistoricoCargoCriar(BaseModel):
    titulo_cargo: str
    data_posse: date

class HistoricoCargoEncerrar(BaseModel):
    data_saida: date

class AssembleiaCriar(BaseModel):
    titulo_edital: str
    pauta_principal: str
    data_realizacao: datetime

class VotoRegistrar(BaseModel):
    id_assembleia: int
    id_associado: int
    decisao: str
    tipo_assinatura: str
    protocolo_autenticacao: str

class ProjetoCriar(BaseModel):
    nome_projeto: str
    tipo_foco: str
    necessita_alvara_bombeiros: bool
    data_inicio: datetime
    data_fim_prevista: datetime

class VoluntarioAlocar(BaseModel):
    id_projeto: int
    id_associado: int
    funcao_desempenhada: str

class AssociadoAdminUpdate(BaseModel):
    nome_completo: str
    email_contato: EmailStr
    telefone_whatsapp: str
    categoria: str
    status_arrolamento: str
    cep: str = ""
    logradouro: str = ""
    numero: str = ""
    bairro: str = ""
    cidade: str = ""
    estado: str = ""
    data_nascimento: Optional[date] = None
    estado_civil: Optional[str] = None
    profissao: Optional[str] = None
    naturalidade: Optional[str] = None

class AssociadoPerfilUpdate(BaseModel):
    email_contato: EmailStr
    telefone_whatsapp: str
    logradouro: str
    numero: str
    bairro: str
    cidade: str
    estado: str
    data_nascimento: Optional[date] = None
    estado_civil: Optional[str] = None
    profissao: Optional[str] = None
    naturalidade: Optional[str] = None

class OpcaoCriar(BaseModel):
    valor: str

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("Informe um valor.")
        return v.strip()

class OpcaoAtualizar(BaseModel):
    valor: Optional[str] = None
    ativo: Optional[bool] = None

class DependenteCriar(BaseModel):
    id_associado_vinculado: int
    grau_parentesco: str

class DependenteAtualizar(BaseModel):
    grau_parentesco: str

# ==========================================
# ROTAS DO SISTEMA (API E FRONTEND)
# ==========================================
# ==========================================
# ROTA VISUAL (FRONTEND DIRETO)
# ==========================================
@app.get("/", response_class=HTMLResponse, summary="Página Inicial (Landing Page)")
def ler_pagina_inicial():
    # Lê o arquivo index.html da pasta templates diretamente, sem erros de cache do Jinja
    try:
        with open("templates/index.html", "r", encoding="utf-8") as arquivo:
            return arquivo.read()
    except FileNotFoundError:
        return "<h1>Erro: Arquivo templates/index.html não encontrado!</h1>"
@app.post("/setup-cerebro/", summary="1. Inicializar Cérebro")
def setup_cerebro(db: Session = Depends(get_db)):
    configs = [
        {"chave": "NOME_INSTITUICAO", "valor": "ASAF - Associação Arca da Família"},
        {"chave": "STATUS_ARROLAMENTO_PADRAO", "valor": "Ativo - Em Dia"},
        {"chave": "MODELO_GESTAO", "valor": "Governança Terceiro Setor"}
    ]
    for c in configs:
        if not db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == c["chave"]).first():
            db.add(ConfiguracaoInstitucional(chave_configuracao=c["chave"], valor_configuracao=c["valor"]))
    db.commit()
    return {"mensagem": "Cérebro inicializado com sucesso!"}

@app.post("/associados-master/", summary="2. Cadastrar Ficha Master")
def cadastrar_ficha_master(dados: AssociadoMasterCriar, db: Session = Depends(get_db)):
    if db.query(Associado).filter(Associado.cpf == dados.cpf).first():
        raise HTTPException(status_code=400, detail="Este CPF já está arrolado.")
    try:
        novo_associado = Associado(
            nome_completo=dados.nome_completo, cpf=dados.cpf,
            email_contato=dados.email_contato, telefone_whatsapp=dados.telefone_whatsapp,
            categoria=dados.categoria,
            data_nascimento=datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None,
            estado_civil=dados.estado_civil,
            profissao=dados.profissao, naturalidade=dados.naturalidade
        )
        db.add(novo_associado)
        db.commit()
        db.refresh(novo_associado)

        novo_endereco = Endereco(
            id_associado=novo_associado.id_associado, cep=dados.cep,
            logradouro=dados.logradouro, numero=dados.numero,
            bairro=dados.bairro, cidade=dados.cidade, estado=dados.estado
        )
        db.add(novo_endereco)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Não foi possível cadastrar: CPF já existe ou dado inválido.")
    return {"mensagem": f"Ficha de {novo_associado.nome_completo} criada com sucesso!", "id_associado": novo_associado.id_associado}

@app.get("/api/plano-contas/", summary="Listar Plano de Contas")
def listar_plano_contas(db: Session = Depends(get_db)):
    contas = db.query(PlanoDeContas).order_by(PlanoDeContas.codigo_contabil).all()
    return [{"id_conta": c.id_conta, "codigo_contabil": c.codigo_contabil, "descricao_conta": c.descricao_conta, "tipo": c.tipo} for c in contas]

@app.post("/plano-contas/", summary="3. Cadastrar Plano de Contas")
def cadastrar_plano_contas(dados: PlanoContaCriar, db: Session = Depends(get_db)):
    nova_conta = PlanoDeContas(codigo_contabil=dados.codigo_contabil, descricao_conta=dados.descricao_conta, tipo=dados.tipo)
    db.add(nova_conta)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma conta com esse código contábil.")
    db.refresh(nova_conta)
    return {"mensagem": "Conta contábil cadastrada.", "id_conta": nova_conta.id_conta}

@app.put("/api/plano-contas/{id_conta}", summary="Editar Plano de Contas")
def editar_plano_contas(id_conta: int, dados: PlanoContaCriar, db: Session = Depends(get_db)):
    conta = db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == id_conta).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    conta.codigo_contabil = dados.codigo_contabil
    conta.descricao_conta = dados.descricao_conta
    conta.tipo = dados.tipo
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma conta com esse código contábil.")
    return {"mensagem": "Conta contábil atualizada."}

@app.get("/api/fornecedores/", summary="Listar Fornecedores")
def listar_fornecedores(db: Session = Depends(get_db)):
    fornecedores = db.query(Fornecedor).order_by(Fornecedor.razao_social).all()
    return [{"id_fornecedor": f.id_fornecedor, "razao_social": f.razao_social, "cnpj": f.cnpj, "categoria_servico": f.categoria_servico, "telefone": f.telefone} for f in fornecedores]

@app.post("/fornecedores/", summary="4. Cadastrar Fornecedor")
def cadastrar_fornecedor(dados: FornecedorCriar, db: Session = Depends(get_db)):
    novo_fornecedor = Fornecedor(razao_social=dados.razao_social, cnpj=dados.cnpj, categoria_servico=dados.categoria_servico, telefone=dados.telefone)
    db.add(novo_fornecedor)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um fornecedor com esse CNPJ.")
    db.refresh(novo_fornecedor)
    return {"mensagem": "Fornecedor cadastrado.", "id_fornecedor": novo_fornecedor.id_fornecedor}

@app.put("/api/fornecedores/{id_fornecedor}", summary="Editar Fornecedor")
def editar_fornecedor(id_fornecedor: int, dados: FornecedorCriar, db: Session = Depends(get_db)):
    fornecedor = db.query(Fornecedor).filter(Fornecedor.id_fornecedor == id_fornecedor).first()
    if not fornecedor:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    fornecedor.razao_social = dados.razao_social
    fornecedor.cnpj = dados.cnpj
    fornecedor.categoria_servico = dados.categoria_servico
    fornecedor.telefone = dados.telefone
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um fornecedor com esse CNPJ.")
    return {"mensagem": "Fornecedor atualizado."}

@app.get("/api/titulos/", summary="Listar Títulos Financeiros")
def listar_titulos(status: str = None, tipo_titulo: str = None, db: Session = Depends(get_db)):
    consulta = db.query(TituloFinanceiro)
    if status:
        consulta = consulta.filter(TituloFinanceiro.status == status)
    if tipo_titulo:
        consulta = consulta.filter(TituloFinanceiro.tipo_titulo == tipo_titulo)
    titulos = consulta.order_by(TituloFinanceiro.data_vencimento).all()

    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}
    associados = {a.id_associado: a for a in db.query(Associado).all()}
    fornecedores = {f.id_fornecedor: f for f in db.query(Fornecedor).all()}

    resultado = []
    for t in titulos:
        conta = contas.get(t.id_conta_contabil)
        beneficiario = None
        if t.id_associado and t.id_associado in associados:
            beneficiario = associados[t.id_associado].nome_completo
        elif t.id_fornecedor and t.id_fornecedor in fornecedores:
            beneficiario = fornecedores[t.id_fornecedor].razao_social
        resultado.append({
            "id_titulo": t.id_titulo,
            "tipo_titulo": t.tipo_titulo,
            "descricao": t.descricao,
            "conta_contabil": conta.descricao_conta if conta else "",
            "beneficiario": beneficiario or "-",
            "valor_original": t.valor_original,
            "saldo_devedor": t.saldo_devedor,
            "data_vencimento": t.data_vencimento.date().isoformat() if t.data_vencimento else None,
            "status": t.status
        })
    return resultado

@app.post("/titulos/", summary="5. Lançar Título Financeiro")
def lancar_titulo(dados: TituloCriar, db: Session = Depends(get_db)):
    if not db.query(PlanoDeContas).filter(PlanoDeContas.id_conta == dados.id_conta_contabil).first():
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    if dados.id_associado and not db.query(Associado).filter(Associado.id_associado == dados.id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    if dados.id_fornecedor and not db.query(Fornecedor).filter(Fornecedor.id_fornecedor == dados.id_fornecedor).first():
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")

    novo_titulo = TituloFinanceiro(
        tipo_titulo=dados.tipo_titulo, id_conta_contabil=dados.id_conta_contabil,
        id_associado=dados.id_associado, id_fornecedor=dados.id_fornecedor,
        descricao=dados.descricao, valor_original=dados.valor_original,
        saldo_devedor=dados.valor_original, data_vencimento=dados.data_vencimento
    )
    db.add(novo_titulo)
    db.commit()
    db.refresh(novo_titulo)
    return {"mensagem": "Título registrado.", "id_titulo": novo_titulo.id_titulo}

@app.get("/api/livro-caixa/", summary="Extrato do Livro-Caixa")
def listar_livro_caixa(db: Session = Depends(get_db)):
    transacoes = db.query(TransacaoCaixa).order_by(TransacaoCaixa.data_registro_servidor).all()
    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}

    saldo = 0.0
    resultado = []
    for t in transacoes:
        saldo += t.valor_efetivado if t.tipo_movimento == "Entrada" else -t.valor_efetivado
        conta = contas.get(t.id_conta_contabil)
        resultado.append({
            "id_transacao": t.id_transacao,
            "data": t.data_registro_servidor.date().isoformat() if t.data_registro_servidor else None,
            "conta_contabil": conta.descricao_conta if conta else "",
            "tipo_movimento": t.tipo_movimento,
            "valor_efetivado": t.valor_efetivado,
            "forma_pagamento": t.forma_pagamento,
            "status_auditoria": t.status_auditoria,
            "saldo_apos": round(saldo, 2)
        })
    resultado.reverse()
    return {"transacoes": resultado, "saldo_atual": round(saldo, 2)}

@app.post("/baixar-titulo/", summary="6. Baixar Título / Livro-Caixa")
def baixar_titulo(dados: BaixarTitulo, db: Session = Depends(get_db)):
    titulo = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == dados.id_titulo).first()
    if not titulo:
        raise HTTPException(status_code=404, detail="Título não encontrado.")
    if titulo.status == "Pago":
        raise HTTPException(status_code=400, detail="Este título já está totalmente pago.")
    if dados.valor_pago > titulo.saldo_devedor:
        raise HTTPException(status_code=400, detail=f"Valor pago não pode ser maior que o saldo devedor (R$ {titulo.saldo_devedor:.2f}).")
    titulo.saldo_devedor -= dados.valor_pago
    if titulo.saldo_devedor <= 0:
        titulo.status = "Pago"
        titulo.saldo_devedor = 0.0
    tipo_mov = "Saída" if titulo.tipo_titulo == "A Pagar" else "Entrada"
    transacao = TransacaoCaixa(
        id_titulo=titulo.id_titulo, id_conta_contabil=titulo.id_conta_contabil,
        tipo_movimento=tipo_mov, valor_efetivado=dados.valor_pago, forma_pagamento=dados.forma_pagamento
    )
    db.add(transacao)
    db.commit()
    return {"mensagem": "Transação registrada no Livro-Caixa.", "saldo_restante": titulo.saldo_devedor}

# ==========================================
# HISTÓRICO DE CARGOS
# ==========================================
@app.get("/api/associados/{id_associado}/cargos", summary="Listar histórico de cargos")
def listar_cargos(id_associado: int, db: Session = Depends(get_db)):
    cargos = db.query(HistoricoCargo).filter(HistoricoCargo.id_associado == id_associado).order_by(HistoricoCargo.data_posse.desc()).all()
    return [{
        "id_historico": c.id_historico,
        "titulo_cargo": c.titulo_cargo,
        "data_posse": c.data_posse.date().isoformat() if c.data_posse else None,
        "data_saida": c.data_saida.date().isoformat() if c.data_saida else None
    } for c in cargos]

@app.post("/api/associados/{id_associado}/cargos", summary="Registrar posse em cargo")
def criar_cargo(id_associado: int, dados: HistoricoCargoCriar, db: Session = Depends(get_db)):
    if not db.query(Associado).filter(Associado.id_associado == id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    novo = HistoricoCargo(
        id_associado=id_associado, titulo_cargo=dados.titulo_cargo,
        data_posse=datetime.combine(dados.data_posse, datetime.min.time())
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return {"mensagem": "Posse registrada.", "id_historico": novo.id_historico}

@app.put("/api/cargos/{id_historico}/encerrar", summary="Registrar saída do cargo")
def encerrar_cargo(id_historico: int, dados: HistoricoCargoEncerrar, db: Session = Depends(get_db)):
    cargo = db.query(HistoricoCargo).filter(HistoricoCargo.id_historico == id_historico).first()
    if not cargo:
        raise HTTPException(status_code=404, detail="Registro de cargo não encontrado.")
    cargo.data_saida = datetime.combine(dados.data_saida, datetime.min.time())
    db.commit()
    return {"mensagem": "Saída do cargo registrada."}

@app.delete("/api/cargos/{id_historico}", summary="Remover registro de cargo")
def remover_cargo(id_historico: int, db: Session = Depends(get_db)):
    cargo = db.query(HistoricoCargo).filter(HistoricoCargo.id_historico == id_historico).first()
    if not cargo:
        raise HTTPException(status_code=404, detail="Registro de cargo não encontrado.")
    db.delete(cargo)
    db.commit()
    return {"mensagem": "Registro removido."}

@app.post("/assembleias/", summary="7. Agendar Assembleia")
def agendar_assembleia(dados: AssembleiaCriar, db: Session = Depends(get_db)):
    nova_assembleia = Assembleia(titulo_edital=dados.titulo_edital, pauta_principal=dados.pauta_principal, data_realizacao=dados.data_realizacao)
    db.add(nova_assembleia)
    db.commit()
    db.refresh(nova_assembleia)
    return {"mensagem": "Assembleia agendada.", "id_assembleia": nova_assembleia.id_assembleia}

@app.post("/votar/", summary="8. Registrar Voto")
def registrar_voto(dados: VotoRegistrar, db: Session = Depends(get_db)):
    voto = RegistroVoto(
        id_assembleia=dados.id_assembleia, id_associado=dados.id_associado,
        decisao=dados.decisao, tipo_assinatura=dados.tipo_assinatura, protocolo_autenticacao=dados.protocolo_autenticacao
    )
    db.add(voto)
    db.commit()
    return {"mensagem": "Voto computado com sucesso!"}

@app.post("/projetos/", summary="9. Criar Projeto (PDCA)")
def criar_projeto(dados: ProjetoCriar, db: Session = Depends(get_db)):
    projeto = ProjetoEvento(
        nome_projeto=dados.nome_projeto, tipo_foco=dados.tipo_foco,
        necessita_alvara_bombeiros=dados.necessita_alvara_bombeiros,
        data_inicio=dados.data_inicio, data_fim_prevista=dados.data_fim_prevista
    )
    if projeto.necessita_alvara_bombeiros:
        projeto.status_liberacao = "Pendente de Vistoria"
    db.add(projeto)
    db.commit()
    db.refresh(projeto)
    return {"mensagem": "Projeto inicializado.", "id_projeto": projeto.id_projeto}

@app.post("/projetos/alocar/", summary="10. Alocar Voluntário")
def alocar_voluntario(dados: VoluntarioAlocar, db: Session = Depends(get_db)):
    alocacao = AlocacaoVoluntario(id_projeto=dados.id_projeto, id_associado=dados.id_associado, funcao_desempenhada=dados.funcao_desempenhada)
    db.add(alocacao)
    db.commit()
    return {"mensagem": "Voluntário escalado com sucesso!"}
# ==========================================
# ROTAS VISUAIS (FRONTEND DINÂMICO ENTERPRISE)
# ==========================================
@app.get("/meu-portal/{id_associado}", response_class=HTMLResponse, summary="Super Portal do Associado")
def portal_associado_dinamico(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        return "<h1 style='text-align:center; margin-top:50px; font-family:sans-serif;'>Erro 404: Ficha Master não encontrada no sistema.</h1>"

    titulos = db.query(TituloFinanceiro).filter(
        TituloFinanceiro.id_associado == id_associado, 
        TituloFinanceiro.status != "Pago"
    ).all()
    divida_total = sum(t.saldo_devedor for t in titulos)
    
    status_financeiro = "Sem pendências" if divida_total == 0 else f"Débito: R$ {divida_total:.2f}"
    cor_financeira = "text-green-600" if divida_total == 0 else "text-red-600"

    # QR Code de identificação — não enviamos o CPF completo a um serviço externo
    dados_qr = f"ASAF-ID:{associado.id_associado}|Status:{associado.status_arrolamento}"
    url_qrcode = f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={html.escape(dados_qr)}"

    nome = esc(associado.nome_completo)
    categoria = esc(associado.categoria)
    status = esc(associado.status_arrolamento)
    cpf_mascarado = esc(associado.cpf[-2:])

    html_content = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Portal Corporativo - {nome}</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-100 font-sans antialiased flex h-screen overflow-hidden">
        
        <!-- MEGA MENU LATERAL (Sidebar) -->
        <aside class="w-80 bg-slate-900 text-white flex flex-col shadow-2xl z-10">
            <div class="h-20 flex items-center justify-center border-b border-slate-800">
                <h2 class="text-2xl font-extrabold tracking-widest text-blue-400">ASAF<span class="text-white">PORTAL</span></h2>
            </div>
            <nav class="flex-1 px-4 py-6 space-y-1 overflow-y-auto text-sm font-medium">
                
                <p class="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-4">Principal</p>
                <a href="#" class="flex items-center px-4 py-2.5 bg-blue-600 rounded-lg text-white shadow-md">Painel de Resumo</a>
                <a href="/meu-perfil/{id_associado}" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Minha Identidade Digital</a>
                
                <p class="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Governança & Atas</p>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Assembleias (Votação ICP-Brasil)</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Hub de Transparência (D.R.E.)</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Propor Emendas Estatutárias</a>

                <p class="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Ações e PDCA</p>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Projetos de Extensão</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Emissão de Certificados</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Chamados e Zeladoria</a>
                
                <p class="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Administrativo</p>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Tesouraria (Pix / Baixas)</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Cautela de Patrimônio</a>
                <a href="#" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Ouvidoria (Canal Blindado)</a>
                <a href="/minha-familia/{id_associado}" class="flex items-center px-4 py-2.5 hover:bg-slate-800 rounded-lg text-slate-300">Atualizar Árvore Familiar</a>
            </nav>
            <div class="p-4 border-t border-slate-800">
                <a href="/" class="flex items-center justify-center w-full px-4 py-2 bg-slate-800 hover:bg-red-600 rounded-lg transition-colors text-sm font-semibold">
                    &larr; Sair
                </a>
            </div>
        </aside>

        <!-- Área Principal -->
        <main class="flex-1 flex flex-col h-screen overflow-y-auto">
            <header class="h-20 bg-white shadow-sm flex items-center justify-between px-10 border-b border-slate-200">
                <div>
                    <h1 class="text-2xl font-bold text-slate-800">{nome}</h1>
                    <p class="text-sm text-slate-500">Associado {categoria}</p>
                </div>
                <span class="px-4 py-1.5 bg-slate-800 text-white text-xs font-bold uppercase rounded-full tracking-wider">
                    {status}
                </span>
            </header>
            
            <div class="p-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                
                <!-- CARTÃO DE IDENTIDADE (COLUNA DUPLA) -->
                <div class="md:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div class="bg-blue-700 p-4 text-white flex justify-between items-center">
                        <h2 class="text-sm font-bold tracking-widest uppercase">ID Institucional de Governança</h2>
                    </div>
                    <div class="p-6 flex items-center space-x-6">
                        {avatar_html(associado, "w-28 h-28 text-3xl")}
                        <div class="p-1 border-2 border-slate-200 rounded-lg bg-white shadow-sm">
                            <img src="{url_qrcode}" alt="QR Code" class="w-28 h-28">
                        </div>
                        <div class="space-y-2 flex-1">
                            <div>
                                <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Titular</p>
                                <p class="text-xl font-extrabold text-slate-800">{nome}</p>
                            </div>
                            <div class="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Matrícula</p>
                                    <p class="text-sm font-bold text-slate-700">#00{associado.id_associado}</p>
                                </div>
                                <div>
                                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">CPF Vinculado</p>
                                    <p class="text-sm font-bold text-slate-700">***.***.{cpf_mascarado}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- EXTRATO FINANCEIRO RÁPIDO -->
                <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between border-t-4 border-t-blue-500">
                    <h3 class="text-slate-500 text-xs font-bold mb-4 uppercase tracking-wider">Tesouraria</h3>
                    <div>
                        <p class="text-3xl font-extrabold {cor_financeira}">{status_financeiro}</p>
                        <p class="text-xs text-slate-400 mt-1">Auditado com Livro-Caixa</p>
                    </div>
                    <button class="w-full mt-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 rounded-lg text-sm">
                        Gerar Código Pix
                    </button>
                </div>

                <!-- NOTIFICAÇÕES LEGISLATIVAS E PROJETOS -->
                <div class="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-8">
                    
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <div class="flex items-center mb-4">
                            <span class="w-3 h-3 bg-red-500 rounded-full animate-pulse mr-3"></span>
                            <h3 class="font-bold text-slate-800 uppercase tracking-wide text-sm">Pauta Pendente de Voto</h3>
                        </div>
                        <p class="text-slate-600 text-sm mb-4">A Reforma do Estatuto (Pauta AGE 02/2026) exige aprovação com assinatura eletrônica para averbação.</p>
                        <a href="#" class="text-blue-600 font-bold text-sm hover:underline">Registrar Decisão &rarr;</a>
                    </div>

                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <div class="flex items-center mb-4">
                            <span class="w-3 h-3 bg-green-500 rounded-full mr-3"></span>
                            <h3 class="font-bold text-slate-800 uppercase tracking-wide text-sm">Ações em Fase "DO" (PDCA)</h3>
                        </div>
                        <p class="text-slate-600 text-sm mb-4">O Desfile Social necessita de voluntários para a Logística. Assine o termo e participe.</p>
                        <a href="#" class="text-blue-600 font-bold text-sm hover:underline">Acessar Escala &rarr;</a>
                    </div>

                </div>
            </div>
        </main>
    </body>
    </html>
    """
    return html_content
# ==========================================
# ROTA: MEGA PORTAL ADMINISTRATIVO
# ==========================================
@app.get("/admin", response_class=HTMLResponse, summary="Mega Portal da Diretoria")
def painel_administrativo_master(db: Session = Depends(get_db)):
    # Buscando métricas rápidas no banco para o painel de instrumentos
    total_associados = db.query(Associado).count()
    projetos_pendentes = db.query(ProjetoEvento).filter(ProjetoEvento.status_liberacao == "Pendente de Vistoria").count()
    
    html_admin = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Central Administrativa - ASAF Enterprise</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 font-sans antialiased flex h-screen overflow-hidden">
        
        <!-- MEGA MENU ADMINISTRATIVO -->
        <aside class="w-80 bg-slate-900 text-white flex flex-col shadow-2xl z-10 overflow-y-auto">
            <div class="p-6 border-b border-slate-800 sticky top-0 bg-slate-900 z-20">
                <h2 class="text-2xl font-extrabold tracking-widest text-red-500">ASAF<span class="text-white">COMMAND</span></h2>
                <p class="text-xs text-slate-400 mt-1 uppercase tracking-widest">Governança Terceiro Setor</p>
            </div>
            
            <nav class="flex-1 px-4 py-6 space-y-1 text-sm font-medium overflow-y-auto pb-20">
                
                <!-- GABINETE E JURÍDICO -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-2">Gabinete e Jurídico</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">1. Quórum Dinâmico</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">2. Auditoria e-Notariado</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">3. Livro de Atas Digital</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">4. Reformas Estatutárias</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">5. Conflito de Interesses</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">6. Vencimento de Mandatos</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">7. Reuniões (MS Teams)</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">8. Compliance CEBAS</a>

                <!-- TESOURARIA -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Tesouraria e Finanças</p>
                <a href="/admin/titulos" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">9. Títulos (Lançar / Baixar)</a>
                <a href="/admin/livro-caixa" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">9.1 Livro-Caixa e Conciliação</a>
                <a href="/admin/plano-contas" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">9.2 Plano de Contas</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">10. Trava de Data Retroativa</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">11. D.R.E. Institucional</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">12. Calculadora de Depreciação</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">13. Mapa de Inadimplência</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">14. Conciliação Pix</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">15. Reembolsos (Voluntários)</a>
                <a href="/admin/fornecedores" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">16. Cadastro de Fornecedores</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">17. Exportação Balancetes</a>

                <!-- ENGENHARIA E INFRAESTRUTURA -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Engenharia e Obras</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">18. Projetos de Fundação/Solos</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">19. Checklists NBR (Aço/Madeira)</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">20. Alvarás CBM-PA</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">21. Licenças Municipais</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">22. Zeladoria e Chamados</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">23. Agendamento de Espaços</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">24. Logística de Frota</a>

                <!-- OPERAÇÕES E EVENTOS (PDCA) -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Projetos Sociais (PDCA)</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">25. Visão Kanban (Extensão)</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">26. Escalonamento Logístico</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">27. Check-in de Voluntários</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">28. Gerador de Certificados</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">29. Retrospectiva Pós-Evento</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">30. Entrada de Doações</a>

                <!-- ESTOQUE E PATRIMÔNIO -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Patrimônio</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">31. Inventário Dinâmico</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">32. Cautela de Equipamentos</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">33. Registro de Avarias</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">34. Alertas de Reposição</a>

                <!-- SECRETARIA -->
<p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Secretaria Geral</p>
<a href="/admin/secretaria" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">35. Gestão de Fichas Master</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">36. Árvore Familiar</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">37. Radar de Habilidades</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">38. Ouvidoria</a>
                <a href="/admin/secretaria" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">39. Histórico de Cargos</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">40. Desligamentos</a>

                <!-- TI -->
                <p class="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6">Tecnologia da Informação</p>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">41. Perfis e Permissões</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">42. Logs de Auditoria do Sistema</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">43. Automação SharePoint</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">44. Editor de Templates Visuais</a>
                <a href="#" class="flex items-center px-4 py-2 hover:bg-slate-800 rounded-lg text-slate-300">45. Backup de Banco de Dados</a>

            </nav>
        </aside>

        <!-- DASHBOARD CENTRAL -->
        <main class="flex-1 flex flex-col h-screen overflow-y-auto">
            <header class="h-20 bg-white shadow-sm flex items-center justify-between px-10 border-b border-slate-200">
                <h1 class="text-2xl font-bold text-slate-800">Mesa de Operações Diretiva</h1>
                <div class="flex items-center space-x-4">
                    <span class="px-4 py-1.5 bg-red-100 text-red-800 text-xs font-bold uppercase rounded-lg border border-red-200">
                        Acesso Nível: Diretoria Executiva
                    </span>
                    <a href="/" class="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors">Voltar à Raiz</a>
                </div>
            </header>
            
            <div class="p-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                
                <!-- INDICADORES CRÍTICOS DE GOVERNANÇA -->
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-blue-500">
                    <h3 class="text-slate-500 text-[11px] font-bold mb-1 uppercase tracking-wider">Base Social Ativa</h3>
                    <p class="text-3xl font-black text-slate-800">{total_associados}</p>
                    <p class="text-xs text-green-600 mt-2 font-semibold">Total de fichas master arroladas</p>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-orange-500">
                    <h3 class="text-slate-500 text-[11px] font-bold mb-1 uppercase tracking-wider">Alvarás de Segurança CBM</h3>
                    <p class="text-3xl font-black text-slate-800">{projetos_pendentes}</p>
                    <p class="text-xs text-red-600 mt-2 font-semibold">Projetos PDCA com pendência técnica</p>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-purple-500">
                    <h3 class="text-slate-500 text-[11px] font-bold mb-1 uppercase tracking-wider">Votações / Quórum</h3>
                    <p class="text-3xl font-black text-slate-800">AGE 02</p>
                    <p class="text-xs text-blue-600 mt-2 font-semibold">Aguardando certidões qualificadas</p>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-emerald-500">
                    <h3 class="text-slate-500 text-[11px] font-bold mb-1 uppercase tracking-wider">Tesouraria</h3>
                    <p class="text-3xl font-black text-slate-800">Fechado</p>
                    <p class="text-xs text-emerald-600 mt-2 font-semibold">Nenhuma falha de data retroativa detectada</p>
                </div>

                <!-- GRADES DE AVISO LARGO -->
                <div class="lg:col-span-4 grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    
                    <div class="bg-slate-900 rounded-2xl shadow-sm border border-slate-800 p-8 text-white">
                        <div class="flex items-center mb-4">
                            <span class="w-3 h-3 bg-red-500 rounded-full animate-pulse mr-3"></span>
                            <h3 class="font-bold text-red-400 uppercase tracking-wide text-sm">Trava de Engenharia Acionada</h3>
                        </div>
                        <p class="text-slate-300 text-sm mb-4 leading-relaxed">O projeto "Desfile Social" está bloqueado para avanço operacional. As licenças municipais de espaço público e os laudos de vistoria de estruturas não foram anexados na aba Operacional (PDCA).</p>
                        <button class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg text-sm transition-colors">
                            Forçar Resolução de Pendência
                        </button>
                    </div>

                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                        <div class="flex items-center mb-4">
                            <span class="w-3 h-3 bg-blue-500 rounded-full mr-3"></span>
                            <h3 class="font-bold text-slate-800 uppercase tracking-wide text-sm">Status Jurídico</h3>
                        </div>
                        <p class="text-slate-600 text-sm mb-4 leading-relaxed">A parametrização do sistema está configurada para Governança do Terceiro Setor. Assinaturas eletrônicas padrão não serão computadas para o registro civil da nova ata estatutária.</p>
                        <button class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-6 rounded-lg text-sm transition-colors">
                            Auditar Protocolos ICP-Brasil
                        </button>
                    </div>

                </div>
            </div>
        </main>
    </body>
    </html>
    """
    return html_admin
# ==========================================
# APIs DE ATUALIZAÇÃO (MOTORES DO CRUD)
# ==========================================
@app.put("/api/associados/{id_associado}", summary="Admin - Editar Associado")
def admin_editar_associado(id_associado: int, dados: AssociadoAdminUpdate, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")

    associado.nome_completo = dados.nome_completo
    associado.email_contato = dados.email_contato
    associado.telefone_whatsapp = dados.telefone_whatsapp
    associado.categoria = dados.categoria
    associado.status_arrolamento = dados.status_arrolamento
    associado.estado_civil = dados.estado_civil
    associado.profissao = dados.profissao
    associado.naturalidade = dados.naturalidade
    associado.data_nascimento = datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None

    endereco = db.query(Endereco).filter(Endereco.id_associado == id_associado).first()
    if not endereco:
        endereco = Endereco(id_associado=id_associado)
        db.add(endereco)
    endereco.cep = dados.cep
    endereco.logradouro = dados.logradouro
    endereco.numero = dados.numero
    endereco.bairro = dados.bairro
    endereco.cidade = dados.cidade
    endereco.estado = dados.estado

    db.commit()
    return {"mensagem": "Ficha master atualizada com sucesso!"}

@app.put("/api/meu-perfil/{id_associado}", summary="Associado - Autoatendimento")
def associado_atualizar_perfil(id_associado: int, dados: AssociadoPerfilUpdate, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    endereco = db.query(Endereco).filter(Endereco.id_associado == id_associado).first()
    
    if not associado:
        raise HTTPException(status_code=404, detail="Ficha não encontrada.")
    
    # Atualiza Contato
    associado.email_contato = dados.email_contato
    associado.telefone_whatsapp = dados.telefone_whatsapp

    # Atualiza dados complementares (nome, CPF, categoria e status continuam só administrativos)
    associado.data_nascimento = datetime.combine(dados.data_nascimento, datetime.min.time()) if dados.data_nascimento else None
    associado.estado_civil = dados.estado_civil
    associado.profissao = dados.profissao
    associado.naturalidade = dados.naturalidade

    # Atualiza Endereço
    if not endereco:
        endereco = Endereco(id_associado=id_associado)
        db.add(endereco)
    endereco.logradouro = dados.logradouro
    endereco.numero = dados.numero
    endereco.bairro = dados.bairro
    endereco.cidade = dados.cidade
    endereco.estado = dados.estado

    db.commit()
    return {"mensagem": "Seus dados foram atualizados com sucesso!"}

# ==========================================
# LISTAS CONFIGURÁVEIS (categorias, status, estado civil, parentesco...)
# ==========================================
@app.get("/api/opcoes/{tipo_lista}", summary="Listar valores de uma lista configurável")
def listar_opcoes(tipo_lista: str, incluir_inativos: bool = False, db: Session = Depends(get_db)):
    consulta = db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista)
    if not incluir_inativos:
        consulta = consulta.filter(OpcaoLista.ativo == True)
    opcoes = consulta.order_by(OpcaoLista.ordem, OpcaoLista.id_opcao).all()
    return [{"id_opcao": o.id_opcao, "valor": o.valor, "ativo": o.ativo} for o in opcoes]

@app.post("/api/opcoes/{tipo_lista}", summary="Adicionar valor a uma lista configurável")
def criar_opcao(tipo_lista: str, dados: OpcaoCriar, db: Session = Depends(get_db)):
    if db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista, OpcaoLista.valor == dados.valor).first():
        raise HTTPException(status_code=400, detail="Esse valor já existe nessa lista.")
    maior_ordem = db.query(OpcaoLista).filter(OpcaoLista.tipo_lista == tipo_lista).count()
    nova = OpcaoLista(tipo_lista=tipo_lista, valor=dados.valor, ordem=maior_ordem, ativo=True)
    db.add(nova)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Esse valor já existe nessa lista.")
    db.refresh(nova)
    return {"id_opcao": nova.id_opcao, "valor": nova.valor, "ativo": nova.ativo}

@app.put("/api/opcoes/{id_opcao}", summary="Renomear/ativar/desativar valor de lista")
def atualizar_opcao(id_opcao: int, dados: OpcaoAtualizar, db: Session = Depends(get_db)):
    opcao = db.query(OpcaoLista).filter(OpcaoLista.id_opcao == id_opcao).first()
    if not opcao:
        raise HTTPException(status_code=404, detail="Opção não encontrada.")
    if dados.valor is not None:
        opcao.valor = dados.valor
    if dados.ativo is not None:
        opcao.ativo = dados.ativo
    db.commit()
    return {"mensagem": "Opção atualizada."}

# ==========================================
# ÁRVORE FAMILIAR (DEPENDENTES)
# ==========================================
@app.get("/api/associados/busca-simples", summary="Buscar associados para vincular (seletores)")
def buscar_associados_simples(excluir: int = None, db: Session = Depends(get_db)):
    consulta = db.query(Associado)
    if excluir is not None:
        consulta = consulta.filter(Associado.id_associado != excluir)
    associados = consulta.order_by(Associado.nome_completo).all()
    return [{
        "id_associado": a.id_associado,
        "nome_completo": a.nome_completo,
        "cpf_final": a.cpf[-2:] if a.cpf else ""
    } for a in associados]

@app.get("/api/associados/{id_associado}/dependentes", summary="Listar dependentes de um associado")
def listar_dependentes(id_associado: int, db: Session = Depends(get_db)):
    deps = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_titular == id_associado).all()
    resultado = []
    for d in deps:
        vinculado = db.query(Associado).filter(Associado.id_associado == d.id_associado_vinculado).first()
        resultado.append({
            "id_dependente": d.id_dependente,
            "grau_parentesco": d.grau_parentesco,
            "id_associado_vinculado": d.id_associado_vinculado,
            "nome_completo": vinculado.nome_completo if vinculado else "(associado removido)",
            "foto": vinculado.foto if vinculado else None,
            "data_nascimento": vinculado.data_nascimento.date().isoformat() if vinculado and vinculado.data_nascimento else None
        })
    return resultado

@app.post("/api/associados/{id_associado}/dependentes", summary="Adicionar vínculo familiar")
def criar_dependente(id_associado: int, dados: DependenteCriar, db: Session = Depends(get_db)):
    if not db.query(Associado).filter(Associado.id_associado == id_associado).first():
        raise HTTPException(status_code=404, detail="Associado titular não encontrado.")
    if dados.id_associado_vinculado == id_associado:
        raise HTTPException(status_code=400, detail="Um associado não pode ser familiar de si mesmo.")
    if not db.query(Associado).filter(Associado.id_associado == dados.id_associado_vinculado).first():
        raise HTTPException(status_code=404, detail="O associado indicado como familiar não está cadastrado no sistema.")

    novo = DependenteFamiliar(
        id_titular=id_associado,
        id_associado_vinculado=dados.id_associado_vinculado,
        grau_parentesco=dados.grau_parentesco
    )
    db.add(novo)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Esse vínculo familiar já foi cadastrado.")
    db.refresh(novo)
    return {"mensagem": "Vínculo familiar adicionado.", "id_dependente": novo.id_dependente}

@app.put("/api/dependentes/{id_dependente}", summary="Editar grau de parentesco")
def editar_dependente(id_dependente: int, dados: DependenteAtualizar, db: Session = Depends(get_db)):
    dep = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_dependente == id_dependente).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Vínculo familiar não encontrado.")
    dep.grau_parentesco = dados.grau_parentesco
    db.commit()
    return {"mensagem": "Vínculo familiar atualizado."}

@app.delete("/api/dependentes/{id_dependente}", summary="Remover vínculo familiar")
def remover_dependente(id_dependente: int, db: Session = Depends(get_db)):
    dep = db.query(DependenteFamiliar).filter(DependenteFamiliar.id_dependente == id_dependente).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Vínculo familiar não encontrado.")
    db.delete(dep)
    db.commit()
    return {"mensagem": "Vínculo familiar removido."}

# ==========================================
# FOTO DO ASSOCIADO
# ==========================================
EXTENSOES_FOTO_PERMITIDAS = {".jpg", ".jpeg", ".png", ".webp"}
TAMANHO_MAXIMO_FOTO = 5 * 1024 * 1024

@app.post("/api/associados/{id_associado}/foto", summary="Enviar foto do associado")
async def enviar_foto_associado(id_associado: int, foto: UploadFile = File(...), db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")

    extensao = os.path.splitext(foto.filename or "")[1].lower()
    if extensao not in EXTENSOES_FOTO_PERMITIDAS:
        raise HTTPException(status_code=400, detail="Formato de imagem não suportado. Use JPG, PNG ou WEBP.")

    conteudo = await foto.read()
    if len(conteudo) > TAMANHO_MAXIMO_FOTO:
        raise HTTPException(status_code=400, detail="Imagem muito grande (máximo 5MB).")

    caminho_relativo = f"fotos/{id_associado}{extensao}"
    with open(os.path.join("uploads", caminho_relativo), "wb") as arquivo:
        arquivo.write(conteudo)

    associado.foto = f"/uploads/{caminho_relativo}"
    db.commit()
    return {"mensagem": "Foto atualizada com sucesso.", "foto": associado.foto}

# ==========================================
# INTEGRAÇÃO 1: SECRETARIA <-> MEU PERFIL
# ==========================================

@app.get("/admin/secretaria", response_class=HTMLResponse, summary="Admin - Gestão Master")
def admin_secretaria(db: Session = Depends(get_db)):
    todos_associados = db.query(Associado).all()
    enderecos_por_associado = {e.id_associado: e for e in db.query(Endereco).all()}

    linhas_tabela = ""
    for a in todos_associados:
        cor_status = "text-green-600 bg-green-100" if "Ativo" in a.status_arrolamento else "text-red-600 bg-red-100"
        end = enderecos_por_associado.get(a.id_associado)

        data_nasc_iso = a.data_nascimento.date().isoformat() if a.data_nascimento else ""

        # Dados passados via atributos data-* (lidos pelo JS), nunca embutidos como literais no onclick
        linhas_tabela += f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4"><span class="font-bold text-slate-700">#00{a.id_associado}</span></td>
            <td class="p-4 font-semibold text-slate-800">
                <div class="flex items-center space-x-3">
                    {avatar_html(a)}
                    <span>{esc(a.nome_completo)}</span>
                </div>
            </td>
            <td class="p-4 text-slate-500">{esc(a.cpf)}</td>
            <td class="p-4 text-slate-500">{esc(a.telefone_whatsapp)}</td>
            <td class="p-4">
                <span class="px-3 py-1 rounded-full text-xs font-bold {cor_status}">{esc(a.status_arrolamento)}</span>
            </td>
            <td class="p-4 space-x-2 whitespace-nowrap">
                <button
                    onclick="abrirModal(this)"
                    data-id="{a.id_associado}"
                    data-nome="{esc(a.nome_completo)}"
                    data-email="{esc(a.email_contato)}"
                    data-tel="{esc(a.telefone_whatsapp)}"
                    data-cat="{esc(a.categoria)}"
                    data-status="{esc(a.status_arrolamento)}"
                    data-cep="{esc(end.cep if end else '')}"
                    data-log="{esc(end.logradouro if end else '')}"
                    data-num="{esc(end.numero if end else '')}"
                    data-bairro="{esc(end.bairro if end else '')}"
                    data-cidade="{esc(end.cidade if end else '')}"
                    data-estado="{esc(end.estado if end else '')}"
                    data-nascimento="{data_nasc_iso}"
                    data-estadocivil="{esc(a.estado_civil)}"
                    data-profissao="{esc(a.profissao)}"
                    data-naturalidade="{esc(a.naturalidade)}"
                    data-foto="{esc(a.foto)}"
                    class="bg-slate-100 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Modificar</button>
                <button
                    onclick="abrirFamilia(this)"
                    data-id="{a.id_associado}"
                    data-nome="{esc(a.nome_completo)}"
                    class="bg-slate-100 hover:bg-purple-100 text-purple-600 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Família</button>
                <button
                    onclick="abrirCargos(this)"
                    data-id="{a.id_associado}"
                    data-nome="{esc(a.nome_completo)}"
                    class="bg-slate-100 hover:bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Cargos</button>
            </td>
        </tr>
        """

    if not todos_associados:
        linhas_tabela = """
        <tr><td colspan="6" class="p-8 text-center text-slate-400">Nenhum associado cadastrado ainda. Clique em "+ Novo Associado" para começar.</td></tr>
        """

    html_secretaria = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Secretaria Geral</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans relative">
        <div class="max-w-6xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Secretaria Geral e Arrolamento</h1>
                    <p class="text-slate-500">Gestão ativa da base social (Fichas Master)</p>
                </div>
                <div class="flex space-x-4">
                    <button onclick="abrirListas()" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-lg shadow-md transition">⚙ Categorias &amp; Status</button>
                    <button onclick="abrirNovo()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">+ Novo Associado</button>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Matrícula</th>
                            <th class="p-4">Nome Completo</th>
                            <th class="p-4">CPF (Chave)</th>
                            <th class="p-4">WhatsApp</th>
                            <th class="p-4">Status Diretivo</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas_tabela}</tbody>
                </table>
            </div>
        </div>

        <!-- MODAL DE CADASTRO (Novo Associado) -->
        <div id="modalNovo" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border-t-4 border-green-600 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Nova Ficha Master</h2>
                <p class="text-sm text-slate-500 mb-6">Arrolamento de novo associado no sistema</p>
                <form id="formNovo" onsubmit="salvarNovo(event)">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-2">Identidade</p>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Nome Completo *</label>
                            <input required type="text" id="novo_nome" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">CPF *</label>
                            <input required maxlength="14" oninput="mascararCpf(this)" type="text" id="novo_cpf" placeholder="000.000.000-00" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Categoria</label>
                            <select id="novo_cat" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                                <option value="Efetivo">Efetivo</option>
                                <option value="Contribuinte">Contribuinte</option>
                                <option value="Fundador">Fundador</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">E-mail *</label>
                            <input required type="email" id="novo_email" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">WhatsApp *</label>
                            <input required maxlength="15" oninput="mascararTelefone(this)" type="text" id="novo_tel" placeholder="(00) 00000-0000" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>

                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6 border-t pt-4">Dados Complementares</p>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Data de Nascimento</label>
                            <input type="date" id="novo_nascimento" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Estado Civil</label>
                            <select id="novo_estado_civil" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Profissão</label>
                            <input type="text" id="novo_profissao" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Naturalidade (Cidade de Nascimento)</label>
                            <input type="text" id="novo_naturalidade" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>

                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6 border-t pt-4">Endereço</p>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">CEP *</label>
                            <input required maxlength="9" oninput="mascararCep(this)" onblur="buscarCep(this.value, 'novo_')" type="text" id="novo_cep" placeholder="00000-000" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Logradouro *</label>
                            <input required type="text" id="novo_log" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Número *</label>
                            <input required type="text" id="novo_num" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Bairro *</label>
                            <input required type="text" id="novo_bairro" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Cidade *</label>
                            <input required type="text" id="novo_cidade" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-3">
                            <label class="text-xs font-bold text-slate-500 uppercase">Estado (UF) *</label>
                            <input required maxlength="2" type="text" id="novo_estado" placeholder="PA" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 uppercase">
                        </div>
                    </div>

                    <p id="novo_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>

                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharNovo()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition">Cadastrar Associado</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL DE EDIÇÃO -->
        <div id="modalEdicao" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border-t-4 border-blue-600 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Atualizar Ficha Master</h2>
                <div class="flex items-center space-x-4 mb-6 mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <img id="edit_foto_preview" class="w-16 h-16 rounded-full object-cover border border-slate-300 bg-white" src="" style="display:none">
                    <div id="edit_foto_placeholder" class="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold border border-slate-300"></div>
                    <div class="flex-1">
                        <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Foto do Associado</label>
                        <input type="file" id="edit_foto_arquivo" accept="image/png,image/jpeg,image/webp" class="text-xs">
                    </div>
                    <button type="button" onclick="enviarFoto()" class="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white font-semibold text-sm rounded-lg transition">Enviar Foto</button>
                </div>
                <form id="formEditar" onsubmit="salvarEdicao(event)">
                    <input type="hidden" id="edit_id">

                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Nome Completo</label>
                            <input type="text" id="edit_nome" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">E-mail</label>
                            <input type="email" id="edit_email" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">WhatsApp</label>
                            <input type="text" id="edit_tel" oninput="mascararTelefone(this)" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Categoria</label>
                            <select id="edit_cat" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                                <option value="Efetivo">Efetivo</option>
                                <option value="Contribuinte">Contribuinte</option>
                                <option value="Fundador">Fundador</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Status de Arrolamento</label>
                            <select id="edit_status" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                                <option value="Ativo - Em Dia">Ativo - Em Dia</option>
                                <option value="Ativo - Inadimplente">Ativo - Inadimplente</option>
                                <option value="Suspenso (Estatuto)">Suspenso (Estatuto)</option>
                                <option value="Desligado">Desligado</option>
                            </select>
                        </div>
                    </div>

                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6 border-t pt-4">Dados Complementares</p>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Data de Nascimento</label>
                            <input type="date" id="edit_nascimento" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Estado Civil</label>
                            <select id="edit_estado_civil" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Profissão</label>
                            <input type="text" id="edit_profissao" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Naturalidade (Cidade de Nascimento)</label>
                            <input type="text" id="edit_naturalidade" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>

                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6 border-t pt-4">Endereço</p>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">CEP</label>
                            <input maxlength="9" oninput="mascararCep(this)" onblur="buscarCep(this.value, 'edit_')" type="text" id="edit_cep" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Logradouro</label>
                            <input type="text" id="edit_log" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Número</label>
                            <input type="text" id="edit_num" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Bairro</label>
                            <input type="text" id="edit_bairro" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Cidade</label>
                            <input type="text" id="edit_cidade" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="col-span-3">
                            <label class="text-xs font-bold text-slate-500 uppercase">Estado (UF)</label>
                            <input maxlength="2" type="text" id="edit_estado" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 uppercase">
                        </div>
                    </div>

                    <p id="edit_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>

                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Gravar Alterações</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL: GERENCIAR LISTAS CONFIGURÁVEIS -->
        <div id="modalListas" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-t-4 border-slate-700 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Categorias &amp; Status</h2>
                <p class="text-sm text-slate-500 mb-4">Edite os valores usados nos formulários de associado, sem precisar alterar o sistema.</p>

                <label class="text-xs font-bold text-slate-500 uppercase">Lista</label>
                <select id="listas_tipo" onchange="carregarListaAdmin()" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50 mb-4">
                    <option value="categoria_associado">Categoria de Associado</option>
                    <option value="status_arrolamento">Status de Arrolamento</option>
                    <option value="estado_civil">Estado Civil</option>
                    <option value="grau_parentesco">Grau de Parentesco (Família)</option>
                </select>

                <div id="listas_itens" class="space-y-2 mb-4"></div>

                <div class="flex space-x-2 border-t pt-4">
                    <input type="text" id="listas_novo_valor" placeholder="Novo valor" class="flex-1 p-2 border border-slate-300 rounded-lg bg-slate-50">
                    <button type="button" onclick="adicionarOpcaoLista()" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition">Adicionar</button>
                </div>
                <p id="listas_erro" class="text-red-600 text-sm font-semibold mt-3 hidden"></p>

                <div class="flex justify-end mt-6">
                    <button type="button" onclick="fecharListas()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Fechar</button>
                </div>
            </div>
        </div>

        <!-- MODAL: ÁRVORE FAMILIAR -->
        <div id="modalFamilia" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border-t-4 border-purple-600 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Árvore Familiar</h2>
                <p class="text-sm text-slate-500 mb-4">Familiares (associados vinculados) de <span id="familia_titular_nome" class="font-semibold"></span></p>
                <p class="text-xs text-slate-400 mb-4 -mt-3">Só é possível vincular pessoas já cadastradas como associado no sistema.</p>
                <input type="hidden" id="familia_id_titular">

                <div id="familia_lista" class="space-y-3 mb-4"></div>

                <div class="border-t pt-4">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Adicionar Familiar</p>
                    <div class="grid grid-cols-2 gap-3 mb-2">
                        <select id="familia_novo_associado" class="col-span-2 p-2 border border-slate-300 rounded-lg bg-slate-50">
                            <option value="">Selecione o associado...</option>
                        </select>
                        <select id="familia_novo_parentesco" class="col-span-2 p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                    </div>
                    <button type="button" onclick="adicionarDependente()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition">Adicionar</button>
                    <p id="familia_erro" class="text-red-600 text-sm font-semibold mt-3 hidden"></p>
                </div>

                <div class="flex justify-end mt-6">
                    <button type="button" onclick="fecharFamilia()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Fechar</button>
                </div>
            </div>
        </div>

        <!-- MODAL: HISTÓRICO DE CARGOS -->
        <div id="modalCargos" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border-t-4 border-amber-500 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-1">Histórico de Cargos</h2>
                <p class="text-sm text-slate-500 mb-4">Cargos diretivos de <span id="cargos_titular_nome" class="font-semibold"></span></p>
                <input type="hidden" id="cargos_id_titular">

                <div id="cargos_lista" class="space-y-3 mb-4"></div>

                <div class="border-t pt-4">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Registrar Posse</p>
                    <div class="grid grid-cols-2 gap-3 mb-2">
                        <select id="cargo_novo_titulo" class="col-span-2 p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        <div class="col-span-2">
                            <label class="text-xs font-bold text-slate-500 uppercase">Data de Posse</label>
                            <input type="date" id="cargo_novo_data_posse" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>
                    <button type="button" onclick="adicionarCargo()" class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg transition">Registrar</button>
                    <p id="cargos_erro" class="text-red-600 text-sm font-semibold mt-3 hidden"></p>
                </div>

                <div class="flex justify-end mt-6">
                    <button type="button" onclick="fecharCargos()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Fechar</button>
                </div>
            </div>
        </div>

        <script>
            const SELECTS_POR_TIPO = {{
                categoria_associado: ['novo_cat', 'edit_cat'],
                status_arrolamento: ['edit_status'],
                estado_civil: ['novo_estado_civil', 'edit_estado_civil'],
                grau_parentesco: ['familia_novo_parentesco'],
                titulo_cargo: ['cargo_novo_titulo']
            }};

            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor;
                    opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            function definirValorSelect(select, valor) {{
                if (!valor) return;
                const existe = Array.from(select.options).some(o => o.value === valor);
                if (!existe) {{
                    const opt = document.createElement('option');
                    opt.value = valor;
                    opt.textContent = valor + ' (inativo)';
                    select.appendChild(opt);
                }}
                select.value = valor;
            }}

            async function carregarOpcoes(tipoLista) {{
                const resposta = await fetch(`/api/opcoes/${{tipoLista}}`);
                const opcoes = await resposta.json();
                (SELECTS_POR_TIPO[tipoLista] || []).forEach(idSelect => {{
                    const select = document.getElementById(idSelect);
                    if (select) preencherSelect(select, opcoes);
                }});
                return opcoes;
            }}

            window.addEventListener('DOMContentLoaded', () => {{
                Object.keys(SELECTS_POR_TIPO).forEach(tipo => carregarOpcoes(tipo));
            }});

            function mascararCpf(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 11);
                v = v.replace(/(\\d{{3}})(\\d)/, "$1.$2").replace(/(\\d{{3}})(\\d)/, "$1.$2").replace(/(\\d{{3}})(\\d{{1,2}})$/, "$1-$2");
                campo.value = v;
            }}

            function mascararTelefone(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 11);
                if (v.length > 10) {{
                    v = v.replace(/(\\d{{2}})(\\d{{5}})(\\d{{4}})/, "($1) $2-$3");
                }} else if (v.length > 5) {{
                    v = v.replace(/(\\d{{2}})(\\d{{4}})(\\d{{0,4}})/, "($1) $2-$3");
                }} else if (v.length > 2) {{
                    v = v.replace(/(\\d{{2}})(\\d{{0,5}})/, "($1) $2");
                }}
                campo.value = v;
            }}

            function mascararCep(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 8);
                v = v.replace(/(\\d{{5}})(\\d{{1,3}})/, "$1-$2");
                campo.value = v;
            }}

            async function buscarCep(cep, prefixo) {{
                const digitos = cep.replace(/\\D/g, "");
                if (digitos.length !== 8) return;
                try {{
                    const resposta = await fetch(`https://viacep.com.br/ws/${{digitos}}/json/`);
                    const dados = await resposta.json();
                    if (dados.erro) return;
                    document.getElementById(prefixo + 'log').value = dados.logradouro || '';
                    document.getElementById(prefixo + 'bairro').value = dados.bairro || '';
                    document.getElementById(prefixo + 'cidade').value = dados.localidade || '';
                    document.getElementById(prefixo + 'estado').value = dados.uf || '';
                }} catch (erro) {{
                    // Falha na consulta de CEP não impede o preenchimento manual
                }}
            }}

            async function abrirNovo() {{
                document.getElementById('formNovo').reset();
                document.getElementById('novo_erro').classList.add('hidden');
                document.getElementById('modalNovo').classList.remove('hidden');
                await Promise.all([carregarOpcoes('categoria_associado'), carregarOpcoes('estado_civil')]);
            }}

            function fecharNovo() {{
                document.getElementById('modalNovo').classList.add('hidden');
            }}

            async function salvarNovo(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('novo_erro');
                erroEl.classList.add('hidden');

                const dados = {{
                    nome_completo: document.getElementById('novo_nome').value,
                    cpf: document.getElementById('novo_cpf').value,
                    email_contato: document.getElementById('novo_email').value,
                    telefone_whatsapp: document.getElementById('novo_tel').value,
                    categoria: document.getElementById('novo_cat').value,
                    cep: document.getElementById('novo_cep').value,
                    logradouro: document.getElementById('novo_log').value,
                    numero: document.getElementById('novo_num').value,
                    bairro: document.getElementById('novo_bairro').value,
                    cidade: document.getElementById('novo_cidade').value,
                    estado: document.getElementById('novo_estado').value,
                    data_nascimento: document.getElementById('novo_nascimento').value || null,
                    estado_civil: document.getElementById('novo_estado_civil').value || null,
                    profissao: document.getElementById('novo_profissao').value || null,
                    naturalidade: document.getElementById('novo_naturalidade').value || null
                }};

                const resposta = await fetch('/associados-master/', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});

                if (resposta.ok) {{
                    alert("Associado cadastrado com sucesso!");
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || "Erro ao cadastrar associado.";
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function abrirModal(botao) {{
                await Promise.all([
                    carregarOpcoes('categoria_associado'),
                    carregarOpcoes('status_arrolamento'),
                    carregarOpcoes('estado_civil')
                ]);
                const d = botao.dataset;
                document.getElementById('edit_id').value = d.id;
                document.getElementById('edit_nome').value = d.nome;
                document.getElementById('edit_email').value = d.email;
                document.getElementById('edit_tel').value = d.tel;
                definirValorSelect(document.getElementById('edit_cat'), d.cat);
                definirValorSelect(document.getElementById('edit_status'), d.status);
                document.getElementById('edit_cep').value = d.cep;
                document.getElementById('edit_log').value = d.log;
                document.getElementById('edit_num').value = d.num;
                document.getElementById('edit_bairro').value = d.bairro;
                document.getElementById('edit_cidade').value = d.cidade;
                document.getElementById('edit_estado').value = d.estado;
                document.getElementById('edit_nascimento').value = d.nascimento || '';
                definirValorSelect(document.getElementById('edit_estado_civil'), d.estadocivil);
                document.getElementById('edit_profissao').value = d.profissao || '';
                document.getElementById('edit_naturalidade').value = d.naturalidade || '';
                document.getElementById('edit_foto_arquivo').value = '';

                const preview = document.getElementById('edit_foto_preview');
                const placeholder = document.getElementById('edit_foto_placeholder');
                if (d.foto) {{
                    preview.src = d.foto;
                    preview.style.display = '';
                    placeholder.style.display = 'none';
                }} else {{
                    preview.style.display = 'none';
                    placeholder.style.display = 'flex';
                    placeholder.textContent = (d.nome || '?').trim().split(/\\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
                }}

                document.getElementById('edit_erro').classList.add('hidden');
                document.getElementById('modalEdicao').classList.remove('hidden');
            }}

            async function enviarFoto() {{
                const id = document.getElementById('edit_id').value;
                const arquivo = document.getElementById('edit_foto_arquivo').files[0];
                if (!arquivo) {{
                    alert('Selecione um arquivo de imagem primeiro.');
                    return;
                }}
                const formData = new FormData();
                formData.append('foto', arquivo);
                const resposta = await fetch(`/api/associados/${{id}}/foto`, {{ method: 'POST', body: formData }});
                if (resposta.ok) {{
                    const dados = await resposta.json();
                    const preview = document.getElementById('edit_foto_preview');
                    preview.src = dados.foto + '?t=' + Date.now();
                    preview.style.display = '';
                    document.getElementById('edit_foto_placeholder').style.display = 'none';
                    alert('Foto atualizada! Salve as alterações para concluir.');
                }} else {{
                    const erro = await resposta.json();
                    alert(erro.detail || 'Erro ao enviar a foto.');
                }}
            }}

            function fecharModal() {{
                document.getElementById('modalEdicao').classList.add('hidden');
            }}

            async function salvarEdicao(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('edit_erro');
                erroEl.classList.add('hidden');
                const id = document.getElementById('edit_id').value;
                const dados = {{
                    nome_completo: document.getElementById('edit_nome').value,
                    email_contato: document.getElementById('edit_email').value,
                    telefone_whatsapp: document.getElementById('edit_tel').value,
                    categoria: document.getElementById('edit_cat').value,
                    status_arrolamento: document.getElementById('edit_status').value,
                    cep: document.getElementById('edit_cep').value,
                    logradouro: document.getElementById('edit_log').value,
                    numero: document.getElementById('edit_num').value,
                    bairro: document.getElementById('edit_bairro').value,
                    cidade: document.getElementById('edit_cidade').value,
                    estado: document.getElementById('edit_estado').value,
                    data_nascimento: document.getElementById('edit_nascimento').value || null,
                    estado_civil: document.getElementById('edit_estado_civil').value || null,
                    profissao: document.getElementById('edit_profissao').value || null,
                    naturalidade: document.getElementById('edit_naturalidade').value || null
                }};

                const resposta = await fetch(`/api/associados/${{id}}`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});

                if (resposta.ok) {{
                    alert("Dados do associado atualizados com sucesso!");
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || "Erro ao salvar os dados.";
                    erroEl.classList.remove('hidden');
                }}
            }}

            // ---------- LISTAS CONFIGURÁVEIS ----------
            async function abrirListas() {{
                document.getElementById('modalListas').classList.remove('hidden');
                await carregarListaAdmin();
            }}

            function fecharListas() {{
                document.getElementById('modalListas').classList.add('hidden');
            }}

            async function carregarListaAdmin() {{
                const tipo = document.getElementById('listas_tipo').value;
                const resposta = await fetch(`/api/opcoes/${{tipo}}?incluir_inativos=true`);
                const opcoes = await resposta.json();
                const container = document.getElementById('listas_itens');
                container.innerHTML = '';
                opcoes.forEach(o => {{
                    const linha = document.createElement('div');
                    linha.className = 'flex items-center space-x-2';

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = o.valor;
                    input.className = 'flex-1 p-2 border border-slate-300 rounded-lg bg-slate-50 text-sm';

                    const labelAtivo = document.createElement('label');
                    labelAtivo.className = 'flex items-center space-x-1 text-xs font-semibold text-slate-500 whitespace-nowrap';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = o.ativo;
                    labelAtivo.appendChild(checkbox);
                    labelAtivo.append(' Ativo');

                    const botaoSalvar = document.createElement('button');
                    botaoSalvar.type = 'button';
                    botaoSalvar.textContent = 'Salvar';
                    botaoSalvar.className = 'px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition';
                    botaoSalvar.onclick = () => salvarOpcaoLista(o.id_opcao, input.value, checkbox.checked);

                    linha.appendChild(input);
                    linha.appendChild(labelAtivo);
                    linha.appendChild(botaoSalvar);
                    container.appendChild(linha);
                }});
            }}

            async function salvarOpcaoLista(idOpcao, valor, ativo) {{
                const erroEl = document.getElementById('listas_erro');
                erroEl.classList.add('hidden');
                const resposta = await fetch(`/api/opcoes/${{idOpcao}}`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ valor, ativo }})
                }});
                if (resposta.ok) {{
                    await carregarListaAdmin();
                    await carregarOpcoes(document.getElementById('listas_tipo').value);
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao salvar.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function adicionarOpcaoLista() {{
                const tipo = document.getElementById('listas_tipo').value;
                const campoValor = document.getElementById('listas_novo_valor');
                const erroEl = document.getElementById('listas_erro');
                erroEl.classList.add('hidden');
                if (!campoValor.value.trim()) return;

                const resposta = await fetch(`/api/opcoes/${{tipo}}`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ valor: campoValor.value }})
                }});
                if (resposta.ok) {{
                    campoValor.value = '';
                    await carregarListaAdmin();
                    await carregarOpcoes(tipo);
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao adicionar.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            // ---------- ÁRVORE FAMILIAR ----------
            async function abrirFamilia(botao) {{
                const idTitular = botao.dataset.id;
                document.getElementById('familia_id_titular').value = idTitular;
                document.getElementById('familia_titular_nome').textContent = botao.dataset.nome;
                document.getElementById('familia_erro').classList.add('hidden');
                document.getElementById('modalFamilia').classList.remove('hidden');

                const selectAssociado = document.getElementById('familia_novo_associado');
                const resposta = await fetch(`/api/associados/busca-simples?excluir=${{idTitular}}`);
                const associados = await resposta.json();
                selectAssociado.innerHTML = '<option value="">Selecione o associado...</option>';
                associados.forEach(a => {{
                    const opt = document.createElement('option');
                    opt.value = a.id_associado;
                    opt.textContent = `${{a.nome_completo}} (CPF ***${{a.cpf_final}})`;
                    selectAssociado.appendChild(opt);
                }});

                await carregarOpcoes('grau_parentesco');
                await carregarFamilia();
            }}

            function fecharFamilia() {{
                document.getElementById('modalFamilia').classList.add('hidden');
            }}

            async function carregarFamilia() {{
                const idTitular = document.getElementById('familia_id_titular').value;
                const resposta = await fetch(`/api/associados/${{idTitular}}/dependentes`);
                const dependentes = await resposta.json();
                const container = document.getElementById('familia_lista');
                container.innerHTML = '';

                if (dependentes.length === 0) {{
                    container.innerHTML = '<p class="text-sm text-slate-400">Nenhum familiar vinculado ainda.</p>';
                    return;
                }}

                dependentes.forEach(dep => {{
                    const linha = document.createElement('div');
                    linha.className = 'flex items-center space-x-3 p-3 bg-slate-50 rounded-lg border border-slate-200';

                    const avatar = document.createElement('div');
                    if (dep.foto) {{
                        avatar.innerHTML = `<img src="${{dep.foto}}" class="w-9 h-9 rounded-full object-cover border border-slate-200">`;
                    }} else {{
                        avatar.innerHTML = `<div class="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs border border-slate-200">${{(dep.nome_completo || '?').trim().split(/\\s+/).map(p => p[0]).slice(0,2).join('').toUpperCase()}}</div>`;
                    }}

                    const nomeEl = document.createElement('p');
                    nomeEl.className = 'font-semibold text-slate-800 flex-1';
                    nomeEl.textContent = dep.nome_completo;

                    const selectParentesco = document.createElement('select');
                    selectParentesco.className = 'p-2 border border-slate-300 rounded-lg text-sm';

                    const botaoSalvar = document.createElement('button');
                    botaoSalvar.type = 'button';
                    botaoSalvar.textContent = 'Salvar';
                    botaoSalvar.className = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition';
                    botaoSalvar.onclick = () => salvarDependente(dep.id_dependente, selectParentesco.value);

                    const botaoRemover = document.createElement('button');
                    botaoRemover.type = 'button';
                    botaoRemover.textContent = 'Remover';
                    botaoRemover.className = 'px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition';
                    botaoRemover.onclick = () => removerDependente(dep.id_dependente);

                    fetch('/api/opcoes/grau_parentesco').then(r => r.json()).then(opcoes => {{
                        preencherSelect(selectParentesco, opcoes);
                        definirValorSelect(selectParentesco, dep.grau_parentesco);
                    }});

                    linha.appendChild(avatar);
                    linha.appendChild(nomeEl);
                    linha.appendChild(selectParentesco);
                    linha.appendChild(botaoSalvar);
                    linha.appendChild(botaoRemover);
                    container.appendChild(linha);
                }});
            }}

            async function adicionarDependente() {{
                const idTitular = document.getElementById('familia_id_titular').value;
                const erroEl = document.getElementById('familia_erro');
                erroEl.classList.add('hidden');

                const idVinculado = document.getElementById('familia_novo_associado').value;
                if (!idVinculado) {{
                    erroEl.textContent = 'Selecione o associado que será vinculado.';
                    erroEl.classList.remove('hidden');
                    return;
                }}

                const resposta = await fetch(`/api/associados/${{idTitular}}/dependentes`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        id_associado_vinculado: parseInt(idVinculado, 10),
                        grau_parentesco: document.getElementById('familia_novo_parentesco').value
                    }})
                }});

                if (resposta.ok) {{
                    document.getElementById('familia_novo_associado').value = '';
                    await carregarFamilia();
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao adicionar vínculo familiar.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function salvarDependente(idDependente, parentesco) {{
                await fetch(`/api/dependentes/${{idDependente}}`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ grau_parentesco: parentesco }})
                }});
                await carregarFamilia();
            }}

            async function removerDependente(idDependente) {{
                if (!confirm('Remover este vínculo familiar?')) return;
                await fetch(`/api/dependentes/${{idDependente}}`, {{ method: 'DELETE' }});
                await carregarFamilia();
            }}

            // ---------- HISTÓRICO DE CARGOS ----------
            async function abrirCargos(botao) {{
                document.getElementById('cargos_id_titular').value = botao.dataset.id;
                document.getElementById('cargos_titular_nome').textContent = botao.dataset.nome;
                document.getElementById('cargo_novo_data_posse').value = '';
                document.getElementById('cargos_erro').classList.add('hidden');
                document.getElementById('modalCargos').classList.remove('hidden');
                await carregarOpcoes('titulo_cargo');
                await carregarCargos();
            }}

            function fecharCargos() {{
                document.getElementById('modalCargos').classList.add('hidden');
            }}

            async function carregarCargos() {{
                const idTitular = document.getElementById('cargos_id_titular').value;
                const resposta = await fetch(`/api/associados/${{idTitular}}/cargos`);
                const cargos = await resposta.json();
                const container = document.getElementById('cargos_lista');
                container.innerHTML = '';

                if (cargos.length === 0) {{
                    container.innerHTML = '<p class="text-sm text-slate-400">Nenhum cargo registrado ainda.</p>';
                    return;
                }}

                cargos.forEach(c => {{
                    const linha = document.createElement('div');
                    linha.className = 'flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200';

                    const info = document.createElement('div');
                    const tituloEl = document.createElement('p');
                    tituloEl.className = 'font-semibold text-slate-800';
                    tituloEl.textContent = c.titulo_cargo;
                    const periodoEl = document.createElement('p');
                    periodoEl.className = 'text-xs text-slate-500';
                    const posse = c.data_posse ? c.data_posse.split('-').reverse().join('/') : '?';
                    const saida = c.data_saida ? c.data_saida.split('-').reverse().join('/') : null;
                    periodoEl.textContent = saida ? `${{posse}} — ${{saida}}` : `Desde ${{posse}} (atual)`;
                    info.appendChild(tituloEl);
                    info.appendChild(periodoEl);

                    const acoes = document.createElement('div');
                    acoes.className = 'flex items-center space-x-2';

                    if (!c.data_saida) {{
                        const inputSaida = document.createElement('input');
                        inputSaida.type = 'date';
                        inputSaida.className = 'p-1.5 border border-slate-300 rounded-lg text-sm';

                        const botaoEncerrar = document.createElement('button');
                        botaoEncerrar.type = 'button';
                        botaoEncerrar.textContent = 'Encerrar';
                        botaoEncerrar.className = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition';
                        botaoEncerrar.onclick = () => encerrarCargo(c.id_historico, inputSaida.value);

                        acoes.appendChild(inputSaida);
                        acoes.appendChild(botaoEncerrar);
                    }}

                    const botaoRemover = document.createElement('button');
                    botaoRemover.type = 'button';
                    botaoRemover.textContent = 'Remover';
                    botaoRemover.className = 'px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition';
                    botaoRemover.onclick = () => removerCargo(c.id_historico);
                    acoes.appendChild(botaoRemover);

                    linha.appendChild(info);
                    linha.appendChild(acoes);
                    container.appendChild(linha);
                }});
            }}

            async function adicionarCargo() {{
                const idTitular = document.getElementById('cargos_id_titular').value;
                const erroEl = document.getElementById('cargos_erro');
                erroEl.classList.add('hidden');
                const dataPosse = document.getElementById('cargo_novo_data_posse').value;
                if (!dataPosse) {{
                    erroEl.textContent = 'Informe a data de posse.';
                    erroEl.classList.remove('hidden');
                    return;
                }}

                const resposta = await fetch(`/api/associados/${{idTitular}}/cargos`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        titulo_cargo: document.getElementById('cargo_novo_titulo').value,
                        data_posse: dataPosse
                    }})
                }});

                if (resposta.ok) {{
                    document.getElementById('cargo_novo_data_posse').value = '';
                    await carregarCargos();
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao registrar posse.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function encerrarCargo(idHistorico, dataSaida) {{
                if (!dataSaida) {{
                    alert('Informe a data de saída antes de encerrar.');
                    return;
                }}
                await fetch(`/api/cargos/${{idHistorico}}/encerrar`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ data_saida: dataSaida }})
                }});
                await carregarCargos();
            }}

            async function removerCargo(idHistorico) {{
                if (!confirm('Remover este registro de cargo?')) return;
                await fetch(`/api/cargos/${{idHistorico}}`, {{ method: 'DELETE' }});
                await carregarCargos();
            }}
        </script>
    </body>
    </html>
    """
    return html_secretaria

@app.get("/meu-perfil/{id_associado}", response_class=HTMLResponse, summary="Associado - Autoatendimento")
def perfil_associado(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    endereco = db.query(Endereco).filter(Endereco.id_associado == id_associado).first()
    
    if not associado:
        return "<h1>Erro: Associado não encontrado.</h1>"

    logradouro = esc(endereco.logradouro if endereco else "")
    numero = esc(endereco.numero if endereco else "")
    bairro = esc(endereco.bairro if endereco else "")
    cidade = esc(endereco.cidade if endereco else "")
    estado = esc(endereco.estado if endereco else "")

    nome = esc(associado.nome_completo)
    cpf = esc(associado.cpf)
    telefone_whatsapp = esc(associado.telefone_whatsapp)
    email_contato = esc(associado.email_contato)
    data_nascimento_iso = associado.data_nascimento.date().isoformat() if associado.data_nascimento else ""
    profissao = esc(associado.profissao)
    naturalidade = esc(associado.naturalidade)
    estado_civil_atual = esc(associado.estado_civil)
    foto_atual = esc(associado.foto)

    html_perfil = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Meu Perfil - ASAF</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans">
        <div class="max-w-4xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Configurações Pessoais</h1>
                    <p class="text-slate-500">Gerencie seus dados de contato e localização</p>
                </div>
                <a href="/meu-portal/{id_associado}" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Portal</a>
            </div>

            <!-- FOTO DE PERFIL -->
            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6 flex items-center space-x-4">
                <img id="perfil_foto_preview" class="w-16 h-16 rounded-full object-cover border border-slate-300" src="{foto_atual}" style="display:{'' if foto_atual else 'none'}">
                <div id="perfil_foto_placeholder" class="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold border border-slate-300" style="display:{'none' if foto_atual else 'flex'}">{esc(iniciais(associado.nome_completo))}</div>
                <div class="flex-1">
                    <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Minha Foto</label>
                    <input type="file" id="perfil_foto_arquivo" accept="image/png,image/jpeg,image/webp" class="text-sm">
                </div>
                <button type="button" onclick="enviarFotoPerfil()" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-semibold text-sm rounded-lg transition">Enviar Foto</button>
            </div>

            <form id="formPerfil" onsubmit="atualizarPerfil(event, {id_associado})">

                <!-- TRAVA DE COMPLIANCE (Campos Bloqueados) -->
                <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                    <div class="bg-slate-800 p-4 text-white flex justify-between items-center">
                        <h2 class="font-bold tracking-widest uppercase text-sm">Identidade Legal (Inalterável)</h2>
                        <span class="text-xs bg-slate-700 px-2 py-1 rounded">Proteção de Fraude Ativa</span>
                    </div>
                    <div class="p-6 grid grid-cols-2 gap-6 bg-slate-50">
                        <div>
                            <label class="text-xs font-bold text-slate-400 uppercase">Nome na Ata</label>
                            <input type="text" value="{nome}" disabled class="w-full mt-1 p-2 bg-slate-200 text-slate-500 rounded-lg cursor-not-allowed border border-slate-300">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-400 uppercase">CPF Vinculado</label>
                            <input type="text" value="{cpf}" disabled class="w-full mt-1 p-2 bg-slate-200 text-slate-500 rounded-lg cursor-not-allowed border border-slate-300">
                        </div>
                    </div>
                </div>

                <!-- DADOS COMPLEMENTARES (Editáveis) -->
                <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6 border-l-4 border-l-emerald-500">
                    <div class="p-6">
                        <h2 class="font-bold text-slate-800 uppercase tracking-widest text-sm mb-6 border-b pb-2">Dados Complementares</h2>
                        <div class="grid grid-cols-2 gap-6">
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Data de Nascimento</label>
                                <input type="date" id="perfil_nascimento" value="{data_nascimento_iso}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Estado Civil</label>
                                <select id="perfil_estado_civil" data-atual="{estado_civil_atual}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg"></select>
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Profissão</label>
                                <input type="text" id="perfil_profissao" value="{profissao}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Naturalidade (Cidade de Nascimento)</label>
                                <input type="text" id="perfil_naturalidade" value="{naturalidade}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- CONTATO E ENDEREÇO (Editáveis) -->
                <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6 border-l-4 border-l-blue-500">
                    <div class="p-6">
                        <h2 class="font-bold text-slate-800 uppercase tracking-widest text-sm mb-6 border-b pb-2">Atualização de Contato e Localização</h2>
                        
                        <div class="grid grid-cols-2 gap-6 mb-6">
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">WhatsApp</label>
                                <input type="text" id="perfil_tel" value="{telefone_whatsapp}" oninput="mascararTelefonePerfil(this)" class="w-full mt-1 p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">E-mail Pessoal</label>
                                <input type="email" id="perfil_email" value="{email_contato}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                            </div>
                        </div>

                        <div class="grid grid-cols-3 gap-6">
                            <div class="col-span-2">
                                <label class="text-xs font-bold text-slate-500 uppercase">Logradouro (Rua/Av)</label>
                                <input type="text" id="perfil_log" value="{logradouro}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Nº / Apto</label>
                                <input type="text" id="perfil_num" value="{numero}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Bairro</label>
                                <input type="text" id="perfil_bairro" value="{bairro}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Cidade</label>
                                <input type="text" id="perfil_cidade" value="{cidade}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Estado</label>
                                <input type="text" id="perfil_estado" value="{estado}" class="w-full mt-1 p-2 border border-slate-300 rounded-lg">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end">
                    <button type="submit" class="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl shadow-lg transition-all">
                        Salvar Minhas Alterações
                    </button>
                </div>
            </form>
        </div>

        <script>
            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor;
                    opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            window.addEventListener('DOMContentLoaded', async () => {{
                const select = document.getElementById('perfil_estado_civil');
                const resposta = await fetch('/api/opcoes/estado_civil');
                preencherSelect(select, await resposta.json());
                if (select.dataset.atual) select.value = select.dataset.atual;
            }});

            async function enviarFotoPerfil() {{
                const arquivo = document.getElementById('perfil_foto_arquivo').files[0];
                if (!arquivo) {{
                    alert('Selecione um arquivo de imagem primeiro.');
                    return;
                }}
                const formData = new FormData();
                formData.append('foto', arquivo);
                const resposta = await fetch(`/api/associados/{id_associado}/foto`, {{ method: 'POST', body: formData }});
                if (resposta.ok) {{
                    const dados = await resposta.json();
                    const preview = document.getElementById('perfil_foto_preview');
                    preview.src = dados.foto + '?t=' + Date.now();
                    preview.style.display = '';
                    document.getElementById('perfil_foto_placeholder').style.display = 'none';
                    alert('✅ Foto atualizada com sucesso!');
                }} else {{
                    const erro = await resposta.json();
                    alert(erro.detail || 'Erro ao enviar a foto.');
                }}
            }}

            function mascararTelefonePerfil(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 11);
                if (v.length > 10) {{
                    v = v.replace(/(\\d{{2}})(\\d{{5}})(\\d{{4}})/, "($1) $2-$3");
                }} else if (v.length > 5) {{
                    v = v.replace(/(\\d{{2}})(\\d{{4}})(\\d{{0,4}})/, "($1) $2-$3");
                }} else if (v.length > 2) {{
                    v = v.replace(/(\\d{{2}})(\\d{{0,5}})/, "($1) $2");
                }}
                campo.value = v;
            }}

            async function atualizarPerfil(event, id) {{
                event.preventDefault();

                const dados = {{
                    email_contato: document.getElementById('perfil_email').value,
                    telefone_whatsapp: document.getElementById('perfil_tel').value,
                    logradouro: document.getElementById('perfil_log').value,
                    numero: document.getElementById('perfil_num').value,
                    bairro: document.getElementById('perfil_bairro').value,
                    cidade: document.getElementById('perfil_cidade').value,
                    estado: document.getElementById('perfil_estado').value,
                    data_nascimento: document.getElementById('perfil_nascimento').value || null,
                    estado_civil: document.getElementById('perfil_estado_civil').value || null,
                    profissao: document.getElementById('perfil_profissao').value || null,
                    naturalidade: document.getElementById('perfil_naturalidade').value || null
                }};

                const resposta = await fetch(`/api/meu-perfil/${{id}}`, {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});

                if (resposta.ok) {{
                    alert("✅ Seus dados foram salvos com sucesso na nuvem da ASAF!");
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    alert("❌ Ocorreu um erro ao salvar: " + (detalhe || "verifique os dados."));
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_perfil

# ==========================================
# INTEGRAÇÃO 2: PORTAL <-> ÁRVORE FAMILIAR (AUTOATENDIMENTO)
# ==========================================
@app.get("/minha-familia/{id_associado}", response_class=HTMLResponse, summary="Associado - Árvore Familiar")
def minha_familia(id_associado: int, db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        return "<h1>Erro: Associado não encontrado.</h1>"

    nome = esc(associado.nome_completo)

    html_familia = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Minha Árvore Familiar - ASAF</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans">
        <div class="max-w-3xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Minha Árvore Familiar</h1>
                    <p class="text-slate-500">Familiares (associados vinculados) de {nome}</p>
                </div>
                <a href="/meu-portal/{id_associado}" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Portal</a>
            </div>

            <div id="familia_lista" class="space-y-3 mb-6"></div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 class="font-bold text-slate-800 uppercase tracking-widest text-sm mb-1">Adicionar Familiar</h2>
                <p class="text-xs text-slate-400 mb-4">Só é possível vincular pessoas já cadastradas como associado no sistema.</p>
                <div class="grid grid-cols-2 gap-3 mb-3">
                    <select id="familia_novo_associado" class="col-span-2 p-2 border border-slate-300 rounded-lg">
                        <option value="">Selecione o associado...</option>
                    </select>
                    <select id="familia_novo_parentesco" class="col-span-2 p-2 border border-slate-300 rounded-lg"></select>
                </div>
                <button type="button" onclick="adicionarDependente()" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Adicionar</button>
                <p id="familia_erro" class="text-red-600 text-sm font-semibold mt-3 hidden"></p>
            </div>
        </div>

        <script>
            const ID_TITULAR = {id_associado};

            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor;
                    opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            async function carregarParentescos() {{
                const resposta = await fetch('/api/opcoes/grau_parentesco');
                return await resposta.json();
            }}

            async function carregarAssociadosParaSelecao() {{
                const select = document.getElementById('familia_novo_associado');
                const resposta = await fetch(`/api/associados/busca-simples?excluir=${{ID_TITULAR}}`);
                const associados = await resposta.json();
                select.innerHTML = '<option value="">Selecione o associado...</option>';
                associados.forEach(a => {{
                    const opt = document.createElement('option');
                    opt.value = a.id_associado;
                    opt.textContent = `${{a.nome_completo}} (CPF ***${{a.cpf_final}})`;
                    select.appendChild(opt);
                }});
            }}

            async function carregarFamilia() {{
                const resposta = await fetch(`/api/associados/${{ID_TITULAR}}/dependentes`);
                const dependentes = await resposta.json();
                const container = document.getElementById('familia_lista');
                container.innerHTML = '';

                if (dependentes.length === 0) {{
                    container.innerHTML = '<div class="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400">Nenhum familiar vinculado ainda.</div>';
                    return;
                }}

                dependentes.forEach(dep => {{
                    const card = document.createElement('div');
                    card.className = 'bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center space-x-3';

                    const avatar = document.createElement('div');
                    if (dep.foto) {{
                        avatar.innerHTML = `<img src="${{dep.foto}}" class="w-10 h-10 rounded-full object-cover border border-slate-200">`;
                    }} else {{
                        avatar.innerHTML = `<div class="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs border border-slate-200">${{(dep.nome_completo || '?').trim().split(/\\s+/).map(p => p[0]).slice(0,2).join('').toUpperCase()}}</div>`;
                    }}

                    const info = document.createElement('div');
                    info.className = 'flex-1';
                    const nomeEl = document.createElement('p');
                    nomeEl.className = 'font-bold text-slate-800';
                    nomeEl.textContent = dep.nome_completo;
                    const detalheEl = document.createElement('p');
                    detalheEl.className = 'text-xs text-slate-500';
                    detalheEl.textContent = dep.grau_parentesco;
                    info.appendChild(nomeEl);
                    info.appendChild(detalheEl);

                    const botaoRemover = document.createElement('button');
                    botaoRemover.textContent = 'Remover';
                    botaoRemover.className = 'px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition';
                    botaoRemover.onclick = () => removerDependente(dep.id_dependente);

                    card.appendChild(avatar);
                    card.appendChild(info);
                    card.appendChild(botaoRemover);
                    container.appendChild(card);
                }});
            }}

            async function adicionarDependente() {{
                const erroEl = document.getElementById('familia_erro');
                erroEl.classList.add('hidden');
                const idVinculado = document.getElementById('familia_novo_associado').value;
                if (!idVinculado) {{
                    erroEl.textContent = 'Selecione o associado que será vinculado.';
                    erroEl.classList.remove('hidden');
                    return;
                }}

                const resposta = await fetch(`/api/associados/${{ID_TITULAR}}/dependentes`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        id_associado_vinculado: parseInt(idVinculado, 10),
                        grau_parentesco: document.getElementById('familia_novo_parentesco').value
                    }})
                }});

                if (resposta.ok) {{
                    document.getElementById('familia_novo_associado').value = '';
                    await carregarFamilia();
                }} else {{
                    const erro = await resposta.json();
                    erroEl.textContent = erro.detail || 'Erro ao adicionar vínculo familiar.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function removerDependente(idDependente) {{
                if (!confirm('Remover este vínculo familiar?')) return;
                await fetch(`/api/dependentes/${{idDependente}}`, {{ method: 'DELETE' }});
                await carregarFamilia();
            }}

            window.addEventListener('DOMContentLoaded', async () => {{
                preencherSelect(document.getElementById('familia_novo_parentesco'), await carregarParentescos());
                await carregarAssociadosParaSelecao();
                await carregarFamilia();
            }});
        </script>
    </body>
    </html>
    """
    return html_familia

# ==========================================
# MÓDULO FINANCEIRO — TELAS
# ==========================================
@app.get("/admin/fornecedores", response_class=HTMLResponse, summary="Admin - Fornecedores")
def admin_fornecedores(db: Session = Depends(get_db)):
    fornecedores = db.query(Fornecedor).order_by(Fornecedor.razao_social).all()
    linhas = ""
    for f in fornecedores:
        linhas += f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4 font-semibold text-slate-800">{esc(f.razao_social)}</td>
            <td class="p-4 text-slate-500">{esc(f.cnpj)}</td>
            <td class="p-4 text-slate-500">{esc(f.categoria_servico)}</td>
            <td class="p-4 text-slate-500">{esc(f.telefone)}</td>
            <td class="p-4">
                <button onclick="abrirEditar(this)"
                    data-id="{f.id_fornecedor}" data-razao="{esc(f.razao_social)}" data-cnpj="{esc(f.cnpj)}"
                    data-categoria="{esc(f.categoria_servico)}" data-telefone="{esc(f.telefone)}"
                    class="bg-slate-100 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Editar</button>
            </td>
        </tr>
        """
    if not fornecedores:
        linhas = '<tr><td colspan="5" class="p-8 text-center text-slate-400">Nenhum fornecedor cadastrado ainda.</td></tr>'

    html_fornecedores = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Fornecedores</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans relative">
        <div class="max-w-5xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Fornecedores</h1>
                    <p class="text-slate-500">Cadastro de fornecedores e prestadores de serviço</p>
                </div>
                <div class="flex space-x-4">
                    <button onclick="abrirNovo()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">+ Novo Fornecedor</button>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Razão Social</th>
                            <th class="p-4">CNPJ</th>
                            <th class="p-4">Categoria</th>
                            <th class="p-4">Telefone</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>

        <div id="modalForm" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-t-4 border-blue-600">
                <h2 id="form_titulo" class="text-2xl font-bold text-slate-800 mb-6">Novo Fornecedor</h2>
                <form id="form" onsubmit="salvar(event)">
                    <input type="hidden" id="f_id">
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Razão Social *</label>
                            <input required type="text" id="f_razao" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">CNPJ *</label>
                            <input required maxlength="18" oninput="mascararCnpj(this)" type="text" id="f_cnpj" placeholder="00.000.000/0000-00" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Categoria</label>
                            <select id="f_categoria" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Telefone *</label>
                            <input required maxlength="15" oninput="mascararTelefone(this)" type="text" id="f_telefone" placeholder="(00) 00000-0000" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                    </div>
                    <p id="form_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>
                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Salvar</button>
                    </div>
                </form>
            </div>
        </div>

        <script>
            function mascararCnpj(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 14);
                v = v.replace(/(\\d{{2}})(\\d)/, "$1.$2").replace(/(\\d{{3}})(\\d)/, "$1.$2").replace(/(\\d{{3}})(\\d)/, "$1/$2").replace(/(\\d{{4}})(\\d{{1,2}})$/, "$1-$2");
                campo.value = v;
            }}
            function mascararTelefone(campo) {{
                let v = campo.value.replace(/\\D/g, "").slice(0, 11);
                if (v.length > 10) v = v.replace(/(\\d{{2}})(\\d{{5}})(\\d{{4}})/, "($1) $2-$3");
                else if (v.length > 5) v = v.replace(/(\\d{{2}})(\\d{{4}})(\\d{{0,4}})/, "($1) $2-$3");
                else if (v.length > 2) v = v.replace(/(\\d{{2}})(\\d{{0,5}})/, "($1) $2");
                campo.value = v;
            }}
            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor; opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            async function abrirNovo() {{
                document.getElementById('form').reset();
                document.getElementById('f_id').value = '';
                document.getElementById('form_titulo').textContent = 'Novo Fornecedor';
                document.getElementById('form_erro').classList.add('hidden');
                const resposta = await fetch('/api/opcoes/categoria_fornecedor');
                preencherSelect(document.getElementById('f_categoria'), await resposta.json());
                document.getElementById('modalForm').classList.remove('hidden');
            }}

            async function abrirEditar(botao) {{
                const d = botao.dataset;
                document.getElementById('form_titulo').textContent = 'Editar Fornecedor';
                document.getElementById('form_erro').classList.add('hidden');
                const resposta = await fetch('/api/opcoes/categoria_fornecedor');
                preencherSelect(document.getElementById('f_categoria'), await resposta.json());
                document.getElementById('f_id').value = d.id;
                document.getElementById('f_razao').value = d.razao;
                document.getElementById('f_cnpj').value = d.cnpj;
                document.getElementById('f_categoria').value = d.categoria;
                document.getElementById('f_telefone').value = d.telefone;
                document.getElementById('modalForm').classList.remove('hidden');
            }}

            function fecharModal() {{
                document.getElementById('modalForm').classList.add('hidden');
            }}

            async function salvar(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('form_erro');
                erroEl.classList.add('hidden');
                const id = document.getElementById('f_id').value;
                const dados = {{
                    razao_social: document.getElementById('f_razao').value,
                    cnpj: document.getElementById('f_cnpj').value,
                    categoria_servico: document.getElementById('f_categoria').value,
                    telefone: document.getElementById('f_telefone').value
                }};
                const url = id ? `/api/fornecedores/${{id}}` : '/fornecedores/';
                const resposta = await fetch(url, {{
                    method: id ? 'PUT' : 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || 'Erro ao salvar.';
                    erroEl.classList.remove('hidden');
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_fornecedores

@app.get("/admin/plano-contas", response_class=HTMLResponse, summary="Admin - Plano de Contas")
def admin_plano_contas(db: Session = Depends(get_db)):
    contas = db.query(PlanoDeContas).order_by(PlanoDeContas.codigo_contabil).all()
    linhas = ""
    for c in contas:
        cor = "text-green-600 bg-green-100" if c.tipo == "Receita" else "text-red-600 bg-red-100"
        linhas += f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4 font-bold text-slate-700">{esc(c.codigo_contabil)}</td>
            <td class="p-4 font-semibold text-slate-800">{esc(c.descricao_conta)}</td>
            <td class="p-4"><span class="px-3 py-1 rounded-full text-xs font-bold {cor}">{esc(c.tipo)}</span></td>
            <td class="p-4">
                <button onclick="abrirEditar(this)"
                    data-id="{c.id_conta}" data-codigo="{esc(c.codigo_contabil)}" data-descricao="{esc(c.descricao_conta)}" data-tipo="{esc(c.tipo)}"
                    class="bg-slate-100 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Editar</button>
            </td>
        </tr>
        """
    if not contas:
        linhas = '<tr><td colspan="4" class="p-8 text-center text-slate-400">Nenhuma conta contábil cadastrada ainda.</td></tr>'

    html_plano_contas = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Plano de Contas</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans relative">
        <div class="max-w-4xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Plano de Contas</h1>
                    <p class="text-slate-500">Estrutura contábil de receitas e despesas</p>
                </div>
                <div class="flex space-x-4">
                    <button onclick="abrirNovo()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">+ Nova Conta</button>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Código</th>
                            <th class="p-4">Descrição</th>
                            <th class="p-4">Tipo</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>

        <div id="modalForm" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-t-4 border-blue-600">
                <h2 id="form_titulo" class="text-2xl font-bold text-slate-800 mb-6">Nova Conta Contábil</h2>
                <form id="form" onsubmit="salvar(event)">
                    <input type="hidden" id="f_id">
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Código Contábil *</label>
                            <input required type="text" id="f_codigo" placeholder="Ex: 3.1.001" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Descrição *</label>
                            <input required type="text" id="f_descricao" placeholder="Ex: Doações de Associados" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Tipo</label>
                            <select id="f_tipo" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                    </div>
                    <p id="form_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>
                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Salvar</button>
                    </div>
                </form>
            </div>
        </div>

        <script>
            function preencherSelect(select, opcoes) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = o.valor; opt.textContent = o.valor;
                    select.appendChild(opt);
                }});
            }}

            async function abrirNovo() {{
                document.getElementById('form').reset();
                document.getElementById('f_id').value = '';
                document.getElementById('form_titulo').textContent = 'Nova Conta Contábil';
                document.getElementById('form_erro').classList.add('hidden');
                const resposta = await fetch('/api/opcoes/tipo_conta_contabil');
                preencherSelect(document.getElementById('f_tipo'), await resposta.json());
                document.getElementById('modalForm').classList.remove('hidden');
            }}

            async function abrirEditar(botao) {{
                const d = botao.dataset;
                document.getElementById('form_titulo').textContent = 'Editar Conta Contábil';
                document.getElementById('form_erro').classList.add('hidden');
                const resposta = await fetch('/api/opcoes/tipo_conta_contabil');
                preencherSelect(document.getElementById('f_tipo'), await resposta.json());
                document.getElementById('f_id').value = d.id;
                document.getElementById('f_codigo').value = d.codigo;
                document.getElementById('f_descricao').value = d.descricao;
                document.getElementById('f_tipo').value = d.tipo;
                document.getElementById('modalForm').classList.remove('hidden');
            }}

            function fecharModal() {{
                document.getElementById('modalForm').classList.add('hidden');
            }}

            async function salvar(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('form_erro');
                erroEl.classList.add('hidden');
                const id = document.getElementById('f_id').value;
                const dados = {{
                    codigo_contabil: document.getElementById('f_codigo').value,
                    descricao_conta: document.getElementById('f_descricao').value,
                    tipo: document.getElementById('f_tipo').value
                }};
                const url = id ? `/api/plano-contas/${{id}}` : '/plano-contas/';
                const resposta = await fetch(url, {{
                    method: id ? 'PUT' : 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || 'Erro ao salvar.';
                    erroEl.classList.remove('hidden');
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_plano_contas

@app.get("/admin/titulos", response_class=HTMLResponse, summary="Admin - Títulos Financeiros")
def admin_titulos(status: str = None, tipo_titulo: str = None, db: Session = Depends(get_db)):
    consulta = db.query(TituloFinanceiro)
    if status:
        consulta = consulta.filter(TituloFinanceiro.status == status)
    if tipo_titulo:
        consulta = consulta.filter(TituloFinanceiro.tipo_titulo == tipo_titulo)
    titulos = consulta.order_by(TituloFinanceiro.data_vencimento).all()

    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}
    associados = {a.id_associado: a for a in db.query(Associado).all()}
    fornecedores = {f.id_fornecedor: f for f in db.query(Fornecedor).all()}

    linhas = ""
    for t in titulos:
        conta = contas.get(t.id_conta_contabil)
        beneficiario = "-"
        if t.id_associado and t.id_associado in associados:
            beneficiario = associados[t.id_associado].nome_completo
        elif t.id_fornecedor and t.id_fornecedor in fornecedores:
            beneficiario = fornecedores[t.id_fornecedor].razao_social
        cor_status = "text-green-600 bg-green-100" if t.status == "Pago" else "text-amber-700 bg-amber-100"
        vencimento = t.data_vencimento.strftime("%d/%m/%Y") if t.data_vencimento else "-"
        acao = "-"
        if t.status != "Pago":
            acao = f"""<button onclick="abrirBaixa({t.id_titulo}, {t.saldo_devedor})" class="bg-slate-100 hover:bg-green-100 text-green-700 px-3 py-1.5 rounded-lg font-semibold text-sm transition">Baixar</button>"""
        linhas += f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4 font-semibold text-slate-800">{esc(t.descricao)}</td>
            <td class="p-4 text-slate-500">{esc(t.tipo_titulo)}</td>
            <td class="p-4 text-slate-500">{esc(conta.descricao_conta if conta else '')}</td>
            <td class="p-4 text-slate-500">{esc(beneficiario)}</td>
            <td class="p-4 text-slate-700">R$ {t.valor_original:.2f}</td>
            <td class="p-4 font-bold text-slate-800">R$ {t.saldo_devedor:.2f}</td>
            <td class="p-4 text-slate-500">{vencimento}</td>
            <td class="p-4"><span class="px-3 py-1 rounded-full text-xs font-bold {cor_status}">{esc(t.status)}</span></td>
            <td class="p-4">{acao}</td>
        </tr>
        """
    if not titulos:
        linhas = '<tr><td colspan="9" class="p-8 text-center text-slate-400">Nenhum título encontrado para este filtro.</td></tr>'

    html_titulos = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Títulos Financeiros</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans relative">
        <div class="max-w-7xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Tesouraria — Títulos</h1>
                    <p class="text-slate-500">Contas a pagar e a receber</p>
                </div>
                <div class="flex space-x-4">
                    <button onclick="abrirNovo()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">+ Lançar Título</button>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <form method="get" class="flex space-x-4 mb-6">
                <select name="tipo_titulo" onchange="this.form.submit()" class="p-2 border border-slate-300 rounded-lg bg-white">
                    <option value="" {"selected" if not tipo_titulo else ""}>Todos os Tipos</option>
                    <option value="A Pagar" {"selected" if tipo_titulo == "A Pagar" else ""}>A Pagar</option>
                    <option value="A Receber" {"selected" if tipo_titulo == "A Receber" else ""}>A Receber</option>
                </select>
                <select name="status" onchange="this.form.submit()" class="p-2 border border-slate-300 rounded-lg bg-white">
                    <option value="" {"selected" if not status else ""}>Todos os Status</option>
                    <option value="Pendente" {"selected" if status == "Pendente" else ""}>Pendente</option>
                    <option value="Pago" {"selected" if status == "Pago" else ""}>Pago</option>
                </select>
            </form>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Descrição</th>
                            <th class="p-4">Tipo</th>
                            <th class="p-4">Conta</th>
                            <th class="p-4">Beneficiário</th>
                            <th class="p-4">Valor Original</th>
                            <th class="p-4">Saldo</th>
                            <th class="p-4">Vencimento</th>
                            <th class="p-4">Status</th>
                            <th class="p-4">Ação</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>

        <!-- MODAL: NOVO TÍTULO -->
        <div id="modalNovo" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 border-t-4 border-blue-600 max-h-[90vh] overflow-y-auto">
                <h2 class="text-2xl font-bold text-slate-800 mb-6">Lançar Título Financeiro</h2>
                <form id="form" onsubmit="salvar(event)">
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Tipo *</label>
                            <select id="f_tipo" onchange="alternarBeneficiario()" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                                <option value="A Pagar">A Pagar (Fornecedor)</option>
                                <option value="A Receber">A Receber (Associado)</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Conta Contábil *</label>
                            <select id="f_conta" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div id="bloco_fornecedor">
                            <label class="text-xs font-bold text-slate-500 uppercase">Fornecedor *</label>
                            <select id="f_fornecedor" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div id="bloco_associado" style="display:none">
                            <label class="text-xs font-bold text-slate-500 uppercase">Associado *</label>
                            <select id="f_associado" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Descrição *</label>
                            <input required type="text" id="f_descricao" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Valor (R$) *</label>
                                <input required type="number" step="0.01" min="0.01" id="f_valor" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-500 uppercase">Vencimento *</label>
                                <input required type="date" id="f_vencimento" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                            </div>
                        </div>
                    </div>
                    <p id="form_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>
                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal('modalNovo')" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition">Lançar</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL: BAIXAR TÍTULO -->
        <div id="modalBaixa" class="fixed inset-0 bg-slate-900 bg-opacity-50 hidden flex items-center justify-center z-50 backdrop-blur-sm transition-opacity p-4">
            <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full mx-4 border-t-4 border-green-600">
                <h2 class="text-2xl font-bold text-slate-800 mb-6">Baixar Título</h2>
                <form id="formBaixa" onsubmit="salvarBaixa(event)">
                    <input type="hidden" id="b_id">
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Valor a Pagar/Receber (R$) *</label>
                            <input required type="number" step="0.01" min="0.01" id="b_valor" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase">Forma de Pagamento</label>
                            <select id="b_forma" class="w-full p-2 border border-slate-300 rounded-lg bg-slate-50"></select>
                        </div>
                    </div>
                    <p id="baixa_erro" class="text-red-600 text-sm font-semibold mt-4 hidden"></p>
                    <div class="flex justify-end space-x-3 mt-8">
                        <button type="button" onclick="fecharModal('modalBaixa')" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition">Cancelar</button>
                        <button type="submit" class="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition">Confirmar Baixa</button>
                    </div>
                </form>
            </div>
        </div>

        <script>
            function preencherSelect(select, opcoes, valorField, textoFn) {{
                select.innerHTML = '';
                opcoes.forEach(o => {{
                    const opt = document.createElement('option');
                    opt.value = valorField ? o[valorField] : o.valor;
                    opt.textContent = textoFn ? textoFn(o) : o.valor;
                    select.appendChild(opt);
                }});
            }}

            function alternarBeneficiario() {{
                const tipo = document.getElementById('f_tipo').value;
                document.getElementById('bloco_fornecedor').style.display = tipo === 'A Pagar' ? '' : 'none';
                document.getElementById('bloco_associado').style.display = tipo === 'A Receber' ? '' : 'none';
            }}

            async function abrirNovo() {{
                document.getElementById('form').reset();
                document.getElementById('form_erro').classList.add('hidden');
                const contas = await (await fetch('/api/plano-contas/')).json();
                preencherSelect(document.getElementById('f_conta'), contas, 'id_conta', c => `${{c.codigo_contabil}} — ${{c.descricao_conta}}`);
                const fornecedores = await (await fetch('/api/fornecedores/')).json();
                preencherSelect(document.getElementById('f_fornecedor'), fornecedores, 'id_fornecedor', f => f.razao_social);
                const associados = await (await fetch('/api/associados/busca-simples')).json();
                preencherSelect(document.getElementById('f_associado'), associados, 'id_associado', a => a.nome_completo);
                alternarBeneficiario();
                document.getElementById('modalNovo').classList.remove('hidden');
            }}

            function fecharModal(id) {{
                document.getElementById(id).classList.add('hidden');
            }}

            async function salvar(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('form_erro');
                erroEl.classList.add('hidden');
                const tipo = document.getElementById('f_tipo').value;
                const dados = {{
                    tipo_titulo: tipo,
                    id_conta_contabil: parseInt(document.getElementById('f_conta').value, 10),
                    id_fornecedor: tipo === 'A Pagar' ? parseInt(document.getElementById('f_fornecedor').value, 10) : null,
                    id_associado: tipo === 'A Receber' ? parseInt(document.getElementById('f_associado').value, 10) : null,
                    descricao: document.getElementById('f_descricao').value,
                    valor_original: parseFloat(document.getElementById('f_valor').value),
                    data_vencimento: document.getElementById('f_vencimento').value
                }};
                const resposta = await fetch('/titulos/', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || 'Erro ao lançar título.';
                    erroEl.classList.remove('hidden');
                }}
            }}

            async function abrirBaixa(idTitulo, saldoDevedor) {{
                document.getElementById('b_id').value = idTitulo;
                document.getElementById('b_valor').value = saldoDevedor.toFixed(2);
                document.getElementById('baixa_erro').classList.add('hidden');
                const formas = await (await fetch('/api/opcoes/forma_pagamento')).json();
                preencherSelect(document.getElementById('b_forma'), formas);
                document.getElementById('modalBaixa').classList.remove('hidden');
            }}

            async function salvarBaixa(event) {{
                event.preventDefault();
                const erroEl = document.getElementById('baixa_erro');
                erroEl.classList.add('hidden');
                const dados = {{
                    id_titulo: parseInt(document.getElementById('b_id').value, 10),
                    valor_pago: parseFloat(document.getElementById('b_valor').value),
                    forma_pagamento: document.getElementById('b_forma').value
                }};
                const resposta = await fetch('/baixar-titulo/', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(dados)
                }});
                if (resposta.ok) {{
                    window.location.reload();
                }} else {{
                    const erro = await resposta.json();
                    const detalhe = Array.isArray(erro.detail) ? erro.detail.map(d => d.msg).join(", ") : erro.detail;
                    erroEl.textContent = detalhe || 'Erro ao baixar título.';
                    erroEl.classList.remove('hidden');
                }}
            }}
        </script>
    </body>
    </html>
    """
    return html_titulos

@app.get("/admin/livro-caixa", response_class=HTMLResponse, summary="Admin - Livro-Caixa")
def admin_livro_caixa(db: Session = Depends(get_db)):
    transacoes = db.query(TransacaoCaixa).order_by(TransacaoCaixa.data_registro_servidor).all()
    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}

    saldo = 0.0
    linhas_lista = []
    for t in transacoes:
        saldo += t.valor_efetivado if t.tipo_movimento == "Entrada" else -t.valor_efetivado
        conta = contas.get(t.id_conta_contabil)
        cor = "text-green-600" if t.tipo_movimento == "Entrada" else "text-red-600"
        sinal = "+" if t.tipo_movimento == "Entrada" else "-"
        data_fmt = t.data_registro_servidor.strftime("%d/%m/%Y %H:%M") if t.data_registro_servidor else "-"
        linhas_lista.append(f"""
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4 text-slate-500">{data_fmt}</td>
            <td class="p-4 text-slate-700">{esc(conta.descricao_conta if conta else '')}</td>
            <td class="p-4 font-semibold {cor}">{esc(t.tipo_movimento)}</td>
            <td class="p-4 font-bold {cor}">{sinal} R$ {t.valor_efetivado:.2f}</td>
            <td class="p-4 text-slate-500">{esc(t.forma_pagamento)}</td>
            <td class="p-4 text-slate-500">{esc(t.status_auditoria)}</td>
            <td class="p-4 font-bold text-slate-800">R$ {saldo:.2f}</td>
        </tr>
        """)
    linhas = "".join(reversed(linhas_lista))
    if not transacoes:
        linhas = '<tr><td colspan="7" class="p-8 text-center text-slate-400">Nenhuma transação registrada ainda.</td></tr>'

    cor_saldo = "text-emerald-600" if saldo >= 0 else "text-red-600"

    html_livro_caixa = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>ASAF - Livro-Caixa</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 p-10 font-sans">
        <div class="max-w-6xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-900">Livro-Caixa</h1>
                    <p class="text-slate-500">Extrato de todas as movimentações financeiras</p>
                </div>
                <div class="flex items-center space-x-4">
                    <div class="bg-white rounded-xl border border-slate-200 px-6 py-3 shadow-sm text-right">
                        <p class="text-xs font-bold text-slate-400 uppercase">Saldo Atual</p>
                        <p class="text-2xl font-black {cor_saldo}">R$ {saldo:.2f}</p>
                    </div>
                    <a href="/admin" class="px-4 py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition">&larr; Voltar ao Comando</a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table class="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr class="bg-slate-900 text-white text-xs uppercase tracking-wider">
                            <th class="p-4">Data</th>
                            <th class="p-4">Conta</th>
                            <th class="p-4">Movimento</th>
                            <th class="p-4">Valor</th>
                            <th class="p-4">Forma de Pagamento</th>
                            <th class="p-4">Auditoria</th>
                            <th class="p-4">Saldo Após</th>
                        </tr>
                    </thead>
                    <tbody>{linhas}</tbody>
                </table>
            </div>
        </div>
    </body>
    </html>
    """
    return html_livro_caixa