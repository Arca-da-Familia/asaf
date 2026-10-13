import { expect, test, type Page } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v5.5d - o SITE DE TESTE reconstruído com a situação que o sistema tem (depois do v5.5d-02, que cancelou, remarcou e deu por realizado um evento, e de a homologação ser
// publicada outra vez): o HTML que o Google lê, sem JavaScript, já traz o aviso e o `eventStatus` certo (EventCancelled, EventRescheduled com a data de antes, EventScheduled
// para o realizado); a lista de eventos mostra o selo de cada situação; a Home não lista o evento cancelado.
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const SITE_HML = 'https://hml-site.asaf.org.br'
const PREFIXO_CANCELAR = 'Oficina para Cancelar do Robô'
const PREFIXO_ADIAR = 'Encontro para Adiar do Robô'
const PREFIXO_REALIZAR = 'Evento para Realizar do Robô'

type EventoPublico = {
  id_evento: number
  titulo: string
  status: string
  data_hora_inicio_anterior: string | null
}

async function eventoMaisNovo(
  page: Page,
  prefixo: string,
): Promise<EventoPublico> {
  const r = await page.request.get(`${API_HML}/api/publico/eventos`)
  expect(r.status()).toBe(200)
  const lista = ((await r.json()) as EventoPublico[])
    .filter((e) => e.titulo.startsWith(prefixo))
    .sort((a, b) => b.id_evento - a.id_evento)
  expect(
    lista.length,
    `os roteiros v5.5d-01 e v5.5d-02 criaram o evento "${prefixo}"`,
  ).toBeGreaterThan(0)
  return lista[0]!
}

/** O HTML cru da página do evento no site de teste (o que o Google lê: sem JavaScript) e o JSON-LD de tipo Event que ele traz. */
async function htmlEJsonLd(
  page: Page,
  id: number,
): Promise<{ html: string; jsonLd: Record<string, unknown> }> {
  const r = await page.request.get(`${SITE_HML}/eventos/${id}/`)
  expect(r.status(), `a página /eventos/${id}/ existe no site de teste`).toBe(
    200,
  )
  const html = await r.text()
  const blocos = [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1]!) as Record<string, unknown>)
  const jsonLd = blocos.find((b) => b['@type'] === 'Event')
  expect(jsonLd, 'a página tem JSON-LD de evento').toBeTruthy()
  return { html, jsonLd: jsonLd! }
}

test('o HTML que o Google lê já traz a situação: cancelado, remarcado e realizado', async ({
  page,
}) => {
  const vigia = vigiar(page)
  const cancelado = await eventoMaisNovo(page, PREFIXO_CANCELAR)
  const remarcado = await eventoMaisNovo(page, PREFIXO_ADIAR)
  const realizado = await eventoMaisNovo(page, PREFIXO_REALIZAR)
  expect([cancelado.status, remarcado.status, realizado.status]).toEqual([
    'Cancelado',
    'Programado',
    'Realizado',
  ])

  const a = await htmlEJsonLd(page, cancelado.id_evento)
  expect(a.jsonLd['eventStatus']).toBe('https://schema.org/EventCancelled')
  expect(a.html).toContain('data-situacao-do-evento="Cancelado"')
  expect(a.html).toContain('Este evento foi cancelado.')
  expect(a.html).toContain('O salão ficou indisponível no dia')

  const b = await htmlEJsonLd(page, remarcado.id_evento)
  expect(b.jsonLd['eventStatus']).toBe('https://schema.org/EventRescheduled')
  expect(typeof b.jsonLd['previousStartDate']).toBe('string')
  expect(b.jsonLd['previousStartDate']).not.toBe(b.jsonLd['startDate'])
  expect(b.html).toContain('data-evento-remarcado')
  expect(b.html).toContain('Este evento foi remarcado.')

  const c = await htmlEJsonLd(page, realizado.id_evento)
  expect(c.jsonLd['eventStatus']).toBe('https://schema.org/EventScheduled')
  expect(c.html).toContain('data-situacao-do-evento="Realizado"')
  expect(c.html).toContain('Este evento já foi realizado.')
  expect(vigia.problemas()).toEqual([])
})

test('a lista de eventos mostra o selo de cada situação e a Home não lista o evento cancelado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const cancelado = await eventoMaisNovo(page, PREFIXO_CANCELAR)
  const remarcado = await eventoMaisNovo(page, PREFIXO_ADIAR)
  const realizado = await eventoMaisNovo(page, PREFIXO_REALIZAR)

  await page.goto(`${SITE_HML}/eventos/`, { waitUntil: 'networkidle' })
  for (const [evento, selo] of [
    [cancelado, 'Cancelado'],
    [remarcado, 'Remarcado'],
    [realizado, 'Realizado'],
  ] as const) {
    const cartao = page.locator('li').filter({ hasText: evento.titulo })
    await expect(
      cartao.locator(`[data-selo-do-evento="${selo}"]`).first(),
      `o cartão de "${evento.titulo}" tem o selo ${selo}`,
    ).toBeVisible({ timeout: 30_000 })
  }
  await ver(page, info, 'site-lista-de-eventos-com-os-selos')

  // a Home só lista o que ainda vai acontecer: o cancelado fica de fora
  await page.goto(`${SITE_HML}/`, { waitUntil: 'networkidle' })
  await expect(page.getByText(cancelado.titulo, { exact: false })).toHaveCount(
    0,
  )
  expect(vigia.problemas()).toEqual([])
})
