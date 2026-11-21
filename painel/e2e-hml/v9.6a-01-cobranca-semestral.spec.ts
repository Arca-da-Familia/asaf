import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  arrumarPlanosAtivos,
  autorizacaoDaSessao,
  cadastrarPelaTela,
  cpfValido,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v9.6a - A COBRANÇA RESPEITA A PERIODICIDADE (decisão do Presidente, 21/11/2026): a associação tem os planos MENSAL e SEMESTRAL; cada associado
// escolhe o seu (a secretaria marca na ficha, aba Situação); o semestral é cobrado em janeiro (janeiro a junho) e julho (julho a dezembro), com
// valor próprio; quem fica de fora de janeiro ou julho paga o resto do semestre. Pelas telas da homologação:
//  1. preparo: um associado novo (Efetivo) e a conta de receita a reconhecer (Passivo), pela tela;
//  2. Planos: o semestral sem a conta de receita a reconhecer é recusado na tela; com ela, aparece "cobrado em janeiro e julho"; um segundo
//     "Efetivo semestral" é recusado pelo servidor;
//  3. Ficha: o cartão Contribuição mostra mensal e semestral com valor e quando cobra; mudar para semestral; a forma que a categoria não tem é
//     recusada pelo servidor; a Auditoria registra;
//  4. Gerar cobranças (só prévia: nada é gravado): janeiro cobra o semestre inteiro num título; um mês do meio cobra o resto, proporcional; com o
//     plano semestral desativado, o aviso diz que ninguém foi cobrado e quem ficou de fora; reativado, volta.
// O banco de teste guarda tudo entre as rodadas: o robô desativa os "Efetivo semestral" das rodadas anteriores e deixa um só "Efetivo mensal".
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const PLANO = `Semestralidade do robô ${RODADA}`
const VALOR = 33000 // centavos: R$ 330,00 o semestre
const PESSOA = `Semestral Robo Cobranca ${RODADA} de Teste`
const CONTA_RECEITA = 'Repasses de emendas (teste)'
const CONTA_PASSIVO = `Contribuições a reconhecer do robô ${RODADA}`

let idPessoa = 0

// ------------------------------------------------------------------------------------------------ datas e dinheiro
function hojeEmBelem(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
}
function somarMeses(competencia: string, meses: number): string {
  const ano = Number(competencia.slice(0, 4))
  const mes = Number(competencia.slice(5, 7))
  const indice = mes - 1 + meses
  return `${ano + Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}`
}
const br = (competencia: string) =>
  `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`
const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})
const reais = (centavos: number) =>
  MOEDA.format(centavos / 100).replace(/\s/g, ' ')

// o próximo janeiro e um mês do meio do semestre (nem janeiro nem julho), sempre depois de hoje (o plano só tem valor a partir de hoje)
const AGORA = hojeEmBelem()
const JANEIRO = `${Number(AGORA.slice(0, 4)) + 1}-01`
const MEIO = [1, 2, 3]
  .map((k) => somarMeses(AGORA, k))
  .find((c) => !['01', '07'].includes(c.slice(5, 7)))!
const MESES_DO_MEIO = 6 - ((Number(MEIO.slice(5, 7)) - 1) % 6)
const FIM_DO_MEIO = somarMeses(MEIO, MESES_DO_MEIO - 1)

// ------------------------------------------------------------------------------------------------ telas
function cartaoDoPlano(page: Page, descricao: string): Locator {
  return page.locator('div.rounded-md.border').filter({
    has: page.locator('p.font-medium', { hasText: `Efetivo — ${descricao}` }),
  })
}

async function abrirPlanos(page: Page): Promise<void> {
  await page.goto('/financeiro/planos-contribuicao')
  await expect(
    page.getByRole('heading', { name: 'Planos de Contribuição', level: 1 }),
  ).toBeVisible()
}

/** A página da lista de planos onde o cartão está (a lista vem por categoria, em páginas de 10). */
async function irAoCartao(page: Page, descricao: string): Promise<Locator> {
  const cartao = cartaoDoPlano(page, descricao)
  for (let i = 0; i < 30; i++) {
    if ((await cartao.count()) > 0) return cartao
    const proxima = page
      .getByRole('navigation', { name: 'Páginas dos planos' })
      .getByRole('button', { name: /Próxima/ })
    if (!(await proxima.isEnabled().catch(() => false))) break
    await proxima.click()
  }
  await expect(
    cartao,
    `o cartão do plano ${descricao} tem de aparecer`,
  ).toHaveCount(1)
  return cartao
}

async function previa(page: Page, competencia: string): Promise<Locator> {
  await page.goto('/financeiro/gerar-cobrancas')
  await expect(
    page.getByRole('heading', { name: 'Gerar Cobranças', level: 1 }),
  ).toBeVisible()
  await page.getByPlaceholder('2026-10').fill(competencia)
  await page.getByRole('button', { name: 'Ver prévia' }).click()
  const painel = page.locator('div.rounded-md.border').filter({
    hasText: `Prévia — competência ${competencia}`,
  })
  await expect(painel).toBeVisible({ timeout: 60_000 })
  return painel
}

const linhaDe = (painel: Locator, nome: string) =>
  painel.locator('div.flex.justify-between.border-b').filter({ hasText: nome })

// ------------------------------------------------------------------------------------------------ 1. preparo
test('preparo: um associado novo (Efetivo) e a conta de receita a reconhecer (Passivo), pela tela', async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await cadastrarPelaTela(page, {
    nome: PESSOA,
    cpf: cpfValido(610000000 + (RODADA % 89000000)),
    email: `semestral.${RODADA}@homologacao.example.com`,
    telefone: `9192${String(RODADA).slice(-7)}`,
  })
  await page.getByLabel('Filtrar').fill(PESSOA)
  const link = page.getByRole('link', { name: PESSOA, exact: true })
  await expect(link).toHaveCount(1)
  idPessoa = Number((await link.getAttribute('href'))?.split('/').pop())
  expect(Number.isInteger(idPessoa)).toBe(true)
  await expect(page.getByRole('row').filter({ hasText: PESSOA })).toContainText(
    'Efetivo',
  )

  await page.goto('/financeiro/plano-contas')
  await expect(
    page.getByRole('heading', { name: 'Plano de Contas', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
  const form = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Salvar', exact: true }),
  })
  await form
    .getByPlaceholder('Código contábil')
    .fill(`2.9.${String(RODADA).slice(-8)}`)
  await form.getByPlaceholder('Descrição').fill(CONTA_PASSIVO)
  await escolherPorTexto(
    form.locator('select').filter({
      has: page.locator('option', { hasText: 'Selecione o tipo…' }),
    }),
    'Passivo',
  )
  await form.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(
    page.locator('p.font-medium', { hasText: CONTA_PASSIVO }),
  ).toBeVisible()
  await ver(page, info, 'conta de receita a reconhecer criada (Passivo)', {
    paginaInteira: false,
  })
  await sair(page)
  expect(vigia.problemas()).toEqual([])
})

// ------------------------------------------------------------------------------------------------ 2. planos
test('plano semestral: sem a conta de receita a reconhecer é recusado na tela; com ela, "cobrado em janeiro e julho"; um segundo é recusado pelo servidor', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  const autorizacao = await autorizacaoDaSessao(
    page,
    '/financeiro/planos-contribuicao',
  )
  // arrumação do banco de teste: nenhum "Efetivo semestral" de rodada anterior, um só "Efetivo mensal" (o mais novo)
  await arrumarPlanosAtivos(page, autorizacao, 'Efetivo', 'Semestral')
  await arrumarPlanosAtivos(page, autorizacao, 'Efetivo', 'Mensal', {
    manterOMaisNovo: true,
  })

  await abrirPlanos(page)
  await page.getByRole('button', { name: 'Novo plano', exact: true }).click()
  const form = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Cadastrar', exact: true }),
  })
  const diferida = form.getByRole('combobox', {
    name: 'Conta de receita a reconhecer (Passivo)',
  })
  await expect(
    diferida,
    'no mensal a conta de receita a reconhecer não aparece',
  ).toHaveCount(0)
  await form.getByPlaceholder('Categoria (ex.: Efetivo)').fill('Efetivo')
  await form.getByPlaceholder('Descrição').fill(PLANO)
  await escolherPorTexto(
    form.getByRole('combobox', { name: 'Periodicidade' }),
    'Semestral',
  )
  await expect(diferida).toBeVisible()
  await expect(
    diferida.locator('option', { hasText: CONTA_PASSIVO }),
  ).toHaveCount(1)
  await expect(
    diferida.locator('option', { hasText: CONTA_RECEITA }),
    'só contas de Passivo',
  ).toHaveCount(0)
  await form.getByPlaceholder('Dia de vencimento').fill('10')
  await form.getByPlaceholder('Valor inicial').fill((VALOR / 100).toFixed(2))
  await escolherPorTexto(
    form.locator('select').filter({
      has: page.locator('option', { hasText: 'Conta contábil (Receita)…' }),
    }),
    CONTA_RECEITA,
  )
  // recusa na tela: semestral sem a conta de receita a reconhecer
  await form.getByRole('button', { name: 'Cadastrar', exact: true }).click()
  await expect(
    form.getByRole('alert').filter({
      hasText: 'Selecione a conta de receita a reconhecer (Passivo).',
    }),
  ).toHaveCount(1)
  await ver(
    page,
    info,
    'semestral sem a conta de receita a reconhecer: recusado na tela',
    { paginaInteira: false },
  )

  await escolherPorTexto(diferida, CONTA_PASSIVO)
  const criado = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/planos-contribuicao/',
  )
  await form.getByRole('button', { name: 'Cadastrar', exact: true }).click()
  expect((await criado).status()).toBe(200)
  const cartao = await irAoCartao(page, PLANO)
  await expect(cartao).toContainText(reais(VALOR))
  await expect(cartao).toContainText(
    'Semestral · cobrado em janeiro e julho · vencimento dia 10',
  )
  await cartao.scrollIntoViewIfNeeded()
  await ver(
    page,
    info,
    'plano semestral cadastrado: cobrado em janeiro e julho',
    { paginaInteira: false },
  )

  // recusa do servidor: um segundo plano ativo "Efetivo semestral"
  await abrirPlanos(page)
  await page.getByRole('button', { name: 'Novo plano', exact: true }).click()
  await form.getByPlaceholder('Categoria (ex.: Efetivo)').fill('Efetivo')
  await form
    .getByPlaceholder('Descrição')
    .fill(`Segundo semestral do robô ${RODADA}`)
  await escolherPorTexto(
    form.getByRole('combobox', { name: 'Periodicidade' }),
    'Semestral',
  )
  await form.getByPlaceholder('Dia de vencimento').fill('10')
  await form.getByPlaceholder('Valor inicial').fill('400.00')
  await escolherPorTexto(
    form.locator('select').filter({
      has: page.locator('option', { hasText: 'Conta contábil (Receita)…' }),
    }),
    CONTA_RECEITA,
  )
  await escolherPorTexto(diferida, CONTA_PASSIVO)
  const recusado = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/planos-contribuicao/',
  )
  await form.getByRole('button', { name: 'Cadastrar', exact: true }).click()
  expect((await recusado).status()).toBe(409)
  await expect(
    form
      .getByRole('alert')
      .filter({ hasText: `Já existe o plano ativo "${PLANO}"` }),
  ).toBeVisible()
  await ver(
    page,
    info,
    'segundo plano Efetivo semestral: recusado pelo servidor',
    { paginaInteira: false },
  )
  await sair(page)
  expect(vigia.problemas()).toEqual([])
})

// ------------------------------------------------------------------------------------------------ 3. ficha
test('ficha do associado: a Contribuição mostra mensal e semestral; mudar para semestral; a forma que a categoria não tem é recusada; a Auditoria registra', async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  const vigia = vigiar(page)
  expect(idPessoa, 'o preparo tem de ter rodado').toBeGreaterThan(0)
  await entrar(page, 'presidente')
  const autorizacao = await autorizacaoDaSessao(
    page,
    `/associados/${idPessoa}?aba=situacao`,
  )
  const cartao = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Contribuição', level: 2 }),
  })
  await expect(cartao).toBeVisible()
  const mensal = cartao.getByRole('radio', { name: /^Mensal/ })
  const semestral = cartao.getByRole('radio', { name: /^Semestral/ })
  await expect(mensal, 'todo associado começa no mensal').toBeChecked()
  await expect(cartao).toContainText(
    `${reais(VALOR)} em janeiro e julho, vencimento dia 10`,
  )
  await expect(cartao).toContainText(
    // \s: o valor em reais vem com espaço inseparável (U+00A0) entre "R$" e o número; o texto comum o Playwright normaliza, a expressão não
    /R\$\s[\d.]+,\d{2}\stodo\smês,\svencimento\sdia\s\d+/,
  )
  const salvar = cartao.getByRole('button', {
    name: 'Salvar forma de pagamento',
  })
  await expect(salvar).toBeDisabled()
  await cartao.scrollIntoViewIfNeeded()
  await ver(page, info, 'ficha: Contribuicao com mensal e semestral', {
    paginaInteira: false,
  })

  await semestral.check()
  await expect(salvar).toBeEnabled()
  const mudou = page.waitForResponse(
    (r) =>
      r.request().method() === 'PUT' &&
      new URL(r.url()).pathname === `/api/associados/${idPessoa}/contribuicao`,
  )
  await salvar.click()
  expect((await mudou).status()).toBe(200)
  await expect(cartao.locator('p[role="status"]')).toHaveText(
    'Forma de pagamento mudada para semestral.',
  )
  await ver(page, info, 'ficha: passou a semestral', { paginaInteira: false })
  await page.reload()
  await expect(
    cartao.getByRole('radio', { name: /^Semestral/ }),
    'depois de recarregar, continua semestral',
  ).toBeChecked()

  // a tela só oferece as formas que a categoria tem; o servidor recusa outra (anual)
  const recusa = await page.request.put(
    `${API_HML}/api/associados/${idPessoa}/contribuicao`,
    {
      headers: { Authorization: autorizacao },
      data: { periodicidade: 'Anual' },
    },
  )
  expect(recusa.status()).toBe(400)
  expect(((await recusa.json()) as { detail: string }).detail).toContain(
    'não tem plano anual ativo',
  )

  await page.goto(`/auditoria?tabela=associados`)
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const linha = page
    .getByRole('row')
    .filter({ has: page.locator('[data-acao="CONTRIBUICAO_ALTERADA"]') })
    .filter({
      has: page.getByRole('cell', { name: String(idPessoa), exact: true }),
    })
    .first()
  await expect(
    linha,
    'a Auditoria mostra a mudança da forma de pagamento',
  ).toBeVisible()
  await expect(linha).toContainText(
    'Forma de pagamento da contribuição alterada',
  )
  await ver(page, info, 'auditoria: forma de pagamento alterada', {
    paginaInteira: false,
  })
  await sair(page)
  expect(vigia.problemas()).toEqual([])
})

// ------------------------------------------------------------------------------------------------ 4. gerar cobranças
test('gerar cobranças (prévia): janeiro cobra o semestre inteiro; um mês do meio cobra o resto; sem o plano semestral, o aviso diz quem ficou de fora', async ({
  page,
}, info) => {
  test.setTimeout(360_000)
  const vigia = vigiar(page)
  expect(idPessoa, 'o preparo tem de ter rodado').toBeGreaterThan(0)
  await entrar(page, 'tesoureiro')

  const janeiro = await previa(page, JANEIRO)
  const linhaJaneiro = linhaDe(janeiro, PESSOA)
  await expect(linhaJaneiro, 'um título só para o semestre').toHaveCount(1)
  await expect(linhaJaneiro).toContainText(
    `${PLANO} · semestral de ${br(JANEIRO)} a 06/${JANEIRO.slice(0, 4)}`,
  )
  await expect(linhaJaneiro).toContainText(reais(VALOR))
  await expect(linhaJaneiro).not.toContainText('proporcional')
  await linhaJaneiro.scrollIntoViewIfNeeded()
  await ver(page, info, `previa de ${JANEIRO}: o semestre inteiro num titulo`, {
    paginaInteira: false,
  })

  const meio = await previa(page, MEIO)
  const linhaMeio = linhaDe(meio, PESSOA)
  await expect(linhaMeio).toHaveCount(1)
  await expect(linhaMeio).toContainText(
    `semestral de ${br(MEIO)} a ${br(FIM_DO_MEIO)} (proporcional: ${MESES_DO_MEIO} de 6 meses)`,
  )
  await expect(linhaMeio).toContainText(
    reais(Math.round((VALOR * MESES_DO_MEIO) / 6)),
  )
  await linhaMeio.scrollIntoViewIfNeeded()
  await ver(
    page,
    info,
    `previa de ${MEIO}: o resto do semestre, proporcional`,
    { paginaInteira: false },
  )

  // sem o plano semestral: a pessoa não é cobrada e o aviso diz isso (sem nome no aviso; o nome em "Quem ficou sem cobrança")
  await abrirPlanos(page)
  let cartao = await irAoCartao(page, PLANO)
  await cartao.getByRole('button', { name: 'Desativar' }).click()
  await expect(cartao).toContainText('· inativo')
  const semPlano = await previa(page, JANEIRO)
  await expect(linhaDe(semPlano, PESSOA)).toHaveCount(0)
  const quadro = semPlano
    .locator('div')
    .filter({ hasText: 'Atenção: nem todos foram cobrados' })
    .last()
  await expect(quadro).toContainText(
    /\d+ associado\(s\) da categoria Efetivo pagam semestral, mas não há plano semestral ativo/,
  )
  await quadro.getByText(/^Quem ficou sem cobrança/).click()
  await expect(quadro.getByText(`${PESSOA} — Efetivo, semestral`)).toBeVisible()
  await quadro.scrollIntoViewIfNeeded()
  await ver(page, info, 'sem o plano semestral: o aviso e quem ficou de fora', {
    paginaInteira: false,
  })

  await abrirPlanos(page)
  cartao = await irAoCartao(page, PLANO)
  await cartao.getByRole('button', { name: 'Reativar' }).click()
  await expect(cartao).not.toContainText('· inativo')
  const devolta = await previa(page, JANEIRO)
  await expect(
    linhaDe(devolta, PESSOA),
    'reativado, volta a cobrar',
  ).toHaveCount(1)

  await page.goto(`/auditoria?tabela=planos_contribuicao`)
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.locator('[data-acao="UPDATE"]') })
      .first(),
    'a Auditoria mostra o plano desativado e reativado',
  ).toBeVisible()
  await ver(page, info, 'auditoria: plano desativado e reativado', {
    paginaInteira: false,
  })
  await sair(page)
  expect(vigia.problemas()).toEqual([])
})
