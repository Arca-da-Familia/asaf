import { expect, test } from '@playwright/test'

import {
  cadastrarPelaTela,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v9.5j - AS CREDENCIAIS EMITIDAS, no desenho escolhido pelo Presidente (rodada 6, opção 1 no notebook e no celular):
//  1. a tabela com os filtros e a contagem; um associado novo, sem foto, aparece em "Falta imprimir" com "Falta foto";
//  2. marcado e "Imprimir as marcadas", a folha A4 abre numa SEGUNDA ABA; o cartão sem foto só sai com justificativa; "Imprimir" registra; volta à
//     lista: está em "Impressas";
//  3. no celular, a lista leva à ficha na aba Situação, com "Imprimir esta credencial" e "Emitir outra credencial".
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const NOME = `Emitida Robo ${RODADA} de Teste`

test('a tabela, a folha A4 numa segunda aba com a justificativa do que falta, e o registro da impressão', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await cadastrarPelaTela(page, {
    nome: NOME,
    cpf: cpfValido((RODADA + 7) % 1_000_000_000),
    email: `emitida.${RODADA}@homologacao.example.com`,
  })

  await page.goto('/associados/credenciais')
  await expect(
    page.getByRole('heading', { name: 'Credenciais', level: 1 }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Falta imprimir · \d+$/ }),
  ).toBeVisible()
  await page.getByPlaceholder('Nome ou matrícula').fill(String(RODADA))
  const tabela = page.getByRole('table', { name: 'Credenciais dos associados' })
  const linha = tabela.getByRole('row', { name: new RegExp(NOME) })
  await expect(linha).toBeVisible({ timeout: 30_000 })
  await expect(linha).toContainText('Falta imprimir')
  await expect(linha).toContainText('Falta foto')
  await ver(page, info, 'credenciais emitidas com o associado novo')

  await linha.getByRole('checkbox').check()
  await expect(page.getByText('1 marcada')).toBeVisible()
  const [folha] = await Promise.all([
    context.waitForEvent('page'),
    page
      .getByRole('button', { name: 'Imprimir as marcadas (folha A4)' })
      .click(),
  ])
  await folha.waitForLoadState()
  await expect(folha).toHaveURL(/\/associados\/credenciais\/imprimir\?ids=\d+/)
  await expect(folha.getByRole('region', { name: 'Folha 1 de 1' })).toBeVisible(
    { timeout: 30_000 },
  )
  await expect(folha.getByLabel(`Credencial de ${NOME}`)).toBeVisible()
  const imprimir = folha.getByRole('button', { name: 'Imprimir' })
  await expect(imprimir).toBeDisabled()
  await ver(folha, info, 'a folha A4 na segunda aba pedindo a justificativa')
  await folha
    .getByLabel(new RegExp(`${NOME}: falta foto`))
    .fill('O robô da homologação confere a impressão sem foto.')
  await expect(imprimir).toBeEnabled()
  await imprimir.click()
  await expect(folha.getByRole('status')).toContainText(
    'a credencial é a mesma',
    { timeout: 30_000 },
  )
  await ver(folha, info, 'impressao registrada')
  await folha.close()

  await page.reload()
  await page.getByRole('button', { name: /^Impressas · \d+$/ }).click()
  await page.getByPlaceholder('Nome ou matrícula').fill(String(RODADA))
  await expect(
    tabela.getByRole('row', { name: new RegExp(NOME) }),
  ).toContainText(/Impressa em \d{2}\/\d{2}\/\d{4}/, {
    timeout: 30_000,
  })
  await ver(page, info, 'agora em Impressas')
  expect(vigia.problemas()).toEqual([])
})

test('no celular: a lista leva à ficha na aba Situação, com Imprimir e Emitir outra', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await entrar(page, 'presidente')
  await page.goto('/associados/credenciais')
  await page.getByPlaceholder('Nome ou matrícula').fill(String(RODADA))
  const lista = page.getByRole('list', { name: 'Credenciais' })
  await expect(lista.getByRole('link', { name: new RegExp(NOME) })).toBeVisible(
    { timeout: 30_000 },
  )
  const larguras = await page.evaluate(() => ({
    pagina: document.documentElement.scrollWidth,
    tela: window.innerWidth,
  }))
  expect(larguras.pagina, 'nada passa da largura da tela').toBeLessThanOrEqual(
    larguras.tela,
  )
  await ver(page, info, 'celular lista de credenciais')
  await lista.getByRole('link', { name: new RegExp(NOME) }).click()
  await expect(page).toHaveURL(/aba=situacao/)
  const cartao = page.getByRole('region', { name: 'Credencial (carteirinha)' })
  await expect(
    cartao.getByRole('button', { name: 'Imprimir esta credencial' }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    cartao.getByRole('button', { name: 'Emitir outra credencial' }),
  ).toBeVisible()
  await ver(page, info, 'celular ficha na aba situacao')
  expect(vigia.problemas()).toEqual([])
})
