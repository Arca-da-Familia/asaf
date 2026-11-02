import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, ver } from './apoio'

// v7.5a - O TREINAMENTO DE PRIVACIDADE (decisões do Presidente, 02/11): o 1º Vice-Presidente (cargo da Diretoria Executiva) vê o aviso enquanto não fez, lê o
// material e confirma "Li e entendi" (vale 2 anos); o Presidente vê no quadro do módulo Privacidade que ele fez. A confirmação fica no banco de teste entre as
// rodadas: na segunda rodada o robô confere que continua feito.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

test('o 1º Vice-Presidente faz o treinamento', async ({ page }, info) => {
  await entrar(page, 'vice_presidente')
  await page.goto('/treinamento-de-privacidade')
  const confirmacao = page.getByTestId('situacao-do-treinamento')
  await expect(confirmacao).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByRole('region', {
      name: 'Cuidados com os dados das pessoas na ASAF',
    }),
  ).toContainText('Suspeitou de vazamento? Avise na hora')
  if ((await confirmacao.getAttribute('data-pendente')) === 'sim') {
    await expect(confirmacao).toContainText('vale por 2 anos')
    await ver(page, info, 'treinamento-pendente')
    await page.getByRole('button', { name: 'Li e entendi' }).click()
  }
  await expect(confirmacao).toContainText('Treinamento feito em', {
    timeout: 30_000,
  })
  await page.goto('/')
  await expect(page.getByTestId('aviso-do-treinamento')).toHaveCount(0)
  await ver(page, info, 'treinamento-feito')
})

test('o Presidente vê no quadro que o 1º Vice fez', async ({ page }, info) => {
  await entrar(page, 'presidente')
  await page.goto('/privacidade/treinamentos')
  const quadro = page.getByRole('region', {
    name: 'Quem precisa do treinamento',
  })
  await expect(quadro).toBeVisible({ timeout: 30_000 })
  await expect(
    quadro.locator('tr[data-situacao="feito"]').first(),
  ).toContainText('Cargo: a cada 2 anos')
  await ver(page, info, 'quadro-dos-treinamentos')
})
