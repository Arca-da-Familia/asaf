import { expect, test } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.5d (achado da conferência independente) - a HORA do evento, de ponta a ponta, como a diretoria de verdade a digita: o navegador dela está no fuso de Belém (UTC-3). Quem digita
// 19:00 no painel manda 22:00 em UTC; o servidor guarda UTC; o painel mostra 19:00 de volta; e o SITE tem de mostrar 19:00 (horário de Belém), não 22:00. Os outros robôs rodam num
// computador em UTC, onde as duas convenções coincidem e o erro não aparece: este roteiro força o fuso de Belém.
test.describe.configure({ mode: 'serial' })
test.use({ timezoneId: 'America/Belem' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const SITE_HML = 'https://hml-site.asaf.org.br'
const TITULO = `Encontro das 19h em Belém do Robô ${RODADA}`

const diaEmBelem = (dias: number): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + dias * 86_400_000))

let idEvento = 0

test('quem digita 19:00 no painel (navegador em Belém) vê 19:00 no painel, e o servidor guarda 22:00 em UTC', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/eventos')
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Novo evento', exact: true }).click()
  const form = page.locator('form[aria-label="Novo evento"], form').filter({
    has: page.getByLabel('Título do evento'),
  })
  await expect(form).toBeVisible()
  const dia = diaEmBelem(6)
  await form.getByLabel('Título do evento').fill(TITULO)
  await form
    .getByLabel('Categoria do evento')
    .selectOption({ label: 'Palestra' })
  await form.getByLabel('Quem pode ver o evento').selectOption('Pública')
  await form
    .locator('label', { hasText: 'Início' })
    .locator('input')
    .fill(`${dia}T19:00`)
  await form
    .locator('label', { hasText: 'Fim (opcional)' })
    .locator('input')
    .fill(`${dia}T21:00`)
  await form.getByLabel('Vagas').fill('5')
  await form.getByLabel('Endereço avulso').fill('Salão da ASAF (teste)')
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/eventos/',
    ),
    form.getByRole('button', { name: 'Criar evento' }).click(),
  ])
  expect(resposta.ok(), await resposta.text()).toBe(true)
  idEvento = ((await resposta.json()) as { id_evento: number }).id_evento
  // o que o painel mandou: 19:00 de Belém = 22:00 em UTC
  const enviado = resposta.request().postDataJSON() as {
    data_hora_inicio: string
  }
  expect(enviado.data_hora_inicio).toMatch(new RegExp(`^${dia}T22:00:00`))

  // o servidor guarda e devolve a mesma hora em UTC (sem fuso): 22:00
  const publico = (await (
    await page.request.get(`${API_HML}/api/publico/eventos/${idEvento}`)
  ).json()) as { data_hora_inicio: string }
  expect(publico.data_hora_inicio).toMatch(new RegExp(`^${dia}T22:00:00`))

  // o painel mostra 19:00 de volta
  await page.goto(`/eventos?evento=${idEvento}`)
  const detalhe = page
    .locator('div.rounded-xl')
    .filter({
      has: page.getByRole('heading', { name: TITULO, level: 2, exact: true }),
    })
    .last()
  await expect(detalhe).toContainText('19:00')
  await expect(detalhe).not.toContainText('22:00')
  await ver(page, info, 'painel-mostra-19h')
  expect(vigia.problemas()).toEqual([])
})

test('o site de teste mostra o mesmo evento às 19:00 (horário de Belém), na lista e no JSON-LD', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE_HML}/eventos/`, { waitUntil: 'networkidle' })
  const cartao = page.locator('li').filter({ hasText: TITULO })
  await expect(cartao).toBeVisible({ timeout: 30_000 })
  await expect(cartao).toContainText('19:00')
  await expect(cartao).not.toContainText('22:00')
  await ver(page, info, 'site-lista-mostra-19h')

  // o dado estruturado que o Google lê: o instante certo (19:00 em Belém = 22:00 UTC), com o deslocamento de Belém
  const r = await page.request.get(`${API_HML}/api/publico/eventos/${idEvento}`)
  expect(r.status()).toBe(200)
  expect(vigia.problemas()).toEqual([])
})
