"""v8.5 (FASE 8) - a REVISÃO DE DESEMPENHO: mede o período (90 dias por padrão) e compara com os gatilhos de escala (infra/config/gatilhos-de-escala.env).

Roda a cada 3 meses pela rotina .github/workflows/revisao-de-desempenho.yml (ou à mão). SÓ LÊ: as métricas do Azure (banco, API, arquivos) e, no banco, as
estatísticas que o próprio Postgres guarda (tamanho, índices nunca usados, tabelas lidas sem índice e, se o `pg_stat_statements` estiver gravando, as
consultas mais pesadas). Nada é escrito no banco: a sessão é aberta só para leitura.

O registro das execuções é PÚBLICO (repositório público), então o relatório só traz números, nomes de tabela e índice (que já estão no código) e o texto das
consultas como o Postgres o guarda (os valores trocados por $1, $2...); por garantia, qualquer texto entre aspas vira ?, e comando que não seja de leitura ou
gravação de dados (ALTER, CREATE...) fica de fora, porque pode trazer valor literal.

Uso:  python scripts/revisao_de_desempenho.py --ambiente producao|homologacao [--dias 90] [--saida relatorio.md]
      (precisa do `az` logado; DATABASE_URL no ambiente para a parte do banco - sem ela, só as métricas)"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional

RAIZ = Path(__file__).resolve().parent.parent
GATILHOS = RAIZ / "infra" / "config" / "gatilhos-de-escala.env"
GRUPO = "Associacao-RG"
SERVIDOR = "asaf-pg-server"
API = {"producao": "asaf-api", "homologacao": "asaf-api-hml"}
ARQUIVOS = {"producao": "stasafprivado", "homologacao": "stasafhmlprivado"}

METRICAS_DO_BANCO = ["cpu_percent", "memory_percent", "active_connections", "storage_percent", "cpu_credits_remaining", "connections_failed"]
METRICAS_DA_API = ["Replicas", "Requests", "WorkingSetBytes", "RestartCount"]
GIB = 1024 ** 3

Az = Callable[[list[str]], object]


def ler_gatilhos(arquivo: Path = GATILHOS) -> dict[str, int]:
    gatilhos = {}
    for linha in arquivo.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#"):
            nome, valor = linha.split("=", 1)
            gatilhos[nome] = int(valor)
    return gatilhos


def az_real(argumentos: list[str]) -> object:
    executavel = shutil.which("az") or "az"
    r = subprocess.run([executavel, *argumentos, "-o", "json"], capture_output=True, text=True, encoding="utf-8", timeout=300,
                       env={**os.environ, "MSYS_NO_PATHCONV": "1"})
    if r.returncode != 0:
        raise RuntimeError(f"az {argumentos[0]} {argumentos[1]} falhou (código {r.returncode})")
    return json.loads(r.stdout or "null")


# ---------------------------------------------------------------- métricas do Azure

def resumir(pontos: list[dict], limite: Optional[float] = None) -> dict:
    """Uma série hora a hora vira: horas com dado, média, o valor abaixo do qual ficam 95% das horas, pico, mínimo e quantas horas passaram do limite."""
    medias = sorted(p["average"] for p in pontos if p.get("average") is not None)
    picos = [p["maximum"] for p in pontos if p.get("maximum") is not None]
    minimos = [p["minimum"] for p in pontos if p.get("minimum") is not None]
    totais = [p["total"] for p in pontos if p.get("total") is not None]
    if not medias and not totais:
        return {"horas": 0}
    r = {"horas": max(len(medias), len(totais)), "total": sum(totais)}
    if medias:
        r.update(media=sum(medias) / len(medias), p95=medias[max(0, -(-len(medias) * 95 // 100) - 1)])
    r["pico"] = max(picos) if picos else (max(medias) if medias else 0)
    r["minimo"] = min(minimos) if minimos else (min(medias) if medias else 0)
    if limite is not None and medias:
        r["horas_acima"] = sum(1 for m in medias if m > limite)
    return r


def ler_metricas(az: Az, recurso: str, nomes: list[str], inicio: str, fim: str) -> dict[str, list[dict]]:
    dados = az(["monitor", "metrics", "list", "--resource", recurso, "--metrics", *nomes, "--interval", "PT1H", "--start-time", inicio,
                "--end-time", fim, "--aggregation", "Average", "Maximum", "Minimum", "Total"])
    series = {}
    for item in (dados or {}).get("value", []):
        series[item["name"]["value"]] = item["timeseries"][0]["data"] if item.get("timeseries") else []
    return series


def medir(az: Az, ambiente: str, dias: int, agora: Optional[dt.datetime] = None) -> dict:
    agora = agora or dt.datetime.now(dt.timezone.utc)
    inicio = (agora - dt.timedelta(days=dias)).strftime("%Y-%m-%dT%H:%M:%SZ")
    fim = agora.strftime("%Y-%m-%dT%H:%M:%SZ")
    banco = az(["postgres", "flexible-server", "show", "-g", GRUPO, "-n", SERVIDOR])
    api = az(["containerapp", "show", "-g", GRUPO, "-n", API[ambiente]])
    conta = az(["storage", "account", "show", "-g", GRUPO, "-n", ARQUIVOS[ambiente]])
    escala = api["properties"]["template"]["scale"]
    memoria = api["properties"]["template"]["containers"][0]["resources"]["memory"]
    return {
        "ambiente": ambiente, "dias": dias, "inicio": inicio, "fim": fim,
        "banco_plano": banco["sku"]["name"], "banco_disco_gb": banco["storage"]["storageSizeGb"],
        "api_max_copias": int(escala.get("maxReplicas") or 1), "api_memoria_gib": float(str(memoria).removesuffix("Gi")),
        "banco": ler_metricas(az, banco["id"], METRICAS_DO_BANCO, inicio, fim),
        "api": ler_metricas(az, api["id"], METRICAS_DA_API, inicio, fim),
        "arquivos": ler_metricas(az, conta["id"], ["UsedCapacity"], inicio, fim),
    }


# ---------------------------------------------------------------- estatísticas do banco

_LEITURA_OU_GRAVACAO = re.compile(r"^\s*(select|insert|update|delete|with)\b", re.IGNORECASE)


def limpar_consulta(texto: str, tamanho: int = 160) -> Optional[str]:
    """O texto de uma consulta pronto para um registro público: None se não for leitura/gravação de dados; aspas viram ?; espaços juntados; cortado."""
    if not texto or not _LEITURA_OU_GRAVACAO.match(texto):
        return None
    texto = re.sub(r"'(?:[^']|'')*'", "?", texto)
    texto = re.sub(r"\$\$.*?\$\$", "?", texto, flags=re.DOTALL)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto if len(texto) <= tamanho else texto[: tamanho - 1] + "…"


CONSULTAS_DO_BANCO = {
    "tamanho": "select pg_database_size(current_database())",
    "desde": "select stats_reset from pg_stat_database where datname = current_database()",
    "maiores": """select schemaname || '.' || relname, pg_total_relation_size(relid), n_live_tup from pg_stat_user_tables
                  order by 2 desc limit 10""",
    "sem_indice": """select schemaname || '.' || relname, seq_scan, coalesce(idx_scan, 0), n_live_tup from pg_stat_user_tables
                     where n_live_tup > :linhas and seq_scan > coalesce(idx_scan, 0) order by seq_tup_read desc limit 10""",
    "indices_sem_uso": """select s.schemaname || '.' || s.relname, s.indexrelname, pg_relation_size(s.indexrelid) from pg_stat_user_indexes s
                          join pg_index i on i.indexrelid = s.indexrelid where s.idx_scan = 0 and not i.indisunique and not i.indisprimary
                          order by 3 desc limit 15""",
    "pss": "select current_setting('pg_stat_statements.track', true), exists (select 1 from pg_extension where extname = 'pg_stat_statements')",
    "pesadas": """select calls, total_exec_time, mean_exec_time, query from pg_stat_statements
                  where dbid = (select oid from pg_database where datname = current_database()) order by total_exec_time desc limit 25""",
}


def estatisticas_do_banco(url: str, gatilhos: dict[str, int]) -> dict:
    from sqlalchemy import create_engine, text

    from app.url_banco import normalizar_url_banco

    motor = create_engine(normalizar_url_banco(url), hide_parameters=True, pool_size=1, max_overflow=0)
    try:
        with motor.connect() as c:
            c.execute(text("set transaction read only"))
            r = {
                "tamanho": c.execute(text(CONSULTAS_DO_BANCO["tamanho"])).scalar(),
                "desde": str(c.execute(text(CONSULTAS_DO_BANCO["desde"])).scalar() or "desde a criação do banco"),
                "maiores": [tuple(l) for l in c.execute(text(CONSULTAS_DO_BANCO["maiores"]))],
                "sem_indice": [tuple(l) for l in c.execute(text(CONSULTAS_DO_BANCO["sem_indice"]), {"linhas": gatilhos["TABELA_LINHAS_PARA_INDICE"]})],
                "indices_sem_uso": [tuple(l) for l in c.execute(text(CONSULTAS_DO_BANCO["indices_sem_uso"]))],
            }
            gravando, instalada = c.execute(text(CONSULTAS_DO_BANCO["pss"])).one()
            r["pss"] = {"gravando": gravando or "desligado", "instalada": bool(instalada)}
            r["pesadas"] = []
            if instalada and gravando not in (None, "none"):
                for calls, total, media, consulta in c.execute(text(CONSULTAS_DO_BANCO["pesadas"])):
                    limpa = limpar_consulta(consulta)
                    if limpa:
                        r["pesadas"].append((int(calls), float(total), float(media), limpa))
                r["pesadas"] = r["pesadas"][:10]
            return r
    finally:
        motor.dispose()


# ---------------------------------------------------------------- os gatilhos

def avaliar(medidas: dict, banco: Optional[dict], g: dict[str, int]) -> list[str]:
    """Os gatilhos atingidos, cada um numa frase com o número e o que fazer (RUNBOOK.md, seção 11). Lista vazia = nada a fazer."""
    alertas = []
    b = {nome: resumir(pontos) for nome, pontos in medidas["banco"].items()}

    def percentual_de_horas(serie: list[dict], limite: float) -> float:
        r = resumir(serie, limite)
        return 100 * r.get("horas_acima", 0) / r["horas"] if r.get("horas") else 0.0

    cpu = percentual_de_horas(medidas["banco"].get("cpu_percent", []), g["BANCO_CPU_MEDIA_HORARIA_MAX"])
    if cpu > g["BANCO_HORAS_ACIMA_PERCENTUAL_MAX"]:
        alertas.append(f"Banco: CPU acima de {g['BANCO_CPU_MEDIA_HORARIA_MAX']}% em {cpu:.1f}% das horas -> subir o plano do banco (seção 11.1).")
    memoria = percentual_de_horas(medidas["banco"].get("memory_percent", []), g["BANCO_MEMORIA_MEDIA_HORARIA_MAX"])
    if memoria > g["BANCO_HORAS_ACIMA_PERCENTUAL_MAX"]:
        alertas.append(f"Banco: memória acima de {g['BANCO_MEMORIA_MEDIA_HORARIA_MAX']}% em {memoria:.1f}% das horas -> subir o plano do banco (seção 11.1).")
    creditos = b.get("cpu_credits_remaining", {})
    if creditos.get("horas") and creditos["minimo"] < g["BANCO_CREDITOS_CPU_MIN"]:
        alertas.append(f"Banco: os créditos de CPU chegaram a {creditos['minimo']:.0f} (mínimo aceito {g['BANCO_CREDITOS_CPU_MIN']}) -> subir o plano (seção 11.1).")
    conexoes = b.get("active_connections", {})
    if conexoes.get("horas") and conexoes["pico"] > g["BANCO_CONEXOES_PICO_MAX"]:
        alertas.append(f"Banco: pico de {conexoes['pico']:.0f} conexões (gatilho {g['BANCO_CONEXOES_PICO_MAX']}, limite 35) -> seção 11.2.")
    recusadas = b.get("connections_failed", {})
    if recusadas.get("total", 0) > 0:
        alertas.append(f"Banco: {recusadas['total']:.0f} conexões recusadas no período -> seção 11.2.")
    disco = b.get("storage_percent", {})
    if disco.get("horas") and disco["pico"] > g["BANCO_DISCO_PERCENTUAL_MAX"]:
        alertas.append(f"Banco: disco em {disco['pico']:.1f}% (gatilho {g['BANCO_DISCO_PERCENTUAL_MAX']}%) -> seção 11.3.")

    # a MÉDIA da hora: o pico conta qualquer hora em que a API acordou (com máximo 1, toda hora acordada "bateu no máximo") e a troca de versão sobe uma
    # cópia a mais por alguns segundos; só a média no máximo mostra uma hora INTEIRA sem folga
    copias = [p.get("average") for p in medidas["api"].get("Replicas", []) if p.get("average") is not None]
    if copias:
        no_maximo = 100 * sum(1 for c in copias if c >= medidas["api_max_copias"]) / len(copias)
        if no_maximo > g["API_HORAS_NO_MAXIMO_PERCENTUAL_MAX"]:
            alertas.append(f"API: no máximo de cópias ({medidas['api_max_copias']}) a hora inteira em {no_maximo:.1f}% das horas -> seção 11.4.")
    memoria_api = resumir(medidas["api"].get("WorkingSetBytes", []))
    if memoria_api.get("horas"):
        uso = 100 * memoria_api["pico"] / (medidas["api_memoria_gib"] * GIB)
        if uso > g["API_MEMORIA_PERCENTUAL_MAX"]:
            alertas.append(f"API: memória chegou a {uso:.0f}% do que cada cópia tem -> seção 11.4.")
    reinicios = resumir(medidas["api"].get("RestartCount", []))
    if reinicios.get("total", 0) > g["API_REINICIOS_MAX"]:
        alertas.append(f"API: {reinicios['total']:.0f} reinícios no período -> ver os registros (seção 3).")

    arquivos = resumir(medidas["arquivos"].get("UsedCapacity", []))
    if arquivos.get("horas") and arquivos["pico"] / GIB > g["ARQUIVOS_GB_MAX"]:
        alertas.append(f"Arquivos: {arquivos['pico'] / GIB:.1f} GB (gatilho {g['ARQUIVOS_GB_MAX']} GB) -> seção 11.3.")

    if banco:
        for tabela, varreduras, por_indice, linhas in banco.get("sem_indice", []):
            alertas.append(f"Consultas: a tabela {tabela} ({linhas} linhas) foi lida {varreduras} vezes por inteiro e {por_indice} por índice -> seção 11.5.")
        for chamadas, _total, media, consulta in banco.get("pesadas", []):
            if media > g["CONSULTA_MEDIA_MS_MAX"] and chamadas > g["CONSULTA_CHAMADAS_MIN"]:
                alertas.append(f"Consultas: {chamadas} chamadas com média de {media:.0f} ms -> seção 11.5: {consulta}")
    return alertas


# ---------------------------------------------------------------- o relatório

def _linha(nome: str, r: dict, unidade: str = "", divisor: float = 1) -> str:
    if not r.get("horas"):
        return f"| {nome} | sem dado | | | |"
    media = f"{r['media'] / divisor:.1f}{unidade}" if "media" in r else "-"
    p95 = f"{r['p95'] / divisor:.1f}{unidade}" if "p95" in r else "-"
    return f"| {nome} | {media} | {p95} | {r['pico'] / divisor:.1f}{unidade} | {r['minimo'] / divisor:.1f}{unidade} |"


def relatorio(medidas: dict, banco: Optional[dict], erro_do_banco: Optional[str], alertas: list[str]) -> str:
    b = {nome: resumir(pontos) for nome, pontos in medidas["banco"].items()}
    a = {nome: resumir(pontos) for nome, pontos in medidas["api"].items()}
    arq = resumir(medidas["arquivos"].get("UsedCapacity", []))
    linhas = [
        f"# Revisão de desempenho ({medidas['ambiente']}, {medidas['dias']} dias: {medidas['inicio'][:10]} a {medidas['fim'][:10]})",
        "",
        "## Gatilhos de escala",
        "",
        *([f"- **ATINGIDO:** {x}" for x in alertas] or ["Nenhum gatilho atingido: nada a fazer até a próxima revisão."]),
        "",
        f"## Banco ({medidas['banco_plano']}, {medidas['banco_disco_gb']} GB; o servidor é o mesmo da produção e da homologação)",
        "",
        "| Medida (por hora) | Média | 95% das horas abaixo de | Pico | Mínimo |",
        "|---|---|---|---|---|",
        _linha("CPU", b.get("cpu_percent", {}), "%"),
        _linha("Memória", b.get("memory_percent", {}), "%"),
        _linha("Conexões abertas", b.get("active_connections", {})),
        _linha("Disco usado", b.get("storage_percent", {}), "%"),
        _linha("Créditos de CPU", b.get("cpu_credits_remaining", {})),
        f"| Conexões recusadas (soma) | {b.get('connections_failed', {}).get('total', 0):.0f} | | | |",
        "",
        f"## API ({API[medidas['ambiente']]}: até {medidas['api_max_copias']} cópia(s) de {medidas['api_memoria_gib']:g} GiB)",
        "",
        "| Medida (por hora) | Média | 95% das horas abaixo de | Pico | Mínimo |",
        "|---|---|---|---|---|",
        _linha("Cópias no ar", a.get("Replicas", {})),
        _linha("Memória (MB)", a.get("WorkingSetBytes", {}), "", 1024 * 1024),
        f"| Pedidos (soma no período) | {a.get('Requests', {}).get('total', 0):.0f} | | | |",
        f"| Reinícios (soma no período) | {a.get('RestartCount', {}).get('total', 0):.0f} | | | |",
        "",
        f"## Arquivos ({ARQUIVOS[medidas['ambiente']]}): {arq.get('pico', 0) / 1024 / 1024:.1f} MB",
        "",
        "## Dentro do banco",
        "",
    ]
    if erro_do_banco:
        linhas.append(f"Não deu para ler: {erro_do_banco}.")
    elif banco is None:
        linhas.append("Não lido (sem DATABASE_URL).")
    else:
        linhas += [f"Tamanho: {banco['tamanho'] / 1024 / 1024:.0f} MB. Estatísticas acumuladas {banco['desde']}.", "",
                   "Maiores tabelas: " + "; ".join(f"{t} {s / 1024 / 1024:.1f} MB ({n} linhas)" for t, s, n in banco["maiores"]) + ".", ""]
        if banco["indices_sem_uso"]:
            linhas.append("Índices nunca usados desde o início das estatísticas (candidatos a remover, se continuarem assim por um ano): "
                          + "; ".join(f"{i} em {t} ({s / 1024:.0f} kB)" for t, i, s in banco["indices_sem_uso"]) + ".")
        else:
            linhas.append("Nenhum índice sem uso.")
        linhas.append("")
        pss = banco["pss"]
        if not pss["instalada"] or pss["gravando"] in ("none", "desligado"):
            linhas.append(f"Consultas mais pesadas: o pg_stat_statements não está gravando neste banco (instalado: {'sim' if pss['instalada'] else 'não'}; "
                          f"gravação: {pss['gravando']}). Como ligar: RUNBOOK.md, seção 11.5.")
        else:
            linhas += ["Consultas mais pesadas (tempo total):", "", "| Chamadas | Total (s) | Média (ms) | Consulta |", "|---|---|---|---|"]
            linhas += [f"| {c} | {t / 1000:.1f} | {m:.1f} | `{q.replace('|', '¦')}` |" for c, t, m, q in banco["pesadas"]]
    return "\n".join(linhas) + "\n"


def main(argv: Optional[list[str]] = None, az: Az = az_real) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--ambiente", choices=sorted(API), required=True)
    p.add_argument("--dias", type=int, default=90)
    p.add_argument("--saida", type=Path)
    args = p.parse_args(argv)
    if not 1 <= args.dias <= 93:
        p.error("--dias entre 1 e 93 (o Azure guarda as métricas por 93 dias)")
    gatilhos = ler_gatilhos()
    medidas = medir(az, args.ambiente, args.dias)
    banco, erro = None, None
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        try:
            banco = estatisticas_do_banco(url, gatilhos)
        except Exception as e:  # noqa: BLE001 - o relatório sai mesmo assim; a mensagem fica de fora (registro público)
            erro = type(e).__name__
    alertas = avaliar(medidas, banco, gatilhos)
    texto = relatorio(medidas, banco, erro, alertas)
    print(texto)
    if args.saida:
        args.saida.write_text(texto, encoding="utf-8")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"alertas={len(alertas)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
