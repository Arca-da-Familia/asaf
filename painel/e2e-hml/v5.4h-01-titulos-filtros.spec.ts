import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Títulos (as entradas e as saídas): filtro por MÊS, entradas e saídas em páginas próprias, categoria, busca por texto e paginação.
// Os títulos de teste vencem em 2088 (um ano que nenhum outro roteiro usa), então a contagem é exata mesmo com a homologação cheia.
test.describe.configure({ mode: 'serial' })
test.setTimeout(600_000)

const S = String(RODADA)
const MES_SAIDAS = '2088-05'
const MES_ENTRADAS = '2088-06'
const QUANTIDADE_DE_SAIDAS = 31
const QUANTIDADE_DE_ENTRADAS = 3
const POR_PAGINA = 25

const descricaoSaida = (n: number) =>
  `Saída de teste ${S} nº ${String(n).padStart(2, '0')}`
const descricaoEntrada = (n: number) => `Entrada de teste ${S} nº ${n}`

/** O menu só mostra Entradas e Saídas dentro do módulo Financeiro: entra por ele, como o usuário faria. */
async function irParaAPaginaDoFinanceiro(
  page: Page,
  nome: 'Entradas' | 'Saídas',
) {
  await page.getByRole('link', { name: 'Financeiro' }).first().click()
  // o link existe no menu lateral e também no cartão "Telas do módulo": o roteiro usa o do menu
  await page
    .getByRole('complementary')
    .getByRole('link', { name: nome, exact: true })
    .click()
}

async function capturarToken(page: Page): Promise<() => string> {
  let token = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token = cab
  })
  return () => token
}

async function api(
  page: Page,
  token: () => string,
  metodo: 'GET' | 'POST',
  caminho: string,
  corpo?: unknown,
) {
  const r = await page.request.fetch(`${API_HML}${caminho}`, {
    method: metodo,
    headers: { Authorization: token(), 'Content-Type': 'application/json' },
    data: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  return {
    status: r.status(),
    corpo: (await r.json().catch(() => null)) as unknown,
  }
}

const cartoes = (page: Page, texto: RegExp) =>
  page.locator('div.rounded-md.border').filter({ hasText: texto })

test('os títulos de teste são lançados (31 saídas em maio de 2088 e 3 entradas em junho de 2088)', async ({
  page,
}, info) => {
  exigirHomologacao()
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'tesoureiro')
  await page.goto('/financeiro/titulos')
  await expect(
    page.getByRole('heading', { name: 'Títulos', level: 1 }),
  ).toBeVisible()

  // por padrão a tela abre no mês atual (o mês do navegador de quem usa)
  const mesDoNavegador = await page.evaluate(() => {
    const h = new Date()
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`
  })
  await expect(page.getByLabel('Mês de vencimento')).toHaveValue(mesDoNavegador)
  await ver(page, info, 'titulos abre no mes atual')

  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const contas = (await api(page, token, 'GET', '/api/plano-contas/'))
    .corpo as { id_conta: number; tipo: string; sintetica?: boolean }[]
  const despesa = contas.find((c) => c.tipo === 'Despesa' && !c.sintetica)
  const receita = contas.find((c) => c.tipo === 'Receita' && !c.sintetica)
  expect(
    despesa && receita,
    'a homologação tem conta de despesa e de receita',
  ).toBeTruthy()
  for (let n = 1; n <= QUANTIDADE_DE_SAIDAS; n += 1) {
    const dia = String(1 + (n % 28)).padStart(2, '0')
    const r = await api(page, token, 'POST', '/titulos/', {
      tipo_titulo: 'A Pagar',
      id_conta_contabil: despesa!.id_conta,
      descricao: descricaoSaida(n),
      valor_original: 10 + n,
      data_vencimento: `${MES_SAIDAS}-${dia}T00:00:00`,
    })
    expect(r.status, `lançar a saída ${n}`).toBe(200)
  }
  for (let n = 1; n <= QUANTIDADE_DE_ENTRADAS; n += 1) {
    const r = await api(page, token, 'POST', '/titulos/', {
      tipo_titulo: 'A Receber',
      id_conta_contabil: receita!.id_conta,
      descricao: descricaoEntrada(n),
      valor_original: 100,
      data_vencimento: `${MES_ENTRADAS}-1${n}T00:00:00`,
    })
    expect(r.status, `lançar a entrada ${n}`).toBe(200)
  }
  expect(vigia.problemas()).toEqual([])
})

test('Saídas: o mês filtra, 31 títulos são 2 páginas de 25 e a segunda página tem os 6 que sobram', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await irParaAPaginaDoFinanceiro(page, 'Saídas')
  await expect(
    page.getByRole('heading', { name: 'Saídas', level: 1 }),
  ).toBeVisible()
  // a página das saídas não oferece o filtro de tipo
  await expect(page.getByLabel('Tipo', { exact: true })).toHaveCount(0)

  await page.getByLabel('Mês de vencimento').fill(MES_SAIDAS)
  await expect(
    page.getByText(`${QUANTIDADE_DE_SAIDAS} título(s) · Original`),
  ).toBeVisible()
  await expect(cartoes(page, new RegExp(`Saída de teste ${S}`))).toHaveCount(
    POR_PAGINA,
  )
  await expect(page.getByText('Página 1 de 2')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Página anterior' }),
  ).toBeDisabled()
  await ver(page, info, 'saidas: mes de maio de 2088, pagina 1')

  await page.getByRole('button', { name: 'Próxima página' }).click()
  await expect(page.getByText('Página 2 de 2')).toBeVisible()
  await expect(cartoes(page, new RegExp(`Saída de teste ${S}`))).toHaveCount(
    QUANTIDADE_DE_SAIDAS - POR_PAGINA,
  )
  await expect(
    page.getByRole('button', { name: 'Próxima página' }),
  ).toBeDisabled()
  await ver(page, info, 'saidas: pagina 2')

  await page.getByRole('button', { name: 'Página anterior' }).click()
  await expect(page.getByText('Página 1 de 2')).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('Entradas: só as a receber; mês sem lançamento diz que não há; busca por texto acha um título só', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await irParaAPaginaDoFinanceiro(page, 'Entradas')
  await expect(
    page.getByRole('heading', { name: 'Entradas', level: 1 }),
  ).toBeVisible()

  await page.getByLabel('Mês de vencimento').fill(MES_ENTRADAS)
  await expect(
    page.getByText(`${QUANTIDADE_DE_ENTRADAS} título(s) · Original`),
  ).toBeVisible()
  await expect(cartoes(page, new RegExp(`Entrada de teste ${S}`))).toHaveCount(
    QUANTIDADE_DE_ENTRADAS,
  )
  // nenhuma saída aparece na página das entradas
  await expect(cartoes(page, /Saída de teste/)).toHaveCount(0)
  await ver(page, info, 'entradas: junho de 2088')

  await page.getByLabel('Mês de vencimento').fill(MES_SAIDAS)
  await expect(page.getByText('0 título(s) · Original')).toBeVisible()
  await expect(page.getByText('Nenhum título encontrado.')).toBeVisible()
  await ver(page, info, 'entradas: mes so com saidas nao tem entrada')

  await page.getByLabel('Mês de vencimento').fill(MES_ENTRADAS)
  await page
    .getByLabel('Buscar por descrição, nome ou fornecedor')
    .fill(descricaoEntrada(2))
  await expect(page.getByText('1 título(s) · Original')).toBeVisible()
  await expect(cartoes(page, new RegExp(descricaoEntrada(2)))).toHaveCount(1)
  expect(vigia.problemas()).toEqual([])
})

test('Todos os títulos: tipo, situação e categoria combinam; "Todo o período" tira o mês; os filtros ficam no endereço', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await page.goto(`/financeiro/titulos?mes=${MES_SAIDAS}`)
  await expect(
    page.getByText(`${QUANTIDADE_DE_SAIDAS} título(s) · Original`),
  ).toBeVisible()

  await page.getByLabel('Tipo', { exact: true }).selectOption('A Receber')
  await expect(page.getByText('0 título(s) · Original')).toBeVisible()
  await page.getByLabel('Tipo', { exact: true }).selectOption('A Pagar')
  await expect(
    page.getByText(`${QUANTIDADE_DE_SAIDAS} título(s) · Original`),
  ).toBeVisible()
  await page.getByLabel('Situação').selectOption('Pago')
  await expect(page.getByText('0 título(s) · Original')).toBeVisible()
  await page.getByLabel('Situação').selectOption('Pendente')
  await expect(
    page.getByText(`${QUANTIDADE_DE_SAIDAS} título(s) · Original`),
  ).toBeVisible()
  // o endereço guarda o que foi escolhido (dá para mandar o link)
  await expect(page).toHaveURL(new RegExp(`mes=${MES_SAIDAS}`))
  await expect(page).toHaveURL(/tipo=A\+Pagar|tipo=A%20Pagar/)
  await expect(page).toHaveURL(/status=Pendente/)

  await page.getByRole('button', { name: 'Todo o período' }).click()
  await expect(page.getByLabel('Mês de vencimento')).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Voltar ao mês atual' }),
  ).toBeVisible()
  await expect(page).toHaveURL(/periodo=todos/)
  await ver(page, info, 'todo o periodo: o mes sai do filtro')
  await page.getByRole('button', { name: 'Voltar ao mês atual' }).click()
  await expect(page.getByLabel('Mês de vencimento')).toBeEnabled()
  expect(vigia.problemas()).toEqual([])
})

test('quem não tem o Financeiro (Secretário) é barrado nas páginas de Entradas e de Saídas', async ({
  page,
}) => {
  await entrar(page, 'secretario')
  for (const rota of [
    '/financeiro/entradas',
    '/financeiro/saidas',
    '/financeiro/titulos',
  ]) {
    await page.goto(rota)
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
    ).toBeVisible()
  }
})
