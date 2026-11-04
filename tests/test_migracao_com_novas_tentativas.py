"""A migração dos pipelines tenta até 3 vezes (o banco às vezes não aceita a conexão da máquina do GitHub a tempo: 03 e 04/11/2026). O passo roda de verdade, com
um `alembic` falso que falha N vezes."""
import os
import shutil
import subprocess

import pytest

from tests.test_registro_seguro import _bloco_run

BASH = shutil.which("bash")
PASSOS = [("deploy-api.yml", "Aplicar migrações Alembic em produção"), ("deploy-homologacao.yml", "Aplicar migrações no banco de TESTE")]


def _rodar(tmp_path, arquivo, passo, falhas):
    pasta_bin = tmp_path / "bin"
    pasta_bin.mkdir()
    contador = tmp_path / "vezes.txt"
    contador.write_text("0", encoding="utf-8")
    (pasta_bin / "alembic").write_text(
        f'#!/bin/sh\nN=$(cat "{contador.as_posix()}"); N=$((N+1)); echo $N > "{contador.as_posix()}"\n[ "$N" -gt {falhas} ]\n', encoding="utf-8", newline="\n"
    )
    (pasta_bin / "alembic").chmod(0o755)
    (tmp_path / "passo.sh").write_text("set -e\n" + _bloco_run(arquivo, passo), encoding="utf-8", newline="\n")
    caminho = subprocess.run([BASH, "-c", "pwd"], cwd=pasta_bin, capture_output=True, text=True).stdout.strip()
    env = {**os.environ, "ESPERA_ENTRE_TENTATIVAS": "0", "HML_DATABASE_URL": "postgresql://x/asaf_hml"}
    r = subprocess.run([BASH, "-c", f'export PATH="{caminho}:$PATH"; bash passo.sh'], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=60)
    return r.returncode, int(contador.read_text(encoding="utf-8").strip()), r.stdout


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
@pytest.mark.parametrize("arquivo, passo", PASSOS)
def test_duas_falhas_de_conexao_e_a_terceira_passa(tmp_path, arquivo, passo):
    codigo, vezes, saida = _rodar(tmp_path, arquivo, passo, falhas=2)
    assert (codigo, vezes) == (0, 3)
    assert saida.count("::warning::A migração não rodou") == 2


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
@pytest.mark.parametrize("arquivo, passo", PASSOS)
def test_falha_de_verdade_para_na_terceira(tmp_path, arquivo, passo):
    codigo, vezes, _ = _rodar(tmp_path, arquivo, passo, falhas=99)
    assert (codigo, vezes) == (1, 3)


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
@pytest.mark.parametrize("arquivo, passo", PASSOS)
def test_primeira_tentativa_certa_roda_uma_vez_so(tmp_path, arquivo, passo):
    assert _rodar(tmp_path, arquivo, passo, falhas=0)[:2] == (0, 1)
