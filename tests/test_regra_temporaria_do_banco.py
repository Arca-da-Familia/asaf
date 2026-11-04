"""v9.2 (autorizado pelo Presidente em 2026-11-04) - a regra temporária do banco: cada trabalho do GitHub que fala com o banco abre o firewall SÓ para o IP da
própria máquina e apaga a regra no fim (também quando algo falha). Os passos rodam de verdade aqui, com um `az` e um `curl` de mentira."""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_registro_seguro import _bloco_run

RAIZ = Path(__file__).resolve().parent.parent
FLUXOS = RAIZ / ".github" / "workflows"
BASH = shutil.which("bash")
ABRIR = "Abrir o banco só para esta máquina (regra temporária)"
FECHAR = "Fechar o banco para esta máquina (apaga a regra temporária)"


AZ_QUE_ANOTA = '#!/bin/sh\nfor a in "$@"; do echo "$a"; done >> az.txt\n'
AZ_SEM_PERMISSAO = "#!/bin/sh\necho 'AuthorizationFailed' >&2\nexit 1\n"


def _rodar(tmp_path, passo, ambiente=None, ip="203.0.113.7", az_falso=AZ_QUE_ANOTA):
    pasta_bin = tmp_path / "bin"
    pasta_bin.mkdir(exist_ok=True)
    (pasta_bin / "az").write_text(az_falso, encoding="utf-8", newline="\n")
    (pasta_bin / "curl").write_text(f'#!/bin/sh\necho "{ip}"\n', encoding="utf-8", newline="\n")
    for s in pasta_bin.iterdir():
        s.chmod(0o755)
    env_do_github = tmp_path / "github_env.txt"
    env_do_github.write_text("", encoding="utf-8")
    (tmp_path / "passo.sh").write_text("set -e\n" + _bloco_run("deploy-api.yml", passo), encoding="utf-8", newline="\n")
    caminho = subprocess.run([BASH, "-c", "pwd"], cwd=pasta_bin, capture_output=True, text=True).stdout.strip()
    env = {**os.environ, "GITHUB_ENV": str(env_do_github), "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2", "GITHUB_JOB": "build-and-deploy", **(ambiente or {})}
    r = subprocess.run([BASH, "-c", f'export PATH="{caminho}:$PATH"; bash passo.sh'], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=60)
    az = (tmp_path / "az.txt").read_text(encoding="utf-8").splitlines() if (tmp_path / "az.txt").exists() else []
    return r, az, env_do_github.read_text(encoding="utf-8")


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
def test_abrir_cria_a_regra_so_para_o_ip_desta_maquina(tmp_path):
    r, az, gravado = _rodar(tmp_path, ABRIR)
    assert r.returncode == 0, r.stderr
    assert az[:4] == ["postgres", "flexible-server", "firewall-rule", "create"]
    assert az[az.index("--start-ip-address") + 1] == "203.0.113.7" and az[az.index("--end-ip-address") + 1] == "203.0.113.7"
    # os nomes dos parâmetros do az de hoje (a 1ª versão usava --name para o servidor e falhou na produção: "the following arguments are required:
    # --server-name"); o az falso não reclama, então o teste confere os nomes exatos
    assert az[az.index("--server-name") + 1] == "asaf-pg-server"
    assert az[az.index("--name") + 1] == "github-123-2-build-and-deploy" and "--rule-name" not in az
    assert "REGRA_TEMPORARIA_DO_BANCO=github-123-2-build-and-deploy" in gravado


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
def test_sem_saber_o_ip_nao_abre_nada_e_segue(tmp_path):
    """Nunca trava a rotina: sem o IP, avisa e segue como antes (sem regra)."""
    r, az, gravado = _rodar(tmp_path, ABRIR, ip="<html>erro</html>")
    assert r.returncode == 0 and az == [] and "REGRA_TEMPORARIA_DO_BANCO" not in gravado
    assert "::warning::" in r.stdout


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
def test_sem_permissao_para_criar_a_regra_avisa_e_segue(tmp_path):
    """Se a identidade do GitHub não puder criar a regra, a rotina segue como antes (e o passo de fechar não tem o que apagar)."""
    r, _, gravado = _rodar(tmp_path, ABRIR, az_falso=AZ_SEM_PERMISSAO)
    assert r.returncode == 0 and "REGRA_TEMPORARIA_DO_BANCO" not in gravado
    assert "::warning::Não deu para criar a regra" in r.stdout




@pytest.mark.skipif(BASH is None, reason="precisa do bash")
def test_fechar_apaga_a_regra(tmp_path):
    r, az, _ = _rodar(tmp_path, FECHAR, {"REGRA_TEMPORARIA_DO_BANCO": "github-123-2-build-and-deploy"})
    assert r.returncode == 0, r.stderr
    assert az[:4] == ["postgres", "flexible-server", "firewall-rule", "delete"]
    assert az[az.index("--server-name") + 1] == "asaf-pg-server" and "--rule-name" not in az
    assert az[az.index("--name") + 1] == "github-123-2-build-and-deploy" and "--yes" in az


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
def test_fechar_nunca_apaga_uma_regra_que_nao_e_temporaria(tmp_path):
    r, az, _ = _rodar(tmp_path, FECHAR, {"REGRA_TEMPORARIA_DO_BANCO": "AllowAdminMachine"})
    assert r.returncode == 1 and az == []


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
def test_fechar_sem_regra_nao_faz_nada(tmp_path):
    r, az, _ = _rodar(tmp_path, FECHAR)
    assert r.returncode == 0 and az == []


def _trabalhos(texto: str) -> dict[str, str]:
    # o "\n" na frente: o primeiro trabalho vem logo depois de "jobs:"
    partes = re.split(r"\n  ([a-z][a-z0-9-]*):\n", "\n" + texto.split("\njobs:\n", 1)[1])
    return dict(zip(partes[1::2], partes[2::2]))


def test_todo_trabalho_que_le_o_banco_abre_e_fecha_e_so_ele():
    vistos = 0
    for arquivo in sorted(FLUXOS.glob("*.yml")):
        for nome, corpo in _trabalhos(arquivo.read_text(encoding="utf-8")).items():
            usa_o_banco = "--name DATABASE-URL " in corpo or "--name HML-DATABASE-URL " in corpo
            abre = corpo.count(f"- name: {ABRIR}")
            fecha = corpo.count(f"- name: {FECHAR}")
            if not usa_o_banco:
                assert abre == fecha == 0, f"{arquivo.name}/{nome} abre o banco sem precisar"
                continue
            vistos += 1
            assert abre == 1 and fecha == 1, f"{arquivo.name}/{nome}: abre {abre}, fecha {fecha}"
            i_login, i_abrir = corpo.index("- name: Login no Azure via OIDC"), corpo.index(f"- name: {ABRIR}")
            i_fechar, i_logout = corpo.index(f"- name: {FECHAR}"), corpo.index("- name: Logout")
            # abre logo depois de entrar no Azure, antes de qualquer passo que use o banco; fecha antes de sair do Azure, sempre
            assert i_login < i_abrir < corpo.index("DATABASE-URL") and i_fechar < i_logout, f"{arquivo.name}/{nome}: ordem errada"
            assert corpo[i_fechar:i_fechar + 200].split("\n")[1].strip() == "if: always()", f"{arquivo.name}/{nome}: o fechar tem de rodar sempre"
    assert vistos >= 9
