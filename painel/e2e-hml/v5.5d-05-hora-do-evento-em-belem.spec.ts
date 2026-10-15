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
const TITULO = `Encontro em Belém do Robô ${RODADA}`

// O evento começa daqui a 90 a 150 minutos, numa hora cheia: assim ele é SEMPRE um dos próximos da lista do site (a lista só mostra os 6 mais próximos).
const INICIO = new Date(
  Math.ceil((Date.now() + 90 * 60_000) / 3_600_000) * 3_600_000,
)
const FIM = new Date(INICIO.getTime() + 2 * 3_600_000)
const emBelem = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Belem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  )
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }
}
const LOCAL = emBelem(INICIO)
const LOCAL_FIM = emBelem(FIM)
const EM_UTC = INICIO.toISOString().slice(0, 13) // aaaa-mm-ddThh: o que o servidor tem de guardar
const HORA_EM_UTC = `${EM_UTC.slice(11, 13)}:00` // a hora errada que o site mostraria se lesse UTC como Belém

let idEvento = 0

test('quem digita a hora no painel (navegador em Belém) a vê de volta no painel, e o servidor guarda a hora em UTC (3 horas à frente)', async ({
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
  await form.getByLabel('Título do evento').fill(TITULO)
  await form
    .getByLabel('Categoria do evento')
    .selectOption({ label: 'Palestra' })
  await form.getByLabel('Quem pode ver o evento').selectOption('Pública')
  await form
    .locator('label', { hasText: 'Início' })
    .locator('input')
    .fill(`${LOCAL.dia}T${LOCAL.hora}`)
  await form
    .locator('label', { hasText: 'Fim (opcional)' })
    .locator('input')
    .fill(`${LOCAL_FIM.dia}T${LOCAL_FIM.hora}`)
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
  // o que o painel mandou: a hora de Belém em UTC (3 horas à frente)
  const enviado = resposta.request().postDataJSON() as {
    data_hora_inicio: string
  }
  expect(enviado.data_hora_inicio.startsWith(`${EM_UTC}:00`)).toBe(true)

  // o servidor guarda e devolve a mesma hora em UTC (sem fuso)
  const publico = (await (
    await page.request.get(`${API_HML}/api/publico/eventos/${idEvento}`)
  ).json()) as { data_hora_inicio: string }
  expect(publico.data_hora_inicio.startsWith(`${EM_UTC}:00`)).toBe(true)

  // o painel mostra a hora de Belém de volta
  await page.goto(`/eventos?evento=${idEvento}`)
  const detalhe = page
    .locator('div.rounded-xl')
    .filter({
      has: page.getByRole('heading', { name: TITULO, level: 2, exact: true }),
    })
    .last()
  await expect(detalhe).toContainText(LOCAL.hora)
  await expect(detalhe).not.toContainText(HORA_EM_UTC)
  await ver(page, info, 'painel-mostra-a-hora-de-belem')
  expect(vigia.problemas()).toEqual([])
})

test('o site de teste mostra o mesmo evento na hora de Belém (e não 3 horas à frente)', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE_HML}/eventos/`, { waitUntil: 'networkidle' })
  const cartao = page.locator('li').filter({ hasText: TITULO })
  await expect(cartao).toBeVisible({ timeout: 30_000 })
  await expect(cartao).toContainText(LOCAL.hora)
  await expect(cartao).not.toContainText(HORA_EM_UTC)
  await ver(page, info, 'site-lista-mostra-a-hora-de-belem')
  expect(vigia.problemas()).toEqual([])
})
