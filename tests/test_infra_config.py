"""v8.2/v8.3 (FASE 8) - a configuração da API de produção versionada em infra/config/ (sem segredo; a publicação a aplica) e o fluxo de voltar a API a uma
versão anterior (recusa pedido malformado antes de tocar no Azure)."""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_registro_seguro import _bloco_run

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "infra" / "config"
BASH = shutil.which("bash")
SEGREDOS = ("DATABASE_URL", "JWT_SECRET", "SMTP_SENHA", "SMTP_USUARIO", "SMTP_HOST", "SMTP_PORTA", "SMTP_REMETENTE", "SENHA", "TOKEN", "SECRET", "KEY", "PASSWORD")


def _variaveis(arquivo: Path) -> dict:
    linhas = [l.strip() for l in arquivo.read_text(encoding="utf-8").splitlines() if l.strip() and not l.strip().startswith("#")]
    for l in linhas:
        assert re.fullmatch(r"[A-Z][A-Z0-9_]*=[^\s\"']+", l), f"linha fora do formato NOME=valor: {l}"
    return dict(l.split("=", 1) for l in linhas)


def test_a_configuracao_versionada_nao_tem_segredo():
    variaveis = _variaveis(CONFIG / "api-producao.env")
    assert {"WEBAUTHN_RP_ID", "WEBAUTHN_ORIGIN", "ARMAZENAMENTO_BLOB_URL", "RUN_DB_MIGRATION"} <= set(variaveis)
    for nome, valor in variaveis.items():
        assert not any(s in nome for s in SEGREDOS), f"{nome} parece segredo: segredo fica no cofre"
        assert "@" not in valor and "://" not in valor.replace("https://", ""), f"{nome}: valor com credencial?"


def test_a_escala_versionada_nao_mexe_no_minimo():
    """O mínimo de cópias é do fluxo de dia de evento; a publicação não pode zerá-lo no meio de um evento."""
    escala = _variaveis(CONFIG / "api-producao-escala.env")
    assert set(escala) == {"MAX_REPLICAS", "CPU", "MEMORIA"}
    assert "--min-replicas" not in _bloco_run("deploy-api.yml", "Atualiza o Container App com a nova imagem")


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
def test_a_publicacao_aplica_a_configuracao_versionada(tmp_path):
    pasta_bin = tmp_path / "bin"
    pasta_bin.mkdir()
    (pasta_bin / "az").write_text('#!/bin/sh\nfor a in "$@"; do echo "$a"; done > argumentos.txt\n', encoding="utf-8", newline="\n")
    (pasta_bin / "az").chmod(0o755)
    script = re.sub(r"\$\{\{ env\.(\w+) \}\}", r"${\1}", _bloco_run("deploy-api.yml", "Atualiza o Container App com a nova imagem"))
    script = script.replace("${{ github.sha }}", "abc123")
    (tmp_path / "passo.sh").write_text("set -e\n" + script, encoding="utf-8", newline="\n")
    caminho = subprocess.run([BASH, "-c", "pwd"], cwd=pasta_bin, capture_output=True, text=True).stdout.strip()
    raiz = subprocess.run([BASH, "-c", "pwd"], cwd=RAIZ, capture_output=True, text=True).stdout.strip()
    env = {**os.environ, "CONTAINER_APP": "api", "RESOURCE_GROUP": "rg", "REGISTRY": "reg", "IMAGE_NAME": "img", "GITHUB_WORKSPACE": raiz}
    r = subprocess.run([BASH, "-c", f'export PATH="{caminho}:$PATH"; bash passo.sh'], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    argumentos = (tmp_path / "argumentos.txt").read_text(encoding="utf-8").splitlines()
    i = argumentos.index("--set-env-vars")
    assert "WEBAUTHN_RP_ID=painel.asaf.org.br" in argumentos[i + 1:i + 6]
    assert argumentos[argumentos.index("--max-replicas") + 1] == "2" and argumentos[argumentos.index("--memory") + 1] == "1Gi"
    assert argumentos[-2:] == ["-o", "none"]


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
@pytest.mark.parametrize("versao, ambiente, aceita", [
    ("b93b624", "homologacao", True), ("b93b624", "producao", True), ("B93B624", "homologacao", False), ("abc", "homologacao", False),
    ("b93b624; rm -rf /", "homologacao", False), ("", "homologacao", False),
])
def test_voltar_versao_recusa_pedido_malformado(tmp_path, versao, ambiente, aceita):
    (tmp_path / "passo.sh").write_text("set -e\n" + _bloco_run("reverter-api.yml", "Confere o pedido"), encoding="utf-8", newline="\n")
    saida = tmp_path / "github_env.txt"
    saida.write_text("", encoding="utf-8")
    env = {**os.environ, "VERSAO": versao, "AMBIENTE": ambiente, "GITHUB_ENV": str(saida)}
    r = subprocess.run([BASH, "passo.sh"], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=60)
    assert (r.returncode == 0) is aceita, r.stdout + r.stderr
    if aceita:
        gravado = saida.read_text(encoding="utf-8")
        assert ("CONTAINER_APP=asaf-api\n" in gravado) is (ambiente == "producao")
        assert ("PREFIXO=hml-" in gravado) is (ambiente == "homologacao")
