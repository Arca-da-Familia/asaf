import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Request } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao, ver } from './apoio'

// v9.2b - A META DA API, MEDIDA: 95% das leituras mais usadas respondem em menos de 500 ms (o p95) NO SERVIDOR. O robô entra como Presidente e abre as telas
// do dia a dia várias vezes, anotando, para cada leitura (GET) que o PRÓPRIO painel faz à API de teste, o tempo que o servidor diz que levou (cabeçalho
// Server-Timing, app/main.py) e, só para informação, o tempo total visto pelo navegador. Por que o do servidor: a máquina do GitHub fica fora do Brasil e só a
// viagem da rede gasta 300 a 500 ms em QUALQUER leitura (até na lista fixa de tipos de documento); quem usa em Belém não tem essa viagem. A 1ª volta só acorda
// a API (ela dorme sem uso) e fica de fora. Reprova se o p95 do servidor de alguma rota passar do limite; o relatório com cada rota vai anexado.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const TELAS = [
  '/',
  '/associados',
  '/financeiro/titulos',
  '/financeiro',
  '/eventos',
  '/atendimentos',
  '/comunicacao',
  '/meus-avisos',
  '/documentos',
  '/governanca',
]
// 20 leituras de cada rota: com menos, o "95%" é só a leitura mais lenta (um soluço reprovaria)
const VOLTAS = 20
export const LIMITE_P95_MS = 500

/** /api/associados/12/fotos?pagina=2 -> /api/associados/:n/fotos */
export function rotaDe(url: string): string {
  return new URL(url).pathname.replace(/\/\d+(?=\/|$)/g, '/:n')
}

export function p95(tempos: number[]): number {
  const ordem = [...tempos].sort((a, b) => a - b)
  return ordem[Math.max(0, Math.ceil(ordem.length * 0.95) - 1)] ?? 0
}

/** "app;dur=12.3" -> 12.3 */
export function tempoDoServidor(cabecalho: string | undefined): number | null {
  const m = /(?:^|,)\s*app;dur=([\d.]+)/.exec(cabecalho ?? '')
  return m ? Number(m[1]) : null
}

test('as leituras mais usadas respondem em menos de 500 ms no servidor (p95)', async ({
  page,
}, info) => {
  test.setTimeout(60 * 60_000)
  let contando = false
  const doServidor = new Map<string, number[]>()
  const totais = new Map<string, number[]>()
  const pendentes: Promise<void>[] = []
  const anotar = (mapa: Map<string, number[]>, rota: string, ms: number) =>
    mapa.set(rota, [...(mapa.get(rota) ?? []), ms])
  page.on('requestfinished', (pedido: Request) => {
    if (
      !contando ||
      pedido.method() !== 'GET' ||
      !pedido.url().startsWith(API_HML)
    )
      return
    const rota = rotaDe(pedido.url())
    const total = pedido.timing().responseEnd
    if (total > 0) anotar(totais, rota, total)
    pendentes.push(
      pedido.response().then((resposta) => {
        const ms = tempoDoServidor(resposta?.headers()['server-timing'])
        if (ms !== null) anotar(doServidor, rota, ms)
      }),
    )
  })

  await entrar(page, 'presidente')
  for (let volta = 0; volta <= VOLTAS; volta++) {
    contando = volta > 0 // a volta 0 acorda a API
    for (const tela of TELAS) {
      await page.goto(tela)
      await page.waitForLoadState('networkidle')
      await expect(
        page.getByText(/^Carregando/).filter({ visible: true }),
      ).toHaveCount(0, { timeout: 60_000 })
    }
  }
  await Promise.all(pendentes)

  const linhas = [...doServidor.entries()]
    .map(([rota, ms]) => ({
      rota,
      vezes: ms.length,
      p95: Math.round(p95(ms)),
      maximo: Math.round(Math.max(...ms)),
      p95Total: Math.round(p95(totais.get(rota) ?? [0])),
    }))
    .sort((a, b) => b.p95 - a.p95)
  const lentas = linhas.filter((l) => l.vezes >= 15 && l.p95 > LIMITE_P95_MS)
  const pasta = path.join('prints-hml', 'v9.2b-01-tempo-da-api')
  fs.mkdirSync(pasta, { recursive: true })
  const relatorio = path.join(pasta, 'tempo-das-leituras.txt')
  fs.writeFileSync(
    relatorio,
    [
      `Leituras da API em ${VOLTAS} voltas por ${TELAS.length} telas (a 1ª volta, que acorda a API, fica de fora). Meta: p95 do SERVIDOR até ${LIMITE_P95_MS} ms.`,
      'rota | vezes | p95 no servidor (ms) | máximo no servidor (ms) | p95 visto da máquina do GitHub, com a rede (ms)',
      ...linhas.map(
        (l) =>
          `${l.rota} | ${l.vezes} | ${l.p95} | ${l.maximo} | ${l.p95Total}`,
      ),
    ].join('\n'),
    'utf-8',
  )
  await info.attach('tempo-das-leituras', {
    path: relatorio,
    contentType: 'text/plain',
  })
  await ver(page, info, 'ultima-tela')
  expect(
    linhas.length,
    'o robô quase não viu leitura (ou a API não manda o Server-Timing)',
  ).toBeGreaterThanOrEqual(10)
  expect(
    lentas.map(
      (l) => `${l.rota}: p95 ${l.p95} ms no servidor em ${l.vezes} leituras`,
    ),
    linhas
      .map((l) => `${l.rota} servidor p95 ${l.p95} | com a rede ${l.p95Total}`)
      .join('\n'),
  ).toEqual([])
})
