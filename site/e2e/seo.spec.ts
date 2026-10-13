import { expect, test } from '@playwright/test'

import {
  PAGINAS_NAO_INDEXAVEIS,
  caminhosIndexaveis,
  dimensoesPng,
} from './paginas'

// SEO técnico (v5.0), verificado no HTML que o navegador recebe — não no código-fonte.
const DOMINIO = 'https://asaf.org.br'

for (const caminho of caminhosIndexaveis()) {
  test.describe(`SEO — ${caminho}`, () => {
    test('metadados essenciais, Open Graph e canonical', async ({ page }) => {
      await page.goto(caminho)

      await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')

      const titulo = await page.title()
      expect(titulo.length).toBeGreaterThan(5)
      expect(titulo.length).toBeLessThanOrEqual(70)

      const descricao = await page
        .locator('meta[name="description"]')
        .getAttribute('content')
      expect(descricao).toBeTruthy()
      expect(descricao!.length).toBeGreaterThanOrEqual(50)
      expect(descricao!.length).toBeLessThanOrEqual(170)

      // Exatamente um <h1> por página.
      await expect(page.locator('h1')).toHaveCount(1)

      // Canonical absoluta, no domínio de produção, apontando para esta própria página.
      const canonica = await page
        .locator('link[rel="canonical"]')
        .getAttribute('href')
      expect(canonica).toBe(`${DOMINIO}${caminho}`)

      // Indexável: não pode ter noindex.
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0)

      const og = async (propriedade: string) =>
        page.locator(`meta[property="${propriedade}"]`).getAttribute('content')
      expect(await og('og:title')).toBe(titulo)
      expect(await og('og:description')).toBe(descricao)
      expect(await og('og:url')).toBe(canonica)
      expect(await og('og:type')).toBe('website')
      expect(await og('og:locale')).toBe('pt_BR')
      // PNG padrão da ASAF; a notícia com foto usa a própria foto (WebP).
      expect(await og('og:image')).toMatch(
        /^https:\/\/asaf\.org\.br\/.+\.(png|webp)$/,
      )
      expect(await og('og:image:alt')).toBeTruthy()
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        'content',
        'summary_large_image',
      )
    })

    test('dados estruturados são JSON válido com @context', async ({
      page,
    }) => {
      await page.goto(caminho)
      const blocos = await page
        .locator('script[type="application/ld+json"]')
        .allTextContents()
      expect(blocos.length).toBeGreaterThanOrEqual(1)
      const dados = blocos.map((b) => JSON.parse(b) as Record<string, unknown>)
      for (const d of dados) expect(d['@context']).toBe('https://schema.org')
      expect(dados.some((d) => d['@type'] === 'NGO')).toBe(true)
    })

    test('todo link interno da página responde 200', async ({
      page,
      request,
    }) => {
      await page.goto(caminho)
      const hrefs = await page
        .locator('a[href^="/"]')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href')!))
      for (const href of new Set(hrefs)) {
        const resposta = await request.get(href.split('#')[0] || '/')
        expect(resposta.status(), `link quebrado: ${href}`).toBe(200)
      }
    })
  })
}

test('imagem de compartilhamento existe e tem 1200x630', async ({
  request,
}) => {
  const resposta = await request.get('/og-padrao.png')
  expect(resposta.status()).toBe(200)
  expect(resposta.headers()['content-type']).toContain('image/png')
  expect(dimensoesPng(await resposta.body())).toEqual({
    largura: 1200,
    altura: 630,
  })
})

test('páginas não indexáveis (404 e os links do e-mail de inscrição) têm noindex e ficam fora do sitemap', async ({
  page,
  request,
}) => {
  for (const caminho of PAGINAS_NAO_INDEXAVEIS) {
    await page.goto(caminho)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    )
    expect(caminhosIndexaveis()).not.toContain(caminho)
  }
  const sitemap = await (await request.get('/sitemap-0.xml')).text()
  expect(sitemap).not.toContain('404')
  expect(sitemap).not.toContain('cancelar-inscricao')
  expect(sitemap).not.toContain('confirmar-inscricao')
})

test('robots.txt libera o site e aponta o sitemap', async ({ request }) => {
  const resposta = await request.get('/robots.txt')
  expect(resposta.status()).toBe(200)
  const texto = await resposta.text()
  expect(texto).toContain('User-agent: *')
  expect(texto).toContain('Allow: /')
  expect(texto).toContain(`Sitemap: ${DOMINIO}/sitemap-index.xml`)
})

test('sitemap lista a home com URL absoluta de produção', async ({
  request,
}) => {
  const indice = await (await request.get('/sitemap-index.xml')).text()
  expect(indice).toContain(`${DOMINIO}/sitemap-0.xml`)
  const mapa = await (await request.get('/sitemap-0.xml')).text()
  expect(mapa).toContain(`<loc>${DOMINIO}/</loc>`)
  for (const [, url] of mapa.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    expect(url!.startsWith(`${DOMINIO}/`)).toBe(true)
  }
})

test('version.json informa commit e horário do build', async ({ request }) => {
  const resposta = await request.get('/version.json')
  expect(resposta.status()).toBe(200)
  const corpo = (await resposta.json()) as { commit: string; buildEm: string }
  expect(corpo.commit).toMatch(/^[0-9a-f]{7,}$|^dev$/)
  expect(Number.isNaN(Date.parse(corpo.buildEm))).toBe(false)
})
