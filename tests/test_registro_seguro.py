"""v7.3d - os registros das rotinas de produção (GitHub Actions, repositório PÚBLICO) não podem trazer dado pessoal nem a senha do banco.

  - com ASAF_REGISTRO_SEGURO=1, um erro de banco que ninguém capturou, ou registrado com `LOG.exception`, sai só com o tipo e os quadros do código - o CPF
    da linha repetida não aparece (rodado num processo de verdade, como a rotina roda);
  - a conexão do banco esconde os valores da consulta nas mensagens (`hide_parameters`);
  - os passos dos fluxos que buscam o banco de produção mascaram a senha sozinha (e decodificada) e ligam o registro seguro (o passo é EXECUTADO no bash,
    com um `az` de mentira);
  - a publicação não imprime o JSON do Container App (traz o e-mail de quem o criou) e os arquivos dos robôs da homologação ficam 7 dias."""
import logging
import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from app import registro_seguro

RAIZ = Path(__file__).resolve().parent.parent
FLUXOS = RAIZ / ".github" / "workflows"
BASH = shutil.which("bash")
CPF = "123.456.789-09"


def test_o_traceback_sai_sem_a_mensagem_nem_a_da_causa():
    try:
        try:
            raise KeyError(f"cpf {CPF}")
        except KeyError as causa:
            raise ValueError(f"Key (cpf)=({CPF}) already exists") from causa
    except ValueError:
        texto = registro_seguro.sem_valores(*sys.exc_info())
    assert CPF not in texto
    assert "builtins.ValueError" in texto
    assert "test_registro_seguro.py" in texto
    assert registro_seguro.AVISO in texto


def test_o_formato_do_registro_mantem_a_frase_e_tira_a_mensagem_do_erro():
    formato = registro_seguro.FormatoSemValores("%(levelname)s %(name)s: %(message)s")
    try:
        raise RuntimeError(f"falhou para {CPF}")
    except RuntimeError:
        registro = logging.LogRecord("rotina", logging.ERROR, __file__, 1, "Falha ao enviar o lembrete", None, sys.exc_info())
    texto = formato.format(registro)
    assert "ERROR rotina: Falha ao enviar o lembrete" in texto
    assert "builtins.RuntimeError" in texto
    assert CPF not in texto


@pytest.mark.parametrize("valor, esperado", [("1", True), (" 1 ", True), ("", False), ("0", False), ("sim", False)])
def test_so_liga_com_1(monkeypatch, valor, esperado):
    monkeypatch.setenv("ASAF_REGISTRO_SEGURO", valor)
    assert registro_seguro.ligado() is esperado


def test_a_conexao_do_banco_esconde_os_valores_da_consulta():
    from app.database import _engine_kwargs

    assert _engine_kwargs["hide_parameters"] is True
    motor = create_engine("sqlite://", **_engine_kwargs)
    with motor.begin() as c:
        c.execute(text("CREATE TABLE pessoa (cpf TEXT UNIQUE)"))
        c.execute(text("INSERT INTO pessoa VALUES (:cpf)"), {"cpf": CPF})
    with pytest.raises(IntegrityError) as erro, motor.begin() as c:
        c.execute(text("INSERT INTO pessoa VALUES (:cpf)"), {"cpf": CPF})
    assert CPF not in str(erro.value)
    assert "hidden" in str(erro.value)


# O CPF é montado em tempo de execução: o Python mostra no traceback as linhas do código, e numa rotina de verdade o dado vem do banco, nunca do código. As
# mensagens imitam o Postgres ("DETAIL: Key (cpf)=(...) already exists"; o SQLite não põe o valor na mensagem).
ROTINA_QUE_FALHA = textwrap.dedent("""
    import logging, sys
    import app.database
    LOG = logging.getLogger("rotina")
    cpf = sys.argv[1] + sys.argv[2]
    try:
        raise ValueError(f"DETAIL: Key (cpf)=({cpf}) already exists")
    except ValueError:
        LOG.exception("Falha registrada pela rotina")
    raise RuntimeError(f"falhou para {cpf}")
""")


def _rodar_rotina(ligado: bool) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": "sqlite://", "PYTHONPATH": str(RAIZ), "PYTHONIOENCODING": "utf-8"}
    env.pop("ASAF_REGISTRO_SEGURO", None)
    if ligado:
        env["ASAF_REGISTRO_SEGURO"] = "1"
    return subprocess.run([sys.executable, "-c", ROTINA_QUE_FALHA, CPF[:7], CPF[7:]], cwd=RAIZ, env=env, capture_output=True, text=True, encoding="utf-8", timeout=120)


def test_rotina_que_falha_com_o_registro_seguro_nao_imprime_o_cpf():
    r = _rodar_rotina(ligado=True)
    assert r.returncode != 0
    assert CPF not in r.stdout + r.stderr
    assert "ERROR rotina: Falha registrada pela rotina" in r.stderr
    assert "builtins.ValueError" in r.stderr
    assert "builtins.RuntimeError" in r.stderr
    assert r.stderr.count(registro_seguro.AVISO) == 2


def test_sem_o_registro_seguro_a_mensagem_aparece():
    """O controle: prova que o teste acima não passa à toa (o mesmo erro, sem a variável, traz o CPF)."""
    r = _rodar_rotina(ligado=False)
    assert r.returncode != 0
    assert CPF in r.stderr


# --- os fluxos do GitHub Actions ---------------------------------------------------------------------------------------------------------------------------

PASSOS_DO_BANCO_DE_PRODUCAO = [
    ("deploy-api.yml", "Buscar DATABASE_URL do Key Vault"),
    ("tarefa-diaria-lembretes.yml", "Buscar segredos do Key Vault (DATABASE_URL + SMTP)"),
    ("tarefa-eventos-vagas.yml", "Buscar segredos do Key Vault (DATABASE_URL + SMTP)"),
    ("tarefa-fechamento-eventos.yml", "Buscar DATABASE_URL do Key Vault"),
    ("tarefa-mensal-financeiro.yml", "Buscar DATABASE_URL do Key Vault"),
]


def _bloco_run(arquivo: str, nome_do_passo: str) -> str:
    linhas = (FLUXOS / arquivo).read_text(encoding="utf-8").splitlines()
    i = next(n for n, linha in enumerate(linhas) if linha.strip() == f"- name: {nome_do_passo}")
    j = next(n for n in range(i, len(linhas)) if linhas[n].strip() == "run: |")
    recuo = len(linhas[j]) - len(linhas[j].lstrip()) + 2
    corpo = []
    for linha in linhas[j + 1:]:
        if linha.strip() and len(linha) - len(linha.lstrip()) < recuo:
            break
        corpo.append(linha[recuo:] if linha.strip() else "")
    return "\n".join(corpo) + "\n"


def test_todo_fluxo_que_busca_o_banco_de_producao_esta_na_lista():
    """Um fluxo novo que busca DATABASE-URL tem de entrar na lista acima (e ganhar a máscara e o registro seguro)."""
    com_o_banco = {p.name for p in FLUXOS.glob("*.yml") if "--name DATABASE-URL " in p.read_text(encoding="utf-8")}
    # a homologação lê DATABASE-URL só para o administrador reiniciar o banco de TESTE (testado abaixo); nenhuma rotina roda com ele
    assert com_o_banco - {"deploy-homologacao.yml"} == {arquivo for arquivo, _ in PASSOS_DO_BANCO_DE_PRODUCAO}


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
@pytest.mark.parametrize("arquivo, passo", PASSOS_DO_BANCO_DE_PRODUCAO)
def test_o_passo_mascara_a_senha_sozinha_e_liga_o_registro_seguro(tmp_path, arquivo, passo):
    url = "postgresql://asafadmin:S3nh%40Forte%2F9@servidor.postgres.database.azure.com:5432/asaf?sslmode=require"
    pasta_bin = tmp_path / "bin"
    pasta_bin.mkdir()
    (pasta_bin / "az").write_text(f"#!/bin/sh\necho '{url}'\n", encoding="utf-8", newline="\n")
    python = Path(sys.executable).as_posix()
    (pasta_bin / "python3").write_text(f'#!/bin/sh\nexec "{python}" "$@"\n', encoding="utf-8", newline="\n")
    for script in pasta_bin.iterdir():
        script.chmod(0o755)
    env_do_github = tmp_path / "github_env.txt"
    env_do_github.write_text("", encoding="utf-8")
    (tmp_path / "passo.sh").write_text("set -e\n" + _bloco_run(arquivo, passo), encoding="utf-8", newline="\n")
    caminho = subprocess.run([BASH, "-c", "pwd"], cwd=pasta_bin, capture_output=True, text=True).stdout.strip()
    env = {**os.environ, "GITHUB_ENV": str(env_do_github), "LC_ALL": "C.UTF-8"}
    r = subprocess.run([BASH, "-c", f'export PATH="{caminho}:$PATH"; bash passo.sh'], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    mascaras = {linha.removeprefix("::add-mask::") for linha in r.stdout.splitlines() if linha.startswith("::add-mask::")}
    assert {url, "S3nh%40Forte%2F9", "S3nh@Forte/9"} <= mascaras
    gravado = env_do_github.read_text(encoding="utf-8").splitlines()
    assert "ASAF_REGISTRO_SEGURO=1" in gravado
    assert f"DATABASE_URL={url}" in gravado


def test_o_reinicio_da_homologacao_mascara_a_senha_do_administrador():
    texto = _bloco_run("deploy-homologacao.yml", "Reiniciar o banco de TESTE (só se pedido)")
    assert 'echo "::add-mask::$ADMIN_URL"' in texto
    assert '<<< "$ADMIN_SENHA_BANCO"' in texto


@pytest.mark.skipif(BASH is None, reason="precisa do bash")
@pytest.mark.parametrize("arquivo, passo", [
    ("deploy-api.yml", "Atualiza o Container App com a nova imagem"),
    ("deploy-homologacao.yml", "Atualiza a API de TESTE com a nova imagem"),
])
def test_a_publicacao_nao_imprime_o_json_do_container_app(tmp_path, arquivo, passo):
    """O passo é EXECUTADO com um `az` de mentira que anota os argumentos: `-o none` tem de chegar ao az como dois argumentos (o teste que só lia o texto
    deixou passar uma barra seguida de `n` no lugar da quebra de linha, que o bash entregaria ao az como `n`)."""
    pasta_bin = tmp_path / "bin"
    pasta_bin.mkdir()
    (pasta_bin / "az").write_text('#!/bin/sh\nfor a in "$@"; do echo "$a"; done > argumentos.txt\n', encoding="utf-8", newline="\n")
    (pasta_bin / "az").chmod(0o755)
    script = re.sub(r"\$\{\{ env\.(\w+) \}\}", r"${\1}", _bloco_run(arquivo, passo)).replace("${{ github.sha }}", "abc123")
    (tmp_path / "passo.sh").write_text("set -e\n" + script, encoding="utf-8", newline="\n")
    caminho = subprocess.run([BASH, "-c", "pwd"], cwd=pasta_bin, capture_output=True, text=True).stdout.strip()
    env = {**os.environ, "CONTAINER_APP": "api", "RESOURCE_GROUP": "rg", "REGISTRY": "reg", "IMAGE_NAME": "img", "CODIGO_SHA": "abc123"}
    r = subprocess.run([BASH, "-c", f'export PATH="{caminho}:$PATH"; bash passo.sh'], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    argumentos = (tmp_path / "argumentos.txt").read_text(encoding="utf-8").splitlines()
    assert argumentos[:2] == ["containerapp", "update"]
    assert argumentos[-2:] == ["-o", "none"]
    assert "n" not in argumentos


def test_todo_az_containerapp_update_escolhe_o_que_imprime():
    for p in FLUXOS.glob("*.yml"):
        texto = p.read_text(encoding="utf-8").replace("\\\n", " ")
        for linha in texto.splitlines():
            if "az containerapp update" in linha:
                assert "-o none" in linha or "--query" in linha, f"{p.name}: {linha.strip()}"


def test_os_arquivos_dos_robos_ficam_no_maximo_7_dias():
    """Os prints dos robôs mostram as telas do painel com os dados (inventados) da homologação; os relatórios do site público (deploy-site) ficam 14 dias."""
    for p in FLUXOS.glob("*homologacao*.yml"):
        texto = p.read_text(encoding="utf-8")
        if "actions/upload-artifact" in texto:
            dias = [int(linha.split(":")[1]) for linha in texto.splitlines() if linha.strip().startswith("retention-days:")]
            assert dias and max(dias) <= 7, p.name
