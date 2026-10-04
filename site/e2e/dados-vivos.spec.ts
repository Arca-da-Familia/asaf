import { expect, test } from '@playwright/test'

// v5.2 — páginas geradas a partir da API (Diretoria, Projetos, Agenda/Evento, Edital), testadas no
// navegador contra o build de teste (API simulada, scripts/mock-api.mjs).

test.describe('Diretoria e Conselho', () => {
  test('mostra cada órgão com os cargos, na ordem da API, e as datas do mandato', async ({
    page,
  }) => {
    await page.goto('/diretoria/')
    const orgaos = await page
      .locator('[data-orgao]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-orgao')))
    expect(orgaos).toEqual(['Diretoria Executiva', 'Conselho Fiscal'])

    // Os cargos vêm do Estatuto (Art. 19: sete; Art. 24: três conselheiros) e aparecem TODOS, com ou sem ocupante.
    const diretoria = page.locator('[data-orgao="Diretoria Executiva"] li')
    await expect(diretoria).toHaveCount(7)
    await expect(diretoria.first()).toContainText('Presidente')
    await expect(diretoria.first()).toContainText('Maria de Teste da Silva')
    // Data sem hora, no formato brasileiro (e sem perder um dia por causa do fuso).
    await expect(diretoria.first()).toContainText(
      /Mandato: \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}/,
    )
    const cargos = await diretoria.locator('p.text-primary').allInnerTexts()
    expect(cargos).toEqual([
      'Presidente',
      '1º Vice-Presidente',
      '2º Vice-Presidente',
      '1º Secretário',
      '2º Secretário',
      '1º Tesoureiro',
      '2º Tesoureiro',
    ])
    await expect(
      page.locator('[data-orgao="Diretoria Executiva"] [data-ocupante]'),
    ).toHaveCount(2)
    // Cargo sem ocupante publicado diz isso — não diz "vago" (a posse pode não estar registrada ainda).
    const semOcupante = page.locator(
      '[data-orgao="Diretoria Executiva"] [data-vaga]',
    )
    await expect(semOcupante).toHaveCount(5)
    await expect(semOcupante.first()).toContainText(
      'Ocupante ainda não publicado',
    )
    await expect(semOcupante.first()).toContainText('Art. 19')
    const conselho = page.locator('[data-orgao="Conselho Fiscal"]')
    await expect(conselho).toContainText('Ana de Teste Lima')
    await expect(conselho.locator('li')).toHaveCount(3)
    await expect(conselho.locator('[data-vaga]')).toHaveCount(2)
    expect(await page.content()).not.toMatch(/\bvago\b|vacância/i)
    // Nunca dado pessoal além do nome.
    const texto = await page.locator('main').innerText()
    expect(texto).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}|@/)
  })
})

test.describe('Projetos', () => {
  test('lista com o projeto em execução primeiro e link para a página de cada um', async ({
    page,
  }) => {
    await page.goto('/projetos/')
    const titulos = await page.locator('main ul h2').allInnerTexts()
    expect(titulos[0]).toContain('reforço escolar')
    expect(titulos).toHaveLength(2)
    await expect(page.locator('main ul li').first()).toContainText(
      'Em execução',
    )
    await page
      .getByRole('link', {
        name: /Ver o projeto\s*:\s*Projeto de teste — reforço/,
      })
      .click()
    await expect(page).toHaveURL(/\/projetos\/1\/$/)
    await expect(page.locator('h1')).toHaveText(
      'Projeto de teste — reforço escolar',
    )
    await expect(page.getByText('Crianças de 6 a 12 anos')).toBeVisible()
  })

  test('título muito longo cabe no <title> (SEO) mas o <h1> mostra o nome inteiro', async ({
    page,
  }) => {
    await page.goto('/projetos/2/')
    expect((await page.title()).length).toBeLessThanOrEqual(70)
    await expect(page.locator('h1')).toContainText(
      'o título não estoura o limite do Google',
    )
  })
})

test.describe('Agenda e página de cada evento', () => {
  test('a lista (ilha) leva à página do evento e o arquivo mostra o que já passou', async ({
    page,
  }) => {
    await page.goto('/eventos/')
    const proximos = page.locator('#eventos [data-estado="lista"] li')
    await expect(proximos).toHaveCount(2)
    await proximos
      .first()
      .getByRole('link', { name: /encontro de famílias/ })
      .click()
    await expect(page).toHaveURL(/\/eventos\/2\/$/)

    await page.goto('/eventos/')
    const realizados = page.locator('#anteriores [data-estado="lista"] li')
    await expect(realizados).toHaveCount(1)
    await expect(realizados.first()).toContainText('já realizado')
    // Evento que passou não anuncia vagas.
    await expect(realizados.first()).not.toContainText('vaga')
  })

  test('página do evento: data com horário de Parauapebas, local, programação e schema.org/Event', async ({
    page,
  }) => {
    await page.goto('/eventos/2/')
    await expect(page.locator('h1')).toHaveText(
      'Evento de teste — encontro de famílias',
    )
    await expect(page.getByText('Local de teste, Parauapebas')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Programação' }),
    ).toBeVisible()
    await expect(page.getByText('Roda de conversa')).toBeVisible()
    await expect(page.locator('dd', { hasText: 'Gratuita' })).toBeVisible()

    const blocos = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents()
    const evento = blocos
      .map((b) => JSON.parse(b))
      .find((d) => d['@type'] === 'Event')
    expect(evento).toBeTruthy()
    expect(evento.startDate).toMatch(/T19:00:00-03:00$/) // o fuso de Parauapebas, nunca omitido
    expect(evento.url).toBe('https://asaf.org.br/eventos/2/')
    expect(evento.isAccessibleForFree).toBe(true)
  })

  test('vagas são atualizadas AO VIVO (o número do build seria velho)', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/2', (rota) =>
      rota.fulfill({ json: { id_evento: 2, vagas_livres: 3, sessoes: [] } }),
    )
    await page.goto('/eventos/2/')
    await expect(page.locator('[data-vagas]')).toHaveText('3 vagas disponíveis')
  })

  test('evento TIRADO DO AR depois do build: a página avisa na hora (404 da API)', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/2', (rota) =>
      rota.fulfill({ status: 404, json: { detail: 'Evento não encontrado.' } }),
    )
    await page.goto('/eventos/2/')
    const aviso = page.locator('[data-aviso-retirado]')
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('retirado da programação')
    await expect(page.locator('[data-vagas]')).toBeHidden()
  })

  test('API fora do ar: a página continua útil, sem alarme falso', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/2', (rota) => rota.abort())
    await page.goto('/eventos/2/')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-aviso-retirado]')).toBeHidden()
    await expect(page.locator('[data-vagas]')).toHaveText(
      '12 vagas disponíveis',
    ) // o do build
  })

  test('evento que já aconteceu mostra o aviso', async ({ page }) => {
    await page.goto('/eventos/1/')
    await expect(page.locator('[data-aviso-realizado]')).toBeVisible()
    await page.goto('/eventos/2/')
    await expect(page.locator('[data-aviso-realizado]')).toBeHidden()
  })
})

test.describe('Edital de assembleia', () => {
  test('texto, convocações, comprovante SHA-256 e SEM o link de acesso remoto', async ({
    page,
  }) => {
    await page.goto('/transparencia/')
    await page.getByRole('link', { name: /Assembleia Geral Ordinária/ }).click()
    await expect(page).toHaveURL(/\/transparencia\/assembleias\/5\/$/)

    await expect(page.locator('h1')).toContainText('Assembleia Geral Ordinária')
    await expect(page.getByText('1ª convocação')).toBeVisible()
    await expect(page.getByText('3ª convocação')).toBeVisible()
    const edital = page.getByLabel('Texto do edital de convocação')
    await expect(edital).toContainText(
      'EDITAL DE CONVOCAÇÃO PARA ASSEMBLEIA GERAL',
    )
    await expect(page.getByText('ab12cd34ef56ab12cd34ef56')).toBeVisible()
    await expect(page.getByText(/horário de Parauapebas/)).toBeVisible()
    const html = await page.content()
    expect(html).not.toMatch(/Acesso remoto: https?:/)
  })
})

test.describe('Home com dados vivos', () => {
  test('mostra "Nossos projetos" com o projeto em execução e liga ao evento', async ({
    page,
  }) => {
    await page.goto('/')
    const secao = page.getByRole('region', { name: 'Nossos projetos' })
    await expect(secao).toContainText('reforço escolar')
    await expect(
      secao.getByRole('link', { name: 'Ver todos os projetos' }),
    ).toBeVisible()
    const cartao = page.locator('#eventos [data-estado="lista"] li').first()
    await expect(cartao.getByRole('link')).toHaveAttribute(
      'href',
      '/eventos/2/',
    )
  })
})

test('/conteudo.json traz a impressão do conteúdo (para a sincronização automática)', async ({
  request,
}) => {
  const r = await request.get('/conteudo.json')
  expect(r.status()).toBe(200)
  const dados = await r.json()
  expect(dados.impressao).toMatch(/^[0-9a-f]{64}$/)
  expect(dados.contagem).toEqual({
    eventos: 3,
    projetos: 2,
    diretoria: 3,
    assembleias: 1,
    noticias: 2,
    parcerias: 3,
    documentos: 4,
  })
})
