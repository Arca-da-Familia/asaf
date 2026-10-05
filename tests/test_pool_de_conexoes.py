"""O tamanho do conjunto de conexões do banco vem do ambiente: a API do ambiente de TESTE precisa ficar abaixo do limite do papel de teste
(5 conexões), e a produção, que não define nada, continua com o padrão. Cada caso roda num processo à parte porque o `engine` nasce
quando `app.database` é importado."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
CODIGO = (
    "import json, os; from app.database import engine; "
    "print('@@' + json.dumps({'tamanho': engine.pool.size(), 'estouro': engine.pool._max_overflow}))"
)


def _pool(**variaveis) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in ("DB_POOL_SIZE", "DB_MAX_OVERFLOW")}
    env.update(DATABASE_URL="postgresql://u:p@localhost:5432/asaf_hml", JWT_SECRET="x", RUN_DB_MIGRATION="false", **variaveis)
    r = subprocess.run([sys.executable, "-c", CODIGO], cwd=RAIZ, env=env, capture_output=True, text=True, encoding="utf-8", timeout=120)
    linha = [l for l in r.stdout.splitlines() if l.startswith("@@")]
    assert linha, r.stdout[-500:] + r.stderr[-800:]
    return json.loads(linha[-1][2:])


def test_sem_variaveis_o_padrao_do_sqlalchemy_continua_igual():
    """A produção não define nada: nada muda para ela."""
    assert _pool() == {"tamanho": 5, "estouro": 10}


def test_a_api_de_teste_limita_o_pool_para_caber_no_papel_de_5_conexoes():
    pool = _pool(DB_POOL_SIZE="3", DB_MAX_OVERFLOW="1")
    assert pool == {"tamanho": 3, "estouro": 1}
    assert pool["tamanho"] + pool["estouro"] < 5, "sobra ao menos uma conexão para quem administra o banco de teste"


def test_variavel_em_branco_nao_muda_nada():
    assert _pool(DB_POOL_SIZE=" ", DB_MAX_OVERFLOW="") == {"tamanho": 5, "estouro": 10}


def test_sqlite_ignora_as_variaveis_do_pool(tmp_path):
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{(tmp_path / 'x.db').as_posix()}", "JWT_SECRET": "x", "RUN_DB_MIGRATION": "false",
           "DB_POOL_SIZE": "3", "DB_MAX_OVERFLOW": "1"}
    r = subprocess.run([sys.executable, "-c", "from app.database import engine; print('ok', type(engine.pool).__name__)"], cwd=RAIZ, env=env,
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0 and r.stdout.startswith("ok"), r.stderr[-600:]


@pytest.mark.parametrize("arquivo", ["deploy-homologacao.yml"])
def test_o_deploy_de_teste_define_o_pool_pequeno_a_cada_publicacao(arquivo):
    texto = (RAIZ / ".github" / "workflows" / arquivo).read_text(encoding="utf-8")
    assert "DB_POOL_SIZE=3" in texto and "DB_MAX_OVERFLOW=1" in texto
    producao = (RAIZ / ".github" / "workflows" / "deploy-api.yml").read_text(encoding="utf-8")
    assert "DB_POOL_SIZE" not in producao, "a produção segue com o padrão"
