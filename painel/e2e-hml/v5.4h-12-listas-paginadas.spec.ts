import { expect, test, type Page } from '@playwright/test'

import { entrar, exigirHomologacao, ver, vigiar } from './apoio'

// v5.4h - as listas que crescem (Associados e Razão Contábil) vão ao servidor pedir UMA página de cada vez, com a busca e os filtros na consulta. Pela tela, com os dados
// que a homologação já acumulou (mais de 25 associados e mais de 25 lançamentos): a primeira página traz 25 e o total vem do servidor; a próxima página traz outros; a busca
// acha pelo nome (e pelo número do lançamento) e a tabela volta quando se apaga; situação e categoria filtram de verdade; a busca fica no endereço (recarregar mantém);
// o saldo do Razão é o de todos os lançamentos, em qualquer página.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const linhasDaTabela = (page: Page) => page.locator('table tbody tr')
const nomeDaLinha = (page: Page, n: number) =>
  linhasDaTabela(page).nth(n).locator('td').first().innerText()

async function abrirAssociados(page: Page, busca = '') {
  await page.goto(
    busca ? `/associados?busca=${encodeURIComponent(busca)}` : '/associados',
  )
  await expect(
    page.getByRole('heading', { name: 'Associados', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await expect(linhasDaTabela(page).first()).toBeVisible()
}

async function totalDeRegistros(page: Page): Promise<number> {
  const texto = await page
    .getByText(/\d+ registro\(s\)/)
    .first()
    .innerText()
  return Number(/(\d+) registro/.exec(texto)![1])
}

test('Associados: a primeira página traz 25 e o total vem do servidor; a próxima página traz outros nomes', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirAssociados(page)
  const total = await totalDeRegistros(page)
  expect(
    total,
    'a homologação tem mais de uma página de associados',
  ).toBeGreaterThan(25)
  await expect(linhasDaTabela(page)).toHaveCount(25)
  const primeiroDaPagina1 = await nomeDaLinha(page, 0)
  const nomes1 = await linhasDaTabela(page)
    .locator('td:first-child')
    .allInnerTexts()
  await expect(page.getByText(`1 / ${Math.ceil(total / 25)}`)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Página anterior' }),
  ).toBeDisabled()
  await ver(page, info, 'associados-pagina-1')

  await page.getByRole('button', { name: 'Próxima página' }).click()
  await expect(page.getByText(`2 / ${Math.ceil(total / 25)}`)).toBeVisible()
  await expect(linhasDaTabela(page).first()).not.toContainText(
    primeiroDaPagina1,
  )
  const nomes2 = await linhasDaTabela(page)
    .locator('td:first-child')
    .allInnerTexts()
  expect(
    nomes2.filter((n) => nomes1.includes(n)),
    'nenhum nome repete entre as duas páginas',
  ).toEqual([])
  expect(nomes2.length).toBeGreaterThan(0)
  await ver(page, info, 'associados-pagina-2')
  expect(vigia.problemas()).toEqual([])
})

test('Associados: a busca acha pelo nome, fica no endereço e a lista volta quando se apaga; situação e categoria filtram de verdade', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirAssociados(page)
  const todos = await totalDeRegistros(page)

  await page.getByLabel('Filtrar').fill('Carla Menezes')
  await expect(page).toHaveURL(/busca=Carla/)
  await expect(
    page.getByText('Carla Menezes Souza de Teste').first(),
  ).toBeVisible()
  await expect(page.getByText('Ana Lúcia Ferreira de Teste')).toHaveCount(0)
  expect(await totalDeRegistros(page)).toBeLessThan(todos)
  await ver(page, info, 'associados-busca-por-nome')

  // recarregar mantém a busca (ela está no endereço)
  await page.reload()
  await expect(page.getByLabel('Filtrar')).toHaveValue('Carla Menezes')
  await expect(
    page.getByText('Carla Menezes Souza de Teste').first(),
  ).toBeVisible()

  // o que não existe: tabela sem linhas, sem erro
  await page.getByLabel('Filtrar').fill('zzzz-ninguem-tem-este-nome')
  // sem resultado a tabela mostra uma linha só, de aviso: nenhum associado (nenhum link de ficha)
  await expect(linhasDaTabela(page).locator('a')).toHaveCount(0, {
    timeout: 15_000,
  })
  await expect(page.getByText(/0 registro\(s\)/)).toBeVisible()

  // apagar a busca devolve a lista inteira
  await page.getByLabel('Filtrar').fill('')
  await expect(page).not.toHaveURL(/busca=/)
  await expect(linhasDaTabela(page)).toHaveCount(25, { timeout: 15_000 })
  expect(await totalDeRegistros(page)).toBe(todos)

  // situação: escolhe uma que tenha gente, e toda linha da lista tem essa situação
  const situacao = page.getByRole('combobox', { name: /Situação/ })
  const opcoes = await situacao.locator('option').allInnerTexts()
  const escolhida = opcoes.find((o) => o !== 'Todas')
  expect(escolhida, 'há ao menos uma situação com gente').toBeTruthy()
  const nomeDaSituacao = escolhida!.replace(/ \(\d+\)$/, '')
  const quantos = Number(/\((\d+)\)$/.exec(escolhida!)![1])
  await situacao.selectOption({ label: escolhida! })
  await expect(page).toHaveURL(/situacao=/)
  await expect(page.getByText(`${quantos} registro(s)`).first()).toBeVisible({
    timeout: 15_000,
  })
  const celulas = await linhasDaTabela(page)
    .locator('td:nth-child(4)')
    .allInnerTexts()
  expect(celulas.length).toBeGreaterThan(0)
  expect(
    celulas.every((c) => c.trim() === nomeDaSituacao),
    `todas as linhas são "${nomeDaSituacao}"`,
  ).toBe(true)
  await ver(page, info, 'associados-filtro-por-situacao')

  // categoria junto: só gente que tem as duas
  await page
    .getByRole('combobox', { name: /Categoria/ })
    .selectOption({ index: 1 })
  await expect(page).toHaveURL(/categoria=/)
  const categorias = await linhasDaTabela(page)
    .locator('td:nth-child(3)')
    .allInnerTexts()
  const doFiltro = await page
    .getByRole('combobox', { name: /Categoria/ })
    .inputValue()
  expect(categorias.every((c) => c.trim() === doFiltro)).toBe(true)
  expect(vigia.problemas()).toEqual([])
})

const entradas = (page: Page) =>
  page.locator('div.rounded-md.border.p-3.text-sm')
const titulosDasEntradas = (page: Page) =>
  entradas(page).locator('p.font-medium')

test('Razão Contábil: a primeira página traz os 25 mais novos, o total e o saldo vêm do servidor, e a próxima página traz outros lançamentos', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/financeiro/razao-contabil')
  await expect(
    page.getByRole('heading', { name: 'Razão Contábil', level: 1 }),
  ).toBeVisible()
  await expect(entradas(page).first()).toBeVisible()
  const textoDoTotal = await page.getByText(/^\d+ lançamentos?$/).innerText()
  const total = Number(/^(\d+)/.exec(textoDoTotal)![1])
  expect(
    total,
    'a homologação tem mais de uma página de lançamentos',
  ).toBeGreaterThan(25)
  await expect(entradas(page)).toHaveCount(25)
  const saldo = await page
    .getByText(/Saldo em caixa \(contas Ativo\)/)
    .innerText()
  const paginas = Math.ceil(total / 25)
  await expect(page.getByText(`Página 1 de ${paginas}`)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Página anterior' }),
  ).toBeDisabled()
  const titulos1 = await titulosDasEntradas(page).allInnerTexts()
  await ver(page, info, 'razao-pagina-1')

  await page.getByRole('button', { name: 'Próxima página' }).click()
  await expect(page.getByText(`Página 2 de ${paginas}`)).toBeVisible()
  await expect(titulosDasEntradas(page).first()).not.toHaveText(titulos1[0]!)
  const titulos2 = await titulosDasEntradas(page).allInnerTexts()
  expect(
    titulos2.filter((t) => titulos1.includes(t)),
    'nenhum lançamento repete entre as páginas',
  ).toEqual([])
  // o saldo é o de todos os lançamentos, em qualquer página
  expect(
    await page.getByText(/Saldo em caixa \(contas Ativo\)/).innerText(),
  ).toBe(saldo)
  await ver(page, info, 'razao-pagina-2')
  expect(vigia.problemas()).toEqual([])
})

test('Razão Contábil: a busca acha pelo número do lançamento e pelo histórico, e diz quando não acha', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/financeiro/razao-contabil')
  await expect(entradas(page).first()).toBeVisible()
  const primeiro = (await titulosDasEntradas(page).first().innerText()).trim()
  const numero = /^#(\d+) — /.exec(primeiro)![1]!
  const historico = primeiro.replace(/^#\d+ — /, '')

  await page.getByLabel('Buscar lançamento').fill(`#${numero}`)
  await expect(
    titulosDasEntradas(page).filter({ hasText: primeiro }),
  ).toHaveCount(1, { timeout: 15_000 })
  await ver(page, info, 'razao-busca-por-numero')

  await page.getByLabel('Buscar lançamento').fill(historico)
  await expect(
    titulosDasEntradas(page).filter({ hasText: historico }).first(),
  ).toBeVisible({ timeout: 15_000 })
  const achados = await titulosDasEntradas(page).allInnerTexts()
  expect(
    achados.every((t) => t.toLowerCase().includes(historico.toLowerCase())),
  ).toBe(true)

  await page.getByLabel('Buscar lançamento').fill('nada-disso-existe-xyz')
  await expect(page.getByText('Nenhum lançamento encontrado.')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByLabel('Buscar lançamento').fill('')
  await expect(entradas(page)).toHaveCount(25, { timeout: 15_000 })
  expect(vigia.problemas()).toEqual([])
})
