from datetime import datetime

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
    PLANO_PROJETO.md v0.3.2).

    v2.5.8 acrescentou `permissao_gerenciamento` (dono por módulo) a cada tupla - mesmo valor que
    a migração 75fa21fb920d faz de backfill em banco que já tinha esses catálogos, pelo mesmo
    motivo de sempre: banco novo (este seed) e banco existente (a migração) têm que chegar no
    mesmo resultado, nunca um caminho ganhando um detalhe que o outro não tem."""
    from app.models.core import Catalogo, OpcaoCatalogo  # import local, mesmo motivo do seed acima
    catalogos_padrao = {
        # v2.1 - vantagem especial por categoria (Art. 55 do Código Civil) guardada em
        # `metadados["vantagens"]`, texto livre - reaproveita o campo genérico da OpcaoCatalogo
        # (v0.3.1) em vez de coluna nova. Editável via PUT /api/opcoes-catalogo/{id}, mesmo em
        # catálogo de sistema (só criar/apagar código é que é bloqueado, não editar metadados).
        "categoria_associado": ("Categoria do associado", False, "associados", [
            ("EFETIVO", "Efetivo", {"vantagens": "Direito a voto e a ser votado; acesso pleno aos benefícios e projetos da ASAF."}),
            ("CONTRIBUINTE", "Contribuinte", {"vantagens": "Apoia financeiramente sem os direitos políticos de associado efetivo (ajustável pela diretoria)."}),
            ("FUNDADOR", "Fundador", {"vantagens": "Mesmos direitos do associado efetivo, com reconhecimento histórico de fundador da ASAF."}),
        ]),
        "status_arrolamento": ("Situação de arrolamento", False, None, [
            ("ATIVO_EM_DIA", "Ativo - Em Dia"), ("ATIVO_INADIMPLENTE", "Ativo - Inadimplente"),
            ("SUSPENSO_ESTATUTO", "Suspenso (Estatuto)"), ("DESLIGADO", "Desligado"),
            ("EM_EXPERIENCIA", "Em Experiência"),  # v1.2 - mesmo rótulo inserido via migração b6c7d8e9f0a1
            ("LICENCIADO", "Licenciado"),  # v1.4 - mesmo rótulo inserido via migração d8e9f0a1b2c3
        ]),
        "estado_civil": ("Estado civil", True, "associados", [
            ("SOLTEIRO_A", "Solteiro(a)"), ("CASADO_A", "Casado(a)"), ("DIVORCIADO_A", "Divorciado(a)"),
            ("VIUVO_A", "Viúvo(a)"), ("UNIAO_ESTAVEL", "União Estável"),
        ]),
        "grau_parentesco": ("Grau de parentesco", True, "associados", [
            ("CONJUGE", "Cônjuge"), ("FILHO_A", "Filho(a)"), ("PAI", "Pai"), ("MAE", "Mãe"),
            ("IRMAO_A", "Irmão(ã)"), ("NETO_A", "Neto(a)"), ("OUTRO", "Outro"),
        ]),
        "categoria_fornecedor": ("Categoria de fornecedor", True, "financeiro", [
            ("MATERIAL_DE_CONSTRUCAO", "Material de Construção"), ("SERVICOS_GRAFICOS", "Serviços Gráficos"),
            ("ALIMENTACAO", "Alimentação"), ("TECNOLOGIA", "Tecnologia"),
            ("MANUTENCAO_E_REPAROS", "Manutenção e Reparos"), ("TRANSPORTE", "Transporte"), ("OUTROS", "Outros"),
        ]),
        # v3.0 - os cinco tipos contábeis reais (Ativo/Passivo/Patrimônio Líquido/Receita/
        # Despesa), dos quais deriva a natureza devedora/credora de cada conta (ver
        # app/services/contabilidade.py::NATUREZA_POR_TIPO) - antes só existia Receita/Despesa,
        # insuficiente pra validar partida dobrada de verdade.
        # v3.1 - `metadados["exige_comprovante"]` na opção DESPESA: "anexo de comprovante
        # obrigatório por tipo de lançamento (configurável)" - despesa sem comprovante é a porta
        # de entrada de todo problema de prestação de contas, então nasce exigido por padrão; a
        # diretoria pode desligar pelo admin de catálogos (v0.3.1) sem deploy. Ver
        # app/services/contabilidade.py::exige_comprovante.
        "tipo_conta_contabil": ("Tipo de conta contábil", True, "financeiro", [
            ("ATIVO", "Ativo"), ("PASSIVO", "Passivo"), ("PATRIMONIO_LIQUIDO", "Patrimônio Líquido"),
            ("RECEITA", "Receita"), ("DESPESA", "Despesa", {"exige_comprovante": True}),
        ]),
        # v3.1 - especialização de PlanoDeContas tipo Ativo (`ContaFinanceira`).
        "tipo_conta_financeira": ("Tipo de conta financeira", True, "financeiro", [
            ("CAIXA", "Caixa"), ("CONTA_CORRENTE", "Conta Corrente"),
            ("POUPANCA", "Poupança"), ("CONTA_DE_APLICACAO", "Conta de Aplicação"),
        ]),
        "forma_pagamento": ("Forma de pagamento", True, "financeiro", [
            ("PIX", "Pix"), ("DINHEIRO", "Dinheiro"), ("CARTAO", "Cartão"),
            ("TRANSFERENCIA_BANCARIA", "Transferência Bancária"), ("BOLETO", "Boleto"),
        ]),
        # v2.1 - `metadados["permissoes"]` é a lista de códigos de PermissaoSistema que o cargo
        # concede automaticamente enquanto o mandato estiver vigente (ver app/services/mandatos.py
        # e app/security.py::usuario_tem_permissao) - semente de partida plausível por
        # competência do Art. 20/21 do estatuto, ajustável pela diretoria sem deploy.
        "titulo_cargo": ("Título de cargo", True, "governanca", [
            ("PRESIDENTE", "Presidente", {"permissoes": ["gerenciar_acesso", "associados", "financeiro", "governanca", "projetos", "auditoria"]}),
            ("VICE_PRESIDENTE", "Vice-Presidente", {"permissoes": ["associados", "governanca"]}),
            ("TESOUREIRO", "Tesoureiro", {"permissoes": ["financeiro"]}),
            ("VICE_TESOUREIRO", "Vice-Tesoureiro", {"permissoes": ["financeiro"]}),
            ("SECRETARIO", "Secretário", {"permissoes": ["associados", "governanca"]}),
            ("VICE_SECRETARIO", "Vice-Secretário", {"permissoes": ["associados"]}),
            ("CONSELHO_FISCAL", "Conselho Fiscal", {"permissoes": ["financeiro", "auditoria"]}),
            ("DIRETOR_DE_PATRIMONIO", "Diretor de Patrimônio", {}),
            ("DIRETOR_SOCIAL", "Diretor Social", {"permissoes": ["projetos"]}),
        ]),
        # v2.1 (Art. 18 do estatuto) - órgãos de direção da ASAF: Diretoria Executiva e Conselho
        # Fiscal. Catálogo editável - a ASAF pode criar um Conselho Deliberativo sem deploy.
        "orgao_direcao": ("Órgão de direção", True, "governanca", [
            ("DIRETORIA_EXECUTIVA", "Diretoria Executiva", {}), ("CONSELHO_FISCAL", "Conselho Fiscal", {}),
        ]),
        # ---- v0.3.2: catálogos novos, sem equivalente em opcoes_lista (v0.1/v0.2) ----
        "tipo_documento": ("Tipo de documento", True, "associados", [
            ("RG", "RG"), ("CPF", "CPF"), ("COMPROVANTE_RESIDENCIA", "Comprovante de Residência"),
            ("CERTIDAO_NASCIMENTO", "Certidão de Nascimento"), ("COMPROVANTE_RENDA", "Comprovante de Renda"),
            ("FOTO_3X4", "Foto 3x4"),
        ]),
        "motivo_desligamento": ("Motivo de desligamento", True, "associados", [
            ("INADIMPLENCIA", "Inadimplência"), ("PEDIDO_VOLUNTARIO", "Pedido voluntário"),
            ("FALECIMENTO", "Falecimento"), ("CONDUTA_INCOMPATIVEL", "Conduta incompatível com o estatuto"),
            ("MUDANCA_DE_CIDADE", "Mudança de cidade"),
        ]),
        # v1.4 - motivo de licença, mesmo padrão de motivo_desligamento (catálogo editável, não texto livre).
        "motivo_licenca": ("Motivo de licença", True, "associados", [
            ("SAUDE", "Saúde"), ("MOTIVO_PESSOAL", "Motivo pessoal"),
            ("MUDANCA_TEMPORARIA", "Mudança temporária de cidade"), ("ESTUDO", "Estudo"),
        ]),
        "tipo_projeto": ("Tipo de projeto", True, "projetos", [
            ("ASSISTENCIAL", "Assistencial"), ("EDUCACIONAL", "Educacional"), ("CULTURAL", "Cultural"),
            ("ESPORTIVO", "Esportivo"), ("SAUDE", "Saúde"),
        ]),
        "tipo_evento": ("Tipo de evento", True, "projetos", [
            ("ASSEMBLEIA", "Assembleia"), ("REUNIAO_DE_DIRETORIA", "Reunião de Diretoria"), ("CULTO", "Culto"),
            ("CONFRATERNIZACAO", "Confraternização"), ("ACAO_SOCIAL", "Ação Social"), ("PALESTRA", "Palestra"),
        ]),
        "tipo_protocolo": ("Tipo de protocolo", True, "projetos", [
            ("SOLICITACAO_DE_DOCUMENTO", "Solicitação de Documento"), ("RECLAMACAO", "Reclamação"),
            ("SUGESTAO", "Sugestão"), ("DENUNCIA", "Denúncia"),
            ("REQUERIMENTO_ADMINISTRATIVO", "Requerimento Administrativo"),
        ]),
        "tipo_requerimento": ("Tipo de requerimento", True, "projetos", [
            ("ALTERACAO_CADASTRAL", "Alteração Cadastral"), ("SEGUNDA_VIA_DE_CARTEIRINHA", "Segunda Via de Carteirinha"),
            ("ISENCAO_DE_MENSALIDADE", "Isenção de Mensalidade"), ("LICENCA_TEMPORARIA", "Licença Temporária"),
            ("DESLIGAMENTO", "Desligamento"),
        ]),
        # v2.9 - o estatuto não define cadência de reunião de Diretoria/Conselho Fiscal (Art. 20
        # lista competências, não frequência) - por isso vira categoria de evento genérico
        # agendável pela diretoria, em vez de uma regra automática inventada.
        "categoria_evento_calendario": ("Categoria de evento do calendário", True, "governanca", [
            ("REUNIAO_DIRETORIA", "Reunião de Diretoria"),
            ("REUNIAO_CONSELHO_FISCAL", "Reunião do Conselho Fiscal"),
            ("DATA_INSTITUCIONAL", "Data institucional"),
            ("OUTRO", "Outro"),
        ]),
        # v2.7 (Art. 16, §1º do estatuto) - motivos de abertura de processo disciplinar. Catálogo
        # editável - a diretoria pode ajustar o rótulo, nunca remover o que o estatuto já lista.
        "motivo_processo_disciplinar": ("Motivo de processo disciplinar", True, "governanca", [
            ("DESIDIA", "Desídia no desempenho das atividades associativas"),
            ("VIOLACAO_ESTATUTO", "Violação do estatuto social"),
            ("DIFAMACAO", "Difamação da ASAF, de sócios ou dos órgãos de direção"),
            ("COMPORTAMENTO_ANTISSOCIAL", "Comportamento antissocial ou quebra das regras de convivência"),
            ("INADIMPLENCIA_6_MENSALIDADES", "Falta de pagamento de 6 mensalidades consecutivas"),
        ]),
        # v3.2 - periodicidade de um `PlanoDeContribuicao` (mensalidade). Catálogo editável -
        # entra "Trimestral"/"Semestral" sem deploy se a diretoria decidir cobrar diferente.
        "periodicidade_contribuicao": ("Periodicidade de contribuição", True, "financeiro", [
            ("MENSAL", "Mensal"), ("ANUAL", "Anual"),
        ]),
        # v3.2 - motivo de isenção/desconto de contribuição, sempre de catálogo (nunca texto
        # livre solto) - mesmo espírito de `motivo_desligamento`/`motivo_licenca` (v0.3.2).
        "motivo_isencao_contribuicao": ("Motivo de isenção de contribuição", True, "financeiro", [
            ("DIFICULDADE_FINANCEIRA", "Dificuldade financeira comprovada"), ("FUNDADOR", "Associado fundador"),
            ("DIRETORIA", "Membro da diretoria em exercício"), ("OUTRO", "Outro"),
        ]),
        "unidade_medida_indicador": ("Unidade de medida de indicador", True, "projetos", [
            ("UNIDADE", "Unidade"), ("PERCENTUAL", "Percentual"), ("REAL", "Real (R$)"),
            ("QUILOGRAMA", "Quilograma"), ("HORA", "Hora"), ("PESSOA", "Pessoa"),
        ]),
    }
    db = SessaoLocal()
    try:
        for chave, (nome_exibido, editavel_pelo_usuario, permissao_gerenciamento, opcoes) in catalogos_padrao.items():
            if db.query(Catalogo).filter(Catalogo.chave == chave).first():
                continue
            catalogo = Catalogo(
                chave=chave, nome_exibido=nome_exibido, editavel_pelo_usuario=editavel_pelo_usuario,
                permissao_gerenciamento=permissao_gerenciamento,
            )
            db.add(catalogo)
            db.flush()
            for i, opcao in enumerate(opcoes):
                codigo, rotulo, *resto = opcao
                metadados = resto[0] if resto else None
                db.add(OpcaoCatalogo(
                    id_catalogo=catalogo.id_catalogo, codigo=codigo, rotulo=rotulo, ordem=i,
                    metadados=metadados or None,
                ))
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
        {"modulo": "associados", "codigo_permissao": "exportar_dados_pessoais", "descricao": "Exportar dado pessoal de associados em massa (v1.3 - separada de 'associados' de propósito)."},
        {"modulo": "associados", "codigo_permissao": "forcar_cadastro_duplicado", "descricao": "Cadastrar associado mesmo quando o sistema sinaliza um cadastro parecido já existente (v1.8 - separada de 'associados' de propósito, só quem decide sobre duplicidade tem)."},
    ]
    # Nível -> lista de códigos de permissão que ele recebe por padrão (ajustável depois pela
    # própria tela de administração de acesso, isto aqui é só ponto de partida).
    atribuicoes_padrao = {
        "Presidente": ["gerenciar_acesso", "associados", "financeiro", "governanca", "projetos", "auditoria", "exportar_dados_pessoais", "forcar_cadastro_duplicado"],
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
        # v3.2 - Pix ESTÁTICO (ver app/services/pix.py): as três chaves que o BR Code exige.
        # Nenhuma API de banco/PSP envolvida - só o dado público da própria chave Pix da ASAF.
        {"chave": "CHAVE_PIX", "valor": "", "tipo": "texto", "categoria": "financeiro", "descricao": "Chave Pix da instituição (CNPJ, e-mail, telefone ou aleatória) usada para gerar o Pix Copia e Cola das cobranças."},
        {"chave": "NOME_BENEFICIARIO_PIX", "valor": "", "tipo": "texto", "categoria": "financeiro", "descricao": "Nome do beneficiário exibido no Pix (máx. 25 caracteres, sem acento - o BR Code corta e normaliza automaticamente)."},
        {"chave": "CIDADE_BENEFICIARIO_PIX", "valor": "", "tipo": "texto", "categoria": "financeiro", "descricao": "Cidade do beneficiário exibida no Pix (máx. 15 caracteres, sem acento)."},
        {"chave": "FUSO_HORARIO", "valor": "America/Sao_Paulo", "tipo": "texto", "categoria": "geral", "descricao": "Fuso horário usado em datas de documento e agendamento."},
        {"chave": "EMAIL_REMETENTE", "valor": "", "tipo": "email", "categoria": "geral", "descricao": "E-mail usado como remetente de notificações do sistema."},
        {"chave": "TEXTO_PADRAO_DOCUMENTO", "valor": "", "tipo": "texto", "categoria": "documentos", "descricao": "Texto padrão (rodapé/aviso legal) incluído nos documentos gerados."},
        {"chave": "PRAZO_CONVOCACAO_DIAS", "valor": "15", "tipo": "numero", "categoria": "regras", "descricao": "Dias mínimos de antecedência para convocação de assembleia (Art. 8º do estatuto - ver ESTATUTO_ASAF.txt)."},
        {"chave": "DIAS_TOLERANCIA_INADIMPLENCIA", "valor": "30", "tipo": "numero", "categoria": "regras", "descricao": "Dias de atraso tolerados antes de marcar associado como inadimplente."},
        {"chave": "TETO_ALCADA_FINANCEIRA", "valor": "1000", "tipo": "numero", "categoria": "regras", "descricao": "Valor máximo (R$) que a Diretoria aprova sem submeter à Assembleia."},
        {"chave": "PRAZO_EXPERIENCIA_DIAS", "valor": "90", "tipo": "numero", "categoria": "regras", "descricao": "Dias de experiência de um novo associado antes de virar Ativo pleno (0 = sem período de experiência)."},
        {"chave": "PRAZO_RETENCAO_DESLIGADO_DIAS", "valor": "1825", "tipo": "numero", "categoria": "regras", "descricao": "Dias após o desligamento antes do dado pessoal sensível ser anonimizado (padrão 5 anos - LGPD; ajustar conforme orientação contábil/jurídica real da associação). Nome, matrícula e todo dado financeiro nunca são apagados."},
        {"chave": "PRAZO_RECADASTRAMENTO_DIAS", "valor": "365", "tipo": "numero", "categoria": "regras", "descricao": "Dias desde a última confirmação de dados cadastrais antes do cadastro ser sinalizado para recadastramento (v1.8)."},
        # v3.2.1 (adaptado) - lembrete automático de mensalidade por e-mail (ver
        # app/services/lembretes.py) - quantos dias antes do vencimento o primeiro lembrete sai
        # (o segundo sempre sai no próprio dia do vencimento, não configurável).
        {"chave": "DIAS_LEMBRETE_MENSALIDADE", "valor": "5", "tipo": "numero", "categoria": "regras", "descricao": "Dias antes do vencimento em que o lembrete automático de mensalidade (e-mail com Pix pronto) é enviado."},
        # v3.2.2 - régua de cobrança escalonada pós-vencimento (ver app/services/lembretes.py) -
        # lista de dias de atraso (separados por vírgula) em que um aviso mais urgente sai,
        # multicanal fica pra FASE 11/v11.3 (só e-mail por enquanto, mesmo canal do resto).
        {"chave": "DIAS_ATRASO_LEMBRETE", "valor": "7,15,30", "tipo": "texto", "categoria": "regras", "descricao": "Dias de atraso (separados por vírgula) em que um lembrete escalonado de cobrança é enviado após o vencimento."},
        # v3.3 - fluxo de compras (ver app/services/compras.py) - acima deste valor, a solicitação
        # exige ao menos duas cotações registradas antes de poder ser aprovada.
        {"chave": "VALOR_MINIMO_EXIGE_COTACAO", "valor": "1000", "tipo": "numero", "categoria": "regras", "descricao": "Valor (R$) a partir do qual uma solicitação de compra exige ao menos duas cotações antes de aprovação."},
        # v3.5 - fluxo de caixa projetado (ver app/services/orcamento.py) - quantos meses à
        # frente a projeção olha por padrão quando ninguém informa `horizonte_meses` na chamada.
        {"chave": "HORIZONTE_FLUXO_CAIXA_MESES", "valor": "3", "tipo": "numero", "categoria": "regras", "descricao": "Quantidade padrão de meses à frente que o fluxo de caixa projetado calcula quando nenhum horizonte é informado."},
        # v2.0 - cláusulas pétreas do Art. 33 do estatuto: identidade institucional, não regra
        # operacional (nunca bloqueiam nenhuma ação do sistema, por isso NÃO entram em
        # RegraEstatutaria - ver seed_regras_estatutarias e PLANO_PROJETO.md v2.0).
        {"chave": "DATA_MAGNA", "valor": "10/02", "tipo": "texto", "categoria": "identidade", "descricao": "Data magna da ASAF, aniversário de fundação (Art. 33, I - cláusula pétrea)."},
        {"chave": "VERSICULOS_BASE", "valor": "II Crônicas 4:9-10", "tipo": "texto", "categoria": "identidade", "descricao": "Versículos-base existencial da ASAF (Art. 33, II - cláusula pétrea)."},
        {"chave": "ORACAO_OFICIAL", "valor": "O Senhor nos abençoe muitíssimo; Alargue as nossas fronteiras! Que a tua mão esteja conosco, Guarda-nos de todo mal.", "tipo": "texto", "categoria": "identidade", "descricao": "Oração oficial da ASAF (Art. 33, III - cláusula pétrea)."},
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


def seed_regras_estatutarias():
    """v2.0 (FASE 2) - seed inicial de `RegraEstatutaria` com os valores REAIS do estatuto
    vigente da ASAF (`ESTATUTO_ASAF.txt`, recebido do usuário em 2026-09-15, registrado em
    cartório - Comarca de Parauapebas/PA, Livro A-17/A-18, 23/05/2013). Só semeia o parâmetro
    que ainda não tiver nenhuma linha vigente (nunca sobrescreve reforma feita depois pela
    diretoria via /api/estatuto/regras/{parametro}) - mesmo raciocínio dos demais seeds.
    Cláusulas pétreas do Art. 33 (data magna, versículos-base, oração oficial) NÃO entram aqui
    de propósito: são identidade institucional, não regra operacional - ver
    seed_configuracoes_institucionais."""
    from app.models.estatuto import DocumentoEstatuto, RegraEstatutaria  # import local, mesmo motivo dos seeds acima

    db = SessaoLocal()
    try:
        documento = db.query(DocumentoEstatuto).filter(DocumentoEstatuto.vigente.is_(True)).first()
        if documento is None:
            documento = DocumentoEstatuto(
                versao="2013",
                numero_registro_cartorio="Livro A-17/A-18",
                comarca_registro="Comarca de Parauapebas/PA",
                data_registro=datetime(2013, 5, 23),
                caminho_arquivo="ESTATUTO_ASAF.txt",
                vigente=True,
            )
            db.add(documento)
            db.flush()

        regras_padrao = [
            {"parametro": "QUORUM_1A_CONVOCACAO", "valor": "2/3", "tipo": "fracao", "artigo_origem": "Art. 6º",
             "descricao": "Fração dos associados aptos exigida para instalar a Assembleia Geral em primeira convocação."},
            {"parametro": "QUORUM_2A_CONVOCACAO", "valor": "1/2+1", "tipo": "fracao", "artigo_origem": "Art. 6º",
             "descricao": "Quórum de instalação em segunda convocação, meia hora após a primeira."},
            {"parametro": "QUORUM_3A_CONVOCACAO", "valor": "1/4", "tipo": "fracao", "artigo_origem": "Art. 6º",
             "descricao": "Quórum de instalação em terceira convocação, meia hora após a segunda."},
            {"parametro": "QUORUM_DELIBERACAO_PADRAO", "valor": "maioria_simples", "tipo": "texto", "artigo_origem": "Art. 6º",
             "descricao": "Forma de deliberação padrão: maioria simples dos votos dos associados aptos presentes, salvo exceção estatutária (ex.: dissolução, Art. 31)."},
            {"parametro": "QUORUM_DISSOLUICAO_1A_CONVOCACAO", "valor": "totalidade", "tipo": "texto", "artigo_origem": "Art. 31",
             "descricao": "Quórum de instalação da assembleia de dissolução em primeira chamada: totalidade dos associados."},
            {"parametro": "QUORUM_DISSOLUICAO_2A_CONVOCACAO", "valor": "1/3", "tipo": "fracao", "artigo_origem": "Art. 31",
             "descricao": "Quórum de instalação da assembleia de dissolução em segunda chamada, uma hora após a primeira."},
            {"parametro": "QUORUM_DISSOLUICAO_APROVACAO", "valor": "2/3", "tipo": "fracao", "artigo_origem": "Art. 31",
             "descricao": "Fração dos presentes exigida para deliberar a dissolução da ASAF."},
            {"parametro": "PRAZO_ATENDIMENTO_PEDIDO_CONVOCACAO_DIAS", "valor": "30", "tipo": "numero", "artigo_origem": "Art. 10, Parágrafo Único",
             "descricao": "Dias que o Presidente tem para convocar assembleia após pedido formal de associado; findo o prazo, os próprios associados podem convocar (efeito automático - v2.2)."},
            {"parametro": "FRACAO_MINIMA_PETICAO_CONVOCACAO", "valor": "1/5", "tipo": "fracao", "artigo_origem": "Art. 8º / Art. 10",
             "descricao": "Fração mínima dos associados ativos com direito de convocar Assembleia Geral por petição (bate com o Art. 60 do Código Civil)."},
            {"parametro": "DURACAO_MANDATO_ANOS", "valor": "4", "tipo": "numero", "artigo_origem": "Art. 25 / Art. 32",
             "descricao": "Duração, em anos, do mandato eletivo dos órgãos de direção da ASAF."},
            {"parametro": "LIMITE_MANDATOS_CONSECUTIVOS", "valor": "ilimitado", "tipo": "texto", "artigo_origem": "Art. 32",
             "descricao": "Limite de reeleições consecutivas - o estatuto real não impõe trava nenhuma (\"podendo qualquer dos seus membros serem conduzidos para mandatos subsequentes\")."},
            {"parametro": "PROCURACAO_PERMITIDA", "valor": "nao", "tipo": "booleano", "artigo_origem": "Art. 7º",
             "descricao": "Se procuração/representação de um associado por outro vale para quórum ou voto. Hoje SEMPRE vedada pelo estatuto vigente - parâmetro existe pra quando uma reforma futura mudar isso (v2.2)."},
            {"parametro": "IDADE_MINIMA_FILIACAO_ANOS", "valor": "18", "tipo": "numero", "artigo_origem": "Art. 12",
             "descricao": "Idade mínima geral para filiação à ASAF."},
            {"parametro": "IDADE_MINIMA_FILIACAO_COM_AUTORIZACAO_ANOS", "valor": "16", "tipo": "numero", "artigo_origem": "Art. 12",
             "descricao": "Idade mínima para filiação com autorização expressa dos pais/responsáveis (abaixo da idade geral)."},
            {"parametro": "QTD_SOCIOS_PROPONENTES_FILIACAO", "valor": "3", "tipo": "numero", "artigo_origem": "Art. 12, Parágrafo Único, VI",
             "descricao": "Quantidade de associados que devem propor por escrito o pedido de adesão de um novo sócio."},
            {"parametro": "QTD_MENSALIDADES_INADIMPLENCIA_EXCLUSAO", "valor": "6", "tipo": "numero", "artigo_origem": "Art. 16, §1º, V",
             "descricao": "Mensalidades consecutivas em atraso que configuram motivo de abertura de processo disciplinar com possível exclusão (nunca automática - exige processo com ampla defesa, v2.7)."},
            # v2.2 - intervalo entre convocações da mesma assembleia (1ª->2ª->3ª chamada),
            # adicionado depois da v2.0 mas seguindo o mesmo seed (idempotente por parâmetro,
            # não por catálogo inteiro - por isso entra aqui mesmo já existindo produção rodando).
            {"parametro": "INTERVALO_ENTRE_CONVOCACOES_MINUTOS", "valor": "30", "tipo": "numero", "artigo_origem": "Art. 6º",
             "descricao": "Minutos entre a 1ª e a 2ª convocação, e entre a 2ª e a 3ª, dentro da mesma sessão de assembleia."},
            # v2.4 - SEM base no estatuto (Art. 1º-35 não menciona empate nem impugnação de voto);
            # necessidade operacional da votação precisar sempre terminar em algum resultado,
            # não mandato estatutário - por isso sem `artigo_origem` (None), diferente de todo
            # outro parâmetro desta lista.
            {"parametro": "REGRA_DESEMPATE", "valor": "NOVA_VOTACAO", "tipo": "texto", "artigo_origem": None,
             "descricao": "Como resolver empate no resultado de uma votação - sem previsão estatutária. \"NOVA_VOTACAO\" é o único valor que o sistema resolve sozinho hoje; qualquer outro valor fica registrado mas exige resolução manual (POST /api/votacoes/{id}/resolver-empate)."},
            {"parametro": "PRAZO_RECURSO_IMPUGNACAO_DIAS", "valor": "5", "tipo": "numero", "artigo_origem": None,
             "descricao": "Dias para recorrer de uma impugnação de voto - sem previsão estatutária específica (apoia-se no direito geral de recurso do Art. 13, V)."},
            # v2.7 - SEM base no estatuto: Art. 16 exige "ampla defesa e contraditório" mas não
            # diz quantos dias - confirmado com o usuário em 15, por consistência com o prazo de
            # convocação de assembleia (Art. 8º), não porque o Art. 16 defina esse número.
            {"parametro": "PRAZO_DEFESA_DIAS", "valor": "15", "tipo": "numero", "artigo_origem": None,
             "descricao": "Dias que o associado tem para apresentar defesa após ser notificado de processo disciplinar (Art. 16 exige ampla defesa, mas não define o prazo - decisão operacional confirmada com a diretoria)."},
            {"parametro": "SUSPENSAO_DISCIPLINAR_PADRAO_DIAS", "valor": "30", "tipo": "numero", "artigo_origem": "Art. 17, II",
             "descricao": "Duração padrão da pena de suspensão quando o julgamento não especifica outro valor - o estatuto admite de 30 dias a 1 ano (365 dias); 30 é o piso do próprio artigo, usado como padrão menos gravoso."},
            {"parametro": "ANOS_MINIMOS_ENTIDADE_DESTINATARIA_PATRIMONIO", "valor": "2", "tipo": "numero", "artigo_origem": "Art. 31, Parágrafo Único",
             "descricao": "Anos mínimos de existência exigidos da entidade congênere que recebe o patrimônio remanescente em caso de dissolução, além de ter sede/atividade preponderante em Parauapebas/PA e estar credenciada pelos órgãos competentes."},
            # v2.9 - achado do Ponto de Revisão FASE 2 (3/3): `proximas_ago` (calendário
            # institucional) tinha os meses da AGO semestral (fevereiro/agosto) fixos em código,
            # violando o mesmo princípio de perpetuidade que gerou toda esta lista (v2.0).
            {"parametro": "MESES_AGO_ESTATUTARIA", "valor": "2,8", "tipo": "texto", "artigo_origem": "Art. 5º, I",
             "descricao": "Meses (1-12, separados por vírgula) em que a Assembleia Geral Ordinária semestral acontece, primeira quinzena de cada um."},
        ]

        for r in regras_padrao:
            ja_vigente = db.query(RegraEstatutaria).filter(
                RegraEstatutaria.parametro == r["parametro"], RegraEstatutaria.vigencia_fim.is_(None)
            ).first()
            if ja_vigente:
                continue
            db.add(RegraEstatutaria(
                parametro=r["parametro"], valor=r["valor"], tipo=r["tipo"], categoria="regras",
                descricao=r["descricao"], artigo_origem=r["artigo_origem"],
                id_documento_estatuto=documento.id_documento_estatuto,
                vigencia_inicio=documento.data_registro or datetime.utcnow(),
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
