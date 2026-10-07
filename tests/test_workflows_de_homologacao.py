"""O fluxo que publica o ambiente de TESTE (homologação) não pode, em hipótese alguma, tocar na produção. Estas travas leem o
arquivo do workflow e conferem o que importa: só dispara à mão, só usa o banco `asaf_hml`, nunca o segredo de produção em
nenhum passo de publicação e nunca imprime segredo."""
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
TEXTO = (RAIZ / ".github" / "workflows" / "deploy-homologacao.yml").read_text(encoding="utf-8")


def _sem_comentarios(texto: str) -> str:
    return "\n".join(l for l in texto.splitlines() if not l.strip().startswith("#"))


CODIGO = _sem_comentarios(TEXTO)


def _passo(nome: str) -> str:
    inicio = TEXTO.index(f"- name: {nome}")
    proximo = TEXTO.find("\n      - name:", inicio + 1)
    return TEXTO[inicio:] if proximo == -1 else TEXTO[inicio:proximo]


def test_so_dispara_a_mao_nunca_por_push_nem_agenda():
    gatilho = CODIGO.split("permissions:")[0]
    assert "workflow_dispatch:" in gatilho
    for proibido in ("push:", "pull_request", "schedule:", "cron:", "workflow_run"):
        assert proibido not in gatilho, proibido


def test_usa_o_segredo_do_banco_de_teste_e_confere_o_nome_do_banco():
    passo = _passo("Segredos do banco de TESTE (nunca os de produção)")
    assert "--name HML-DATABASE-URL" in passo
    assert "*/asaf_hml\\?*)" in passo and "exit 1" in passo, "para se a URL não for a do banco asaf_hml"
    assert "DATABASE-URL" not in re.sub("HML-DATABASE-URL", "", passo), "este passo não lê o segredo de produção"


def test_o_segredo_de_producao_so_aparece_no_reinicio_e_so_para_apagar_o_banco_de_teste():
    usos = [m.start() for m in re.finditer(r"--name DATABASE-URL\b", CODIGO)]
    assert len(usos) == 1, "exatamente um passo usa o administrador do servidor"
    passo = _passo("Reiniciar o banco de TESTE (só se pedido)")
    assert "--name DATABASE-URL" in passo and "if: ${{ inputs.resetar_banco }}" in passo
    assert "scripts/homologacao_banco.py resetar" in passo
    # a migração e a API de teste usam o banco de teste, jamais o administrador
    assert 'DATABASE_URL="$HML_DATABASE_URL" alembic upgrade head' in _passo("Aplicar migrações no banco de TESTE")


def test_nunca_aponta_para_os_recursos_de_producao():
    for recurso_de_producao in ("--name asaf-api ", "CONTAINER_APP: asaf-api\n", "SWA-SITE-DEPLOY-TOKEN", "SWA-PAINEL-DEPLOY-TOKEN",
                                "https://api.asaf.org.br", "painel.asaf.org.br/", "--name asaf-painel ", "--name asaf-site "):
        assert recurso_de_producao not in CODIGO, recurso_de_producao
    assert "CONTAINER_APP: asaf-api-hml" in CODIGO
    assert "API_HML: https://hml-api.asaf.org.br" in CODIGO
    assert "SWA-PAINEL-HML-DEPLOY-TOKEN" in CODIGO and "SWA-SITE-HML-DEPLOY-TOKEN" in CODIGO


def test_painel_e_site_de_teste_levam_a_faixa_e_apontam_para_a_api_de_teste():
    assert "VITE_AMBIENTE: homologacao" in CODIGO and "PUBLIC_AMBIENTE: homologacao" in CODIGO
    assert CODIGO.count("${{ env.API_HML }}") == 2
    assert "DIRECTUS" not in CODIGO.upper().replace("DIRECTUS-SITE-TOKEN", "") or "Sem token do Directus" in TEXTO


def test_todo_segredo_lido_do_cofre_e_mascarado():
    leituras = CODIGO.count("az keyvault secret show")
    # banco de teste (api, popular e volume), administrador do servidor (só no reinício), JWT (api, popular e volume), senha do
    # administrador de teste e senhas dos usuários de teste (popular), token do painel e token do site
    assert leituras == 10
    assert CODIGO.count("::add-mask::") >= leituras, "cada segredo lido é mascarado antes de qualquer uso"


@pytest.mark.parametrize("trecho", ["concurrency:", "group: homologacao", "cancel-in-progress: false"])
def test_uma_publicacao_de_teste_por_vez(trecho):
    assert trecho in CODIGO


def test_o_fluxo_so_le_o_cofre_nunca_escreve():
    """A identidade do GitHub só tem permissão de LER segredos (de propósito). As senhas de teste são criadas por quem administra o
    Azure; o fluxo apenas as lê. (A primeira execução falhou justamente por tentar gravar: ForbiddenByPolicy.)"""
    assert "keyvault secret set" not in CODIGO and "secret set" not in CODIGO
    assert "--name HML-ADMIN-SENHA" in CODIGO and "--name HML-USUARIOS" in CODIGO


# ------------------------------------------------------------------------------------------------ testar-homologacao.yml
TEXTO_TESTAR = (RAIZ / ".github" / "workflows" / "testar-homologacao.yml").read_text(encoding="utf-8")
CODIGO_TESTAR = _sem_comentarios(TEXTO_TESTAR)


def test_a_conferencia_ao_vivo_so_dispara_a_mao():
    """Um robô que acorda a API de teste sozinho custa dinheiro e pode rodar no meio de uma publicação: só à mão."""
    gatilho = CODIGO_TESTAR.split("permissions:")[0]
    assert "workflow_dispatch:" in gatilho
    for proibido in ("push:", "pull_request", "schedule:", "cron:", "workflow_run"):
        assert proibido not in gatilho, proibido
    assert "group: homologacao" in CODIGO_TESTAR and "cancel-in-progress: false" in CODIGO_TESTAR, "mesma fila do deploy de teste"


def test_a_conferencia_ao_vivo_so_fala_com_a_homologacao_e_so_le_segredos_de_teste():
    assert "HML_PAINEL_URL: https://hml-painel.asaf.org.br" in CODIGO_TESTAR
    for producao in ("painel.asaf.org.br/", "https://painel.asaf.org.br", "api.asaf.org.br", "--name DATABASE-URL", "SWA-", "DIRECTUS"):
        assert producao not in CODIGO_TESTAR.replace("hml-painel.asaf.org.br", ""), producao
    leituras = re.findall(r"--name (\S+)", CODIGO_TESTAR)
    assert sorted(leituras) == ["HML-ADMIN-SENHA", "HML-USUARIOS"], leituras
    assert "secret set" not in CODIGO_TESTAR, "o fluxo só lê o cofre"


def test_a_conferencia_ao_vivo_mascara_as_senhas_e_varre_os_resultados():
    assert CODIGO_TESTAR.count("::add-mask::") >= 3
    varredura = _passo_de(TEXTO_TESTAR, "Varre os resultados atrás de senha")
    assert "if: ${{ always() }}" in varredura and "grep -rIlF -f" in varredura and "rm -rf prints-hml" in varredura
    assert "exit 1" in varredura, "senha achada nos resultados derruba o fluxo e descarta o artefato"
    # o artefato só é guardado DEPOIS da varredura
    assert TEXTO_TESTAR.index("Varre os resultados atrás de senha") < TEXTO_TESTAR.index("Guarda os prints, vídeos e o relatório")


def test_a_conferencia_ao_vivo_valida_o_nome_do_roteiro_antes_de_usar():
    """O nome vai por variável de ambiente (nunca interpolado no script) e é conferido contra um padrão fechado."""
    assert 'ROTEIRO: ${{ inputs.roteiro }}' in CODIGO_TESTAR
    assert "${{ inputs.roteiro }}\"" not in CODIGO_TESTAR.replace("name: conferencia-homologacao-${{ inputs.roteiro }}", "")
    passo = _passo_de(TEXTO_TESTAR, "Confere o nome do roteiro")
    assert "v[0-9]*.[0-9]*)" in passo and "exit 1" in passo


def test_o_robo_recusa_qualquer_endereco_que_nao_seja_a_homologacao_e_nao_grava_senha():
    config = (RAIZ / "painel" / "playwright.hml.config.ts").read_text(encoding="utf-8")
    assert "hostname !== 'hml-painel.asaf.org.br'" in config and "RECUSADO" in config
    assert "trace: 'off'" in config, "o trace guarda o texto digitado: a senha de teste iria para um arquivo"
    apoio = (RAIZ / "painel" / "e2e-hml" / "apoio.ts").read_text(encoding="utf-8")
    assert "box: true" in apoio, "o passo de entrada não mostra o que foi digitado no relatório"
    assert "console.log" not in apoio
    for arquivo in (RAIZ / "painel" / "e2e-hml").glob("*.ts"):
        texto = arquivo.read_text(encoding="utf-8")
        assert "painel.asaf.org.br" not in texto.replace("hml-painel.asaf.org.br", ""), arquivo.name
        assert "console.log" not in texto, arquivo.name


def _passo_de(texto: str, nome: str) -> str:
    inicio = texto.index(f"- name: {nome}")
    proximo = texto.find("\n      - name:", inicio + 1)
    return texto[inicio:] if proximo == -1 else texto[inicio:proximo]


# ------------------------------------------------------------------------------------------------ publicar uma branch (v5.4c)
def test_da_para_publicar_uma_branch_na_homologacao_antes_da_main():
    """Regra da v5.5 em diante: a versão é testada na homologação ANTES de ir para a `main`. O fluxo é sempre disparado da `main`
    (de onde a identidade do Azure é aceita), mas baixa o código da branch pedida em `ref`."""
    entradas = CODIGO.split("permissions:")[0]
    assert "      ref:" in entradas and "default: main" in entradas
    assert CODIGO.count("uses: actions/checkout@v7") == 5
    assert CODIGO.count("ref: ${{ inputs.ref }}") == 5, "os cinco trabalhos (api, popular, volume, painel, site) baixam o mesmo código"
    # `github.sha` é o da main: a imagem tem que levar o SHA do código de verdade publicado
    assert "github.sha" not in CODIGO
    assert 'echo "CODIGO_SHA=$(git rev-parse HEAD)" >> "$GITHUB_ENV"' in CODIGO
    assert CODIGO.count("hml-${CODIGO_SHA}") == 2


def test_mexer_so_no_robo_de_conferencia_nao_reconstroi_o_painel_de_producao():
    """O robô (painel/e2e-hml, playwright.hml.config.ts) não vai para o painel publicado: o deploy de produção ignora essas pastas."""
    texto = (RAIZ / ".github" / "workflows" / "deploy-painel.yml").read_text(encoding="utf-8")
    for ignorado in ('"!painel/e2e-hml/**"', '"!painel/playwright.hml.config.ts"', '"!painel/prints-hml/**"'):
        assert texto.count(ignorado) == 2, f"{ignorado} em push e em pull_request"
    # a negação vem DEPOIS de "painel/**" (a ordem importa nos filtros de caminho do GitHub)
    assert texto.index('"painel/**"') < texto.index('"!painel/e2e-hml/**"')
