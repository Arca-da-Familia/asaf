import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, ver } from './apoio'

// v7.3a - O CPF PROTEGIDO (decisão do Presidente, 29/10): nas listas e fichas o CPF aparece sempre escondido (`***.***.***-NN`); o completo só por um
// clique em "Mostrar o CPF", que vai para a Auditoria, e só para o Presidente, os Secretários e os Tesoureiros. O 1º Vice-Presidente vê a ficha com o CPF
// escondido e sem o botão. A busca por CPF continua (no servidor).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const CPF_INTEIRO = /\d{3}\.\d{3}\.\d{3}-\d{2}/
const CPF_ESCONDIDO = /^\*\*\*\.\*\*\*\.\*\*\*-\d{2}$/

test('o Presidente vê a lista escondida e mostra o CPF da ficha por clique, que vai para a Auditoria', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/associados')
  const tabela = page.getByRole('table')
  const primeiraLinha = tabela.getByRole('row').nth(1)
  await expect(primeiraLinha).toBeVisible({ timeout: 30_000 })
  await expect(
    primeiraLinha.getByRole('cell', { name: CPF_ESCONDIDO }),
  ).toBeVisible()
  expect(await tabela.innerText()).not.toMatch(CPF_INTEIRO)
  await ver(page, info, 'lista-com-cpf-escondido')

  await primeiraLinha.getByRole('link').first().click()
  const escondido = page.locator('[data-cpf="escondido"]')
  await expect(escondido).toHaveText(CPF_ESCONDIDO, { timeout: 30_000 })
  await ver(page, info, 'ficha-com-cpf-escondido')
  await page.getByRole('button', { name: 'Mostrar o CPF' }).click()
  await expect(page.locator('[data-cpf="completo"]')).toHaveText(CPF_INTEIRO)
  await ver(page, info, 'ficha-com-cpf-mostrado')

  await page.goto('/auditoria')
  await expect(
    page.getByRole('cell', { name: 'CPF_REVELADO' }).first(),
  ).toBeVisible({ timeout: 30_000 })
  await ver(page, info, 'auditoria-com-cpf-revelado')
})

test('o 1º Vice-Presidente vê a ficha com o CPF escondido e sem o botão', async ({
  page,
}, info) => {
  await entrar(page, 'vice_presidente')
  await page.goto('/associados')
  const primeiraLinha = page.getByRole('table').getByRole('row').nth(1)
  await expect(primeiraLinha).toBeVisible({ timeout: 30_000 })
  await expect(
    primeiraLinha.getByRole('cell', { name: CPF_ESCONDIDO }),
  ).toBeVisible()
  await primeiraLinha.getByRole('link').first().click()
  await expect(page.locator('[data-cpf="escondido"]')).toHaveText(
    CPF_ESCONDIDO,
    { timeout: 30_000 },
  )
  await expect(page.getByRole('button', { name: 'Mostrar o CPF' })).toHaveCount(
    0,
  )
  await ver(page, info, 'vice-sem-o-botao')
})
