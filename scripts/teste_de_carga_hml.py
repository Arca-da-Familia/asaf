"""Teste de CARGA da HOMOLOGAÇÃO (nunca da produção): muita gente se inscrevendo num evento público ao mesmo tempo.

    python scripts/teste_de_carga_hml.py --pessoas 150 --vagas 100 --rampa 60 --preenchimento 20

O que ele simula, como a meta do plano (FASE 5, "site e carga"): ~150 pessoas por minuto chegando, cada uma abrindo a lista de eventos e a página do evento,
levando uns 20 segundos preenchendo o formulário (daí as 50 a 100 pessoas "ao mesmo tempo") e enviando a inscrição pública, cada uma de um IP próprio, como na
vida real. Mais um grupo atrás do MESMO IP (a secretaria de uma igreja) e alguns cliques duplos (a mesma pessoa enviando duas vezes quase junto).

O que ele confere (e reprova, com código de saída 1, se falhar):
  - nenhuma resposta 5xx (a API não cai nem devolve erro de servidor);
  - NUNCA mais gente confirmada do que vagas (a trava de vagas aguenta a corrida), e as vagas livres que a página pública mostra batem com isso;
  - quem passou das vagas foi para a lista de espera, ninguém se perdeu;
  - o mesmo CPF não entra duas vezes (o clique duplo vira uma inscrição só);
  - o limite por IP funciona (o grupo atrás do mesmo IP é barrado depois do limite) sem barrar quem vem de IP diferente;
  - tempo de resposta da inscrição: p95 abaixo do limite combinado (`--p95-maximo`, em segundos). A primeira chamada do dia (a API escala a zero) é medida à parte.

Segurança: recusa qualquer endereço que não seja `hml-api.asaf.org.br`; a senha vem do ambiente (`HML_ADMIN_SENHA`), nunca é impressa nem entra no relatório;
só usa dados inventados (CPFs gerados, e-mails @homologacao.example.com)."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import sys
import time
from datetime import datetime, timedelta
from urllib.parse import urlparse

try:  # o projeto usa `httpx2` (requirements.txt); o `httpx` de sempre tem a mesma interface
    import httpx2 as httpx
except ImportError:  # pragma: no cover
    import httpx

HOST_PERMITIDO = "hml-api.asaf.org.br"
URL_PADRAO = f"https://{HOST_PERMITIDO}"
LIMITE_POR_IP = 30  # app/routers/eventos.py::LIMITE_DE_INSCRICOES_POR_IP


def cpf_valido(base: int) -> str:
    """CPF com dígitos verificadores certos (só números), a partir de um número de 9 dígitos (inventado)."""
    digitos = [int(d) for d in str(base).zfill(9)[-9:]]
    for tamanho in (9, 10):
        soma = sum(d * (tamanho + 1 - i) for i, d in enumerate(digitos[:tamanho]))
        digitos.append(((soma * 10) % 11) % 10)
    return "".join(str(d) for d in digitos)


def cpf_do_presidente() -> str:
    """O CPF do presidente de TESTE (o mesmo de `scripts/popular_homologacao.py`, inventado e público): a senha vem do cofre pelo fluxo."""
    return cpf_valido(111000111)


def percentil(valores: list[float], p: float) -> float:
    if not valores:
        return 0.0
    ordenados = sorted(valores)
    posicao = min(len(ordenados) - 1, max(0, int(round(p / 100 * (len(ordenados) - 1)))))
    return ordenados[posicao]


class Medidas:
    def __init__(self) -> None:
        self.tempos: dict[str, list[float]] = {}
        self.status: dict[str, dict[int, int]] = {}

    def anotar(self, nome: str, status: int, segundos: float) -> None:
        self.tempos.setdefault(nome, []).append(segundos)
        contagem = self.status.setdefault(nome, {})
        contagem[status] = contagem.get(status, 0) + 1

    def resumo(self, nome: str) -> dict:
        tempos = self.tempos.get(nome, [])
        return {
            "chamadas": len(tempos), "status": self.status.get(nome, {}),
            "p50_s": round(percentil(tempos, 50), 3), "p95_s": round(percentil(tempos, 95), 3),
            "p99_s": round(percentil(tempos, 99), 3), "maximo_s": round(max(tempos), 3) if tempos else 0.0,
            "media_s": round(statistics.fmean(tempos), 3) if tempos else 0.0,
        }


async def chamar(cliente: httpx.AsyncClient, medidas: Medidas, nome: str, metodo: str, caminho: str, **kwargs) -> httpx.Response | None:
    inicio = time.perf_counter()
    try:
        resposta = await cliente.request(metodo, caminho, **kwargs)
    except httpx.HTTPError:
        medidas.anotar(nome, 0, time.perf_counter() - inicio)  # 0 = nem chegou resposta (rede, tempo esgotado)
        return None
    medidas.anotar(nome, resposta.status_code, time.perf_counter() - inicio)
    return resposta


def corpo_da_inscricao(rodada: int, numero: int, versao: str) -> dict:
    return {
        "nome_completo": f"Carga {numero} Rodada {rodada} de Teste",
        "cpf": cpf_valido(600000000 + (rodada % 100000) * 1000 + numero),
        "email": f"carga.{rodada}.{numero}@homologacao.example.com",
        "telefone": "91988880000",
        "consentimento_lgpd": True,
        "versao_texto_consentimento": versao,
    }


def ip_de(numero: int) -> str:
    """IP de teste de desempenho (198.18.0.0/15): um por pessoa."""
    return f"198.18.{(numero // 250) % 250}.{numero % 250 + 1}"


def ip_do_grupo(rodada: int) -> str:
    """Um IP só para o grupo da secretaria; muda a cada rodada, porque o limite por IP conta as tentativas dos últimos minutos."""
    return f"198.19.{rodada % 250}.7"


async def pessoa(cliente, medidas, numero: int, inicio_s: float, preenchimento_s: float, id_evento: int, versao: str, rodada: int, resultados: list, clique_duplo: bool):
    await asyncio.sleep(inicio_s)
    cabecalho = {"X-Forwarded-For": ip_de(numero)}
    await chamar(cliente, medidas, "lista_de_eventos", "GET", "/api/publico/eventos", headers=cabecalho)
    await chamar(cliente, medidas, "pagina_do_evento", "GET", f"/api/publico/eventos/{id_evento}", headers=cabecalho)
    await asyncio.sleep(random.uniform(0.5, 1.5) * preenchimento_s)  # a pessoa preenche o formulário
    corpo = corpo_da_inscricao(rodada, numero, versao)
    rota = f"/api/publico/eventos/{id_evento}/inscrever-se"
    envios = [chamar(cliente, medidas, "inscricao", "POST", rota, json=corpo, headers=cabecalho)]
    if clique_duplo:  # a mesma pessoa aperta "enviar" duas vezes quase junto
        envios.append(chamar(cliente, medidas, "inscricao", "POST", rota, json=corpo, headers=cabecalho))
    respostas = await asyncio.gather(*envios)
    resultados.append({"numero": numero, "cpf": corpo["cpf"], "clique_duplo": clique_duplo, "respostas": [resumo_da_resposta(r) for r in respostas]})


def resumo_da_resposta(r: httpx.Response | None) -> dict:
    if r is None:
        return {"status": 0, "situacao": None, "id_inscricao": None}
    if r.status_code != 200:
        return {"status": r.status_code, "situacao": None, "id_inscricao": None}
    corpo = r.json()
    return {"status": 200, "situacao": corpo.get("status"), "id_inscricao": corpo.get("id_inscricao")}


async def principal(args, transporte=None) -> int:
    """`transporte` só existe para o teste automático rodar este mesmo roteiro dentro do processo (sem rede); no uso real é sempre `None`."""
    alvo = urlparse(args.url)
    if alvo.scheme != "https" or alvo.hostname != HOST_PERMITIDO:
        print(f"RECUSADO: o teste de carga só roda contra https://{HOST_PERMITIDO} (recebeu {args.url!r}).")
        return 2
    senha = os.environ.get("HML_ADMIN_SENHA")
    if not senha:
        print("Falta a senha de teste do presidente (variável HML_ADMIN_SENHA, lida do cofre pelo fluxo).")
        return 2

    rodada = int(time.time())
    medidas = Medidas()
    limites = httpx.Limits(max_connections=args.conexoes, max_keepalive_connections=args.conexoes)
    async with httpx.AsyncClient(base_url=args.url, timeout=httpx.Timeout(60.0), limits=limites, transport=transporte) as cliente:
        # 1) a API pode estar dormindo (escala a zero): a primeira chamada acorda; o tempo dela é medido à parte
        inicio = time.perf_counter()
        acordou = await chamar(cliente, medidas, "primeira_chamada", "GET", "/api/publico/eventos")
        frio_s = time.perf_counter() - inicio
        if acordou is None or acordou.status_code != 200:
            print(f"A API de teste não respondeu à primeira chamada (status {acordou.status_code if acordou else 'sem resposta'}).")
            return 1

        # 2) o presidente de teste entra e cria um evento público com poucas vagas perto do número de gente
        presidente = cpf_do_presidente()
        entrada = await chamar(cliente, medidas, "login", "POST", "/auth/login", json={"cpf": presidente, "senha": senha})
        if entrada is None or entrada.status_code != 200 or "access_token" not in entrada.json() or entrada.json().get("requer_mfa"):
            print(f"Não consegui entrar como presidente de teste (status {entrada.status_code if entrada else 'sem resposta'}).")
            return 1
        autorizacao = {"Authorization": f"Bearer {entrada.json()['access_token']}"}
        criado = await chamar(cliente, medidas, "criar_evento", "POST", "/api/eventos/", headers=autorizacao, json={
            "titulo": f"[CARGA] Evento de carga {rodada}", "categoria": "PALESTRA", "visibilidade": "Pública", "vagas": args.vagas,
            "data_hora_inicio": (datetime.utcnow() + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S"),
        })
        if criado is None or criado.status_code != 200:
            print(f"Não consegui criar o evento de carga (status {criado.status_code if criado else 'sem resposta'}).")
            return 1
        id_evento = criado.json()["id_evento"]
        consentimento = await chamar(cliente, medidas, "consentimento", "GET", "/api/publico/eventos/consentimento-lgpd")
        versao = consentimento.json()["versao"] if consentimento is not None and consentimento.status_code == 200 else "1"

        # 3) a multidão: `pessoas` chegando ao longo da rampa, cada uma de um IP; 5% apertam "enviar" duas vezes
        resultados: list[dict] = []
        t0 = time.perf_counter()
        tarefas = []
        duplos = set(random.sample(range(args.pessoas), max(1, args.pessoas // 20)))
        for numero in range(args.pessoas):
            inicio_s = numero * (args.rampa / args.pessoas) + random.uniform(0, 0.5)
            tarefas.append(pessoa(cliente, medidas, numero, inicio_s, args.preenchimento, id_evento, versao, rodada, resultados, numero in duplos))
        await asyncio.gather(*tarefas)
        duracao_s = time.perf_counter() - t0

        # 4) o grupo atrás do MESMO IP (uma secretaria inscrevendo gente): depois do limite, o servidor barra
        grupo: list[dict] = []
        for k in range(LIMITE_POR_IP + 10):
            corpo = corpo_da_inscricao(rodada, 100000 + k, versao)
            r = await chamar(cliente, medidas, "inscricao_mesmo_ip", "POST", f"/api/publico/eventos/{id_evento}/inscrever-se", json=corpo, headers={"X-Forwarded-For": ip_do_grupo(rodada)})
            grupo.append(resumo_da_resposta(r))

        # 5) o que a página pública mostra agora
        pagina = await chamar(cliente, medidas, "pagina_do_evento_final", "GET", f"/api/publico/eventos/{id_evento}")
        vagas_livres = pagina.json().get("vagas_livres") if pagina is not None and pagina.status_code == 200 else None

    # ---- conferência: cada inscrição aceita conta UMA vez (pelo id), mesmo que a resposta tenha vindo duas vezes
    inscricoes: dict[int, str] = {}
    duplicadas = 0
    sem_lugar = 0
    barradas_de_outro_ip = 0
    for p in resultados:
        aceitas = {r["id_inscricao"]: r["situacao"] for r in p["respostas"] if r["status"] == 200 and r["id_inscricao"] is not None}
        if len(aceitas) > 1:
            duplicadas += 1
        if not aceitas:
            sem_lugar += 1
        barradas_de_outro_ip += sum(1 for r in p["respostas"] if r["status"] == 429)
        inscricoes.update(aceitas)
    do_grupo_aceitas = {r["id_inscricao"]: r["situacao"] for r in grupo if r["status"] == 200 and r["id_inscricao"] is not None}
    inscricoes.update(do_grupo_aceitas)
    do_grupo_barradas = sum(1 for r in grupo if r["status"] == 429)
    confirmadas = sum(1 for s in inscricoes.values() if s != "Lista de Espera")
    espera = sum(1 for s in inscricoes.values() if s == "Lista de Espera")

    todas = {k: medidas.resumo(k) for k in medidas.tempos}
    erros_5xx = sum(n for nome in medidas.status for s, n in medidas.status[nome].items() if s >= 500)
    sem_resposta = sum(medidas.status[nome].get(0, 0) for nome in medidas.status)
    p95 = todas.get("inscricao", {}).get("p95_s", 0.0)

    falhas: list[str] = []
    if erros_5xx:
        falhas.append(f"{erros_5xx} resposta(s) de erro de servidor (5xx)")
    if sem_resposta:
        falhas.append(f"{sem_resposta} chamada(s) sem resposta (rede ou tempo esgotado)")
    if duplicadas:
        falhas.append(f"{duplicadas} pessoa(s) com DUAS inscrições diferentes (o clique duplo criou duplicidade)")
    if confirmadas > args.vagas:
        falhas.append(f"{confirmadas} confirmadas para {args.vagas} vagas: as vagas estouraram")
    if len(inscricoes) >= args.vagas and confirmadas < args.vagas:
        falhas.append(f"só {confirmadas} confirmadas para {args.vagas} vagas, com gente na lista de espera: sobrou vaga vazia")
    if vagas_livres is None:
        falhas.append("a página pública do evento não respondeu no fim")
    elif vagas_livres != max(0, args.vagas - confirmadas):
        falhas.append(f"a página pública diz {vagas_livres} vagas livres, mas deveria dizer {max(0, args.vagas - confirmadas)} ({confirmadas} confirmadas de {args.vagas})")
    if sem_lugar:
        falhas.append(f"{sem_lugar} pessoa(s) não conseguiram se inscrever (nem vaga, nem lista de espera)")
    if barradas_de_outro_ip:
        falhas.append(f"{barradas_de_outro_ip} inscrição(ões) de IP diferente barradas pelo limite por IP")
    if len(do_grupo_aceitas) != LIMITE_POR_IP or do_grupo_barradas != 10:
        falhas.append(
            f"o grupo atrás do mesmo IP teve {len(do_grupo_aceitas)} aceitas e {do_grupo_barradas} barradas "
            f"(esperado: {LIMITE_POR_IP} aceitas e 10 barradas, em {LIMITE_POR_IP + 10} envios)"
        )
    if p95 > args.p95_maximo:
        falhas.append(f"p95 da inscrição {p95} s passou do limite combinado de {args.p95_maximo} s")

    relatorio = {
        "rodada": rodada, "id_evento": id_evento, "pessoas": args.pessoas, "vagas": args.vagas, "rampa_s": args.rampa, "preenchimento_s": args.preenchimento,
        "chegada_por_minuto": round(args.pessoas / args.rampa * 60, 1), "primeira_chamada_s": round(frio_s, 2), "duracao_da_multidao_s": round(duracao_s, 1),
        "inscricoes_distintas": len(inscricoes), "confirmadas": confirmadas, "lista_de_espera": espera,
        "grupo_mesmo_ip_aceitas": len(do_grupo_aceitas), "grupo_mesmo_ip_barradas": do_grupo_barradas,
        "vagas_livres_na_pagina_publica": vagas_livres, "cliques_duplos_com_duas_inscricoes": duplicadas,
        "medidas": todas, "falhas": falhas,
    }
    if args.saida:
        with open(args.saida, "w", encoding="utf-8") as arquivo:
            json.dump(relatorio, arquivo, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in relatorio.items() if k != "medidas"}, ensure_ascii=False, indent=2))
    for nome, valores in todas.items():
        print(f"  {nome:24} {valores['chamadas']:5} chamadas  p50 {valores['p50_s']:6.2f}s  p95 {valores['p95_s']:6.2f}s  p99 {valores['p99_s']:6.2f}s  máx {valores['maximo_s']:6.2f}s  {valores['status']}")
    print("RESULTADO:", "REPROVADO" if falhas else "APROVADO")
    for falha in falhas:
        print("  -", falha)
    return 1 if falhas else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Teste de carga da homologação (inscrição pública em evento).")
    parser.add_argument("--url", default=URL_PADRAO)
    parser.add_argument("--pessoas", type=int, default=150, help="quantas pessoas se inscrevem")
    parser.add_argument("--vagas", type=int, default=100, help="vagas do evento de carga (menos que as pessoas, para provar a lista de espera)")
    parser.add_argument("--rampa", type=float, default=60.0, help="em quantos segundos as pessoas chegam (150 em 60 s = 150 por minuto)")
    parser.add_argument("--preenchimento", type=float, default=20.0, help="segundos que cada pessoa leva preenchendo o formulário (em média)")
    parser.add_argument("--conexoes", type=int, default=200)
    parser.add_argument("--p95-maximo", type=float, default=5.0, help="limite do p95 da inscrição, em segundos")
    parser.add_argument("--saida", default="", help="arquivo JSON do relatório")
    args = parser.parse_args()
    if args.pessoas < 1 or args.vagas < 1:
        print("--pessoas e --vagas precisam ser pelo menos 1.")
        return 2
    return asyncio.run(principal(args))


if __name__ == "__main__":
    sys.exit(main())
