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

def seed_niveis_e_permissoes():
    """Catálogo inicial de NivelAcesso/PermissaoSistema (v0.1.5 do plano) - só semeia o que
    ainda não existir, nunca sobrescreve o que a diretoria já tiver ajustado depois."""
    from app.models.core import NivelAcesso, PermissaoSistema, perfil_permissao  # import local, mesmo motivo do seed acima

    niveis_padrao = [
        {"nome_nivel": "Presidente", "descricao": "Acesso total ao sistema.", "is_conselho_fiscal": False, "exige_mfa": True},
        {"nome_nivel": "Diretoria", "descricao": "Gestão administrativa e financeira.", "is_conselho_fiscal": False, "exige_mfa": True},
        {"nome_nivel": "Conselho Fiscal", "descricao": "Fiscalização financeira e de atas.", "is_conselho_fiscal": True, "exige_mfa": False},
        {"nome_nivel": "Associado", "descricao": "Autoatendimento do próprio cadastro.", "is_conselho_fiscal": False, "exige_mfa": False},
        {"nome_nivel": "Voluntário Externo", "descricao": "Acesso restrito ao próprio histórico de voluntariado.", "is_conselho_fiscal": False, "exige_mfa": False},
    ]
    permissoes_padrao = [
        {"modulo": "core", "codigo_permissao": "gerenciar_acesso", "descricao": "Gerenciar níveis de acesso e permissões."},
        {"modulo": "associados", "codigo_permissao": "associados", "descricao": "Gerenciar cadastro de associados."},
        {"modulo": "financeiro", "codigo_permissao": "financeiro", "descricao": "Gerenciar lançamentos e plano de contas."},
        {"modulo": "governanca", "codigo_permissao": "governanca", "descricao": "Gerenciar assembleias e votações."},
        {"modulo": "projetos", "codigo_permissao": "projetos", "descricao": "Gerenciar projetos e voluntários."},
        {"modulo": "core", "codigo_permissao": "auditoria", "descricao": "Consultar a trilha de auditoria."},
    ]
    # Nível -> lista de códigos de permissão que ele recebe por padrão (ajustável depois pela
    # própria tela de administração de acesso, isto aqui é só ponto de partida).
    atribuicoes_padrao = {
        "Presidente": ["gerenciar_acesso", "associados", "financeiro", "governanca", "projetos", "auditoria"],
        "Diretoria": ["associados", "financeiro", "governanca", "projetos"],
        "Conselho Fiscal": ["financeiro", "auditoria"],
        "Associado": [],
        "Voluntário Externo": [],
    }

    db = SessaoLocal()
    try:
        nome_para_id = {}
        for dados in niveis_padrao:
            existente = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == dados["nome_nivel"]).first()
            if not existente:
                existente = NivelAcesso(**dados)
                db.add(existente)
                db.flush()
            nome_para_id[dados["nome_nivel"]] = existente.id_nivel

        codigo_para_id = {}
        for dados in permissoes_padrao:
            existente = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == dados["codigo_permissao"]).first()
            if not existente:
                existente = PermissaoSistema(**dados)
                db.add(existente)
                db.flush()
            codigo_para_id[dados["codigo_permissao"]] = existente.id_permissao

        for nome_nivel, codigos in atribuicoes_padrao.items():
            id_nivel = nome_para_id[nome_nivel]
            for codigo in codigos:
                id_permissao = codigo_para_id[codigo]
                ja_existe = db.execute(
                    perfil_permissao.select().where(
                        perfil_permissao.c.id_nivel == id_nivel, perfil_permissao.c.id_permissao == id_permissao
                    )
                ).first()
                if not ja_existe:
                    db.execute(perfil_permissao.insert().values(id_nivel=id_nivel, id_permissao=id_permissao))
        db.commit()
    finally:
        db.close()


def get_db():
    db = SessaoLocal()
    try:
        yield db
    finally:
        db.close()
