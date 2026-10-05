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
    # banco de teste (api e popular), administrador do servidor (só no reinício), JWT, senha do administrador de teste e senhas
    # dos usuários de teste (popular), token do painel e token do site
    assert leituras == 8
    assert CODIGO.count("::add-mask::") >= leituras, "cada segredo lido é mascarado antes de qualquer uso"


@pytest.mark.parametrize("trecho", ["concurrency:", "group: homologacao", "cancel-in-progress: false"])
def test_uma_publicacao_de_teste_por_vez(trecho):
    assert trecho in CODIGO


def test_o_fluxo_so_le_o_cofre_nunca_escreve():
    """A identidade do GitHub só tem permissão de LER segredos (de propósito). As senhas de teste são criadas por quem administra o
    Azure; o fluxo apenas as lê. (A primeira execução falhou justamente por tentar gravar: ForbiddenByPolicy.)"""
    assert "keyvault secret set" not in CODIGO and "secret set" not in CODIGO
    assert "--name HML-ADMIN-SENHA" in CODIGO and "--name HML-USUARIOS" in CODIGO
