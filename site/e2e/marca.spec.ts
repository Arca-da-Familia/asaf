import { expect, test } from '@playwright/test'

import { dimensoesPng } from './paginas'

// Identidade da marca (logo, ícones, dados institucionais) no navegador de verdade — "o que a
// tela oferece pra abrir realmente abre" (item 11 do checklist de revisão do plano).

test('a logo institucional carrega de verdade (cabeçalho e destaque)', async ({
  page,
}) => {
  await page.goto('/')
  const imagens = page.locator('img')
  await expect(imagens).toHaveCount(2)
  for (const img of await imagens.all()) {
    await expect(img).toBeVisible()
    // naturalWidth 0 = imagem quebrada (404, arquivo corrompido, formato não lido).
    const largura = await img.evaluate(
      (e) => (e as HTMLImageElement).naturalWidth,
    )
    expect(largura).toBeGreaterThan(0)
  }
  await expect(
    page.getByAltText('Logotipo da Associação Arca da Família (ASAF)'),
  ).toBeVisible()
})

test('a logo reserva espaço (width/height) — sem salto de layout', async ({
  page,
}) => {
  await page.goto('/')
  for (const img of await page.locator('img').all()) {
    await expect(img).toHaveAttribute('width', /^\d+$/)
    await expect(img).toHaveAttribute('height', /^\d+$/)
  }
})

test('rodapé traz CNPJ, endereço, telefone e e-mail acionáveis', async ({
  page,
}) => {
  await page.goto('/')
  const rodape = page.locator('footer')
  await expect(rodape).toContainText('CNPJ 17.631.942/0001-70')
  await expect(rodape).toContainText('Rua Paulo Afonso, 150')
  await expect(rodape).toContainText('CEP 68515-000')
  await expect(
    rodape.getByRole('link', { name: '(94) 98412-0703' }),
  ).toHaveAttribute('href', 'tel:+5594984120703')
  await expect(
    rodape.getByRole('link', { name: 'asaf@asaf.org.br' }),
  ).toHaveAttribute('href', 'mailto:asaf@asaf.org.br')
})

test('dados estruturados trazem logo, CNPJ, telefone e endereço da sede', async ({
  page,
}) => {
  await page.goto('/')
  const blocos = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
  const org = blocos
    .map((b) => JSON.parse(b) as Record<string, any>)
    .find((d) => d['@type'] === 'NGO')!
  expect(org.logo.url).toBe('https://asaf.org.br/asaf-logo-600.png')
  expect(org.taxID).toBe('17.631.942/0001-70')
  expect(org.telephone).toBe('+55-94-98412-0703')
  expect(org.address.streetAddress).toBe('Rua Paulo Afonso, 150')
})

test('ícones do site existem e o PNG da logo é o declarado nos dados estruturados', async ({
  page,
  request,
}) => {
  await page.goto('/')
  // Cada <link rel=icon|apple-touch-icon> aponta para um arquivo que responde 200 com imagem.
  const hrefs = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((ls) => ls.map((l) => l.getAttribute('href')!))
  expect(hrefs.length).toBeGreaterThanOrEqual(3)
  for (const href of hrefs) {
    const r = await request.get(href)
    expect(r.status(), href).toBe(200)
    expect(r.headers()['content-type'], href).toMatch(/image\//)
  }
  // A logo declarada no JSON-LD tem o tamanho declarado (width/height do ImageObject).
  const png = await request.get('/asaf-logo-600.png')
  expect(png.status()).toBe(200)
  expect(dimensoesPng(await png.body())).toEqual({ largura: 600, altura: 497 })
})
