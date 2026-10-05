import { expect, test } from '@playwright/test'

import {
  entrar,
  exigirHomologacao,
  FAIXA_DE_TESTE,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4c — FASE 0 ao vivo: entrar e sair, recusas, o que cada cargo enxerga, Auditoria. Tudo na tela do hml-painel (nada de chamada
// direta à API), com print de cada passo.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

test('a tela de entrada mostra a faixa de teste e recusa CPF inválido e senha errada', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto('/login')
  await expect(page.locator(FAIXA_DE_TESTE)).toContainText('AMBIENTE DE TESTE')
  await expect(page).toHaveTitle(/\[TESTE\]/)
  await ver(page, info, 'tela de entrada com a faixa de teste')

  // recusa provocada 1: CPF com dígito verificador errado nem chega ao servidor
  await page.getByLabel('CPF').fill('111.111.111-11')
  await page.getByLabel('Senha').fill('qualquer-coisa')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('CPF inválido')
  await ver(page, info, 'CPF invalido recusado')

  // recusa provocada 2: CPF certo (o do Presidente de teste), senha errada de propósito
  await page.getByLabel('CPF').fill('111.000.111-88')
  await page.getByLabel('Senha').fill('senha-errada-de-proposito-1A')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
  await ver(page, info, 'senha errada recusada')
  expect(vigia.problemas()).toEqual([])
})

test('o Presidente entra só com CPF e senha (sem segundo passo), vê o início e a faixa de teste', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator(FAIXA_DE_TESTE)).toContainText('AMBIENTE DE TESTE')
  await expect(page.getByText('Marta Souza de Teste').first()).toBeVisible()
  // sem segundo passo: nada de tela de configuração do autenticador
  await expect(page).not.toHaveURL(/mfa/)
  await ver(page, info, 'inicio do Presidente de teste')

  // o módulo "Auditoria" existe e já registrou o que acabamos de fazer
  await page.goto('/auditoria')
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible()
  await ver(page, info, 'auditoria mostrando o login')
  await expect(page.locator('main, [role="main"], body')).toContainText(
    /LOGIN/i,
  )

  await page.goto('/configuracoes')
  await expect(
    page.getByRole('heading', { name: 'Configurações' }).first(),
  ).toBeVisible()
  await ver(page, info, 'configuracoes')

  await page.goto('/acesso')
  await expect(
    page.getByRole('heading', { name: 'Níveis e permissões' }),
  ).toBeVisible()
  await ver(page, info, 'niveis e permissoes')
  expect(vigia.problemas()).toEqual([])
})

test('sair volta ao login e rota protegida sem sessão manda para o login', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await sair(page)
  await ver(page, info, 'depois de sair')
  await page.goto('/associados')
  await expect(page).toHaveURL(/\/login/)
  await ver(page, info, 'rota protegida sem sessao volta ao login')
})

test('o Secretário de teste enxerga só o que o cargo permite (documentos sim, financeiro não)', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  await expect(
    page.getByRole('link', { name: 'Documentos' }).first(),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Financeiro' })).toHaveCount(0)
  await ver(page, info, 'inicio do Secretario')

  // a recusa tem que vir do sistema, não só do menu escondido: digitar o endereço também não abre
  await page.goto('/financeiro')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  await ver(page, info, 'Secretario no financeiro: acesso negado')

  await page.goto('/documentos')
  await expect(
    page.getByRole('heading', { name: 'Documentos' }).first(),
  ).toBeVisible()
  await ver(page, info, 'Secretario na biblioteca de documentos')
  expect(vigia.problemas()).toEqual([])
})

test('o Tesoureiro de teste enxerga financeiro e parcerias, e documentos lhe é negado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Parcerias e emendas/ }).first(),
  ).toBeVisible()
  await ver(page, info, 'inicio do Tesoureiro')

  await page.goto('/documentos')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  await ver(page, info, 'Tesoureiro em documentos: acesso negado')

  await page.goto('/financeiro')
  await expect(
    page
      .getByRole('heading', { name: 'Início' })
      .or(page.getByRole('heading', { name: /Financeiro/ }))
      .first(),
  ).toBeVisible()
  await ver(page, info, 'Tesoureiro no financeiro')
  expect(vigia.problemas()).toEqual([])
})
