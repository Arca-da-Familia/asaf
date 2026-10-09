import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

import {
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  inventariar,
  RODADA,
  sair,
  ver,
  vigiar,
  type Papel,
} from './apoio'

// v5.4e — FASE 3 ao vivo, parte 1: BASE CONTÁBIL (exercício, plano de contas, centros de custo, contas financeiras, razão contábil) e
// ORÇAMENTO E FLUXO DE CAIXA (orçamento, fluxo projetado, reserva de contingência), pelas telas do módulo Financeiro, com a recusa que o
// sistema tem que fazer em cada passo, os valores conferidos AO CENTAVO e a Auditoria mostrando cada ação.
//
// O que este roteiro SABE do ambiente de teste (lido em scripts/popular_homologacao.py e no servidor, não suposto):
//  - O semeador cria o exercício 2026 (aberto), três contas (1.01.01 Ativo, 4.01.01 Receita, 5.01.01 Despesa) e dois lançamentos de teste.
//    NÃO cria conta financeira nem deliberação concluída: tudo o que o roteiro usa, ele cria (nomes e códigos com o número da rodada).
//  - Quem escreve é o Tesoureiro (o cargo concede `financeiro`); quem confere a Auditoria é o Presidente (`auditoria`). O Secretário não tem
//    `financeiro`: tem de ser barrado em todas as telas do módulo.
//  - NÃO existe tela nem rota para lançar à mão um lançamento com partidas soltas: o razão só recebe lançamento por baixa de título,
//    transferência e estorno, e os três passam por `criar_lancamento`, que recusa o que não fecha (o teste desse guarda é o de serviço,
//    tests/test_financeiro.py). Aqui a partida dobrada é provada pela tela: TODO lançamento do razão fecha (débitos = créditos, ao centavo), e
//    o saldo de cada conta financeira é igual à soma das partidas dela no razão.
//  - O valor do formulário é em REAIS (número com ponto, "1234.56"); a tela mostra com Intl pt-BR BRL; as contas aqui são em centavos inteiros.
//  - O orçamento exige uma deliberação de assembleia JÁ CONCLUÍDA (a do roteiro v5.4d-05 da ata deixa uma); sem ela, os cenários que criam
//    linha de orçamento e reserva são pulados com o motivo no relatório.
//  - O último bloco de exercício FECHA o exercício aberto (2026, ou o que a rodada anterior abriu) e abre o do ano seguinte: é a única forma de
//    provar "exercício fechado não aceita lançamento" e "ano repetido". Um `afterAll` garante que sobre um exercício aberto, mesmo se o
//    roteiro cair no meio.
//
// O arquivo é uma história só, em ordem (`serial`): as contas criadas no começo são usadas no fim. O que provavelmente reprova (achado do
// sistema, não erro do roteiro) NÃO usa `expect` no meio da história: vai para `achados` e para as anotações do relatório, e o último teste
// reprova listando todos. Assim um defeito não pula os cenários que vêm depois.
test.beforeAll(() => exigirHomologacao())
test.describe.configure({ mode: 'serial' })

const R = RODADA
const TESOUREIRO = 'Fábio Henrique Dias de Teste'

// ------------------------------------------------------------------------------------------------ o que o roteiro cria
const COD_PAI = `9.${R}`
const COD_CAIXA = `9.${R}.1`
const COD_BANCO = `9.${R}.2`
const COD_APLIC = `9.${R}.3`
const COD_RECEITA = `4.${R}`
const COD_DESPESA = `5.${R}`
const COD_A = `2.${R}`
const COD_B = `2.${R}.1`
const COD_E = `3.${R}`
const DESC_PAI = `Grupo Ativo de teste ${R}`
const DESC_CAIXA = `Caixa A de teste ${R}`
const DESC_BANCO = `Banco B de teste ${R}`
const DESC_APLIC = `Aplicação C de teste ${R}`
const DESC_RECEITA = `Receita de teste ${R}`
const DESC_DESPESA = `Despesa de teste ${R}`
const DESC_A = `Passivo A de teste ${R}`
const DESC_B = `Passivo B de teste ${R}`
const DESC_E = `Conta sem uso de teste ${R}`
const COD_C1 = `CC${R}-1`
const NOME_C1 = `Centro de teste ${R} um`
const COD_C2 = `CC${R}-2`
const NOME_C2 = `Centro de teste ${R} dois`

const DESC_TA = `Mensalidade de teste do robô ${R} (receita)`
const DESC_TB = `Contribuição de teste do robô ${R} (estorno reabre)`
const DESC_TP = `Fornecedor de teste do robô ${R} (a pagar)`
const DESC_TR = `Doação de teste do robô ${R} (a receber)`

const HISTORICO = {
  t1: `Transferência ${R} alfa (caixa para banco)`,
  t2: `Transferência ${R} bravo (acima do saldo)`,
  t3: `Transferência ${R} charlie (caixa para aplicação)`,
  t4: `Transferência ${R} delta (reforço da reserva)`,
  t5: `Transferência ${R} eco (exercício novo)`,
  fechado: `Transferência ${R} foxtrot (exercício fechado)`,
}

// valores em CENTAVOS inteiros (nada de conta com ponto flutuante)
const BAIXA_A = 123_456
const BAIXA_B = 5_005
const T1 = 30_000
const T2 = 150_000
const T3 = 20_000
const T4 = 40_000
const T5 = 1_000
const TITULO_PAGAR = 7_777
const TITULO_RECEBER = 5_555
const PREVISTO_R1 = 1_000_000
const PREVISTO_R2 = 100_000
const PREVISTO_R3 = 50_000
const PREVISTO_RB = 10_000
const MINIMO_RESERVA = 50_000

const ids = {
  pai: 0,
  caixa: 0,
  banco: 0,
  aplic: 0,
  receita: 0,
  despesa: 0,
  contaA: 0,
  contaB: 0,
  contaE: 0,
  c1: 0,
  c2: 0,
  cfA: 0,
  cfB: 0,
  cfC: 0,
  tituloA: 0,
  lancBaixaA: 0,
  t1: 0,
  t2: 0,
  t3: 0,
  seqT1: 0,
  seqT2: 0,
  r1: 0,
  r2: 0,
  r3: 0,
  rB: 0,
  reserva: 0,
  tituloB: 0,
  lancBaixaB: 0,
}
// saldo esperado de cada conta financeira, em centavos, atualizado a cada lançamento que o roteiro faz
const saldos = { A: 0, B: 0, C: 0 }
let temDeliberacao: boolean | null = null
const achados: string[] = []

const NAVEGADOR = {
  baseURL: process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br',
  locale: 'pt-BR',
  timezoneId: 'America/Belem',
  viewport: { width: 1366, height: 900 },
}

// ------------------------------------------------------------------------------------------------ apoio
/** Um achado do sistema: vai para a lista final E para as anotações do relatório (aparece mesmo se um teste seguinte cair). */
function registrarAchado(texto: string): void {
  achados.push(texto)
  test.info().annotations.push({ type: 'achado', description: texto })
}

/** Comportamento que não é bem um erro (é decisão de produto), só registrado para quem lê o relatório. */
function registrarObservacao(texto: string): void {
  test.info().annotations.push({ type: 'observação', description: texto })
}

/** Dia (AAAA-MM-DD, dd/mm/aaaa e ano) daqui a `deslocamentoDias`, no relógio de Belém (UTC-3), que é o do navegador do robô. */
function diaEmBelem(deslocamentoDias: number): {
  iso: string
  br: string
  ano: number
} {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + deslocamentoDias * 86_400_000))
  const [ano, mes, dia] = iso.split('-')
  return { iso, br: `${dia}/${mes}/${ano}`, ano: Number(ano) }
}

/** Como a tela mostra um valor em reais (Intl pt-BR, BRL), com o espaço de não-quebra trocado por espaço comum (o Playwright já normaliza o texto da página). */
const brl = (centavos: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(centavos / 100)
    .replace(/\s/g, ' ')

/** O que se digita num campo de valor (em reais, ponto decimal). */
const digitado = (centavos: number): string => (centavos / 100).toFixed(2)

/** Lê o primeiro valor em reais de um texto da tela ("R$ 1.234,56", "-R$ 765,44") e devolve em centavos. */
function emCentavos(texto: string): number {
  const m = /(-?)R\$\s?([\d.]+),(\d{2})/.exec(texto.replace(/\s/g, ' '))
  if (!m) throw new Error(`não achei valor em reais em "${texto}"`)
  const valor =
    Number((m[2] ?? '').replace(/\./g, '')) * 100 + Number(m[3] ?? '0')
  return m[1] === '-' ? -valor : valor
}

const trecho = (codigo: string, descricao: string): string =>
  `${codigo} — ${descricao}`

const cartoes = (page: Page): Locator => page.locator('div.rounded-md.border')

const casaCaminho = (caminho: string | RegExp, url: string): boolean =>
  typeof caminho === 'string'
    ? new URL(url).pathname === caminho
    : caminho.test(new URL(url).pathname)

/** Faz a ação (um clique) e devolve a resposta do servidor ao POST/PUT/DELETE esperado: status, corpo e endereço. */
async function enviar<T = Record<string, number>>(
  page: Page,
  metodo: 'POST' | 'PUT' | 'DELETE',
  caminho: string | RegExp,
  acao: () => Promise<unknown>,
): Promise<{ status: number; corpo: T; caminho: string }> {
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === metodo && casaCaminho(caminho, r.url()),
    ),
    acao(),
  ])
  const texto = await resposta.text()
  let corpo = {} as T
  try {
    corpo = JSON.parse(texto) as T
  } catch {
    // resposta que não é JSON: o status basta
  }
  return {
    status: resposta.status(),
    corpo,
    caminho: new URL(resposta.url()).pathname,
  }
}

/** Abre a tela e espera as leituras dela chegarem (as telas do financeiro não têm "Carregando…": vazio e carregando se parecem). */
async function abrirTela(
  page: Page,
  rota: string,
  leituras: string[],
  titulo: string,
): Promise<void> {
  const chegando = leituras.map((caminho) =>
    page.waitForResponse(
      (r) => r.request().method() === 'GET' && casaCaminho(caminho, r.url()),
    ),
  )
  await page.goto(rota)
  await expect(
    page.getByRole('heading', { name: titulo, level: 1 }),
  ).toBeVisible()
  await Promise.all(chegando)
}

/** Num <select>, escolhe a opção que contém o texto (espera ela chegar: as opções vêm de leituras próprias). */
async function escolher(seletor: Locator, parteDoTexto: string): Promise<void> {
  await expect(
    seletor.locator('option', { hasText: parteDoTexto }).first(),
  ).toBeAttached()
  await escolherPorTexto(seletor, parteDoTexto)
}

/** Entra como o Tesoureiro e espera o Início oferecer o Financeiro (as permissões do cargo já chegaram). */
async function entrarNoFinanceiro(
  page: Page,
  papel: Papel = 'tesoureiro',
): Promise<void> {
  await entrar(page, papel)
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
}

// ------------------------------------------------------------------------------------------------ a Auditoria
/** Abre a Auditoria filtrada por tabela e devolve o total de registros dela (lido da resposta da própria tela). */
async function abrirAuditoria(page: Page, tabela: string): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${tabela}`),
  )
  await campo(page, 'Tabela').fill(tabela)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

/** As linhas da Auditoria com a ação (e, se pedido, o registro e quem fez). */
function linhasDaAuditoria(
  page: Page,
  acao: string,
  filtros: { registro?: number; quem?: string } = {},
): Locator {
  let linha = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: acao, exact: true }),
  })
  if (filtros.registro !== undefined) {
    linha = linha.filter({
      has: page.getByRole('cell', {
        name: String(filtros.registro),
        exact: true,
      }),
    })
  }
  if (filtros.quem) linha = linha.filter({ hasText: filtros.quem })
  return linha
}

/** Entra como o Presidente, anota o total de registros de cada tabela da Auditoria e sai (a "foto" de antes de uma história). */
async function totaisComoPresidente(
  page: Page,
  tabelas: string[],
): Promise<Record<string, number>> {
  await entrar(page, 'presidente')
  const totais: Record<string, number> = {}
  for (const tabela of tabelas)
    totais[tabela] = await abrirAuditoria(page, tabela)
  await sair(page)
  return totais
}

type EsperadoNaAuditoria = { acao: string; registro: number; quem: string }

/** Na Auditoria (já como Presidente): cada ação esperada aparece, com o registro certo e o nome de quem fez. */
async function conferirAuditoria(
  page: Page,
  info: TestInfo,
  tabela: string,
  esperados: EsperadoNaAuditoria[],
  nomeDoPrint: string,
): Promise<number> {
  const total = await abrirAuditoria(page, tabela)
  for (const e of esperados) {
    await expect(
      linhasDaAuditoria(page, e.acao, {
        registro: e.registro,
        quem: e.quem,
      }).first(),
      `a Auditoria de ${tabela} tem de mostrar ${e.acao} do registro ${e.registro}, feito por ${e.quem}`,
    ).toBeVisible()
  }
  await ver(page, info, nomeDoPrint)
  return total
}

// ------------------------------------------------------------------------------------------------ o plano de contas
const cartaoDaConta = (page: Page, codigo: string, descricao: string) =>
  cartoes(page).filter({ hasText: trecho(codigo, descricao) })
const cartaoPelaDescricao = (page: Page, descricao: string) =>
  cartoes(page).filter({ hasText: descricao })
const formularioDeConta = (page: Page) =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: 'Salvar', exact: true }),
  })

/** Cria a conta pelo formulário "Nova conta" (abre se estiver fechado) e devolve o número dela. */
async function criarConta(
  page: Page,
  d: { codigo: string; descricao: string; tipo: string; pai?: string },
): Promise<number> {
  const formulario = formularioDeConta(page)
  if ((await formulario.count()) === 0) {
    await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
  }
  await expect(formulario).toBeVisible()
  await formulario.getByPlaceholder('Código contábil').fill(d.codigo)
  await formulario
    .getByPlaceholder('Descrição', { exact: true })
    .fill(d.descricao)
  await formulario.locator('select').nth(0).selectOption(d.tipo)
  if (d.pai) await escolher(formulario.locator('select').nth(1), d.pai)
  const { status, corpo } = await enviar<{ id_conta: number }>(
    page,
    'POST',
    '/plano-contas/',
    () =>
      formulario.getByRole('button', { name: 'Salvar', exact: true }).click(),
  )
  expect(status, `criar a conta ${d.codigo} foi recusado`).toBe(200)
  await expect(formulario).toHaveCount(0) // o formulário se fecha sozinho
  await expect(cartaoDaConta(page, d.codigo, d.descricao)).toBeVisible()
  return corpo.id_conta
}

// ------------------------------------------------------------------------------------------------ o razão contábil
type PartidaLida = { tipo: string; conta: string; centavos: number }
type LancamentoLido = {
  titulo: string
  estado: string
  linhas: string[]
  partidas: PartidaLida[]
}

/**
 * Lê os lançamentos que o razão mostra (título, situação, partidas), o "Saldo em caixa (contas Ativo)" e o TOTAL de lançamentos que a tela informa. Desde a v5.4h a
 * tela mostra 25 por página (os mais novos primeiro): os lançamentos lidos são os da primeira página, e para contar quantos existem vale o `total`.
 */
async function lerRazao(page: Page): Promise<{
  lancamentos: LancamentoLido[]
  saldoAtivo: number
  total: number
}> {
  await expect(cartoes(page).first()).toBeVisible()
  const bruto = await page.evaluate(() => {
    const limpo = (t: string | null | undefined) =>
      (t ?? '').replace(/\s+/g, ' ').trim()
    const lista = [...document.querySelectorAll('div.rounded-md.border')].map(
      (c) => ({
        titulo: limpo(c.querySelector('p.font-medium')?.textContent),
        estado: limpo(c.querySelector('span')?.textContent),
        linhas: [...c.querySelectorAll(':scope > p')].map((p) =>
          limpo(p.textContent),
        ),
      }),
    )
    const saldo = [...document.querySelectorAll('p')].find((p) =>
      (p.textContent ?? '').includes('Saldo em caixa (contas Ativo):'),
    )
    const contagem = [...document.querySelectorAll('span')]
      .map((s) => /^(\d+) lançamentos?$/.exec(limpo(s.textContent)))
      .find((m) => m !== null)
    return {
      lista,
      saldo: limpo(saldo?.textContent),
      total: contagem ? Number(contagem[1]) : -1,
    }
  })
  expect(bruto.total, 'a tela informa o total de lançamentos').toBeGreaterThan(
    -1,
  )
  const lancamentos = bruto.lista.map((c) => {
    const linhaDasPartidas =
      c.linhas.find((l) => /^(Debito|Credito) /.test(l)) ?? ''
    const partidas = linhaDasPartidas
      .split(' · ')
      .map((parte) =>
        /^(Debito|Credito) (.+) (-?R\$ [\d.]+,\d{2})$/.exec(parte),
      )
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({
        tipo: m[1] ?? '',
        conta: m[2] ?? '',
        centavos: emCentavos(m[3] ?? ''),
      }))
    return { ...c, partidas }
  })
  return {
    lancamentos,
    saldoAtivo: emCentavos(bruto.saldo),
    total: bruto.total,
  }
}

/** Partida dobrada vista pela tela: em TODO lançamento, a soma dos débitos é igual à dos créditos (e maior que zero), ao centavo. */
function exigirPartidasQueFecham(lancamentos: LancamentoLido[]): void {
  expect(lancamentos.length).toBeGreaterThan(0)
  for (const l of lancamentos) {
    const debitos = l.partidas
      .filter((p) => p.tipo === 'Debito')
      .reduce((soma, p) => soma + p.centavos, 0)
    const creditos = l.partidas
      .filter((p) => p.tipo === 'Credito')
      .reduce((soma, p) => soma + p.centavos, 0)
    expect(
      debitos,
      `lançamento "${l.titulo}": débitos ${brl(debitos)} e créditos ${brl(creditos)} têm de fechar`,
    ).toBe(creditos)
    expect(debitos, `lançamento "${l.titulo}" sem valor`).toBeGreaterThan(0)
  }
}

/** Saldo de uma conta pelo razão: débito soma, crédito subtrai (as contas do roteiro têm descrição única). */
function saldoNoRazao(
  lancamentos: LancamentoLido[],
  descricao: string,
): number {
  let saldo = 0
  for (const l of lancamentos) {
    for (const p of l.partidas) {
      if (p.conta === descricao)
        saldo += p.tipo === 'Debito' ? p.centavos : -p.centavos
    }
  }
  return saldo
}

/** O saldo que a tela de Contas Financeiras mostra para a conta (o último valor em reais do cartão). */
async function saldoDaContaFinanceira(
  page: Page,
  codigo: string,
  descricao: string,
): Promise<number> {
  const cartao = cartaoDaConta(page, codigo, descricao)
  await expect(cartao).toBeVisible()
  return emCentavos(await cartao.locator('p.font-medium').last().innerText())
}

const cartaoDoLancamento = (page: Page, parteDoHistorico: string) =>
  cartoes(page).filter({ hasText: parteDoHistorico })

/** Abre a Razão Contábil e a tela de Contas Financeiras e confere, ao centavo, que o saldo de cada conta é o esperado E é a soma do razão. */
async function conferirSaldos(
  page: Page,
  info: TestInfo,
  momento: string,
): Promise<void> {
  await abrirTela(
    page,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  const razao = await lerRazao(page)
  exigirPartidasQueFecham(razao.lancamentos)
  await abrirTela(
    page,
    '/financeiro/contas-financeiras',
    ['/api/contas-financeiras/'],
    'Contas Financeiras',
  )
  const contas = [
    ['A', COD_CAIXA, DESC_CAIXA],
    ['B', COD_BANCO, DESC_BANCO],
    ['C', COD_APLIC, DESC_APLIC],
  ] as const
  for (const [nome, codigo, descricao] of contas) {
    const naTela = await saldoDaContaFinanceira(page, codigo, descricao)
    expect(
      naTela,
      `${momento}: saldo da conta ${nome} na tela (${brl(naTela)}) tem de ser o esperado (${brl(saldos[nome])})`,
    ).toBe(saldos[nome])
    expect(
      naTela,
      `${momento}: saldo da conta ${nome} na tela tem de ser a soma das partidas dela no razão (${brl(saldoNoRazao(razao.lancamentos, descricao))})`,
    ).toBe(saldoNoRazao(razao.lancamentos, descricao))
  }
  await ver(page, info, `contas financeiras: saldos ${momento}`)
}

// ------------------------------------------------------------------------------------------------ títulos (só o que o roteiro precisa para lançar no razão)
async function criarTitulo(
  page: Page,
  d: {
    tipo: 'A Pagar' | 'A Receber'
    conta: string
    descricao: string
    centavos: number
    vencimento: string
  },
): Promise<number> {
  await page.getByRole('button', { name: 'Novo título', exact: true }).click()
  const formulario = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Registrar título' }),
  })
  await expect(formulario).toBeVisible()
  await formulario.locator('select').nth(0).selectOption(d.tipo)
  await escolher(formulario.locator('select').nth(1), d.conta)
  await formulario
    .getByPlaceholder('Descrição', { exact: true })
    .fill(d.descricao)
  await formulario.getByPlaceholder('Valor original').fill(digitado(d.centavos))
  await formulario.locator('input[type="date"]').fill(d.vencimento)
  const { status, corpo } = await enviar<{ id_titulo: number }>(
    page,
    'POST',
    '/titulos/',
    () => formulario.getByRole('button', { name: 'Registrar título' }).click(),
  )
  expect(status, `lançar o título "${d.descricao}" foi recusado`).toBe(200)
  await expect(formulario).toHaveCount(0)
  await expect(cartoes(page).filter({ hasText: d.descricao })).toBeVisible()
  return corpo.id_titulo
}

/** Abre a baixa do título e preenche (contrapartida e centro de custo pelo texto; competência = hoje em Belém). Não envia. */
async function prepararBaixa(
  cartao: Locator,
  d: { centavos: number; contrapartida: string; centro: string; hoje: string },
): Promise<Locator> {
  if ((await cartao.locator('form').count()) === 0) {
    await cartao.getByRole('button', { name: 'Baixar', exact: true }).click()
  }
  const formulario = cartao.locator('form')
  await expect(formulario).toBeVisible()
  await formulario.getByPlaceholder('Valor pago').fill(digitado(d.centavos))
  await formulario.getByPlaceholder('Forma de pagamento').fill('Pix')
  await escolher(formulario.locator('select').nth(0), d.contrapartida)
  await escolher(formulario.locator('select').nth(1), d.centro)
  await formulario.locator('input[type="date"]').fill(d.hoje)
  return formulario
}

// =====================================================================================================================================
// 1. PLANO DE CONTAS (/financeiro/plano-contas)
// =====================================================================================================================================
test('plano de contas: campos vazios e código repetido são recusados; o grupo vira sintético ao ganhar filhas; uma conta de cada tipo; a recusa não deixa rastro e cada criação está na Auditoria', async ({
  page,
}, info) => {
  test.setTimeout(540_000)
  const vigia = vigiar(page)
  const antes = await totaisComoPresidente(page, ['plano_de_contas'])

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/plano-contas',
    ['/api/plano-contas/'],
    'Plano de Contas',
  )
  await expect(cartoes(page).first()).toBeVisible()
  await ver(page, info, 'plano de contas: lista antes de criar')

  const formulario = formularioDeConta(page)
  await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
  await expect(formulario).toBeVisible()
  for (const tipo of [
    'Ativo',
    'Passivo',
    'Patrimônio Líquido',
    'Receita',
    'Despesa',
  ]) {
    await expect(
      formulario.locator('select').nth(0).locator('option', { hasText: tipo }),
    ).toHaveCount(1)
  }

  // recusa 1: tudo vazio; cada falta aparece UMA vez, no próprio campo (nada vai para o resumo "Corrija para continuar")
  await formulario.getByRole('button', { name: 'Salvar', exact: true }).click()
  for (const mensagem of [
    'Informe o código contábil.',
    'Informe a descrição.',
    'Selecione o tipo.',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await expect(page.getByText('Corrija para continuar:')).toHaveCount(0)
  await ver(page, info, 'conta vazia: recusada')

  // o grupo (Ativo) e, depois, as filhas dele
  ids.pai = await criarConta(page, {
    codigo: COD_PAI,
    descricao: DESC_PAI,
    tipo: 'Ativo',
  })
  await expect(
    cartaoDaConta(page, COD_PAI, DESC_PAI).locator('p.text-xs'),
  ).toHaveText('Ativo')
  await expect(
    cartaoDaConta(page, COD_PAI, DESC_PAI).getByText('Sintética'),
  ).toHaveCount(0) // ainda sem filha, é analítica
  await ver(page, info, 'conta grupo criada (ainda analitica)')

  // recusa 2: o mesmo código de novo
  await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
  await formulario.getByPlaceholder('Código contábil').fill(COD_PAI)
  await formulario
    .getByPlaceholder('Descrição', { exact: true })
    .fill(`Conta repetida de teste ${R}`)
  await formulario.locator('select').nth(0).selectOption('Ativo')
  const repetida = await enviar(page, 'POST', '/plano-contas/', () =>
    formulario.getByRole('button', { name: 'Salvar', exact: true }).click(),
  )
  expect(repetida.status).toBe(400)
  const jaExiste = 'Já existe uma conta com esse código contábil.'
  await expect(
    formulario.getByRole('alert').filter({ hasText: jaExiste }),
  ).toBeVisible()
  const copias = await page.getByText(jaExiste).count()
  if (copias !== 1) {
    registrarAchado(
      `Plano de contas: a recusa "${jaExiste}" aparece ${copias} vezes na tela (no formulário e de novo fora dele): PlanoContas.tsx guarda o erro da criação em estado próprio (onError) além do que o FormShell já mostra`,
    )
  }
  await ver(page, info, 'codigo repetido: recusado')
  await formulario.getByRole('button', { name: 'Cancelar' }).click()
  await expect(formulario).toHaveCount(0)
  await expect(
    cartoes(page).filter({ hasText: `Conta repetida de teste ${R}` }),
  ).toHaveCount(0)

  ids.caixa = await criarConta(page, {
    codigo: COD_CAIXA,
    descricao: DESC_CAIXA,
    tipo: 'Ativo',
    pai: trecho(COD_PAI, DESC_PAI),
  })
  ids.banco = await criarConta(page, {
    codigo: COD_BANCO,
    descricao: DESC_BANCO,
    tipo: 'Ativo',
    pai: trecho(COD_PAI, DESC_PAI),
  })
  ids.aplic = await criarConta(page, {
    codigo: COD_APLIC,
    descricao: DESC_APLIC,
    tipo: 'Ativo',
    pai: trecho(COD_PAI, DESC_PAI),
  })
  // o pai passou a ser sintético (não recebe mais lançamento); as filhas dizem de quem são
  await expect(
    cartaoDaConta(page, COD_PAI, DESC_PAI).getByText('Sintética'),
  ).toBeVisible()
  await expect(
    cartaoDaConta(page, COD_CAIXA, DESC_CAIXA).locator('p.text-xs'),
  ).toHaveText(`Ativo · filha de ${COD_PAI}`)
  await ver(page, info, 'grupo sintetico com tres filhas')

  // uma conta de cada tipo que o resto da história usa
  ids.receita = await criarConta(page, {
    codigo: COD_RECEITA,
    descricao: DESC_RECEITA,
    tipo: 'Receita',
  })
  ids.despesa = await criarConta(page, {
    codigo: COD_DESPESA,
    descricao: DESC_DESPESA,
    tipo: 'Despesa',
  })
  ids.contaA = await criarConta(page, {
    codigo: COD_A,
    descricao: DESC_A,
    tipo: 'Passivo',
  })
  ids.contaB = await criarConta(page, {
    codigo: COD_B,
    descricao: DESC_B,
    tipo: 'Passivo',
    pai: trecho(COD_A, DESC_A),
  })
  ids.contaE = await criarConta(page, {
    codigo: COD_E,
    descricao: DESC_E,
    tipo: 'Passivo',
  })
  await expect(
    cartaoDaConta(page, COD_RECEITA, DESC_RECEITA).locator('p.text-xs'),
  ).toHaveText('Receita')
  await expect(
    cartaoDaConta(page, COD_DESPESA, DESC_DESPESA).locator('p.text-xs'),
  ).toHaveText('Despesa')
  await expect(
    cartaoDaConta(page, COD_A, DESC_A).getByText('Sintética'),
  ).toBeVisible()
  await ver(page, info, 'contas de receita, despesa e passivo criadas')
  await sair(page)

  // Auditoria: as 9 criações (e só elas: a recusa do código repetido não deixou rastro)
  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'plano_de_contas',
    [
      ids.pai,
      ids.caixa,
      ids.banco,
      ids.aplic,
      ids.receita,
      ids.despesa,
      ids.contaA,
      ids.contaB,
      ids.contaE,
    ].map((registro) => ({ acao: 'CREATE', registro, quem: TESOUREIRO })),
    'auditoria: as nove contas criadas pelo Tesoureiro',
  )
  expect(
    depois - (antes.plano_de_contas ?? 0),
    'a recusa do código repetido não pode deixar registro: só as 9 criações',
  ).toBe(9)
  expect(vigia.problemas()).toEqual([])
})

test('plano de contas: pai circular, código de conta com filhas, editar, excluir (com filhas é recusado) e a Auditoria', async ({
  page,
}, info) => {
  test.setTimeout(540_000)
  const vigia = vigiar(page)
  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/plano-contas',
    ['/api/plano-contas/'],
    'Plano de Contas',
  )
  const cartaoA = () => cartaoPelaDescricao(page, DESC_A)
  await expect(cartaoA().first()).toBeVisible()
  const formulario = formularioDeConta(page)
  let editou = 0

  /** Editar a conta A: abre o formulário dela; `mudar` mexe nos campos; devolve a resposta do servidor ao salvar. */
  async function editarA(mudar: (f: Locator) => Promise<void>) {
    await cartaoA().first().getByRole('button', { name: 'Editar' }).click()
    await expect(formulario).toBeVisible()
    await mudar(formulario)
    const resposta = await enviar(
      page,
      'PUT',
      /^\/api\/plano-contas\/\d+$/,
      () =>
        formulario.getByRole('button', { name: 'Salvar', exact: true }).click(),
    )
    if (resposta.status === 200) {
      editou += 1
      await expect(formulario).toHaveCount(0)
    }
    return resposta
  }

  // o formulário de edição não oferece a própria conta como pai
  await cartaoA().first().getByRole('button', { name: 'Editar' }).click()
  await expect(formulario).toBeVisible()
  const pais = formulario.locator('select').nth(1)
  await expect(
    pais.locator('option', { hasText: trecho(COD_B, DESC_B) }).first(),
  ).toBeAttached()
  await expect(
    pais.locator('option', { hasText: trecho(COD_A, DESC_A) }),
  ).toHaveCount(0)
  await ver(
    page,
    info,
    'editar conta: a propria conta nao e oferecida como pai',
  )
  await formulario.getByRole('button', { name: 'Cancelar' }).click()
  await expect(formulario).toHaveCount(0)

  // pai circular: A é pai de B; fazer B pai de A fecha um ciclo (o sistema só recusa "pai de si mesma")
  const ciclo = await editarA(async (f) => {
    await escolher(f.locator('select').nth(1), trecho(COD_B, DESC_B))
  })
  if (ciclo.status === 200) {
    registrarAchado(
      'Plano de contas: o servidor ACEITOU um pai circular (A filha de B e B filha de A): financeiro.py::_validar_pai só recusa a conta pai de si mesma',
    )
    await ver(page, info, 'DEFEITO: pai circular aceito')
    // devolve a conta à raiz para o resto da história
    const volta = await editarA(async (f) => {
      await f.locator('select').nth(1).selectOption('')
    })
    expect(volta.status, 'desfazer o pai circular').toBe(200)
  } else {
    await expect(formulario.getByRole('alert').first()).toBeVisible()
    await ver(page, info, 'pai circular: recusado')
    await formulario.getByRole('button', { name: 'Cancelar' }).click()
  }
  await expect(cartaoA().first().locator('p.text-xs')).toHaveText('Passivo')

  // código repetido ao editar
  await cartaoA().first().getByRole('button', { name: 'Editar' }).click()
  await formulario.getByPlaceholder('Código contábil').fill(COD_CAIXA)
  const repetido = await enviar(page, 'PUT', /^\/api\/plano-contas\/\d+$/, () =>
    formulario.getByRole('button', { name: 'Salvar', exact: true }).click(),
  )
  expect(repetido.status).toBe(400)
  await expect(
    formulario
      .getByRole('alert')
      .filter({ hasText: 'Já existe uma conta com esse código contábil.' }),
  ).toBeVisible()
  await ver(page, info, 'editar com codigo repetido: recusado')
  await formulario.getByRole('button', { name: 'Cancelar' }).click()
  await expect(formulario).toHaveCount(0)

  // trocar o código de uma conta que já tem filha: as filhas guardam o código do pai
  const novoCodigo = `${COD_A}-novo`
  const trocou = await editarA(async (f) => {
    await f.getByPlaceholder('Código contábil').fill(novoCodigo)
  })
  if (trocou.status === 200) {
    registrarAchado(
      'Plano de contas: trocar o código de uma conta que já tem filha foi ACEITO: a filha continua apontando para o código antigo (financeiro.py::editar_plano_contas)',
    )
    await ver(page, info, 'DEFEITO: codigo de conta com filha trocado')
    const desfez = await editarA(async (f) => {
      await f.getByPlaceholder('Código contábil').fill(COD_A)
    })
    expect(desfez.status, 'devolver o código antigo').toBe(200)
  } else {
    // o banco recusa (a filha aponta para o código), mas a mensagem tem que dizer o motivo verdadeiro (o código novo é único)
    const mensagem = (await formulario.getByRole('alert').first().innerText())
      .replace(/\s+/g, ' ')
      .trim()
    if (/Já existe uma conta com esse código/.test(mensagem)) {
      registrarAchado(
        `Plano de contas: trocar o código de uma conta que tem filha é recusado com a mensagem errada "${mensagem}" (o código novo é único; quem barra é a chave das filhas): financeiro.py::editar_plano_contas trata todo IntegrityError como código repetido`,
      )
    }
    await ver(page, info, 'trocar o codigo de conta com filha: recusado')
    await formulario.getByRole('button', { name: 'Cancelar' }).click()
    await expect(formulario).toHaveCount(0)
  }

  // editar de verdade: a descrição
  const novaDescricao = `${DESC_A} (editada)`
  const editada = await editarA(async (f) => {
    await f.getByPlaceholder('Descrição', { exact: true }).fill(novaDescricao)
  })
  expect(editada.status).toBe(200)
  await expect(cartaoDaConta(page, COD_A, novaDescricao).first()).toBeVisible()
  await ver(page, info, 'conta editada: descricao nova na lista')

  // excluir: conta com filha é recusada (a mensagem do servidor aparece)
  const comFilhas =
    'Esta conta tem contas filhas - remova ou realoque as filhas antes de excluir.'
  const recusaA = await enviar(
    page,
    'DELETE',
    /^\/api\/plano-contas\/\d+$/,
    () =>
      cartaoPelaDescricao(page, novaDescricao)
        .first()
        .getByRole('button', { name: 'Excluir' })
        .click(),
  )
  expect(recusaA.status).toBe(400)
  await expect(page.getByText(comFilhas)).toBeVisible()
  await expect(cartaoPelaDescricao(page, novaDescricao).first()).toBeVisible()
  await ver(page, info, 'excluir conta com filha: recusado')
  const recusaPai = await enviar(
    page,
    'DELETE',
    /^\/api\/plano-contas\/\d+$/,
    () =>
      cartaoDaConta(page, COD_PAI, DESC_PAI)
        .getByRole('button', { name: 'Excluir' })
        .click(),
  )
  expect(recusaPai.status).toBe(400)
  await expect(cartaoDaConta(page, COD_PAI, DESC_PAI)).toBeVisible()

  // excluir de verdade: a conta sem uso, sem filha e sem movimento
  const excluida = await enviar(
    page,
    'DELETE',
    /^\/api\/plano-contas\/\d+$/,
    () =>
      cartaoDaConta(page, COD_E, DESC_E)
        .getByRole('button', { name: 'Excluir' })
        .click(),
  )
  expect(excluida.status).toBe(200)
  await expect(cartaoDaConta(page, COD_E, DESC_E)).toHaveCount(0)
  await ver(page, info, 'conta sem uso excluida: some da lista')
  await sair(page)

  await entrar(page, 'presidente')
  await abrirAuditoria(page, 'plano_de_contas')
  await expect(
    linhasDaAuditoria(page, 'DELETE', {
      registro: ids.contaE,
      quem: TESOUREIRO,
    }).first(),
  ).toBeVisible()
  await expect(
    linhasDaAuditoria(page, 'UPDATE', {
      registro: ids.contaA,
      quem: TESOUREIRO,
    }).first(),
  ).toBeVisible()
  // cada edição que o servidor aceitou aparece (a recusa de código repetido e as recusas de exclusão não deixam rastro)
  await expect(
    linhasDaAuditoria(page, 'UPDATE', { registro: ids.contaA }),
  ).toHaveCount(editou)
  await expect(
    linhasDaAuditoria(page, 'DELETE', { registro: ids.pai }),
  ).toHaveCount(0)
  await ver(page, info, 'auditoria: edicoes e exclusao do plano de contas')
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 2. CENTROS DE CUSTO (/financeiro/centros-custo)
// =====================================================================================================================================
test('centros de custo: campos vazios e código repetido são recusados; criar com e sem projeto; inativar e ativar; destinação restrita; remanejamento recusado; Auditoria', async ({
  page,
}, info) => {
  test.setTimeout(540_000)
  const vigia = vigiar(page)
  const antes = await totaisComoPresidente(page, [
    'centros_de_custo',
    'remanejamentos_destinacao',
  ])

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/centros-custo',
    ['/api/centros-custo/', '/api/remanejamentos-destinacao/'],
    'Centros de Custo',
  )
  await ver(page, info, 'centros de custo: tela aberta')
  const formulario = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Cadastrar', exact: true }),
  })
  const cartaoDoCentro = (codigo: string, nome: string) =>
    cartoes(page).filter({ hasText: trecho(codigo, nome) })

  await page
    .getByRole('button', { name: 'Novo centro de custo', exact: true })
    .click()
  await expect(formulario).toBeVisible()
  // recusa 1: vazio
  await formulario
    .getByRole('button', { name: 'Cadastrar', exact: true })
    .click()
  for (const mensagem of ['Informe o código.', 'Informe o nome.']) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'centro de custo vazio: recusado')

  const cadastrar = async (codigo: string, nome: string) => {
    await formulario.getByPlaceholder('Código', { exact: true }).fill(codigo)
    await formulario.getByPlaceholder('Nome', { exact: true }).fill(nome)
    return enviar<{ id_centro_custo: number }>(
      page,
      'POST',
      '/api/centros-custo/',
      () =>
        formulario
          .getByRole('button', { name: 'Cadastrar', exact: true })
          .click(),
    )
  }

  const primeiro = await cadastrar(COD_C1, NOME_C1)
  expect(primeiro.status).toBe(200)
  ids.c1 = primeiro.corpo.id_centro_custo
  await expect(formulario).toHaveCount(0)
  await expect(cartaoDoCentro(COD_C1, NOME_C1).locator('p.text-xs')).toHaveText(
    'Ativo',
  )
  await ver(page, info, 'centro de custo criado: ativo')

  // recusa 2: o mesmo código
  await page
    .getByRole('button', { name: 'Novo centro de custo', exact: true })
    .click()
  const repetido = await cadastrar(COD_C1, `Centro repetido ${R}`)
  expect(repetido.status).toBe(400)
  await expect(
    formulario
      .getByRole('alert')
      .filter({ hasText: 'Já existe um centro de custo com esse código.' }),
  ).toBeVisible()
  await ver(page, info, 'centro de custo com codigo repetido: recusado')
  await formulario.getByRole('button', { name: 'Cancelar' }).click()
  await expect(formulario).toHaveCount(0)
  await expect(
    cartoes(page).filter({ hasText: `Centro repetido ${R}` }),
  ).toHaveCount(0)

  // o segundo centro, ligado a um projeto (se o ambiente tem algum)
  await page
    .getByRole('button', { name: 'Novo centro de custo', exact: true })
    .click()
  const projetos = formulario.getByTitle(
    'Vincula este centro de custo a um projeto (opcional)',
  )
  const temProjeto = await projetos
    .locator('option')
    .nth(1)
    .waitFor({ state: 'attached', timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  let projeto = ''
  if (temProjeto) {
    projeto =
      (await projetos.locator('option').nth(1).getAttribute('value')) ?? ''
    await projetos.selectOption(projeto)
  }
  const segundo = await cadastrar(COD_C2, NOME_C2)
  expect(segundo.status).toBe(200)
  ids.c2 = segundo.corpo.id_centro_custo
  await expect(formulario).toHaveCount(0)
  await expect(cartaoDoCentro(COD_C2, NOME_C2).locator('p.text-xs')).toHaveText(
    temProjeto ? `Ativo · Projeto #${projeto}` : 'Ativo',
  )
  await ver(page, info, 'segundo centro de custo, com projeto vinculado')

  // inativar e ativar de novo
  const c2 = () => cartaoDoCentro(COD_C2, NOME_C2)
  const inativou = await enviar(
    page,
    'PUT',
    /^\/api\/centros-custo\/\d+\/ativo$/,
    () => c2().getByRole('button', { name: 'Inativar', exact: true }).click(),
  )
  expect(inativou.status).toBe(200)
  await expect(c2().locator('p.text-xs')).toContainText('Inativo')
  await expect(
    c2().getByRole('button', { name: 'Ativar', exact: true }),
  ).toBeVisible()
  await ver(page, info, 'centro de custo inativado')
  const ativou = await enviar(
    page,
    'PUT',
    /^\/api\/centros-custo\/\d+\/ativo$/,
    () => c2().getByRole('button', { name: 'Ativar', exact: true }).click(),
  )
  expect(ativou.status).toBe(200)
  await expect(c2().locator('p.text-xs')).toContainText('Ativo')
  await expect(c2().locator('p.text-xs')).not.toContainText('Inativo')

  // destinação restrita: liga, mostra o saldo restrito (zero, sem doação), desliga
  const c1 = () => cartaoDoCentro(COD_C1, NOME_C1)
  const ligou = await enviar(
    page,
    'PUT',
    /^\/api\/centros-custo\/\d+\/saldo-restrito$/,
    () =>
      c1()
        .getByRole('button', { name: 'Marcar como destinação restrita' })
        .click(),
  )
  expect(ligou.status).toBe(200)
  await expect(c1().locator('p.text-xs').first()).toContainText(
    'destinação restrita',
  )
  await expect(
    c1().getByText(`Saldo restrito disponível: ${brl(0)}`),
  ).toBeVisible()
  await ver(page, info, 'centro com destinacao restrita: saldo restrito zero')

  // remanejamento: sem saldo restrito na origem, tudo é recusado e nada é gravado
  await page
    .getByRole('button', { name: 'Novo remanejamento', exact: true })
    .click()
  const remanejamento = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Registrar remanejamento' }),
  })
  await expect(remanejamento).toBeVisible()
  await remanejamento
    .getByRole('button', { name: 'Registrar remanejamento' })
    .click()
  for (const mensagem of [
    'Selecione o centro de custo de origem.',
    'Selecione o centro de custo de destino.',
    'Valor deve ser maior que zero.',
    'Informe o motivo do remanejamento.',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'remanejamento vazio: recusado')
  const origem = remanejamento.locator('select').nth(0)
  const destino = remanejamento.locator('select').nth(1)
  await escolher(origem, NOME_C1)
  await escolher(destino, NOME_C1)
  await remanejamento.getByPlaceholder('Valor', { exact: true }).fill('10.00')
  await remanejamento
    .getByPlaceholder(/^Motivo/)
    .fill(`Teste de recusa do robô ${R}`)
  const mesmo = await enviar(
    page,
    'POST',
    '/api/remanejamentos-destinacao/',
    () =>
      remanejamento
        .getByRole('button', { name: 'Registrar remanejamento' })
        .click(),
  )
  expect(mesmo.status).toBe(400)
  await expect(
    remanejamento.getByRole('alert').filter({
      hasText:
        'Origem e destino do remanejamento não podem ser o mesmo centro de custo.',
    }),
  ).toBeVisible()
  await ver(page, info, 'remanejamento para o mesmo centro: recusado')
  await escolher(destino, NOME_C2)
  await remanejamento.getByPlaceholder('Valor', { exact: true }).fill('50.00')
  const semSaldo = await enviar(
    page,
    'POST',
    '/api/remanejamentos-destinacao/',
    () =>
      remanejamento
        .getByRole('button', { name: 'Registrar remanejamento' })
        .click(),
  )
  expect(semSaldo.status).toBe(400)
  await expect(
    remanejamento
      .getByRole('alert')
      .filter({ hasText: /Saldo restrito insuficiente na origem/ }),
  ).toBeVisible()
  await ver(page, info, 'remanejamento acima do saldo restrito: recusado')
  await remanejamento.getByRole('button', { name: 'Cancelar' }).click()
  await expect(remanejamento).toHaveCount(0)

  const desligou = await enviar(
    page,
    'PUT',
    /^\/api\/centros-custo\/\d+\/saldo-restrito$/,
    () =>
      c1().getByRole('button', { name: 'Remover destinação restrita' }).click(),
  )
  expect(desligou.status).toBe(200)
  await expect(c1().locator('p.text-xs').first()).not.toContainText(
    'destinação restrita',
  )
  await sair(page)

  // Auditoria: 2 criações + 4 mudanças (inativar, ativar, ligar e desligar a destinação); as recusas não deixam rastro
  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'centros_de_custo',
    [
      { acao: 'CREATE', registro: ids.c1, quem: TESOUREIRO },
      { acao: 'CREATE', registro: ids.c2, quem: TESOUREIRO },
      { acao: 'UPDATE', registro: ids.c1, quem: TESOUREIRO },
      { acao: 'UPDATE', registro: ids.c2, quem: TESOUREIRO },
    ],
    'auditoria: centros de custo',
  )
  expect(depois - (antes.centros_de_custo ?? 0)).toBe(6)
  const remanejamentos = await abrirAuditoria(page, 'remanejamentos_destinacao')
  expect(
    remanejamentos,
    'os remanejamentos recusados não podem deixar registro',
  ).toBe(antes.remanejamentos_destinacao)
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 3. CONTAS FINANCEIRAS (/financeiro/contas-financeiras)
// =====================================================================================================================================
test('contas financeiras: só conta Ativo e analítica é oferecida; vazio e conta repetida são recusados; três contas criadas com saldo zero; conta financeira não se exclui do plano', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const antes = await totaisComoPresidente(page, ['contas_financeiras'])

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/contas-financeiras',
    ['/api/contas-financeiras/'],
    'Contas Financeiras',
  )
  const formulario = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Cadastrar', exact: true }),
  })
  await page
    .getByRole('button', { name: 'Nova conta financeira', exact: true })
    .click()
  await expect(formulario).toBeVisible()
  for (const tipo of [
    'Caixa',
    'Conta Corrente',
    'Poupança',
    'Conta de Aplicação',
  ]) {
    await expect(
      formulario.locator('select').nth(1).locator('option', { hasText: tipo }),
    ).toHaveCount(1)
  }

  // recusa 1: vazio
  await formulario
    .getByRole('button', { name: 'Cadastrar', exact: true })
    .click()
  for (const mensagem of ['Selecione a conta contábil.', 'Selecione o tipo.']) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'conta financeira vazia: recusada')

  // só Ativo e analítica: o grupo sintético, a receita, a despesa e o passivo não aparecem; as três filhas do grupo, sim
  const contas = formulario.locator('select').nth(0)
  await expect(
    contas.locator('option', { hasText: DESC_CAIXA }).first(),
  ).toBeAttached()
  for (const descricao of [DESC_BANCO, DESC_APLIC]) {
    await expect(contas.locator('option', { hasText: descricao })).toHaveCount(
      1,
    )
  }
  for (const descricao of [DESC_PAI, DESC_RECEITA, DESC_DESPESA, DESC_A]) {
    await expect(
      contas.locator('option', { hasText: descricao }),
      `"${descricao}" não pode ser oferecida como conta financeira`,
    ).toHaveCount(0)
  }

  const cadastrar = async (d: {
    conta: string
    tipo: string
    banco?: string
    agencia?: string
    numero?: string
  }) => {
    await escolher(contas, d.conta)
    await formulario.locator('select').nth(1).selectOption(d.tipo)
    if (d.banco)
      await formulario.getByPlaceholder('Banco (opcional)').fill(d.banco)
    if (d.agencia)
      await formulario.getByPlaceholder('Agência (opcional)').fill(d.agencia)
    if (d.numero)
      await formulario
        .getByPlaceholder('Número da conta (opcional)')
        .fill(d.numero)
    return enviar<{ id_conta_financeira: number }>(
      page,
      'POST',
      '/api/contas-financeiras/',
      () =>
        formulario
          .getByRole('button', { name: 'Cadastrar', exact: true })
          .click(),
    )
  }
  const cartaoDaContaFinanceira = (codigo: string, descricao: string) =>
    cartaoDaConta(page, codigo, descricao)

  const a = await cadastrar({
    conta: trecho(COD_CAIXA, DESC_CAIXA),
    tipo: 'Caixa',
  })
  expect(a.status).toBe(200)
  ids.cfA = a.corpo.id_conta_financeira
  await expect(formulario).toHaveCount(0)
  await expect(
    cartaoDaContaFinanceira(COD_CAIXA, DESC_CAIXA).locator('p.text-xs'),
  ).toHaveText('Caixa')
  await expect(
    cartaoDaContaFinanceira(COD_CAIXA, DESC_CAIXA)
      .locator('p.font-medium')
      .last(),
  ).toHaveText(brl(0))
  await ver(page, info, 'conta financeira A (caixa) criada com saldo zero')

  // recusa 2: a mesma conta contábil de novo
  await page
    .getByRole('button', { name: 'Nova conta financeira', exact: true })
    .click()
  const repetida = await cadastrar({
    conta: trecho(COD_CAIXA, DESC_CAIXA),
    tipo: 'Caixa',
  })
  expect(repetida.status).toBe(400)
  await expect(
    formulario
      .getByRole('alert')
      .filter({ hasText: 'Esta conta contábil já é uma Conta Financeira.' }),
  ).toBeVisible()
  await ver(page, info, 'mesma conta contabil como conta financeira: recusado')
  await formulario.getByRole('button', { name: 'Cancelar' }).click()
  await expect(formulario).toHaveCount(0)

  await page
    .getByRole('button', { name: 'Nova conta financeira', exact: true })
    .click()
  const b = await cadastrar({
    conta: trecho(COD_BANCO, DESC_BANCO),
    tipo: 'Conta Corrente',
    banco: 'Banco de Teste',
    agencia: '0001',
    numero: '12345-6',
  })
  expect(b.status).toBe(200)
  ids.cfB = b.corpo.id_conta_financeira
  await expect(formulario).toHaveCount(0)
  await expect(
    cartaoDaContaFinanceira(COD_BANCO, DESC_BANCO).locator('p.text-xs'),
  ).toHaveText('Conta Corrente · Banco de Teste · Ag. 0001 · Conta 12345-6')

  await page
    .getByRole('button', { name: 'Nova conta financeira', exact: true })
    .click()
  const c = await cadastrar({
    conta: trecho(COD_APLIC, DESC_APLIC),
    tipo: 'Conta de Aplicação',
  })
  expect(c.status).toBe(200)
  ids.cfC = c.corpo.id_conta_financeira
  await expect(formulario).toHaveCount(0)
  await expect(
    cartaoDaContaFinanceira(COD_APLIC, DESC_APLIC).locator('p.text-xs'),
  ).toHaveText('Conta de Aplicação')
  for (const [codigo, descricao] of [
    [COD_CAIXA, DESC_CAIXA],
    [COD_BANCO, DESC_BANCO],
    [COD_APLIC, DESC_APLIC],
  ] as const) {
    await expect(
      cartaoDaContaFinanceira(codigo, descricao)
        .locator('p.font-medium')
        .last(),
    ).toHaveText(brl(0))
  }
  await ver(page, info, 'tres contas financeiras com saldo zero')

  // quem virou conta financeira não sai do plano de contas (enquanto o cadastro de conta financeira existir)
  await abrirTela(
    page,
    '/financeiro/plano-contas',
    ['/api/plano-contas/'],
    'Plano de Contas',
  )
  const recusa = await enviar(
    page,
    'DELETE',
    /^\/api\/plano-contas\/\d+$/,
    () =>
      cartaoDaConta(page, COD_APLIC, DESC_APLIC)
        .getByRole('button', { name: 'Excluir' })
        .click(),
  )
  expect(recusa.status).toBe(400)
  await expect(
    page.getByText(
      'Esta conta é uma Conta Financeira cadastrada - remova o cadastro de Conta Financeira antes.',
    ),
  ).toBeVisible()
  await expect(cartaoDaConta(page, COD_APLIC, DESC_APLIC)).toBeVisible()
  await ver(page, info, 'excluir conta que e conta financeira: recusado')
  await sair(page)

  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'contas_financeiras',
    [ids.cfA, ids.cfB, ids.cfC].map((registro) => ({
      acao: 'CREATE',
      registro,
      quem: TESOUREIRO,
    })),
    'auditoria: as tres contas financeiras',
  )
  expect(
    depois - (antes.contas_financeiras ?? 0),
    'a recusa da conta repetida não pode deixar registro: só as 3 criações',
  ).toBe(3)
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 4. TÍTULO E BAIXA (o jeito de pôr dinheiro numa conta financeira): a conta sintética não recebe lançamento
// =====================================================================================================================================
test('baixa de título: campos vazios e conta sintética como contrapartida são recusados (o título fica como estava); a baixa certa lança em partida dobrada e a Auditoria registra', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const hoje = diaEmBelem(0)
  const antes = await totaisComoPresidente(page, ['lancamentos_contabeis'])

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/titulos?periodo=todos',
    ['/api/titulos/'],
    'Títulos',
  )
  ids.tituloA = await criarTitulo(page, {
    tipo: 'A Receber',
    conta: trecho(COD_RECEITA, DESC_RECEITA),
    descricao: DESC_TA,
    centavos: BAIXA_A,
    vencimento: diaEmBelem(10).iso,
  })
  const titulo = () => cartoes(page).filter({ hasText: DESC_TA })
  await expect(titulo()).toContainText('Pendente')
  await expect(titulo()).toContainText(
    `Original ${brl(BAIXA_A)} · Saldo ${brl(BAIXA_A)}`,
  )
  await ver(page, info, 'titulo a receber lancado: pendente')

  // recusa 1: baixa vazia
  const formulario = await prepararBaixa(titulo(), {
    centavos: BAIXA_A,
    contrapartida: trecho(COD_CAIXA, DESC_CAIXA),
    centro: trecho(COD_C1, NOME_C1),
    hoje: hoje.iso,
  })
  await formulario.getByPlaceholder('Valor pago').fill('')
  await formulario.getByPlaceholder('Forma de pagamento').fill('')
  await formulario.locator('select').nth(0).selectOption('0')
  await formulario.getByRole('button', { name: 'Confirmar baixa' }).click()
  for (const mensagem of [
    'Informe um valor maior que zero.',
    'Informe a forma de pagamento.',
    'Selecione a conta de contrapartida.',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'baixa vazia: recusada')

  // recusa 2: o grupo sintético (Ativo, mas com filhas) como contrapartida
  await formulario.getByPlaceholder('Valor pago').fill(digitado(BAIXA_A))
  await formulario.getByPlaceholder('Forma de pagamento').fill('Pix')
  await escolher(formulario.locator('select').nth(0), trecho(COD_PAI, DESC_PAI))
  const sintetica = await enviar(page, 'POST', '/baixar-titulo/', () =>
    formulario.getByRole('button', { name: 'Confirmar baixa' }).click(),
  )
  expect(sintetica.status).toBe(400)
  await expect(
    formulario.getByRole('alert').filter({
      hasText:
        /é sintética \(tem contas filhas\) e não pode receber lançamento direto/,
    }),
  ).toBeVisible()
  await ver(page, info, 'baixa em conta sintetica: recusada')

  // a recusa não mexeu no título: recarrega e confere
  await abrirTela(
    page,
    '/financeiro/titulos?periodo=todos',
    ['/api/titulos/'],
    'Títulos',
  )
  await expect(titulo()).toContainText('Pendente')
  await expect(titulo()).toContainText(
    `Original ${brl(BAIXA_A)} · Saldo ${brl(BAIXA_A)}`,
  )

  // certo: contrapartida analítica (a Caixa A), centro de custo 1, competência hoje
  const certo = await prepararBaixa(titulo(), {
    centavos: BAIXA_A,
    contrapartida: trecho(COD_CAIXA, DESC_CAIXA),
    centro: trecho(COD_C1, NOME_C1),
    hoje: hoje.iso,
  })
  const baixa = await enviar<{
    id_lancamento: number
    numero_sequencial: number
    saldo_restante: number
  }>(page, 'POST', '/baixar-titulo/', () =>
    certo.getByRole('button', { name: 'Confirmar baixa' }).click(),
  )
  expect(baixa.status, JSON.stringify(baixa.corpo)).toBe(200)
  ids.lancBaixaA = baixa.corpo.id_lancamento
  saldos.A += BAIXA_A
  await expect(certo).toHaveCount(0)
  await expect(titulo()).toContainText('Pago')
  await expect(titulo()).toContainText(`Saldo ${brl(0)}`)
  await expect(titulo().getByRole('button', { name: 'Baixar' })).toHaveCount(0)
  await ver(page, info, 'titulo baixado: pago, saldo zero')
  await sair(page)

  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'lancamentos_contabeis',
    [{ acao: 'BAIXA_TITULO', registro: ids.lancBaixaA, quem: TESOUREIRO }],
    'auditoria: baixa do titulo',
  )
  expect(
    depois - (antes.lancamentos_contabeis ?? 0),
    'as baixas recusadas não podem deixar lançamento: só a baixa certa',
  ).toBe(1)
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 5. RAZÃO CONTÁBIL (/financeiro/razao-contabil): partida dobrada, transferência, valores ao centavo
// =====================================================================================================================================
test('razão: todo lançamento fecha (débitos = créditos); transferência recusada (vazio, valor zero ou negativo, histórico curto, mesma conta); três transferências com os valores ao centavo; o saldo bate com o razão', async ({
  page,
}, info) => {
  test.setTimeout(540_000)
  const vigia = vigiar(page)
  const antes = await totaisComoPresidente(page, ['lancamentos_contabeis'])

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  const inicial = await lerRazao(page)
  exigirPartidasQueFecham(inicial.lancamentos)
  // a baixa do título aparece como lançamento de partida dobrada: débito na Caixa A, crédito na receita, o mesmo valor
  const baixa = cartaoDoLancamento(page, DESC_TA)
  await expect(baixa).toContainText('Normal')
  await expect(baixa).toContainText('BAIXA_TITULO · Pix')
  await expect(baixa).toContainText(`Debito ${DESC_CAIXA} ${brl(BAIXA_A)}`)
  await expect(baixa).toContainText(`Credito ${DESC_RECEITA} ${brl(BAIXA_A)}`)
  await ver(page, info, 'razao: a baixa do titulo em partida dobrada')

  // recusas do formulário de transferência
  await page
    .getByRole('button', { name: 'Nova transferência', exact: true })
    .click()
  const formulario = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Confirmar transferência' }),
  })
  await expect(formulario).toBeVisible()
  const origem = formulario.locator('select').nth(0)
  const destino = formulario.locator('select').nth(1)
  const valor = formulario.getByPlaceholder('Valor', { exact: true })
  const historico = formulario.getByPlaceholder('Histórico', { exact: true })
  const confirmar = formulario.getByRole('button', {
    name: 'Confirmar transferência',
  })

  await confirmar.click()
  for (const mensagem of [
    'Selecione a conta de origem.',
    'Selecione a conta de destino.',
    'Informe um valor maior que zero.',
    'Informe o histórico da transferência.',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'transferencia vazia: recusada')

  await escolher(origem, trecho(COD_CAIXA, DESC_CAIXA))
  await escolher(destino, trecho(COD_BANCO, DESC_BANCO))
  await historico.fill(HISTORICO.t1)
  for (const [digitou, nome] of [
    ['0', 'zero'],
    ['-5', 'negativo'],
  ] as const) {
    await valor.fill(digitou)
    await confirmar.click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Informe um valor maior que zero.' }),
    ).toHaveCount(1)
    await ver(page, info, `transferencia com valor ${nome}: recusada`)
  }
  await valor.fill(digitado(T1))
  await historico.fill('ab')
  await confirmar.click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Informe o histórico da transferência.' }),
  ).toHaveCount(1)
  await ver(page, info, 'transferencia com historico curto: recusada')

  // o servidor recusa a mesma conta nos dois lados
  await historico.fill(`Mesma conta ${R}`)
  await escolher(destino, trecho(COD_CAIXA, DESC_CAIXA))
  const mesma = await enviar(page, 'POST', '/api/transferencias/', () =>
    confirmar.click(),
  )
  expect(mesma.status).toBe(400)
  await expect(
    formulario.getByRole('alert').filter({
      hasText: 'A conta de origem e a de destino não podem ser a mesma.',
    }),
  ).toBeVisible()
  await ver(page, info, 'transferencia para a mesma conta: recusada')
  await expect(
    cartoes(page).filter({ hasText: `Mesma conta ${R}` }),
  ).toHaveCount(0)

  /** Faz uma transferência pela tela (o formulário já aberto) e devolve o que o servidor respondeu. */
  async function transferir(
    deConta: [string, string],
    paraConta: [string, string],
    centavos: number,
    texto: string,
  ) {
    if ((await formulario.count()) === 0) {
      await page
        .getByRole('button', { name: 'Nova transferência', exact: true })
        .click()
    }
    await escolher(origem, trecho(...deConta))
    await escolher(destino, trecho(...paraConta))
    await valor.fill(digitado(centavos))
    await historico.fill(texto)
    const resposta = await enviar<{
      id_lancamento: number
      numero_sequencial: number
    }>(page, 'POST', '/api/transferencias/', () => confirmar.click())
    expect(resposta.status, `transferir ${brl(centavos)} (${texto})`).toBe(200)
    await expect(formulario).toHaveCount(0)
    return resposta.corpo
  }
  const caixaA: [string, string] = [COD_CAIXA, DESC_CAIXA]
  const bancoB: [string, string] = [COD_BANCO, DESC_BANCO]
  const aplicacaoC: [string, string] = [COD_APLIC, DESC_APLIC]

  // transferência 1: A -> B, R$ 300,00
  const um = await transferir(caixaA, bancoB, T1, HISTORICO.t1)
  ids.t1 = um.id_lancamento
  ids.seqT1 = um.numero_sequencial
  saldos.A -= T1
  saldos.B += T1
  const cartaoT1 = cartaoDoLancamento(page, HISTORICO.t1)
  await expect(cartaoT1).toBeVisible()
  await expect(cartaoT1).toContainText(`#${ids.seqT1} — ${HISTORICO.t1}`)
  await expect(cartaoT1).toContainText('Normal')
  await expect(cartaoT1).toContainText('TRANSFERENCIA')
  await expect(cartaoT1).toContainText(`Debito ${DESC_BANCO} ${brl(T1)}`)
  await expect(cartaoT1).toContainText(`Credito ${DESC_CAIXA} ${brl(T1)}`)
  const dia = diaEmBelem(0).br
  if (!(await cartaoT1.innerText()).includes(dia)) {
    registrarAchado(
      `Razão: o lançamento feito agora aparece com outra data (esperado ${dia}, no relógio de Belém): a data do cartão vem de data_lancamento.date() em UTC (financeiro.py::_serializar_lancamento)`,
    )
  }
  await ver(page, info, 'transferencia 1 (A para B, R$ 300,00) no razao')

  // transferência 2: A -> B, R$ 1.500,00, MAIS do que a conta A tem (R$ 934,56): o sistema não confere saldo
  const dois = await transferir(caixaA, bancoB, T2, HISTORICO.t2)
  ids.t2 = dois.id_lancamento
  ids.seqT2 = dois.numero_sequencial
  saldos.A -= T2
  saldos.B += T2
  await expect(cartaoDoLancamento(page, HISTORICO.t2)).toContainText(
    `Debito ${DESC_BANCO} ${brl(T2)}`,
  )
  registrarObservacao(
    `Razão: a transferência de ${brl(T2)} saiu de uma conta com ${brl(saldos.A + T2)} e foi ACEITA (a conta ficou com ${brl(saldos.A)}): o servidor não confere saldo suficiente (financeiro.py::criar_transferencia). Decisão de produto: conta de caixa/banco negativa.`,
  )
  await ver(
    page,
    info,
    'transferencia 2 acima do saldo: aceita (saldo negativo)',
  )

  // transferência 3: A -> C, R$ 200,00
  const tres = await transferir(caixaA, aplicacaoC, T3, HISTORICO.t3)
  ids.t3 = tres.id_lancamento
  saldos.A -= T3
  saldos.C += T3
  await expect(cartaoDoLancamento(page, HISTORICO.t3)).toContainText(
    `Credito ${DESC_CAIXA} ${brl(T3)}`,
  )

  // transferência entre contas Ativo não muda o "Saldo em caixa (contas Ativo)" (só troca de lugar)
  const final = await lerRazao(page)
  exigirPartidasQueFecham(final.lancamentos)
  expect(
    final.saldoAtivo,
    'três transferências entre contas Ativo não podem mudar o saldo total em caixa',
  ).toBe(inicial.saldoAtivo)
  expect(final.total).toBe(inicial.total + 3)
  await ver(
    page,
    info,
    'razao: tres transferencias, saldo total em caixa igual',
  )

  await conferirSaldos(page, info, 'depois das tres transferencias')
  await sair(page)

  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'lancamentos_contabeis',
    [ids.t1, ids.t2, ids.t3].map((registro) => ({
      acao: 'TRANSFERENCIA',
      registro,
      quem: TESOUREIRO,
    })),
    'auditoria: as tres transferencias',
  )
  expect(
    depois - (antes.lancamentos_contabeis ?? 0),
    'as transferências recusadas não podem deixar lançamento: só as 3 certas',
  ).toBe(3)
  expect(vigia.problemas()).toEqual([])
})

test('razão: lançamento nunca some, só se estorna (motivo curto é recusado; estornar de novo é recusado); o estorno é outro lançamento com as partidas invertidas e os saldos voltam', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const antes = await totaisComoPresidente(page, ['lancamentos_contabeis'])
  const motivo = `Teste do robô ${R}: transferência feita só para provar o estorno`

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  const inicial = await lerRazao(page)
  const original = () => cartaoDoLancamento(page, HISTORICO.t2)
  await expect(original()).toContainText('Normal')
  await expect(
    original().getByRole('button', { name: 'Estornar', exact: true }),
  ).toBeVisible()

  // outra aba (do mesmo usuário) abre o estorno e fica parada: depois dela confirmar, o lançamento já estará estornado
  const outra = await page.context().newPage()
  const vigiaOutra = vigiar(outra)
  await abrirTela(
    outra,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  await cartaoDoLancamento(outra, HISTORICO.t2)
    .getByRole('button', { name: 'Estornar', exact: true })
    .click()
  await expect(
    cartaoDoLancamento(outra, HISTORICO.t2).getByPlaceholder(
      'Motivo do estorno',
    ),
  ).toBeVisible()

  await original()
    .getByRole('button', { name: 'Estornar', exact: true })
    .click()
  const formulario = original().locator('form')
  await expect(formulario).toBeVisible()
  await expect(
    original().getByRole('button', { name: 'Cancelar estorno' }),
  ).toBeVisible()
  // recusa 1 e 2: sem motivo e com motivo curto (mínimo 5 letras)
  const aviso = 'Informe o motivo (mínimo 5 caracteres).'
  await formulario.getByRole('button', { name: 'Confirmar estorno' }).click()
  await expect(
    formulario.getByRole('alert').filter({ hasText: aviso }),
  ).toHaveCount(1)
  await ver(page, info, 'estorno sem motivo: recusado')
  await formulario.getByPlaceholder('Motivo do estorno').fill('abc')
  await formulario.getByRole('button', { name: 'Confirmar estorno' }).click()
  await expect(
    formulario.getByRole('alert').filter({ hasText: aviso }),
  ).toHaveCount(1)
  await expect(original()).toContainText('Normal')

  // certo
  await formulario.getByPlaceholder('Motivo do estorno').fill(motivo)
  const estorno = await enviar<{
    id_lancamento_estorno: number
    numero_sequencial: number
  }>(page, 'POST', `/api/lancamentos/${ids.t2}/estornar`, () =>
    formulario.getByRole('button', { name: 'Confirmar estorno' }).click(),
  )
  expect(estorno.status, JSON.stringify(estorno.corpo)).toBe(200)
  const idEstorno = estorno.corpo.id_lancamento_estorno
  const seqEstorno = estorno.corpo.numero_sequencial
  saldos.A += T2
  saldos.B -= T2
  await expect(formulario).toHaveCount(0)

  // o original continua na lista (nunca some), marcado "Estornado", com o motivo e o número do lançamento de estorno; já não oferece estornar
  await expect(original()).toHaveCount(1)
  await expect(original()).toContainText('Estornado')
  await expect(original()).toContainText(
    `Motivo do estorno: ${motivo} (lançamento #${idEstorno})`,
  )
  await expect(
    original().getByRole('button', { name: /Estornar/ }),
  ).toHaveCount(0)
  // o estorno é OUTRO lançamento, com as partidas invertidas e o mesmo valor
  const cartaoDoEstorno = cartoes(page).filter({
    hasText: `Estorno do lançamento #${ids.seqT2}: ${motivo}`,
  })
  await expect(cartaoDoEstorno).toHaveCount(1)
  await expect(cartaoDoEstorno).toContainText(`#${seqEstorno} — `)
  await expect(cartaoDoEstorno).toContainText('ESTORNO')
  await expect(cartaoDoEstorno).toContainText(`Debito ${DESC_CAIXA} ${brl(T2)}`)
  await expect(cartaoDoEstorno).toContainText(
    `Credito ${DESC_BANCO} ${brl(T2)}`,
  )
  await ver(page, info, 'estorno: original marcado e lancamento de estorno')

  const depoisDoEstorno = await lerRazao(page)
  exigirPartidasQueFecham(depoisDoEstorno.lancamentos)
  expect(
    depoisDoEstorno.total,
    'estornar acrescenta um lançamento; nenhum some',
  ).toBe(inicial.total + 1)
  expect(depoisDoEstorno.saldoAtivo).toBe(inicial.saldoAtivo)

  // recusa 3: estornar o que já foi estornado (a aba parada ainda mostra o botão)
  await outra
    .getByPlaceholder('Motivo do estorno')
    .fill(`Segundo estorno do robô ${R}, não pode valer`)
  const segundo = await enviar(
    outra,
    'POST',
    `/api/lancamentos/${ids.t2}/estornar`,
    () =>
      cartaoDoLancamento(outra, HISTORICO.t2)
        .getByRole('button', { name: 'Confirmar estorno' })
        .click(),
  )
  expect(segundo.status).toBe(400)
  await expect(
    cartaoDoLancamento(outra, HISTORICO.t2)
      .getByRole('alert')
      .filter({ hasText: 'Este lançamento já foi estornado.' }),
  ).toBeVisible()
  await ver(outra, info, 'estornar de novo o mesmo lancamento: recusado')
  expect(vigiaOutra.problemas()).toEqual([])
  await outra.close()

  await conferirSaldos(page, info, 'depois do estorno')
  await sair(page)

  // Auditoria: UM estorno (o segundo, recusado, não deixou rastro) e o total só cresceu em 1
  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'lancamentos_contabeis',
    [{ acao: 'ESTORNO', registro: ids.t2, quem: TESOUREIRO }],
    'auditoria: o estorno',
  )
  await expect(
    linhasDaAuditoria(page, 'ESTORNO', { registro: ids.t2 }),
  ).toHaveCount(1)
  expect(depois - (antes.lancamentos_contabeis ?? 0)).toBe(1)
  expect(vigia.problemas()).toEqual([])
})

test('plano de contas com movimento: excluir é recusado e trocar o tipo não pode virar o razão do avesso', async ({
  page,
}, info) => {
  test.setTimeout(420_000)
  const vigia = vigiar(page)
  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/plano-contas',
    ['/api/plano-contas/'],
    'Plano de Contas',
  )
  const movimento =
    'Esta conta já tem movimento no razão contábil e não pode ser excluída.'
  for (const [codigo, descricao] of [
    [COD_CAIXA, DESC_CAIXA],
    [COD_RECEITA, DESC_RECEITA],
  ] as const) {
    const recusa = await enviar(
      page,
      'DELETE',
      /^\/api\/plano-contas\/\d+$/,
      () =>
        cartaoDaConta(page, codigo, descricao)
          .getByRole('button', { name: 'Excluir' })
          .click(),
    )
    expect(recusa.status).toBe(400)
    await expect(page.getByText(movimento)).toBeVisible()
    await expect(cartaoDaConta(page, codigo, descricao)).toBeVisible()
    await ver(
      page,
      info,
      `excluir ${descricao}: recusado, a conta tem movimento`,
    )
  }

  // trocar o tipo de uma conta que já tem movimento muda a natureza de tudo que já foi lançado: tem que ser recusado
  const formulario = formularioDeConta(page)
  const receita = () => cartaoDaConta(page, COD_RECEITA, DESC_RECEITA)
  await receita().getByRole('button', { name: 'Editar' }).click()
  await expect(formulario).toBeVisible()
  await formulario.locator('select').nth(0).selectOption('Despesa')
  let trocouTipo = false
  try {
    const troca = await enviar(page, 'PUT', /^\/api\/plano-contas\/\d+$/, () =>
      formulario.getByRole('button', { name: 'Salvar', exact: true }).click(),
    )
    trocouTipo = troca.status === 200
    if (trocouTipo) {
      registrarAchado(
        'Plano de contas: o servidor ACEITOU trocar o tipo de uma conta que já tem movimento (Receita para Despesa): a natureza devedora/credora de tudo que já foi lançado muda de lado (financeiro.py::editar_plano_contas não olha o razão)',
      )
      await ver(page, info, 'DEFEITO: tipo de conta com movimento trocado')
    } else {
      await expect(formulario.getByRole('alert').first()).toBeVisible()
      await ver(page, info, 'trocar o tipo de conta com movimento: recusado')
    }
  } finally {
    // devolve a conta ao tipo certo, aconteça o que acontecer (as contas do orçamento dependem disso)
    if (trocouTipo) {
      await receita().getByRole('button', { name: 'Editar' }).click()
      await formulario.locator('select').nth(0).selectOption('Receita')
      const volta = await enviar(
        page,
        'PUT',
        /^\/api\/plano-contas\/\d+$/,
        () =>
          formulario
            .getByRole('button', { name: 'Salvar', exact: true })
            .click(),
      )
      expect(volta.status, 'devolver o tipo Receita').toBe(200)
    }
  }
  if (!trocouTipo) {
    await formulario.getByRole('button', { name: 'Cancelar' }).click()
  }
  await expect(receita().locator('p.text-xs')).toHaveText('Receita')
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 6. ORÇAMENTO E FLUXO DE CAIXA (/financeiro/orcamento)
// =====================================================================================================================================
const secaoDoOrcamento = (page: Page) =>
  page.locator('section').filter({
    has: page.getByRole('heading', {
      name: `Orçamento ${diaEmBelem(0).ano}`,
      exact: true,
    }),
  })
const secaoDoFluxo = (page: Page) =>
  page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Fluxo de caixa projetado',
      exact: true,
    }),
  })
const secaoDaReserva = (page: Page) =>
  page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Reserva de contingência',
      exact: true,
    }),
  })
const LEITURAS_DO_ORCAMENTO = [
  '/api/orcamentos/',
  '/api/fluxo-de-caixa/',
  '/api/reservas-contingencia/',
  '/api/plano-contas/',
  '/api/centros-custo/',
  '/api/contas-financeiras/',
]
const abrirOrcamento = (page: Page) =>
  abrirTela(
    page,
    '/financeiro/orcamento',
    LEITURAS_DO_ORCAMENTO,
    'Orçamento e Fluxo de Caixa',
  )

/** Cria uma linha de orçamento pelo formulário (abre se estiver fechado); a deliberação é a primeira concluída. */
async function criarOrcamento(
  page: Page,
  d: { conta: string; centro?: string; centavos: number },
): Promise<{ status: number; id: number; corpo: Record<string, unknown> }> {
  const secao = secaoDoOrcamento(page)
  const formulario = secao.locator('form')
  if ((await formulario.count()) === 0) {
    await secao
      .getByRole('button', { name: 'Novo orçamento', exact: true })
      .click()
  }
  await expect(formulario).toBeVisible()
  await escolher(formulario.locator('select').nth(0), d.conta)
  await formulario
    .locator('select')
    .nth(1)
    .selectOption(d.centro ? { label: d.centro } : '')
  await formulario
    .getByPlaceholder('Valor previsto (R$)')
    .fill(digitado(d.centavos))
  await formulario.locator('select').nth(2).selectOption({ index: 1 })
  const resposta = await enviar<{ id_orcamento: number }>(
    page,
    'POST',
    '/api/orcamentos/',
    () =>
      formulario.getByRole('button', { name: 'Cadastrar orçamento' }).click(),
  )
  return {
    status: resposta.status,
    id: resposta.corpo.id_orcamento ?? 0,
    corpo: resposta.corpo,
  }
}

const linhaDoOrcamento = (page: Page, conta: string, centro: string) =>
  secaoDoOrcamento(page)
    .locator('div.rounded-md.border')
    .filter({ hasText: `${conta} · ${centro}` })

test('orçamento: a tela recusa campos vazios, ano e valor inválidos; só conta analítica e centro de custo são oferecidos', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  const vigia = vigiar(page)
  await entrarNoFinanceiro(page)
  await abrirOrcamento(page)
  const secao = secaoDoOrcamento(page)
  await expect(
    secao.getByRole('heading', { name: `Orçamento ${diaEmBelem(0).ano}` }),
  ).toBeVisible()
  await ver(page, info, 'orcamento e fluxo de caixa: tela aberta')

  const carregando = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      casaCaminho('/api/deliberacoes/concluidas', r.url()),
  )
  await secao
    .getByRole('button', { name: 'Novo orçamento', exact: true })
    .click()
  const concluidas = (await (await carregando).json()) as unknown[]
  temDeliberacao = concluidas.length > 0
  if (!temDeliberacao) {
    registrarObservacao(
      'Não há deliberação concluída no ambiente de teste: as linhas de orçamento e a reserva não podem ser criadas. Rode antes o roteiro v5.4d (a ata deixa uma deliberação concluída).',
    )
  }
  const formulario = secao.locator('form')
  await expect(formulario).toBeVisible()
  await expect(formulario.getByPlaceholder('Ano', { exact: true })).toHaveValue(
    String(diaEmBelem(0).ano),
  )

  // as contas oferecidas: analíticas (o grupo sintético não); os centros de custo criados aparecem
  const contas = formulario.locator('select').nth(0)
  await expect(
    contas.locator('option', { hasText: DESC_CAIXA }).first(),
  ).toBeAttached()
  await expect(contas.locator('option', { hasText: DESC_RECEITA })).toHaveCount(
    1,
  )
  await expect(contas.locator('option', { hasText: DESC_PAI })).toHaveCount(0)
  await expect(
    formulario.locator('select').nth(1).locator('option', { hasText: NOME_C1 }),
  ).toHaveCount(1)
  await expect(
    formulario.locator('select').nth(1).locator('option', { hasText: NOME_C2 }),
  ).toHaveCount(1)

  // recusa 1: tudo vazio (o ano já vem preenchido)
  await formulario.getByRole('button', { name: 'Cadastrar orçamento' }).click()
  for (const mensagem of [
    'Selecione a conta contábil.',
    'Valor previsto deve ser maior que zero.',
    'Selecione a deliberação que aprovou este orçamento.',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'orcamento vazio: recusado')

  // recusa 2: ano fora de 2000 a 2200 (antes e depois) e valor negativo
  await escolher(contas, trecho(COD_RECEITA, DESC_RECEITA))
  await formulario.getByPlaceholder('Valor previsto (R$)').fill('-5')
  for (const ano of ['1999', '2201']) {
    await formulario.getByPlaceholder('Ano', { exact: true }).fill(ano)
    await formulario
      .getByRole('button', { name: 'Cadastrar orçamento' })
      .click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Ano inválido.' }),
    ).toHaveCount(1)
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Valor previsto deve ser maior que zero.' }),
    ).toHaveCount(1)
    await ver(page, info, `orcamento com ano ${ano} e valor negativo: recusado`)
  }
  await formulario.getByRole('button', { name: 'Cancelar' }).click()
  await expect(formulario).toHaveCount(0)
  expect(vigia.problemas()).toEqual([])
})

test('orçamento: linhas por conta e centro de custo; o realizado é o que foi lançado, ao centavo; "Estourado"; linha repetida é recusada; a Auditoria registra', async ({
  page,
}, info) => {
  test.skip(
    temDeliberacao !== true,
    'não há deliberação concluída no ambiente de teste (o roteiro v5.4d da ata cria uma): sem ela o orçamento não pode ser criado',
  )
  test.setTimeout(540_000)
  const vigia = vigiar(page)
  const antes = await totaisComoPresidente(page, ['orcamentos'])
  let criadas = 0

  await entrarNoFinanceiro(page)
  await abrirOrcamento(page)
  const secao = secaoDoOrcamento(page)

  // achado provável: "Sem centro de custo específico" manda o centro 0 ao servidor (o campo vazio vira 0 pelo `z.coerce.number()`)
  const semCentro = await criarOrcamento(page, {
    conta: trecho(COD_DESPESA, DESC_DESPESA),
    centavos: 80_000,
  })
  if (semCentro.status === 200) {
    criadas += 1
    registrarObservacao(
      `Orçamento sem centro de custo aceito (linha #${semCentro.id}): o campo "Sem centro de custo específico" funciona.`,
    )
    await expect(
      secao.locator('div.rounded-md.border').filter({ hasText: DESC_DESPESA }),
    ).toBeVisible()
  } else {
    registrarAchado(
      `Orçamento: criar linha SEM centro de custo é recusado (HTTP ${semCentro.status}, ${JSON.stringify(semCentro.corpo)}): o campo "Sem centro de custo específico" manda id_centro_custo = 0 (Orcamento.tsx, select sem setValueAs; schemas.ts usa z.coerce.number().optional()) e o servidor responde "Centro de custo não encontrado."`,
    )
    await expect(secao.locator('form').getByRole('alert').first()).toBeVisible()
    await ver(page, info, 'orcamento sem centro de custo: recusado (achado)')
  }

  // linha 1: receita no centro 1, previsto R$ 10.000,00. O realizado já é o da baixa de R$ 1.234,56 (centro 1)
  const r1 = await criarOrcamento(page, {
    conta: trecho(COD_RECEITA, DESC_RECEITA),
    centro: NOME_C1,
    centavos: PREVISTO_R1,
  })
  expect(r1.status, JSON.stringify(r1.corpo)).toBe(200)
  ids.r1 = r1.id
  criadas += 1
  await expect(secao.locator('form')).toHaveCount(0)
  const linha1 = linhaDoOrcamento(page, DESC_RECEITA, NOME_C1)
  await expect(linha1).toHaveCount(1)
  await expect(linha1).toContainText(
    `${brl(BAIXA_A)} de ${brl(PREVISTO_R1)} previstos (12%)`,
  )
  // conta de RECEITA: 12% do previsto é "Abaixo do previsto" (meta ainda não batida), nunca "Dentro do previsto"/"Estourado", que são palavras de despesa
  await expect(linha1).toContainText('Abaixo do previsto')
  await ver(
    page,
    info,
    'orcamento 1: receita, realizado = baixa de R$ 1.234,56',
  )

  // recusa: a mesma conta e o mesmo centro no mesmo ano (nunca duas linhas para o mesmo lugar)
  const repetida = await criarOrcamento(page, {
    conta: trecho(COD_RECEITA, DESC_RECEITA),
    centro: NOME_C1,
    centavos: 1_000,
  })
  expect(repetida.status).toBe(400)
  await expect(
    secao
      .locator('form')
      .getByRole('alert')
      .filter({
        hasText:
          /Já existe orçamento para esta conta\/centro de custo neste ano/,
      }),
  ).toBeVisible()
  await ver(page, info, 'orcamento repetido: recusado')
  await secao.locator('form').getByRole('button', { name: 'Cancelar' }).click()
  await expect(secao.locator('form')).toHaveCount(0)
  await expect(linhaDoOrcamento(page, DESC_RECEITA, NOME_C1)).toHaveCount(1)

  // linha 2: a Caixa A (Ativo) no centro 1, previsto R$ 1.000,00, abaixo do realizado: "Estourado"
  const r2 = await criarOrcamento(page, {
    conta: trecho(COD_CAIXA, DESC_CAIXA),
    centro: NOME_C1,
    centavos: PREVISTO_R2,
  })
  expect(r2.status, JSON.stringify(r2.corpo)).toBe(200)
  ids.r2 = r2.id
  criadas += 1
  const linha2 = linhaDoOrcamento(page, DESC_CAIXA, NOME_C1)
  await expect(linha2).toContainText(
    `${brl(BAIXA_A)} de ${brl(PREVISTO_R2)} previstos (123%)`,
  )
  await expect(linha2).toContainText('Estourado')

  // linha 3: receita no centro 2, previsto R$ 500,00, ainda sem movimento
  const r3 = await criarOrcamento(page, {
    conta: trecho(COD_RECEITA, DESC_RECEITA),
    centro: NOME_C2,
    centavos: PREVISTO_R3,
  })
  expect(r3.status, JSON.stringify(r3.corpo)).toBe(200)
  ids.r3 = r3.id
  criadas += 1
  await expect(linhaDoOrcamento(page, DESC_RECEITA, NOME_C2)).toContainText(
    `${brl(0)} de ${brl(PREVISTO_R3)} previstos (0%)`,
  )
  await expect(linhaDoOrcamento(page, DESC_RECEITA, NOME_C2)).toContainText(
    'Abaixo do previsto',
  )
  await ver(
    page,
    info,
    'orcamento: tres linhas (dentro do previsto, estourado, zero)',
  )

  // as transferências não têm centro de custo: não entram no realizado de linha nenhuma (o realizado de A no centro 1 continua só a baixa)
  await expect(linha2).toContainText(`${brl(BAIXA_A)} de`)

  // linha 4: a conta passivo B (sem movimento) no centro 2: usada adiante para provar a exclusão de conta com orçamento
  const rb = await criarOrcamento(page, {
    conta: trecho(COD_B, DESC_B),
    centro: NOME_C2,
    centavos: PREVISTO_RB,
  })
  expect(rb.status, JSON.stringify(rb.corpo)).toBe(200)
  ids.rB = rb.id
  criadas += 1
  await expect(linhaDoOrcamento(page, DESC_B, NOME_C2)).toContainText(
    `${brl(0)} de ${brl(PREVISTO_RB)} previstos (0%)`,
  )

  // excluir uma conta que tem orçamento (e nenhum movimento): o servidor não olha o orçamento
  await abrirTela(
    page,
    '/financeiro/plano-contas',
    ['/api/plano-contas/'],
    'Plano de Contas',
  )
  const exclusao = await enviar(
    page,
    'DELETE',
    /^\/api\/plano-contas\/\d+$/,
    () =>
      cartaoDaConta(page, COD_B, DESC_B)
        .getByRole('button', { name: 'Excluir' })
        .click(),
  )
  if (exclusao.status >= 500) {
    registrarAchado(
      `Plano de contas: excluir uma conta que tem linha de orçamento dá erro do servidor (HTTP ${exclusao.status}) em vez de uma recusa com motivo: financeiro.py::excluir_plano_contas confere filhas, movimento, título e conta financeira, mas não orçamento nem reserva`,
    )
  } else if (exclusao.status === 200) {
    registrarAchado(
      'Plano de contas: uma conta que tem linha de orçamento foi EXCLUÍDA (o orçamento ficou sem conta)',
    )
  } else {
    registrarObservacao(
      `Excluir uma conta que tem linha de orçamento foi recusado pelo servidor (HTTP ${exclusao.status}).`,
    )
  }
  await ver(page, info, 'excluir conta com orcamento')
  await sair(page)

  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'orcamentos',
    [ids.r1, ids.r2, ids.r3, ids.rB].map((registro) => ({
      acao: 'CREATE',
      registro,
      quem: TESOUREIRO,
    })),
    'auditoria: as linhas de orcamento',
  )
  expect(
    depois - (antes.orcamentos ?? 0),
    'a linha repetida (recusada) não pode deixar registro',
  ).toBe(criadas)
  // exclusão com 5xx é achado, não problema do roteiro: o `vigia` só se queixa do que não foi isso
  expect(
    vigia.problemas().filter((p) => !/DELETE .*\/api\/plano-contas\//.test(p)),
  ).toEqual([])
})

test('orçamento: o realizado acompanha a baixa e o estorno (receita no centro 2), o título volta a pendente e o saldo da conta financeira bate com o razão', async ({
  page,
}, info) => {
  test.skip(
    ids.r3 === 0,
    'a linha 3 do orçamento não foi criada (falta deliberação concluída)',
  )
  test.setTimeout(540_000)
  const vigia = vigiar(page)
  const hoje = diaEmBelem(0)
  const motivo = `Teste do robô ${R}: baixa estornada para provar o orçamento`
  const antes = await totaisComoPresidente(page, ['lancamentos_contabeis'])

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/titulos?periodo=todos',
    ['/api/titulos/'],
    'Títulos',
  )
  ids.tituloB = await criarTitulo(page, {
    tipo: 'A Receber',
    conta: trecho(COD_RECEITA, DESC_RECEITA),
    descricao: DESC_TB,
    centavos: BAIXA_B,
    vencimento: diaEmBelem(10).iso,
  })
  const titulo = () => cartoes(page).filter({ hasText: DESC_TB })
  const formulario = await prepararBaixa(titulo(), {
    centavos: BAIXA_B,
    contrapartida: trecho(COD_CAIXA, DESC_CAIXA),
    centro: trecho(COD_C2, NOME_C2),
    hoje: hoje.iso,
  })
  const baixa = await enviar<{ id_lancamento: number }>(
    page,
    'POST',
    '/baixar-titulo/',
    () => formulario.getByRole('button', { name: 'Confirmar baixa' }).click(),
  )
  expect(baixa.status, JSON.stringify(baixa.corpo)).toBe(200)
  ids.lancBaixaB = baixa.corpo.id_lancamento
  saldos.A += BAIXA_B
  await expect(titulo()).toContainText('Pago')

  // orçamento: R$ 50,05 de R$ 500,00 (10%)
  await abrirOrcamento(page)
  const linha3 = () => linhaDoOrcamento(page, DESC_RECEITA, NOME_C2)
  await expect(linha3()).toContainText(
    `${brl(BAIXA_B)} de ${brl(PREVISTO_R3)} previstos (10%)`,
  )
  // a linha do centro 1 não mexeu
  await expect(linhaDoOrcamento(page, DESC_RECEITA, NOME_C1)).toContainText(
    `${brl(BAIXA_A)} de ${brl(PREVISTO_R1)} previstos (12%)`,
  )
  await ver(page, info, 'orcamento 3: realizado R$ 50,05 depois da baixa')
  await conferirSaldos(page, info, 'depois da segunda baixa')

  // estorna a baixa pela Razão
  await abrirTela(
    page,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  const cartaoDaBaixa = cartaoDoLancamento(page, DESC_TB)
  await expect(cartaoDaBaixa).toContainText(
    `Debito ${DESC_CAIXA} ${brl(BAIXA_B)}`,
  )
  await cartaoDaBaixa
    .getByRole('button', { name: 'Estornar', exact: true })
    .click()
  await cartaoDaBaixa.getByPlaceholder('Motivo do estorno').fill(motivo)
  const estorno = await enviar(
    page,
    'POST',
    `/api/lancamentos/${ids.lancBaixaB}/estornar`,
    () =>
      cartaoDaBaixa.getByRole('button', { name: 'Confirmar estorno' }).click(),
  )
  expect(estorno.status).toBe(200)
  saldos.A -= BAIXA_B
  await expect(cartaoDaBaixa).toContainText('Estornado')
  await ver(page, info, 'baixa do titulo B estornada')

  // o orçamento volta a zero; o título volta a pendente, com o saldo inteiro
  await abrirOrcamento(page)
  await expect(linha3()).toContainText(
    `${brl(0)} de ${brl(PREVISTO_R3)} previstos (0%)`,
  )
  await ver(page, info, 'orcamento 3: realizado volta a zero depois do estorno')
  await abrirTela(
    page,
    '/financeiro/titulos?periodo=todos',
    ['/api/titulos/'],
    'Títulos',
  )
  await expect(titulo()).toContainText('Pendente')
  await expect(titulo()).toContainText(
    `Original ${brl(BAIXA_B)} · Saldo ${brl(BAIXA_B)}`,
  )
  await expect(titulo().getByRole('button', { name: 'Baixar' })).toBeVisible()
  await ver(page, info, 'titulo B: o estorno da baixa o reabriu')
  await conferirSaldos(page, info, 'depois do estorno da segunda baixa')
  await sair(page)

  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'lancamentos_contabeis',
    [
      { acao: 'BAIXA_TITULO', registro: ids.lancBaixaB, quem: TESOUREIRO },
      { acao: 'ESTORNO', registro: ids.lancBaixaB, quem: TESOUREIRO },
    ],
    'auditoria: baixa e estorno do titulo B',
  )
  expect(depois - (antes.lancamentos_contabeis ?? 0)).toBe(2)
  expect(vigia.problemas()).toEqual([])
})

test('fluxo de caixa projetado: saldo inicial = soma das contas financeiras; cada mês fecha (inicial + entradas - saídas); um título a pagar e um a receber mexem no mês do vencimento exatamente pelo valor deles', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const vencimento = diaEmBelem(2)
  const mes = vencimento.iso.slice(0, 7)

  type Mes = {
    competencia: string
    inicial: number
    entradas: number
    saidas: number
    final: number
  }
  async function lerFluxo(): Promise<Mes[]> {
    const lista = secaoDoFluxo(page).locator('div.rounded-md.border')
    await expect(lista.first()).toBeVisible()
    const brutos = await lista.evaluateAll((elementos) =>
      elementos.map((el) =>
        [...el.querySelectorAll('p')].map((p) =>
          (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
      ),
    )
    return brutos.map(([competencia = '', resumo = '', final = '']) => {
      const m =
        /Saldo inicial: (-?R\$ [\d.]+,\d{2}) · Entradas: (-?R\$ [\d.]+,\d{2}) · Saídas: (-?R\$ [\d.]+,\d{2})/.exec(
          resumo,
        )
      if (!m) throw new Error(`resumo do mês inesperado: "${resumo}"`)
      return {
        competencia,
        inicial: emCentavos(m[1] ?? ''),
        entradas: emCentavos(m[2] ?? ''),
        saidas: emCentavos(m[3] ?? ''),
        final: emCentavos(final),
      }
    })
  }
  function exigirMesesQueFecham(meses: Mes[]): void {
    expect(meses.length).toBeGreaterThan(0)
    meses.forEach((m, i) => {
      expect(
        m.final,
        `${m.competencia}: saldo projetado ${brl(m.final)} = inicial ${brl(m.inicial)} + entradas ${brl(m.entradas)} - saídas ${brl(m.saidas)}`,
      ).toBe(m.inicial + m.entradas - m.saidas)
      const anterior = meses[i - 1]
      if (anterior) {
        expect(
          m.inicial,
          `${m.competencia}: o saldo inicial é o saldo projetado do mês anterior`,
        ).toBe(anterior.final)
      }
    })
  }

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/contas-financeiras',
    ['/api/contas-financeiras/'],
    'Contas Financeiras',
  )
  const somaDasContas = (
    await cartoes(page).locator('p.font-medium').allInnerTexts()
  )
    .filter((t) => /R\$\s?[\d.]+,\d{2}$/.test(t.replace(/\s/g, ' ').trim()))
    .map(emCentavos)
    .reduce((soma, v) => soma + v, 0)

  await abrirOrcamento(page)
  const antes = await lerFluxo()
  exigirMesesQueFecham(antes)
  expect(
    antes[0]?.inicial,
    'o saldo inicial do primeiro mês é a soma dos saldos das contas financeiras',
  ).toBe(somaDasContas)
  await ver(page, info, 'fluxo de caixa projetado: antes dos titulos')
  expect(
    antes.some((m) => m.competencia === mes),
    `o mês ${mes} (vencimento dos títulos de teste) tem de estar no horizonte do fluxo`,
  ).toBe(true)

  // um título a pagar e um a receber, pendentes, vencendo daqui a 2 dias
  await abrirTela(
    page,
    '/financeiro/titulos?periodo=todos',
    ['/api/titulos/'],
    'Títulos',
  )
  await criarTitulo(page, {
    tipo: 'A Pagar',
    conta: trecho(COD_DESPESA, DESC_DESPESA),
    descricao: DESC_TP,
    centavos: TITULO_PAGAR,
    vencimento: vencimento.iso,
  })
  await criarTitulo(page, {
    tipo: 'A Receber',
    conta: trecho(COD_RECEITA, DESC_RECEITA),
    descricao: DESC_TR,
    centavos: TITULO_RECEBER,
    vencimento: vencimento.iso,
  })
  await ver(page, info, 'titulos pendentes lancados (a pagar e a receber)')

  await abrirOrcamento(page)
  const depois = await lerFluxo()
  exigirMesesQueFecham(depois)
  const mesAntes = antes.find((m) => m.competencia === mes)
  const mesDepois = depois.find((m) => m.competencia === mes)
  expect(mesAntes && mesDepois).toBeTruthy()
  expect(
    (mesDepois?.entradas ?? 0) - (mesAntes?.entradas ?? 0),
    `as entradas de ${mes} sobem exatamente ${brl(TITULO_RECEBER)}`,
  ).toBe(TITULO_RECEBER)
  expect(
    (mesDepois?.saidas ?? 0) - (mesAntes?.saidas ?? 0),
    `as saídas de ${mes} sobem exatamente ${brl(TITULO_PAGAR)}`,
  ).toBe(TITULO_PAGAR)
  expect(
    (mesDepois?.final ?? 0) - (mesAntes?.final ?? 0),
    `o saldo projetado de ${mes} muda exatamente ${brl(TITULO_RECEBER - TITULO_PAGAR)}`,
  ).toBe(TITULO_RECEBER - TITULO_PAGAR)
  expect(
    depois[0]?.inicial,
    'os títulos pendentes não mexem no saldo de hoje (só a projeção)',
  ).toBe(somaDasContas)
  await ver(
    page,
    info,
    'fluxo de caixa projetado: o mes do vencimento mudou so pelo valor dos titulos',
  )
  expect(vigia.problemas()).toEqual([])
})

test('reserva de contingência: regra curta e conta repetida são recusadas; o saldo atual e o mínimo vêm do razão ao centavo; o aviso "abaixo do mínimo" some quando o saldo chega', async ({
  page,
}, info) => {
  test.skip(
    temDeliberacao !== true,
    'não há deliberação concluída no ambiente de teste: a reserva não pode ser criada',
  )
  test.setTimeout(540_000)
  const vigia = vigiar(page)
  const antes = await totaisComoPresidente(page, ['reservas_contingencia'])
  const regra = `Só pode ser usada com aprovação da diretoria (teste ${R})`

  await entrarNoFinanceiro(page)
  await abrirOrcamento(page)
  const secao = secaoDaReserva(page)
  await secao.getByRole('button', { name: 'Nova reserva', exact: true }).click()
  const formulario = secao.locator('form')
  await expect(formulario).toBeVisible()
  const conta = formulario.locator('select').nth(0)
  const minimo = formulario.getByPlaceholder('Valor mínimo a manter (opcional)')
  const textoDaRegra = formulario.getByPlaceholder(/^Regra de uso/)
  const cadastrar = formulario.getByRole('button', {
    name: 'Cadastrar reserva',
  })

  // recusa 1: vazio; recusa 2: regra curta
  await cadastrar.click()
  for (const mensagem of [
    'Selecione a conta financeira.',
    'Descreva a regra de uso da reserva (mínimo 10 caracteres).',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'reserva vazia: recusada')
  await escolher(conta, trecho(COD_APLIC, DESC_APLIC))
  await textoDaRegra.fill('curta')
  await cadastrar.click()
  await expect(
    page.getByRole('alert').filter({
      hasText: 'Descreva a regra de uso da reserva (mínimo 10 caracteres).',
    }),
  ).toHaveCount(1)

  // achado provável: "Sem deliberação vinculada" manda a deliberação 0 ao servidor (campo vazio vira 0 pelo `z.coerce.number()`)
  await textoDaRegra.fill(regra)
  await minimo.fill(digitado(MINIMO_RESERVA))
  const semDeliberacao = await enviar<{ id_reserva: number }>(
    page,
    'POST',
    '/api/reservas-contingencia/',
    () => cadastrar.click(),
  )
  if (semDeliberacao.status === 200) {
    ids.reserva = semDeliberacao.corpo.id_reserva
    registrarObservacao(
      'Reserva sem deliberação aceita: o campo "Sem deliberação vinculada" funciona.',
    )
  } else {
    registrarAchado(
      `Reserva de contingência: criar SEM deliberação vinculada é recusado (HTTP ${semDeliberacao.status}, ${JSON.stringify(semDeliberacao.corpo)}): o campo "Sem deliberação vinculada" manda id_deliberacao = 0 (Orcamento.tsx, select sem setValueAs; schemas.ts usa z.coerce.number().optional()); o valor mínimo em branco também vira 0`,
    )
    await ver(page, info, 'reserva sem deliberacao: recusada (achado)')
    await formulario.locator('select').nth(1).selectOption({ index: 1 })
    const certa = await enviar<{ id_reserva: number }>(
      page,
      'POST',
      '/api/reservas-contingencia/',
      () => cadastrar.click(),
    )
    expect(certa.status, JSON.stringify(certa.corpo)).toBe(200)
    ids.reserva = certa.corpo.id_reserva
  }
  await expect(formulario).toHaveCount(0)
  const cartaoDaReserva = () =>
    secao
      .locator('div.rounded-md.border')
      .filter({ hasText: trecho(COD_APLIC, DESC_APLIC) })
  // o saldo atual é o da conta financeira C (R$ 200,00 das transferências); está abaixo do mínimo de R$ 500,00
  await expect(cartaoDaReserva()).toContainText(brl(saldos.C))
  await expect(cartaoDaReserva()).toContainText(
    `Mínimo definido: ${brl(MINIMO_RESERVA)} — saldo abaixo do mínimo`,
  )
  await expect(cartaoDaReserva()).toContainText(regra)
  await ver(page, info, 'reserva criada: saldo abaixo do minimo')

  // recusa 3: a mesma conta financeira outra vez
  await secao.getByRole('button', { name: 'Nova reserva', exact: true }).click()
  await escolher(conta, trecho(COD_APLIC, DESC_APLIC))
  await textoDaRegra.fill(`${regra} - repetida`)
  await formulario.locator('select').nth(1).selectOption({ index: 1 })
  const repetida = await enviar(
    page,
    'POST',
    '/api/reservas-contingencia/',
    () => cadastrar.click(),
  )
  expect(repetida.status).toBe(400)
  await expect(
    formulario.getByRole('alert').filter({
      hasText: 'Esta conta financeira já é uma reserva de contingência.',
    }),
  ).toBeVisible()
  await ver(page, info, 'reserva repetida: recusada')
  await formulario.getByRole('button', { name: 'Cancelar' }).click()
  await expect(formulario).toHaveCount(0)

  // reforça a reserva por transferência (A -> C, R$ 400,00): o saldo chega a R$ 600,00 e o aviso some
  await abrirTela(
    page,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  await page
    .getByRole('button', { name: 'Nova transferência', exact: true })
    .click()
  const transferencia = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Confirmar transferência' }),
  })
  await escolher(
    transferencia.locator('select').nth(0),
    trecho(COD_CAIXA, DESC_CAIXA),
  )
  await escolher(
    transferencia.locator('select').nth(1),
    trecho(COD_APLIC, DESC_APLIC),
  )
  await transferencia
    .getByPlaceholder('Valor', { exact: true })
    .fill(digitado(T4))
  await transferencia
    .getByPlaceholder('Histórico', { exact: true })
    .fill(HISTORICO.t4)
  const reforco = await enviar(page, 'POST', '/api/transferencias/', () =>
    transferencia
      .getByRole('button', { name: 'Confirmar transferência' })
      .click(),
  )
  expect(reforco.status).toBe(200)
  saldos.A -= T4
  saldos.C += T4
  await abrirOrcamento(page)
  await expect(cartaoDaReserva()).toContainText(brl(saldos.C))
  await expect(cartaoDaReserva()).toContainText(
    `Mínimo definido: ${brl(MINIMO_RESERVA)}`,
  )
  await expect(cartaoDaReserva()).not.toContainText('saldo abaixo do mínimo')
  await ver(page, info, 'reserva reforcada: saldo acima do minimo')
  await conferirSaldos(page, info, 'depois do reforco da reserva')
  await sair(page)

  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'reservas_contingencia',
    [{ acao: 'CREATE', registro: ids.reserva, quem: TESOUREIRO }],
    'auditoria: a reserva de contingencia',
  )
  expect(
    depois - (antes.reservas_contingencia ?? 0),
    'as recusas não podem deixar registro: só a reserva criada',
  ).toBe(1)
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 7. EXERCÍCIO (/financeiro/exercicios): o último bloco que mexe em estado, porque FECHA o exercício aberto
// =====================================================================================================================================
type ExercicioLido = { ano: number; status: string }

/** Lê os exercícios da lista: "Exercício 2026 (Aberto)". */
async function lerExercicios(page: Page): Promise<ExercicioLido[]> {
  const lista = cartoes(page).filter({ hasText: /Exercício \d{4} \(/ })
  await expect(lista.first()).toBeVisible()
  const textos = await lista.locator('p.font-medium').allInnerTexts()
  return textos
    .map((t) =>
      /Exercício (\d{4}) \((Aberto|Fechado)\)/.exec(t.replace(/\s+/g, ' ')),
    )
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ ano: Number(m[1]), status: m[2] ?? '' }))
}

const cartaoDoExercicio = (page: Page, ano: number) =>
  cartoes(page).filter({ hasText: new RegExp(`Exercício ${ano} \\(`) })
const formularioDeExercicio = (page: Page) =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: 'Abrir', exact: true }),
  })

/** Abre o exercício do ano pelo formulário (abre se estiver fechado) e devolve a resposta do servidor. */
async function abrirExercicio(page: Page, ano: string) {
  const formulario = formularioDeExercicio(page)
  if ((await formulario.count()) === 0) {
    await page
      .getByRole('button', { name: 'Abrir exercício', exact: true })
      .click()
  }
  await expect(formulario).toBeVisible()
  await formulario.locator('input[type="number"]').fill(ano)
  return enviar<{ id_exercicio: number }>(
    page,
    'POST',
    '/api/exercicios/',
    () =>
      formulario.getByRole('button', { name: 'Abrir', exact: true }).click(),
  )
}

/** Garante que existe um exercício aberto (abre o do próximo ano se não houver): o que o roteiro não pode deixar para trás. */
test.afterAll(async ({ browser }) => {
  test.setTimeout(240_000)
  exigirHomologacao()
  const contexto = await browser.newContext(NAVEGADOR)
  try {
    const page = await contexto.newPage()
    await entrar(page, 'presidente')
    await abrirTela(
      page,
      '/financeiro/exercicios',
      ['/api/exercicios/'],
      'Exercícios contábeis',
    )
    const exercicios = await lerExercicios(page)
    if (!exercicios.some((e) => e.status === 'Aberto')) {
      const proximo = Math.max(...exercicios.map((e) => e.ano)) + 1
      const aberto = await abrirExercicio(page, String(proximo))
      test.info().annotations.push({
        type: 'restauro',
        description: `nenhum exercício estava aberto: abri o de ${proximo} (HTTP ${aberto.status})`,
      })
    }
  } finally {
    await contexto.close()
  }
})

test('exercício: ano inválido e segundo exercício aberto são recusados; fechar bloqueia lançamento (transferência e estorno); fechar de novo e reabrir o mesmo ano são recusados; o do ano seguinte reinicia a numeração', async ({
  page,
}, info) => {
  // FECHAR o exercício aberto da homologação não tem volta (o do mesmo ano não reabre) e deixa tudo que tem a data de hoje sem exercício: fica para o
  // FIM da bateria, com a opção `fechar_exercicio` do fluxo ligada e a homologação recriada depois.
  test.skip(
    process.env.HML_FECHAR_EXERCICIO !== 'sim',
    'fecha o exercício aberto da homologação: só roda com a opção fechar_exercicio do fluxo, no fim da bateria',
  )
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  const hoje = diaEmBelem(0)
  const antes = await totaisComoPresidente(page, ['exercicios_contabeis'])
  let recuperou = 0

  await entrarNoFinanceiro(page)
  await abrirTela(
    page,
    '/financeiro/exercicios',
    ['/api/exercicios/'],
    'Exercícios contábeis',
  )
  let exercicios = await lerExercicios(page)
  await ver(page, info, 'exercicios: lista antes de mexer')
  if (!exercicios.some((e) => e.status === 'Aberto')) {
    // o ambiente de teste ficou sem exercício aberto (uma rodada anterior caiu no meio): abre o do ano seguinte para poder começar
    const proximo = Math.max(...exercicios.map((e) => e.ano)) + 1
    const recuperado = await abrirExercicio(page, String(proximo))
    expect(recuperado.status).toBe(200)
    recuperou = 1
    registrarObservacao(
      `O ambiente estava sem exercício aberto; abri o de ${proximo} para começar.`,
    )
    exercicios = await lerExercicios(page)
  }
  const aberto = exercicios.find((e) => e.status === 'Aberto')
  if (!aberto) throw new Error('não há exercício aberto')
  const anoAberto = aberto.ano
  const anoSeguinte = Math.max(...exercicios.map((e) => e.ano)) + 1

  // recusas da tela: ano vazio, antes de 2000 e depois de 2200
  const formulario = formularioDeExercicio(page)
  await page
    .getByRole('button', { name: 'Abrir exercício', exact: true })
    .click()
  await expect(formulario).toBeVisible()
  const ano = formulario.locator('input[type="number"]')
  for (const digitou of ['', '1999', '2201']) {
    await ano.fill(digitou)
    await formulario.getByRole('button', { name: 'Abrir', exact: true }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Ano inválido.' }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'exercicio com ano invalido: recusado')

  // recusa do servidor: já existe um exercício aberto (para o ano seguinte e para o próprio ano)
  const jaAberto =
    'Já existe um exercício aberto. Feche-o antes de abrir outro.'
  for (const tentativa of [String(anoSeguinte), String(anoAberto)]) {
    const recusa = await abrirExercicio(page, tentativa)
    expect(recusa.status).toBe(400)
    await expect(
      formulario.getByRole('alert').filter({ hasText: jaAberto }),
    ).toBeVisible()
  }
  const copias = await page.getByText(jaAberto).count()
  if (copias !== 1) {
    registrarAchado(
      `Exercícios: a recusa "${jaAberto}" aparece ${copias} vezes na tela (no formulário e de novo abaixo dele): Exercicios.tsx guarda o erro da abertura em estado próprio (onError) além do que o FormShell já mostra`,
    )
  }
  await ver(page, info, 'segundo exercicio aberto: recusado')
  await page
    .getByRole('button', { name: 'Cancelar', exact: true })
    .first()
    .click()
  await expect(formulario).toHaveCount(0)
  expect(
    (await lerExercicios(page)).length,
    'as recusas não criam exercício',
  ).toBe(exercicios.length)

  // outra aba, com a lista parada (ainda com "Fechar"): depois de fechar aqui, ela leva a recusa
  const outra = await page.context().newPage()
  const vigiaOutra = vigiar(outra)
  await abrirTela(
    outra,
    '/financeiro/exercicios',
    ['/api/exercicios/'],
    'Exercícios contábeis',
  )
  await expect(
    cartaoDoExercicio(outra, anoAberto).getByRole('button', {
      name: 'Fechar',
      exact: true,
    }),
  ).toBeVisible()

  // fechar o exercício aberto
  const fechou = await enviar(
    page,
    'POST',
    /^\/api\/exercicios\/\d+\/fechar$/,
    () =>
      cartaoDoExercicio(page, anoAberto)
        .getByRole('button', { name: 'Fechar', exact: true })
        .click(),
  )
  expect(fechou.status).toBe(200)
  const idFechado = Number(
    /\/exercicios\/(\d+)\/fechar$/.exec(fechou.caminho)?.[1],
  )
  await expect(cartaoDoExercicio(page, anoAberto)).toContainText('(Fechado)')
  await expect(
    cartaoDoExercicio(page, anoAberto).getByRole('button', { name: 'Fechar' }),
  ).toHaveCount(0)
  if (
    !(await cartaoDoExercicio(page, anoAberto).innerText()).includes(
      `Fechado em ${hoje.br}`,
    )
  ) {
    registrarAchado(
      `Exercícios: o fechamento de agora não aparece como "Fechado em ${hoje.br}" (relógio de Belém)`,
    )
  }
  await ver(page, info, 'exercicio fechado: sem botao de fechar')

  // recusa: fechar de novo (a aba parada)
  await outra
    .getByRole('button', { name: 'Fechar', exact: true })
    .first()
    .click()
  await expect(outra.getByText('Este exercício já está fechado.')).toBeVisible()
  await ver(outra, info, 'fechar um exercicio ja fechado: recusado')
  expect(vigiaOutra.problemas()).toEqual([])
  await outra.close()

  // sem exercício aberto, nenhum lançamento novo: a transferência e o estorno são recusados
  const semExercicio =
    'Nenhum exercício contábil aberto. Abra um exercício antes de lançar.'
  await abrirTela(
    page,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  const razaoAntes = await lerRazao(page)
  await page
    .getByRole('button', { name: 'Nova transferência', exact: true })
    .click()
  const transferencia = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Confirmar transferência' }),
  })
  await escolher(
    transferencia.locator('select').nth(0),
    trecho(COD_CAIXA, DESC_CAIXA),
  )
  await escolher(
    transferencia.locator('select').nth(1),
    trecho(COD_BANCO, DESC_BANCO),
  )
  await transferencia.getByPlaceholder('Valor', { exact: true }).fill('1.00')
  await transferencia
    .getByPlaceholder('Histórico', { exact: true })
    .fill(HISTORICO.fechado)
  const barrada = await enviar(page, 'POST', '/api/transferencias/', () =>
    transferencia
      .getByRole('button', { name: 'Confirmar transferência' })
      .click(),
  )
  expect(barrada.status).toBe(400)
  await expect(
    transferencia.getByRole('alert').filter({ hasText: semExercicio }),
  ).toBeVisible()
  await ver(page, info, 'transferencia em exercicio fechado: recusada')
  await transferencia.getByRole('button', { name: 'Cancelar' }).click()
  await expect(transferencia).toHaveCount(0)

  const cartaoT1 = cartaoDoLancamento(page, HISTORICO.t1)
  await cartaoT1.getByRole('button', { name: 'Estornar', exact: true }).click()
  await cartaoT1
    .getByPlaceholder('Motivo do estorno')
    .fill(`Estorno em exercício fechado ${R}`)
  const estornoBarrado = await enviar(
    page,
    'POST',
    `/api/lancamentos/${ids.t1}/estornar`,
    () => cartaoT1.getByRole('button', { name: 'Confirmar estorno' }).click(),
  )
  expect(estornoBarrado.status).toBe(400)
  await expect(
    cartaoT1.getByRole('alert').filter({ hasText: semExercicio }),
  ).toBeVisible()
  await expect(cartaoT1).toContainText('Normal')
  await ver(page, info, 'estorno em exercicio fechado: recusado')
  await abrirTela(
    page,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  expect(
    (await lerRazao(page)).total,
    'as recusas em exercício fechado não criam lançamento',
  ).toBe(razaoAntes.total)

  // reabrir o mesmo ano é recusado (só um exercício por ano); o do ano seguinte abre
  await abrirTela(
    page,
    '/financeiro/exercicios',
    ['/api/exercicios/'],
    'Exercícios contábeis',
  )
  const mesmoAno = await abrirExercicio(page, String(anoAberto))
  expect(mesmoAno.status).toBe(400)
  await expect(
    formularioDeExercicio(page)
      .getByRole('alert')
      .filter({ hasText: 'Já existe um exercício cadastrado para este ano.' }),
  ).toBeVisible()
  await ver(page, info, 'reabrir o mesmo ano: recusado')
  const novo = await abrirExercicio(page, String(anoSeguinte))
  expect(novo.status, JSON.stringify(novo.corpo)).toBe(200)
  const idNovo = novo.corpo.id_exercicio
  await expect(formularioDeExercicio(page)).toHaveCount(0)
  await expect(cartaoDoExercicio(page, anoSeguinte)).toContainText('(Aberto)')
  await expect(cartaoDoExercicio(page, anoSeguinte)).toContainText(
    `Aberto em ${hoje.br}`,
  )
  await expect(cartaoDoExercicio(page, anoAberto)).toContainText('(Fechado)')
  await ver(page, info, 'exercicio do ano seguinte aberto, o anterior fechado')

  // com o exercício novo aberto, o razão volta a aceitar lançamento, e a numeração recomeça em #1
  await abrirTela(
    page,
    '/financeiro/razao-contabil',
    ['/api/livro-caixa/'],
    'Razão Contábil',
  )
  await page
    .getByRole('button', { name: 'Nova transferência', exact: true })
    .click()
  await escolher(
    transferencia.locator('select').nth(0),
    trecho(COD_CAIXA, DESC_CAIXA),
  )
  await escolher(
    transferencia.locator('select').nth(1),
    trecho(COD_BANCO, DESC_BANCO),
  )
  await transferencia
    .getByPlaceholder('Valor', { exact: true })
    .fill(digitado(T5))
  await transferencia
    .getByPlaceholder('Histórico', { exact: true })
    .fill(HISTORICO.t5)
  const aceita = await enviar<{ id_lancamento: number }>(
    page,
    'POST',
    '/api/transferencias/',
    () =>
      transferencia
        .getByRole('button', { name: 'Confirmar transferência' })
        .click(),
  )
  expect(aceita.status, JSON.stringify(aceita.corpo)).toBe(200)
  saldos.A -= T5
  saldos.B += T5
  await expect(cartaoDoLancamento(page, HISTORICO.t5)).toContainText(
    `#1 — ${HISTORICO.t5}`,
  )
  await ver(
    page,
    info,
    'transferencia no exercicio novo: numeracao recomeca em 1',
  )
  await conferirSaldos(page, info, 'no exercicio novo')
  await sair(page)

  // Auditoria: um fechamento e uma abertura (as recusas não deixaram rastro)
  await entrar(page, 'presidente')
  const depois = await conferirAuditoria(
    page,
    info,
    'exercicios_contabeis',
    [
      { acao: 'FECHAMENTO', registro: idFechado, quem: TESOUREIRO },
      { acao: 'ABERTURA', registro: idNovo, quem: TESOUREIRO },
    ],
    'auditoria: fechamento e abertura de exercicio',
  )
  await expect(
    linhasDaAuditoria(page, 'FECHAMENTO', { registro: idFechado }),
  ).toHaveCount(1)
  expect(
    depois - (antes.exercicios_contabeis ?? 0),
    'só o fechamento e a abertura deixam registro (e a recuperação, se foi preciso)',
  ).toBe(2 + recuperou)
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 8. QUEM PODE: o Secretário (sem `financeiro`) é barrado; o Tesoureiro chega a cada tela pelo Início e pelo menu do módulo
// =====================================================================================================================================
const TELAS_DO_FINANCEIRO: { rota: string; menu: string; titulo: string }[] = [
  {
    rota: '/financeiro/exercicios',
    menu: 'Exercícios',
    titulo: 'Exercícios contábeis',
  },
  {
    rota: '/financeiro/plano-contas',
    menu: 'Plano de Contas',
    titulo: 'Plano de Contas',
  },
  {
    rota: '/financeiro/centros-custo',
    menu: 'Centros de Custo',
    titulo: 'Centros de Custo',
  },
  {
    rota: '/financeiro/contas-financeiras',
    menu: 'Contas Financeiras',
    titulo: 'Contas Financeiras',
  },
  {
    rota: '/financeiro/razao-contabil',
    menu: 'Razão Contábil',
    titulo: 'Razão Contábil',
  },
  {
    rota: '/financeiro/orcamento',
    menu: 'Orçamento e Fluxo de Caixa',
    titulo: 'Orçamento e Fluxo de Caixa',
  },
]

test('quem pode: o Secretário (sem a permissão do financeiro) é barrado em todas as telas do módulo, e o Tesoureiro chega a cada uma pelo Início e pelo menu', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  const vigia = vigiar(page)

  await entrar(page, 'secretario')
  await expect(page.getByText(/Bem-vindo, Daniel Ribeiro Costa/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Financeiro' })).toHaveCount(0)
  for (const [indice, tela] of TELAS_DO_FINANCEIRO.entries()) {
    await page.goto(tela.rota)
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
      `o Secretário não pode abrir ${tela.rota}`,
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: tela.titulo, level: 1 }),
    ).toHaveCount(0)
    if (indice === 0) {
      await expect(
        page.getByText(/permissão necessária: financeiro/),
      ).toBeVisible()
      await ver(page, info, 'Secretario barrado no financeiro')
    }
  }
  await sair(page)

  await entrarNoFinanceiro(page)
  await page.getByRole('link', { name: 'Financeiro' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Financeiro', level: 1 }),
  ).toBeVisible()
  for (const tela of TELAS_DO_FINANCEIRO) {
    await page
      .getByRole('link', { name: tela.menu, exact: true })
      .first()
      .click()
    await expect(page).toHaveURL(new RegExp(`${tela.rota}$`))
    await expect(
      page.getByRole('heading', { name: tela.titulo, level: 1 }),
    ).toBeVisible()
  }
  await ver(page, info, 'Tesoureiro chegou a cada tela pelo menu do modulo')
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 9. VARREDURA: cada formulário abre, tem nome acessível em todos os campos e "Cancelar" fecha sem efeito
// =====================================================================================================================================
test('os formulários do módulo abrem, todos os campos têm nome acessível e "Cancelar" fecha sem efeito (o que faltar vai para os achados)', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  await entrarNoFinanceiro(page)

  const varrer = async (nome: string) => {
    try {
      await inventariar(page, info, nome)
    } catch (erro) {
      registrarAchado(
        `Acessibilidade em "${nome}": ${(erro as Error).message.replace(/\s+/g, ' ').slice(0, 420)}`,
      )
    }
  }
  const telas: {
    rota: string
    leituras: string[]
    titulo: string
    abrir: string
    nome: string
  }[] = [
    {
      rota: '/financeiro/exercicios',
      leituras: ['/api/exercicios/'],
      titulo: 'Exercícios contábeis',
      abrir: 'Abrir exercício',
      nome: 'exercicios-abrir',
    },
    {
      rota: '/financeiro/plano-contas',
      leituras: ['/api/plano-contas/'],
      titulo: 'Plano de Contas',
      abrir: 'Nova conta',
      nome: 'plano-de-contas-nova',
    },
    {
      rota: '/financeiro/centros-custo',
      leituras: ['/api/centros-custo/'],
      titulo: 'Centros de Custo',
      abrir: 'Novo centro de custo',
      nome: 'centros-de-custo-novo',
    },
    {
      rota: '/financeiro/centros-custo',
      leituras: ['/api/centros-custo/'],
      titulo: 'Centros de Custo',
      abrir: 'Novo remanejamento',
      nome: 'centros-de-custo-remanejamento',
    },
    {
      rota: '/financeiro/contas-financeiras',
      leituras: ['/api/contas-financeiras/'],
      titulo: 'Contas Financeiras',
      abrir: 'Nova conta financeira',
      nome: 'contas-financeiras-nova',
    },
    {
      rota: '/financeiro/razao-contabil',
      leituras: ['/api/livro-caixa/'],
      titulo: 'Razão Contábil',
      abrir: 'Nova transferência',
      nome: 'razao-transferencia',
    },
    {
      rota: '/financeiro/orcamento',
      leituras: LEITURAS_DO_ORCAMENTO,
      titulo: 'Orçamento e Fluxo de Caixa',
      abrir: 'Novo orçamento',
      nome: 'orcamento-novo',
    },
    {
      rota: '/financeiro/orcamento',
      leituras: LEITURAS_DO_ORCAMENTO,
      titulo: 'Orçamento e Fluxo de Caixa',
      abrir: 'Nova reserva',
      nome: 'orcamento-reserva',
    },
  ]
  for (const tela of telas) {
    await abrirTela(page, tela.rota, tela.leituras, tela.titulo)
    await page.getByRole('button', { name: tela.abrir, exact: true }).click()
    const formulario = page.locator('form').first()
    await expect(formulario).toBeVisible()
    await varrer(tela.nome)
    await ver(page, info, `formulario aberto: ${tela.nome}`)
    // "Cancelar" (o do formulário, quando tem; senão o botão que abriu) fecha sem gravar nada
    const cancelar = formulario.getByRole('button', { name: /^Cancelar/ })
    if ((await cancelar.count()) > 0) await cancelar.first().click()
    else
      await page
        .getByRole('button', { name: 'Cancelar', exact: true })
        .first()
        .click()
    await expect(page.locator('form')).toHaveCount(0)
  }
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 10. ACHADOS: o que o roteiro anotou durante a história (defeitos do sistema, não do roteiro)
// =====================================================================================================================================
test('achados do roteiro: nenhum defeito do sistema anotado durante a história', async () => {
  expect(
    achados,
    `${achados.length} achado(s) do sistema durante o roteiro:\n- ${achados.join('\n- ')}`,
  ).toEqual([])
})
