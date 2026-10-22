import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, ver, vigiar } from './apoio'

// Ponto de Revisão FASE 6 (2/2) - parte 2: depois de uma nova publicação da homologação (que roda a rotina dos agendados), o aviso agendado pelo
// v6.3-ponto-01 para 2 pessoas, cujo grupo passou a 3 antes da hora, NÃO saiu: aparece em Agendados como cancelado, com o motivo, e quem agendou foi
// avisado no sino.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

test('o agendado cujo grupo cresceu não sai, fica cancelado com o motivo e o autor é avisado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/comunicacao/agendados')
  await page.getByLabel(/^Situação/).selectOption('Cancelado')
  const item = page
    .getByRole('listitem')
    .filter({ hasText: 'Agendado do Ponto FASE 6' })
    .first()
  await expect(
    item,
    'o agendado do v6.3-ponto-01 (rode-o e publique a homologação mais de 6 minutos depois)',
  ).toBeVisible()
  await expect(item).toContainText('(2 na conferência)')
  await expect(item).toContainText(
    'Motivo: Não foi possível publicar na hora marcada: O grupo cresceu desde a conferência',
  )
  await ver(page, info, 'agendado cancelado porque o grupo cresceu')
  await page.goto('/')
  await page.getByRole('button', { name: /Notificações/ }).click()
  await expect(
    page
      .getByText(/O aviso agendado não saiu: Agendado do Ponto FASE 6/)
      .first(),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})
