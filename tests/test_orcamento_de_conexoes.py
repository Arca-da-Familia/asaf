"""v8.5 (FASE 8) - o ORÇAMENTO DE CONEXÕES do banco: tudo o que pode abrir conexão ao mesmo tempo tem de caber no que o servidor aceita.

O servidor (Postgres Flexible B1ms) aceita 50 conexões (`max_connections`), das quais 15 ficam reservadas (`superuser_reserved_connections` 10 +
`reserved_connections` 5, conferidos no Azure em 2026-11-03): quem não é administrador do Azure é recusado quando o total chega a 35. Dividem essas 35: o
próprio Azure (o mínimo medido em 30 dias foi 5 conexões abertas), a API de produção (o conjunto de cada cópia vezes o máximo de cópias), a de teste, o
editor do site (Directus) e uma folga para as rotinas agendadas, a migração e quem administra. O padrão do SQLAlchemy (5 + 10 por cópia) com duas cópias
passava do limite; o banco do Azure não oferece o PgBouncer embutido no plano Burstable (recusou `pgbouncer.enabled`), então o controle é aqui."""
from pathlib import Path

from tests.test_infra_config import _variaveis

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "infra" / "config"

MAX_CONNECTIONS = 50
RESERVADAS = 10 + 5
DO_AZURE = 5
DIRECTUS = 10  # o Directus não define DB_POOL__MAX: vale o padrão do Knex, até 10
HOMOLOGACAO = (3 + 1) * 1  # DB_POOL_SIZE=3, DB_MAX_OVERFLOW=1 (deploy-homologacao.yml), uma cópia no máximo
FOLGA = 4  # rotinas agendadas, migração e administração


def _producao() -> int:
    config = _variaveis(CONFIG / "api-producao.env")
    escala = _variaveis(CONFIG / "api-producao-escala.env")
    return (int(config["DB_POOL_SIZE"]) + int(config["DB_MAX_OVERFLOW"])) * int(escala["MAX_REPLICAS"])


def test_tudo_cabe_no_que_o_servidor_aceita():
    total = DO_AZURE + _producao() + HOMOLOGACAO + DIRECTUS + FOLGA
    assert total <= MAX_CONNECTIONS - RESERVADAS, (
        f"{total} conexões possíveis ao mesmo tempo, o servidor aceita {MAX_CONNECTIONS - RESERVADAS}: diminua o conjunto por cópia (api-producao.env), o "
        "máximo de cópias (api-producao-escala.env) ou suba o plano do banco (RUNBOOK.md, seção 11)"
    )


def test_a_producao_define_o_conjunto_de_conexoes():
    """Sem as variáveis, o padrão do SQLAlchemy (5 + 10) volta e a conta acima deixa de valer."""
    config = _variaveis(CONFIG / "api-producao.env")
    assert int(config["DB_POOL_SIZE"]) >= 2 and int(config["DB_MAX_OVERFLOW"]) >= 0


def test_a_homologacao_continua_com_o_numero_da_conta():
    texto = (RAIZ / ".github" / "workflows" / "deploy-homologacao.yml").read_text(encoding="utf-8")
    assert "DB_POOL_SIZE=3 DB_MAX_OVERFLOW=1" in texto


def test_tres_copias_com_o_conjunto_atual_nao_caberiam():
    """Prova de que o teste pega o erro: subir o máximo para 3 cópias sem mexer no resto estoura."""
    config = _variaveis(CONFIG / "api-producao.env")
    tres = (int(config["DB_POOL_SIZE"]) + int(config["DB_MAX_OVERFLOW"])) * 3
    assert DO_AZURE + tres + HOMOLOGACAO + DIRECTUS + FOLGA > MAX_CONNECTIONS - RESERVADAS
