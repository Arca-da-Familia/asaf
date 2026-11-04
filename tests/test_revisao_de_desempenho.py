"""v8.5 (FASE 8) - a revisão de desempenho (scripts/revisao_de_desempenho.py e a rotina revisao-de-desempenho.yml): os gatilhos, o texto público das
consultas e as garantias da rotina. Sem Azure e sem banco de verdade: o `az` é uma função falsa e o banco é um SQLite (a parte do Postgres é coberta pela
leitura das consultas)."""
import datetime as dt
from pathlib import Path

import pytest

from scripts import revisao_de_desempenho as rd

RAIZ = Path(__file__).resolve().parent.parent
FLUXO = RAIZ / ".github" / "workflows" / "revisao-de-desempenho.yml"
G = rd.ler_gatilhos()


def _serie(valores, campo="average"):
    return [{"timeStamp": f"2026-10-01T{i % 24:02d}:00:00Z", "average": v, "maximum": v, "minimum": v, "total": v} for i, v in enumerate(valores)]


def _medidas(**trocas):
    """O uso real medido em 2026-11-03 (30 dias), resumido: nenhum gatilho."""
    banco = {
        "cpu_percent": _serie([8] * 680 + [11] * 39 + [99.9]),
        "memory_percent": _serie([55] * 700 + [89] * 20),
        "active_connections": _serie([10] * 719 + [33 - 5]),
        "storage_percent": _serie([13.4] * 720),
        "cpu_credits_remaining": _serie([303] * 720),
        "connections_failed": _serie([0] * 720),
    }
    api = {"Replicas": _serie([0] * 600 + [1] * 119 + [2]), "Requests": _serie([10] * 720), "WorkingSetBytes": _serie([260e6] * 720),
           "RestartCount": _serie([0] * 720)}
    medidas = {"ambiente": "producao", "dias": 30, "inicio": "2026-10-04T00:00:00Z", "fim": "2026-11-03T00:00:00Z", "banco_plano": "Standard_B1ms",
               "banco_disco_gb": 32, "api_max_copias": 2, "api_memoria_gib": 1.0, "banco": banco, "api": api,
               "arquivos": {"UsedCapacity": _serie([470_000] * 72)}}
    for chave, valor in trocas.items():
        grupo, nome = chave.split("__")
        medidas[grupo][nome] = valor
    return medidas


def test_o_uso_real_de_hoje_nao_atinge_nenhum_gatilho():
    assert rd.avaliar(_medidas(), None, G) == []


@pytest.mark.parametrize("troca, trecho", [
    ({"banco__cpu_percent": _serie([70] * 50 + [8] * 670)}, "CPU acima de 60%"),
    ({"banco__memory_percent": _serie([90] * 50 + [55] * 670)}, "memória acima de 85%"),
    ({"banco__cpu_credits_remaining": _serie([303] * 719 + [40])}, "créditos de CPU chegaram a 40"),
    ({"banco__active_connections": _serie([10] * 719 + [31])}, "pico de 31 conexões"),
    ({"banco__connections_failed": _serie([0] * 719 + [2])}, "2 conexões recusadas"),
    ({"banco__storage_percent": _serie([71] * 720)}, "disco em 71.0%"),
    ({"api__Replicas": _serie([2] * 100 + [0] * 620)}, "no máximo de cópias (2) a hora inteira"),
    ({"api__WorkingSetBytes": _serie([900e6] * 720)}, "memória chegou a 84%"),
    ({"api__RestartCount": _serie([0] * 715 + [1] * 5)}, "5 reinícios"),
    ({"arquivos__UsedCapacity": _serie([60 * 1024 ** 3] * 72)}, "Arquivos: 60.0 GB"),
])
def test_cada_gatilho_dispara_com_o_numero_e_aponta_o_que_fazer(troca, trecho):
    alertas = rd.avaliar(_medidas(**troca), None, G)
    assert len(alertas) == 1 and trecho in alertas[0], alertas
    assert "seção" in alertas[0]


def test_poucas_horas_de_pico_nao_disparam():
    """Um pico isolado (o reset da homologação em 06/10 levou a CPU a 99,9%) não é motivo para subir o plano: conta a fração das horas."""
    assert rd.avaliar(_medidas(banco__cpu_percent=_serie([99.9] * 30 + [8] * 690)), None, G) == []


def test_consulta_lenta_e_tabela_sem_indice_entram_nos_gatilhos():
    banco = {"sem_indice": [("public.associados", 900, 10, 12000)],
             "pesadas": [(150, 120000.0, 800.0, "SELECT * FROM associados WHERE nome ILIKE $1"), (5, 9000.0, 1800.0, "SELECT 1"),
                         (5000, 1000.0, 0.2, "SELECT 2")]}
    alertas = rd.avaliar(_medidas(), banco, G)
    assert len(alertas) == 2
    assert "public.associados (12000 linhas) foi lida 900 vezes" in alertas[0]
    assert "150 chamadas com média de 800 ms" in alertas[1]


@pytest.mark.parametrize("texto, esperado", [
    ("SELECT id FROM associados WHERE cpf = $1", "SELECT id FROM associados WHERE cpf = $1"),
    ("select * from x where nome = 'Maria da Silva' and cpf='123.456.789-00'", "select * from x where nome = ? and cpf=?"),
    ("  WITH a AS (select 1)\n   SELECT * FROM a", "WITH a AS (select 1) SELECT * FROM a"),
    ("UPDATE x SET obs = 'it''s' WHERE id = $1", "UPDATE x SET obs = ? WHERE id = $1"),
    ("ALTER ROLE asaf PASSWORD 'segredo'", None),
    ("CREATE EXTENSION pg_stat_statements", None),
    ("SET search_path TO directus", None),
    ("", None),
])
def test_o_texto_publico_das_consultas_nao_leva_valor(texto, esperado):
    assert rd.limpar_consulta(texto) == esperado


def test_consulta_comprida_e_cortada():
    assert len(rd.limpar_consulta("SELECT " + "coluna, " * 100 + "x FROM t")) == 160


def test_resumir_conta_o_p95_e_as_horas_acima():
    r = rd.resumir(_serie(list(range(1, 101))), limite=90)
    assert (r["horas"], r["media"], r["p95"], r["pico"], r["minimo"], r["horas_acima"]) == (100, 50.5, 95, 100, 1, 10)
    assert rd.resumir([{"average": None}]) == {"horas": 0}


def test_os_gatilhos_versionados_estao_todos_la():
    assert set(G) == {"BANCO_CPU_MEDIA_HORARIA_MAX", "BANCO_HORAS_ACIMA_PERCENTUAL_MAX", "BANCO_MEMORIA_MEDIA_HORARIA_MAX", "BANCO_CREDITOS_CPU_MIN",
                      "BANCO_CONEXOES_PICO_MAX", "BANCO_DISCO_PERCENTUAL_MAX", "API_HORAS_NO_MAXIMO_PERCENTUAL_MAX", "API_MEMORIA_PERCENTUAL_MAX",
                      "API_REINICIOS_MAX", "ARQUIVOS_GB_MAX", "CONSULTA_MEDIA_MS_MAX", "CONSULTA_CHAMADAS_MIN", "TABELA_LINHAS_PARA_INDICE"}
    assert G["BANCO_CONEXOES_PICO_MAX"] < 35, "o gatilho tem de vir antes do limite prático (50 menos 15 reservadas)"


class AzFalso:
    """Responde como o `az` real (formato conferido em 2026-11-03) e guarda o que foi pedido."""

    def __init__(self):
        self.pedidos = []

    def __call__(self, argumentos):
        self.pedidos.append(argumentos)
        if argumentos[:3] == ["postgres", "flexible-server", "show"]:
            return {"id": "/sub/pg", "sku": {"name": "Standard_B1ms"}, "storage": {"storageSizeGb": 32}}
        if argumentos[:2] == ["containerapp", "show"]:
            return {"id": "/sub/api", "properties": {"template": {"scale": {"maxReplicas": 2}, "containers": [{"resources": {"memory": "1Gi"}}]}}}
        if argumentos[:3] == ["storage", "account", "show"]:
            return {"id": "/sub/st"}
        if argumentos[:3] == ["monitor", "metrics", "list"]:
            nomes = argumentos[argumentos.index("--metrics") + 1:argumentos.index("--interval")]
            valor = {"cpu_credits_remaining": 303, "RestartCount": 0, "connections_failed": 0, "Replicas": 1}
            return {"value": [{"name": {"value": n}, "timeseries": [{"data": _serie([valor.get(n, 10)] * 24)}]} for n in nomes]}
        raise AssertionError(argumentos)


def test_so_le_e_pede_o_periodo_com_comeco_e_fim():
    """O `az monitor metrics list` sem --end-time devolve só UMA hora (achado ao medir em 2026-11-03)."""
    az = AzFalso()
    medidas = rd.medir(az, "homologacao", 90, agora=dt.datetime(2026, 11, 3, 12, tzinfo=dt.timezone.utc))
    assert all("show" in p[:3] or p[:3] == ["monitor", "metrics", "list"] for p in az.pedidos), "só leitura"
    assert ["containerapp", "show", "-g", "Associacao-RG", "-n", "asaf-api-hml"] in az.pedidos
    for pedido in (p for p in az.pedidos if p[0] == "monitor"):
        assert pedido[pedido.index("--start-time") + 1] == "2026-08-05T12:00:00Z" and pedido[pedido.index("--end-time") + 1] == "2026-11-03T12:00:00Z"
    assert medidas["api_max_copias"] == 2 and medidas["api_memoria_gib"] == 1.0


def test_o_relatorio_sai_sem_banco_e_diz_quando_nao_leu(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    saida_do_github = tmp_path / "saida.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(saida_do_github))
    assert rd.main(["--ambiente", "homologacao", "--dias", "7", "--saida", str(tmp_path / "r.md")], az=AzFalso()) == 0
    texto = (tmp_path / "r.md").read_text(encoding="utf-8")
    assert "Nenhum gatilho atingido" in texto and "Não lido (sem DATABASE_URL)" in texto and "| CPU | 10.0% |" in texto
    assert saida_do_github.read_text(encoding="utf-8") == "alertas=0\n"


def test_erro_do_banco_sai_so_com_o_tipo(tmp_path, monkeypatch):
    """O registro é público: a mensagem do erro (que pode trazer o endereço do servidor) fica de fora."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:senha-secreta@127.0.0.1:1/asaf_hml?connect_timeout=1")
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    assert rd.main(["--ambiente", "homologacao", "--dias", "7", "--saida", str(tmp_path / "r.md")], az=AzFalso()) == 0
    texto = (tmp_path / "r.md").read_text(encoding="utf-8")
    assert "Não deu para ler: OperationalError." in texto and "senha-secreta" not in texto and "127.0.0.1" not in texto


def test_dias_fora_do_que_o_azure_guarda_e_recusado():
    with pytest.raises(SystemExit):
        rd.main(["--ambiente", "producao", "--dias", "120"], az=AzFalso())


def test_a_rotina_e_trimestral_a_mao_comeca_na_homologacao_e_so_avisa_na_producao():
    texto = FLUXO.read_text(encoding="utf-8")
    assert 'cron: "0 12 15 1,4,7,10 *"' in texto
    assert "default: homologacao" in texto and "AMBIENTE: ${{ inputs.ambiente || 'producao' }}" in texto
    assert "if: env.AMBIENTE == 'producao' && steps.revisao.outputs.alertas != '0'" in texto
    assert "*/asaf_hml\\?*) ;;" in texto, "à mão na homologação, confere que o banco é mesmo o de teste"
    assert "contents: write" not in texto and "pull-requests" not in texto


def test_api_que_so_acordou_nao_conta_como_no_maximo():
    """Achado na primeira rodada na homologação (máximo de 1 cópia): toda hora em que a API acordou tinha pico 1 = o máximo, e o gatilho disparava em 43% das
    horas. Conta a média da hora: acordar por 10 minutos dá média abaixo de 1."""
    acordou = [{"average": 0.2, "maximum": 1, "minimum": 0} for _ in range(300)] + [{"average": 0, "maximum": 0, "minimum": 0} for _ in range(400)]
    medidas = _medidas(api__Replicas=acordou)
    medidas["api_max_copias"] = 1
    assert rd.avaliar(medidas, None, G) == []
    trocando_de_versao = [{"average": 1.01, "maximum": 2, "minimum": 1} for _ in range(10)] + [{"average": 0, "maximum": 0, "minimum": 0}] * 700
    medidas["api"]["Replicas"] = trocando_de_versao
    medidas["api_max_copias"] = 2
    assert rd.avaliar(medidas, None, G) == []


def test_a_migracao_do_registro_das_consultas_nao_derruba_quem_nao_pode_instalar():
    """v8.5: a extensão entra por migração (homologação primeiro); o papel do banco de teste não pode criar extensão, e a migração não pode falhar por isso."""
    import importlib.util

    import sqlalchemy as sa
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from alembic.script import ScriptDirectory

    caminho = RAIZ / "alembic" / "versions" / "ccf5cbf31408_v8_5_registro_das_consultas.py"
    especificacao = importlib.util.spec_from_file_location("migracao_consultas", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    assert "EXCEPTION WHEN OTHERS" in migracao.CRIAR and "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" in migracao.CRIAR
    motor = sa.create_engine("sqlite://")
    with motor.begin() as conexao, Operations.context(MigrationContext.configure(conexao)):
        migracao.upgrade()  # no SQLite não faz nada
        migracao.downgrade()
    config = Config()
    config.set_main_option("script_location", str(RAIZ / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1 and diretorio.get_revision("ccf5cbf31408").down_revision == "d75b1a9e4c72"
