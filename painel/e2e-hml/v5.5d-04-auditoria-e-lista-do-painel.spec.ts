import { expect, test, type Page } from '@playwright/test'

import { API_HML, campo, entrar, exigirHomologacao, ver, vigiar } from './apoio'

// v5.5d - fecha o que o v5.5d-02 deixou: a Auditoria guardou CADA mudança de situação (as seis feitas pelo v5.5d-02: 1 cancelamento, 4 passos do adiamento e da remarcação, 1 "realizado") e a
// lista de eventos do painel mostra o selo de cada situação. Lê o estado que o v5.5d-02 deixou (os três eventos mais novos de cada prefixo), por isso roda DEPOIS dele e antes de outra
// rodada do v5.5d-01.
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

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
    `o roteiro v5.5d-01 criou o evento "${prefixo}"`,
  ).toBeGreaterThan(0)
  return lista[0]!
}

test('a Auditoria guardou as seis mudanças de situação e a lista do painel mostra o selo de cada uma', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const autorizacao: { valor: string } = { valor: '' }
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao.valor = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao.valor, { timeout: 15_000 }).not.toBe('')

  const cancelado = await eventoMaisNovo(page, PREFIXO_CANCELAR)
  const remarcado = await eventoMaisNovo(page, PREFIXO_ADIAR)
  const realizado = await eventoMaisNovo(page, PREFIXO_REALIZAR)
  // o estado que o v5.5d-02 deixou
  expect(cancelado.status).toBe('Cancelado')
  expect(remarcado.status).toBe('Programado')
  expect(remarcado.data_hora_inicio_anterior).not.toBeNull()
  expect(realizado.status).toBe('Realizado')

  // a Auditoria (a mesma consulta da tela): cada mudança deixou uma linha STATUS_ALTERADO, com quem foi
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=eventos&acao=STATUS_ALTERADO&por_pagina=200`,
    { headers: { Authorization: autorizacao.valor } },
  )
  expect(r.status()).toBe(200)
  const { entradas } = (await r.json()) as {
    entradas: Array<{ id_registro_afetado: number; acao: string }>
  }
  const dele = (id: number) =>
    entradas.filter((e) => Number(e.id_registro_afetado) === id).length
  expect(dele(cancelado.id_evento), 'cancelar').toBe(1)
  expect(
    dele(remarcado.id_evento),
    'adiar, voltar à data original, adiar de novo e remarcar',
  ).toBe(4)
  expect(dele(realizado.id_evento), 'marcar como realizado').toBe(1)

  // a tela da Auditoria mostra a ação
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  await campo(page, 'Tabela').fill('eventos')
  await expect(page.getByText('STATUS_ALTERADO').first()).toBeVisible({
    timeout: 30_000,
  })
  await ver(page, info, 'auditoria-com-as-mudancas-de-situacao')

  // a lista de eventos do painel mostra o selo da situação (o evento programado, mesmo remarcado, não leva selo)
  await page.goto('/eventos')
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  for (const [evento, selo] of [
    [cancelado, 'Cancelado'],
    [realizado, 'Realizado'],
  ] as const) {
    const linha = page
      .locator('div[role="button"]')
      .filter({ hasText: evento.titulo })
    await expect(linha.getByText(selo, { exact: true })).toBeVisible()
  }
  const linhaDoRemarcado = page
    .locator('div[role="button"]')
    .filter({ hasText: remarcado.titulo })
  await expect(linhaDoRemarcado).toBeVisible()
  await expect(
    linhaDoRemarcado.getByText('Adiado', { exact: true }),
  ).toHaveCount(0)
  await ver(page, info, 'lista-de-eventos-com-os-selos')
  expect(vigia.problemas()).toEqual([])
})
