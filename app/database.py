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

def seed_catalogos():
    """v0.3.1 - semeia Catalogo/OpcaoCatalogo (motor genérico) direto, para banco novo que nunca
    teve `opcoes_lista` (v0.1/v0.2). Banco que já tinha dado em `opcoes_lista` recebe esse mesmo
    conteúdo pela migração de dado da revisão d2e3f4a5b6c7, não por aqui - por isso este seed só
    semeia catálogo que ainda não existe (idempotente, nunca duplica o que a migração já trouxe).
    Os códigos abaixo são os mesmos que a migração deriva do rótulo (mesmo algoritmo de slug) -
    mantidos iguais de propósito, para o código estável ser o mesmo não importa qual caminho o
    banco passou (seed direto ou migração de dado antigo).

    v0.3.2 acrescentou os catálogos que ainda não existiam em v0.1/v0.2 (tipo de documento,
    motivo de desligamento, tipo de projeto/evento/protocolo/requerimento, unidade de medida de
    indicador) - todos como **semente de exemplo**, `editavel_pelo_usuario=True`: a diretoria
    ajusta ao estatuto real da associação depois, isto aqui é só ponto de partida (ver
    PLANO_PROJETO.md v0.3.2)."""
    from app.models.core import Catalogo, OpcaoCatalogo  # import local, mesmo motivo do seed acima
    catalogos_padrao = {
        "categoria_associado": ("Categoria do associado", False, [
            ("EFETIVO", "Efetivo"), ("CONTRIBUINTE", "Contribuinte"), ("FUNDADOR", "Fundador"),
        ]),
        "status_arrolamento": ("Situação de arrolamento", False, [
            ("ATIVO_EM_DIA", "Ativo - Em Dia"), ("ATIVO_INADIMPLENTE", "Ativo - Inadimplente"),
            ("SUSPENSO_ESTATUTO", "Suspenso (Estatuto)"), ("DESLIGADO", "Desligado"),
            ("EM_EXPERIENCIA", "Em Experiência"),  # v1.2 - mesmo rótulo inserido via migração b6c7d8e9f0a1
        ]),
        "estado_civil": ("Estado civil", True, [
            ("SOLTEIRO_A", "Solteiro(a)"), ("CASADO_A", "Casado(a)"), ("DIVORCIADO_A", "Divorciado(a)"),
            ("VIUVO_A", "Viúvo(a)"), ("UNIAO_ESTAVEL", "União Estável"),
        ]),
        "grau_parentesco": ("Grau de parentesco", True, [
            ("CONJUGE", "Cônjuge"), ("FILHO_A", "Filho(a)"), ("PAI", "Pai"), ("MAE", "Mãe"),
            ("IRMAO_A", "Irmão(ã)"), ("NETO_A", "Neto(a)"), ("OUTRO", "Outro"),
        ]),
        "categoria_fornecedor": ("Categoria de fornecedor", True, [
            ("MATERIAL_DE_CONSTRUCAO", "Material de Construção"), ("SERVICOS_GRAFICOS", "Serviços Gráficos"),
            ("ALIMENTACAO", "Alimentação"), ("TECNOLOGIA", "Tecnologia"),
            ("MANUTENCAO_E_REPAROS", "Manutenção e Reparos"), ("TRANSPORTE", "Transporte"), ("OUTROS", "Outros"),
        ]),
        "tipo_conta_contabil": ("Tipo de conta contábil", True, [("RECEITA", "Receita"), ("DESPESA", "Despesa")]),
        "forma_pagamento": ("Forma de pagamento", True, [
            ("PIX", "Pix"), ("DINHEIRO", "Dinheiro"), ("CARTAO", "Cartão"),
            ("TRANSFERENCIA_BANCARIA", "Transferência Bancária"), ("BOLETO", "Boleto"),
        ]),
        "titulo_cargo": ("Título de cargo", True, [
            ("PRESIDENTE", "Presidente"), ("VICE_PRESIDENTE", "Vice-Presidente"), ("TESOUREIRO", "Tesoureiro"),
            ("VICE_TESOUREIRO", "Vice-Tesoureiro"), ("SECRETARIO", "Secretário"), ("VICE_SECRETARIO", "Vice-Secretário"),
            ("CONSELHO_FISCAL", "Conselho Fiscal"), ("DIRETOR_DE_PATRIMONIO", "Diretor de Patrimônio"),
            ("DIRETOR_SOCIAL", "Diretor Social"),
        ]),
        # ---- v0.3.2: catálogos novos, sem equivalente em opcoes_lista (v0.1/v0.2) ----
        "tipo_documento": ("Tipo de documento", True, [
            ("RG", "RG"), ("CPF", "CPF"), ("COMPROVANTE_RESIDENCIA", "Comprovante de Residência"),
            ("CERTIDAO_NASCIMENTO", "Certidão de Nascimento"), ("COMPROVANTE_RENDA", "Comprovante de Renda"),
            ("FOTO_3X4", "Foto 3x4"),
        ]),
        "motivo_desligamento": ("Motivo de desligamento", True, [
            ("INADIMPLENCIA", "Inadimplência"), ("PEDIDO_VOLUNTARIO", "Pedido voluntário"),
            ("FALECIMENTO", "Falecimento"), ("CONDUTA_INCOMPATIVEL", "Conduta incompatível com o estatuto"),
            ("MUDANCA_DE_CIDADE", "Mudança de cidade"),
        ]),
        "tipo_projeto": ("Tipo de projeto", True, [
            ("ASSISTENCIAL", "Assistencial"), ("EDUCACIONAL", "Educacional"), ("CULTURAL", "Cultural"),
            ("ESPORTIVO", "Esportivo"), ("SAUDE", "Saúde"),
        ]),
        "tipo_evento": ("Tipo de evento", True, [
            ("ASSEMBLEIA", "Assembleia"), ("REUNIAO_DE_DIRETORIA", "Reunião de Diretoria"), ("CULTO", "Culto"),
            ("CONFRATERNIZACAO", "Confraternização"), ("ACAO_SOCIAL", "Ação Social"), ("PALESTRA", "Palestra"),
        ]),
        "tipo_protocolo": ("Tipo de protocolo", True, [
            ("SOLICITACAO_DE_DOCUMENTO", "Solicitação de Documento"), ("RECLAMACAO", "Reclamação"),
            ("SUGESTAO", "Sugestão"), ("DENUNCIA", "Denúncia"),
            ("REQUERIMENTO_ADMINISTRATIVO", "Requerimento Administrativo"),
        ]),
        "tipo_requerimento": ("Tipo de requerimento", True, [
            ("ALTERACAO_CADASTRAL", "Alteração Cadastral"), ("SEGUNDA_VIA_DE_CARTEIRINHA", "Segunda Via de Carteirinha"),
            ("ISENCAO_DE_MENSALIDADE", "Isenção de Mensalidade"), ("LICENCA_TEMPORARIA", "Licença Temporária"),
            ("DESLIGAMENTO", "Desligamento"),
        ]),
        "unidade_medida_indicador": ("Unidade de medida de indicador", True, [
            ("UNIDADE", "Unidade"), ("PERCENTUAL", "Percentual"), ("REAL", "Real (R$)"),
            ("QUILOGRAMA", "Quilograma"), ("HORA", "Hora"), ("PESSOA", "Pessoa"),
        ]),
    }
    db = SessaoLocal()
    try:
        for chave, (nome_exibido, editavel_pelo_usuario, opcoes) in catalogos_padrao.items():
            if db.query(Catalogo).filter(Catalogo.chave == chave).first():
                continue
            catalogo = Catalogo(chave=chave, nome_exibido=nome_exibido, editavel_pelo_usuario=editavel_pelo_usuario)
            db.add(catalogo)
            db.flush()
            for i, (codigo, rotulo) in enumerate(opcoes):
                db.add(OpcaoCatalogo(id_catalogo=catalogo.id_catalogo, codigo=codigo, rotulo=rotulo, ordem=i))
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


def seed_configuracoes_institucionais():
    """v0.3.4 - chaves canônicas de configuração institucional, tipadas. Só semeia o que ainda
    não existir (nunca sobrescreve valor que a diretoria já tiver ajustado); roda sempre, mesmo
    em produção com RUN_DB_MIGRATION=false (mesmo raciocínio de seed_catalogos/
    seed_niveis_e_permissoes - achado real desta sessão foi seeds amarrados à flag errada)."""
    from app.models.core import ConfiguracaoInstitucional  # import local, mesmo motivo dos seeds acima

    configs_padrao = [
        {"chave": "NOME_INSTITUICAO", "valor": "ASAF - Associação Arca da Família", "tipo": "texto", "categoria": "identidade", "descricao": "Nome oficial da instituição, usado no cabeçalho de documentos."},
        {"chave": "CNPJ", "valor": "", "tipo": "texto", "categoria": "identidade", "descricao": "CNPJ da instituição."},
        {"chave": "ENDERECO", "valor": "", "tipo": "texto", "categoria": "identidade", "descricao": "Endereço completo da sede."},
        {"chave": "LOGO_URL", "valor": "", "tipo": "texto", "categoria": "aparencia", "descricao": "URL do logo institucional."},
        {"chave": "COR_PRIMARIA", "valor": "#1D4ED8", "tipo": "cor", "categoria": "aparencia", "descricao": "Cor primária de documentos e identidade visual."},
        {"chave": "COR_SECUNDARIA", "valor": "#64748B", "tipo": "cor", "categoria": "aparencia", "descricao": "Cor secundária de documentos e identidade visual."},
        {"chave": "DADOS_BANCARIOS", "valor": "", "tipo": "texto", "categoria": "financeiro", "descricao": "Banco, agência e conta para recebimento (texto livre)."},
        {"chave": "FUSO_HORARIO", "valor": "America/Sao_Paulo", "tipo": "texto", "categoria": "geral", "descricao": "Fuso horário usado em datas de documento e agendamento."},
        {"chave": "EMAIL_REMETENTE", "valor": "", "tipo": "email", "categoria": "geral", "descricao": "E-mail usado como remetente de notificações do sistema."},
        {"chave": "TEXTO_PADRAO_DOCUMENTO", "valor": "", "tipo": "texto", "categoria": "documentos", "descricao": "Texto padrão (rodapé/aviso legal) incluído nos documentos gerados."},
        {"chave": "PRAZO_CONVOCACAO_DIAS", "valor": "15", "tipo": "numero", "categoria": "regras", "descricao": "Dias mínimos de antecedência para convocação de assembleia."},
        {"chave": "DIAS_TOLERANCIA_INADIMPLENCIA", "valor": "30", "tipo": "numero", "categoria": "regras", "descricao": "Dias de atraso tolerados antes de marcar associado como inadimplente."},
        {"chave": "TETO_ALCADA_FINANCEIRA", "valor": "1000", "tipo": "numero", "categoria": "regras", "descricao": "Valor máximo (R$) que a Diretoria aprova sem submeter à Assembleia."},
        {"chave": "PRAZO_EXPERIENCIA_DIAS", "valor": "90", "tipo": "numero", "categoria": "regras", "descricao": "Dias de experiência de um novo associado antes de virar Ativo pleno (0 = sem período de experiência)."},
    ]
    db = SessaoLocal()
    try:
        for c in configs_padrao:
            if db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == c["chave"]).first():
                continue
            db.add(ConfiguracaoInstitucional(
                chave_configuracao=c["chave"], valor_configuracao=c["valor"],
                tipo=c["tipo"], categoria=c["categoria"], descricao=c["descricao"],
            ))
        db.commit()
    finally:
        db.close()


def get_db():
    db = SessaoLocal()
    try:
        yield db
    finally:
        db.close()
