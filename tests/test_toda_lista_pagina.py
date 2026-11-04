"""v9.2c - TODA LISTA PAGINA OU DIZ POR QUE NÃO (FASE 9: "nenhuma tela carrega 'todos os associados'").

Cada rota GET de coleção da API (sem número no endereço) ou aceita `pagina` (app/paginacao.py, ou o mesmo nome em rotas mais antigas) ou está neste
registro, num grupo que diz por que não precisa. Rota nova que não pagina e não está aqui REPROVA: quem a criou decide, em vez de a lista crescer sem
ninguém ver. As que vêm de um pai no endereço (`/api/projetos/{id}/equipe`) já são filtradas por ele e ficam de fora.
"""
import pytest

from app.main import app

PAGINA = {"pagina", "por_pagina", "limite", "limit", "offset", "skip", "deslocamento"}

# As que CRESCEM com as pessoas e com os anos e passaram a paginar na v9.2c (além das que já paginavam: associados, títulos, Auditoria, atendimentos,
# avisos, livro-caixa, documentos, doações do site, consentimentos e as do Conselho Fiscal).
PAGINADAS_NA_V92C = {"/api/doacoes/", "/api/beneficiarios/", "/api/documentos-emitidos/", "/api/reservas-espaco/"}

NAO_SAO_LISTA = (
    "um objeto, um resumo (contagens e somas), um relatório agregado ou um arquivo para baixar inteiro de propósito (exportar, PDF, planilha)",
    {
        "/", "/health", "/health/live", "/health/ready", "/auth/me", "/auth/me/ficha-360", "/auth/perfil", "/portaria/evento",
        "/api/associados/resumo", "/api/atendimentos/resumo", "/api/titulos/resumo", "/api/intencoes-doacao/resumo",
        "/api/associados/exportar", "/api/beneficiarios/exportar", "/api/inscricoes/exportar", "/api/reservas-espaco/exportar", "/api/configuracoes/exportar",
        "/api/instituicao/", "/api/configuracoes/", "/api/espacos/ocupacao-mapa-calor", "/api/fluxo-de-caixa/",
        "/api/relatorios/balancete", "/api/relatorios/inadimplencia", "/api/relatorios/por-projeto", "/api/relatorios/receitas-despesas",
        "/api/relatorios/receitas-despesas-por-centro-custo",
        "/api/privacidade/encarregado", "/api/privacidade/inventario", "/api/privacidade/inventario-pdf", "/api/privacidade/inventario-planilha",
        "/api/privacidade/revisao-anual", "/api/privacidade/textos-de-privacidade", "/api/privacidade/solicitacoes-do-titular/relatorio",
        "/api/privacidade/titulares/relatorio",
        "/api/publico/doacao", "/api/publico/doacao/pix", "/api/publico/instituicao", "/api/publico/eventos/consentimento-lgpd",
        "/api/publico/atendimentos/prazos", "/api/publico/descadastro", "/api/visitante/minha-conta",
        "/api/meu-treinamento-de-privacidade", "/api/minhas-preferencias-de-comunicacao/",
    },
)
FILTRO_OBRIGATORIO = (
    "o filtro é obrigatório (um evento, uma busca): nunca devolve a tabela inteira",
    {"/api/inscricoes/", "/api/presencas/", "/api/privacidade/titulares"},
)
DO_PROPRIO_USUARIO = (
    "só o que é da própria pessoa que pediu (e com prazo de guarda, quando há)",
    {
        "/api/meus-avisos/", "/api/minhas-notificacoes/", "/api/meus-pedidos-do-titular", "/api/minhas-assembleias", "/api/eventos/minhas-inscricoes",
        "/api/voluntariado/meu-historico-horas", "/api/voluntariado/minha-escala", "/auth/sessoes", "/auth/webauthn/credenciais", "/auth/me/documentos",
    },
)
CADASTRO_PEQUENO = (
    "cadastro ou configuração da associação, de algumas dezenas de linhas (contas, cargos, modelos, catálogos, espaços), ou opções de um seletor",
    {
        "/api/alcadas-aprovacao/", "/api/catalogos/", "/api/centros-custo/", "/api/contas-a-pagar-recorrentes/", "/api/contas-financeiras/",
        "/api/delegacoes-aprovacao/", "/api/documentos/tipos", "/api/espacos/", "/api/estatuto/documentos", "/api/estatuto/regras", "/api/exercicios/",
        "/api/fechamentos-mensais/", "/api/fornecedores/", "/api/funcionarios/", "/api/indicadores/", "/api/mandatos/", "/api/mandatos/conflitos-interesse",
        "/api/mandatos/vencendo", "/api/modelos-de-aviso/", "/api/niveis-acesso/", "/api/orcamentos/", "/api/permissoes/", "/api/plano-contas/",
        "/api/planos-contribuicao/", "/api/templates-documento/", "/api/campanhas-arrecadacao/", "/api/campanhas-desconto-antecipado/",
        "/api/remanejamentos-destinacao/", "/api/reservas-contingencia/", "/api/prestacoes-de-contas/", "/api/auditoria/acoes",
        "/api/avisos/opcoes-de-publico", "/api/parcerias/opcoes", "/api/conselho-fiscal/pareceres", "/api/voluntariado/vagas-abertas",
        "/api/associados/busca-simples", "/api/filiacao/para-propor", "/api/projetos/voluntarios-selecao",
    },
)
CRESCE_DEVAGAR = (
    "cresce devagar (dezenas por ano: eventos, assembleias, atas, projetos, processos, pedidos) e serve também de seletor em outras telas; medida pelo "
    "robô de desempenho (v9.2b-01) e revista na revisão trimestral",
    {
        "/api/eventos/", "/api/assembleias/", "/api/atas/", "/api/avisos-agendados/", "/api/calendario/", "/api/eventos-calendario/",
        "/api/deliberacoes/concluidas", "/api/deliberacoes/pendentes", "/api/filiacao/propostas", "/api/isencoes-contribuicao/",
        "/api/negociacoes-divida/", "/api/parcerias", "/api/pessoas/fila-revisao", "/api/peticoes-convocacao/", "/api/processos-disciplinares/",
        "/api/processos-dissolucao/", "/api/projetos/", "/api/reembolsos-despesa/", "/api/solicitacoes-compra/", "/api/antifraude/padroes-suspeitos",
        "/api/privacidade/incidentes", "/api/privacidade/relatorios-de-impacto", "/api/privacidade/treinamentos",
    },
)
DO_SITE = (
    "o que vai ao site público, lido na montagem do site (só o publicado, pela diretoria)",
    {
        "/api/publico/assembleias", "/api/publico/diretoria", "/api/publico/eventos", "/api/publico/projetos", "/api/publico/transparencia/contas",
        "/api/publico/transparencia/documentos", "/api/publico/transparencia/parcerias", "/api/publico/transparencia/relatorios-anuais",
    },
)
REGISTRO = [NAO_SAO_LISTA, FILTRO_OBRIGATORIO, DO_PROPRIO_USUARIO, CADASTRO_PEQUENO, CRESCE_DEVAGAR, DO_SITE]


@pytest.fixture(scope="module")
def rotas():
    o = app.openapi()
    return {caminho: ops["get"] for caminho, ops in o["paths"].items() if "get" in ops and "{" not in caminho}


def _paginada(get: dict) -> bool:
    return bool({p["name"] for p in get.get("parameters", [])} & PAGINA)


def test_toda_lista_pagina_ou_tem_o_motivo_registrado(rotas):
    registradas = set().union(*(grupo for _, grupo in REGISTRO))
    sem_motivo = sorted(c for c, g in rotas.items() if not _paginada(g) and c not in registradas)
    assert sem_motivo == [], (
        "Lista nova sem paginação: pagine no servidor (app/paginacao.py) ou registre em tests/test_toda_lista_pagina.py, no grupo certo, por que não "
        f"precisa: {sem_motivo}"
    )


def test_o_registro_nao_cita_rota_que_nao_existe_e_nao_repete(rotas):
    todas = [c for _, grupo in REGISTRO for c in grupo]
    assert len(todas) == len(set(todas)), "rota em dois grupos"
    assert sorted(set(todas) - set(rotas)) == [], "rota registrada que não existe mais (tire do registro)"


def test_as_que_crescem_paginam(rotas):
    for caminho in PAGINADAS_NA_V92C:
        assert _paginada(rotas[caminho]), caminho
    registradas = set().union(*(grupo for _, grupo in REGISTRO))
    assert not (PAGINADAS_NA_V92C & registradas)


def test_filtro_obrigatorio_e_mesmo_obrigatorio(rotas):
    for caminho in FILTRO_OBRIGATORIO[1]:
        obrigatorios = [p["name"] for p in rotas[caminho].get("parameters", []) if p.get("required")]
        assert obrigatorios, f"{caminho} está como 'filtro obrigatório' mas não tem nenhum parâmetro obrigatório"
