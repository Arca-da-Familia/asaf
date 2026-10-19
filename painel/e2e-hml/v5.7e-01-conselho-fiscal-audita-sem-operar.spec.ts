import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  type Papel,
  ver,
  vigiar,
} from './apoio'

// v5.7e - O CONSELHO FISCAL AUDITA, NÃO OPERA (decisão do Presidente, 2026-10-19). Provado na homologação, com as pessoas de verdade do teste:
//  1. o conselheiro (Heitor) tem `financeiro_auditar` e `auditoria`, e NÃO tem `financeiro`;
//  2. no painel ele entra no módulo Financeiro e o menu mostra SÓ o que ele audita (Conselho Fiscal, Auditoria financeira, Relatórios): nada de registrar saída, títulos, doações...;
//     o Início do Financeiro o leva ao Conselho Fiscal; digitar o endereço de uma tela que opera dá "sem permissão"; em Relatórios não há botão de gerar a prestação de contas;
//  3. o servidor recusa (403) cada coisa que opera, com o token DELE (não só a tela esconde): listar títulos, cadastrar conta, confirmar doação, gerar a prestação, responder questionamento;
//     e aceita as leituras da auditoria (títulos e caixa do Conselho, lista da auditoria, plano de contas, balancete, prestações de contas);
//  4. o tesoureiro (`financeiro`) continua com o módulo inteiro e as mesmas leituras. A decisão de título pelo Conselho segue provada no roteiro v5.4h-03.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const HOJE = new Date().toISOString().slice(0, 10)
const LEITURAS = [
  '/api/conselho-fiscal/financeiro/titulos',
  '/api/conselho-fiscal/financeiro/caixa',
  '/api/conselho-fiscal/auditoria-financeira/',
  '/api/plano-contas/',
  `/api/relatorios/balancete?data_inicio=${HOJE}&data_fim=${HOJE}`,
  '/api/prestacoes-de-contas/',
]
const NAO_OPERA: Array<[string, string, Record<string, unknown> | undefined]> =
  [
    ['GET', '/api/titulos/', undefined],
    ['GET', '/api/intencoes-doacao/', undefined],
    [
      'POST',
      '/plano-contas/',
      { codigo_contabil: 'ROBO-AUD', descricao_conta: 'x', tipo: 'Receita' },
    ],
    [
      'POST',
      '/api/intencoes-doacao/1/confirmar',
      { valor_recebido: 10, id_conta_contabil: 1, id_conta_contabil_caixa: 2 },
    ],
    ['POST', '/api/prestacoes-de-contas/', { ano_exercicio: 2026 }],
    [
      'POST',
      '/api/questionamentos/1/respostas',
      { texto: 'resposta da tesouraria' },
    ],
  ]
const MENU_DO_AUDITOR = [
  'Conselho Fiscal',
  'Auditoria financeira',
  'Relatórios',
]
const MENU_QUE_OPERA = [
  'Títulos',
  'Registrar saída',
  'Doações',
  'Gerar Cobranças',
  'Compras',
]

async function comoPapel(page: Page, papel: Papel): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, papel)
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

async function abrirOFinanceiro(page: Page) {
  await page
    .getByRole('link', { name: /^Financeiro/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/financeiro/)
}

// o Início DO MÓDULO é o link "Início" para /financeiro (há também o "← Início" que volta à tela inicial do painel e o "Financeiro" da trilha, que também aponta para /financeiro)
const inicioDoModulo = (page: Page) =>
  page.locator('a[href="/financeiro"]', { hasText: /^Início$/ })

const itemDoMenu = (page: Page, rotulo: string) =>
  page.getByRole('navigation').getByRole('link', { name: rotulo, exact: true })

test('o conselheiro tem a permissão que audita e não a que opera', async ({
  page,
}) => {
  const vigia = vigiar(page)
  const cab = await comoPapel(page, 'conselheiro')
  const r = await page.request.get(`${API_HML}/auth/me`, {
    headers: { Authorization: cab },
  })
  expect(r.status()).toBe(200)
  const { permissoes } = (await r.json()) as { permissoes: string[] }
  expect(permissoes).toContain('financeiro_auditar')
  expect(permissoes).toContain('auditoria')
  expect(permissoes, 'o Conselho Fiscal não opera o financeiro').not.toContain(
    'financeiro',
  )
  expect(vigia.problemas()).toEqual([])
})

test('no painel o conselheiro vê só o que audita; o que opera some do menu e é barrado se digitar o endereço', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await comoPapel(page, 'conselheiro')
  await abrirOFinanceiro(page)
  // o Início do Financeiro é o retrato de quem opera: ele cai direto no Conselho Fiscal
  await expect(page).toHaveURL(/\/financeiro\/conselho-fiscal$/)
  await expect(
    page.getByRole('heading', { name: /Conselho Fiscal/, level: 1 }),
  ).toBeVisible()
  for (const item of MENU_DO_AUDITOR)
    await expect(itemDoMenu(page, item), item).toBeVisible()
  for (const item of MENU_QUE_OPERA)
    await expect(itemDoMenu(page, item), item).toHaveCount(0)
  await expect(inicioDoModulo(page), 'Início do módulo').toHaveCount(0)
  await ver(page, info, 'menu-do-conselheiro-so-o-que-audita')

  // a Auditoria financeira abre e lista o mês
  await itemDoMenu(page, 'Auditoria financeira').click()
  await expect(
    page.getByRole('heading', { name: 'Auditoria financeira', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await ver(page, info, 'auditoria-financeira-do-conselheiro')

  // Relatórios abre para ler, sem o botão de gerar a prestação de contas
  await itemDoMenu(page, 'Relatórios').click()
  await expect(
    page.getByRole('heading', { name: 'Relatórios', level: 1 }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Prestação de contas do exercício' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Gerar nova versão' }),
  ).toHaveCount(0)
  await ver(page, info, 'relatorios-sem-o-botao-de-gerar')

  // o que opera: digitar o endereço dá "sem permissão"
  for (const rota of [
    '/financeiro/titulos',
    '/financeiro/registrar-saida',
    '/financeiro/doacoes',
    '/financeiro/compras',
  ]) {
    await page.goto(rota)
    await expect(page, rota).toHaveURL(/\/403$/)
  }
  await ver(page, info, 'tela-que-opera-recusada')
  expect(vigia.problemas()).toEqual([])
})

test('o servidor recusa o que opera com o token do conselheiro e aceita as leituras da auditoria', async ({
  page,
}) => {
  const cab = await comoPapel(page, 'conselheiro')
  const headers = { Authorization: cab }
  for (const rota of LEITURAS) {
    const r = await page.request.get(`${API_HML}${rota}`, { headers })
    expect(r.status(), `leitura ${rota}: ${await r.text()}`).toBe(200)
  }
  for (const [metodo, rota, corpo] of NAO_OPERA) {
    const r = await page.request.fetch(`${API_HML}${rota}`, {
      method: metodo,
      headers,
      ...(corpo ? { data: corpo } : {}),
    })
    expect(r.status(), `${metodo} ${rota} deveria ser recusada`).toBe(403)
    expect(await r.text()).toContain("'financeiro'")
  }
})

test('o tesoureiro continua com o módulo inteiro e as mesmas leituras', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const cab = await comoPapel(page, 'tesoureiro')
  await abrirOFinanceiro(page)
  for (const item of [
    ...MENU_QUE_OPERA.filter((i) => i !== 'Início'),
    ...MENU_DO_AUDITOR,
  ])
    await expect(itemDoMenu(page, item), item).toBeVisible()
  await expect(inicioDoModulo(page)).toBeVisible()
  await ver(page, info, 'menu-do-tesoureiro-inteiro')
  for (const rota of LEITURAS) {
    const r = await page.request.get(`${API_HML}${rota}`, {
      headers: { Authorization: cab },
    })
    expect(r.status(), `tesoureiro lê ${rota}`).toBe(200)
  }
  const titulos = await page.request.get(`${API_HML}/api/titulos/`, {
    headers: { Authorization: cab },
  })
  expect(titulos.status()).toBe(200)
  expect(vigia.problemas()).toEqual([])
})

test('quem nunca teve acesso ao financeiro segue sem o módulo (o secretário)', async ({
  page,
}) => {
  const cab = await comoPapel(page, 'secretario')
  for (const rota of LEITURAS) {
    const r = await page.request.get(`${API_HML}${rota}`, {
      headers: { Authorization: cab },
    })
    expect(r.status(), rota).toBe(403)
  }
})
