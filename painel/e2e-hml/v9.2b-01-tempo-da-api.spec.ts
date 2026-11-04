import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao, ver } from './apoio'

// v9.2b - A META DA API, MEDIDA: 95% das leituras mais usadas respondem em menos de 500 ms (o p95). O robô entra como Presidente e abre as telas do dia a
// dia várias vezes, anotando o tempo de cada leitura (GET) que o PRÓPRIO painel faz à API de teste, como o navegador a vê (inclui a rede da máquina do
// GitHub até o Brasil). A 1ª volta só acorda a API (ela dorme sem uso: a primeira chamada leva segundos, e isso é o custo de não pagar uma cópia acordada,
// não lentidão) e fica de fora da conta. Reprova se o p95 de alguma rota passar do limite; o relatório com cada rota vai anexado.
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
// 20 leituras de cada rota: com menos, o "95%" é só a leitura mais lenta (um soluço da rede reprovaria)
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

test('as leituras mais usadas respondem em menos de 500 ms (p95)', async ({
  page,
}, info) => {
  test.setTimeout(60 * 60_000)
  let contando = false
  const tempos = new Map<string, number[]>()
  page.on('requestfinished', (pedido) => {
    if (
      !contando ||
      pedido.method() !== 'GET' ||
      !pedido.url().startsWith(API_HML)
    )
      return
    const t = pedido.timing()
    // do pedido sair até a resposta terminar de chegar
    const ms = t.responseEnd
    if (ms <= 0) return
    const rota = rotaDe(pedido.url())
    tempos.set(rota, [...(tempos.get(rota) ?? []), ms])
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

  const linhas = [...tempos.entries()]
    .map(([rota, ms]) => ({
      rota,
      vezes: ms.length,
      p95: Math.round(p95(ms)),
      maximo: Math.round(Math.max(...ms)),
    }))
    .sort((a, b) => b.p95 - a.p95)
  const lentas = linhas.filter((l) => l.vezes >= 15 && l.p95 > LIMITE_P95_MS)
  const pasta = path.join('prints-hml', 'v9.2b-01-tempo-da-api')
  fs.mkdirSync(pasta, { recursive: true })
  const relatorio = path.join(pasta, 'tempo-das-leituras.txt')
  fs.writeFileSync(
    relatorio,
    [
      `Leituras da API medidas em ${VOLTAS} voltas por ${TELAS.length} telas (a 1ª volta, que acorda a API, fica de fora). Limite do p95: ${LIMITE_P95_MS} ms.`,
      'rota | vezes | p95 (ms) | máximo (ms)',
      ...linhas.map((l) => `${l.rota} | ${l.vezes} | ${l.p95} | ${l.maximo}`),
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
    'o robô quase não viu leitura: as telas mudaram?',
  ).toBeGreaterThanOrEqual(10)
  expect(
    lentas.map((l) => `${l.rota}: p95 ${l.p95} ms em ${l.vezes} leituras`),
    linhas.map((l) => `${l.rota} p95 ${l.p95}`).join('\n'),
  ).toEqual([])
})
