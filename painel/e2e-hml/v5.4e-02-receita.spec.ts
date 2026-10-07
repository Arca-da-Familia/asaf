import fs from 'node:fs'
import path from 'node:path'

import {
  expect,
  test,
  type Locator,
  type Page,
  type Request as Requisicao,
  type TestInfo,
} from '@playwright/test'

import {
  cadastrarPelaTela,
  campo,
  cpfValido,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  inventariar,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4e — FASE 3 ao vivo, parte 2: RECEITA, pelas telas do Financeiro do hml-painel: Planos de Contribuição (plano, reajuste, isenção, campanha de
// desconto por pagamento antecipado), Gerar Cobranças (lote com prévia e cobrança em bloco), Títulos (baixa parcial, total, a maior, crédito, Pix),
// Negociação de Dívida, Doações (campanha, doação, recibo) e Conciliação (extrato e fechamento do mês). Em cada passo: a ação feita na tela, o print,
// o valor mostrado conferido ao centavo (e o lançamento que ele tem que ter gerado, no Razão), a recusa que o sistema TEM de fazer e a Auditoria.
//
// O que este roteiro SABE do ambiente (lido em scripts/popular_homologacao.py e nos routers/serviços, não suposto):
//  - Plano de contas semeado: SÓ três contas (Caixa e banco = Ativo, Repasses de emendas = Receita, Despesas de projetos = Despesa) e o exercício 2026.
//    Não há conta de Passivo (precisa para "receita diferida" e "adiantamento de associado") nem Conta Financeira: o roteiro cria as suas, pelas telas.
//  - Os 15 associados semeados são todos "Efetivo"; o roteiro cadastra associados NOVOS (Efetivo), um para cada papel (isento, bloco, pagador,
//    devedor, sondado), para que as contas dêem exatas mesmo com o banco acumulando dado entre as rodadas.
//  - Só o Tesoureiro, o Presidente e o Conselho Fiscal têm "financeiro". O Tesoureiro NÃO tem "associados": a lista de associados que alimenta os
//    formulários (GET /api/associados/) exige essa permissão. Por isso os passos que escolhem associado rodam como Presidente, e há um cenário só
//    para provar o que o Tesoureiro enxerga (cenário A3).
//  - A geração em lote vale para TODOS os planos ativos e todos os associados elegíveis (não filtra por plano), então cada rodada usa competências
//    contadas a partir de hoje e um plano com o nome da rodada; todo número conferido é o das linhas do próprio roteiro.
//  - Formulários do painel mandam "" ou 0 nos campos opcionais em branco (data de competência da baixa, centro de custo, campanha, prazo, data fim da
//    isenção). O servidor responde 422 a "" numa data e 500 a 0 numa chave estrangeira. Os cenários A-E preenchem esses campos (caminho completo) para
//    que a história siga; o bloco F ("sondagens") tenta o caminho mínimo, só com o obrigatório, e reprova se o sistema o recusar.
//
// Blocos em ordem (`serial`): o que o bloco seguinte precisa vem do anterior. As asserções `expect.soft` marcam DEFEITO PROVÁVEL do sistema (não do
// roteiro) e ficam no último cenário de cada bloco, para não pular o que vem depois.
test.beforeAll(() => exigirHomologacao())

const PRESIDENTE = 'Marta Souza'
const TESOUREIRO = 'Fábio Henrique Dias de Teste'
const CONTA_RECEITA = 'Repasses de emendas (teste)'
const CONTA_DESPESA = 'Despesas de projetos (teste)'
const CONTA_CAIXA_SEMEADA = 'Caixa e banco (teste)'

const TELAS = [
  { rota: '/financeiro/planos-contribuicao', titulo: 'Planos de Contribuição' },
  { rota: '/financeiro/gerar-cobrancas', titulo: 'Gerar Cobranças' },
  { rota: '/financeiro/titulos', titulo: 'Títulos' },
  { rota: '/financeiro/negociacao-divida', titulo: 'Negociação de Dívida' },
  { rota: '/financeiro/doacoes', titulo: 'Doações' },
  { rota: '/financeiro/conciliacao', titulo: 'Conciliação Bancária' },
]

// ------------------------------------------------------------------------------------------------ datas e dinheiro
/** Dia (AAAA-MM-DD e dd/mm/aaaa) daqui a `deslocamentoDias`, no relógio de Belém (UTC-3), que é o do navegador do robô. */
function diaEmBelem(deslocamentoDias: number): { iso: string; br: string } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + deslocamentoDias * 86_400_000))
  const [ano, mes, dia] = iso.split('-')
  return { iso, br: `${dia}/${mes}/${ano}` }
}

/** "AAAA-MM" mais `meses` meses. */
function somarMeses(competencia: string, meses: number): string {
  const ano = Number(competencia.slice(0, 4))
  const mes = Number(competencia.slice(5, 7))
  const indice = mes - 1 + meses
  return `${ano + Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}`
}
const competenciaDaqui = (meses: number) =>
  somarMeses(diaEmBelem(0).iso.slice(0, 7), meses)
const mesDe = (competencia: string) => Number(competencia.slice(5, 7))
const brDaCompetencia = (competencia: string, dia: number) =>
  `${String(dia).padStart(2, '0')}/${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})
/** O valor como o painel mostra ("R$ 1.234,56"), com espaço comum no lugar do espaço sem quebra do Intl. Trabalha-se sempre em CENTAVOS (inteiros). */
function reais(centavos: number): string {
  return MOEDA.format(centavos / 100).replace(/\s/g, ' ')
}
/** O valor como se digita num campo numérico ("1234.56"). */
const paraCampo = (centavos: number) => (centavos / 100).toFixed(2)
/** Lê "R$ 1.234,56" (ou "-R$ 0,07") de um texto e devolve centavos. */
function centavosDe(texto: string): number {
  const achado = /(-?)R\$ ([\d.]+),(\d{2})/.exec(texto.replace(/\s/g, ' '))
  if (!achado) throw new Error(`não achei um valor em reais em "${texto}"`)
  const [, sinal, inteiro, centavos] = achado
  return (
    (sinal ? -1 : 1) *
    (Number((inteiro ?? '0').replace(/\./g, '')) * 100 + Number(centavos))
  )
}
const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ------------------------------------------------------------------------------------------------ chamadas de rede, com ou sem resposta legível
type Desfecho = {
  ok: boolean
  status: number | null
  corpo: string
  falha?: string
}

function chamada(metodo: string, caminho: string | RegExp) {
  return (q: Requisicao): boolean => {
    if (q.method() !== metodo) return false
    const alvo = new URL(q.url()).pathname
    return typeof caminho === 'string' ? alvo === caminho : caminho.test(alvo)
  }
}

/**
 * Faz o clique e devolve o que o servidor respondeu. Erro 500 que o servidor não consegue embrulhar nos cabeçalhos de CORS chega ao navegador como
 * "requisição falhou" (sem resposta legível): por isso também se espera `requestfailed`, senão o roteiro ficaria preso até o tempo limite.
 */
async function disparar(
  page: Page,
  ehDaChamada: (q: Requisicao) => boolean,
  clicar: () => Promise<unknown>,
): Promise<Desfecho> {
  const resposta = page.waitForResponse((r) => ehDaChamada(r.request()), {
    timeout: 60_000,
  })
  const falha = page.waitForEvent('requestfailed', {
    predicate: ehDaChamada,
    timeout: 60_000,
  })
  resposta.catch(() => undefined)
  falha.catch(() => undefined)
  await clicar()
  return Promise.race([
    resposta.then(async (r): Promise<Desfecho> => ({
      ok: r.ok(),
      status: r.status(),
      corpo: await r.text(),
    })),
    falha.then((q): Promise<Desfecho> =>
      Promise.resolve({
        ok: false,
        status: null,
        corpo: '',
        falha: q.failure()?.errorText ?? 'falhou',
      }),
    ),
  ])
}

const dadosDe = <T>(d: Desfecho): T => JSON.parse(d.corpo) as T
const resumo = (d: Desfecho) =>
  `${d.status ?? `sem resposta (${d.falha ?? '?'})`} ${d.corpo.slice(0, 240)}`

function exigirOk(d: Desfecho, contexto: string): void {
  expect(d.ok, `${contexto} foi recusado: ${resumo(d)}`).toBe(true)
}

// ------------------------------------------------------------------------------------------------ Auditoria
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

/** A linha (mais recente) da Auditoria com a ação, e, se pedido, o registro e quem fez. */
function linhaDaAuditoria(
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
  return linha.first()
}

/** Abre a Auditoria da tabela, confere que a linha existe (ação, registro, quem) e tira o print. */
async function exigirAuditoria(
  page: Page,
  info: TestInfo,
  d: {
    tabela: string
    acao: string
    registro?: number
    quem?: string
    nome: string
  },
): Promise<void> {
  await abrirAuditoria(page, d.tabela)
  await expect(
    linhaDaAuditoria(page, d.acao, { registro: d.registro, quem: d.quem }),
    `a Auditoria (${d.tabela}) tem de mostrar ${d.acao}${d.registro ? ` do registro ${d.registro}` : ''}`,
  ).toBeVisible()
  await ver(page, info, d.nome)
}

// ------------------------------------------------------------------------------------------------ prints
/**
 * Print só da área visível, com o alvo rolado para dentro dela. A tela de Títulos e a do Razão listam TUDO o que já existe (a geração em lote cria
 * dezenas de títulos por rodada), então o print da página inteira cresceria sem limite e não mostraria o que importa.
 */
async function verNaTela(
  page: Page,
  info: TestInfo,
  nome: string,
  alvo?: Locator,
): Promise<void> {
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  if (alvo) await alvo.first().scrollIntoViewIfNeeded()
  const roteiro = path.basename(info.file).replace(/\.spec\.ts$/, '')
  const pasta = path.join('prints-hml', roteiro)
  fs.mkdirSync(pasta, { recursive: true })
  const numero = String(fs.readdirSync(pasta).length + 1).padStart(2, '0')
  const arquivo = path.join(
    pasta,
    `${numero}-${nome.replace(/[^a-zA-Z0-9À-ÿ]+/g, '-').slice(0, 70)}.png`,
  )
  await page.screenshot({ path: arquivo })
  await info.attach(nome, { path: arquivo, contentType: 'image/png' })
}

// ------------------------------------------------------------------------------------------------ campos
/** O <select> (dentro do `escopo`) que tem uma opção com este texto: os campos do financeiro não têm rótulo, então é a primeira opção que os identifica. */
function seletorCom(escopo: Locator, opcao: string): Locator {
  return escopo
    .locator('select')
    .filter({ has: escopo.page().locator('option', { hasText: opcao }) })
}

/** Escolhe a opção que contém o texto, esperando as opções chegarem (elas vêm de consultas à parte). */
async function escolher(seletor: Locator, trecho: string): Promise<void> {
  await expect(
    seletor.locator('option', { hasText: trecho }).first(),
    `a opção "${trecho}" tem de existir no campo`,
  ).toBeAttached()
  await escolherPorTexto(seletor, trecho)
}

const corpoDaPagina = (page: Page) => page.locator('body')

async function entrarNoFinanceiro(
  page: Page,
  papel: 'tesoureiro' | 'presidente',
): Promise<void> {
  await entrar(page, papel)
  // as permissões chegaram quando o Início oferece o Financeiro
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
}

/** Cartão de um título na tela de Títulos (o cabeçalho é "A Receber — descrição"); `descricao` em texto vale como o FIM do cabeçalho. */
function cartaoDeTitulo(page: Page, descricao: string | RegExp): Locator {
  const texto =
    typeof descricao === 'string'
      ? new RegExp(`— ${escapar(descricao)}$`)
      : descricao
  return page.locator('div.rounded-md.border').filter({
    has: page.locator('p.font-medium', { hasText: texto }),
  })
}

/** Cartão de um lançamento na tela do Razão (o cabeçalho é "#número — histórico"). */
function cartaoDoLancamento(page: Page, trecho: string | RegExp): Locator {
  return page.locator('div.rounded-md.border').filter({
    has: page.locator('p.font-medium', { hasText: trecho }),
  })
}

// ------------------------------------------------------------------------------------------------ o que o roteiro prepara pelas telas
type Pessoa = { nome: string; id: number }
type Conta = { id: number; codigo: string; descricao: string }
type Apoio = {
  isento: Pessoa
  bloco: Pessoa
  pagador: Pessoa
  devedor: Pessoa
  sondado: Pessoa
  ativo: Conta
  passivo: Conta
}
let apoio: Apoio | undefined
let sequenciaDeContas = 0

function exigirApoio(): Apoio {
  if (!apoio) {
    throw new Error(
      'o preparo (associados e contas de teste) não rodou: veja o primeiro cenário do bloco',
    )
  }
  return apoio
}

async function idDoAssociado(page: Page, nome: string): Promise<number> {
  await page.goto('/associados')
  await expect(
    page.getByRole('heading', { name: 'Associados', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Filtrar').fill(nome)
  const link = page.getByRole('link', { name: nome, exact: true })
  await expect(link).toHaveCount(1)
  const id = Number((await link.getAttribute('href'))?.split('/').pop())
  expect(Number.isInteger(id), `não achei o id de ${nome}`).toBe(true)
  return id
}

/** Cria uma conta no Plano de Contas (pela tela) e devolve o id, o código e a descrição. Roda logado como Presidente ou Tesoureiro. */
async function criarConta(
  page: Page,
  d: { tipo: 'Ativo' | 'Passivo'; prefixo: string; descricao: string },
): Promise<Conta> {
  sequenciaDeContas += 1
  const codigo = `${d.prefixo}.${String(RODADA).slice(-8)}.${sequenciaDeContas}`
  await page.goto('/financeiro/plano-contas')
  await expect(
    page.getByRole('heading', { name: 'Plano de Contas', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
  const form = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Salvar', exact: true }),
  })
  await form.getByPlaceholder('Código contábil').fill(codigo)
  await form.getByPlaceholder('Descrição').fill(d.descricao)
  await escolher(seletorCom(form, 'Selecione o tipo…'), d.tipo)
  const r = await disparar(page, chamada('POST', '/plano-contas/'), () =>
    form.getByRole('button', { name: 'Salvar', exact: true }).click(),
  )
  exigirOk(r, `criar a conta ${d.descricao}`)
  const { id_conta } = dadosDe<{ id_conta: number }>(r)
  await expect(
    page.locator('p.font-medium', { hasText: d.descricao }),
  ).toBeVisible()
  return { id: id_conta, codigo, descricao: d.descricao }
}

/** Cadastra os associados novos e as duas contas de que o roteiro precisa, UMA vez por execução do arquivo (cada cenário o chama e só o primeiro trabalha). */
async function garantirApoio(page: Page): Promise<Apoio> {
  if (apoio) return apoio
  await entrar(page, 'presidente')
  const pessoa = async (rotulo: string, k: number): Promise<Pessoa> => {
    const nome = `${rotulo} Robo Receita ${RODADA} de Teste`
    await cadastrarPelaTela(page, {
      nome,
      cpf: cpfValido(700000000 + ((RODADA + k * 130363) % 90000000)),
      email: `${rotulo.toLowerCase()}.receita.${RODADA}@homologacao.example.com`,
      telefone: `9191${String(RODADA + k).slice(-7)}`,
    })
    const id = await idDoAssociado(page, nome)
    await expect(
      page.getByRole('row').filter({ hasText: nome }),
      `${nome} tem de ser da categoria Efetivo (é a que o plano cobra)`,
    ).toContainText('Efetivo')
    return { nome, id }
  }
  const isento = await pessoa('Isento', 1)
  const bloco = await pessoa('Bloco', 2)
  const pagador = await pessoa('Pagador', 3)
  const devedor = await pessoa('Devedor', 4)
  const sondado = await pessoa('Sondado', 5)
  const ativo = await criarConta(page, {
    tipo: 'Ativo',
    prefixo: '1.8',
    descricao: `Banco de teste do robô ${RODADA}`,
  })
  const passivo = await criarConta(page, {
    tipo: 'Passivo',
    prefixo: '2.8',
    descricao: `Adiantamentos e receita diferida de teste do robô ${RODADA}`,
  })
  await sair(page)
  apoio = { isento, bloco, pagador, devedor, sondado, ativo, passivo }
  return apoio
}

// ------------------------------------------------------------------------------------------------ títulos e baixa
/** Lança um título pela tela "Novo título". Devolve o número do título. */
async function criarTituloPelaTela(
  page: Page,
  d: {
    tipo: 'A Pagar' | 'A Receber'
    conta: string
    descricao: string
    centavos: number
    vencimentoIso: string
    associado?: string
  },
): Promise<number> {
  await page.goto('/financeiro/titulos')
  await expect(
    page.getByRole('heading', { name: 'Títulos', level: 1 }),
  ).toBeVisible()
  const formulario = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Registrar título' }),
  })
  if ((await formulario.count()) === 0) {
    await page.getByRole('button', { name: 'Novo título', exact: true }).click()
  }
  await expect(formulario).toBeVisible()
  await seletorCom(formulario, 'A Receber').selectOption(d.tipo)
  await escolher(seletorCom(formulario, 'Selecione a conta contábil…'), d.conta)
  await formulario
    .getByPlaceholder('Descrição', { exact: true })
    .fill(d.descricao)
  await formulario
    .getByPlaceholder('Valor original')
    .fill(paraCampo(d.centavos))
  await formulario.locator('input[type="date"]').fill(d.vencimentoIso)
  if (d.associado) {
    await seletorCom(formulario, 'Sem beneficiário').selectOption('associado')
    await escolher(
      seletorCom(formulario, 'Selecione o associado…'),
      d.associado,
    )
  }
  const r = await disparar(page, chamada('POST', '/titulos/'), () =>
    formulario.getByRole('button', { name: 'Registrar título' }).click(),
  )
  exigirOk(r, `lançar o título "${d.descricao}"`)
  const { id_titulo } = dadosDe<{ id_titulo: number }>(r)
  await expect(formulario).toHaveCount(0)
  await expect(cartaoDeTitulo(page, d.descricao)).toBeVisible()
  return id_titulo
}

type DadosBaixa = {
  centavos: number
  forma: string
  contrapartida: string
  adiantamento?: string
  /** AAAA-MM-DD; sem isto, hoje. */
  competenciaIso?: string
}

async function abrirBaixa(cartao: Locator): Promise<Locator> {
  await cartao.getByRole('button', { name: 'Baixar', exact: true }).click()
  const form = cartao.locator('form')
  await expect(form.getByPlaceholder('Valor pago')).toBeVisible()
  return form
}

/** Preenche o que a baixa exige: valor, forma, conta de contrapartida (e a de adiantamento, quando o valor passa do saldo). */
async function preencherBaixa(form: Locator, d: DadosBaixa): Promise<void> {
  await form.getByPlaceholder('Valor pago').fill(paraCampo(d.centavos))
  await form.getByPlaceholder('Forma de pagamento').fill(d.forma)
  await escolher(
    seletorCom(form, 'Conta de contrapartida (Caixa/Banco)…'),
    d.contrapartida,
  )
  if (d.adiantamento) {
    await escolher(
      seletorCom(form, 'Conta de adiantamento de associados…'),
      d.adiantamento,
    )
  }
}

/** Os dois campos que a tela chama de opcionais: data de competência e centro de custo (o roteiro das sondagens prova o que acontece sem eles). */
async function preencherOpcionaisDaBaixa(
  form: Locator,
  d: DadosBaixa,
): Promise<void> {
  await form
    .locator('input[type="date"]')
    .fill(d.competenciaIso ?? diaEmBelem(0).iso)
  await escolherCentroDeCusto(form)
}

async function escolherCentroDeCusto(form: Locator): Promise<void> {
  const centros = seletorCom(form, 'Sem centro de custo')
  await expect
    .poll(() => centros.locator('option').count(), {
      message: 'o ambiente de teste tem de ter um centro de custo ativo',
    })
    .toBeGreaterThan(1)
  await centros.selectOption({ index: 1 })
}

function enviarBaixa(page: Page, form: Locator): Promise<Desfecho> {
  return disparar(page, chamada('POST', '/baixar-titulo/'), () =>
    form.getByRole('button', { name: 'Confirmar baixa' }).click(),
  )
}

type ResultadoDaBaixa = {
  saldo_restante: number
  id_lancamento: number
  numero_sequencial: number
  id_credito_gerado: number | null
}

/** Baixa pela tela (caminho completo, com os opcionais) e exige que o sistema aceite. Devolve o que o servidor respondeu. */
async function baixarPelaTela(
  page: Page,
  cartao: Locator,
  d: DadosBaixa,
  nome: string,
): Promise<ResultadoDaBaixa> {
  const form = await abrirBaixa(cartao)
  await preencherBaixa(form, d)
  await preencherOpcionaisDaBaixa(form, d)
  const r = await enviarBaixa(page, form)
  exigirOk(r, nome)
  await expect(form).toHaveCount(0) // o formulário se fecha sozinho
  return dadosDe<ResultadoDaBaixa>(r)
}

// ------------------------------------------------------------------------------------------------ campanha de arrecadação e doação
async function criarCampanhaDeArrecadacao(
  page: Page,
  d: { titulo: string; metaCentavos: number },
): Promise<number> {
  const secao = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Campanhas de arrecadação' }),
  })
  const form = secao.locator('form')
  if ((await form.count()) === 0) {
    await secao
      .getByRole('button', { name: 'Nova campanha', exact: true })
      .click()
  }
  await form.getByPlaceholder('Título da campanha').fill(d.titulo)
  await form.getByPlaceholder('Meta (R$)').fill(paraCampo(d.metaCentavos))
  await form.locator('input[type="date"]').fill(diaEmBelem(90).iso)
  const centros = seletorCom(form, 'Sem centro de custo vinculado')
  await expect.poll(() => centros.locator('option').count()).toBeGreaterThan(1)
  await centros.selectOption({ index: 1 })
  const r = await disparar(
    page,
    chamada('POST', '/api/campanhas-arrecadacao/'),
    () => form.getByRole('button', { name: 'Criar campanha' }).click(),
  )
  exigirOk(r, `criar a campanha "${d.titulo}"`)
  await expect(form).toHaveCount(0)
  return dadosDe<{ id_campanha: number }>(r).id_campanha
}

const formularioDeDoacao = (page: Page) =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: 'Registrar doação', exact: true }),
  })

/** Abre o formulário "Registrar doação" do zero (se sobrou um aberto, fecha pelo "Cancelar" dele e abre de novo: a recusa antiga não confunde a nova). */
async function abrirFormularioDeDoacao(page: Page): Promise<Locator> {
  const form = formularioDeDoacao(page)
  if ((await form.count()) > 0) {
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(form).toHaveCount(0)
  }
  await page
    .getByRole('button', { name: 'Registrar doação', exact: true })
    .click()
  await expect(form).toBeVisible()
  return form
}

type DadosDoacao = {
  anonima?: boolean
  nome?: string
  documento?: string
  tipo?: 'Monetaria' | 'Bens'
  centavos: number
  descricaoDoBem?: string
  caixa?: string
  campanha?: string
  comDestinacao?: boolean
  recorrente?: boolean
}

async function preencherDoacao(form: Locator, d: DadosDoacao): Promise<void> {
  if (d.nome) await form.getByPlaceholder('Nome do doador').fill(d.nome)
  if (d.documento) {
    await form
      .getByPlaceholder('CPF/CNPJ do doador (opcional)')
      .fill(d.documento)
  }
  if (d.anonima) await form.getByLabel('Doação anônima').check()
  if (d.tipo === 'Bens') {
    await seletorCom(form, 'Em bens').selectOption('Bens')
    await form
      .getByPlaceholder('Descrição do bem doado')
      .fill(d.descricaoDoBem ?? '')
  }
  await form.getByPlaceholder(/^Valor( avaliado)?$/).fill(paraCampo(d.centavos))
  await escolher(seletorCom(form, 'Conta contábil (Receita)…'), CONTA_RECEITA)
  if (d.caixa) {
    await escolher(
      seletorCom(form, 'Conta de caixa/banco que recebeu…'),
      d.caixa,
    )
  }
  if (d.campanha) {
    await escolher(seletorCom(form, 'Sem campanha vinculada'), d.campanha)
  }
  if (d.comDestinacao) {
    const destinos = seletorCom(form, 'Sem destinação específica')
    await expect
      .poll(() => destinos.locator('option').count())
      .toBeGreaterThan(1)
    await destinos.selectOption({ index: 1 })
  }
  if (d.recorrente) await form.getByLabel('Doação recorrente').check()
}

type DoacaoRegistrada = {
  id_doacao: number
  numero_recibo: number
}

/** Registra pela tela (campanha e destinação preenchidas) e exige que o sistema aceite. */
async function registrarDoacao(
  page: Page,
  form: Locator,
  nome: string,
): Promise<DoacaoRegistrada> {
  const r = await disparar(page, chamada('POST', '/api/doacoes/'), () =>
    form.getByRole('button', { name: 'Registrar doação', exact: true }).click(),
  )
  exigirOk(r, nome)
  const registrada = dadosDe<DoacaoRegistrada>(r)
  await expect(
    form.getByText(
      `Doação registrada — recibo nº ${registrada.numero_recibo}.`,
    ),
  ).toBeVisible()
  return registrada
}

function cartaoDeDoacao(page: Page, recibo: number): Locator {
  return page.locator('div.rounded-md.border').filter({
    hasText: new RegExp(`recibo nº ${recibo}(?!\\d)`),
  })
}

// ------------------------------------------------------------------------------------------------ Pix (o mesmo cálculo do servidor, para conferir o código)
function crc16(payload: string): string {
  let crc = 0xffff
  for (const byte of Buffer.from(payload, 'utf-8')) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// ------------------------------------------------------------------------------------------------ o que cada bloco guarda para o seguinte
const ETIQUETA = `${RODADA}`
let contaFinanceiraDaConciliacao:
  { conta: Conta; idContaFinanceira: number } | undefined

// =====================================================================================================================================
// A. QUEM PODE E O QUE CADA TELA OFERECE (independentes entre si)
// =====================================================================================================================================
test.describe('A. Quem pode e o que cada tela da receita oferece', () => {
  test('o Secretário (sem a permissão do financeiro) é barrado em todas as telas da receita, mesmo digitando o endereço', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'secretario')
    await expect(
      page.getByText(/Bem-vindo, Daniel Ribeiro Costa/),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Financeiro' })).toHaveCount(0)
    for (const tela of TELAS) {
      await page.goto(tela.rota)
      await expect(
        page.getByRole('heading', { name: 'Acesso negado' }),
        `${tela.titulo}: o Secretário não pode abrir`,
      ).toBeVisible()
      await expect(
        page.getByText(/permissão necessária: financeiro/),
      ).toBeVisible()
      await expect(
        page.getByRole('heading', { name: tela.titulo, level: 1 }),
      ).toHaveCount(0)
      await ver(page, info, `Secretario barrado em ${tela.titulo}`)
    }
    expect(vigia.problemas()).toEqual([])
  })

  test('o Tesoureiro abre as seis telas da receita, cada uma com as suas seções e os botões que ela promete', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    const trilha = page.getByRole('navigation', {
      name: 'Trilha de navegação',
    })
    for (const tela of TELAS) {
      await page.goto(tela.rota)
      await expect(
        page.getByRole('heading', { name: tela.titulo, level: 1 }),
      ).toBeVisible()
      await expect(
        trilha.getByRole('link', { name: 'Financeiro' }),
      ).toBeVisible()
      if (tela.titulo === 'Títulos') {
        await verNaTela(page, info, `Tesoureiro abre ${tela.titulo}`)
      } else {
        await ver(page, info, `Tesoureiro abre ${tela.titulo}`)
      }
    }

    await page.goto('/financeiro/planos-contribuicao')
    for (const secao of [
      'Planos cadastrados',
      'Isenções',
      'Campanha de Desconto por Pagamento Antecipado',
    ]) {
      await expect(page.getByRole('heading', { name: secao })).toBeVisible()
    }
    for (const botao of ['Novo plano', 'Nova isenção', 'Nova vigência']) {
      await expect(
        page.getByRole('button', { name: botao, exact: true }),
      ).toBeVisible()
    }

    await page.goto('/financeiro/gerar-cobrancas')
    await expect(campo(page, 'Competência (AAAA-MM)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ver prévia' })).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Gerar cobrança em bloco (pagamento antecipado)',
      }),
    ).toBeVisible()

    await page.goto('/financeiro/titulos')
    await expect(
      page.getByRole('button', { name: 'Novo título', exact: true }),
    ).toBeVisible()
    await expect(
      seletorCom(corpoDaPagina(page), 'Todos os status'),
    ).toBeVisible()
    await expect(
      seletorCom(corpoDaPagina(page), 'Todos os tipos'),
    ).toBeVisible()

    await page.goto('/financeiro/doacoes')
    for (const secao of ['Campanhas de arrecadação', 'Doações registradas']) {
      await expect(page.getByRole('heading', { name: secao })).toBeVisible()
    }
    for (const botao of ['Nova campanha', 'Registrar doação']) {
      await expect(
        page.getByRole('button', { name: botao, exact: true }),
      ).toBeVisible()
    }

    await page.goto('/financeiro/conciliacao')
    await expect(page.locator('input[type="file"]')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Fechamento mensal' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fechar mês' })).toBeVisible()
    expect(vigia.problemas()).toEqual([])
  })

  test('o Tesoureiro consegue escolher associados nos formulários do financeiro (achado provável: a lista de associados exige a permissão "associados", que ele não tem)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    const lista = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/associados/busca-simples' &&
        r.status() !== 401,
    )
    await page.goto('/financeiro/negociacao-divida')
    await expect(
      page.getByRole('heading', { name: 'Negociação de Dívida', level: 1 }),
    ).toBeVisible()
    const resposta = await lista
    await ver(
      page,
      info,
      'Tesoureiro em Negociacao de Divida: lista de associados',
    )
    // o formulário de título, de isenção e de cobrança em bloco usam a mesma lista: sem ela, não há como escolher a quem cobrar
    expect
      .soft(
        resposta.status(),
        'GET /api/associados/ responde ' +
          `${resposta.status()} ao Tesoureiro: ele não consegue escolher associado em Negociação de Dívida, Novo título (beneficiário), Nova isenção nem Cobrança em bloco ` +
          '(app/routers/associados.py:116 e :392 exigem "associados"; o cargo de Tesoureiro só concede "financeiro" e "parcerias", app/database.py:202)',
      )
      .toBe(200)
    expect(vigia.problemas()).toEqual([])
  })

  test('varredura: todo campo dos formulários da receita tem rótulo acessível (quem usa leitor de tela precisa saber o que preencher)', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const semRotulo: string[] = []
    const varrer = async (nome: string) => {
      try {
        await inventariar(page, info, nome)
      } catch (erro) {
        semRotulo.push(
          `${nome}: ${(erro as Error).message.split('\n').slice(0, 14).join(' | ')}`,
        )
      }
    }
    await entrarNoFinanceiro(page, 'tesoureiro')

    await page.goto('/financeiro/planos-contribuicao')
    await expect(
      page.getByRole('heading', { name: 'Planos de Contribuição', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Novo plano', exact: true }).click()
    await expect(
      page.getByPlaceholder('Categoria (ex.: Efetivo)'),
    ).toBeVisible()
    await varrer('receita-planos-novo-plano')

    await page.goto('/financeiro/planos-contribuicao')
    await expect(
      page
        .getByText('Nenhum plano de contribuição cadastrado.')
        .or(page.getByRole('button', { name: 'Reajustar' }).first()),
    ).toBeVisible()
    if ((await page.getByRole('button', { name: 'Reajustar' }).count()) > 0) {
      await page.getByRole('button', { name: 'Reajustar' }).first().click()
      await expect(page.getByPlaceholder('Novo valor')).toBeVisible()
      await varrer('receita-planos-reajuste')
    }

    await page.goto('/financeiro/planos-contribuicao')
    await page
      .getByRole('button', { name: 'Nova isenção', exact: true })
      .click()
    await expect(
      page.getByPlaceholder('% de desconto (100 = isenção total)'),
    ).toBeVisible()
    await varrer('receita-planos-nova-isencao')

    await page.goto('/financeiro/planos-contribuicao')
    await page
      .getByRole('button', { name: 'Nova vigência', exact: true })
      .click()
    await expect(page.getByPlaceholder('Meses do bloco (ex.: 6)')).toBeVisible()
    await varrer('receita-planos-nova-vigencia')

    await page.goto('/financeiro/gerar-cobrancas')
    await expect(
      page.getByRole('heading', { name: 'Gerar Cobranças', level: 1 }),
    ).toBeVisible()
    await varrer('receita-gerar-cobrancas')

    await page.goto('/financeiro/titulos')
    await page.getByRole('button', { name: 'Novo título', exact: true }).click()
    await expect(page.getByPlaceholder('Valor original')).toBeVisible()
    await varrer('receita-titulos-novo-titulo')

    await page.goto('/financeiro/titulos')
    await expect(
      page
        .getByText('Nenhum título encontrado.')
        .or(page.getByRole('button', { name: 'Baixar', exact: true }).first()),
    ).toBeVisible()
    if (
      (await page
        .getByRole('button', { name: 'Baixar', exact: true })
        .count()) > 0
    ) {
      await page
        .getByRole('button', { name: 'Baixar', exact: true })
        .first()
        .click()
      await expect(page.getByPlaceholder('Valor pago')).toBeVisible()
      await varrer('receita-titulos-baixa')
    }

    await page.goto('/financeiro/negociacao-divida')
    await expect(
      page.getByRole('heading', { name: 'Negociação de Dívida', level: 1 }),
    ).toBeVisible()
    await varrer('receita-negociacao-de-divida')

    await page.goto('/financeiro/doacoes')
    await page
      .getByRole('button', { name: 'Nova campanha', exact: true })
      .click()
    await expect(page.getByPlaceholder('Título da campanha')).toBeVisible()
    await varrer('receita-doacoes-nova-campanha')

    await page.goto('/financeiro/doacoes')
    await page
      .getByRole('button', { name: 'Registrar doação', exact: true })
      .click()
    await expect(page.getByPlaceholder('Nome do doador')).toBeVisible()
    await varrer('receita-doacoes-registrar-doacao')

    await page.goto('/financeiro/conciliacao')
    await expect(
      page.getByRole('heading', { name: 'Conciliação Bancária', level: 1 }),
    ).toBeVisible()
    await varrer('receita-conciliacao')

    expect(semRotulo, 'campo(s) sem rótulo acessível').toEqual([])
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// B. PLANOS DE CONTRIBUIÇÃO, COBRANÇA EM LOTE E EM BLOCO (DESCONTO POR PAGAMENTO ANTECIPADO)
//    Mensalidade R$ 123,45 (reajustada para R$ 150,00 a partir da competência do bloco), isenção de 40% para um associado e de 100% para outro,
//    bloco de 6 meses com 10% de desconto: 6 x R$ 150,00 x 0,90 = R$ 810,00, que a baixa leva à receita diferida (Passivo) e o mês seguinte
//    reconhece em fatias de R$ 135,00.
// =====================================================================================================================================
test.describe('B. Planos, cobranças em lote e em bloco, com desconto por pagamento antecipado', () => {
  test.describe.configure({ mode: 'serial' })

  const PLANO = `Mensalidade do robô ${ETIQUETA}`
  const MOTIVO_CAMPANHA = `Ata de teste ${ETIQUETA}`
  const BASE = 12345
  const REAJUSTADO = 15000
  const ISENTO_40 = 7407 // 123,45 x 0,60
  const ISENTO_40_REAJUSTADO = 9000 // 150,00 x 0,60
  const BLOCO = 81000 // 6 x 150,00 x 0,90
  const FATIA = 13500
  const C1 = competenciaDaqui(1) // antes do reajuste: R$ 123,45
  const CB = competenciaDaqui(3) // o reajuste começa no dia 1 desta competência: R$ 150,00
  const CF = somarMeses(CB, 5)
  const GATILHO = [mesDe(CB), mesDe(somarMeses(CB, 6))]
    .sort((x, y) => x - y)
    .join(',')

  let idPlano = 0
  let idCampanha = 0
  let idIsencaoParcial = 0
  let idIsencaoTotal = 0
  let idBloco = 0
  let lancamentoDoBloco = 0

  test('preparo: associados novos, conta de banco e conta de passivo criados pelas telas', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    const a = await garantirApoio(page)
    info.annotations.push({
      type: 'preparo',
      description: `associados #${a.isento.id}, #${a.bloco.id}, #${a.pagador.id}, #${a.devedor.id}, #${a.sondado.id}; contas ${a.ativo.codigo} e ${a.passivo.codigo}`,
    })
    expect(vigia.problemas()).toEqual([])
  })

  test('plano de contribuição: campos vazios e valores impossíveis são recusados; o válido aparece com o valor certo; o reajuste agenda o novo valor sem apagar o atual', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/planos-contribuicao')
    await expect(
      page.getByRole('heading', { name: 'Planos de Contribuição', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Novo plano', exact: true }).click()
    const form = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Cadastrar', exact: true }),
    })
    await expect(
      form.getByPlaceholder('Categoria (ex.: Efetivo)'),
    ).toBeVisible()
    const cadastrar = form.getByRole('button', {
      name: 'Cadastrar',
      exact: true,
    })
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })

    // recusa 1: nada preenchido (cada falta aparece uma vez, no campo)
    await cadastrar.click()
    for (const texto of [
      'Informe a categoria.',
      'Informe a descrição.',
      'Selecione a conta contábil (Receita).',
      'Informe um valor maior que zero.',
    ]) {
      await expect(alerta(texto)).toHaveCount(1)
    }
    await verNaTela(page, info, 'plano de contribuicao vazio: recusado', form)

    // recusa 2: dia de vencimento 32 e valor negativo
    await form.getByPlaceholder('Categoria (ex.: Efetivo)').fill('Efetivo')
    await form.getByPlaceholder('Descrição', { exact: true }).fill(PLANO)
    await form.getByPlaceholder('Dia de vencimento').fill('32')
    await form.getByPlaceholder('Valor inicial').fill('-5')
    await cadastrar.click()
    await expect(alerta('Dia inválido.')).toHaveCount(1)
    await expect(alerta('Informe um valor maior que zero.')).toHaveCount(1)
    await expect(alerta('Selecione a conta contábil (Receita).')).toHaveCount(1)
    await expect(alerta('Informe a categoria.')).toHaveCount(0)
    await verNaTela(
      page,
      info,
      'plano com dia 32 e valor negativo: recusado',
      form,
    )

    // a conta do plano só pode ser de Receita (a tela nem oferece as outras)
    const contas = seletorCom(form, 'Conta contábil (Receita)…')
    await expect(
      contas.locator('option', { hasText: CONTA_RECEITA }).first(),
    ).toBeAttached()
    for (const naoOferecida of [
      CONTA_DESPESA,
      CONTA_CAIXA_SEMEADA,
      a.ativo.descricao,
      a.passivo.descricao,
    ]) {
      await expect(
        contas.locator('option', { hasText: naoOferecida }),
      ).toHaveCount(0)
    }

    // certo
    await form.getByPlaceholder('Dia de vencimento').fill('15')
    await form.getByPlaceholder('Valor inicial').fill(paraCampo(BASE))
    await escolher(contas, CONTA_RECEITA)
    const r = await disparar(
      page,
      chamada('POST', '/api/planos-contribuicao/'),
      () => cadastrar.click(),
    )
    exigirOk(r, 'cadastrar o plano de contribuição')
    idPlano = dadosDe<{ id_plano: number }>(r).id_plano
    await expect(form).toHaveCount(0)
    const cartao = page.locator('div.rounded-md.border').filter({
      has: page.locator('p.font-medium', { hasText: `Efetivo — ${PLANO}` }),
    })
    await expect(cartao).toHaveCount(1)
    await expect(cartao).toContainText(reais(BASE))
    await expect(cartao).toContainText('Mensal · vencimento dia 15')
    await verNaTela(
      page,
      info,
      'plano de contribuicao cadastrado com R$ 123,45',
      cartao,
    )

    // reajuste: recusas
    await cartao.getByRole('button', { name: 'Reajustar', exact: true }).click()
    const reajuste = cartao.locator('form')
    await expect(reajuste.getByPlaceholder('Novo valor')).toBeVisible()
    const confirmar = reajuste.getByRole('button', {
      name: 'Confirmar reajuste',
    })
    await confirmar.click()
    for (const texto of [
      'Informe um valor maior que zero.',
      'Informe a data de início da vigência.',
      'Informe o motivo do reajuste.',
    ]) {
      await expect(
        reajuste.getByRole('alert').filter({ hasText: texto }),
      ).toHaveCount(1)
    }
    await verNaTela(page, info, 'reajuste vazio: recusado', cartao)

    // reajuste: a nova vigência tem que começar DEPOIS da atual (o servidor recusa data de ontem)
    await reajuste.getByPlaceholder('Novo valor').fill(paraCampo(REAJUSTADO))
    await reajuste.locator('input[type="date"]').fill(diaEmBelem(-1).iso)
    await reajuste.getByPlaceholder('Motivo do reajuste').fill('ab')
    await confirmar.click()
    await expect(
      reajuste
        .getByRole('alert')
        .filter({ hasText: 'Informe o motivo do reajuste.' }),
    ).toHaveCount(1)
    await reajuste
      .getByPlaceholder('Motivo do reajuste')
      .fill(`Reajuste de teste do robô ${ETIQUETA}`)
    const recusado = await disparar(
      page,
      chamada('POST', /\/api\/planos-contribuicao\/\d+\/reajustar$/),
      () => confirmar.click(),
    )
    expect(recusado.status, resumo(recusado)).toBe(400)
    await expect(
      reajuste.getByRole('alert').filter({
        hasText: 'A nova vigência precisa começar depois da vigência atual.',
      }),
    ).toHaveCount(1)
    await expect(cartao).toContainText(reais(BASE))
    await verNaTela(
      page,
      info,
      'reajuste com vigencia anterior a atual: recusado',
      cartao,
    )

    // reajuste: certo, a partir do dia 1 da competência do bloco; o valor de hoje continua o mesmo, nada é apagado
    await reajuste.locator('input[type="date"]').fill(`${CB}-01`)
    const aceito = await disparar(
      page,
      chamada('POST', /\/api\/planos-contribuicao\/\d+\/reajustar$/),
      () => confirmar.click(),
    )
    exigirOk(aceito, 'reajustar o plano')
    await expect(reajuste).toHaveCount(0)
    await expect(
      cartao.getByRole('button', { name: 'Reajustar', exact: true }),
    ).toBeVisible()
    await expect(cartao).toContainText(reais(BASE))
    await expect(cartao).not.toContainText(reais(REAJUSTADO))
    await verNaTela(
      page,
      info,
      'reajuste agendado: o valor de hoje continua R$ 123,45',
      cartao,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('campanha de desconto por pagamento antecipado: recusas de campo e do servidor, cadastro, inativar e reativar', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/planos-contribuicao')
    const secao = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Campanha de Desconto por Pagamento Antecipado',
      }),
    })
    await secao
      .getByRole('button', { name: 'Nova vigência', exact: true })
      .click()
    const form = secao.locator('form')
    await expect(form.getByPlaceholder('Meses do bloco (ex.: 6)')).toBeVisible()
    const cadastrar = form.getByRole('button', { name: 'Cadastrar campanha' })
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })

    // recusa 1: nada preenchido
    await cadastrar.click()
    for (const texto of [
      'Informe um percentual maior que zero.',
      'Informe os meses-gatilho (ex.: 1,7).',
      'Selecione a conta de receita diferida (Passivo).',
    ]) {
      await expect(alerta(texto)).toHaveCount(1)
    }
    await verNaTela(page, info, 'campanha de desconto vazia: recusada', form)

    // recusa 2: percentual acima de 100 e bloco longo demais; depois curto demais
    await form.getByPlaceholder('% de desconto').fill('101')
    await form.getByPlaceholder('Meses do bloco (ex.: 6)').fill('13')
    await cadastrar.click()
    await expect(alerta('No máximo 100%.')).toHaveCount(1)
    await expect(alerta('Máximo 12 meses.')).toHaveCount(1)
    await form.getByPlaceholder('Meses do bloco (ex.: 6)').fill('1')
    await cadastrar.click()
    await expect(alerta('Mínimo 2 meses.')).toHaveCount(1)
    await verNaTela(
      page,
      info,
      'campanha com percentual e bloco fora do limite: recusada',
      form,
    )

    // a conta da campanha só pode ser de Passivo (a tela nem oferece as outras)
    const contas = seletorCom(form, 'Conta de receita diferida (Passivo)…')
    await expect(
      contas.locator('option', { hasText: a.passivo.descricao }),
    ).toHaveCount(1)
    for (const naoOferecida of [
      CONTA_RECEITA,
      CONTA_CAIXA_SEMEADA,
      a.ativo.descricao,
    ]) {
      await expect(
        contas.locator('option', { hasText: naoOferecida }),
      ).toHaveCount(0)
    }

    // recusa 3 e 4: o servidor recusa mês-gatilho fora de 1 a 12 e meses repetidos (a mensagem aparece no campo)
    await form.getByPlaceholder('% de desconto').fill('10')
    await form.getByPlaceholder('Meses do bloco (ex.: 6)').fill('6')
    await escolher(contas, a.passivo.descricao)
    await form.getByPlaceholder('Meses-gatilho (ex.: 1,7)').fill('13')
    const fora = await disparar(
      page,
      chamada('POST', '/api/campanhas-desconto-antecipado/'),
      () => cadastrar.click(),
    )
    expect(fora.status, resumo(fora)).toBe(422)
    await expect(alerta('Mês-gatilho deve ser entre 1 e 12.')).toHaveCount(1)
    await form.getByPlaceholder('Meses-gatilho (ex.: 1,7)').fill('2,2')
    const repetido = await disparar(
      page,
      chamada('POST', '/api/campanhas-desconto-antecipado/'),
      () => cadastrar.click(),
    )
    expect(repetido.status, resumo(repetido)).toBe(422)
    await expect(alerta('Meses-gatilho não podem se repetir.')).toHaveCount(1)
    await verNaTela(
      page,
      info,
      'campanha com mes-gatilho invalido ou repetido: recusada',
      form,
    )

    // certo: o bloco de 6 meses, com 10%, começando nos meses da competência do bloco
    await form.getByPlaceholder('Meses-gatilho (ex.: 1,7)').fill(GATILHO)
    await form.getByPlaceholder(/^Motivo/).fill(MOTIVO_CAMPANHA)
    const r = await disparar(
      page,
      chamada('POST', '/api/campanhas-desconto-antecipado/'),
      () => cadastrar.click(),
    )
    exigirOk(r, 'cadastrar a campanha de desconto')
    idCampanha = dadosDe<{ id_campanha: number }>(r).id_campanha
    await expect(form).toHaveCount(0)
    const cartao = secao
      .locator('div.rounded-md.border')
      .filter({ hasText: MOTIVO_CAMPANHA })
    await expect(cartao).toHaveCount(1)
    await expect(cartao).toContainText('10% de desconto — bloco de 6 meses')
    await expect(cartao).toContainText(
      `Meses-gatilho: ${GATILHO.split(',').join(', ')}`,
    )
    await expect(cartao.getByText('Vigente', { exact: true })).toBeVisible()
    await verNaTela(
      page,
      info,
      'campanha de desconto cadastrada e vigente',
      cartao,
    )

    // inativar e reativar (enquanto inativa, o bloco não pode ser gerado: o cenário do bloco prova)
    await cartao.getByRole('button', { name: 'Inativar', exact: true }).click()
    await expect(cartao).toContainText('Vigente (inativa)')
    await expect(
      cartao.getByRole('button', { name: 'Reativar', exact: true }),
    ).toBeVisible()
    await verNaTela(page, info, 'campanha inativada', cartao)
    await cartao.getByRole('button', { name: 'Reativar', exact: true }).click()
    await expect(cartao.getByText('Vigente', { exact: true })).toBeVisible()
    await expect(
      cartao.getByRole('button', { name: 'Inativar', exact: true }),
    ).toBeVisible()
    expect(vigia.problemas()).toEqual([])
  })

  test('isenção: campos vazios e percentuais fora do limite são recusados; 40% e 100% valem só para o plano escolhido', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'presidente')
    await page.goto('/financeiro/planos-contribuicao')
    const secao = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Isenções' }),
    })
    await secao
      .getByRole('button', { name: 'Nova isenção', exact: true })
      .click()
    const form = secao.locator('form')
    const cadastrar = form.getByRole('button', { name: 'Cadastrar isenção' })
    await expect(
      form.getByPlaceholder('% de desconto (100 = isenção total)'),
    ).toBeVisible()
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })

    // recusa 1: sem associado e sem motivo
    await cadastrar.click()
    await expect(alerta('Selecione o associado.')).toHaveCount(1)
    await expect(alerta('Selecione o motivo.')).toHaveCount(1)
    await verNaTela(page, info, 'isencao vazia: recusada', form)

    // recusa 2 e 3: percentual zero e acima de 100
    const percentual = form.getByPlaceholder(
      '% de desconto (100 = isenção total)',
    )
    await percentual.fill('0')
    await cadastrar.click()
    await expect(alerta('Informe um percentual maior que zero.')).toHaveCount(1)
    await percentual.fill('101')
    await cadastrar.click()
    await expect(alerta('No máximo 100%.')).toHaveCount(1)
    await verNaTela(
      page,
      info,
      'isencao com percentual fora do limite: recusada',
      form,
    )

    const cadastrarIsencao = async (
      nome: string,
      pct: number,
    ): Promise<number> => {
      await escolher(seletorCom(form, 'Selecione o associado…'), nome)
      await escolher(seletorCom(form, 'Todos os planos do associado'), PLANO)
      await escolher(
        seletorCom(form, 'Selecione o motivo…'),
        'Dificuldade financeira comprovada',
      )
      await percentual.fill(String(pct))
      // data de fim preenchida: sem ela o painel manda "" e o servidor responde 422 (a sondagem F4 prova)
      await form.locator('input[type="date"]').fill(diaEmBelem(730).iso)
      const r = await disparar(
        page,
        chamada('POST', '/api/isencoes-contribuicao/'),
        () => cadastrar.click(),
      )
      exigirOk(r, `cadastrar a isenção de ${pct}%`)
      await expect(form).toHaveCount(0)
      return dadosDe<{ id_isencao: number }>(r).id_isencao
    }
    idIsencaoParcial = await cadastrarIsencao(a.isento.nome, 40)
    const cartaoParcial = secao.locator('div.rounded-md.border').filter({
      hasText: new RegExp(`Associado #${a.isento.id} — 40% de desconto`),
    })
    await expect(cartaoParcial).toHaveCount(1)
    await verNaTela(page, info, 'isencao de 40% cadastrada', cartaoParcial)

    await secao
      .getByRole('button', { name: 'Nova isenção', exact: true })
      .click()
    await expect(form).toBeVisible()
    idIsencaoTotal = await cadastrarIsencao(a.devedor.nome, 100)
    const cartaoTotal = secao.locator('div.rounded-md.border').filter({
      hasText: new RegExp(`Associado #${a.devedor.id} — 100% de desconto`),
    })
    await expect(cartaoTotal).toHaveCount(1)
    await verNaTela(page, info, 'isencao de 100% cadastrada', cartaoTotal)
    expect(vigia.problemas()).toEqual([])
  })

  test('gerar cobranças em lote: competência inválida é recusada; a prévia mostra cada linha ao centavo; confirmar gera; repetir (também de uma segunda aba) não duplica', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/gerar-cobrancas')
    await expect(
      page.getByRole('heading', { name: 'Gerar Cobranças', level: 1 }),
    ).toBeVisible()
    const formulario = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Ver prévia' }),
    })
    const competencia = campo(page, 'Competência (AAAA-MM)')
    const verPrevia = formulario.getByRole('button', { name: 'Ver prévia' })
    const painel = (c: string) =>
      page.locator('div.rounded-md.border').filter({
        hasText: `Prévia — competência ${c}`,
      })
    const linhasDe = (c: string) =>
      painel(c).locator('div.flex.justify-between.border-b')
    const lerPrevia = async (c: string) => {
      await expect(painel(c)).toBeVisible()
      const texto = (await painel(c).innerText()).replace(/\s+/g, ' ')
      const numero = (re: RegExp) => Number(re.exec(texto)?.[1] ?? Number.NaN)
      return {
        gerar: numero(/(\d+) cobrança\(s\) a gerar/),
        existentes: numero(/(\d+) já existente\(s\)/),
        isentos: numero(/(\d+) isento\(s\) a 100%/),
        cobertos: numero(/(\d+) já coberto\(s\) por título-bloco/),
        total: centavosDe(
          /cobrança\(s\) a gerar, totalizando (-?R\$ [\d.]+,\d{2})/.exec(
            texto,
          )?.[1] ?? '',
        ),
      }
    }

    // recusa 1: vazia e fora do formato (a tela barra, nem chega ao servidor)
    await verPrevia.click()
    await expect(
      formulario
        .getByRole('alert')
        .filter({ hasText: 'Use o formato AAAA-MM.' }),
    ).toHaveCount(1)
    await competencia.fill('2026/10')
    await verPrevia.click()
    await expect(
      formulario
        .getByRole('alert')
        .filter({ hasText: 'Use o formato AAAA-MM.' }),
    ).toHaveCount(1)
    await ver(page, info, 'competencia fora do formato: recusada')

    // recusa 2: mês 13 (passa no formato, o servidor recusa)
    await competencia.fill('2027-13')
    const mesImpossivel = await disparar(
      page,
      chamada('POST', '/api/contribuicoes/gerar-cobrancas/'),
      () => verPrevia.click(),
    )
    expect(mesImpossivel.status, resumo(mesImpossivel)).toBe(400)
    await expect(
      formulario
        .getByRole('alert')
        .filter({ hasText: 'Competência inválida - use o formato AAAA-MM.' }),
    ).toHaveCount(1)
    await ver(page, info, 'competencia 2027-13: recusada pelo servidor')

    // recusa 3: competência anterior à vigência do plano recém-criado (o plano só tem valor a partir de hoje)
    await competencia.fill('1999-01')
    const antiga = await disparar(
      page,
      chamada('POST', '/api/contribuicoes/gerar-cobrancas/'),
      () => verPrevia.click(),
    )
    expect(antiga.status, resumo(antiga)).toBe(400)
    await expect(
      formulario.getByRole('alert').filter({
        hasText:
          /Plano de contribuição #\d+ não tem valor vigente cadastrado para 1999-01-01\./,
      }),
    ).toHaveCount(1)
    await ver(page, info, 'competencia anterior a vigencia do plano: recusada')

    // prévia da competência C1 (antes do reajuste): nada é gravado
    await competencia.fill(C1)
    const previaDeC1 = await disparar(
      page,
      chamada('POST', '/api/contribuicoes/gerar-cobrancas/'),
      () => verPrevia.click(),
    )
    exigirOk(previaDeC1, `a prévia de ${C1}`)
    expect(dadosDe<{ confirmado: boolean }>(previaDeC1).confirmado).toBe(false)
    const previa = await lerPrevia(C1)
    expect(
      previa.gerar,
      'a prévia tem de ter cobranças a gerar',
    ).toBeGreaterThan(0)
    await expect(linhasDe(C1)).toHaveCount(previa.gerar)
    let soma = 0
    for (const texto of await linhasDe(C1).allInnerTexts()) {
      soma += centavosDe(texto)
    }
    expect(soma, 'a soma das linhas é o total mostrado, ao centavo').toBe(
      previa.total,
    )
    const minhas = linhasDe(C1).filter({ hasText: PLANO })
    const doIsento = minhas.filter({ hasText: a.isento.nome })
    await expect(doIsento).toHaveCount(1)
    await expect(doIsento).toContainText(reais(ISENTO_40))
    for (const quem of [a.bloco, a.pagador, a.sondado]) {
      const linha = minhas.filter({ hasText: quem.nome })
      await expect(linha).toHaveCount(1)
      await expect(linha).toContainText(reais(BASE))
    }
    // o isento de 100% não é cobrado
    await expect(minhas.filter({ hasText: a.devedor.nome })).toHaveCount(0)
    expect(previa.isentos).toBeGreaterThanOrEqual(1)
    const quantasDoPlano = await minhas.count()
    await ver(page, info, `previa de ${C1}: linhas, isento e total ao centavo`)

    // segunda aba, aberta ANTES de confirmar (guarda a mesma prévia)
    const outra = await page.context().newPage()
    const vigiaOutra = vigiar(outra)
    await outra.goto('/financeiro/gerar-cobrancas')
    await campo(outra, 'Competência (AAAA-MM)').fill(C1)
    await outra.getByRole('button', { name: 'Ver prévia' }).click()
    const confirmarOutra = outra.getByRole('button', {
      name: /^Confirmar geração de \d+ cobrança\(s\)$/,
    })
    await expect(confirmarOutra).toBeVisible()

    // confirmar na primeira aba: gera
    const confirmar = painel(C1).getByRole('button', {
      name: `Confirmar geração de ${previa.gerar} cobrança(s)`,
    })
    const geradas = await disparar(
      page,
      chamada('POST', '/api/contribuicoes/gerar-cobrancas/'),
      () => confirmar.click(),
    )
    exigirOk(geradas, `confirmar a geração de ${C1}`)
    const corpoGerado = dadosDe<{
      confirmado: boolean
      total_gerados: number
      valor_total: number
    }>(geradas)
    expect(corpoGerado.confirmado).toBe(true)
    expect(corpoGerado.total_gerados).toBe(previa.gerar)
    expect(Math.round(corpoGerado.valor_total * 100)).toBe(previa.total)
    const confirmado = page.locator('div.rounded-md.border').filter({
      hasText: `cobrança(s) geradas para a competência ${C1}.`,
    })
    await expect(confirmado).toContainText(
      `${previa.gerar} cobrança(s) geradas para a competência ${C1}.`,
    )
    await expect(confirmado).toContainText(
      `Valor total: ${reais(previa.total)}`,
    )
    await ver(page, info, `cobrancas de ${C1} geradas`)

    // repetir na mesma aba: a nova prévia não tem mais nada a gerar e diz quantas já existem
    await verPrevia.click()
    await expect(painel(C1)).toContainText('0 cobrança(s) a gerar')
    const segunda = await lerPrevia(C1)
    expect(segunda.gerar).toBe(0)
    expect(segunda.total).toBe(0)
    expect(segunda.existentes).toBeGreaterThanOrEqual(previa.gerar)
    await expect(
      painel(C1).getByRole('button', { name: /^Confirmar geração/ }),
    ).toHaveCount(0)
    await ver(page, info, `segunda previa de ${C1}: 0 a gerar, ja existentes`)

    // repetir da aba antiga (que ainda mostra "N a gerar"): o servidor não duplica
    const repetida = await disparar(
      outra,
      chamada('POST', '/api/contribuicoes/gerar-cobrancas/'),
      () => confirmarOutra.click(),
    )
    exigirOk(repetida, `repetir a geração de ${C1} de uma aba antiga`)
    expect(dadosDe<{ total_gerados: number }>(repetida).total_gerados).toBe(0)
    await expect(
      outra
        .locator('div.rounded-md.border')
        .filter({ hasText: `0 cobrança(s) geradas para a competência ${C1}.` }),
    ).toBeVisible()
    await expect(outra.getByText('Valor total: R$ 0,00')).toBeVisible()
    await ver(outra, info, 'repetir de uma aba antiga: 0 geradas, nada duplica')
    expect(vigiaOutra.problemas()).toEqual([])
    await outra.close()

    // o que ficou nos Títulos: uma cobrança por associado do plano, com o valor certo e o vencimento do dia 15
    await page.goto('/financeiro/titulos')
    const dosPlano = cartaoDeTitulo(page, `${PLANO} — competência ${C1}`)
    await expect(dosPlano).toHaveCount(quantasDoPlano)
    const doIsentoNosTitulos = dosPlano.filter({ hasText: a.isento.nome })
    await expect(doIsentoNosTitulos).toHaveCount(1)
    await expect(doIsentoNosTitulos).toContainText(
      `Original ${reais(ISENTO_40)} · Saldo ${reais(ISENTO_40)}`,
    )
    await expect(doIsentoNosTitulos).toContainText(
      `Vencimento ${brDaCompetencia(C1, 15)}`,
    )
    await expect(doIsentoNosTitulos).toContainText('Pendente')
    await expect(doIsentoNosTitulos).toContainText(CONTA_RECEITA)
    await verNaTela(
      page,
      info,
      'titulo do isento: R$ 74,07',
      doIsentoNosTitulos,
    )
    const doBloco = dosPlano.filter({ hasText: a.bloco.nome })
    await expect(doBloco).toHaveCount(1)
    await expect(doBloco).toContainText(
      `Original ${reais(BASE)} · Saldo ${reais(BASE)}`,
    )
    await expect(dosPlano.filter({ hasText: a.devedor.nome })).toHaveCount(0)
    expect(vigia.problemas()).toEqual([])
  })

  test('cobrança em bloco com desconto: recusas (campos, mês fora do gatilho, campanha inativa, bloco repetido) e o bloco de 6 meses a R$ 810,00', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'presidente')
    await page.goto('/financeiro/gerar-cobrancas')
    await expect(
      page.getByRole('heading', { name: 'Gerar Cobranças', level: 1 }),
    ).toBeVisible()
    const form = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Gerar cobrança em bloco' }),
    })
    const gerar = form.getByRole('button', { name: 'Gerar cobrança em bloco' })
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })
    const mes = form.getByPlaceholder(/^Mês-gatilho/)
    const escolherAssociadoEPlano = async () => {
      await escolher(seletorCom(form, 'Selecione o associado…'), a.bloco.nome)
      await escolher(seletorCom(form, 'Selecione o plano…'), PLANO)
    }
    const tentarGerar = (competencia: string) =>
      mes
        .fill(competencia)
        .then(() =>
          disparar(
            page,
            chamada('POST', '/api/titulos/gerar-cobranca-bloco'),
            () => gerar.click(),
          ),
        )

    // recusa 1: nada preenchido
    await gerar.click()
    await expect(alerta('Selecione o associado.')).toHaveCount(1)
    await expect(alerta('Selecione o plano.')).toHaveCount(1)
    await expect(alerta('Use o formato AAAA-MM.')).toHaveCount(1)
    await ver(page, info, 'bloco vazio: recusado')

    // recusa 2: um mês que não é gatilho da campanha
    await escolherAssociadoEPlano()
    const foraDoGatilho = await tentarGerar(somarMeses(CB, 1))
    expect(foraDoGatilho.status, resumo(foraDoGatilho)).toBe(400)
    await expect(
      form.getByRole('alert').filter({
        hasText: /não é um mês-gatilho desta campanha/,
      }),
    ).toHaveCount(1)
    await ver(page, info, 'bloco em mes que nao e gatilho: recusado')

    // recusa 3: campanha inativa (o painel de planos inativa e reativa)
    const cartaoDaCampanha = async () => {
      await page.goto('/financeiro/planos-contribuicao')
      return page
        .locator('div.rounded-md.border')
        .filter({ hasText: MOTIVO_CAMPANHA })
    }
    let cartao = await cartaoDaCampanha()
    await cartao.getByRole('button', { name: 'Inativar', exact: true }).click()
    await expect(cartao).toContainText('Vigente (inativa)')
    await page.goto('/financeiro/gerar-cobrancas')
    await escolherAssociadoEPlano()
    const inativa = await tentarGerar(CB)
    expect(inativa.status, resumo(inativa)).toBe(400)
    await expect(
      form.getByRole('alert').filter({
        hasText:
          'Nenhuma campanha de desconto por pagamento antecipado vigente nesta data.',
      }),
    ).toHaveCount(1)
    await ver(page, info, 'bloco com a campanha inativa: recusado')
    cartao = await cartaoDaCampanha()
    await cartao.getByRole('button', { name: 'Reativar', exact: true }).click()
    await expect(cartao.getByText('Vigente', { exact: true })).toBeVisible()

    // certo: bloco de 6 meses com 10%: 6 x R$ 150,00 x 0,90 = R$ 810,00
    await page.goto('/financeiro/gerar-cobrancas')
    await escolherAssociadoEPlano()
    const r = await tentarGerar(CB)
    exigirOk(r, 'gerar o título-bloco')
    const corpo = dadosDe<{
      id_titulo: number
      competencia: string
      competencia_fim: string
      valor_original: number
    }>(r)
    idBloco = corpo.id_titulo
    expect(corpo.competencia).toBe(CB)
    expect(corpo.competencia_fim).toBe(CF)
    expect(Math.round(corpo.valor_original * 100)).toBe(BLOCO)
    await expect(
      form.getByText(
        `Título-bloco #${idBloco} gerado (${CB} a ${CF}) — ${reais(BLOCO)}.`,
      ),
    ).toBeVisible()
    await ver(page, info, 'bloco de 6 meses gerado: R$ 810,00')

    // recusa 4: de novo o mesmo bloco (já existe título cobrindo esses meses)
    const repetido = await tentarGerar(CB)
    expect(repetido.status, resumo(repetido)).toBe(400)
    await expect(
      form.getByRole('alert').filter({
        hasText: new RegExp(
          `Já existe título \\(#${idBloco}\\) cobrindo algum mês entre ${CB} e ${CF} para este associado/plano\\.`,
        ),
      }),
    ).toHaveCount(1)
    await ver(page, info, 'bloco repetido: recusado, ja existe titulo cobrindo')

    // o título-bloco nos Títulos: a conta é a de receita diferida (Passivo), não a Receita do plano
    await page.goto('/financeiro/titulos')
    const noTitulos = cartaoDeTitulo(
      page,
      new RegExp(
        `^A Receber — ${escapar(PLANO)} — bloco de 6 meses \\(${CB} a ${CF}\\)`,
      ),
    )
    await expect(noTitulos).toHaveCount(1)
    await expect(noTitulos).toContainText(a.passivo.descricao)
    await expect(noTitulos).toContainText(a.bloco.nome)
    await expect(noTitulos).toContainText(
      `Original ${reais(BLOCO)} · Saldo ${reais(BLOCO)}`,
    )
    await expect(noTitulos).toContainText(
      `Vencimento ${brDaCompetencia(CB, 15)}`,
    )
    await verNaTela(
      page,
      info,
      'titulo-bloco nos Titulos: receita diferida',
      noTitulos,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('baixa do bloco leva o valor à receita diferida; a geração do mês seguinte pula quem está coberto pelo bloco e reconhece a fatia de R$ 135,00', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'tesoureiro')

    // 1. baixa total do bloco
    await page.goto('/financeiro/titulos')
    const noTitulos = cartaoDeTitulo(
      page,
      new RegExp(
        `^A Receber — ${escapar(PLANO)} — bloco de 6 meses \\(${CB} a ${CF}\\)`,
      ),
    )
    await expect(noTitulos).toHaveCount(1)
    const baixa = await baixarPelaTela(
      page,
      noTitulos,
      { centavos: BLOCO, forma: 'Pix', contrapartida: a.ativo.descricao },
      'a baixa do título-bloco',
    )
    lancamentoDoBloco = baixa.id_lancamento
    expect(Math.round(baixa.saldo_restante * 100)).toBe(0)
    await expect(noTitulos).toContainText('Pago')
    await expect(noTitulos).toContainText(`Saldo ${reais(0)}`)
    await expect(
      noTitulos.getByRole('button', { name: 'Baixar', exact: true }),
    ).toHaveCount(0)
    await verNaTela(page, info, 'bloco pago: saldo zero', noTitulos)

    // o razão: débito no banco e CRÉDITO NA RECEITA DIFERIDA (Passivo), não na receita do plano
    await page.goto('/financeiro/razao-contabil')
    await expect(
      page.getByRole('heading', { name: 'Razão Contábil', level: 1 }),
    ).toBeVisible()
    const noRazao = cartaoDoLancamento(
      page,
      `#${baixa.numero_sequencial} — Baixa do título #${idBloco} —`,
    )
    await expect(noRazao).toHaveCount(1)
    await expect(noRazao).toContainText(
      `Debito ${a.ativo.descricao} ${reais(BLOCO)}`,
    )
    await expect(noRazao).toContainText(
      `Credito ${a.passivo.descricao} ${reais(BLOCO)}`,
    )
    await expect(noRazao).not.toContainText(`Credito ${CONTA_RECEITA}`)
    await verNaTela(
      page,
      info,
      'razao da baixa do bloco: credito na receita diferida',
      noRazao,
    )

    // 2. a geração mensal da competência do bloco
    await page.goto('/financeiro/gerar-cobrancas')
    const formulario = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Ver prévia' }),
    })
    await campo(page, 'Competência (AAAA-MM)').fill(CB)
    await formulario.getByRole('button', { name: 'Ver prévia' }).click()
    const painel = page.locator('div.rounded-md.border').filter({
      hasText: `Prévia — competência ${CB}`,
    })
    await expect(painel).toBeVisible()
    const texto = (await painel.innerText()).replace(/\s+/g, ' ')
    const cobertos = Number(
      /(\d+) já coberto\(s\) por título-bloco/.exec(texto)?.[1] ?? Number.NaN,
    )
    // no primeiro mês do bloco o próprio título-bloco já é "existente" para a competência; nos seguintes, "coberto": das duas formas quem
    // pagou o bloco não é cobrado de novo
    const existentes = Number(
      /(\d+) já existente\(s\)/.exec(texto)?.[1] ?? Number.NaN,
    )
    expect(
      cobertos + existentes,
      'quem pagou o bloco é pulado na geração mensal',
    ).toBeGreaterThanOrEqual(1)
    const linhas = painel
      .locator('div.flex.justify-between.border-b')
      .filter({ hasText: PLANO })
    await expect(linhas.filter({ hasText: a.bloco.nome })).toHaveCount(0)
    await expect(linhas.filter({ hasText: a.devedor.nome })).toHaveCount(0)
    const doIsento = linhas.filter({ hasText: a.isento.nome })
    await expect(doIsento).toHaveCount(1)
    await expect(doIsento).toContainText(reais(ISENTO_40_REAJUSTADO))
    const doPagador = linhas.filter({ hasText: a.pagador.nome })
    await expect(doPagador).toHaveCount(1)
    await expect(doPagador).toContainText(reais(REAJUSTADO))
    await ver(
      page,
      info,
      `previa de ${CB}: valor reajustado e coberto pelo bloco`,
    )

    const confirmar = painel.getByRole('button', {
      name: /^Confirmar geração de \d+ cobrança\(s\)$/,
    })
    const r = await disparar(
      page,
      chamada('POST', '/api/contribuicoes/gerar-cobrancas/'),
      () => confirmar.click(),
    )
    exigirOk(r, `confirmar a geração de ${CB}`)
    const gerada = dadosDe<{
      total_gerados: number
      reconhecimentos_receita_diferida: {
        id_titulo: number
        competencia: string
        valor: number
        id_lancamento: number
      }[]
    }>(r)
    const reconhecimento = gerada.reconhecimentos_receita_diferida.find(
      (x) => x.id_titulo === idBloco,
    )
    expect(
      reconhecimento,
      `o bloco #${idBloco} (pago) tem de ter a fatia de ${CB} reconhecida`,
    ).toBeDefined()
    expect(reconhecimento?.competencia).toBe(CB)
    expect(Math.round((reconhecimento?.valor ?? 0) * 100)).toBe(FATIA)
    await expect(
      page.getByText(
        /\d+ reconhecimento\(s\) de receita diferida \(título-bloco pago\), totalizando R\$ [\d.]+,\d{2}/,
      ),
    ).toBeVisible()
    await ver(
      page,
      info,
      `cobrancas de ${CB} geradas e fatia do bloco reconhecida`,
    )

    // o razão: a fatia sai do Passivo e entra na Receita do plano, sem mexer em caixa
    await page.goto('/financeiro/razao-contabil')
    const fatia = cartaoDoLancamento(
      page,
      `Reconhecimento de receita diferida — título-bloco #${idBloco}, competência ${CB}`,
    )
    await expect(fatia).toHaveCount(1)
    await expect(fatia).toContainText(
      `Debito ${a.passivo.descricao} ${reais(FATIA)}`,
    )
    await expect(fatia).toContainText(
      `Credito ${CONTA_RECEITA} ${reais(FATIA)}`,
    )
    await expect(fatia).not.toContainText(a.ativo.descricao)
    await verNaTela(
      page,
      info,
      'razao: fatia de R$ 135,00 reconhecida como receita',
      fatia,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('a Auditoria mostra cada passo da receita (plano, reajuste, campanha, isenções, lote, bloco, baixa); a apresentação das isenções é conferida por último', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'presidente')
    await exigirAuditoria(page, info, {
      tabela: 'planos_contribuicao',
      acao: 'CREATE',
      registro: idPlano,
      quem: TESOUREIRO,
      nome: 'auditoria: plano de contribuicao criado pelo Tesoureiro',
    })
    await exigirAuditoria(page, info, {
      tabela: 'valores_plano_contribuicao',
      acao: 'REAJUSTE',
      registro: idPlano,
      quem: TESOUREIRO,
      nome: 'auditoria: reajuste do plano',
    })
    await exigirAuditoria(page, info, {
      tabela: 'campanhas_desconto_antecipado',
      acao: 'CREATE',
      registro: idCampanha,
      quem: TESOUREIRO,
      nome: 'auditoria: campanha de desconto cadastrada',
    })
    await expect(
      linhaDaAuditoria(page, 'UPDATE', { registro: idCampanha }),
      'inativar e reativar a campanha deixam rastro',
    ).toBeVisible()
    await exigirAuditoria(page, info, {
      tabela: 'isencoes_contribuicao',
      acao: 'CREATE',
      registro: idIsencaoParcial,
      quem: PRESIDENTE,
      nome: 'auditoria: isencao de 40%',
    })
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idIsencaoTotal,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await exigirAuditoria(page, info, {
      tabela: 'titulos_financeiros',
      acao: 'GERACAO_COBRANCAS_LOTE',
      quem: TESOUREIRO,
      nome: 'auditoria: geracao em lote pelo Tesoureiro',
    })
    await expect(
      linhaDaAuditoria(page, 'GERACAO_COBRANCA_BLOCO', {
        registro: idBloco,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: titulo-bloco gerado pelo Presidente')
    await exigirAuditoria(page, info, {
      tabela: 'lancamentos_contabeis',
      acao: 'BAIXA_TITULO',
      registro: lancamentoDoBloco,
      quem: TESOUREIRO,
      nome: 'auditoria: baixa do bloco pelo Tesoureiro',
    })

    // por último (achado provável de apresentação): a isenção mostra o motivo pelo nome, não pelo código técnico
    await page.goto('/financeiro/planos-contribuicao')
    const isencao = page.locator('div.rounded-md.border').filter({
      hasText: new RegExp(`Associado #${a.isento.id} — 40% de desconto`),
    })
    await expect(isencao).toHaveCount(1)
    await expect
      .soft(
        isencao,
        'a lista de isenções mostra o código "DIFICULDADE_FINANCEIRA" em vez do nome do motivo (painel/src/pages/PlanosContribuicao.tsx:313-320 grava o código e :622 o imprime)',
      )
      .not.toContainText('DIFICULDADE_FINANCEIRA')
    await expect
      .soft(
        isencao,
        'a lista de isenções diz "Associado #N" em vez do nome (PlanosContribuicao.tsx:618)',
      )
      .toContainText(a.isento.nome)
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// C. TÍTULOS E BAIXA, PAGAMENTO A MAIOR E CRÉDITO, NEGOCIAÇÃO DE DÍVIDA (inadimplência como processo)
//    Valores sem arredondamento fácil: R$ 1.234,56 baixado em R$ 500,25 + R$ 734,31; R$ 249,90 pago com R$ 300,00 (crédito de R$ 50,10); R$ 40,00 quitado
//    com esse crédito (sobra R$ 10,10); dívida de R$ 100,00 + R$ 50,50 em 3 parcelas de R$ 50,17, R$ 50,17 e R$ 50,16.
// =====================================================================================================================================
test.describe('C. Títulos, baixa, pagamento a maior, crédito e negociação de dívida', () => {
  test.describe.configure({ mode: 'serial' })

  const D = {
    t1: `Contribuição avulsa um ${ETIQUETA}`,
    t2: `Contribuição avulsa dois ${ETIQUETA}`,
    t3: `Contribuição avulsa tres ${ETIQUETA}`,
    t4: `Atraso um ${ETIQUETA}`,
    t5: `Atraso dois ${ETIQUETA}`,
  }
  const V = {
    t1: 123456,
    t1Parcial: 50025,
    t1Resto: 73431,
    t2: 24990,
    t2Pago: 30000,
    t2Excesso: 5010,
    t3: 4000,
    t4: 10000,
    t5: 5050,
  }
  const id = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 }
  const lancamento = {
    t1Parcial: { id: 0, numero: 0 },
    t1Resto: { id: 0, numero: 0 },
    t2: { id: 0, numero: 0 },
  }
  let idNegociacao = 0
  let avisoDaBaixaMaior = ''
  let auditoriaDosCreditosAntes = 0

  test('lançar títulos pela tela: campos vazios e conta do tipo errado são recusados; o devedor com título vencido há mais de 30 dias vira Inadimplente', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    const a = await garantirApoio(page)
    await entrarNoFinanceiro(page, 'presidente')
    auditoriaDosCreditosAntes = await abrirAuditoria(page, 'creditos_associado')
    await page.goto('/financeiro/titulos')
    await expect(
      page.getByRole('heading', { name: 'Títulos', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Novo título', exact: true }).click()
    const formulario = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Registrar título' }),
    })
    await expect(formulario.getByPlaceholder('Valor original')).toBeVisible()
    const alerta = (texto: string) =>
      formulario.getByRole('alert').filter({ hasText: texto })

    // recusa 1: nada preenchido
    await formulario.getByRole('button', { name: 'Registrar título' }).click()
    for (const texto of [
      'Selecione a conta contábil.',
      'Informe a descrição.',
      'Informe um valor maior que zero.',
      'Informe a data de vencimento.',
    ]) {
      await expect(alerta(texto)).toHaveCount(1)
    }
    await verNaTela(page, info, 'titulo vazio: recusado')

    // recusa 2: "A Receber" numa conta de Despesa (o servidor exige conta de Receita)
    await seletorCom(formulario, 'A Receber').selectOption('A Receber')
    await escolher(
      seletorCom(formulario, 'Selecione a conta contábil…'),
      `${CONTA_DESPESA} (Despesa)`,
    )
    await formulario
      .getByPlaceholder('Descrição', { exact: true })
      .fill(`${D.t1} (recusado)`)
    await formulario.getByPlaceholder('Valor original').fill(paraCampo(V.t1))
    await formulario.locator('input[type="date"]').fill(diaEmBelem(10).iso)
    const recusado = await disparar(page, chamada('POST', '/titulos/'), () =>
      formulario.getByRole('button', { name: 'Registrar título' }).click(),
    )
    expect(recusado.status, resumo(recusado)).toBe(400)
    await expect(
      alerta(
        "A conta contábil de um título precisa ser uma conta do tipo Receita (esta é 'Despesa').",
      ),
    ).toHaveCount(1)
    await expect(cartaoDeTitulo(page, `${D.t1} (recusado)`)).toHaveCount(0)
    await verNaTela(
      page,
      info,
      'titulo A Receber em conta de Despesa: recusado',
    )

    // os cinco títulos de verdade
    id.t1 = await criarTituloPelaTela(page, {
      tipo: 'A Receber',
      conta: `${CONTA_RECEITA} (Receita)`,
      descricao: D.t1,
      centavos: V.t1,
      vencimentoIso: diaEmBelem(10).iso,
      associado: a.pagador.nome,
    })
    const cartaoT1 = cartaoDeTitulo(page, D.t1)
    await expect(cartaoT1).toContainText(
      `Original ${reais(V.t1)} · Saldo ${reais(V.t1)}`,
    )
    await expect(cartaoT1).toContainText(`Vencimento ${diaEmBelem(10).br}`)
    await expect(cartaoT1).toContainText(a.pagador.nome)
    await expect(cartaoT1).toContainText('Pendente')
    await verNaTela(page, info, 'titulo de R$ 1.234,56 lancado', cartaoT1)
    id.t2 = await criarTituloPelaTela(page, {
      tipo: 'A Receber',
      conta: `${CONTA_RECEITA} (Receita)`,
      descricao: D.t2,
      centavos: V.t2,
      vencimentoIso: diaEmBelem(10).iso,
      associado: a.pagador.nome,
    })
    id.t3 = await criarTituloPelaTela(page, {
      tipo: 'A Receber',
      conta: `${CONTA_RECEITA} (Receita)`,
      descricao: D.t3,
      centavos: V.t3,
      vencimentoIso: diaEmBelem(10).iso,
      associado: a.pagador.nome,
    })
    id.t4 = await criarTituloPelaTela(page, {
      tipo: 'A Receber',
      conta: `${CONTA_RECEITA} (Receita)`,
      descricao: D.t4,
      centavos: V.t4,
      vencimentoIso: diaEmBelem(-60).iso,
      associado: a.devedor.nome,
    })
    id.t5 = await criarTituloPelaTela(page, {
      tipo: 'A Receber',
      conta: `${CONTA_RECEITA} (Receita)`,
      descricao: D.t5,
      centavos: V.t5,
      vencimentoIso: diaEmBelem(-45).iso,
      associado: a.devedor.nome,
    })
    await expect(cartaoDeTitulo(page, D.t4)).toContainText(
      `Vencimento ${diaEmBelem(-60).br}`,
    )
    await verNaTela(
      page,
      info,
      'titulos vencidos do devedor',
      cartaoDeTitulo(page, D.t4),
    )

    // inadimplência: o título vencido há mais de 30 dias muda a situação do devedor; o pagador (títulos a vencer) continua em dia
    await page.goto('/associados')
    await page.getByLabel('Filtrar').fill(a.devedor.nome)
    const linhaDoDevedor = page
      .getByRole('row')
      .filter({ hasText: a.devedor.nome })
    await expect(linhaDoDevedor).toContainText('Ativo - Inadimplente')
    await ver(page, info, 'devedor com titulo vencido: Ativo - Inadimplente')
    await page.getByLabel('Filtrar').fill(a.pagador.nome)
    await expect(
      page.getByRole('row').filter({ hasText: a.pagador.nome }),
    ).toContainText('Ativo - Em Dia')
    expect(vigia.problemas()).toEqual([])
  })

  test('baixa: recusas (vazia, valor zero ou negativo, acima do saldo sem a conta de adiantamento), contas oferecidas só do tipo certo, baixa parcial, baixa do resto e filtros', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/titulos')
    const cartaoT1 = cartaoDeTitulo(page, D.t1)
    await expect(cartaoT1).toBeVisible()

    // recusa 1: nada preenchido (a tela barra)
    const form = await abrirBaixa(cartaoT1)
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })
    await form.getByRole('button', { name: 'Confirmar baixa' }).click()
    for (const texto of [
      'Informe um valor maior que zero.',
      'Informe a forma de pagamento.',
      'Selecione a conta de contrapartida.',
    ]) {
      await expect(alerta(texto)).toHaveCount(1)
    }
    await verNaTela(page, info, 'baixa vazia: recusada', cartaoT1)

    // recusa 2 e 3: valor zero e negativo
    await form.getByPlaceholder('Valor pago').fill('0')
    await form.getByRole('button', { name: 'Confirmar baixa' }).click()
    await expect(alerta('Informe um valor maior que zero.')).toHaveCount(1)
    await form.getByPlaceholder('Valor pago').fill('-5')
    await form.getByRole('button', { name: 'Confirmar baixa' }).click()
    await expect(alerta('Informe um valor maior que zero.')).toHaveCount(1)

    // a contrapartida só pode ser conta de Ativo: a tela não oferece conta de Receita nem de Despesa
    const contrapartida = seletorCom(
      form,
      'Conta de contrapartida (Caixa/Banco)…',
    )
    await expect(
      contrapartida.locator('option', { hasText: a.ativo.descricao }),
    ).toHaveCount(1)
    for (const naoOferecida of [
      CONTA_RECEITA,
      CONTA_DESPESA,
      a.passivo.descricao,
    ]) {
      await expect(
        contrapartida.locator('option', { hasText: naoOferecida }),
      ).toHaveCount(0)
    }

    // recusa 4: um centavo acima do saldo, sem a conta de adiantamento. A tela avisa e o servidor recusa.
    await preencherBaixa(form, {
      centavos: V.t1 + 1,
      forma: 'Pix',
      contrapartida: a.ativo.descricao,
    })
    await preencherOpcionaisDaBaixa(form, {
      centavos: V.t1 + 1,
      forma: 'Pix',
      contrapartida: a.ativo.descricao,
    })
    const aviso = form.getByText(/Valor pago maior que o saldo devedor \(/)
    await expect(aviso).toBeVisible()
    avisoDaBaixaMaior = (await aviso.innerText()).replace(/\s+/g, ' ')
    const adiantamento = seletorCom(
      form,
      'Conta de adiantamento de associados…',
    )
    await expect(
      adiantamento.locator('option', { hasText: a.passivo.descricao }),
    ).toHaveCount(1)
    for (const naoOferecida of [
      CONTA_RECEITA,
      CONTA_CAIXA_SEMEADA,
      a.ativo.descricao,
    ]) {
      await expect(
        adiantamento.locator('option', { hasText: naoOferecida }),
      ).toHaveCount(0)
    }
    const acima = await enviarBaixa(page, form)
    expect(acima.status, resumo(acima)).toBe(400)
    await expect(
      form.getByRole('alert').filter({
        hasText:
          /Valor pago maior que o saldo devedor \(R\$ 1\.?234[.,]56\) - .*adiantamento/,
      }),
    ).toHaveCount(1)
    await expect(cartaoT1).toContainText(`Saldo ${reais(V.t1)}`)
    await verNaTela(
      page,
      info,
      'baixa acima do saldo sem adiantamento: recusada',
      cartaoT1,
    )
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(form).toHaveCount(0)

    // a recusa não deixou lançamento nenhum no razão (e a Auditoria só terá as baixas feitas de verdade)
    // baixa parcial de R$ 500,25
    const parcial = await baixarPelaTela(
      page,
      cartaoT1,
      {
        centavos: V.t1Parcial,
        forma: 'Pix',
        contrapartida: a.ativo.descricao,
      },
      'a baixa parcial',
    )
    lancamento.t1Parcial = {
      id: parcial.id_lancamento,
      numero: parcial.numero_sequencial,
    }
    expect(Math.round(parcial.saldo_restante * 100)).toBe(V.t1Resto)
    await expect(cartaoT1).toContainText(
      `Original ${reais(V.t1)} · Saldo ${reais(V.t1Resto)}`,
    )
    await expect(cartaoT1).toContainText('Pendente')
    await verNaTela(page, info, 'baixa parcial: saldo R$ 734,31', cartaoT1)

    // segunda aba parada com o título ainda pendente (para provar a recusa de baixar o que já foi pago)
    const outra = await page.context().newPage()
    const vigiaOutra = vigiar(outra)
    await outra.goto('/financeiro/titulos')
    const cartaoNaOutra = cartaoDeTitulo(outra, D.t1)
    await expect(cartaoNaOutra).toContainText(`Saldo ${reais(V.t1Resto)}`)

    // baixa do resto: o título fica Pago, sem botão de baixar
    const resto = await baixarPelaTela(
      page,
      cartaoT1,
      {
        centavos: V.t1Resto,
        forma: 'Pix',
        contrapartida: a.ativo.descricao,
      },
      'a baixa do resto',
    )
    lancamento.t1Resto = {
      id: resto.id_lancamento,
      numero: resto.numero_sequencial,
    }
    expect(Math.round(resto.saldo_restante * 100)).toBe(0)
    await expect(cartaoT1).toContainText('Pago')
    await expect(cartaoT1).toContainText(`Saldo ${reais(0)}`)
    await expect(
      cartaoT1.getByRole('button', { name: 'Baixar', exact: true }),
    ).toHaveCount(0)
    await verNaTela(
      page,
      info,
      'titulo pago: saldo zero e sem botao de baixar',
      cartaoT1,
    )

    // a aba antiga ainda oferece "Baixar": o servidor recusa baixar de novo o que já está pago
    const formOutra = await abrirBaixa(cartaoNaOutra)
    const dadosDaOutra: DadosBaixa = {
      centavos: V.t1Resto,
      forma: 'Pix',
      contrapartida: a.ativo.descricao,
    }
    await preencherBaixa(formOutra, dadosDaOutra)
    await preencherOpcionaisDaBaixa(formOutra, dadosDaOutra)
    const jaPago = await enviarBaixa(outra, formOutra)
    expect(jaPago.status, resumo(jaPago)).toBe(400)
    await expect(
      formOutra
        .getByRole('alert')
        .filter({ hasText: 'Este título já está totalmente pago.' }),
    ).toHaveCount(1)
    await verNaTela(outra, info, 'outra aba: baixar titulo ja pago e recusado')
    expect(vigiaOutra.problemas()).toEqual([])
    await outra.close()

    // as duas baixas, no razão, com os valores certos ao centavo; só elas (a recusa não gerou nada)
    await page.goto('/financeiro/razao-contabil')
    await expect(
      page.getByRole('heading', { name: 'Razão Contábil', level: 1 }),
    ).toBeVisible()
    await expect(
      cartaoDoLancamento(page, `Baixa do título #${id.t1} —`),
    ).toHaveCount(2)
    const razaoParcial = cartaoDoLancamento(
      page,
      `#${lancamento.t1Parcial.numero} — Baixa do título #${id.t1} —`,
    )
    await expect(razaoParcial).toContainText(
      `Debito ${a.ativo.descricao} ${reais(V.t1Parcial)}`,
    )
    await expect(razaoParcial).toContainText(
      `Credito ${CONTA_RECEITA} ${reais(V.t1Parcial)}`,
    )
    await expect(razaoParcial).toContainText('BAIXA_TITULO · Pix')
    await verNaTela(
      page,
      info,
      'razao da baixa parcial: R$ 500,25',
      razaoParcial,
    )
    const razaoResto = cartaoDoLancamento(
      page,
      `#${lancamento.t1Resto.numero} — Baixa do título #${id.t1} —`,
    )
    await expect(razaoResto).toContainText(
      `Debito ${a.ativo.descricao} ${reais(V.t1Resto)}`,
    )
    await expect(razaoResto).toContainText(
      `Credito ${CONTA_RECEITA} ${reais(V.t1Resto)}`,
    )
    await verNaTela(
      page,
      info,
      'razao da baixa do resto: R$ 734,31',
      razaoResto,
    )

    // os filtros da tela de Títulos: Pago x Pendente, A Receber x A Pagar
    await page.goto('/financeiro/titulos')
    const porStatus = seletorCom(corpoDaPagina(page), 'Todos os status')
    const porTipo = seletorCom(corpoDaPagina(page), 'Todos os tipos')
    await porStatus.selectOption('Pago')
    await expect(cartaoDeTitulo(page, D.t1)).toBeVisible()
    await expect(cartaoDeTitulo(page, D.t3)).toHaveCount(0)
    await porStatus.selectOption('Pendente')
    await expect(cartaoDeTitulo(page, D.t3)).toBeVisible()
    await expect(cartaoDeTitulo(page, D.t1)).toHaveCount(0)
    await porStatus.selectOption('')
    await porTipo.selectOption('A Pagar')
    await expect(cartaoDeTitulo(page, D.t3)).toHaveCount(0)
    await porTipo.selectOption('A Receber')
    await expect(cartaoDeTitulo(page, D.t3)).toBeVisible()
    await verNaTela(
      page,
      info,
      'filtros de Titulos: A Receber',
      cartaoDeTitulo(page, D.t3),
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('pagamento a maior: o excedente vira crédito do associado (partida no passivo); o crédito quita parte de outro título do mesmo associado', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/titulos')
    const cartaoT2 = cartaoDeTitulo(page, D.t2)
    const cartaoT3 = cartaoDeTitulo(page, D.t3)
    await expect(cartaoT3).toBeVisible()

    // antes do pagamento a maior, o pagador não tem crédito nenhum
    await cartaoT3
      .getByRole('button', { name: 'Aplicar crédito', exact: true })
      .click()
    await expect(
      cartaoT3.getByText('Este associado não tem crédito disponível.'),
    ).toBeVisible()
    await verNaTela(
      page,
      info,
      'sem credito antes do pagamento a maior',
      cartaoT3,
    )
    await cartaoT3
      .getByRole('button', { name: 'Ocultar crédito', exact: true })
      .click()

    // R$ 300,00 num título de R$ 249,90: o excedente é R$ 50,10
    const maior = await baixarPelaTela(
      page,
      cartaoT2,
      {
        centavos: V.t2Pago,
        forma: 'Pix',
        contrapartida: a.ativo.descricao,
        adiantamento: a.passivo.descricao,
      },
      'o pagamento a maior',
    )
    lancamento.t2 = { id: maior.id_lancamento, numero: maior.numero_sequencial }
    expect(Math.round(maior.saldo_restante * 100)).toBe(0)
    expect(
      maior.id_credito_gerado,
      'o excedente gera um crédito',
    ).not.toBeNull()
    await expect(cartaoT2).toContainText('Pago')
    await expect(cartaoT2).toContainText(`Saldo ${reais(0)}`)
    await verNaTela(
      page,
      info,
      'titulo de R$ 249,90 pago com R$ 300,00',
      cartaoT2,
    )

    await page.goto('/financeiro/razao-contabil')
    const razao = cartaoDoLancamento(
      page,
      `#${maior.numero_sequencial} — Baixa do título #${id.t2} —`,
    )
    await expect(razao).toHaveCount(1)
    await expect(razao).toContainText(
      `Debito ${a.ativo.descricao} ${reais(V.t2Pago)}`,
    )
    await expect(razao).toContainText(`Credito ${CONTA_RECEITA} ${reais(V.t2)}`)
    await expect(razao).toContainText(
      `Credito ${a.passivo.descricao} ${reais(V.t2Excesso)}`,
    )
    await verNaTela(
      page,
      info,
      'razao: 300,00 = 249,90 de receita + 50,10 de adiantamento',
      razao,
    )

    // o crédito de R$ 50,10 aparece no outro título do mesmo associado e quita os R$ 40,00 dele
    await page.goto('/financeiro/titulos')
    const novoT3 = cartaoDeTitulo(page, D.t3)
    await novoT3
      .getByRole('button', { name: 'Aplicar crédito', exact: true })
      .click()
    const credito = novoT3.locator('select').first()
    await expect(
      credito.locator('option', {
        hasText: `${reais(V.t2Excesso)} (Pagamento a maior do título #${id.t2} — ${D.t2}, título de origem #${id.t2})`,
      }),
    ).toHaveCount(1)
    await credito.selectOption({ index: 1 })
    await escolher(novoT3.locator('select').nth(1), a.passivo.descricao)
    await verNaTela(
      page,
      info,
      'credito de R$ 50,10 oferecido no outro titulo',
      novoT3,
    )
    const aplicado = await disparar(
      page,
      chamada('POST', '/api/creditos-associado/aplicar'),
      () =>
        novoT3
          .getByRole('button', { name: 'Aplicar crédito', exact: true })
          .click(),
    )
    exigirOk(aplicado, 'aplicar o crédito')
    const corpo = dadosDe<{
      valor_aplicado: number
      saldo_credito_restante: number
      saldo_devedor_titulo: number
    }>(aplicado)
    expect(Math.round(corpo.valor_aplicado * 100)).toBe(V.t3)
    expect(Math.round(corpo.saldo_devedor_titulo * 100)).toBe(0)
    expect(Math.round(corpo.saldo_credito_restante * 100)).toBe(
      V.t2Excesso - V.t3,
    )
    await expect(novoT3).toContainText('Pago')
    await expect(novoT3).toContainText(`Saldo ${reais(0)}`)
    await verNaTela(
      page,
      info,
      'titulo de R$ 40,00 quitado com o credito',
      novoT3,
    )

    await page.goto('/financeiro/razao-contabil')
    const aplicacao = cartaoDoLancamento(
      page,
      new RegExp(`Aplicação de crédito #\\d+ no título #${id.t3}$`),
    )
    await expect(aplicacao).toHaveCount(1)
    await expect(aplicacao).toContainText(
      `Debito ${a.passivo.descricao} ${reais(V.t3)}`,
    )
    await expect(aplicacao).toContainText(
      `Credito ${CONTA_RECEITA} ${reais(V.t3)}`,
    )
    await expect(aplicacao).not.toContainText(a.ativo.descricao)
    await verNaTela(
      page,
      info,
      'razao: o credito baixa o passivo, sem mexer em caixa',
      aplicacao,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('negociação de dívida: seleção e total ao centavo, recusas, 3 parcelas de R$ 50,17 / 50,17 / 50,16, refazer o que já foi renegociado é recusado, o devedor volta a Em Dia e a Auditoria registra tudo', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'presidente')
    await page.goto('/financeiro/negociacao-divida')
    await expect(
      page.getByRole('heading', { name: 'Negociação de Dívida', level: 1 }),
    ).toBeVisible()
    const escolherDevedor = async (p: Page) =>
      escolher(
        seletorCom(corpoDaPagina(p), 'Selecione o associado…'),
        a.devedor.nome,
      )
    const titulo = (p: Page, descricao: string) =>
      p.locator('label').filter({ hasText: descricao })
    await escolherDevedor(page)
    await expect(
      page.getByRole('heading', { name: 'Títulos vencidos' }),
    ).toBeVisible()

    // só os dois títulos vencidos do devedor (as cobranças a vencer não entram), com o valor e o dia certos
    await expect(
      page.locator('label').filter({ has: page.getByRole('checkbox') }),
    ).toHaveCount(2)
    await expect(titulo(page, D.t4)).toContainText(
      `vencido em ${diaEmBelem(-60).br} — ${reais(V.t4)}`,
    )
    await expect(titulo(page, D.t5)).toContainText(
      `vencido em ${diaEmBelem(-45).br} — ${reais(V.t5)}`,
    )

    // o total acompanha a seleção, ao centavo; sem título marcado não há formulário
    const total = page.getByText(/Valor total selecionado:/)
    await titulo(page, D.t4).getByRole('checkbox').check()
    await expect(total).toContainText(reais(V.t4))
    await titulo(page, D.t5).getByRole('checkbox').check()
    await expect(total).toContainText(reais(V.t4 + V.t5))
    await titulo(page, D.t4).getByRole('checkbox').uncheck()
    await expect(total).toContainText(reais(V.t5))
    await titulo(page, D.t5).getByRole('checkbox').uncheck()
    await expect(total).toHaveCount(0)
    await titulo(page, D.t4).getByRole('checkbox').check()
    await titulo(page, D.t5).getByRole('checkbox').check()
    await expect(total).toContainText('R$ 150,50')
    const form = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Confirmar negociação' }),
    })
    const parcelas = form.getByPlaceholder('Quantidade de parcelas')
    const termo = form.getByPlaceholder(/^Termos da negociação/)
    const confirmar = form.getByRole('button', { name: 'Confirmar negociação' })
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })

    // recusas do formulário
    await parcelas.fill('0')
    await confirmar.click()
    await expect(alerta('Mínimo 1 parcela.')).toHaveCount(1)
    await expect(
      alerta('Descreva os termos da negociação (mínimo 10 caracteres).'),
    ).toHaveCount(1)
    await parcelas.fill('61')
    await termo.fill('curto')
    await confirmar.click()
    await expect(alerta('Máximo 60 parcelas.')).toHaveCount(1)
    await expect(
      alerta('Descreva os termos da negociação (mínimo 10 caracteres).'),
    ).toHaveCount(1)
    await ver(page, info, 'negociacao com parcelas e termo invalidos: recusada')

    // segunda aba, parada com a mesma seleção (para provar a recusa de renegociar o que já foi renegociado)
    const outra = await page.context().newPage()
    const vigiaOutra = vigiar(outra)
    await outra.goto('/financeiro/negociacao-divida')
    await escolherDevedor(outra)
    await titulo(outra, D.t4).getByRole('checkbox').check()
    await titulo(outra, D.t5).getByRole('checkbox').check()
    const formOutra = outra.locator('form').filter({
      has: outra.getByRole('button', { name: 'Confirmar negociação' }),
    })
    await formOutra.getByPlaceholder('Quantidade de parcelas').fill('2')
    await formOutra
      .getByPlaceholder(/^Termos da negociação/)
      .fill(`Termo repetido do robô ${ETIQUETA}: não deve valer.`)

    // negociação de verdade
    await parcelas.fill('3')
    const termoDeVerdade = `Termo de teste do robô ${ETIQUETA}: o associado propôs 3 parcelas.`
    await termo.fill(termoDeVerdade)
    const r = await disparar(
      page,
      chamada('POST', '/api/negociacoes-divida/'),
      () => confirmar.click(),
    )
    exigirOk(r, 'confirmar a negociação')
    const negociada = dadosDe<{
      id_negociacao: number
      valor_total: number
      quantidade_parcelas: number
    }>(r)
    idNegociacao = negociada.id_negociacao
    expect(Math.round(negociada.valor_total * 100)).toBe(V.t4 + V.t5)
    expect(negociada.quantidade_parcelas).toBe(3)
    const confirmacaoApareceu = await page
      .getByText(/Negociação #\d+ confirmada/)
      .first()
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false)

    // o histórico mostra a negociação; os títulos vencidos saem da lista
    const historico = page.locator('div.rounded-md.border').filter({
      hasText: termoDeVerdade,
    })
    await expect(historico).toHaveCount(1)
    await expect(historico).toContainText(
      `${reais(V.t4 + V.t5)} em 3 parcela(s)`,
    )
    await expect(
      page.getByText('Nenhum título vencido para este associado.'),
    ).toBeVisible()
    await ver(
      page,
      info,
      'negociacao confirmada: historico e sem titulos vencidos',
    )

    // refazer da aba antiga: os títulos já estão renegociados, o servidor recusa
    const repetida = await disparar(
      outra,
      chamada('POST', '/api/negociacoes-divida/'),
      () =>
        formOutra.getByRole('button', { name: 'Confirmar negociação' }).click(),
    )
    expect(repetida.status, resumo(repetida)).toBe(400)
    await expect(
      formOutra.getByRole('alert').filter({
        hasText:
          /Título #\d+ não está pendente \(status atual: 'Renegociado'\) - só título em aberto pode ser renegociado\./,
      }),
    ).toHaveCount(1)
    await ver(
      outra,
      info,
      'outra aba: renegociar o que ja foi renegociado e recusado',
    )
    expect(vigiaOutra.problemas()).toEqual([])
    await outra.close()

    // os títulos: originais "Renegociado" (nunca editados), três parcelas novas somando o total ao centavo
    await page.goto('/financeiro/titulos')
    await expect(cartaoDeTitulo(page, D.t4)).toContainText('Renegociado')
    await expect(cartaoDeTitulo(page, D.t5)).toContainText('Renegociado')
    await expect(cartaoDeTitulo(page, D.t4)).toContainText(
      `Original ${reais(V.t4)} · Saldo ${reais(V.t4)}`,
    )
    const valorDaParcela = [5017, 5017, 5016]
    expect(valorDaParcela.reduce((s, v) => s + v, 0)).toBe(V.t4 + V.t5)
    for (const [i, valor] of valorDaParcela.entries()) {
      const parcela = cartaoDeTitulo(
        page,
        `Parcela ${i + 1}/3 da negociação de dívida #${idNegociacao}`,
      )
      await expect(parcela).toHaveCount(1)
      await expect(parcela).toContainText(
        `Original ${reais(valor)} · Saldo ${reais(valor)}`,
      )
      await expect(parcela).toContainText(a.devedor.nome)
      await expect(parcela).toContainText('Pendente')
    }
    await verNaTela(
      page,
      info,
      'parcelas da negociacao: 50,17 + 50,17 + 50,16',
      cartaoDeTitulo(
        page,
        `Parcela 3/3 da negociação de dívida #${idNegociacao}`,
      ),
    )

    // sem título vencido pendente, o devedor volta a Em Dia
    await page.goto('/associados')
    await page.getByLabel('Filtrar').fill(a.devedor.nome)
    await expect(
      page.getByRole('row').filter({ hasText: a.devedor.nome }),
    ).toContainText('Ativo - Em Dia')
    await ver(page, info, 'devedor renegociou: Ativo - Em Dia')

    // Auditoria de todo o bloco C
    await exigirAuditoria(page, info, {
      tabela: 'negociacoes_divida',
      acao: 'CREATE',
      registro: idNegociacao,
      quem: PRESIDENTE,
      nome: 'auditoria: negociacao de divida',
    })
    for (const [chave, quem] of [
      ['t1', PRESIDENTE],
      ['t2', PRESIDENTE],
      ['t3', PRESIDENTE],
      ['t4', PRESIDENTE],
      ['t5', PRESIDENTE],
    ] as const) {
      if (chave === 't1') {
        await abrirAuditoria(page, 'titulos_financeiros')
      }
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id[chave], quem }),
        `a Auditoria mostra o título ${chave} lançado`,
      ).toBeVisible()
    }
    await ver(page, info, 'auditoria: titulos lancados pelo Presidente')
    await abrirAuditoria(page, 'lancamentos_contabeis')
    for (const baixa of [
      lancamento.t1Parcial,
      lancamento.t1Resto,
      lancamento.t2,
    ]) {
      await expect(
        linhaDaAuditoria(page, 'BAIXA_TITULO', {
          registro: baixa.id,
          quem: TESOUREIRO,
        }),
      ).toBeVisible()
    }
    await ver(page, info, 'auditoria: baixas feitas pelo Tesoureiro')
    expect(
      await abrirAuditoria(page, 'creditos_associado'),
      'aplicar o crédito deixa uma linha na Auditoria',
    ).toBeGreaterThan(auditoriaDosCreditosAntes)
    await expect(
      linhaDaAuditoria(page, 'APLICACAO', { quem: TESOUREIRO }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: credito aplicado pelo Tesoureiro')
    await abrirAuditoria(page, 'associados')
    await expect(
      linhaDaAuditoria(page, 'CATEGORIA_RECALCULADA', {
        registro: a.devedor.id,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: situacao do devedor recalculada')

    // por último (achados prováveis): a confirmação da negociação, o título renegociado ainda aceitar baixa, e o aviso da baixa a maior em formato de banco de dados
    expect
      .soft(
        confirmacaoApareceu,
        'a mensagem "Negociação #N confirmada" nunca aparece: fica dentro do formulário, que some assim que a seleção é limpa (painel/src/pages/NegociacaoDivida.tsx:72, :142 e :192-198)',
      )
      .toBe(true)
    expect
      .soft(
        avisoDaBaixaMaior,
        'o aviso da baixa a maior mostra o saldo como "1234.56" (ponto, sem R$), fora do formato pt-BR do resto da tela (painel/src/pages/Titulos.tsx:358-360)',
      )
      .toContain('R$ 1.234,56')
    await page.goto('/financeiro/titulos')
    const original = cartaoDeTitulo(page, D.t4)
    await expect(original).toContainText('Renegociado')
    const oferecida =
      (await original
        .getByRole('button', { name: 'Baixar', exact: true })
        .count()) > 0
    expect
      .soft(
        oferecida,
        'a tela oferece "Baixar" num título Renegociado (a dívida já virou parcelas): Titulos.tsx:646 só esconde o botão quando o status é Pago',
      )
      .toBe(false)
    if (oferecida) {
      const formBaixa = await abrirBaixa(original)
      const dadosDaBaixa: DadosBaixa = {
        centavos: V.t4,
        forma: 'Pix',
        contrapartida: a.ativo.descricao,
      }
      await preencherBaixa(formBaixa, dadosDaBaixa)
      await preencherOpcionaisDaBaixa(formBaixa, dadosDaBaixa)
      const aceita = await enviarBaixa(page, formBaixa)
      expect
        .soft(
          aceita.ok,
          `o servidor aceitou a baixa de um título Renegociado (${resumo(aceita)}): a mesma dívida passa a ser cobrada nas parcelas e no original (app/routers/financeiro.py:588 só recusa título Pago)`,
        )
        .toBe(false)
    }
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// D. DOAÇÕES: campanha de arrecadação, doação monetária com recibo, anônima, recorrente e em bens
// =====================================================================================================================================
test.describe('D. Doações, campanha de arrecadação e recibo', () => {
  test.describe.configure({ mode: 'serial' })

  const TITULO_DA_CAMPANHA = `Campanha de teste do robô ${ETIQUETA}`
  const META = 500000
  const DOADOR = `Doador de Teste ${ETIQUETA}`
  const DOADOR_DE_BENS = `Doador de bens ${ETIQUETA}`
  const BEM = `Computador usado de teste ${ETIQUETA}`
  const DOCUMENTO = cpfValido(800000000 + (RODADA % 90000000))
  const VALOR = 8765
  const VALOR_ANONIMO = 1530
  const VALOR_DOS_BENS = 25000

  let idCampanha = 0
  const doacao = {
    monetaria: { id: 0, recibo: 0 },
    anonima: { id: 0, recibo: 0 },
    bens: { id: 0, recibo: 0 },
  }
  let textoDoRecibo = ''

  test('campanha de arrecadação: título e meta inválidos são recusados; criada, aparece Ativa com R$ 0,00 de R$ 5.000,00; encerrar e reativar', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    await garantirApoio(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/doacoes')
    await expect(
      page.getByRole('heading', { name: 'Doações', level: 1 }),
    ).toBeVisible()
    const secao = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Campanhas de arrecadação' }),
    })
    await secao
      .getByRole('button', { name: 'Nova campanha', exact: true })
      .click()
    const form = secao.locator('form')
    const criar = form.getByRole('button', { name: 'Criar campanha' })
    await expect(form.getByPlaceholder('Título da campanha')).toBeVisible()
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })

    // recusa 1: nada preenchido
    await criar.click()
    await expect(alerta('Informe o título da campanha.')).toHaveCount(1)
    await expect(alerta('Meta deve ser maior que zero.')).toHaveCount(1)
    await verNaTela(page, info, 'campanha de arrecadacao vazia: recusada', form)

    // recusa 2: título curto e meta negativa
    await form.getByPlaceholder('Título da campanha').fill('ab')
    await form.getByPlaceholder('Meta (R$)').fill('-1')
    await criar.click()
    await expect(alerta('Informe o título da campanha.')).toHaveCount(1)
    await expect(alerta('Meta deve ser maior que zero.')).toHaveCount(1)
    await verNaTela(
      page,
      info,
      'campanha com titulo curto e meta negativa: recusada',
      form,
    )
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(form).toHaveCount(0)

    idCampanha = await criarCampanhaDeArrecadacao(page, {
      titulo: TITULO_DA_CAMPANHA,
      metaCentavos: META,
    })
    const cartao = secao.locator('div.rounded-md.border').filter({
      has: page.locator('p.font-medium', { hasText: TITULO_DA_CAMPANHA }),
    })
    await expect(cartao).toHaveCount(1)
    await expect(cartao.getByText('Ativa', { exact: true })).toBeVisible()
    await expect(cartao).toContainText(`${reais(0)} de ${reais(META)} (0%)`)
    await verNaTela(
      page,
      info,
      'campanha de arrecadacao criada: R$ 0,00 de R$ 5.000,00',
      cartao,
    )

    await cartao.getByRole('button', { name: 'Encerrar', exact: true }).click()
    await expect(cartao.getByText('Encerrada', { exact: true })).toBeVisible()
    await expect(
      cartao.getByRole('button', { name: 'Reativar', exact: true }),
    ).toBeVisible()
    await verNaTela(page, info, 'campanha encerrada', cartao)
    await cartao.getByRole('button', { name: 'Reativar', exact: true }).click()
    await expect(cartao.getByText('Ativa', { exact: true })).toBeVisible()
    expect(vigia.problemas()).toEqual([])
  })

  test('doação monetária: recusas (vazia, sem nome, sem conta de caixa), o recibo numerado abre com o valor certo, e vira título pago e lançamento no razão', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/doacoes')
    await expect(
      page.getByRole('heading', { name: 'Doações', level: 1 }),
    ).toBeVisible()
    const form = await abrirFormularioDeDoacao(page)
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })

    // recusa 1: nada preenchido
    await form
      .getByRole('button', { name: 'Registrar doação', exact: true })
      .click()
    await expect(alerta('Valor deve ser maior que zero.')).toHaveCount(1)
    await expect(alerta('Selecione a conta contábil (Receita).')).toHaveCount(1)
    await verNaTela(page, info, 'doacao vazia: recusada', form)

    // as contas oferecidas: receita só de Receita, caixa só de Ativo
    const receitas = seletorCom(form, 'Conta contábil (Receita)…')
    await expect(
      receitas.locator('option', { hasText: CONTA_RECEITA }).first(),
    ).toBeAttached()
    for (const naoOferecida of [
      CONTA_DESPESA,
      CONTA_CAIXA_SEMEADA,
      a.passivo.descricao,
    ]) {
      await expect(
        receitas.locator('option', { hasText: naoOferecida }),
      ).toHaveCount(0)
    }
    const caixas = seletorCom(form, 'Conta de caixa/banco que recebeu…')
    await expect(
      caixas.locator('option', { hasText: a.ativo.descricao }),
    ).toHaveCount(1)
    for (const naoOferecida of [CONTA_RECEITA, CONTA_DESPESA]) {
      await expect(
        caixas.locator('option', { hasText: naoOferecida }),
      ).toHaveCount(0)
    }

    // recusa 2: tudo certo, mas sem nome do doador (e sem marcar anônima): o servidor recusa
    await preencherDoacao(form, {
      centavos: VALOR,
      caixa: a.ativo.descricao,
      campanha: TITULO_DA_CAMPANHA,
      comDestinacao: true,
    })
    const semNome = await disparar(page, chamada('POST', '/api/doacoes/'), () =>
      form
        .getByRole('button', { name: 'Registrar doação', exact: true })
        .click(),
    )
    expect(semNome.status, resumo(semNome)).toBe(400)
    await expect(
      alerta('Informe o nome do doador, ou marque a doação como anônima.'),
    ).toHaveCount(1)
    await verNaTela(page, info, 'doacao sem nome do doador: recusada', form)

    // recusa 3: com nome, mas sem a conta de caixa (doação monetária)
    await form.getByPlaceholder('Nome do doador').fill(DOADOR)
    await form.getByPlaceholder('CPF/CNPJ do doador (opcional)').fill(DOCUMENTO)
    await caixas.selectOption({ index: 0 })
    const semCaixa = await disparar(
      page,
      chamada('POST', '/api/doacoes/'),
      () =>
        form
          .getByRole('button', { name: 'Registrar doação', exact: true })
          .click(),
    )
    expect(semCaixa.status, resumo(semCaixa)).toBe(400)
    await expect(
      alerta(
        'Doação monetária exige a conta de caixa/banco que recebeu o valor.',
      ),
    ).toHaveCount(1)
    await expect(cartaoDeDoacaoDoDoador(page, DOADOR)).toHaveCount(0)
    await verNaTela(
      page,
      info,
      'doacao monetaria sem conta de caixa: recusada',
      form,
    )

    // certo
    await escolher(caixas, a.ativo.descricao)
    const registrada = await registrarDoacao(page, form, 'a doação monetária')
    doacao.monetaria = {
      id: registrada.id_doacao,
      recibo: registrada.numero_recibo,
    }
    const cartao = cartaoDeDoacao(page, registrada.numero_recibo)
    await expect(cartao).toHaveCount(1)
    await expect(cartao).toContainText(`${DOADOR} — ${reais(VALOR)}`)
    await expect(cartao).toContainText('Monetária')
    await verNaTela(
      page,
      info,
      'doacao registrada: recibo e valor R$ 87,65',
      cartao,
    )

    // o recibo abre: 200, com o número, o doador, o documento e o valor
    const [reciboRecebido] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'GET' &&
          new URL(r.url()).pathname ===
            `/api/doacoes/${registrada.id_doacao}/recibo`,
      ),
      cartao.getByRole('button', { name: 'Ver recibo' }).click(),
    ])
    expect(reciboRecebido.status()).toBe(200)
    const { texto } = (await reciboRecebido.json()) as { texto: string }
    textoDoRecibo = texto
    expect(texto).toContain(`RECIBO DE DOAÇÃO Nº ${registrada.numero_recibo}`)
    expect(texto).toContain(`Recebemos de ${DOADOR} (doc. ${DOCUMENTO})`)
    expect(texto).toContain('em dinheiro')
    expect(texto).toMatch(/no valor de R\$ 87[.,]65/)
    await expect(cartao.locator('pre')).toContainText(
      `RECIBO DE DOAÇÃO Nº ${registrada.numero_recibo}`,
    )
    await expect(cartao.locator('pre')).toContainText(DOADOR)
    await verNaTela(page, info, 'recibo da doacao aberto', cartao)

    // a campanha mostra o arrecadado ao centavo e o percentual
    const campanha = page
      .locator('section')
      .filter({
        has: page.getByRole('heading', { name: 'Campanhas de arrecadação' }),
      })
      .locator('div.rounded-md.border')
      .filter({
        has: page.locator('p.font-medium', { hasText: TITULO_DA_CAMPANHA }),
      })
    await expect(campanha).toContainText(
      `${reais(VALOR)} de ${reais(META)} (2%)`,
    )

    // título pago e lançamento no razão
    await page.goto('/financeiro/titulos')
    const titulo = cartaoDeTitulo(
      page,
      `Doação #${registrada.id_doacao} — recibo nº ${registrada.numero_recibo}`,
    )
    await expect(titulo).toHaveCount(1)
    await expect(titulo).toContainText('Pago')
    await expect(titulo).toContainText(
      `Original ${reais(VALOR)} · Saldo ${reais(0)}`,
    )
    await verNaTela(page, info, 'doacao virou titulo pago', titulo)
    await page.goto('/financeiro/razao-contabil')
    const razao = cartaoDoLancamento(
      page,
      new RegExp(
        `Doação #${registrada.id_doacao} — recibo nº ${registrada.numero_recibo}$`,
      ),
    )
    await expect(razao).toHaveCount(1)
    await expect(razao).toContainText(
      `Debito ${a.ativo.descricao} ${reais(VALOR)}`,
    )
    await expect(razao).toContainText(
      `Credito ${CONTA_RECEITA} ${reais(VALOR)}`,
    )
    await expect(razao).toContainText('DOACAO')
    await verNaTela(
      page,
      info,
      'razao da doacao: debito no banco, credito na receita',
      razao,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('doação anônima e recorrente (o nome digitado não vaza) e doação em bens (sem lançamento de caixa); o recibo muda conforme o tipo; numeração seguida', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const a = exigirApoio()
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/doacoes')
    await expect(
      page.getByRole('heading', { name: 'Doações', level: 1 }),
    ).toBeVisible()

    // anônima + recorrente (monetária): o nome e o documento digitados antes de marcar "anônima" não podem aparecer em lugar nenhum
    const vazado = `Nome que não pode vazar ${ETIQUETA}`
    let form = await abrirFormularioDeDoacao(page)
    await preencherDoacao(form, {
      nome: vazado,
      documento: DOCUMENTO,
      centavos: VALOR_ANONIMO,
      caixa: a.ativo.descricao,
      comDestinacao: true,
      campanha: TITULO_DA_CAMPANHA,
    })
    await form.getByLabel('Doação anônima').check()
    await expect(form.getByPlaceholder('Nome do doador')).toHaveCount(0)
    await expect(
      form.getByPlaceholder('CPF/CNPJ do doador (opcional)'),
    ).toHaveCount(0)
    await form.getByLabel('Doação recorrente').check()
    const anonima = await registrarDoacao(
      page,
      form,
      'a doação anônima recorrente',
    )
    doacao.anonima = { id: anonima.id_doacao, recibo: anonima.numero_recibo }
    const cartaoAnonimo = cartaoDeDoacao(page, anonima.numero_recibo)
    await expect(cartaoAnonimo).toHaveCount(1)
    await expect(cartaoAnonimo).toContainText(
      `Doador anônimo — ${reais(VALOR_ANONIMO)}`,
    )
    await expect(cartaoAnonimo).toContainText('Monetária · recorrente')
    await expect(page.getByText(vazado)).toHaveCount(0)
    const [reciboAnonimo] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
          `/api/doacoes/${anonima.id_doacao}/recibo`,
      ),
      cartaoAnonimo.getByRole('button', { name: 'Ver recibo' }).click(),
    ])
    expect(reciboAnonimo.status()).toBe(200)
    const { texto: textoAnonimo } = (await reciboAnonimo.json()) as {
      texto: string
    }
    expect(textoAnonimo).toContain(
      `RECIBO DE DOAÇÃO Nº ${anonima.numero_recibo}`,
    )
    expect(textoAnonimo).toContain('Doador(a) anônimo(a)')
    expect(textoAnonimo).not.toContain(vazado)
    expect(textoAnonimo).not.toContain(DOCUMENTO)
    expect(textoAnonimo).toMatch(/no valor de R\$ 15[.,]30/)
    await verNaTela(
      page,
      info,
      'doacao anonima e recorrente: recibo sem nome nem documento',
      cartaoAnonimo,
    )

    // em bens: o valor é a avaliação, não há conta de caixa, e a descrição do bem é do recibo
    form = await abrirFormularioDeDoacao(page)
    await preencherDoacao(form, {
      nome: DOADOR_DE_BENS,
      tipo: 'Bens',
      centavos: VALOR_DOS_BENS,
      descricaoDoBem: BEM,
      comDestinacao: true,
      campanha: TITULO_DA_CAMPANHA,
    })
    await expect(form.getByPlaceholder('Valor avaliado')).toBeVisible()
    await expect(
      seletorCom(form, 'Conta de caixa/banco que recebeu…'),
    ).toHaveCount(0)
    const bens = await registrarDoacao(page, form, 'a doação em bens')
    doacao.bens = { id: bens.id_doacao, recibo: bens.numero_recibo }
    const cartaoDosBens = cartaoDeDoacao(page, bens.numero_recibo)
    await expect(cartaoDosBens).toHaveCount(1)
    await expect(cartaoDosBens).toContainText(
      `${DOADOR_DE_BENS} — ${reais(VALOR_DOS_BENS)}`,
    )
    await expect(cartaoDosBens).toContainText(`Em bens — ${BEM}`)
    const [reciboDosBens] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/doacoes/${bens.id_doacao}/recibo`,
      ),
      cartaoDosBens.getByRole('button', { name: 'Ver recibo' }).click(),
    ])
    expect(reciboDosBens.status()).toBe(200)
    const { texto: textoDosBens } = (await reciboDosBens.json()) as {
      texto: string
    }
    expect(textoDosBens).toContain('em bens (avaliação registrada)')
    expect(textoDosBens).toContain(`referente a: ${BEM}`)
    expect(textoDosBens).toMatch(/no valor de R\$ 250[.,]00/)
    await verNaTela(
      page,
      info,
      'doacao em bens: recibo com a descricao do bem',
      cartaoDosBens,
    )

    // numeração seguida (sem pular nem repetir) entre as três doações da rodada
    expect(doacao.anonima.recibo).toBe(doacao.monetaria.recibo + 1)
    expect(doacao.bens.recibo).toBe(doacao.anonima.recibo + 1)

    // em bens não há título nem lançamento (não é dinheiro em caixa); a monetária anônima tem os dois
    await page.goto('/financeiro/titulos')
    await expect(
      cartaoDeTitulo(
        page,
        `Doação #${bens.id_doacao} — recibo nº ${bens.numero_recibo}`,
      ),
    ).toHaveCount(0)
    await expect(
      cartaoDeTitulo(
        page,
        `Doação #${anonima.id_doacao} — recibo nº ${anonima.numero_recibo}`,
      ),
    ).toHaveCount(1)
    await page.goto('/financeiro/razao-contabil')
    await expect(
      cartaoDoLancamento(
        page,
        new RegExp(`Doação #${bens.id_doacao} — recibo nº [0-9]+$`),
      ),
    ).toHaveCount(0)
    const razaoAnonima = cartaoDoLancamento(
      page,
      new RegExp(
        `Doação #${anonima.id_doacao} — recibo nº ${anonima.numero_recibo}$`,
      ),
    )
    await expect(razaoAnonima).toHaveCount(1)
    await expect(razaoAnonima).toContainText(
      `Debito ${a.ativo.descricao} ${reais(VALOR_ANONIMO)}`,
    )
    await verNaTela(
      page,
      info,
      'razao: so a doacao em dinheiro lancou',
      razaoAnonima,
    )

    // Auditoria do bloco D
    await sair(page)
    await entrarNoFinanceiro(page, 'presidente')
    await exigirAuditoria(page, info, {
      tabela: 'campanhas_arrecadacao',
      acao: 'CREATE',
      registro: idCampanha,
      quem: TESOUREIRO,
      nome: 'auditoria: campanha de arrecadacao criada',
    })
    await expect(
      linhaDaAuditoria(page, 'UPDATE', { registro: idCampanha }),
      'encerrar e reativar a campanha deixam rastro',
    ).toBeVisible()
    await exigirAuditoria(page, info, {
      tabela: 'doacoes',
      acao: 'CREATE',
      registro: doacao.monetaria.id,
      quem: TESOUREIRO,
      nome: 'auditoria: doacao monetaria',
    })
    for (const chave of ['anonima', 'bens'] as const) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', {
          registro: doacao[chave].id,
          quem: TESOUREIRO,
        }),
      ).toBeVisible()
    }
    await ver(page, info, 'auditoria: as tres doacoes da rodada')

    // por último (achados prováveis): o recibo em formato de banco de dados e a data em UTC; o arrecadado da campanha soma bens como dinheiro
    expect
      .soft(
        textoDoRecibo,
        'o recibo escreve "R$ 87.65" (ponto decimal); a tela e o resto do sistema usam "R$ 87,65" (app/services/doacoes.py:102 formata com :.2f)',
      )
      .toContain('R$ 87,65')
    expect
      .soft(
        textoDoRecibo,
        `a data do recibo tem de ser a de hoje em Belém (${diaEmBelem(0).br}); ela vem de data_doacao em UTC (app/services/doacoes.py:104), então depois das 21h sai o dia seguinte`,
      )
      .toContain(`em ${diaEmBelem(0).br}.`)
    await page.goto('/financeiro/doacoes')
    const campanha = page.locator('div.rounded-md.border').filter({
      has: page.locator('p.font-medium', { hasText: TITULO_DA_CAMPANHA }),
    })
    await expect
      .soft(
        campanha,
        'o "arrecadado" da campanha soma também o valor avaliado da doação em bens (R$ 250,00): bem não é dinheiro arrecadado (app/routers/doacoes.py:30 soma todas as doações; saldo_disponivel_centro_custo já exclui bens)',
      )
      .toContainText(`${reais(VALOR + VALOR_ANONIMO)} de ${reais(META)}`)
    expect(vigia.problemas()).toEqual([])
  })
})

/** O cartão da doação do doador (para provar que a recusa não deixou nada na lista). */
function cartaoDeDoacaoDoDoador(page: Page, doador: string): Locator {
  return page.locator('div.rounded-md.border').filter({
    has: page.locator('p.font-medium', { hasText: doador }),
  })
}

// =====================================================================================================================================
// E. CONCILIAÇÃO BANCÁRIA: extrato (OFX e CSV), recusas de formato, baixa que o extrato sugere e fechamento do mês com o saldo
// =====================================================================================================================================
test.describe('E. Conciliação bancária e fechamento do mês', () => {
  test.describe.configure({ mode: 'serial' })

  const CENTAVOS = 32109
  const DESCRICAO = `Receita avulsa do robô ${ETIQUETA}`
  const BANCO = `Banco da conciliação de teste do robô ${ETIQUETA}`
  const vencimento = diaEmBelem(2)
  const competenciaAtual = competenciaDaqui(0)
  let conta: Conta | undefined
  let idContaFinanceira = 0
  let idTitulo = 0
  let baixaDoTitulo = { id: 0, numero: 0 }
  let idFechamento = 0

  test('preparo: conta de banco (Ativo), Conta Financeira com saldo zero e um título a receber de R$ 321,09', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    conta = await criarConta(page, {
      tipo: 'Ativo',
      prefixo: '1.7',
      descricao: BANCO,
    })

    await page.goto('/financeiro/contas-financeiras')
    await expect(
      page.getByRole('heading', { name: 'Contas Financeiras', level: 1 }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Nova conta financeira', exact: true })
      .click()
    const form = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Cadastrar', exact: true }),
    })
    const cadastrar = form.getByRole('button', {
      name: 'Cadastrar',
      exact: true,
    })
    await expect(form.getByPlaceholder('Banco (opcional)')).toBeVisible()
    await cadastrar.click()
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Selecione a conta contábil.' }),
    ).toHaveCount(1)
    await expect(
      form.getByRole('alert').filter({ hasText: 'Selecione o tipo.' }),
    ).toHaveCount(1)
    await ver(page, info, 'conta financeira vazia: recusada')

    // só conta de Ativo analítica é oferecida
    const contas = seletorCom(form, 'Conta contábil (Ativo)…')
    await expect(
      contas.locator('option', { hasText: conta.descricao }),
    ).toHaveCount(1)
    for (const naoOferecida of [CONTA_RECEITA, CONTA_DESPESA]) {
      await expect(
        contas.locator('option', { hasText: naoOferecida }),
      ).toHaveCount(0)
    }
    await escolher(contas, conta.descricao)
    await escolher(seletorCom(form, 'Selecione o tipo…'), 'Conta Corrente')
    await form.getByPlaceholder('Banco (opcional)').fill('Banco de Teste')
    await form.getByPlaceholder('Agência (opcional)').fill('0001')
    await form.getByPlaceholder('Número da conta (opcional)').fill('12345-6')
    const r = await disparar(
      page,
      chamada('POST', '/api/contas-financeiras/'),
      () => cadastrar.click(),
    )
    exigirOk(r, 'cadastrar a conta financeira')
    idContaFinanceira = dadosDe<{ id_conta_financeira: number }>(
      r,
    ).id_conta_financeira
    contaFinanceiraDaConciliacao = { conta, idContaFinanceira }
    await expect(form).toHaveCount(0)
    const cartao = page
      .locator('div.rounded-md.border')
      .filter({ hasText: conta.descricao })
    await expect(cartao).toHaveCount(1)
    await expect(cartao).toContainText(
      'Conta Corrente · Banco de Teste · Ag. 0001 · Conta 12345-6',
    )
    await expect(cartao).toContainText(reais(0))
    await ver(page, info, 'conta financeira cadastrada com saldo zero')

    idTitulo = await criarTituloPelaTela(page, {
      tipo: 'A Receber',
      conta: `${CONTA_RECEITA} (Receita)`,
      descricao: DESCRICAO,
      centavos: CENTAVOS,
      vencimentoIso: vencimento.iso,
    })
    const titulo = cartaoDeTitulo(page, DESCRICAO)
    await expect(titulo).toContainText(
      `Original ${reais(CENTAVOS)} · Saldo ${reais(CENTAVOS)}`,
    )
    await verNaTela(
      page,
      info,
      'titulo a receber de R$ 321,09 sem associado',
      titulo,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('extrato: formato errado, CSV sem colunas, valor e data inválidos e OFX vazio são recusados; o OFX e o CSV bons sugerem o título certo', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/conciliacao')
    await expect(
      page.getByRole('heading', { name: 'Conciliação Bancária', level: 1 }),
    ).toBeVisible()
    const arquivo = page.locator('input[type="file"]')
    const enviar = (nome: string, conteudo: string, tipo: string) =>
      arquivo.setInputFiles({
        name: nome,
        mimeType: tipo,
        buffer: Buffer.from(conteudo, 'utf-8'),
      })
    const recusa = async (
      nome: string,
      conteudo: string,
      tipo: string,
      mensagem: string | RegExp,
      print: string,
    ) => {
      await enviar(nome, conteudo, tipo)
      await expect(
        page.locator('p.text-destructive').filter({ hasText: mensagem }),
      ).toHaveCount(1)
      await expect(
        page.getByText(/transação\(ões\) encontrada\(s\)/),
      ).toHaveCount(0)
      await ver(page, info, print)
    }

    await recusa(
      'extrato.pdf',
      '%PDF-1.4 teste',
      'application/pdf',
      'Formato não suportado - envie um arquivo .ofx ou .csv.',
      'extrato em PDF: recusado',
    )
    await recusa(
      'extrato-sem-colunas.csv',
      'banco,historico\nx,y\n',
      'text/csv',
      "CSV precisa ter ao menos as colunas 'data' e 'valor'.",
      'CSV sem as colunas data e valor: recusado',
    )
    await recusa(
      'extrato-valor-ruim.csv',
      `data,valor,descricao\n${vencimento.iso},abc,teste\n`,
      'text/csv',
      "Valor inválido no extrato: 'abc'.",
      'CSV com valor invalido: recusado',
    )
    await recusa(
      'extrato-data-ruim.csv',
      'data,valor,descricao\nontem,10.00,teste\n',
      'text/csv',
      "Data inválida no extrato: 'ontem'.",
      'CSV com data invalida: recusado',
    )
    await recusa(
      'extrato-vazio.ofx',
      'OFXHEADER:100\n<OFX>\n</OFX>\n',
      'application/octet-stream',
      'Nenhuma transação (<STMTTRN>) encontrada no arquivo OFX.',
      'OFX sem transacoes: recusado',
    )

    // OFX bom: um crédito igual ao título (sugere) e um débito pequeno sem correspondência
    const dataOfx = vencimento.iso.replaceAll('-', '')
    const ofx = [
      'OFXHEADER:100',
      'DATA:OFXSGML',
      'VERSION:102',
      '',
      '<OFX>',
      '<BANKMSGSRSV1>',
      '<STMTTRNRS>',
      '<STMTRS>',
      '<BANKTRANLIST>',
      '<STMTTRN>',
      '<TRNTYPE>CREDIT',
      `<DTPOSTED>${dataOfx}120000[-3:BRT]`,
      `<TRNAMT>${paraCampo(CENTAVOS)}`,
      `<FITID>ROBO-${ETIQUETA}-1`,
      `<MEMO>PIX RECEBIDO ROBO ${ETIQUETA}`,
      '</STMTTRN>',
      '<STMTTRN>',
      '<TRNTYPE>DEBIT',
      `<DTPOSTED>${dataOfx}`,
      '<TRNAMT>-0.07',
      `<FITID>ROBO-${ETIQUETA}-2`,
      '<MEMO>TARIFA SEM CORRESPONDENCIA',
      '</STMTTRN>',
      '</BANKTRANLIST>',
      '</STMTRS>',
      '</STMTTRNRS>',
      '</BANKMSGSRSV1>',
      '</OFX>',
    ].join('\n')
    await enviar('extrato-robo.ofx', ofx, 'application/octet-stream')
    await expect(
      page.getByText('2 transação(ões) encontrada(s) no extrato.'),
    ).toBeVisible()
    const credito = page.locator('div.rounded-md.border').filter({
      hasText: `PIX RECEBIDO ROBO ${ETIQUETA}`,
    })
    await expect(credito).toHaveCount(1)
    await expect(credito).toContainText(reais(CENTAVOS))
    await expect(credito).toContainText(
      new RegExp(
        `Sugestão: título #${idTitulo} — ${escapar(DESCRICAO)} \\(A Receber, saldo ${escapar(reais(CENTAVOS)).replace(/\s/g, '\\s')}\\) — dê baixa em Financeiro › Títulos\\.`,
      ),
    )
    const debito = page.locator('div.rounded-md.border').filter({
      hasText: 'TARIFA SEM CORRESPONDENCIA',
    })
    await expect(debito).toHaveCount(1)
    await expect(debito).toContainText(reais(-7))
    await expect(debito).toContainText(
      'Nenhum título em aberto corresponde a este valor/data.',
    )
    await ver(
      page,
      info,
      'OFX importado: sugestao do titulo e linha sem correspondencia',
    )

    // CSV bom, com valor no formato brasileiro ("321,09", entre aspas por causa da vírgula)
    await enviar(
      'extrato-robo.csv',
      `data,valor,descricao\n${vencimento.iso},"${paraCampo(CENTAVOS).replace('.', ',')}",PIX CSV ROBO ${ETIQUETA}\n`,
      'text/csv',
    )
    await expect(
      page.getByText('1 transação(ões) encontrada(s) no extrato.'),
    ).toBeVisible()
    const doCsv = page.locator('div.rounded-md.border').filter({
      hasText: `PIX CSV ROBO ${ETIQUETA}`,
    })
    await expect(doCsv).toContainText(reais(CENTAVOS))
    await expect(doCsv).toContainText(`Sugestão: título #${idTitulo}`)
    await ver(page, info, 'CSV com valor em formato brasileiro: mesma sugestao')
    expect(vigia.problemas()).toEqual([])
  })

  test('a baixa que o extrato sugere, na conta de banco do teste, com competência no 1º dia do mês: o saldo da Conta Financeira passa a R$ 321,09 e o razão mostra a competência', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const contaDoBanco = conta
    if (!contaDoBanco) throw new Error('o preparo da conciliação não rodou')
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/titulos')
    const cartao = cartaoDeTitulo(page, DESCRICAO)
    await expect(cartao).toBeVisible()
    const primeiroDoMes = `${competenciaAtual}-01`
    const baixa = await baixarPelaTela(
      page,
      cartao,
      {
        centavos: CENTAVOS,
        forma: 'Pix',
        contrapartida: contaDoBanco.descricao,
        competenciaIso: primeiroDoMes,
      },
      'a baixa do título da conciliação',
    )
    baixaDoTitulo = { id: baixa.id_lancamento, numero: baixa.numero_sequencial }
    await expect(cartao).toContainText('Pago')
    await expect(cartao).toContainText(`Saldo ${reais(0)}`)
    await verNaTela(page, info, 'titulo da conciliacao baixado', cartao)

    await page.goto('/financeiro/razao-contabil')
    const razao = cartaoDoLancamento(
      page,
      `#${baixa.numero_sequencial} — Baixa do título #${idTitulo} —`,
    )
    await expect(razao).toHaveCount(1)
    await expect(razao).toContainText(
      `Debito ${contaDoBanco.descricao} ${reais(CENTAVOS)}`,
    )
    await expect(razao).toContainText(
      `Credito ${CONTA_RECEITA} ${reais(CENTAVOS)}`,
    )
    if (new Date().toISOString().slice(0, 10) !== `${competenciaAtual}-01`) {
      await expect(razao).toContainText(
        `Competência: ${brDaCompetencia(competenciaAtual, 1)}`,
      )
    }
    await verNaTela(
      page,
      info,
      'razao da baixa: debito no banco do teste, competencia no dia 1',
      razao,
    )

    await page.goto('/financeiro/contas-financeiras')
    const saldo = page
      .locator('div.rounded-md.border')
      .filter({ hasText: contaDoBanco.descricao })
    await expect(saldo).toContainText(reais(CENTAVOS))
    await ver(page, info, 'conta financeira com saldo de R$ 321,09')
    expect(vigia.problemas()).toEqual([])
  })

  test('fechamento do mês: conta e competência faltando são recusadas; saldo do extrato diferente é recusado com a diferença; o saldo certo fecha; fechar de novo é recusado; a Auditoria registra', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const contaDoBanco = conta
    if (!contaDoBanco) throw new Error('o preparo da conciliação não rodou')
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/conciliacao')
    const secao = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Fechamento mensal' }),
    })
    const form = secao.locator('form')
    const fechar = form.getByRole('button', { name: 'Fechar mês' })
    const competencia = form.getByPlaceholder('AAAA-MM')
    const saldoDoExtrato = form.getByPlaceholder('Saldo do extrato (R$)')
    const alerta = (texto: string) =>
      form.getByRole('alert').filter({ hasText: texto })
    await expect(competencia).toHaveValue(competenciaAtual)

    // recusa 1: sem conta financeira; recusa 2: competência fora do formato
    await fechar.click()
    await expect(alerta('Selecione a conta financeira.')).toHaveCount(1)
    await competencia.fill('2026/10')
    await fechar.click()
    await expect(alerta('Use o formato AAAA-MM.')).toHaveCount(1)
    await ver(
      page,
      info,
      'fechamento sem conta e com competencia fora do formato: recusado',
    )
    await competencia.fill(competenciaAtual)
    await escolher(
      seletorCom(form, 'Conta financeira…'),
      contaDoBanco.descricao,
    )

    // recusa 3: o extrato diz R$ 300,00 e o sistema tem R$ 321,09 (diferença de R$ 21,09)
    await saldoDoExtrato.fill('300.00')
    const abaixo = await disparar(
      page,
      chamada('POST', '/api/fechamentos-mensais/'),
      () => fechar.click(),
    )
    expect(abaixo.status, resumo(abaixo)).toBe(400)
    await expect(
      form.getByRole('alert').filter({
        hasText:
          /Divergência de R\$ 21[.,]09 entre o saldo do sistema \(R\$ 321[.,]09\) e o saldo do extrato bancário \(R\$ 300[.,]00\) - concilie antes de fechar o mês\./,
      }),
    ).toHaveCount(1)
    await ver(
      page,
      info,
      'fechamento com extrato de R$ 300,00: recusado, diferenca de R$ 21,09',
    )

    // recusa 4: extrato maior que o sistema (divergência negativa)
    await saldoDoExtrato.fill('400.00')
    const acima = await disparar(
      page,
      chamada('POST', '/api/fechamentos-mensais/'),
      () => fechar.click(),
    )
    expect(acima.status, resumo(acima)).toBe(400)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: /Divergência de R\$ -78[.,]91/ }),
    ).toHaveCount(1)
    await expect(
      secao.getByText(
        `${competenciaAtual} — conta financeira #${idContaFinanceira}`,
      ),
    ).toHaveCount(0)

    // certo: o saldo exato
    await saldoDoExtrato.fill(paraCampo(CENTAVOS))
    const certo = await disparar(
      page,
      chamada('POST', '/api/fechamentos-mensais/'),
      () => fechar.click(),
    )
    exigirOk(certo, 'fechar o mês com o saldo exato')
    const fechamento = dadosDe<{
      id_fechamento: number
      saldo_sistema: number
      divergencia: number
    }>(certo)
    idFechamento = fechamento.id_fechamento
    expect(Math.round(fechamento.saldo_sistema * 100)).toBe(CENTAVOS)
    expect(Math.round(fechamento.divergencia * 100)).toBe(0)
    const linha = secao.locator('div.rounded-md.border').filter({
      hasText: `${competenciaAtual} — conta financeira #${idContaFinanceira}`,
    })
    await expect(linha).toHaveCount(1)
    await expect(linha).toContainText(`conferido, divergência ${reais(0)}`)
    await ver(page, info, 'mes fechado com o saldo exato do extrato')

    // recusa 5: fechar de novo a mesma competência da mesma conta
    const denovo = await disparar(
      page,
      chamada('POST', '/api/fechamentos-mensais/'),
      () => fechar.click(),
    )
    expect(denovo.status, resumo(denovo)).toBe(400)
    await expect(
      form.getByRole('alert').filter({
        hasText: `A competência ${competenciaAtual} desta conta financeira já está fechada.`,
      }),
    ).toHaveCount(1)
    await expect(linha).toHaveCount(1)
    await ver(page, info, 'fechar de novo o mesmo mes: recusado')

    // Auditoria do bloco E
    await sair(page)
    await entrarNoFinanceiro(page, 'presidente')
    await exigirAuditoria(page, info, {
      tabela: 'fechamentos_mensais',
      acao: 'CREATE',
      registro: idFechamento,
      quem: TESOUREIRO,
      nome: 'auditoria: mes fechado pelo Tesoureiro',
    })
    await exigirAuditoria(page, info, {
      tabela: 'contas_financeiras',
      acao: 'CREATE',
      registro: idContaFinanceira,
      quem: TESOUREIRO,
      nome: 'auditoria: conta financeira cadastrada',
    })
    await exigirAuditoria(page, info, {
      tabela: 'titulos_financeiros',
      acao: 'CREATE',
      registro: idTitulo,
      quem: TESOUREIRO,
      nome: 'auditoria: titulo avulso lancado pelo Tesoureiro',
    })
    await exigirAuditoria(page, info, {
      tabela: 'lancamentos_contabeis',
      acao: 'BAIXA_TITULO',
      registro: baixaDoTitulo.id,
      quem: TESOUREIRO,
      nome: 'auditoria: baixa do titulo da conciliacao',
    })
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// F. SONDAGENS (independentes): o que um usuário faz sem mexer nos campos que a tela chama de "opcionais". Cada uma reprova se o sistema recusar.
//    Os cenários A-E preenchem esses campos de propósito, para a história seguir mesmo com o defeito.
// =====================================================================================================================================
test.describe('F. Sondagens do caminho mínimo (cada uma independente)', () => {
  test('F1 baixa de título só com o obrigatório (sem data de competência e sem centro de custo) tem que ser aceita', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    const descricao = `Sondagem da baixa ${ETIQUETA}`
    await criarTituloPelaTela(page, {
      tipo: 'A Receber',
      conta: `${CONTA_RECEITA} (Receita)`,
      descricao,
      centavos: 1000,
      vencimentoIso: diaEmBelem(5).iso,
    })
    const cartao = cartaoDeTitulo(page, descricao)
    const form = await abrirBaixa(cartao)
    const dados: DadosBaixa = {
      centavos: 1000,
      forma: 'Pix',
      contrapartida: CONTA_CAIXA_SEMEADA,
    }
    await preencherBaixa(form, dados)
    const tentativas: { rotulo: string; antes: () => Promise<void> }[] = [
      { rotulo: 'só com o obrigatório', antes: () => Promise.resolve() },
      {
        rotulo: 'com a data de competência',
        antes: () => form.locator('input[type="date"]').fill(diaEmBelem(0).iso),
      },
      {
        rotulo: 'com a data e o centro de custo',
        antes: () => escolherCentroDeCusto(form),
      },
    ]
    let aceita = false
    for (const tentativa of tentativas) {
      await tentativa.antes()
      const r = await enviarBaixa(page, form)
      if (r.ok) {
        aceita = true
        break
      }
      expect
        .soft(
          r.ok,
          `a baixa ${tentativa.rotulo} foi recusada (${resumo(r)}). campo opcional em branco chega ao servidor como "" na data (Titulos.tsx:250-251 e baixarTituloSchema em schemas.ts: data_competencia continua z.string().optional(); o servidor recusa "" em BaixarTitulo.data_competencia, app/schemas/financeiro.py) e, sem a limpeza de zero do centro de custo, como 0 (chave estrangeira da partida, app/models/financeiro.py PartidaContabil.id_centro_custo)`,
        )
        .toBe(true)
    }
    expect(aceita, 'nenhuma combinação de campos fez a baixa passar').toBe(true)
    await verNaTela(page, info, 'sondagem da baixa', cartao)
    expect(vigia.problemas()).toEqual([])
  })

  test('F2 campanha de arrecadação só com título e meta (sem prazo e sem centro de custo) tem que ser aceita', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/doacoes')
    const secao = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Campanhas de arrecadação' }),
    })
    await secao
      .getByRole('button', { name: 'Nova campanha', exact: true })
      .click()
    const form = secao.locator('form')
    await form
      .getByPlaceholder('Título da campanha')
      .fill(`Sondagem da campanha ${ETIQUETA}`)
    await form.getByPlaceholder('Meta (R$)').fill('1000.00')
    const enviar = () =>
      disparar(page, chamada('POST', '/api/campanhas-arrecadacao/'), () =>
        form.getByRole('button', { name: 'Criar campanha' }).click(),
      )
    const tentativas: { rotulo: string; antes: () => Promise<void> }[] = [
      { rotulo: 'só com título e meta', antes: () => Promise.resolve() },
      {
        rotulo: 'com o prazo',
        antes: () =>
          form.locator('input[type="date"]').fill(diaEmBelem(60).iso),
      },
      {
        rotulo: 'com o prazo e o centro de custo',
        antes: async () => {
          const centros = seletorCom(form, 'Sem centro de custo vinculado')
          await expect
            .poll(() => centros.locator('option').count())
            .toBeGreaterThan(1)
          await centros.selectOption({ index: 1 })
        },
      },
    ]
    let aceita = false
    for (const tentativa of tentativas) {
      await tentativa.antes()
      const r = await enviar()
      if (r.ok) {
        aceita = true
        break
      }
      expect
        .soft(
          r.ok,
          `a campanha ${tentativa.rotulo} foi recusada (${resumo(r)}). campo opcional em branco chega ao servidor como "" no prazo (Doacoes.tsx:54 e campanhaArrecadacaoCriarSchema em schemas.ts: prazo continua z.string().optional(); o servidor recusa "" em CampanhaArrecadacaoCriar.prazo, app/schemas/doacoes.py) e, sem a limpeza de zero, id_centro_custo 0 viola a chave estrangeira (app/models/doacoes.py)`,
        )
        .toBe(true)
    }
    expect(aceita, 'nenhuma combinação de campos criou a campanha').toBe(true)
    await ver(page, info, 'sondagem da campanha de arrecadacao')
    expect(vigia.problemas()).toEqual([])
  })

  test('F3 doação monetária só com o obrigatório (sem campanha e sem destinação) tem que ser aceita', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    await page.goto('/financeiro/doacoes')
    const titulo = `Campanha da sondagem ${ETIQUETA}`
    const idCampanha = await criarCampanhaDeArrecadacao(page, {
      titulo,
      metaCentavos: 100000,
    })
    expect(idCampanha).toBeGreaterThan(0)
    const form = await abrirFormularioDeDoacao(page)
    await preencherDoacao(form, {
      nome: `Doador da sondagem ${ETIQUETA}`,
      centavos: 1100,
      caixa: CONTA_CAIXA_SEMEADA,
    })
    const enviar = () =>
      disparar(page, chamada('POST', '/api/doacoes/'), () =>
        form
          .getByRole('button', { name: 'Registrar doação', exact: true })
          .click(),
      )
    const tentativas: { rotulo: string; antes: () => Promise<void> }[] = [
      { rotulo: 'só com o obrigatório', antes: () => Promise.resolve() },
      {
        rotulo: 'com a campanha',
        antes: () =>
          escolher(seletorCom(form, 'Sem campanha vinculada'), titulo),
      },
      {
        rotulo: 'com a campanha e a destinação',
        antes: async () => {
          const destinos = seletorCom(form, 'Sem destinação específica')
          await expect
            .poll(() => destinos.locator('option').count())
            .toBeGreaterThan(1)
          await destinos.selectOption({ index: 1 })
        },
      },
    ]
    let aceita = false
    for (const tentativa of tentativas) {
      await tentativa.antes()
      const r = await enviar()
      if (r.ok) {
        aceita = true
        break
      }
      expect
        .soft(
          r.ok,
          `a doação ${tentativa.rotulo} foi recusada (${resumo(r)}). campo opcional em branco chega como 0 em id_campanha e id_centro_custo_destinacao (Doacoes.tsx:260 e :273, doacaoCriarSchema em schemas.ts) e o servidor grava a doação com esses zeros, que violam as chaves estrangeiras (app/services/doacoes.py: Doacao(...) e db.flush())`,
        )
        .toBe(true)
    }
    expect(aceita, 'nenhuma combinação de campos registrou a doação').toBe(true)
    await ver(page, info, 'sondagem da doacao')
    expect(vigia.problemas()).toEqual([])
  })

  test('F4 isenção só com associado, motivo e percentual (sem plano e sem data de fim) tem que ser aceita', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    const a = await garantirApoio(page)
    await entrarNoFinanceiro(page, 'presidente')
    await page.goto('/financeiro/planos-contribuicao')
    const secao = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Isenções' }),
    })
    await secao
      .getByRole('button', { name: 'Nova isenção', exact: true })
      .click()
    const form = secao.locator('form')
    await escolher(seletorCom(form, 'Selecione o associado…'), a.sondado.nome)
    await escolher(
      seletorCom(form, 'Selecione o motivo…'),
      'Dificuldade financeira comprovada',
    )
    await form.getByPlaceholder('% de desconto (100 = isenção total)').fill('1')
    const enviar = () =>
      disparar(page, chamada('POST', '/api/isencoes-contribuicao/'), () =>
        form.getByRole('button', { name: 'Cadastrar isenção' }).click(),
      )
    const tentativas: { rotulo: string; antes: () => Promise<void> }[] = [
      {
        rotulo: 'só com associado, motivo e percentual',
        antes: () => Promise.resolve(),
      },
      {
        rotulo: 'com a data de fim',
        antes: () =>
          form.locator('input[type="date"]').fill(diaEmBelem(730).iso),
      },
      {
        rotulo: 'com a data de fim e um plano escolhido',
        antes: async () => {
          const planos = seletorCom(form, 'Todos os planos do associado')
          await expect
            .poll(() => planos.locator('option').count(), {
              message: 'tem de haver ao menos um plano cadastrado',
            })
            .toBeGreaterThan(1)
          await planos.selectOption({ index: 1 })
        },
      },
    ]
    let aceita = false
    for (const tentativa of tentativas) {
      await tentativa.antes()
      const r = await enviar()
      if (r.ok) {
        aceita = true
        break
      }
      expect
        .soft(
          r.ok,
          `a isenção ${tentativa.rotulo} foi recusada (${resumo(r)}). campo opcional em branco chega como data_fim "" e id_plano 0 (PlanosContribuicao.tsx:274 e :277, isencaoContribuicaoCriarSchema em schemas.ts: data_fim continua z.string().optional(); o servidor recusa "" em IsencaoCriar.data_fim, app/schemas/financeiro.py, e id_plano 0 viola a chave estrangeira, app/routers/financeiro.py cadastrar_isencao_contribuicao)`,
        )
        .toBe(true)
    }
    expect(aceita, 'nenhuma combinação de campos criou a isenção').toBe(true)
    await ver(page, info, 'sondagem da isencao')
    expect(vigia.problemas()).toEqual([])
  })

  test('F5 fechamento do mês com competência de mês inexistente (2026-13) tem que ser recusado com 400, não com erro do servidor', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    await entrarNoFinanceiro(page, 'tesoureiro')
    let existente = contaFinanceiraDaConciliacao
    if (!existente) {
      const conta = await criarConta(page, {
        tipo: 'Ativo',
        prefixo: '1.6',
        descricao: `Banco da sondagem de teste do robô ${ETIQUETA}`,
      })
      await page.goto('/financeiro/contas-financeiras')
      await page
        .getByRole('button', { name: 'Nova conta financeira', exact: true })
        .click()
      const form = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Cadastrar', exact: true }),
      })
      await escolher(
        seletorCom(form, 'Conta contábil (Ativo)…'),
        conta.descricao,
      )
      await escolher(seletorCom(form, 'Selecione o tipo…'), 'Conta Corrente')
      const r = await disparar(
        page,
        chamada('POST', '/api/contas-financeiras/'),
        () =>
          form.getByRole('button', { name: 'Cadastrar', exact: true }).click(),
      )
      exigirOk(r, 'cadastrar a conta financeira da sondagem')
      existente = {
        conta,
        idContaFinanceira: dadosDe<{ id_conta_financeira: number }>(r)
          .id_conta_financeira,
      }
    }
    await page.goto('/financeiro/conciliacao')
    const secao = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Fechamento mensal' }),
    })
    const form = secao.locator('form')
    await form.getByPlaceholder('AAAA-MM').fill('2026-13')
    await escolher(
      seletorCom(form, 'Conta financeira…'),
      existente.conta.descricao,
    )
    await form.getByPlaceholder('Saldo do extrato (R$)').fill('0')
    const r = await disparar(
      page,
      chamada('POST', '/api/fechamentos-mensais/'),
      () => form.getByRole('button', { name: 'Fechar mês' }).click(),
    )
    await ver(page, info, 'fechamento com competencia 2026-13')
    expect(
      r.status !== null && r.status >= 400 && r.status < 500,
      `a competência 2026-13 não foi recusada com 4xx (${resumo(r)}): o validador só confere que são dígitos (app/schemas/fechamento.py:13-17) e calendar.monthrange(2026, 13) estoura em app/services/fechamento.py:37`,
    ).toBe(true)
    expect(vigia.problemas()).toEqual([])
  })

  test('F6 Pix de um título a receber: o QR e o código "copia e cola" têm que abrir, com o valor do saldo e o CRC certo', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await entrarNoFinanceiro(page, 'tesoureiro')
    const descricao = `Sondagem do Pix ${ETIQUETA}`
    const idDoTitulo = await criarTituloPelaTela(page, {
      tipo: 'A Receber',
      conta: `${CONTA_RECEITA} (Receita)`,
      descricao,
      centavos: 5555,
      vencimentoIso: diaEmBelem(7).iso,
    })
    const cartao = cartaoDeTitulo(page, descricao)
    await cartao.getByRole('button', { name: 'Ver Pix', exact: true }).click()
    const qr = cartao.locator('svg')
    const naoConfigurado = cartao.getByText(/Pix não configurado/)
    await expect(qr.or(naoConfigurado).first()).toBeVisible()
    await verNaTela(page, info, 'ver Pix do titulo', cartao)
    expect
      .soft(
        await naoConfigurado.count(),
        'o Pix do título responde "Pix não configurado (CHAVE_PIX ausente em Configurações Institucionais)": nenhuma tela do painel grava a CHAVE_PIX (só as opções de catálogo são editáveis em Configurações; app/services/pix.py:80-82, app/database.py:474), então o botão "Ver Pix" nunca funciona sem mexer no banco',
      )
      .toBe(0)
    if ((await naoConfigurado.count()) === 0) {
      const payload = (await cartao.locator('p.font-mono').innerText()).trim()
      expect(payload.startsWith('000201')).toBe(true)
      expect(payload).toContain('br.gov.bcb.pix')
      expect(payload).toContain('540555.55') // campo 54: tamanho 05, valor 55.55
      expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)))
      expect(payload).toContain(String(idDoTitulo))
      await cartao.getByRole('button', { name: 'Copiar código Pix' }).click()
      await expect(
        cartao.getByRole('button', { name: 'Copiado!' }),
      ).toBeVisible()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        payload,
      )
      await cartao
        .getByRole('button', { name: 'Ocultar Pix', exact: true })
        .click()
      await expect(cartao.locator('svg')).toHaveCount(0)
    }
    expect(vigia.problemas()).toEqual([])
  })
})
