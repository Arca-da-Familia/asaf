import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, RODADA, ver } from './apoio'

// v7.5b - A REVISÃO ANUAL DO PROGRAMA (decisão do Presidente, 02/11: todo janeiro): o Presidente monta o retrato de hoje (inventário, prazos, quem tem acesso
// a quê, números do ano), tenta aprovar sem observações e é recusado, escreve e aprova; a Auditoria registra; o 1º Vice-Presidente lê, sem montar nem aprovar.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

test('o Presidente monta, anota e aprova a revisão', async ({ page }, info) => {
  await entrar(page, 'presidente')
  await page.goto('/privacidade/revisao-anual')
  await page
    .getByRole('button', { name: 'Montar o retrato de hoje' })
    .click({ timeout: 30_000 })
  const rascunho = page.locator('li[data-situacao="RASCUNHO"]')
  await expect(
    rascunho.getByRole('region', { name: 'Quem tem acesso a quê' }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    rascunho.getByRole('region', { name: 'Prazos de guarda' }),
  ).toContainText('dias')
  await ver(page, info, 'retrato-montado')
  await rascunho.getByRole('button', { name: 'Salvar e aprovar' }).click()
  await expect(rascunho.getByRole('alert')).toContainText(
    'Escreva as observações',
  )
  await rascunho
    .getByRole('textbox')
    .fill(`Revisão de teste do robô (rodada ${RODADA}): inventário em dia.`)
  await rascunho.getByRole('button', { name: 'Salvar e aprovar' }).click()
  await expect(page.getByTestId('situacao-da-revisao')).toHaveAttribute(
    'data-pendente',
    'nao',
    { timeout: 30_000 },
  )
  await expect(page.locator('li[data-situacao="RASCUNHO"]')).toHaveCount(0)
  await ver(page, info, 'revisao-aprovada')
  await page.goto('/auditoria')
  await expect(
    page.getByRole('cell', { name: 'REVISAO_DO_PROGRAMA_APROVADA' }).first(),
  ).toBeVisible({ timeout: 30_000 })
})

test('o 1º Vice-Presidente lê a revisão, sem montar nem aprovar', async ({
  page,
}, info) => {
  await entrar(page, 'vice_presidente')
  await page.goto('/privacidade/revisao-anual')
  await expect(
    page.locator('li[data-situacao="APROVADA"]').first(),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByRole('button', { name: 'Montar o retrato de hoje' }),
  ).toHaveCount(0)
  await ver(page, info, 'vice-le-a-revisao')
})
