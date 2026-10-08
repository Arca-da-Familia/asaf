"""v5.4b - os scripts de shell dos workflows de monitoramento são EXECUTADOS aqui (bash de verdade), porque um alerta que nunca
dispara, ou que dispara à toa, é pior que nenhum:

  - `monitorar-site.yml`: confere site, painel e API de fora; falha com a lista do que não respondeu;
  - `sincronizar-site.yml` (passo "Mede há quanto tempo..."): o site atrás do sistema por mais de 2 horas vira alerta; menos que
    isso (o ciclo normal) não; quando o site alcança o sistema, o registro é zerado."""
import http.server
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
BASH = shutil.which("bash")
pytestmark = pytest.mark.skipif(BASH is None, reason="precisa do bash")


def _bloco_run(arquivo: str, nome_do_passo: str) -> str:
    """O texto do `run: |` de um passo do workflow, sem a indentação do YAML."""
    linhas = (RAIZ / ".github" / "workflows" / arquivo).read_text(encoding="utf-8").splitlines()
    i = next(n for n, linha in enumerate(linhas) if linha.strip() == f"- name: {nome_do_passo}")
    j = next(n for n in range(i, len(linhas)) if linhas[n].strip() == "run: |")
    recuo = len(linhas[j]) - len(linhas[j].lstrip()) + 2
    corpo = []
    for linha in linhas[j + 1:]:
        if linha.strip() and len(linha) - len(linha.lstrip()) < recuo:
            break
        corpo.append(linha[recuo:] if linha.strip() else "")
    return "\n".join(corpo) + "\n"


def _rodar(script: str, pasta: Path, ambiente: dict) -> tuple[int, str, str]:
    (pasta / "passo.sh").write_text(script, encoding="utf-8", newline="\n")
    saida = pasta / "github_output.txt"
    saida.write_text("", encoding="utf-8")
    env = {**os.environ, "GITHUB_OUTPUT": str(saida), "LC_ALL": "C.UTF-8", **ambiente}
    r = subprocess.run([BASH, "passo.sh"], cwd=pasta, env=env, capture_output=True, timeout=120)
    return r.returncode, r.stdout.decode("utf-8", "replace"), saida.read_text(encoding="utf-8")


# ------------------------------------------------------------------------------------------ defasagem do site
@pytest.fixture()
def passo_de_defasagem():
    return _bloco_run("sincronizar-site.yml", "Mede há quanto tempo o site está desatualizado")


def _com_registro(pasta: Path, segundos_atras: int | None):
    (pasta / "defasagem").mkdir(exist_ok=True)
    if segundos_atras is not None:
        import time

        (pasta / "defasagem" / "desde").write_text(str(int(time.time()) - segundos_atras), encoding="utf-8")


def _saidas(texto: str) -> dict:
    return dict(linha.split("=", 1) for linha in texto.splitlines() if "=" in linha)


def test_primeira_vez_que_o_site_fica_para_tras_so_registra_o_instante(passo_de_defasagem, tmp_path):
    codigo, _, saida = _rodar(passo_de_defasagem, tmp_path, {"MUDOU": "true", "LIMITE_MINUTOS": "120"})
    s = _saidas(saida)
    assert codigo == 0 and s["mudar_registro"] == "true" and s["minutos"] == "0" and "defasado" not in s
    assert (tmp_path / "defasagem" / "desde").read_text().strip().isdigit()


def test_ate_duas_horas_de_diferenca_e_o_ciclo_normal_e_nao_alerta(passo_de_defasagem, tmp_path):
    _com_registro(tmp_path, 25 * 60)  # 25 min: sincronização + publicação
    _, _, saida = _rodar(passo_de_defasagem, tmp_path, {"MUDOU": "true", "LIMITE_MINUTOS": "120"})
    s = _saidas(saida)
    assert s["minutos"] == "25" and "defasado" not in s and "mudar_registro" not in s, "não regrava o instante: ele é o do começo"
    _com_registro(tmp_path, 120 * 60)  # exatamente 2 h ainda não passa do limite
    _, _, saida = _rodar(passo_de_defasagem, tmp_path, {"MUDOU": "true", "LIMITE_MINUTOS": "120"})
    assert "defasado" not in _saidas(saida)


def test_mais_de_duas_horas_atrasado_vira_alerta(passo_de_defasagem, tmp_path):
    _com_registro(tmp_path, 121 * 60)
    _, saida_texto, saida = _rodar(passo_de_defasagem, tmp_path, {"MUDOU": "true", "LIMITE_MINUTOS": "120"})
    s = _saidas(saida)
    assert s["defasado"] == "true" and s["minutos"] == "121"
    assert "121 min" in saida_texto


def test_quando_o_site_alcanca_o_sistema_o_registro_e_zerado(passo_de_defasagem, tmp_path):
    _com_registro(tmp_path, 300 * 60)
    codigo, _, saida = _rodar(passo_de_defasagem, tmp_path, {"MUDOU": "false", "LIMITE_MINUTOS": "120"})
    s = _saidas(saida)
    assert codigo == 0 and s["mudar_registro"] == "true" and "defasado" not in s
    assert (tmp_path / "defasagem" / "desde").read_text() == "", "registro zerado: a próxima diferença começa a contar do zero"
    # e rodar de novo com tudo igual não faz nada
    _, _, saida = _rodar(passo_de_defasagem, tmp_path, {"MUDOU": "false", "LIMITE_MINUTOS": "120"})
    assert saida.strip() == ""


def test_site_em_dia_e_sem_registro_nao_faz_nada(passo_de_defasagem, tmp_path):
    codigo, _, saida = _rodar(passo_de_defasagem, tmp_path, {"MUDOU": "false", "LIMITE_MINUTOS": "120"})
    assert codigo == 0 and saida.strip() == ""


# ------------------------------------------------------------------------------------------ disponibilidade
class _Site(http.server.BaseHTTPRequestHandler):
    quebrado: set[str] = set()

    def do_GET(self):  # noqa: N802
        caminho = self.path.split("?")[0]
        if caminho in self.quebrado:
            self.send_response(503)
            self.end_headers()
            return
        corpos = {
            "/": "<html><body>Associação Arca da Família</body></html>",
            "/transparencia/": "<html><h1>Transparência</h1></html>",
            "/conteudo.json": '{"impressao":"' + "a" * 64 + '","contagem":{}}',
            "/version.json": '{"commit":"abc1234"}',
            "/api/publico/eventos": "[]",
        }
        corpo = corpos.get(caminho)
        self.send_response(200 if corpo is not None else 404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write((corpo or "").encode("utf-8"))

    def log_message(self, *_):
        pass


@pytest.fixture()
def servidor():
    _Site.quebrado = set()
    http_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Site)
    threading.Thread(target=http_server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{http_server.server_address[1]}"
    http_server.shutdown()


def _monitor(tmp_path, base):
    script = _bloco_run("monitorar-site.yml", "Confere de fora").replace("sleep 20", "sleep 0")
    return _rodar(script, tmp_path, {"SITE_URL": base, "PAINEL_URL": base, "API_URL": base})


def test_tudo_respondendo_o_monitor_passa_sem_problema(servidor, tmp_path):
    codigo, saida_texto, saida = _monitor(tmp_path, servidor)
    assert codigo == 0, saida_texto
    assert "FALHOU" not in saida_texto and re.fullmatch(r"problemas<<FIM\nFIM\n", saida)


def test_uma_pagina_fora_do_ar_derruba_o_monitor_e_diz_qual(servidor, tmp_path):
    _Site.quebrado = {"/conteudo.json"}
    codigo, saida_texto, saida = _monitor(tmp_path, servidor)
    assert codigo == 1
    assert "conteudo.json" in saida and "503" in saida
    assert "FALHOU: Conteúdo do site" in saida_texto


def test_pagina_que_responde_200_mas_vazia_tambem_e_problema(servidor, tmp_path, monkeypatch):
    """O site 'no ar' mas sem a marca da associação (deploy quebrado, página de erro do provedor) não pode passar."""
    original = _Site.do_GET

    def sem_a_marca(self):
        if self.path.split("?")[0] == "/":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"<html>Site em manutencao</html>")
            return
        original(self)

    monkeypatch.setattr(_Site, "do_GET", sem_a_marca)
    codigo, _, saida = _monitor(tmp_path, servidor)
    assert codigo == 1 and "Página inicial do site" in saida


def test_o_monitor_avisa_so_na_segunda_rodada_com_problema():
    """O aviso no GitHub só abre se a rodada ANTERIOR também falhou: uma oscilação de 1 rodada só deixa a execução vermelha."""
    texto = (RAIZ / ".github" / "workflows" / "monitorar-site.yml").read_text(encoding="utf-8")
    assert 'if [ "$ANTERIOR" != "failure" ]' in texto and "exit 0" in texto
    assert "issues: write" in texto and "alerta-site-fora-do-ar" in texto
    assert "gh issue close" in texto, "o aviso fecha sozinho quando tudo volta ao normal"


def _passo(texto: str, nome: str) -> str:
    """O texto de um passo do workflow (do `- name:` até o próximo)."""
    inicio = texto.index(f"- name: {nome}")
    proximo = texto.find("\n      - name:", inicio + 1)
    return texto[inicio:] if proximo == -1 else texto[inicio:proximo]


def test_o_aviso_de_defasagem_sai_mesmo_quando_a_republicacao_parou_de_proposito():
    """Achado da verificação independente: com as 3 últimas publicações falhas o passo de republicar faz `exit 1`, e os passos
    seguintes eram PULADOS — justamente quando o site está atrasado. Agora rodam (`!cancelled()`), mas só se a comparação rodou."""
    texto = (RAIZ / ".github" / "workflows" / "sincronizar-site.yml").read_text(encoding="utf-8")
    republica = _passo(texto, "Republica o site (só se o conteúdo mudou e não há publicação em andamento)")
    assert "exit 1" in republica, "o desenho de parar depois de 3 falhas continua"
    for nome in (
        "Restaura desde quando o site está desatualizado", "Mede há quanto tempo o site está desatualizado",
        "Guarda o registro (só quando ele muda)", "Aviso no GitHub — site atrás do sistema há mais de 2 horas",
        "Fecha o aviso de defasagem quando o site alcançou o sistema",
    ):
        passo = _passo(texto, nome)
        assert "!cancelled()" in passo, nome
    # sem a comparação (nenhum `mudou`) não há o que medir: nunca zera o registro por engano
    for nome in ("Restaura desde quando o site está desatualizado", "Mede há quanto tempo o site está desatualizado"):
        assert "steps.conteudo.outcome == 'success'" in _passo(texto, nome), nome


def test_a_sincronizacao_abre_e_fecha_o_aviso_de_defasagem():
    texto = (RAIZ / ".github" / "workflows" / "sincronizar-site.yml").read_text(encoding="utf-8")
    assert "issues: write" in texto and "alerta-site-defasado" in texto
    assert "actions/cache/restore@" in texto and "actions/cache/save@" in texto
    assert "gh issue close" in texto


def test_os_vigilantes_olham_so_a_producao_nunca_a_homologacao():
    """Monitor, sincronização e trava de tamanho rodam sozinhos, o dia inteiro: apontá-los para a homologação (que dorme para não custar) seria acordar o
    ambiente de teste de 15 em 15 minutos para sempre. A conferência da v5.4g (2026-10-08) exige que eles olhem só a produção."""
    for arquivo in ("monitorar-site.yml", "sincronizar-site.yml"):
        texto = (RAIZ / ".github" / "workflows" / arquivo).read_text(encoding="utf-8").lower()
        assert "hml" not in texto and "homolog" not in texto.replace("homologação", "").replace("homologacao", ""), arquivo
        assert "https://asaf.org.br" in texto or "asaf.org.br" in texto, arquivo
    assert "hml-" not in (RAIZ / "site" / "scripts" / "verificar-tamanho.mjs").read_text(encoding="utf-8").lower()
