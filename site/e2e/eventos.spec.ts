import { expect, test } from '@playwright/test'

// Ilha "Próximos eventos" (v5.0) no navegador de verdade: HTML -> fetch na API -> DOM.
// Por padrão a ilha fala com a API simulada (scripts/mock-api.mjs, porta 4322); os casos de
// erro/vazio/ataque substituem a resposta com page.route.

test('lista só os eventos que ainda vão acontecer, do mais próximo ao mais distante', async ({
  page,
}) => {
  await page.goto('/')
  const secao = page.locator('#eventos')
  await expect(
    secao.getByRole('heading', { name: 'Próximos eventos', level: 2 }),
  ).toBeVisible()

  const titulos = secao.locator('h3')
  await expect(titulos).toHaveText([
    'Evento de teste — encontro de famílias',
    'Evento de teste — vagas esgotadas',
    'Projeto Principal de Teste — 2ª edição',
  ])
  await expect(secao).not.toContainText('já realizado')
  await expect(secao).toContainText('Local de teste, Parauapebas')
  await expect(secao).toContainText('12 vagas disponíveis')
  await expect(secao).toContainText('Vagas esgotadas')
  await expect(secao.getByText('Gratuito')).toHaveCount(2) // o encontro e a 2ª edição (a de vagas esgotadas é paga)
  await expect(page.locator('[data-eventos]')).toHaveAttribute(
    'aria-busy',
    'false',
  )
})

test('mostra horário de Parauapebas, no formato brasileiro', async ({
  page,
}) => {
  await page.goto('/')
  // O mock coloca o evento às 19h (horário local do evento).
  await expect(page.locator('#eventos time').first()).toContainText('· 19:00')
})

test('sem eventos futuros: mensagem clara', async ({ page }) => {
  await page.route('**/api/publico/eventos', (rota) =>
    rota.fulfill({ json: [] }),
  )
  await page.goto('/')
  await expect(page.locator('#eventos [data-estado="vazio"]')).toContainText(
    'Nenhum evento aberto no momento',
  )
})

test('API fora do ar: avisa e o "Tentar novamente" recupera quando ela volta', async ({
  page,
}) => {
  await page.route('**/api/publico/eventos', (rota) => rota.abort())
  await page.goto('/')
  await expect(page.locator('#eventos [data-estado="erro"]')).toContainText(
    'Não foi possível carregar os eventos',
  )

  await page.unroute('**/api/publico/eventos')
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.locator('#eventos h3').first()).toBeVisible()
})

test('PARTIDA A FRIO: 1ª tentativa falha (API acordando), a 2ª funciona — o visitante não vê erro', async ({
  page,
}) => {
  // Reproduz o defeito achado no 1º teste em produção: a API escala a zero e a primeira
  // chamada depois de um tempo parado falha. Aqui a 1ª é derrubada e as seguintes passam.
  let chamadas = 0
  await page.route('**/api/publico/eventos', (rota) => {
    chamadas += 1
    return chamadas === 1 ? rota.abort() : rota.continue()
  })
  await page.goto('/')
  await expect(page.locator('#eventos h3').first()).toBeVisible()
  await expect(page.locator('[data-estado="erro"]')).toHaveCount(0)
  expect(chamadas).toBe(2)
})

test('API lenta: avisa que pode demorar e mostra a lista quando chega', async ({
  page,
}) => {
  await page.route('**/api/publico/eventos', async (rota) => {
    await new Promise((resolver) => setTimeout(resolver, 5500))
    await rota.continue()
  })
  await page.goto('/')
  await expect(
    page.locator('#eventos [data-estado="carregando"]'),
  ).toContainText('pode levar alguns segundos')
  await expect(page.locator('#eventos h3').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator('#eventos')).not.toContainText(
    'pode levar alguns segundos',
  )
})

test('API responde 500: trata como erro, sem quebrar a página', async ({
  page,
}) => {
  await page.route('**/api/publico/eventos', (rota) =>
    rota.fulfill({ status: 500, json: { detail: 'erro' } }),
  )
  await page.goto('/')
  await expect(page.locator('#eventos [data-estado="erro"]')).toBeVisible()
  await expect(page.locator('h1')).toBeVisible()
})

test('SEGURANÇA: título malicioso vindo da API aparece como texto e não executa', async ({
  page,
}) => {
  let dialogoAberto = false
  page.on('dialog', async (d) => {
    dialogoAberto = true
    await d.dismiss()
  })
  await page.route('**/api/publico/eventos', (rota) =>
    rota.fulfill({
      json: [
        {
          id_evento: 9,
          titulo: '<img src=x onerror="alert(1)"><script>alert(2)</script>',
          descricao: '<b>negrito?</b>',
          categoria: 'Encontro',
          data_hora_inicio: '2099-01-01T10:00:00',
          data_hora_fim: null,
          id_espaco: null,
          endereco_avulso: null,
          vagas: null,
          vagas_livres: null,
          gratuito: true,
        },
      ],
    }),
  )
  await page.goto('/')
  const secao = page.locator('#eventos')
  await expect(secao.locator('h3')).toHaveText(
    '<img src=x onerror="alert(1)"><script>alert(2)</script>',
  )
  await expect(secao.locator('img')).toHaveCount(0)
  await expect(secao.locator('b')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(dialogoAberto).toBe(false)
})

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  // Obs.: o texto do <noscript> não é verificável aqui — o Playwright desliga o JS depois do
  // parse e o Chromium segue tratando o conteúdo do <noscript> como texto; navegador real com
  // JS desligado o renderiza (está no HTML, conferido em tests do build). O defeito que este
  // teste pega é o outro: "Carregando eventos…" ficar na tela para sempre.
  test('a página continua útil e não fica presa em "Carregando eventos…"', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('#eventos h2')).toBeVisible()
    // `toContainText` lê o texto mesmo de elemento escondido; o que importa é o visitante NÃO
    // ver o "Carregando…" — o contêiner some via `@media (scripting: none)` (global.css).
    await expect(page.locator('[data-eventos]')).toBeHidden()
  })
})
