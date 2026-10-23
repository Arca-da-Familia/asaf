"""v7.0c (FASE 7) - o INVENTÁRIO DE DADOS: o registro das operações de tratamento (LGPD, art. 37), vivo no sistema.

Seções do modelo simplificado da ANPD para agentes de pequeno porte (Resolução CD/ANPD nº 2/2022, art. 9º; modelo publicado em 2023): titulares, dados (e se há
sensível ou de criança), finalidade, base legal, compartilhamento, medidas de segurança, período de armazenamento, observações.

O que é FATO DO SISTEMA vem do código e não se edita na tela: as tabelas de cada atividade (cobertas pela classificação da v7.0b: tabela nova com dado pessoal sem
atividade reprova a suíte e aparece como pendência), os titulares, as colunas pessoais e sensíveis, se pode ter criança, onde fica guardado e o prazo de guarda
LIDO DA REGRA DE RETENÇÃO EM VIGOR (ou "sem rotina automática ainda", dito com todas as letras). Com quem se compartilha (os operadores) também é fato: vem do
código e de testes que conferem as rotinas do GitHub e os envios de e-mail. O que é DECISÃO da associação (finalidade, base legal, medidas, observações e se o
encarregado conferiu a base legal) nasce como proposta do sistema e o encarregado ajusta: cada gravação é uma versão nova (app/models/privacidade.py::
VersaoDeAtividadeDeTratamento) que guarda SÓ o que ficou diferente da proposta (o que ele não mudou acompanha o código), com Auditoria e conferência da versão
de partida (quem salva sobre uma versão velha recebe 409). A base legal é PROPOSTA até o encarregado marcar que conferiu (a v7.1 trata a
base legal por finalidade a fundo)."""
import csv
import io
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import classificacao_de_dados as cl
from app.models.core import Usuario
from app.models.privacidade import VersaoDeAtividadeDeTratamento
from app.services import encarregado as servico_encarregado
from app.services import pdf_de_texto, retencao
from app.services.fuso import dia_e_hora_em_belem

# ---------------------------------------------------------------------------------------- as hipóteses da lei (texto da Lei nº 13.709/2018, conferido no Planalto)
BASES_LEGAIS: dict[str, str] = {
    "ART7_I": "Art. 7º, I — consentimento do titular",
    "ART7_II": "Art. 7º, II — cumprimento de obrigação legal ou regulatória pelo controlador",
    "ART7_V": "Art. 7º, V — execução de contrato ou de procedimentos preliminares relacionados a contrato do qual seja parte o titular, a pedido do titular",
    "ART7_VI": "Art. 7º, VI — exercício regular de direitos em processo judicial, administrativo ou arbitral",
    "ART7_VII": "Art. 7º, VII — proteção da vida ou da incolumidade física do titular ou de terceiro",
    "ART7_IX": "Art. 7º, IX — interesses legítimos do controlador ou de terceiro (salvo se prevalecerem direitos e liberdades fundamentais do titular)",
    "ART7_X": "Art. 7º, X — proteção do crédito",
    "ART11_I": "Art. 11, I — consentimento específico e destacado do titular ou do responsável legal (dado sensível)",
    "ART11_II_A": "Art. 11, II, a — cumprimento de obrigação legal ou regulatória (dado sensível)",
    "ART11_II_D": "Art. 11, II, d — exercício regular de direitos, inclusive em contrato (dado sensível)",
    "ART11_II_E": "Art. 11, II, e — proteção da vida ou da incolumidade física (dado sensível)",
    "ART11_II_G": "Art. 11, II, g — prevenção à fraude e segurança do titular na identificação e autenticação (dado sensível)",
}

# Criança e adolescente: o art. 14 não é base legal, é REQUISITO (Enunciado CD/ANPD nº 1/2023: vale qualquer hipótese do art. 7º ou do art. 11, desde que
# observado e prevalecente o melhor interesse); se a base for o consentimento, o de criança é dado por um dos pais ou pelo responsável (art. 14, § 1º)
REQUISITO_CRIANCA = (
    "Art. 14: o tratamento é feito no melhor interesse da criança e do adolescente (Enunciado CD/ANPD nº 1/2023); quando a base é o consentimento, o de "
    "criança é dado por pelo menos um dos pais ou pelo responsável legal (art. 14, § 1º)"
)

# ---------------------------------------------------------------------------------------- com quem (operadores) e onde (conferido na infraestrutura em 2026-10-23)
OPERADORES: dict[str, dict] = {
    "AZURE": {
        "nome": "Microsoft (Azure)",
        "o_que_faz": "hospeda a API, o banco de dados, os arquivos privados, o cofre de segredos e o registro de erros do sistema",
        "onde": "Brasil (região Brazil South); uma cópia das cópias de segurança do banco (35 dias) e uma réplica dos arquivos privados ficam na região par, "
                "South Central US (Estados Unidos); as páginas do site e do painel são publicadas por um serviço registrado na região Central US (Estados Unidos)",
        "fora_do_brasil": True,
    },
    "GITHUB": {
        "nome": "GitHub (Microsoft)",
        "o_que_faz": "executa as rotinas agendadas que leem o banco e agem sobre ele (prazos de guarda, lembretes, avisos, vagas de evento) e monta e publica o "
                     "site a partir do que é público (Diretoria, fotos de evento e de parceria, documentos aprovados, notícias)",
        "onde": "servidores do GitHub, fora do Brasil, enquanto a rotina ou a montagem do site roda",
        "fora_do_brasil": True,
    },
    "GOOGLE": {
        "nome": "Google (Google Workspace)",
        "o_que_faz": "envia os e-mails do sistema e guarda a caixa asaf@asaf.org.br",
        "onde": "servidores do Google, que podem ficar fora do Brasil",
        "fora_do_brasil": True,
    },
}

ARMAZENAMENTO_BANCO = "Banco de dados PostgreSQL no Microsoft Azure (Brasil, região Brazil South), com cópias de segurança por 35 dias na região South Central US (Estados Unidos)"
ARMAZENAMENTO_ARQUIVOS = "Arquivos no armazenamento privado do Microsoft Azure (Brasil, região Brazil South), com réplica na região South Central US (Estados Unidos)"

ARMAZENAMENTO_SITE = (
    "O que é público vai também ao site (montado no GitHub e publicado por serviço do Azure registrado na região Central US, Estados Unidos)"
)

MEDIDAS_GERAIS = (
    "Acesso só pelo painel, com login e permissão por função (privilégio mínimo); segundo passo (MFA) para a Presidência e a Diretoria; conexão cifrada (HTTPS); "
    "banco protegido por firewall (só serviços do Azure e os endereços da administração) e conexão cifrada; segredos no cofre do Azure; toda alteração e toda "
    "exportação registrada na Auditoria"
)


@dataclass(frozen=True)
class Atividade:
    codigo: str
    nome: str
    finalidade: str
    bases_legais: tuple[str, ...]
    operadores: tuple[str, ...]
    tabelas: tuple[str, ...] = ()
    regras_de_retencao: tuple[str, ...] = ()
    arquivos: bool = False
    medidas: str = ""
    observacoes: str = ""
    so_rastro_de_operacao: bool = False  # cobre as tabelas cujo único dado de pessoa é QUEM registrou (o usuário do painel)
    prazos_fixos: tuple[str, ...] = ()  # limpeza técnica que não é regra editável (o código do visitante vencido, por exemplo)
    publicado_no_site: bool = False  # parte do que é público vai ao site
    tabelas_externas: tuple[str, ...] = ()  # dado de pessoa fora do modelo deste sistema (o Directus, editor do site)


ATIVIDADES: tuple[Atividade, ...] = (
    Atividade(
        "CADASTRO", "Cadastro e vida associativa",
        "Manter o livro de associados e a ficha de cada um (dados pessoais, contato, endereço, família, documentos, situação, histórico), receber e decidir as "
        "propostas de filiação e cumprir o Estatuto.",
        ("ART7_V", "ART7_II", "ART7_IX", "ART11_II_D"), ("AZURE", "GITHUB", "GOOGLE"),
        ("pessoas", "papeis", "associados", "enderecos", "dependentes_familiares", "documentos_anexos", "historico_cargos", "mudancas_situacao",
         "eventos_linha_do_tempo", "fila_revisao_cadastro", "valores_campo", "lotes_importacao", "propostas_filiacao", "propostas_de_socios"),
        ("associado_desligado", "propostas_de_filiacao"), arquivos=True,
        medidas="Anonimização automática do desligado no prazo; a leitura do histórico de situação (que pode ter motivo de saúde) vai para a Auditoria; "
                "exportação em massa com permissão própria.",
        observacoes="Membros a partir de 16 anos (Estatuto, art. 12): o cadastro pode ter adolescente. Dependentes são cadastrados pelo associado (base: interesse legítimo, a conferir).",
    ),
    Atividade(
        "FINANCEIRO", "Contribuições, cobranças e reembolsos",
        "Gerar e cobrar as contribuições dos associados, registrar isenções, negociações, créditos e reembolsos, e prestar contas ao Conselho Fiscal.",
        ("ART7_V", "ART7_II"), ("AZURE", "GITHUB", "GOOGLE"),
        ("titulos_financeiros", "isencoes_contribuicao", "isencoes_taxa_contexto", "negociacoes_divida", "creditos_associado", "reembolsos_despesa",
         "auditorias_de_titulo", "questionamentos_lancamento", "aprovacoes_compra", "delegacoes_aprovacao"),
        arquivos=True,
        medidas="Dupla aprovação nas alçadas; o Conselho Fiscal audita sem operar; o lançamento contábil não se apaga.",
    ),
    Atividade(
        "GOVERNANCA", "Assembleias, votações, Diretoria e Conselho Fiscal",
        "Convocar e registrar assembleias, credenciamento, votações, atas e deliberações; registrar os mandatos, as declarações de conflito de interesse, os "
        "processos disciplinares e a foto da Diretoria publicada no site (com autorização de imagem).",
        ("ART7_II", "ART7_V", "ART7_I"), ("AZURE", "GITHUB"),
        ("adesoes_peticao", "comprovantes_voto_secreto", "credenciamentos_assembleia", "deliberacoes", "habilitados_assembleia", "impugnacoes_votacao",
         "justificativas_falta_assembleia", "mandatos", "declaracoes_conflito_interesse", "votos_abertos", "atas", "ocorrencias_sessao",
         "pareceres_prestacao_contas", "fotos_da_diretoria", "processos_disciplinares", "manifestacoes_diretoria_disciplinar"),
        arquivos=True, publicado_no_site=True,
        medidas="O voto secreto não é ligado a quem votou; a foto da Diretoria só com autorização e apagada ao fim do mandato.",
    ),
    Atividade(
        "PROJETOS_EVENTOS", "Projetos, eventos e inscrições",
        "Organizar projetos e eventos, receber inscrições (inclusive pelo site), registrar presença, emitir crachá e certificado, pesquisa de satisfação, "
        "reserva de espaço e fotos das atividades.",
        ("ART7_V", "ART7_IX", "ART7_I"), ("AZURE", "GITHUB", "GOOGLE"),
        ("projetos_eventos", "equipe_projeto", "itens_cronograma_projeto", "eventos", "inscricoes", "registros_presenca", "respostas_pesquisa_satisfacao",
         "fotos_evento", "documentos_emitidos", "reservas_espaco"),
        arquivos=True, publicado_no_site=True,
        medidas="A foto de evento só vai ao site com autorização e com o evento público; exportação de inscritos e de presença com permissão própria.",
        observacoes="Inscrição de família pode ter criança. As perguntas livres do formulário de inscrição não devem pedir dado sensível.",
    ),
    Atividade(
        "BENEFICIARIOS", "Atendimento social a beneficiários",
        "Acompanhar as famílias e as crianças atendidas nos projetos: vínculo ao projeto, prontuário de atendimento e encaminhamento à rede externa (CRAS, "
        "escola, posto de saúde, Conselho Tutelar).",
        ("ART11_I", "ART7_I"), ("AZURE",),
        ("beneficiarios", "beneficiarios_projeto", "registros_atendimento", "encaminhamentos_rede_externa"),
        medidas="Prontuário e encaminhamentos só para a equipe ATIVA do projeto, inclusive para a Presidência; toda leitura vai para a Auditoria; o valor "
                "sensível não fica na Auditoria; exportação com permissão própria.",
        observacoes="Tratamento de alto risco (dado sensível e de criança): o relatório de impacto (RIPD) é a v7.0d.",
    ),
    Atividade(
        "VOLUNTARIADO", "Voluntários e funcionários",
        "Registrar o termo de adesão do voluntário (Lei nº 9.608/1998), a escala, as horas e as trocas de turno, e o cadastro de funcionários.",
        ("ART7_II", "ART7_V"), ("AZURE",),
        ("termos_adesao_voluntario", "alocacoes_voluntarios", "registros_horas_voluntariado", "trocas_turno_voluntario", "funcionarios"),
        observacoes="Voluntário adolescente só com autorização do responsável (registrada no termo).",
    ),
    Atividade(
        "DOACOES", "Doações e recibos",
        "Receber doações (inclusive o pedido pelo site com Pix), confirmar, emitir o recibo numerado e prestar contas das campanhas.",
        ("ART7_V", "ART7_II", "ART7_I"), ("AZURE", "GITHUB", "GOOGLE"),
        ("doacoes", "intencoes_de_doacao"), ("intencoes_de_doacao", "doador_identificado"),
        medidas="A doação sem se identificar não grava nome nem contato (o IP fica no registro técnico de acesso, da atividade Acesso); o pedido pelo site tem "
                "limite de pedidos por hora.",
    ),
    Atividade(
        "ATENDIMENTO", "Pedidos pelo site e direitos do titular",
        "Responder contato, pedido de informação, oferta de voluntariado e as solicitações do titular de dados (LGPD, art. 18), com protocolo e prazo.",
        ("ART7_V", "ART7_II", "ART7_IX"), ("AZURE", "GITHUB", "GOOGLE"),
        ("atendimentos",), ("atendimentos",),
        medidas="A resposta ao pedido do titular (art. 18) só depois de conferida a identidade, e não vai por e-mail (só o aviso); as demais respostas vão por "
                "e-mail.",
    ),
    Atividade(
        "COMUNICACAO", "Avisos e e-mails da associação",
        "Publicar avisos no mural do painel e por e-mail, registrar quem recebeu, leu e confirmou, e respeitar a escolha de quem não quer e-mails opcionais.",
        ("ART7_V", "ART7_IX"), ("AZURE", "GITHUB", "GOOGLE"),
        ("avisos_destinatarios", "entregas_de_aviso", "notificacoes_painel", "preferencias_de_comunicacao"), ("avisos_do_sino", "leitura_de_avisos"),
        medidas="Descadastro por link assinado; o sistema não registra a abertura do e-mail.",
    ),
    Atividade(
        "ACESSO", "Acesso ao painel e segurança",
        "Autenticar quem entra no painel (senha, segundo passo, chave de acesso), recuperar a senha, limitar tentativas nos formulários públicos e manter a "
        "Auditoria de quem fez o quê.",
        ("ART7_IX", "ART7_II"), ("AZURE", "GITHUB", "GOOGLE"),
        ("usuarios", "tokens_acesso", "credenciais_webauthn", "codigos_de_nova_senha", "codigos_recuperacao_mfa", "tentativas_acesso_publico", "audit_log"),
        ("acessos",),
        medidas="Senha guardada só como impressão (hash); códigos de uso único com validade curta; a Auditoria não se apaga e não guarda valor sensível.",
        observacoes="A Auditoria ainda não tem prazo de guarda automático (v7.1).",
    ),
    Atividade(
        "VISITANTE", "Conta de visitante do site",
        "Deixar quem se inscreveu ou doou pelo site ver o que fez e pedir a eliminação, entrando com um código enviado ao e-mail.",
        ("ART7_V", "ART7_IX"), ("AZURE", "GITHUB", "GOOGLE"),
        ("codigos_de_visitante", "sessoes_de_visitante"),
        medidas="Código de 6 números, 10 minutos, uso único; só a impressão do código é guardada.",
        prazos_fixos=("Códigos e sessões vencidos: apagados em até 1 dia (limpeza técnica da rotina de retenção)",),
    ),
    Atividade(
        "TRANSPARENCIA", "Documentos, parcerias e transparência",
        "Guardar os documentos institucionais e os de parcerias e emendas (com a versão pública sem dado pessoal), as fotos das etapas de parceria e o ato do "
        "encarregado, e publicar no site o que a lei e o Estatuto pedem.",
        ("ART7_II", "ART7_IX"), ("AZURE", "GITHUB"),
        ("documentos_institucionais", "fotos_etapa_parceria", "atos_do_encarregado"),
        arquivos=True, publicado_no_site=True,
        medidas="O original fica privado; a versão pública passa pelo verificador de dado pessoal e pela aprovação de outra pessoa.",
    ),
    Atividade(
        "FORNECEDORES", "Fornecedores",
        "Cadastrar fornecedores (que podem ser pessoa física) e os dados bancários para pagamento.",
        ("ART7_V", "ART7_II"), ("AZURE", "GITHUB"),
        ("fornecedores", "dados_bancarios_fornecedor"),
        medidas="Dados bancários novos só valem depois de aprovados por outra pessoa.",
    ),
    Atividade(
        "SITE_EDITORIAL", "Notícias e conteúdo do site (Directus)",
        "Manter as contas de quem edita as notícias do site, o registro do que cada um fez e as fotos publicadas nas notícias.",
        ("ART7_IX", "ART7_V"), ("AZURE", "GITHUB", "GOOGLE"),
        tabelas_externas=("directus_users (nome e e-mail de quem edita)", "directus_activity (IP e navegador de cada ação)", "fotos das notícias (podem ter pessoas)"),
        arquivos=True, publicado_no_site=True,
        medidas="O Directus usa o mesmo servidor de banco, mas com usuário e área (schema) próprios, sem acesso aos dados do sistema; perfis de editor com "
                "privilégio mínimo.",
        observacoes="Fica fora do modelo deste sistema: as tabelas são do Directus.",
    ),
    Atividade(
        "OPERACAO", "Registro de quem faz cada operação no painel",
        "Guardar, em cada registro do sistema, quem o criou ou alterou, para a prestação de contas da gestão e a segurança.",
        ("ART7_IX",), ("AZURE",), so_rastro_de_operacao=True,
    ),
)

_POR_CODIGO = {a.codigo: a for a in ATIVIDADES}
EDITAVEIS = ("finalidade", "bases_legais", "medidas", "observacoes", "base_legal_conferida")

# Cada roteiro que as tarefas agendadas do GitHub rodam em PRODUÇÃO (.github/workflows/tarefa-*.yml e escalar-*.yml) e as atividades cujos dados ele lê ou muda
# (tests/test_inventario.py confere que a lista é a dos fluxos e que essas atividades citam o GitHub). A montagem do site (deploy-site.yml) também roda lá.
ROTINAS_DO_GITHUB: dict[str, tuple[str, ...]] = {
    "scripts/apagar_fotos_da_diretoria_vencidas.py": ("GOVERNANCA",),
    "scripts/aplicar_retencao_de_dados.py": ("ACESSO", "ATENDIMENTO", "CADASTRO", "DOACOES", "COMUNICACAO", "VISITANTE"),
    "scripts/avisar_fim_de_experiencia.py": ("CADASTRO",),
    "scripts/avisar_prazos_de_atendimento.py": ("ATENDIMENTO",),
    "scripts/enviar_emails_de_avisos.py": ("COMUNICACAO",),
    "scripts/enviar_lembretes_de_mensalidade.py": ("FINANCEIRO",),
    "scripts/escalar_api_por_evento.py": (),  # só lê a agenda pública de eventos
    "scripts/expirar_intencoes_de_doacao.py": ("DOACOES",),
    "scripts/expirar_promocoes_vagas.py": ("PROJETOS_EVENTOS",),
    "scripts/fechar_eventos_encerrados.py": ("PROJETOS_EVENTOS",),
    "scripts/publicar_avisos_agendados.py": ("COMUNICACAO",),
    "scripts/tarefa_mensal_financeiro.py": ("FINANCEIRO", "FORNECEDORES"),
    "montagem do site (deploy-site.yml)": ("GOVERNANCA", "PROJETOS_EVENTOS", "TRANSPARENCIA", "SITE_EDITORIAL"),
}

# Cada módulo que manda e-mail (app/services/notificacoes.py::enviar_email, pelo Google Workspace) e a atividade (o teste confere com o código)
ENVIOS_DE_EMAIL: dict[str, str] = {
    "atendimento": "ATENDIMENTO", "automaticos_de_associado": "CADASTRO", "conta_de_visitante": "VISITANTE", "doacao_online": "DOACOES",
    "envio_de_avisos": "COMUNICACAO", "modelos_de_aviso": "COMUNICACAO", "esqueci_a_senha": "ACESSO", "eventos": "PROJETOS_EVENTOS",
    "status_do_evento": "PROJETOS_EVENTOS", "vagas": "PROJETOS_EVENTOS", "lembretes": "FINANCEIRO",
}


def _rastro_de_operacao(inventario: list[dict]) -> list[str]:
    """As tabelas do inventário que NENHUMA atividade cita e cujo único dado de pessoa é quem registrou (o usuário do painel)."""
    citadas = {t for a in ATIVIDADES for t in a.tabelas}
    return [linha["tabela"] for linha in inventario if linha["tabela"] not in citadas and set(linha["titulares"]) <= {cl.USUARIO} and not linha["colunas_pessoais"]]


def tabelas_sem_atividade(inventario: Optional[list[dict]] = None) -> list[str]:
    """Tabelas com dado de pessoa que nenhuma atividade cobre (deve ser vazio: a suíte reprova; a tela mostra, se aparecer)."""
    inventario = inventario if inventario is not None else cl.inventario_do_modelo()
    cobertas = {t for a in ATIVIDADES for t in a.tabelas} | set(_rastro_de_operacao(inventario))
    return [linha["tabela"] for linha in inventario if linha["tabela"] not in cobertas]


def _proposta(a: Atividade) -> dict:
    return {
        "finalidade": a.finalidade, "bases_legais": sorted(a.bases_legais),
        "medidas": "; ".join(m for m in (MEDIDAS_GERAIS, a.medidas) if m) + ".", "observacoes": a.observacoes, "base_legal_conferida": False,
    }


def _vigentes(a: Atividade, versao: Optional[VersaoDeAtividadeDeTratamento]) -> dict:
    """A proposta do código com o que o encarregado ajustou por cima (a versão guarda só o que ficou diferente da proposta)."""
    return {**_proposta(a), **{k: v for k, v in (versao.campos if versao else {}).items() if k in EDITAVEIS}}


def _vigente(db: Session, codigo: str) -> Optional[VersaoDeAtividadeDeTratamento]:
    return db.query(VersaoDeAtividadeDeTratamento).filter(VersaoDeAtividadeDeTratamento.codigo_atividade == codigo).order_by(
        VersaoDeAtividadeDeTratamento.versao.desc()).first()


def _prazos(db: Session, a: Atividade) -> list[dict]:
    regras = {r.codigo: r for r in retencao.REGRAS}
    return [{"regra": c, "rotulo": regras[c].rotulo, "dias": retencao.dias_da_regra(db, regras[c])} for c in a.regras_de_retencao]


def _detalhar(db: Session, a: Atividade, inventario: list[dict]) -> dict:
    linhas = {linha["tabela"]: linha for linha in inventario}
    tabelas = list(a.tabelas) if not a.so_rastro_de_operacao else _rastro_de_operacao(inventario)
    das_tabelas = [linhas[t] for t in tabelas if t in linhas]
    versao = _vigente(db, a.codigo)
    campos = _vigentes(a, versao)
    pode_ter_crianca = any(linha["pode_ter_crianca"] for linha in das_tabelas)
    return {
        "codigo": a.codigo, "nome": a.nome, **campos, "operadores": list(a.operadores),
        # código guardado que saiu da lista (renomeado) não derruba o inventário: aparece como "código antigo"
        "bases_legais_texto": [BASES_LEGAIS.get(b, f"(código antigo: {b})") for b in campos["bases_legais"]],
        "operadores_detalhe": [{"codigo": o, **OPERADORES[o]} for o in a.operadores],
        "transferencia_internacional": any(OPERADORES[o]["fora_do_brasil"] for o in a.operadores),
        "requisito_crianca": REQUISITO_CRIANCA if pode_ter_crianca else None,
        "tabelas_externas": list(a.tabelas_externas),
        "tabelas": tabelas,
        "titulares": sorted({t for linha in das_tabelas for t in linha["titulares"]}),
        "dados_pessoais": sorted({f"{linha['tabela']}.{c}" for linha in das_tabelas for c in linha["colunas_pessoais"]}),
        "dados_sensiveis": sorted({f"{linha['tabela']}.{c}" for linha in das_tabelas for c in linha["colunas_sensiveis"]}),
        "texto_livre_que_pode_ter_sensivel": sorted({f"{linha['tabela']}.{c}" for linha in das_tabelas for c in linha["texto_livre_que_pode_ter_sensivel"]}),
        "pode_ter_crianca": pode_ter_crianca,
        "armazenamento": [ARMAZENAMENTO_BANCO] + ([ARMAZENAMENTO_ARQUIVOS] if a.arquivos else []) + ([ARMAZENAMENTO_SITE] if a.publicado_no_site else []),
        "prazos_de_guarda": _prazos(db, a),
        "prazos_fixos": list(a.prazos_fixos),
        "sem_rotina_de_guarda": not a.regras_de_retencao and not a.prazos_fixos,
        "versao": versao.versao if versao else 0,
        "alterado_em": versao.alterado_em.isoformat() if versao else None,
    }


def listar(db: Session) -> dict:
    inventario = cl.inventario_do_modelo()
    atividades = [_detalhar(db, a, inventario) for a in ATIVIDADES]
    return {
        "atividades": atividades,
        "tabelas_sem_atividade": tabelas_sem_atividade(inventario),
        "bases_legais": [{"codigo": c, "texto": t} for c, t in BASES_LEGAIS.items()],
        "operadores": [{"codigo": c, **d} for c, d in OPERADORES.items()],
        "base_legal_a_conferir": [a["codigo"] for a in atividades if not a["base_legal_conferida"]],
    }


def buscar(codigo: str) -> Atividade:
    a = _POR_CODIGO.get(codigo)
    if a is None:
        raise HTTPException(status_code=404, detail="Atividade de tratamento não encontrada.")
    return a


def atualizar(db: Session, usuario: Usuario, codigo: str, dados: dict, versao_base: Optional[int] = None) -> tuple[dict, dict, int]:
    """Grava uma versão nova com o que o encarregado ajustou. Devolve (antes, depois, número da versão) para a Auditoria."""
    a = buscar(codigo)
    atual = _vigente(db, codigo)
    if versao_base is not None and versao_base != (atual.versao if atual else 0):
        raise HTTPException(status_code=409, detail="Outra pessoa salvou uma versão nova desta atividade enquanto você ajustava. Recarregue a página e confira.")
    antes = _vigentes(a, atual)
    novos = {k: v for k, v in dados.items() if k in EDITAVEIS and v is not None}
    if "bases_legais" in novos:
        novos["bases_legais"] = sorted(set(novos["bases_legais"]))  # a ordem em que se marcou não é mudança
    for k in ("finalidade", "medidas"):
        if k in novos and len((novos[k] or "").strip()) < 10:
            raise HTTPException(status_code=422, detail="Escreva a finalidade e as medidas de segurança (pelo menos 10 letras).")
    if "bases_legais" in novos:
        desconhecidas = [b for b in novos["bases_legais"] if b not in BASES_LEGAIS]
        if desconhecidas or not novos["bases_legais"]:
            raise HTTPException(status_code=422, detail="Escolha ao menos uma base legal da lista.")
    if "operadores" in novos and any(o not in OPERADORES for o in novos["operadores"]):
        raise HTTPException(status_code=422, detail="Operador fora da lista.")
    depois = {**antes, **{k: (v.strip() if isinstance(v, str) else v) for k, v in novos.items()}}
    if depois["bases_legais"] != antes["bases_legais"] and novos.get("base_legal_conferida") is not True:
        depois["base_legal_conferida"] = False  # base nova não nasce conferida: o encarregado confere de novo
    if depois == antes:
        raise HTTPException(status_code=409, detail="Nada mudou.")
    numero = (db.query(func.max(VersaoDeAtividadeDeTratamento.versao)).filter(VersaoDeAtividadeDeTratamento.codigo_atividade == codigo).scalar() or 0) + 1
    proposta = _proposta(a)
    so_o_diferente = {k: v for k, v in depois.items() if v != proposta[k]}
    db.add(VersaoDeAtividadeDeTratamento(codigo_atividade=codigo, versao=numero, campos=so_o_diferente, id_usuario=usuario.id_usuario))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Outra pessoa salvou uma versão nova desta atividade ao mesmo tempo. Recarregue a página e confira.")
    return antes, depois, numero


def historico(db: Session, codigo: str) -> list[dict]:
    a = buscar(codigo)
    versoes = db.query(VersaoDeAtividadeDeTratamento).filter(VersaoDeAtividadeDeTratamento.codigo_atividade == codigo).order_by(
        VersaoDeAtividadeDeTratamento.versao.desc()).all()
    nomes = {u.id_usuario: u.email for u in db.query(Usuario).filter(Usuario.id_usuario.in_({v.id_usuario for v in versoes}))} if versoes else {}
    return [
        {"versao": v.versao, "alterado_em": v.alterado_em.isoformat(), "por": nomes.get(v.id_usuario), "campos": _vigentes(a, v)} for v in versoes
    ] + [{"versao": 0, "alterado_em": None, "por": "proposta do sistema", "campos": _proposta(a)}]


# ---------------------------------------------------------------------------------------- exportar (apresentar à ANPD quando pedido)
COLUNAS_DA_PLANILHA = (
    "Atividade", "Finalidade", "Titulares", "Dados pessoais", "Dados sensíveis", "Pode ter criança ou adolescente", "Base legal", "Base legal conferida pelo encarregado",
    "Compartilhamento (operadores)", "Transferência internacional", "Onde fica guardado", "Período de armazenamento", "Medidas de segurança", "Observações",
)


def _prazo_em_texto(atividade: dict) -> str:
    if atividade["sem_rotina_de_guarda"]:
        return "Sem rotina automática de eliminação ainda (pelo tempo necessário à finalidade e às obrigações legais e estatutárias)"
    return "; ".join([f"{p['rotulo']}: {p['dias']} dias" for p in atividade["prazos_de_guarda"]] + atividade["prazos_fixos"])


def _linha(atividade: dict) -> list[str]:
    return [
        atividade["nome"], atividade["finalidade"], "; ".join(atividade["titulares"]) or "ver as tabelas externas",
        ", ".join(atividade["dados_pessoais"] + atividade["tabelas_externas"]), ", ".join(atividade["dados_sensiveis"]) or "nenhum",
        f"sim — {atividade['requisito_crianca']}" if atividade["pode_ter_crianca"] else "não", "; ".join(atividade["bases_legais_texto"]),
        "sim" if atividade["base_legal_conferida"] else "não (proposta do sistema)",
        "; ".join(f"{o['nome']}: {o['o_que_faz']}" for o in atividade["operadores_detalhe"]),
        "; ".join(f"{o['nome']}: {o['onde']}" for o in atividade["operadores_detalhe"] if o["fora_do_brasil"]) or "não",
        "; ".join(atividade["armazenamento"]), _prazo_em_texto(atividade), atividade["medidas"], atividade["observacoes"] or "",
    ]


def _celula(valor: str) -> str:
    """Texto que começa com = + - @ vira fórmula no Excel: um apóstrofo na frente o deixa como texto."""
    return f"'{valor}" if valor[:1] in ("=", "+", "-", "@") else valor


def _cabecalho(db: Session) -> list[str]:
    """Quem é o controlador e o encarregado (a primeira parte do modelo da ANPD)."""
    org = servico_encarregado._organizacao(db)
    sit = servico_encarregado.situacao(db)
    vigente = sit["ato_vigente"]
    encarregado = sit["encarregado"]["nome"] if sit["encarregado"] else "o Presidente (sem mandato vigente cadastrado)"
    substituto = sit["substituto"]["nome"] if sit["substituto"] else "o Vice-Presidente em exercício"
    ato = f"Ato nº {vigente['numero']}" if vigente else "ato de designação ainda não assinado"
    return [
        f"Controlador: {org['nome']}, CNPJ {org['cnpj']}, {org['endereco']}; contato: {org['email']}.",
        f"Encarregado pelo tratamento de dados pessoais: {encarregado}; substituto: {substituto} ({ato}).",
    ]


def planilha(db: Session) -> bytes:
    saida = io.StringIO()
    escritor = csv.writer(saida, delimiter=";")
    for linha in _cabecalho(db):
        escritor.writerow([_celula(linha)])
    escritor.writerow([])
    escritor.writerow(COLUNAS_DA_PLANILHA)
    for atividade in listar(db)["atividades"]:
        escritor.writerow([_celula(c) for c in _linha(atividade)])
    return ("﻿" + saida.getvalue()).encode("utf-8")  # BOM: o Excel abre com acento


def pdf(db: Session, agora: Optional[datetime] = None) -> bytes:
    dados = listar(db)
    quando = dia_e_hora_em_belem(agora or datetime.utcnow())
    paragrafos = ["INVENTÁRIO DE DADOS PESSOAIS — REGISTRO DAS OPERAÇÕES DE TRATAMENTO (LGPD, art. 37)", f"Gerado pelo sistema em {quando}.", *_cabecalho(db), ""]
    titulos = {0}
    for atividade in dados["atividades"]:
        titulos.add(len(paragrafos))
        paragrafos.append(atividade["nome"])
        for rotulo, valor in zip(COLUNAS_DA_PLANILHA[1:], _linha(atividade)[1:]):
            paragrafos.append(f"{rotulo}: {valor}")
        paragrafos.append("")
    return pdf_de_texto.gerar("Inventário de dados pessoais", paragrafos, f"Inventário de dados pessoais da ASAF — gerado em {quando}.",
                              titulos=frozenset(titulos), tamanho=9)
