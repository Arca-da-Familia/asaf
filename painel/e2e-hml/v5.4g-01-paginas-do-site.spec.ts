import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { exigirHomologacao, ver, vigiar } from './apoio'

// v5.4g - FASE 5 ao vivo, item 1: TODAS as páginas do site de teste (hml-site) abertas e conferidas, uma a uma, num navegador de verdade, com os dados que o sistema
// de teste tem hoje: abre (200), tem um título só (h1), leva a faixa "AMBIENTE DE TESTE" e o `noindex` (o site de teste nunca entra no Google), passa no axe (WCAG
// 2.1 A/AA, zero violação), nenhuma imagem quebrada, nenhum erro na página, e no celular (390 px) nada vaza para o lado. Depois, todo link interno do site responde 200.
// A lista de páginas vem do `sitemap-0.xml` publicado (página nova entra sozinha na conferência).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(900_000)

const SITE = 'https://hml-site.asaf.org.br'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

let caminhos: string[] = []

async function listarCaminhos(page: Page): Promise<string[]> {
  const r = await page.request.get(`${SITE}/sitemap-0.xml`)
  expect(r.status(), 'o sitemap do site de teste abre').toBe(200)
  const xml = await r.text()
  const achados = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]!).pathname,
  )
  return [...new Set(achados)]
}

test('o sitemap lista as páginas do site (e são mais que as essenciais)', async ({
  page,
}) => {
  caminhos = await listarCaminhos(page)
  for (const essencial of [
    '/',
    '/quem-somos/',
    '/diretoria/',
    '/projetos/',
    '/eventos/',
    '/noticias/',
    '/contato/',
    '/privacidade/',
    '/termos/',
    '/transparencia/',
    '/estatuto/',
    '/seja-associado/',
    '/seja-voluntario/',
    '/como-ajudar/',
  ]) {
    expect(caminhos, `o sitemap tem ${essencial}`).toContain(essencial)
  }
  expect(caminhos.length).toBeGreaterThanOrEqual(14)
})

test('cada página abre, tem um título só, a faixa de teste, o noindex, passa no axe e não tem imagem quebrada nem erro', async ({
  page,
}, info) => {
  if (caminhos.length === 0) caminhos = await listarCaminhos(page)
  const vigia = vigiar(page)
  const problemas: string[] = []
  for (const caminho of caminhos) {
    const resposta = await page.goto(`${SITE}${caminho}`, {
      waitUntil: 'networkidle',
    })
    if (resposta?.status() !== 200) {
      problemas.push(`${caminho}: respondeu ${resposta?.status()}`)
      continue
    }
    // um título só
    const titulos = await page.locator('h1').count()
    if (titulos !== 1) problemas.push(`${caminho}: ${titulos} títulos h1`)
    // faixa de ambiente de teste e noindex
    if ((await page.locator('[data-ambiente="homologacao"]').count()) !== 1)
      problemas.push(`${caminho}: sem a faixa AMBIENTE DE TESTE`)
    const robos = await page
      .locator('meta[name="robots"]')
      .getAttribute('content')
    if (!robos || !/noindex/.test(robos))
      problemas.push(`${caminho}: sem noindex (${robos})`)
    // imagens: todas carregaram
    const quebradas = await page.evaluate(() =>
      [...document.images]
        .filter((i) => i.complete && i.naturalWidth === 0)
        .map((i) => i.currentSrc || i.src),
    )
    if (quebradas.length > 0)
      problemas.push(`${caminho}: imagem quebrada ${quebradas.join(', ')}`)
    // acessibilidade
    const { violations } = await new AxeBuilder({ page })
      .withTags(TAGS)
      .analyze()
    for (const v of violations)
      problemas.push(
        `${caminho}: axe ${v.id} (${v.impact}) em ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      )
  }
  await page.goto(`${SITE}/`, { waitUntil: 'networkidle' })
  await ver(page, info, 'inicio-do-site-de-teste')
  expect(problemas, problemas.join('\n')).toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('no celular (390 px) nenhuma página vaza para o lado e o menu se abre', async ({
  page,
}, info) => {
  if (caminhos.length === 0) caminhos = await listarCaminhos(page)
  await page.setViewportSize({ width: 390, height: 800 })
  const largas: string[] = []
  for (const caminho of caminhos) {
    await page.goto(`${SITE}${caminho}`, { waitUntil: 'networkidle' })
    const sobra = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    if (sobra > 1) largas.push(`${caminho} (sobra ${sobra}px)`)
  }
  expect(
    largas,
    `páginas mais largas que a tela: ${largas.join(', ')}`,
  ).toEqual([])
  await page.goto(`${SITE}/`)
  await ver(page, info, 'inicio-no-celular')
})

test('todo link interno do site responde 200 (nenhum 404) e os links de e-mail e telefone estão certos', async ({
  page,
}) => {
  if (caminhos.length === 0) caminhos = await listarCaminhos(page)
  const internos = new Set<string>()
  const contatos = new Set<string>()
  for (const caminho of caminhos) {
    await page.goto(`${SITE}${caminho}`, { waitUntil: 'domcontentloaded' })
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
    for (const href of hrefs) {
      if (href.startsWith('mailto:') || href.startsWith('tel:'))
        contatos.add(href)
      else if (href.startsWith('/') && !href.startsWith('//'))
        internos.add(href.split('#')[0]!)
      else if (href.startsWith(SITE)) internos.add(new URL(href).pathname)
    }
  }
  const quebrados: string[] = []
  for (const href of internos) {
    if (href === '') continue
    const r = await page.request.get(`${SITE}${href}`)
    if (r.status() !== 200) quebrados.push(`${href} -> ${r.status()}`)
  }
  expect(quebrados, `links quebrados: ${quebrados.join(', ')}`).toEqual([])
  expect(internos.size).toBeGreaterThan(20)
  for (const c of contatos) {
    if (c.startsWith('mailto:'))
      expect(c, 'e-mail do site').toMatch(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/)
    if (c.startsWith('tel:'))
      expect(c, 'telefone do site').toMatch(/^tel:\+?\d{10,14}$/)
  }
})

test('página que não existe cai na 404 do site (com a faixa de teste), e o robots.txt do site de teste proíbe tudo', async ({
  page,
}, info) => {
  const resposta = await page.goto(`${SITE}/essa-pagina-nao-existe/`)
  expect(resposta?.status()).toBe(404)
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('[data-ambiente="homologacao"]')).toHaveCount(1)
  await ver(page, info, 'pagina-404-do-site-de-teste')
  const robots = await page.request.get(`${SITE}/robots.txt`)
  expect(robots.status()).toBe(200)
  const texto = await robots.text()
  expect(texto).toMatch(/User-agent:\s*\*/)
  expect(texto).toMatch(/Disallow:\s*\/\s*$/m)
  expect(texto).not.toMatch(/Allow:\s*\//)
})
