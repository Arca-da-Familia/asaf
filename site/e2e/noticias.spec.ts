import { expect, test } from '@playwright/test'

// v5.3 — Notícias vindas do Directus (editor do site), lidas no build. O servidor de teste (scripts/mock-api.mjs)
// simula o Directus: 5 notícias boas (2 comuns e 3 ligadas a projeto/evento, v5.5) e 3 que a validação do site TEM que
// recusar (foto sem autorização, rascunho que escapou do filtro, agendada). Aqui se prova, no navegador, o que aparece
// e o que NÃO pode aparecer.

const FOTO = '11111111-1111-4111-8111-111111111111'

test.describe('Lista de notícias', () => {
  test('mostra só as notícias válidas, da mais recente para a mais antiga', async ({
    page,
  }) => {
    await page.goto('/noticias/')
    const titulos = await page.locator('main ul h2').allInnerTexts()
    expect(titulos).toEqual([
      'Notícia de teste com foto',
      'Notícia de teste sem foto',
      // v5.5: as ligadas a projeto/evento são notícias como as outras (a de ligação quebrada também vai ao ar)
      'Notícia de teste ligada ao projeto',
      'Notícia de teste ligada ao evento',
      'Notícia de teste com ligação quebrada',
    ])
    const html = await page.content()
    expect(html).not.toContain('RECUSADA')
    expect(html).not.toContain('Texto que não pode aparecer')
  })

  test('a foto tem texto alternativo, medidas e vem do próprio site (não do Directus)', async ({
    page,
    request,
  }) => {
    await page.goto('/noticias/')
    const foto = page.locator('main ul li').first().locator('img')
    await expect(foto).toHaveAttribute(
      'alt',
      'Crianças lendo livros no pátio da sede (foto de teste)',
    )
    await expect(foto).toHaveAttribute('src', `/midia/noticias/${FOTO}.webp`)
    await expect(foto).toHaveAttribute('width', '1280')
    await expect(foto).toHaveAttribute('height', '720')
    const resposta = await request.get(`/midia/noticias/${FOTO}.webp`)
    expect(resposta.status()).toBe(200)
    expect(resposta.headers()['content-type']).toBe('image/webp')
    expect((await resposta.body()).subarray(0, 4).toString()).toBe('RIFF')
    // O endereço do Directus nunca vai para o HTML do visitante.
    expect(await page.content()).not.toContain('__directus')
  })

  test('cada notícia leva à própria página, pelo endereço (slug)', async ({
    page,
  }) => {
    await page.goto('/noticias/')
    await page.getByRole('link', { name: /Ler a notícia.*sem foto/ }).click()
    await expect(page).toHaveURL(/\/noticias\/noticia-de-teste-sem-foto\/$/)
  })
})

test.describe('Página de uma notícia', () => {
  test('com foto: um só h1, foto com texto alternativo e prévia de compartilhamento certa', async ({
    page,
  }) => {
    await page.goto('/noticias/noticia-de-teste-com-foto/')
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText('Notícia de teste com foto')
    await expect(page.locator('article img')).toHaveCount(1)
    await expect(page.locator('article figure img')).toHaveAttribute(
      'alt',
      'Crianças lendo livros no pátio da sede (foto de teste)',
    )
    const og = (nome: string) =>
      page.locator(`meta[property="${nome}"]`).getAttribute('content')
    expect(await og('og:image')).toBe(
      `https://asaf.org.br/midia/noticias/${FOTO}.webp`,
    )
    expect(await og('og:image:width')).toBe('1280')
    expect(await og('og:image:height')).toBe('720')
    expect(await og('og:image:alt')).toBe(
      'Crianças lendo livros no pátio da sede (foto de teste)',
    )
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://asaf.org.br/noticias/noticia-de-teste-com-foto/',
    )
  })

  test('o texto do editor é limpo: sem script, sem evento, sem link perigoso e sem imagem solta', async ({
    page,
  }) => {
    await page.goto('/noticias/noticia-de-teste-com-foto/')
    expect(await page.evaluate(() => (window as any).__invasao)).toBeUndefined()
    const corpo = page.locator('article div.leading-relaxed')
    await expect(corpo).toContainText('Primeiro parágrafo da notícia de teste.')
    expect(await corpo.innerHTML()).not.toMatch(
      /<script|onclick|javascript:|<img/,
    )
    // O h1 solto do texto virou h2 (o título da notícia é o único h1).
    await expect(corpo.locator('h2')).toHaveText('Título solto')
    const bom = corpo.locator('a[href="https://exemplo.org/"]')
    await expect(bom).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('traz o dado estruturado NewsArticle com a foto absoluta e a data', async ({
    page,
  }) => {
    await page.goto('/noticias/noticia-de-teste-com-foto/')
    const blocos = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((els) => els.map((e) => JSON.parse(e.textContent ?? '{}')))
    const artigo = blocos.find((b) => b['@type'] === 'NewsArticle')
    expect(artigo.headline).toBe('Notícia de teste com foto')
    expect(artigo.image).toEqual([
      `https://asaf.org.br/midia/noticias/${FOTO}.webp`,
    ])
    expect(artigo.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(artigo.publisher).toEqual({
      '@id': 'https://asaf.org.br/#organizacao',
    })
  })

  test('sem foto: sem figura, sem image no dado estruturado e com a prévia padrão', async ({
    page,
  }) => {
    await page.goto('/noticias/noticia-de-teste-sem-foto/')
    await expect(page.locator('article figure')).toHaveCount(0)
    await expect(page.locator('article ul li')).toHaveCount(2)
    const blocos = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((els) => els.map((e) => JSON.parse(e.textContent ?? '{}')))
    expect(blocos.find((b) => b['@type'] === 'NewsArticle')).not.toHaveProperty(
      'image',
    )
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://asaf.org.br/og-padrao.png',
    )
  })

  test('as notícias recusadas NÃO têm página', async ({ request }) => {
    for (const slug of [
      'recusada-sem-autorizacao',
      'recusada-rascunho',
      'recusada-agendada',
    ]) {
      const resposta = await request.get(`/noticias/${slug}/`)
      expect(resposta.status(), slug).toBe(404)
    }
  })
})

test.describe('Feed, Home e rodapé', () => {
  test('o feed RSS é válido e lista só as notícias publicadas', async ({
    request,
  }) => {
    const resposta = await request.get('/noticias/feed.xml')
    expect(resposta.status()).toBe(200)
    const xml = await resposta.text()
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<rss version="2.0"')
    expect(xml.match(/<item>/g)).toHaveLength(5)
    expect(xml).toContain('<title>Notícia de teste com foto</title>')
    expect(xml).toContain(
      '<link>https://asaf.org.br/noticias/noticia-de-teste-com-foto/</link>',
    )
    expect(xml).toContain('rel="self"')
    expect(xml).not.toContain('RECUSADA')
  })

  test('todas as páginas anunciam o feed', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.locator('link[rel="alternate"][type="application/rss+xml"]'),
    ).toHaveAttribute('href', '/noticias/feed.xml')
  })

  test('a Home mostra as últimas notícias e o rodapé leva para a lista', async ({
    page,
  }) => {
    await page.goto('/')
    const bloco = page.locator('section[aria-labelledby="ultimas-noticias"]')
    await expect(bloco.locator('li')).toHaveCount(3) // as 3 mais recentes
    await expect(bloco).toContainText('Notícia de teste com foto')
    await expect(
      page.locator('footer a[href="/noticias/"]').first(),
    ).toBeVisible()
  })

  test('/conteudo.json conta as notícias (é o que faz o site ser republicado quando uma muda)', async ({
    request,
  }) => {
    const dados = await (await request.get('/conteudo.json')).json()
    expect(dados.contagem.noticias).toBe(5)
  })
})
