import { expect, test, type Page } from '@playwright/test'

import {
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  inventariar,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.4d — exploração da SESSÃO: credenciar, pauta, votação, ocorrência e encerramento, inventariando cada estado.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

async function inv(
  page: Page,
  info: Parameters<typeof inventariar>[1],
  nome: string,
) {
  await page.waitForTimeout(1500)
  await inventariar(page, info, nome).catch(() => undefined)
}

test('sessão: credenciar, pauta e votação, estado por estado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/governanca/nova')
  await campo(page, 'Tipo *').selectOption({ index: 1 })
  await campo(page, 'Data e hora da 1ª convocação *').fill(
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 16),
  )
  await campo(page, 'Ordem do dia *').fill(
    `Sessão ${RODADA}: contas do exercício`,
  )
  await page
    .getByRole('button', { name: 'Criar assembleia (rascunho)' })
    .click()
  await expect(page).toHaveURL(/\/governanca\/\d+$/)
  const base = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Convocar' }).click()
  await expect(page.getByRole('button', { name: 'Abrir sessão' })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir sessão' }).click()
  await expect(
    page.getByRole('button', { name: 'Encerrar sessão' }),
  ).toBeVisible()

  await page.goto(`${base}/sessao`)
  await expect(page.getByRole('heading', { name: /Chamada/ })).toBeVisible()
  await inv(page, info, 's1-sessao-aberta')

  // credencia a Presidente de teste
  await escolherPorTexto(page.getByLabel('Associado').first(), 'Marta Souza')
  await page.getByRole('button', { name: 'Credenciar' }).first().click()
  await inv(page, info, 's2-depois-de-credenciar')
  await ver(page, info, 's2 depois de credenciar')

  // código de chamada
  await page.getByRole('button', { name: 'Mostrar código de chamada' }).click()
  await inv(page, info, 's3-codigo-de-chamada')
  await ver(page, info, 's3 codigo de chamada')

  // item de pauta
  await page.getByRole('button', { name: 'Adicionar item' }).click()
  await page.getByLabel('Título').fill('Aprovação das contas de 2026')
  await page.getByLabel('Tempo (min)').fill('10')
  await page
    .getByLabel('Descrição')
    .fill('Votação do parecer do Conselho Fiscal')
  await inv(page, info, 's4-form-item')
  await page
    .getByRole('button', { name: /Adicionar|Salvar|Criar/ })
    .last()
    .click()
  await inv(page, info, 's5-com-item-de-pauta')
  await ver(page, info, 's5 com item de pauta')

  // votação em dois níveis: o item vai para "Em votação" e DENTRO dele se cria a votação
  await page.getByRole('button', { name: 'Abrir votação' }).first().click()
  await inv(page, info, 's6-item-em-votacao')
  await page.getByRole('button', { name: 'Abrir votação' }).last().click()
  await inv(page, info, 's7-form-da-votacao')
  await ver(page, info, 's7 form da votacao')
  await page.getByLabel('Título').last().fill('Aprovação das contas de 2026')
  await page.getByLabel('Opções (separadas por vírgula)').fill('Sim, Não')
  await page.getByRole('button', { name: 'Abrir votação' }).last().click()
  await inv(page, info, 's8-votacao-aberta')
  await ver(page, info, 's8 votacao aberta')

  // vota como o Presidente (credenciado acima)
  await page
    .getByRole('combobox')
    .filter({ hasText: 'Escolha sua opção' })
    .first()
    .selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Votar' }).first().click()
  await inv(page, info, 's9-depois-de-votar')
  await ver(page, info, 's9 depois de votar')
  // voto repetido
  await page
    .getByRole('combobox')
    .filter({ hasText: 'Escolha sua opção' })
    .first()
    .selectOption({ index: 1 })
    .catch(() => undefined)
  await page
    .getByRole('button', { name: 'Votar' })
    .first()
    .click()
    .catch(() => undefined)
  await inv(page, info, 's10-voto-repetido')
  await ver(page, info, 's10 voto repetido')

  // encerrar votação, item e sessão
  for (const [nome, botao] of [
    ['s11-votacao-encerrada', /Encerrar votação/],
    ['s12-item-encerrado', /Encerrar item/],
    ['s13-sessao-encerrada', /Encerrar sessão/],
  ] as const) {
    const b = page.getByRole('button', { name: botao }).first()
    if ((await b.count()) > 0) await b.click()
    await inv(page, info, nome)
    await ver(page, info, nome)
  }
  expect(vigia.problemas()).toEqual([])
})
