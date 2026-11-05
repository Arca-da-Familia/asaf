import fs from 'node:fs'
import path from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { entrar, exigirHomologacao, ver } from './apoio'
import { esperarATela, linksInternos, padrao, PULAR } from './varredura'

// v9.1a - ACESSIBILIDADE DO PAINEL num navegador de verdade, com o dado da homologação (WCAG 2.2 nível AA como meta). Os testes do painel no CI (jest-axe)
// rodam num navegador simulado, que NÃO mede contraste de cor nem o que só aparece com dado de verdade; aqui o robô entra como Presidente (quem vê quase tudo),
// abre TODAS as telas que achar seguindo os links do próprio painel (menu e abas, e a primeira ficha de cada tipo: /associados/12 representa todas), e passa o
// axe em cada uma, no computador e no tamanho de celular. Violação GRAVE (serious/critical) reprova; as demais vão para o relatório anexado.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const GRAVES = new Set(['serious', 'critical'])
const LIMITE = 220
type Achado = {
  caminho: string
  largura: string
  regra: string
  impacto: string
  ajuda: string
  onde: string
}

async function auditar(
  page: Page,
  caminho: string,
  largura: string,
): Promise<Achado[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  return violations.map((v) => ({
    caminho,
    largura,
    regra: v.id,
    impacto: v.impact ?? 'sem impacto',
    ajuda: v.help,
    onde: v.nodes
      .slice(0, 5)
      .map((n) => n.target.join(' '))
      .join(' | '),
  }))
}

test('todas as telas do painel passam no axe (WCAG 2.2 AA), no computador e no celular', async ({
  page,
}, info) => {
  test.setTimeout(60 * 60_000)
  await entrar(page, 'presidente')
  const visitados = new Set<string>()
  const fila: string[] = ['/']
  const achados: Achado[] = []
  const naoAbriram: string[] = []
  while (fila.length > 0 && visitados.size < LIMITE) {
    const caminho = fila.shift()!
    if (PULAR.test(caminho) || visitados.has(padrao(caminho))) continue
    visitados.add(padrao(caminho))
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(caminho)
    try {
      await esperarATela(page)
    } catch {
      naoAbriram.push(`${caminho}: ficou em "Carregando"`)
      continue
    }
    if (new URL(page.url()).pathname === '/login')
      throw new Error(`a sessão caiu ao abrir ${caminho}`)
    achados.push(...(await auditar(page, caminho, 'computador')))
    for (const link of await linksInternos(page)) {
      if (!visitados.has(padrao(link)) && !PULAR.test(link)) fila.push(link)
    }
    await page.setViewportSize({ width: 375, height: 740 })
    await esperarATela(page)
    achados.push(...(await auditar(page, caminho, 'celular')))
  }

  const graves = achados.filter((a) => GRAVES.has(a.impacto))
  const linhas = achados.map(
    (a) =>
      `${a.impacto.toUpperCase()} ${a.regra} [${a.largura}] ${a.caminho}: ${a.ajuda} -> ${a.onde}`,
  )
  const pasta = path.join('prints-hml', 'v9.1a-01-acessibilidade-do-painel')
  fs.mkdirSync(pasta, { recursive: true })
  const relatorio = path.join(pasta, 'achados-do-axe.txt')
  fs.writeFileSync(
    relatorio,
    [
      `${visitados.size} telas visitadas (cada uma no computador e no celular):`,
      ...[...visitados].sort(),
      '',
      `${achados.length} achados:`,
      ...linhas,
      '',
      ...naoAbriram,
    ].join('\n'),
    'utf-8',
  )
  await info.attach('achados-do-axe', {
    path: relatorio,
    contentType: 'text/plain',
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await ver(page, info, 'inicio-depois-da-varredura')

  expect(
    visitados.size,
    'o robô achou poucas telas: o menu mudou?',
  ).toBeGreaterThanOrEqual(60)
  expect(naoAbriram, naoAbriram.join('\n')).toEqual([])
  expect(
    graves.map((a) => `${a.regra} [${a.largura}] ${a.caminho} -> ${a.onde}`),
    linhas.join('\n'),
  ).toEqual([])
})
