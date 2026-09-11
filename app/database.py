from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker
import os

# ==========================================
# CONFIGURAÇÃO DO BANCO DE DADOS
# ==========================================
# DATABASE_URL vem do ambiente (Key Vault -> Container App em produção; .env local em dev).
# Nunca hardcoded aqui - ver CREDENCIAIS_AZURE.md (gitignored) para o valor real.
URL_BANCO_DADOS = os.environ.get("DATABASE_URL", "sqlite:///./erp_asaf.db")

_engine_kwargs = {}
if URL_BANCO_DADOS.startswith("sqlite"):
    # connect_args especifico do SQLite - so aplica em dev local sem Postgres configurado.
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(URL_BANCO_DADOS, **_engine_kwargs)
SessaoLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

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

def seed_opcoes_lista():
    """Preenche valores padrão de cada lista configurável, apenas se ela ainda estiver vazia."""
    from app.models.core import OpcaoLista  # import local para evitar import circular com app.models
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

def get_db():
    db = SessaoLocal()
    try:
        yield db
    finally:
        db.close()
