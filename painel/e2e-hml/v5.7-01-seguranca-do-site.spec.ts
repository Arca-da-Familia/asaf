import { expect, test, type Page } from '@playwright/test'

import { exigirHomologacao, ver, vigiar } from './apoio'

// v5.7 - a CONFIANÇA do site de teste (hml-site), do jeito que o Azure o entrega de verdade: cada página responde com os cabeçalhos de segurança (política de conteúdo com a API de
// TESTE e não a de produção, X-Frame-Options, nosniff, permissões, HSTS) e abre sem violar a política num navegador de verdade; nenhum cookie e nenhum servidor de terceiro; ninguém
// consegue embutir o site em outro; o `security.txt` está no ar; a declaração de acessibilidade abre e está no rodapé. A lista de páginas vem do `sitemap-0.xml` publicado.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(600_000)

const SITE = 'https://hml-site.asaf.org.br'
const API_HML = 'https://hml-api.asaf.org.br'
const API_PRODUCAO = 'https://api.asaf.org.br'

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

/** Vigia as violações da política (o navegador as anuncia no próprio documento). */
async function vigiarViolacoes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const violacoes: string[] = []
    ;(window as unknown as { __violacoes: string[] }).__violacoes = violacoes
    document.addEventListener('securitypolicyviolation', (e) => {
      violacoes.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'}`)
    })
  })
}
const violacoesDa = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __violacoes: string[] }).__violacoes,
  )

test('cada página responde com os cabeçalhos de segurança certos e abre sem violar a política de conteúdo', async ({
  page,
  context,
}) => {
  caminhos = await listarCaminhos(page)
  expect(caminhos.length).toBeGreaterThanOrEqual(14)
  expect(caminhos, 'a declaração de acessibilidade está no sitemap').toContain(
    '/acessibilidade/',
  )
  const vigia = vigiar(page)
  const problemas: string[] = []
  const erros: string[] = []
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      /Content Security Policy|Refused to/i.test(m.text())
    )
      erros.push(m.text().slice(0, 200))
  })
  const origensDeFora = new Set<string>()
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return
    if (![SITE, API_HML].includes(url.origin)) origensDeFora.add(url.origin)
  })
  await vigiarViolacoes(page)
  for (const caminho of caminhos) {
    const resposta = await page.goto(`${SITE}${caminho}`, {
      waitUntil: 'networkidle',
    })
    if (resposta?.status() !== 200) {
      problemas.push(`${caminho}: respondeu ${resposta?.status()}`)
      continue
    }
    const h = resposta.headers()
    const csp = h['content-security-policy'] ?? ''
    if (!csp.includes("default-src 'none'"))
      problemas.push(`${caminho}: sem política de conteúdo`)
    if (!csp.includes(`connect-src 'self' ${API_HML}`))
      problemas.push(`${caminho}: a política não conhece a API de teste`)
    if (csp.includes(API_PRODUCAO))
      problemas.push(
        `${caminho}: a política do site de teste cita a API de produção`,
      )
    if (/unsafe-inline|unsafe-eval/.test(csp))
      problemas.push(`${caminho}: política com unsafe-*`)
    if (h['x-frame-options'] !== 'DENY')
      problemas.push(`${caminho}: x-frame-options = ${h['x-frame-options']}`)
    if (h['x-content-type-options'] !== 'nosniff')
      problemas.push(`${caminho}: sem nosniff`)
    if (!/camera=\(\)/.test(h['permissions-policy'] ?? ''))
      problemas.push(`${caminho}: sem política de permissões`)
    if (h['cross-origin-opener-policy'] !== 'same-origin')
      problemas.push(`${caminho}: sem COOP same-origin`)
    if (!/max-age=\d+/.test(h['strict-transport-security'] ?? ''))
      problemas.push(`${caminho}: sem HSTS`)
    const violacoes = await violacoesDa(page)
    if (violacoes.length > 0)
      problemas.push(`${caminho}: violações ${violacoes.join(' | ')}`)
  }
  expect(problemas).toEqual([])
  expect(erros).toEqual([])
  expect(
    [...origensDeFora],
    'nenhuma página fala com servidor de terceiro',
  ).toEqual([])
  expect(await context.cookies(), 'nenhum cookie').toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('a agenda ao vivo funciona sob a política: a lista de eventos vem da API de teste', async ({
  page,
}, info) => {
  await vigiarViolacoes(page)
  await page.goto(`${SITE}/eventos/`, { waitUntil: 'networkidle' })
  await expect(page.locator('#eventos [data-eventos] li').first()).toBeVisible({
    timeout: 30_000,
  })
  expect(await violacoesDa(page)).toEqual([])
  await ver(page, info, 'agenda-de-eventos-sob-a-politica')
})

test('a política de fato bloqueia o que não é do site, e ninguém consegue embutir o site em outra página', async ({
  page,
}) => {
  await vigiarViolacoes(page)
  await page.goto(`${SITE}/contato/`, { waitUntil: 'networkidle' })
  const resultado = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/', { mode: 'no-cors' })
      return 'passou'
    } catch {
      return 'bloqueado'
    }
  })
  expect(resultado).toBe('bloqueado')
  expect((await violacoesDa(page)).join(' ')).toContain('connect-src')

  // embutir o site de teste numa página de outra origem: o navegador recusa (X-Frame-Options e frame-ancestors)
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' })
  await page.evaluate((src) => {
    const quadro = document.createElement('iframe')
    quadro.src = src
    quadro.id = 'quadro-do-robo'
    document.body.append(quadro)
  }, `${SITE}/`)
  await page.waitForTimeout(5_000)
  const quadro = page.frames().find((f) => f !== page.mainFrame())
  expect(quadro, 'o quadro foi criado').toBeTruthy()
  expect(
    quadro!.url().startsWith(SITE) && (await quadro!.locator('h1').count()) > 0,
    'o site NÃO abriu dentro do quadro',
  ).toBe(false)
})

test('o security.txt está no ar, com contato, validade no futuro e endereço canônico', async ({
  page,
}) => {
  const r = await page.request.get(`${SITE}/.well-known/security.txt`)
  expect(r.status()).toBe(200)
  expect(r.headers()['content-type'] ?? '').toContain('text/plain')
  const texto = await r.text()
  expect(texto).toContain('Contact: mailto:asaf@asaf.org.br')
  expect(texto).toContain('Contact: https://asaf.org.br/contato/')
  expect(texto).toContain('Preferred-Languages: pt-BR')
  expect(texto).toContain(
    'Canonical: https://asaf.org.br/.well-known/security.txt',
  )
  const validade = /^Expires: (.+)$/m.exec(texto)?.[1]
  expect(validade).toBeTruthy()
  const dias = (new Date(validade!).getTime() - Date.now()) / 86_400_000
  expect(dias).toBeGreaterThan(300)
  expect(dias).toBeLessThan(365)
})

test('a declaração de acessibilidade abre, diz a verdade sobre o que foi e o que não foi verificado, e está no rodapé', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE}/`, { waitUntil: 'networkidle' })
  await page
    .locator('footer')
    .getByRole('link', { name: 'Acessibilidade' })
    .click()
  await expect(page).toHaveURL(/\/acessibilidade\/$/)
  await expect(
    page.getByRole('heading', {
      name: 'Declaração de acessibilidade',
      level: 1,
    }),
  ).toBeVisible()
  await expect(page.getByText(/Versão 1\.\d+ · em vigor desde/)).toBeVisible()
  await expect(page.getByText('conformidade parcial')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'O que ainda não foi verificado' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Contato', exact: true }).first(),
  ).toHaveAttribute('href', '/contato/')
  await ver(page, info, 'declaracao-de-acessibilidade')
  expect(vigia.problemas()).toEqual([])
})
