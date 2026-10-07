import {
  expect,
  test,
  type Locator,
  type Page,
  type Response as Resposta,
} from '@playwright/test'

import {
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  fotoDeTeste,
  inventariar,
  RODADA,
  sair,
  ver,
  vigiar,
  type Papel,
} from './apoio'

// v5.4e — FASE 3 ao vivo, parte 3: DESPESA COM SEGREGAÇÃO DE FUNÇÕES, pela tela do Financeiro (fornecedores, alçadas de aprovação, compras,
// reembolso de despesa, contas a pagar recorrentes e o título que cada uma gera), com a recusa que o sistema TEM de fazer em cada passo e a
// Auditoria mostrando a ação.
//
// O que este roteiro SABE do ambiente de teste (lido em scripts/popular_homologacao.py e no servidor, não suposto):
//  - Quem aprova uma compra é decidido pelo CARGO em mandato vigente (app/services/compras.py::_pode_aprovar), não pelo nível de acesso. O
//    Presidente de teste (Marta, nível "Presidente") NÃO tem mandato: não aprova nada por conta própria. Quem aprova é a Ana (cargo PRESIDENTE),
//    o Fábio (cargo TESOUREIRO) e, por delegação, o Heitor (Conselho Fiscal, que tem a permissão `financeiro` pelo cargo).
//  - A ordem das checagens ao aprovar uma compra é: situação -> cotações (a partir de R$ 1.000,00, mínimo de 2) -> alçada do valor -> quem
//    solicitou -> associado do aprovador -> conflito de interesse -> cargo da alçada (ou delegação) -> já aprovou. Cada recusa abaixo cai na
//    ordem certa porque o roteiro prepara só o que falta.
//  - A base de teste nasce SEM fornecedor e SEM alçada: este roteiro cria os seus (nomes e CNPJs com a RODADA) e as faixas de valor.
//  - O que NÃO cabe pela tela: o formulário de compra não escolhe fornecedor nem centro de custo; a declaração de conflito de interesse não
//    escolhe fornecedor (vale para QUALQUER compra); a delegação não tem como ser revogada. Por isso o roteiro deixa a delegação (curta, 2 dias)
//    só para o Heitor, e as faixas "de lixo" que as tentativas inválidas criarem ficam INATIVAS ao fim.
//
// Cada roteiro é uma história sozinha (sem `serial`): um achado numa história não pode esconder as outras, e o robô só roda ao vivo. O que é
// DEFEITO PROVÁVEL do sistema (e não erro do roteiro) usa `expect.soft`, com a explicação na mensagem.
test.beforeAll(() => exigirHomologacao())

const NAVEGADOR = {
  baseURL: process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br',
  locale: 'pt-BR',
  timezoneId: 'America/Belem',
  viewport: { width: 1366, height: 900 },
}

// Os nomes vêm do semeador (cada um com " de Teste" no fim); aqui só o começo, que basta para achar o nome na lista e na Auditoria.
const MARTA = 'Marta Souza' // Presidente de teste (administrador), SEM mandato
const FABIO = 'Fábio Henrique Dias' // 1º Tesoureiro
const ANA = 'Ana Lúcia Ferreira' // Presidente pelo cargo
const HEITOR = 'Heitor Almeida Rocha' // Conselheiro Fiscal
const KARINA = 'Karina Duarte Melo' // associada sem cargo e sem login
const BRUNO = 'Bruno Carvalho Lima' // 1º Vice-Presidente (associados e governança, sem financeiro)

const ALFA = 'Alfa Suprimentos de Teste'
const BETA = 'Beta Serviços de Teste'

const MENSAGEM = {
  proprio:
    'Quem solicitou a compra não pode aprová-la (segregação de funções).',
  conflito:
    'Aprovador tem declaração de conflito de interesse ativa envolvendo este fornecedor - use outro aprovador.',
  jaAprovou: 'Este usuário já aprovou esta solicitação.',
  primeiraDeDuas: 'Aprovação registrada (1/2) - aguardando mais aprovações.',
  semCargo: (cargos: string) =>
    `Aprovador não tem o cargo exigido para esta alçada (${cargos}).`,
  cotacoes: (tem: number) =>
    new RegExp(`exige ao menos 2 cotações antes de aprovar \\(tem ${tem}\\)`),
  semAlcada: (valor: string) => {
    // o servidor escreve o dinheiro como se lê no Brasil: R$ 1.234,56
    const br = Number(valor).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return new RegExp(
      `Nenhuma alçada de aprovação configurada para o valor R\\$ ${br.replace(/\./g, '\\.')} - cadastre uma faixa`,
    )
  },
}

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

/** CNPJ com dígitos verificadores certos (formato 00.000.000/0000-00), filial 9999 (que não existe de verdade), a partir de uma raiz inventada. */
function cnpjValido(raiz: number): string {
  const base = `${String(raiz).padStart(8, '0').slice(-8)}9999`
  const digito = (numeros: number[], pesos: number[]): number => {
    const soma = numeros.reduce((acc, n, i) => acc + n * (pesos[i] ?? 0), 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const numeros = base.split('').map(Number)
  const d1 = digito(numeros, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digito([...numeros, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const t = `${base}${d1}${d2}`
  return `${t.slice(0, 2)}.${t.slice(2, 5)}.${t.slice(5, 8)}/${t.slice(8, 12)}-${t.slice(12)}`
}

/** O mesmo CNPJ com o último dígito verificador trocado: 14 dígitos, mas nenhum CNPJ de verdade. */
function cnpjComDigitosErrados(cnpj: string): string {
  const ultimo = Number(cnpj.slice(-1))
  return `${cnpj.slice(0, -1)}${(ultimo + 1) % 10}`
}

/** "R$ 1.234,56" -> 123456 (a tela mostra reais por Intl pt-BR; o roteiro compara em centavos inteiros). */
function centavosDe(texto: string): number {
  return Number(texto.replace(/\D/g, ''))
}

// ------------------------------------------------------------------------------------------------ rede e telas
function aguardar(
  page: Page,
  metodo: string,
  caminho: RegExp,
): Promise<Resposta> {
  return page.waitForResponse(
    (r) =>
      r.request().method() === metodo &&
      caminho.test(new URL(r.url()).pathname),
  )
}

/** Clica e devolve a resposta do servidor (as recusas que TÊM de acontecer se conferem pelo código e pela mensagem na tela). */
async function acionar(
  page: Page,
  metodo: string,
  caminho: RegExp,
  botao: Locator,
): Promise<Resposta> {
  const [resposta] = await Promise.all([
    aguardar(page, metodo, caminho),
    botao.click(),
  ])
  return resposta
}

/** O número que o servidor devolveu ao criar (id_solicitacao, id_cotacao...), conferindo que a criação foi aceita. */
async function idDe(resposta: Resposta, chave: string): Promise<number> {
  const texto = await resposta.text()
  expect(
    resposta.ok(),
    `a criação foi recusada (${resposta.status()}): ${texto}`,
  ).toBe(true)
  const valor = (JSON.parse(texto) as Record<string, unknown>)[chave]
  expect(typeof valor, `a resposta não trouxe ${chave}: ${texto}`).toBe(
    'number',
  )
  return valor as number
}

/** Entra e espera o Início oferecer o Financeiro: as permissões do cargo chegaram (o módulo só aparece no Início e dentro dele). */
async function entrarNoFinanceiro(page: Page, papel: Papel): Promise<void> {
  await entrar(page, papel)
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
}

async function abrirTela(
  page: Page,
  rota: string,
  titulo: string,
): Promise<void> {
  await page.goto(rota)
  await expect(
    page.getByRole('heading', { name: titulo, level: 1 }),
  ).toBeVisible()
}

/** O cartão (a linha) de uma lista pelo texto que o identifica (as listas do Financeiro são `div.rounded-md.border`). */
function cartaoDe(page: Page, texto: string | RegExp): Locator {
  return page.locator('div.rounded-md.border').filter({ hasText: texto })
}

/**
 * O formulário que tem este botão de envio, na página toda ou só dentro de `dentro` (um cartão). O localizador de dentro do filtro sai sempre
 * da `page`: ele é avaliado a partir do formulário, e um localizador derivado do cartão procuraria o cartão dentro do formulário.
 */
function formularioDe(page: Page, botao: string, dentro?: Locator): Locator {
  return (dentro ?? page).locator('form').filter({
    has: page.getByRole('button', { name: botao, exact: true }),
  })
}

/** Os selects destes formulários não têm rótulo: acha-se pelo texto da primeira opção (dentro do formulário `dentro`). */
function selectCom(
  page: Page,
  dentro: Locator,
  primeiraOpcao: string,
): Locator {
  return dentro.locator('select').filter({
    has: page.locator('option', { hasText: primeiraOpcao }),
  })
}

/** Espera a opção chegar (as listas vêm da API depois de a tela abrir) e a escolhe. */
async function escolherOpcao(select: Locator, trecho: string): Promise<void> {
  await expect(
    select.locator('option', { hasText: trecho }).first(),
    `a opção "${trecho}" tem de existir no campo`,
  ).toBeAttached()
  await escolherPorTexto(select, trecho)
}

/** A conta de despesa do semeador ("Despesas de projetos (teste)") ou, se não houver, a primeira conta de despesa analítica. */
async function escolherContaDeDespesa(select: Locator): Promise<void> {
  await expect(
    select.locator('option'),
    'o plano de contas tem de trazer ao menos uma conta de Despesa',
  ).not.toHaveCount(1)
  if (
    (await select
      .locator('option', { hasText: 'Despesas de projetos (teste)' })
      .count()) > 0
  ) {
    await escolherPorTexto(select, 'Despesas de projetos (teste)')
  } else {
    await select.selectOption({ index: 1 })
  }
}

// ------------------------------------------------------------------------------------------------ a Auditoria
/** Abre a Auditoria filtrada por tabela (e, se pedido, por ação) e devolve o total de registros (lido da resposta da própria tela). */
async function abrirAuditoria(
  page: Page,
  tabela: string,
  acao?: string,
): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${tabela}`) &&
      (!acao || r.url().includes(`acao=${acao}`)),
  )
  await campo(page, 'Tabela').fill(tabela)
  if (acao) await campo(page, 'Ação').selectOption(acao)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

/** As linhas da Auditoria com a ação e, se pedido, o registro e quem fez. */
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

const linhaDaAuditoria = (
  page: Page,
  acao: string,
  filtros: { registro?: number; quem?: string } = {},
): Locator => linhasDaAuditoria(page, acao, filtros).first()

// ------------------------------------------------------------------------------------------------ Compras
/** Abre "Nova solicitação", preenche (a conta é a de despesa do semeador), envia e devolve o número da solicitação criada. */
async function criarSolicitacao(
  page: Page,
  d: { descricao: string; valor: string; justificativa?: string },
): Promise<number> {
  await page.getByRole('button', { name: 'Nova solicitação' }).click()
  const form = formularioDe(page, 'Criar solicitação')
  await expect(form.getByPlaceholder('Descrição da compra')).toBeVisible()
  await form.getByPlaceholder('Descrição da compra').fill(d.descricao)
  await form.getByPlaceholder('Valor estimado').fill(d.valor)
  await escolherContaDeDespesa(form.locator('select'))
  if (d.justificativa) {
    await form
      .getByPlaceholder('Justificativa (opcional)')
      .fill(d.justificativa)
  }
  const resposta = await acionar(
    page,
    'POST',
    /\/api\/solicitacoes-compra\/$/,
    form.getByRole('button', { name: 'Criar solicitação' }),
  )
  const id = await idDe(resposta, 'id_solicitacao')
  await expect(form).toHaveCount(0) // o formulário se fecha sozinho
  const cartao = cartaoDe(page, d.descricao)
  await expect(cartao).toBeVisible()
  await expect(
    cartao.getByText('Aguardando Aprovação', { exact: true }),
  ).toBeVisible()
  return id
}

/** Abre o painel "Cotações / Aprovar" do cartão (se já estiver aberto, não faz nada). */
async function abrirPainelDaCompra(cartao: Locator): Promise<void> {
  // logo depois da entrada a tela ainda se refaz (a sessão é confirmada e a lista, relida), o que fecha um painel recém-aberto: abre de novo
  // até ele ficar aberto, em vez de clicar uma vez só
  await expect(async () => {
    const abrir = cartao.getByRole('button', { name: 'Cotações / Aprovar' })
    if ((await abrir.count()) > 0) await abrir.click()
    await expect(
      cartao.getByRole('button', { name: 'Ocultar', exact: true }),
    ).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await expect(cartao.getByText('Cotações', { exact: true })).toBeVisible()
}

/** Aperta "Aprovar" e devolve a resposta (200 = aprovação registrada; 400/403 = recusa, com a mensagem logo abaixo do botão). */
async function tentarAprovarCompra(
  page: Page,
  cartao: Locator,
): Promise<Resposta> {
  await abrirPainelDaCompra(cartao)
  return acionar(
    page,
    'POST',
    /\/api\/solicitacoes-compra\/\d+\/aprovar$/,
    cartao.getByRole('button', { name: 'Aprovar', exact: true }),
  )
}

/** Registra uma cotação pelo painel; devolve o número da cotação. */
async function adicionarCotacao(
  page: Page,
  cartao: Locator,
  fornecedor: string,
  valor: string,
): Promise<number> {
  await abrirPainelDaCompra(cartao)
  const form = formularioDe(page, 'Adicionar cotação', cartao)
  await escolherOpcao(form.locator('select'), fornecedor)
  await form.getByPlaceholder('Valor', { exact: true }).fill(valor)
  const resposta = await acionar(
    page,
    'POST',
    /\/api\/solicitacoes-compra\/\d+\/cotacoes$/,
    form.getByRole('button', { name: 'Adicionar cotação' }),
  )
  return idDe(resposta, 'id_cotacao')
}

/** Reprova pelo painel (motivo curto demais é recusado na tela primeiro) e confere "Reprovada" + o motivo no cartão. */
async function reprovarCompra(
  page: Page,
  cartao: Locator,
  motivo: string,
): Promise<void> {
  await abrirPainelDaCompra(cartao)
  await cartao.getByRole('button', { name: 'Reprovar', exact: true }).click()
  const form = formularioDe(page, 'Confirmar reprovação', cartao)
  await form.getByPlaceholder('Motivo da reprovação').fill('ab')
  await form.getByRole('button', { name: 'Confirmar reprovação' }).click()
  await expect(
    form.getByRole('alert').filter({ hasText: 'Informe o motivo.' }),
  ).toBeVisible()
  await form.getByPlaceholder('Motivo da reprovação').fill(motivo)
  const resposta = await acionar(
    page,
    'POST',
    /\/api\/solicitacoes-compra\/\d+\/reprovar$/,
    form.getByRole('button', { name: 'Confirmar reprovação' }),
  )
  expect(resposta.status()).toBe(200)
  await expect(cartao.getByText('Reprovada', { exact: true })).toBeVisible()
  await expect(cartao).toContainText(`Motivo: ${motivo}`)
}

/**
 * Em uma compra já decidida, "Ver aprovações" mostra a trilha (quem aprovou, pelo nome, e quando; "(por delegação)" quando foi no lugar de quem tem o
 * cargo). É aí que se confere que quem solicitou NÃO está entre quem aprovou. Tudo em `expect.soft`: é a tela nova da v5.4e.
 */
async function conferirTrilhaDeAprovacao(
  cartao: Locator,
  esperados: { nome: string; porDelegacao?: boolean }[],
  ausentes: string[],
): Promise<void> {
  const abrir = cartao.getByRole('button', {
    name: 'Ver aprovações',
    exact: true,
  })
  await expect
    .soft(abrir, 'a compra decidida deve oferecer "Ver aprovações"')
    .toBeVisible()
  if (!(await abrir.isVisible())) return
  await abrir.click()
  for (const e of esperados) {
    await expect
      .soft(
        cartao.getByText(
          new RegExp(
            `${e.nome}.* — \\d{2}/\\d{2}/\\d{4}${e.porDelegacao ? '.*\\(por delegação\\)' : ''}`,
          ),
        ),
        `a trilha de aprovação tem de mostrar ${e.nome}${e.porDelegacao ? ' "(por delegação)"' : ''}, com a data`,
      )
      .toBeVisible()
  }
  for (const nome of ausentes) {
    await expect
      .soft(
        cartao.getByText(new RegExp(`${nome}.* — \\d{2}/\\d{2}/\\d{4}`)),
        `quem solicitou (${nome}) não pode estar entre quem aprovou`,
      )
      .toHaveCount(0)
  }
}

/** Abre a lista de Títulos e devolve o cartão do título pela descrição (espera a lista chegar). */
async function tituloDe(page: Page, descricao: string): Promise<Locator> {
  await abrirTela(page, '/financeiro/titulos?periodo=todos', 'Títulos')
  const cartao = cartaoDe(page, descricao)
  await expect(cartao.first()).toBeVisible()
  return cartao
}

/** O título "A Pagar" que a compra aprovada gerou, com o valor certo ATÉ O CENTAVO (a tela mostra por Intl pt-BR). */
async function conferirTituloDeCompra(
  page: Page,
  idSolicitacao: number,
  descricao: string,
  valor: string,
): Promise<Locator> {
  const cartao = await tituloDe(
    page,
    `Compra aprovada #${idSolicitacao} — ${descricao}`,
  )
  await expect(cartao).toHaveCount(1)
  await expect(cartao).toContainText(
    `A Pagar — Compra aprovada #${idSolicitacao} — ${descricao}`,
  )
  await expect(cartao.getByText('Pendente', { exact: true })).toBeVisible()
  await expect(cartao).toContainText(`Original ${valor} · Saldo ${valor}`)
  return cartao
}

// ------------------------------------------------------------------------------------------------ Mandatos (conflito de interesse)
const secaoDeConflitos = (page: Page): Locator =>
  page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Declarações de conflito de interesse',
    }),
  })

async function abrirMandatos(page: Page): Promise<void> {
  const carregou = aguardar(
    page,
    'GET',
    /\/api\/mandatos\/conflitos-interesse$/,
  )
  await page.goto('/governanca/mandatos')
  await expect(
    page.getByRole('heading', { name: 'Mandatos e órgãos' }),
  ).toBeVisible()
  await carregou
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
}

/** Encerra (pela tela) toda declaração de conflito ATIVA de quem casa com `nomes`. Devolve quantas. */
async function encerrarConflitosDe(page: Page, nomes: RegExp): Promise<number> {
  await abrirMandatos(page)
  // a lista de declarações não tem estado "carregando": vazia e carregando se parecem; espera as leituras terminarem antes de contar
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1_000)
  const deles = () =>
    secaoDeConflitos(page)
      .locator('div.rounded-md.border')
      .filter({ hasText: nomes })
      .filter({
        has: page.getByRole('button', { name: 'Encerrar', exact: true }),
      })
  let encerrados = 0
  while (encerrados < 10 && (await deles().count()) > 0) {
    const antes = await deles().count()
    await deles()
      .first()
      .getByRole('button', { name: 'Encerrar', exact: true })
      .click()
    await expect(deles()).toHaveCount(antes - 1)
    encerrados += 1
  }
  return encerrados
}

// ------------------------------------------------------------------------------------------------ o que o roteiro deixa para trás
// Faixas de alçada de lixo (valores acima de R$ 9.000.000,00, que nenhuma compra de teste alcança) e a faixa de R$ 1,00 a R$ 50,00 do
// roteiro "faixa inativada deixa de valer": nunca podem ficar ATIVAS, senão a recusa "sem alçada" deixa de acontecer nas rodadas seguintes.
const ALCADAS_DE_TESTE = /R\$\s9\.000\.\d{3},00|R\$\s1,00\saté\sR\$\s50,00/

/** Inativa (pela tela) toda faixa de alçada ATIVA de teste. Devolve quantas. */
async function inativarAlcadasDeTeste(page: Page): Promise<number> {
  const carregou = aguardar(page, 'GET', /\/api\/alcadas-aprovacao\/$/)
  await abrirTela(page, '/financeiro/alcadas-aprovacao', 'Alçadas de Aprovação')
  await carregou
  await page.waitForTimeout(500) // a lista não tem estado "carregando": vazia e carregando se parecem
  const ativas = () =>
    cartaoDe(page, ALCADAS_DE_TESTE).filter({
      has: page.getByText('Ativa', { exact: true }),
    })
  let inativadas = 0
  while (inativadas < 12 && (await ativas().count()) > 0) {
    const antes = await ativas().count()
    await ativas()
      .first()
      .getByRole('button', { name: 'Inativar', exact: true })
      .click()
    await expect(ativas()).toHaveCount(antes - 1)
    inativadas += 1
  }
  return inativadas
}

/** Inativa (pela tela) toda conta recorrente de teste do robô que ficou ATIVA (ela seria gerada junto na próxima competência). */
async function inativarContasRecorrentesDeTeste(page: Page): Promise<number> {
  const carregou = aguardar(page, 'GET', /\/api\/contas-a-pagar-recorrentes\/$/)
  await abrirTela(
    page,
    '/financeiro/contas-a-pagar-recorrentes',
    'Contas a Pagar Recorrentes',
  )
  await carregou
  await page.waitForTimeout(500)
  const ativas = () =>
    cartaoDe(page, 'de teste do robô').filter({
      has: page.getByRole('button', { name: 'Inativar', exact: true }),
    })
  let inativadas = 0
  while (inativadas < 12 && (await ativas().count()) > 0) {
    const antes = await ativas().count()
    await ativas()
      .first()
      .getByRole('button', { name: 'Inativar', exact: true })
      .click()
    await expect(ativas()).toHaveCount(antes - 1)
    inativadas += 1
  }
  return inativadas
}

/** Devolve o estado de teste ao que era: sem conflito ativo sobre quem aprova, sem faixa de lixo ativa, sem conta recorrente de teste ativa. */
async function limparSobras(page: Page): Promise<string[]> {
  const feito: string[] = []
  const conflitos = await encerrarConflitosDe(
    page,
    new RegExp(`${FABIO}|${ANA}`),
  )
  if (conflitos > 0)
    feito.push(`${conflitos} conflito(s) de interesse encerrado(s)`)
  const alcadas = await inativarAlcadasDeTeste(page)
  if (alcadas > 0)
    feito.push(`${alcadas} faixa(s) de alçada de teste inativada(s)`)
  const recorrentes = await inativarContasRecorrentesDeTeste(page)
  if (recorrentes > 0) {
    feito.push(`${recorrentes} conta(s) recorrente(s) de teste inativada(s)`)
  }
  return feito
}

test.afterAll(async ({ browser }) => {
  test.setTimeout(300_000)
  exigirHomologacao()
  const contexto = await browser.newContext(NAVEGADOR)
  try {
    const page = await contexto.newPage()
    await entrar(page, 'presidente')
    const feito = await limparSobras(page)
    test.info().annotations.push({
      type: 'restauro',
      description:
        feito.length > 0
          ? feito.join('; ')
          : 'nada a restaurar: o estado final é o do início',
    })
  } finally {
    await contexto.close()
  }
})

// =====================================================================================================================================
// 1. FORNECEDORES (/financeiro/fornecedores): cadastro, edição, situação cadastral e dados bancários com SEGUNDO APROVADOR
// =====================================================================================================================================
test('Fornecedores: cadastro com as recusas (vazio, CNPJ curto, só letras, repetido, dígitos errados), edição, situação cadastral e troca de dados bancários que só vale com um segundo aprovador', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const alfa = `${ALFA} ${RODADA}`
  const beta = `${BETA} ${RODADA}`
  const gama = `Gama Comércio de Teste ${RODADA}`
  const cnpjAlfa = cnpjValido((RODADA % 80_000_000) + 10_000_000)
  const cnpjBeta = cnpjValido((RODADA % 80_000_000) + 10_000_001)
  const cnpjGama = cnpjComDigitosErrados(
    cnpjValido((RODADA % 80_000_000) + 10_000_002),
  )
  const bancoAprovado = `Banco Aprovado de Teste ${RODADA}`
  const bancoRejeitado = `Banco Rejeitado de Teste ${RODADA}`
  const recusaDoProprio =
    'Quem solicitou a troca de dados bancários não pode aprová-la - exige um segundo aprovador.'
  let idAlfa = 0
  let idBeta = 0
  let idDadosAprovado = 0
  let idDadosRejeitado = 0

  const preencher = async (
    form: Locator,
    d: { razao: string; cnpj: string; telefone?: string },
  ) => {
    await form.getByPlaceholder('Razão social').fill(d.razao)
    await form.getByPlaceholder('CNPJ').fill(d.cnpj)
    await form
      .getByPlaceholder('Categoria de serviço')
      .fill('Material de escritório')
    await form.getByPlaceholder('Telefone').fill(d.telefone ?? '91933334444')
  }
  const criarFornecedor = /^\/fornecedores\/$/

  await test.step('1. o Tesoureiro cadastra os fornecedores e o sistema recusa o que está errado', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(page, '/financeiro/fornecedores', 'Fornecedores')
    await page.getByRole('button', { name: 'Novo fornecedor' }).click()
    const form = formularioDe(page, 'Salvar')
    await expect(form.getByPlaceholder('CNPJ')).toBeVisible()
    const salvar = form.getByRole('button', { name: 'Salvar', exact: true })

    // recusa 1: nada preenchido (cada falta no seu campo, uma vez só)
    await salvar.click()
    for (const mensagem of [
      'Informe a razão social.',
      'CNPJ deve ter 14 dígitos.',
      'Informe a categoria de serviço.',
      'Informe o telefone.',
    ]) {
      await expect(
        form.getByRole('alert').filter({ hasText: mensagem }),
      ).toHaveCount(1)
    }
    await ver(page, info, 'fornecedor vazio: recusado')

    // recusa 2: CNPJ curto (a tela barra antes de ir ao servidor)
    await preencher(form, { razao: alfa, cnpj: '123' })
    await salvar.click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'CNPJ deve ter 14 dígitos.' }),
    ).toHaveCount(1)
    await expect(
      form.getByRole('alert').filter({ hasText: 'Informe a razão social.' }),
    ).toHaveCount(0)
    await ver(page, info, 'fornecedor com CNPJ curto: recusado')

    // recusa 3: 14 letras passam pela tela, e o servidor recusa (não tem 14 dígitos)
    await form.getByPlaceholder('CNPJ').fill('ABCDEFGHIJKLMN')
    const letras = await acionar(page, 'POST', criarFornecedor, salvar)
    expect(letras.status()).toBe(422)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'CNPJ deve conter 14 dígitos.' }),
    ).toHaveCount(1)
    await ver(page, info, 'fornecedor com CNPJ so de letras: recusado')

    // certo: o Alfa, com o CNPJ formatado
    await form.getByPlaceholder('CNPJ').fill(cnpjAlfa)
    idAlfa = await idDe(
      await acionar(page, 'POST', criarFornecedor, salvar),
      'id_fornecedor',
    )
    await expect(form).toHaveCount(0)
    const cartaoAlfa = cartaoDe(page, alfa)
    await expect(cartaoAlfa).toContainText(cnpjAlfa)
    await expect(cartaoAlfa).toContainText('Situação cadastral: nunca validada')

    // certo: o Beta, com o CNPJ só em dígitos (o servidor normaliza e a lista mostra formatado)
    await page.getByRole('button', { name: 'Novo fornecedor' }).click()
    await preencher(form, {
      razao: beta,
      cnpj: cnpjBeta.replace(/\D/g, ''),
    })
    idBeta = await idDe(
      await acionar(page, 'POST', criarFornecedor, salvar),
      'id_fornecedor',
    )
    await expect(form).toHaveCount(0)
    await expect(cartaoDe(page, beta)).toContainText(cnpjBeta)
    await ver(page, info, 'dois fornecedores cadastrados (CNPJ formatado)')

    // recusa 4: o CNPJ do Alfa de novo, só em dígitos (é o mesmo CNPJ): o servidor recusa e nada novo entra na lista
    await page.getByRole('button', { name: 'Novo fornecedor' }).click()
    await preencher(form, {
      razao: `Repetido de Teste ${RODADA}`,
      cnpj: cnpjAlfa.replace(/\D/g, ''),
    })
    const repetido = await acionar(page, 'POST', criarFornecedor, salvar)
    expect(repetido.status()).toBe(400)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Já existe um fornecedor com esse CNPJ.' }),
    ).toBeVisible()
    await expect(cartaoDe(page, `Repetido de Teste ${RODADA}`)).toHaveCount(0)
    await expect
      .soft(
        page.getByText('Já existe um fornecedor com esse CNPJ.'),
        'a recusa do servidor aparece duas vezes na tela (no formulário e de novo acima da lista): devia aparecer uma só',
      )
      .toHaveCount(1)
    await ver(page, info, 'fornecedor com CNPJ repetido: recusado')

    // recusa 5 (achado provável): CNPJ de 14 dígitos mas com dígitos verificadores errados não é CNPJ de ninguém
    await preencher(form, { razao: gama, cnpj: cnpjGama })
    const errado = await acionar(page, 'POST', criarFornecedor, salvar)
    expect
      .soft(
        errado.ok(),
        `o sistema ACEITOU um CNPJ com dígitos verificadores errados (${cnpjGama}): app/schemas/financeiro.py::FornecedorCriar só confere os 14 dígitos`,
      )
      .toBe(false)
    if (!errado.ok()) {
      await form.getByRole('button', { name: 'Cancelar' }).click()
    }
    await expect(form).toHaveCount(0)
    await ver(
      page,
      info,
      errado.ok()
        ? 'DEFEITO: CNPJ com digitos errados foi aceito'
        : 'CNPJ com digitos errados: recusado',
    )

    // editar o Beta: o telefone muda; trocar o CNPJ pelo do Alfa é recusado e o cartão volta como estava
    const cartaoBeta = cartaoDe(page, beta)
    await cartaoBeta.getByRole('button', { name: 'Editar' }).click()
    const edicao = formularioDe(page, 'Salvar')
    await expect(edicao.getByPlaceholder('Razão social')).toHaveValue(beta)
    await edicao.getByPlaceholder('Telefone').fill('91988887777')
    const salvou = await acionar(
      page,
      'PUT',
      /\/api\/fornecedores\/\d+$/,
      edicao.getByRole('button', { name: 'Salvar', exact: true }),
    )
    expect(salvou.status()).toBe(200)
    await expect(edicao).toHaveCount(0)
    await expect(cartaoDe(page, beta)).toContainText('91988887777')
    await cartaoDe(page, beta).getByRole('button', { name: 'Editar' }).click()
    await edicao.getByPlaceholder('CNPJ').fill(cnpjAlfa)
    const edicaoRepetida = await acionar(
      page,
      'PUT',
      /\/api\/fornecedores\/\d+$/,
      edicao.getByRole('button', { name: 'Salvar', exact: true }),
    )
    expect(edicaoRepetida.status()).toBe(400)
    await expect(
      edicao
        .getByRole('alert')
        .filter({ hasText: 'Já existe um fornecedor com esse CNPJ.' }),
    ).toBeVisible()
    await ver(page, info, 'edicao com CNPJ repetido: recusada')
    await edicao.getByRole('button', { name: 'Cancelar' }).click()
    await expect(edicao).toHaveCount(0)
    await expect(cartaoDe(page, beta)).toContainText(cnpjBeta)

    // "Validar situação" (consulta pública do CNPJ): sem internet ou com CNPJ que não existe, o sistema registra "Não verificado" e segue
    await cartaoAlfa.getByRole('button', { name: 'Validar situação' }).click()
    await expect(cartaoAlfa).not.toContainText('nunca validada', {
      timeout: 45_000,
    })
    info.annotations.push({
      type: 'situação cadastral',
      description: (
        await cartaoAlfa.getByText(/^Situação cadastral:/).innerText()
      ).trim(),
    })
    await ver(page, info, 'situacao cadastral validada')

    // dados bancários: a troca nasce Pendente; quem pediu NÃO a aprova
    await cartaoAlfa
      .getByRole('button', { name: 'Dados bancários', exact: true })
      .click()
    await expect(
      cartaoAlfa.getByText('Nenhuma troca de dados bancários registrada.'),
    ).toBeVisible()
    const solicitar = async (banco: string, agencia: string, conta: string) => {
      await cartaoAlfa.getByRole('button', { name: 'Solicitar troca' }).click()
      const troca = formularioDe(
        page,
        'Solicitar (aguarda segundo aprovador)',
        cartaoAlfa,
      )
      await expect(
        troca.getByPlaceholder('Banco', { exact: true }),
      ).toBeVisible()
      await troca.getByPlaceholder('Banco', { exact: true }).fill(banco)
      await troca.getByPlaceholder('Agência', { exact: true }).fill(agencia)
      await troca.getByPlaceholder('Conta', { exact: true }).fill(conta)
      await troca
        .getByPlaceholder('Tipo (Corrente/Poupança)', { exact: true })
        .fill('Corrente')
      await troca
        .getByPlaceholder('Titular da conta', { exact: true })
        .fill(`Titular de ${banco}`)
      const resposta = await acionar(
        page,
        'POST',
        /^\/api\/fornecedores\/dados-bancarios$/,
        troca.getByRole('button', {
          name: 'Solicitar (aguarda segundo aprovador)',
        }),
      )
      const id = await idDe(resposta, 'id_dados_bancarios')
      await expect(troca).toHaveCount(0)
      return id
    }
    // recusa: tudo vazio (as cinco faltas, cada uma no seu campo)
    await cartaoAlfa.getByRole('button', { name: 'Solicitar troca' }).click()
    const trocaVazia = formularioDe(
      page,
      'Solicitar (aguarda segundo aprovador)',
      cartaoAlfa,
    )
    await trocaVazia
      .getByRole('button', { name: 'Solicitar (aguarda segundo aprovador)' })
      .click()
    for (const mensagem of [
      'Informe o banco.',
      'Informe a agência.',
      'Informe a conta.',
      'Informe o tipo de conta.',
      'Informe o titular.',
    ]) {
      await expect(
        trocaVazia.getByRole('alert').filter({ hasText: mensagem }),
      ).toHaveCount(1)
    }
    await ver(page, info, 'troca de dados bancarios vazia: recusada')
    await cartaoAlfa.getByRole('button', { name: 'Cancelar' }).click()
    await expect(trocaVazia).toHaveCount(0)

    idDadosAprovado = await solicitar(bancoAprovado, '1234', '56789-0')
    const linhaAprovado = cartaoAlfa
      .locator('div.rounded.border')
      .filter({ hasText: bancoAprovado })
    await expect(linhaAprovado).toContainText(
      `${bancoAprovado} — ag. 1234 · c. 56789-0 (Corrente)`,
    )
    await expect(
      linhaAprovado.getByText('Pendente', { exact: true }),
    ).toBeVisible()
    const proprio = await acionar(
      page,
      'POST',
      /\/api\/fornecedores\/dados-bancarios\/\d+\/aprovar$/,
      linhaAprovado.getByRole('button', { name: 'Aprovar (2º aprovador)' }),
    )
    expect(proprio.status()).toBe(400)
    await expect(cartaoAlfa.getByText(recusaDoProprio)).toBeVisible()
    await expect(
      linhaAprovado.getByText('Pendente', { exact: true }),
    ).toBeVisible()
    await ver(page, info, 'quem pediu a troca nao a aprova: recusado')

    idDadosRejeitado = await solicitar(bancoRejeitado, '4321', '09876-5')
    await expect(
      cartaoAlfa
        .locator('div.rounded.border')
        .filter({ hasText: bancoRejeitado }),
    ).toBeVisible()
    await expect
      .soft(
        cartaoAlfa.getByText(recusaDoProprio),
        'a recusa da primeira troca aparece também embaixo da segunda linha (o erro é do painel inteiro, não da linha): devia aparecer só onde foi tentado',
      )
      .toHaveCount(1)
    await ver(page, info, 'duas trocas pendentes de segundo aprovador')
    await sair(page)
  })

  await test.step('2. a Presidente (outra pessoa) aprova uma troca e rejeita a outra', async () => {
    await entrarNoFinanceiro(page, 'cargo_presidente')
    await abrirTela(page, '/financeiro/fornecedores', 'Fornecedores')
    const cartaoAlfa = cartaoDe(page, alfa)
    await cartaoAlfa
      .getByRole('button', { name: 'Dados bancários', exact: true })
      .click()
    const linhaAprovado = cartaoAlfa
      .locator('div.rounded.border')
      .filter({ hasText: bancoAprovado })
    const linhaRejeitado = cartaoAlfa
      .locator('div.rounded.border')
      .filter({ hasText: bancoRejeitado })
    await expect(
      linhaAprovado.getByText('Pendente', { exact: true }),
    ).toBeVisible()
    const aprovou = await acionar(
      page,
      'POST',
      /\/api\/fornecedores\/dados-bancarios\/\d+\/aprovar$/,
      linhaAprovado.getByRole('button', { name: 'Aprovar (2º aprovador)' }),
    )
    expect(aprovou.status()).toBe(200)
    await expect(
      linhaAprovado.getByText('Aprovado', { exact: true }),
    ).toBeVisible()
    await expect(linhaAprovado.getByRole('button')).toHaveCount(0)
    const rejeitou = await acionar(
      page,
      'POST',
      /\/api\/fornecedores\/dados-bancarios\/\d+\/rejeitar$/,
      linhaRejeitado.getByRole('button', { name: 'Rejeitar' }),
    )
    expect(rejeitou.status()).toBe(200)
    await expect(
      linhaRejeitado.getByText('Rejeitado', { exact: true }),
    ).toBeVisible()
    await expect(linhaRejeitado.getByRole('button')).toHaveCount(0)
    await ver(page, info, 'segundo aprovador: uma aprovada, a outra rejeitada')

    // Auditoria: quem fez o quê, e a recusa do próprio solicitante não deixou rastro de aprovação
    await abrirAuditoria(page, 'fornecedores')
    for (const id of [idAlfa, idBeta]) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id, quem: FABIO }),
      ).toBeVisible()
    }
    await expect(
      linhaDaAuditoria(page, 'UPDATE', { registro: idBeta, quem: FABIO }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: fornecedores criados e editado')
    await abrirAuditoria(page, 'dados_bancarios_fornecedor')
    for (const id of [idDadosAprovado, idDadosRejeitado]) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id, quem: FABIO }),
      ).toBeVisible()
    }
    await expect(
      linhasDaAuditoria(page, 'APROVACAO', { registro: idDadosAprovado }),
    ).toHaveCount(1)
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', {
        registro: idDadosAprovado,
        quem: ANA,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'REJEICAO', {
        registro: idDadosRejeitado,
        quem: ANA,
      }),
    ).toBeVisible()
    await ver(
      page,
      info,
      'auditoria: troca de dados bancarios pedida e decidida',
    )
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 2. ALÇADAS DE APROVAÇÃO (/financeiro/alcadas-aprovacao): faixas de valor, cargo exigido e dupla assinatura
// =====================================================================================================================================
test('Alçadas de aprovação: faixas com cargo e dupla assinatura, recusas na tela e no servidor, "Cancelar" sem efeito e faixa inativada que deixa de valer', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const enviadas: string[] = []
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      /\/api\/alcadas-aprovacao\/$/.test(new URL(r.url()).pathname)
    ) {
      enviadas.push(r.url())
    }
  })
  const aceitasDeLixo: number[] = []

  await entrarNoFinanceiro(page, 'presidente')
  const antes = await abrirAuditoria(page, 'alcadas_aprovacao')
  await abrirTela(page, '/financeiro/alcadas-aprovacao', 'Alçadas de Aprovação')

  const formulario = () => formularioDe(page, 'Cadastrar alçada')
  const abrirFormulario = async () => {
    if ((await formulario().count()) === 0) {
      await page.getByRole('button', { name: 'Nova alçada' }).click()
    }
    await expect(formulario()).toBeVisible()
  }
  const preencher = async (d: {
    minimo: string
    maximo: string
    cargos: string
    dupla?: boolean
  }) => {
    await abrirFormulario()
    const f = formulario()
    await f.getByPlaceholder('Valor mínimo').fill(d.minimo)
    await f.getByPlaceholder('Valor máximo (vazio = sem teto)').fill(d.maximo)
    await f
      .getByPlaceholder('Cargos (ex.: TESOUREIRO,PRESIDENTE)')
      .fill(d.cargos)
    await f.getByLabel('Exige dupla assinatura').setChecked(d.dupla ?? false)
  }
  const enviar = async (d: Parameters<typeof preencher>[0]) => {
    await preencher(d)
    return acionar(
      page,
      'POST',
      /\/api\/alcadas-aprovacao\/$/,
      formulario().getByRole('button', { name: 'Cadastrar alçada' }),
    )
  }
  const tentarSemEnviar = async (d: Parameters<typeof preencher>[0]) => {
    await preencher(d)
    await formulario().getByRole('button', { name: 'Cadastrar alçada' }).click()
  }

  await test.step('recusas que a tela faz antes de ir ao servidor', async () => {
    // tudo vazio: falta o cargo
    await tentarSemEnviar({ minimo: '0', maximo: '', cargos: '' })
    await expect(
      page.getByRole('alert').filter({
        hasText: 'Informe ao menos um cargo (códigos separados por vírgula).',
      }),
    ).toHaveCount(1)
    await ver(page, info, 'alcada sem cargo: recusada na tela')
    // valor mínimo negativo
    await tentarSemEnviar({ minimo: '-5', maximo: '', cargos: 'presidente' })
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Valor mínimo não pode ser negativo.' }),
    ).toHaveCount(1)
    expect(enviadas, 'a tela recusou: nada deve ter ido ao servidor').toEqual(
      [],
    )
    await ver(page, info, 'alcada com valor minimo negativo: recusada na tela')
  })

  await test.step('recusas do servidor (cargos só com vírgulas) e as tentativas que um sistema atento recusaria', async () => {
    // a tela deixa passar ",": o servidor recusa e a mensagem aparece no campo dos cargos
    const virgulas = await enviar({ minimo: '0', maximo: '', cargos: ',' })
    expect(virgulas.status()).toBe(422)
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Informe ao menos um cargo autorizado.' }),
    ).toHaveCount(1)
    await ver(
      page,
      info,
      'alcada com cargos so de virgula: recusada pelo servidor',
    )

    // valor máximo MENOR que o mínimo: a faixa nunca valeria para valor nenhum; a tela recusa e nada vai ao servidor
    const antesDaInvertida = enviadas.length
    await tentarSemEnviar({
      minimo: '9000100',
      maximo: '9000050',
      cargos: 'presidente',
    })
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'O valor máximo não pode ser menor que o mínimo.' }),
    ).toHaveCount(1)
    expect(enviadas.length).toBe(antesDaInvertida)
    await ver(
      page,
      info,
      'alcada com maximo menor que o minimo: recusada na tela',
    )

    // achado provável 2: o campo do valor máximo é texto livre; "9999999,99" (vírgula, como se escreve no Brasil) vira "sem teto"
    const virgula = await enviar({
      minimo: '9000200',
      maximo: '9999999,99',
      cargos: 'presidente',
    })
    if (virgula.ok()) {
      aceitasDeLixo.push(await idDe(virgula, 'id_alcada'))
      const linha = cartaoDe(page, 'R$ 9.000.200,00').first()
      await expect(linha).toBeVisible()
      await expect
        .soft(
          linha,
          'o valor máximo digitado com vírgula ("9999999,99") foi lido como "sem teto": uma faixa que devia acabar em R$ 9.999.999,99 passou a valer para qualquer valor acima do mínimo',
        )
        .toContainText('R$ 9.999.999,99')
    } else {
      await expect(page.getByRole('alert').first()).toBeVisible()
    }

    // achado provável 3: cargo que não existe no estatuto (erro de digitação) cria uma faixa que ninguém consegue usar
    const desconhecido = await enviar({
      minimo: '9000300',
      maximo: '9000399.99',
      cargos: 'CARGO_QUE_NAO_EXISTE',
    })
    if (desconhecido.ok()) {
      aceitasDeLixo.push(await idDe(desconhecido, 'id_alcada'))
    }
    expect
      .soft(
        desconhecido.ok(),
        'o sistema ACEITOU uma faixa para o cargo "CARGO_QUE_NAO_EXISTE": a lista de cargos do estatuto (Presidente, Tesoureiro...) é a única válida',
      )
      .toBe(false)
    await ver(page, info, 'alcadas: tentativas que um sistema atento recusaria')
  })

  await test.step('"Cancelar" fecha sem criar nada', async () => {
    await abrirFormulario()
    const antesDeCancelar = enviadas.length
    await formulario()
      .getByPlaceholder('Cargos (ex.: TESOUREIRO,PRESIDENTE)')
      .fill('presidente')
    await formulario().getByRole('button', { name: 'Cancelar' }).click()
    await expect(formulario()).toHaveCount(0)
    expect(enviadas.length).toBe(antesDeCancelar)
  })

  // as faixas de verdade: ATÉ 999,99 só o Presidente; de 1.000 a 4.999,99 só o Presidente; de 5.000 sem teto, Presidente OU Tesoureiro com dupla assinatura
  let idFaixa1 = 0
  let idFaixa2 = 0
  let idFaixa3 = 0
  let idFaixaMinima = 0
  await test.step('as faixas de verdade entram na lista com os valores certos', async () => {
    idFaixa1 = await idDe(
      await enviar({ minimo: '100', maximo: '999.99', cargos: 'presidente' }),
      'id_alcada',
    )
    await expect(formulario()).toHaveCount(0)
    const faixa1 = cartaoDe(page, 'R$ 100,00 até R$ 999,99')
      .filter({ hasText: 'Cargos: PRESIDENTE' })
      .first()
    await expect(faixa1.getByText('Ativa', { exact: true })).toBeVisible()
    await expect(faixa1).not.toContainText('dupla assinatura')

    idFaixa2 = await idDe(
      await enviar({ minimo: '1000', maximo: '4999.99', cargos: 'PRESIDENTE' }),
      'id_alcada',
    )
    await expect(formulario()).toHaveCount(0)
    await expect(
      cartaoDe(page, 'R$ 1.000,00 até R$ 4.999,99')
        .filter({ hasText: 'Cargos: PRESIDENTE' })
        .first(),
    ).toBeVisible()

    idFaixa3 = await idDe(
      await enviar({
        minimo: '5000',
        maximo: '',
        cargos: 'presidente, tesoureiro',
        dupla: true,
      }),
      'id_alcada',
    )
    await expect(formulario()).toHaveCount(0)
    await expect(
      cartaoDe(page, 'R$ 5.000,00 até sem teto')
        .filter({
          hasText: 'Cargos: PRESIDENTE, TESOUREIRO · exige dupla assinatura',
        })
        .first(),
    ).toBeVisible()
    await ver(page, info, 'tres faixas de alcada criadas')
  })

  await test.step('uma faixa inativada deixa de valer: Inativar muda a situação e o botão', async () => {
    const minima = () => cartaoDe(page, /R\$\s1,00\saté\sR\$\s50,00/)
    const ativas = () =>
      minima().filter({ has: page.getByText('Ativa', { exact: true }) })
    const inativas = () =>
      minima().filter({ has: page.getByText('Inativa', { exact: true }) })
    idFaixaMinima = await idDe(
      await enviar({ minimo: '1', maximo: '50', cargos: 'presidente' }),
      'id_alcada',
    )
    await expect(formulario()).toHaveCount(0)
    await expect(ativas()).toHaveCount(1)
    const jaInativas = await inativas().count()
    await ver(page, info, 'faixa de R$ 1,00 a R$ 50,00 ativa')
    const inativou = await acionar(
      page,
      'PUT',
      /\/api\/alcadas-aprovacao\/\d+\/ativo$/,
      ativas().getByRole('button', { name: 'Inativar', exact: true }),
    )
    expect(inativou.status()).toBe(200)
    await expect(ativas()).toHaveCount(0)
    await expect(inativas()).toHaveCount(jaInativas + 1)
    await expect(
      inativas().first().getByRole('button', { name: 'Reativar', exact: true }),
    ).toBeVisible()
    await ver(
      page,
      info,
      'faixa inativada: some das ativas, botao vira Reativar',
    )
  })

  const inativadasDeLixo = await inativarAlcadasDeTeste(page)
  expect(
    inativadasDeLixo,
    'cada faixa de lixo que a tela aceitou tem de estar inativa ao fim',
  ).toBeGreaterThanOrEqual(aceitasDeLixo.length)

  await test.step('Auditoria: cada faixa criada e a inativação; as recusas não deixaram rastro', async () => {
    const depois = await abrirAuditoria(page, 'alcadas_aprovacao')
    // criadas: 4 faixas de verdade + as de lixo aceitas; mudanças: a inativação da faixa mínima + a de cada faixa de lixo (e de sobras de rodadas anteriores)
    expect(depois - antes).toBe(4 + 1 + aceitasDeLixo.length + inativadasDeLixo)
    for (const id of [idFaixa1, idFaixa2, idFaixa3, idFaixaMinima]) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id, quem: MARTA }),
      ).toBeVisible()
    }
    await expect(
      linhasDaAuditoria(page, 'UPDATE', { registro: idFaixaMinima }),
    ).toHaveCount(1)
    await ver(page, info, 'auditoria: faixas de alcada criadas e inativada')
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 3. COMPRA SIMPLES (R$ 123,45, sem cotação) e COMPRA SEM ALÇADA (R$ 5,55): o Tesoureiro prepara, quem criou não aprova, a Presidente aprova
// =====================================================================================================================================
test('Compra simples: o Tesoureiro prepara e não aprova a própria, quem não tem o cargo é recusado, a Presidente pelo cargo aprova e o título sai com R$ 123,45; sem alçada para o valor a compra não anda e pode ser reprovada', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const semAlcada = `Compra de teste do robô ${RODADA} [sem alçada]`
  const simples = `Compra de teste do robô ${RODADA} [simples]`
  let idSemAlcada = 0
  let idSimples = 0

  await test.step('1. o Tesoureiro prepara as duas solicitações e tenta aprovar a própria', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    await page.getByRole('button', { name: 'Nova solicitação' }).click()
    const form = formularioDe(page, 'Criar solicitação')
    await expect(form.getByPlaceholder('Descrição da compra')).toBeVisible()

    // recusa 1: nada preenchido
    await form.getByRole('button', { name: 'Criar solicitação' }).click()
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Informe a descrição da compra.' }),
    ).toHaveCount(1)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Valor estimado deve ser maior que zero.' }),
    ).toHaveCount(1)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Selecione a conta contábil (Despesa).' }),
    ).toHaveCount(1)
    await ver(page, info, 'solicitacao de compra vazia: recusada')

    // recusa 2: descrição curta e valor negativo
    await form.getByPlaceholder('Descrição da compra').fill('ab')
    await form.getByPlaceholder('Valor estimado').fill('-1')
    await escolherContaDeDespesa(form.locator('select'))
    await form.getByRole('button', { name: 'Criar solicitação' }).click()
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Informe a descrição da compra.' }),
    ).toHaveCount(1)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Valor estimado deve ser maior que zero.' }),
    ).toHaveCount(1)
    // o "Cancelar" deste formulário é o botão que abriu (ele troca de nome); dentro do formulário não há outro
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(form).toHaveCount(0)

    idSemAlcada = await criarSolicitacao(page, {
      descricao: semAlcada,
      valor: '5.55',
      justificativa: 'Valor abaixo de qualquer faixa de alçada.',
    })
    idSimples = await criarSolicitacao(page, {
      descricao: simples,
      valor: '123.45',
    })
    await expect(cartaoDe(page, semAlcada)).toContainText(
      'Valor estimado: R$ 5,55',
    )
    await expect(cartaoDe(page, simples)).toContainText(
      'Valor estimado: R$ 123,45',
    )
    await ver(page, info, 'duas solicitacoes de compra criadas pelo Tesoureiro')

    // quem criou não aprova (403, a mensagem aparece logo abaixo do botão e a compra continua aguardando)
    const cartao = cartaoDe(page, simples)
    const propria = await tentarAprovarCompra(page, cartao)
    expect(propria.status()).toBe(403)
    await expect(cartao.getByText(MENSAGEM.proprio)).toBeVisible()
    await expect(
      cartao.getByText('Aguardando Aprovação', { exact: true }),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro tenta aprovar a propria compra: recusado')
    await sair(page)
  })

  await test.step('2. a Presidente de teste (sem mandato) tenta aprovar: não tem o cargo exigido', async () => {
    await entrarNoFinanceiro(page, 'presidente')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, simples)
    await expect(cartao).toBeVisible()
    const semCargo = await tentarAprovarCompra(page, cartao)
    expect(semCargo.status()).toBe(403)
    await expect(
      cartao.getByText(MENSAGEM.semCargo('PRESIDENTE')),
    ).toBeVisible()
    await expect(
      cartao.getByText('Aguardando Aprovação', { exact: true }),
    ).toBeVisible()
    await ver(page, info, 'quem nao tem o cargo da alcada: recusado')
    await sair(page)
  })

  await test.step('3. a Presidente pelo cargo: sem alçada o valor não anda (e é reprovado com motivo); a compra simples é aprovada e vira título', async () => {
    await entrarNoFinanceiro(page, 'cargo_presidente')
    await abrirTela(page, '/financeiro/compras', 'Compras')

    // R$ 5,55 está abaixo de toda faixa ativa (a de R$ 1,00 a R$ 50,00 está inativa)
    const cartaoSem = cartaoDe(page, semAlcada)
    await expect(cartaoSem).toBeVisible()
    const recusada = await tentarAprovarCompra(page, cartaoSem)
    expect(recusada.status()).toBe(400)
    await expect(cartaoSem.getByText(MENSAGEM.semAlcada('5.55'))).toBeVisible()
    await expect(
      cartaoSem.getByText('Aguardando Aprovação', { exact: true }),
    ).toBeVisible()
    await ver(page, info, 'valor sem alcada: aprovacao recusada')
    await reprovarCompra(
      page,
      cartaoSem,
      `Sem alçada para o valor (robô ${RODADA})`,
    )
    await ver(page, info, 'compra sem alcada reprovada com motivo')

    // a compra simples: aprovada por quem tem o cargo, com um clique só (R$ 123,45 cabe na faixa de R$ 100,00 a R$ 999,99)
    const cartao = cartaoDe(page, simples)
    const aprovada = await tentarAprovarCompra(page, cartao)
    expect(aprovada.status()).toBe(200)
    await expect(cartao.getByText('Aprovada', { exact: true })).toBeVisible()
    await expect(
      cartao.getByRole('button', { name: 'Cotações / Aprovar' }),
    ).toHaveCount(0)
    // a trilha da compra decidida: só a Presidente aprovou, e o Tesoureiro (que pediu) não está nela
    await conferirTrilhaDeAprovacao(cartao, [{ nome: ANA }], [FABIO])
    await ver(page, info, 'compra simples aprovada pela Presidente do cargo')

    // o título "A Pagar" nasceu com o valor certo, até o centavo; "Baixar" abre o formulário de pagamento (sem pagar)
    const titulo = await conferirTituloDeCompra(
      page,
      idSimples,
      simples,
      'R$ 123,45',
    )
    await titulo.getByRole('button', { name: 'Baixar', exact: true }).click()
    await expect(titulo.getByPlaceholder('Valor pago')).toBeVisible()
    await expect(titulo.getByPlaceholder('Forma de pagamento')).toBeVisible()
    await ver(page, info, 'titulo da compra: R$ 123,45 e formulario de baixa')
    await titulo.getByRole('button', { name: 'Cancelar baixa' }).click()
    await expect(titulo.getByPlaceholder('Valor pago')).toHaveCount(0)

    // Auditoria: criadas pelo Tesoureiro; só UMA aprovação, da Presidente (as recusas não deixaram rastro); a reprovação
    await abrirAuditoria(page, 'solicitacoes_compra')
    for (const id of [idSemAlcada, idSimples]) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id, quem: FABIO }),
      ).toBeVisible()
    }
    await expect(
      linhasDaAuditoria(page, 'APROVACAO', { registro: idSimples }),
    ).toHaveCount(1)
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', { registro: idSimples, quem: ANA }),
    ).toBeVisible()
    await expect(
      linhasDaAuditoria(page, 'APROVACAO', { registro: idSemAlcada }),
    ).toHaveCount(0)
    await expect(
      linhaDaAuditoria(page, 'REPROVACAO', {
        registro: idSemAlcada,
        quem: ANA,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: compras criadas, aprovada e reprovada')
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 4. COTAÇÃO EXIGIDA ACIMA DO VALOR CONFIGURADO (R$ 1.000,00, duas cotações): sem elas não se aprova
// =====================================================================================================================================
test('Cotações: acima de R$ 1.000,00 a aprovação exige duas cotações (0 e 1 são recusadas), quem não tem o cargo é recusado e duas cotações do MESMO fornecedor não deveriam bastar', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const cotada = `Compra de teste do robô ${RODADA} [cotação]`
  const mesmoFornecedor = `Compra de teste do robô ${RODADA} [mesmo fornecedor]`
  let idCotada = 0
  let idMesmoFornecedor = 0
  const cotacoes: number[] = []

  await test.step('1. Marta (administradora) prepara e vai juntando as cotações', async () => {
    await entrarNoFinanceiro(page, 'presidente')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    idCotada = await criarSolicitacao(page, {
      descricao: cotada,
      valor: '2345.67',
    })
    idMesmoFornecedor = await criarSolicitacao(page, {
      descricao: mesmoFornecedor,
      valor: '1100.00',
    })
    const cartao = cartaoDe(page, cotada)
    await expect(cartao).toContainText('Valor estimado: R$ 2.345,67')

    // sem cotação nenhuma: recusado
    const nenhuma = await tentarAprovarCompra(page, cartao)
    expect(nenhuma.status()).toBe(400)
    await expect(cartao.getByText(MENSAGEM.cotacoes(0))).toBeVisible()
    await expect(cartao.getByText(/Valor acima de R\$ 1\.000,00/)).toBeVisible()
    await ver(page, info, 'compra acima de R$ 1.000,00 sem cotacao: recusada')

    // cotação vazia é recusada na tela
    const form = formularioDe(page, 'Adicionar cotação', cartao)
    await form.getByRole('button', { name: 'Adicionar cotação' }).click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'Selecione o fornecedor.' }),
    ).toHaveCount(1)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Valor deve ser maior que zero.' }),
    ).toHaveCount(1)
    await ver(page, info, 'cotacao vazia: recusada')

    // uma cotação só: ainda recusado
    cotacoes.push(await adicionarCotacao(page, cartao, ALFA, '2345.67'))
    await expect(
      cartao.locator('p.text-xs').filter({ hasText: 'R$ 2.345,67' }),
    ).toHaveCount(1)
    const uma = await tentarAprovarCompra(page, cartao)
    expect(uma.status()).toBe(400)
    await expect(cartao.getByText(MENSAGEM.cotacoes(1))).toBeVisible()
    await ver(page, info, 'uma cotacao so: aprovacao ainda recusada')

    // a segunda cotação (outro fornecedor, valor com centavos): agora o pedido é só o da segregação (Marta criou, não aprova)
    cotacoes.push(await adicionarCotacao(page, cartao, BETA, '2399.90'))
    await expect(
      cartao.locator('p.text-xs').filter({ hasText: 'R$ 2.399,90' }),
    ).toHaveCount(1)
    const propria = await tentarAprovarCompra(page, cartao)
    expect(propria.status()).toBe(403)
    await expect(cartao.getByText(MENSAGEM.proprio)).toBeVisible()
    await ver(
      page,
      info,
      'duas cotacoes: quem criou continua sem poder aprovar',
    )

    // a outra compra: duas cotações, mas as duas do MESMO fornecedor
    const outro = cartaoDe(page, mesmoFornecedor)
    cotacoes.push(await adicionarCotacao(page, outro, ALFA, '1100.00'))
    cotacoes.push(await adicionarCotacao(page, outro, ALFA, '1150.00'))
    await expect(
      outro.locator('p.text-xs').filter({ hasText: '— R$' }),
    ).toHaveCount(2)
    await ver(page, info, 'duas cotacoes do mesmo fornecedor')
    await sair(page)
  })

  await test.step('2. o Tesoureiro (cargo que a faixa não autoriza) é recusado', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, cotada)
    await expect(cartao).toBeVisible()
    const semCargo = await tentarAprovarCompra(page, cartao)
    expect(semCargo.status()).toBe(403)
    await expect(
      cartao.getByText(MENSAGEM.semCargo('PRESIDENTE')),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro sem o cargo da faixa: recusado')
    await sair(page)
  })

  await test.step('3. a Presidente pelo cargo aprova (R$ 2.345,67 no título); o caso do mesmo fornecedor mostra se o controle de cotações vale', async () => {
    await entrarNoFinanceiro(page, 'cargo_presidente')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, cotada)
    const aprovada = await tentarAprovarCompra(page, cartao)
    expect(aprovada.status()).toBe(200)
    await expect(cartao.getByText('Aprovada', { exact: true })).toBeVisible()
    await conferirTrilhaDeAprovacao(cartao, [{ nome: ANA }], [MARTA])
    await ver(page, info, 'compra cotada aprovada pela Presidente do cargo')

    const outro = cartaoDe(page, mesmoFornecedor)
    const doMesmo = await tentarAprovarCompra(page, outro)
    expect
      .soft(
        doMesmo.ok(),
        'a compra foi APROVADA com duas cotações do MESMO fornecedor: o servidor só conta quantas cotações existem (app/services/compras.py), não quantos fornecedores diferentes; o controle "comparar fornecedores" não protege nada',
      )
      .toBe(false)
    if (!doMesmo.ok()) {
      await reprovarCompra(
        page,
        outro,
        `Cotações do mesmo fornecedor (robô ${RODADA})`,
      )
    }
    await ver(
      page,
      info,
      doMesmo.ok()
        ? 'DEFEITO: duas cotacoes do mesmo fornecedor bastaram'
        : 'mesmo fornecedor nas duas cotacoes: recusado',
    )

    await conferirTituloDeCompra(page, idCotada, cotada, 'R$ 2.345,67')
    await ver(page, info, 'titulo da compra cotada: R$ 2.345,67')

    await abrirAuditoria(page, 'cotacoes_compra')
    for (const id of cotacoes) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id, quem: MARTA }),
      ).toBeVisible()
    }
    await abrirAuditoria(page, 'solicitacoes_compra')
    for (const id of [idCotada, idMesmoFornecedor]) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id, quem: MARTA }),
      ).toBeVisible()
    }
    await expect(
      linhasDaAuditoria(page, 'APROVACAO', { registro: idCotada }),
    ).toHaveCount(1)
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', { registro: idCotada, quem: ANA }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: cotacoes e compra cotada')
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 5. DUPLA ASSINATURA (a partir de R$ 5.000,00: duas aprovações de PESSOAS DIFERENTES)
// =====================================================================================================================================
test('Dupla assinatura: a primeira aprovação não gera título, a mesma pessoa duas vezes é recusada, a segunda pessoa conclui e o título sai com R$ 7.654,32', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const dupla = `Compra de teste do robô ${RODADA} [dupla assinatura]`
  let idDupla = 0

  await test.step('1. Marta prepara a compra de R$ 7.654,32 com duas cotações e não aprova a própria', async () => {
    await entrarNoFinanceiro(page, 'presidente')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    idDupla = await criarSolicitacao(page, {
      descricao: dupla,
      valor: '7654.32',
    })
    const cartao = cartaoDe(page, dupla)
    await adicionarCotacao(page, cartao, ALFA, '7654.32')
    await adicionarCotacao(page, cartao, BETA, '7700.01')
    const propria = await tentarAprovarCompra(page, cartao)
    expect(propria.status()).toBe(403)
    await expect(cartao.getByText(MENSAGEM.proprio)).toBeVisible()
    await ver(page, info, 'compra de dupla assinatura preparada')
    await sair(page)
  })

  await test.step('2. o Tesoureiro dá a primeira aprovação (1/2); repetir a mesma pessoa é recusado; ainda não há título', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, dupla)
    await expect(cartao).toBeVisible()
    const primeira = await tentarAprovarCompra(page, cartao)
    expect(primeira.status()).toBe(200)
    await expect(cartao.getByText(MENSAGEM.primeiraDeDuas)).toBeVisible()
    await expect(
      cartao.getByText('Aguardando Aprovação', { exact: true }),
    ).toBeVisible()
    await expect
      .soft(
        cartao.getByText(new RegExp(`${FABIO}.* — \\d{2}/\\d{2}/\\d{4}`)),
        'a trilha "Aprovações" do painel deve mostrar quem já aprovou (nome e data)',
      )
      .toBeVisible()
    await ver(
      page,
      info,
      'primeira aprovacao (1/2): compra continua aguardando',
    )

    const repetida = await acionar(
      page,
      'POST',
      /\/api\/solicitacoes-compra\/\d+\/aprovar$/,
      cartao.getByRole('button', { name: 'Aprovar', exact: true }),
    )
    expect(repetida.status()).toBe(400)
    await expect(cartao.getByText(MENSAGEM.jaAprovou)).toBeVisible()
    await ver(page, info, 'a mesma pessoa aprovando de novo: recusado')

    // com uma aprovação só, nenhum título: a lista de títulos (que já tem os das outras compras) não traz este
    await abrirTela(page, '/financeiro/titulos?periodo=todos', 'Títulos')
    await expect(page.locator('div.rounded-md.border').first()).toBeVisible()
    await expect(
      cartaoDe(page, `Compra aprovada #${idDupla} — ${dupla}`),
    ).toHaveCount(0)
    await sair(page)
  })

  await test.step('3. a Presidente pelo cargo dá a segunda aprovação: a compra é aprovada e o título nasce com R$ 7.654,32', async () => {
    await entrarNoFinanceiro(page, 'cargo_presidente')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, dupla)
    await abrirPainelDaCompra(cartao)
    await expect
      .soft(
        cartao.getByText(new RegExp(`${FABIO}.* — \\d{2}/\\d{2}/\\d{4}`)),
        'a segunda pessoa tem de ver, antes de aprovar, quem deu a primeira aprovação',
      )
      .toBeVisible()
    const segunda = await tentarAprovarCompra(page, cartao)
    expect(segunda.status()).toBe(200)
    await expect(cartao.getByText('Aprovada', { exact: true })).toBeVisible()
    await conferirTrilhaDeAprovacao(
      cartao,
      [{ nome: FABIO }, { nome: ANA }],
      [MARTA],
    )
    await ver(
      page,
      info,
      'segunda aprovacao: compra de dupla assinatura aprovada',
    )
    await conferirTituloDeCompra(page, idDupla, dupla, 'R$ 7.654,32')
    await ver(page, info, 'titulo da dupla assinatura: R$ 7.654,32')

    // Auditoria: duas aprovações, de duas pessoas (a repetida não deixou rastro)
    await abrirAuditoria(page, 'solicitacoes_compra', 'APROVACAO')
    await expect(
      linhasDaAuditoria(page, 'APROVACAO', { registro: idDupla }),
    ).toHaveCount(2)
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', { registro: idDupla, quem: FABIO }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', { registro: idDupla, quem: ANA }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: duas aprovacoes de pessoas diferentes')
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 6. DELEGAÇÃO TEMPORÁRIA (a Presidente delega a aprovação ao Heitor, que não tem o cargo): rastreável, e só vale por pouco tempo
// =====================================================================================================================================
test('Delegação temporária: recusas do formulário, a Presidente delega ao Heitor (que não tem o cargo) e a aprovação dele vale como delegada, com o Tesoureiro dando a segunda assinatura', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  const compra = `Compra de teste do robô ${RODADA} [delegação]`
  const motivo = `Férias de teste do robô ${RODADA}`
  const validaAte = diaEmBelem(2)
  let idCompra = 0
  let idDelegacao = 0

  await test.step('1. Marta prepara a compra de R$ 8.765,43 (dupla assinatura) com duas cotações', async () => {
    await entrarNoFinanceiro(page, 'presidente')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    idCompra = await criarSolicitacao(page, {
      descricao: compra,
      valor: '8765.43',
    })
    const cartao = cartaoDe(page, compra)
    await adicionarCotacao(page, cartao, ALFA, '8765.43')
    await adicionarCotacao(page, cartao, BETA, '8800.00')
    await ver(page, info, 'compra para a delegacao preparada')
    await sair(page)
  })

  await test.step('2. a Presidente pelo cargo registra a delegação ao Heitor (com as recusas do formulário)', async () => {
    await entrarNoFinanceiro(page, 'cargo_presidente')
    await abrirTela(
      page,
      '/financeiro/alcadas-aprovacao',
      'Alçadas de Aprovação',
    )
    await page.getByRole('button', { name: 'Nova delegação' }).click()
    const form = formularioDe(page, 'Registrar delegação')
    const quemDelega = selectCom(page, form, 'Quem delega')
    const delegado = selectCom(page, form, 'Delegado (quem vai aprovar)')
    await expect(form.locator('input[type="date"]')).toBeVisible()

    // recusa 1: nada preenchido (as quatro faltas)
    await form.getByRole('button', { name: 'Registrar delegação' }).click()
    for (const mensagem of [
      'Selecione quem delega.',
      'Selecione o delegado.',
      'Informe até quando vale a delegação.',
      'Informe o motivo da delegação.',
    ]) {
      await expect(
        form.getByRole('alert').filter({ hasText: mensagem }),
      ).toHaveCount(1)
    }
    await ver(page, info, 'delegacao vazia: recusada')

    // recusa 2: motivo curto demais
    await escolherOpcao(quemDelega, ANA)
    await escolherOpcao(delegado, HEITOR)
    await form.locator('input[type="date"]').fill(validaAte.iso)
    await form.getByPlaceholder('Motivo (ex.: férias)').fill('abc')
    await form.getByRole('button', { name: 'Registrar delegação' }).click()
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Informe o motivo da delegação.' }),
    ).toHaveCount(1)

    // recusa 3: o fim da delegação é ontem (o servidor recusa: o fim tem de ser depois do início)
    await form.getByPlaceholder('Motivo (ex.: férias)').fill(motivo)
    await form.locator('input[type="date"]').fill(diaEmBelem(-1).iso)
    const noPassado = await acionar(
      page,
      'POST',
      /\/api\/delegacoes-aprovacao\/$/,
      form.getByRole('button', { name: 'Registrar delegação' }),
    )
    expect(noPassado.status()).toBe(400)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Data de fim deve ser depois da data de início.' }),
    ).toBeVisible()
    await ver(page, info, 'delegacao que ja terminou: recusada')

    // certo: vale por dois dias
    await form.locator('input[type="date"]').fill(validaAte.iso)
    idDelegacao = await idDe(
      await acionar(
        page,
        'POST',
        /\/api\/delegacoes-aprovacao\/$/,
        form.getByRole('button', { name: 'Registrar delegação' }),
      ),
      'id_delegacao',
    )
    await expect(form).toHaveCount(0)
    const linha = cartaoDe(page, motivo)
    await expect(linha.first()).toBeVisible()
    await expect
      .soft(
        linha.first(),
        'a delegação aparece como "Associado #n → Associado #n": quem delegou e quem recebeu têm de aparecer pelo nome',
      )
      .toContainText(HEITOR)
    await expect
      .soft(
        linha.first(),
        `a data de fim da delegação aparece crua ("até 2026-10-08T00:00:00"): devia ser "até ${validaAte.br}"`,
      )
      .toContainText(`até ${validaAte.br}`)
    await ver(page, info, 'delegacao registrada')
    await sair(page)
  })

  await test.step('3. o Heitor, que não tem o cargo, dá a primeira aprovação como delegado', async () => {
    await entrarNoFinanceiro(page, 'conselheiro')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, compra)
    await expect(cartao).toBeVisible()
    const delegada = await tentarAprovarCompra(page, cartao)
    expect(
      delegada.status(),
      'com a delegação da Presidente, o Heitor deveria poder aprovar (1/2)',
    ).toBe(200)
    await expect(cartao.getByText(MENSAGEM.primeiraDeDuas)).toBeVisible()
    await ver(page, info, 'Heitor aprova por delegacao (1/2)')
    await sair(page)
  })

  await test.step('4. o Tesoureiro vê quem aprovou por delegação, tenta registrar uma delegação em nome da Presidente e dá a segunda assinatura', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, compra)
    await abrirPainelDaCompra(cartao)
    await expect
      .soft(
        cartao.getByText(
          new RegExp(`${HEITOR}.* — \\d{2}/\\d{2}/\\d{4}.*\\(por delegação\\)`),
        ),
        'a trilha de aprovação deve mostrar o Heitor e "(por delegação)": é o rastro de que a aprovação foi no lugar de quem tem o cargo',
      )
      .toBeVisible()
    const segunda = await tentarAprovarCompra(page, cartao)
    expect(segunda.status()).toBe(200)
    await expect(cartao.getByText('Aprovada', { exact: true })).toBeVisible()
    await conferirTrilhaDeAprovacao(
      cartao,
      [{ nome: HEITOR, porDelegacao: true }, { nome: FABIO }],
      [MARTA],
    )
    await ver(page, info, 'segunda assinatura do Tesoureiro: compra aprovada')
    await conferirTituloDeCompra(page, idCompra, compra, 'R$ 8.765,43')
    await ver(page, info, 'titulo da compra delegada: R$ 8.765,43')

    // achado provável: o Tesoureiro (que prepara compras) registra uma delegação "da Presidente" para uma associada sem login (inofensiva)
    await abrirTela(
      page,
      '/financeiro/alcadas-aprovacao',
      'Alçadas de Aprovação',
    )
    await page.getByRole('button', { name: 'Nova delegação' }).click()
    const form = formularioDe(page, 'Registrar delegação')
    await escolherOpcao(selectCom(page, form, 'Quem delega'), ANA)
    await escolherOpcao(
      selectCom(page, form, 'Delegado (quem vai aprovar)'),
      KARINA,
    )
    await form.locator('input[type="date"]').fill(validaAte.iso)
    await form
      .getByPlaceholder('Motivo (ex.: férias)')
      .fill(`Delegação em nome de outra pessoa, de teste do robô ${RODADA}`)
    const indevida = await acionar(
      page,
      'POST',
      /\/api\/delegacoes-aprovacao\/$/,
      form.getByRole('button', { name: 'Registrar delegação' }),
    )
    expect
      .soft(
        indevida.ok(),
        'o Tesoureiro REGISTROU uma delegação em nome da Presidente: o servidor (app/routers/compras.py::registrar_delegacao) só exige a permissão financeiro e não confere que quem registra é o delegante; com isso qualquer um dá a si ou a um cúmplice o poder de aprovar',
      )
      .toBe(false)
    if (!indevida.ok()) {
      await form.getByRole('button', { name: 'Cancelar' }).click()
    }
    await ver(
      page,
      info,
      indevida.ok()
        ? 'DEFEITO: delegacao em nome de outra pessoa foi aceita'
        : 'delegacao em nome de outra pessoa: recusada',
    )
    await sair(page)
  })

  await test.step('5. Auditoria: a delegação (pela Presidente) e as duas aprovações (do Heitor e do Tesoureiro)', async () => {
    await entrarNoFinanceiro(page, 'cargo_presidente')
    await abrirAuditoria(page, 'delegacoes_aprovacao')
    await expect(
      linhaDaAuditoria(page, 'CREATE', { registro: idDelegacao, quem: ANA }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: delegacao registrada pela Presidente')
    await abrirAuditoria(page, 'solicitacoes_compra', 'APROVACAO')
    await expect(
      linhasDaAuditoria(page, 'APROVACAO', { registro: idCompra }),
    ).toHaveCount(2)
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', { registro: idCompra, quem: HEITOR }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', { registro: idCompra, quem: FABIO }),
    ).toBeVisible()
    await ver(
      page,
      info,
      'auditoria: aprovacao delegada e a segunda assinatura',
    )
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 7. CONFLITO DE INTERESSE do aprovador (declarado em /governanca/mandatos): quem tem conflito ativo não aprova
// =====================================================================================================================================
test('Conflito de interesse: declarado sobre o Tesoureiro, ele é recusado ao aprovar; encerrado o conflito, a aprovação volta a valer', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const compra = `Compra de teste do robô ${RODADA} [conflito de interesse]`
  const descricaoDoConflito = `Conflito de teste ${RODADA}: parente do Tesoureiro é sócio de fornecedor de teste`
  let idCompra = 0
  let idDeclaracao = 0

  await test.step('1. Marta prepara a compra de R$ 9.876,54 e declara o conflito de interesse do Tesoureiro', async () => {
    await entrarNoFinanceiro(page, 'presidente')
    // sobra de uma rodada que caiu no meio: um conflito esquecido bloquearia o Tesoureiro em todas as aprovações
    await encerrarConflitosDe(page, new RegExp(FABIO))
    await abrirTela(page, '/financeiro/compras', 'Compras')
    idCompra = await criarSolicitacao(page, {
      descricao: compra,
      valor: '9876.54',
    })
    const cartao = cartaoDe(page, compra)
    await adicionarCotacao(page, cartao, ALFA, '9876.54')
    await adicionarCotacao(page, cartao, BETA, '9910.00')

    await abrirMandatos(page)
    await page.getByRole('button', { name: 'Declarar conflito' }).click()
    const associado = page.getByLabel('Associado do conflito de interesse')
    await escolherOpcao(associado, FABIO)
    await page
      .getByPlaceholder('Descreva o conflito de interesse')
      .fill(descricaoDoConflito)
    idDeclaracao = await idDe(
      await acionar(
        page,
        'POST',
        /\/api\/mandatos\/conflitos-interesse$/,
        page.getByRole('button', { name: 'Declarar', exact: true }),
      ),
      'id_declaracao',
    )
    await expect(associado).toHaveCount(0)
    const cartaoDoConflito = secaoDeConflitos(page)
      .locator('div.rounded-md.border')
      .filter({ hasText: descricaoDoConflito })
    await expect(cartaoDoConflito).toContainText(FABIO)
    await ver(page, info, 'conflito de interesse declarado sobre o Tesoureiro')
    await sair(page)
  })

  await test.step('2. o Tesoureiro (cargo autorizado na faixa) é recusado por causa do conflito', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, compra)
    await expect(cartao).toBeVisible()
    const comConflito = await tentarAprovarCompra(page, cartao)
    expect(comConflito.status()).toBe(403)
    await expect(cartao.getByText(MENSAGEM.conflito)).toBeVisible()
    await expect(
      cartao.getByText('Aguardando Aprovação', { exact: true }),
    ).toBeVisible()
    await ver(page, info, 'aprovador com conflito de interesse: recusado')
    await sair(page)
  })

  await test.step('3. Marta encerra o conflito (a Auditoria registra a declaração e o encerramento)', async () => {
    await entrarNoFinanceiro(page, 'presidente')
    expect(await encerrarConflitosDe(page, new RegExp(FABIO))).toBeGreaterThan(
      0,
    )
    await expect(
      secaoDeConflitos(page)
        .locator('div.rounded-md.border')
        .filter({ hasText: descricaoDoConflito }),
    ).toHaveCount(0)
    await ver(page, info, 'conflito encerrado: sai das declaracoes ativas')
    await abrirAuditoria(page, 'declaracoes_conflito_interesse')
    await expect(
      linhaDaAuditoria(page, 'CREATE', { registro: idDeclaracao, quem: MARTA }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'ENCERRADA', {
        registro: idDeclaracao,
        quem: MARTA,
      }),
    ).toBeVisible()
    await abrirAuditoria(page, 'solicitacoes_compra')
    await expect(
      linhaDaAuditoria(page, 'CREATE', { registro: idCompra, quem: MARTA }),
    ).toBeVisible()
    await expect(
      linhasDaAuditoria(page, 'APROVACAO', { registro: idCompra }),
    ).toHaveCount(0)
    await ver(
      page,
      info,
      'auditoria: conflito declarado e encerrado, sem aprovacao',
    )
    await sair(page)
  })

  await test.step('4. sem o conflito o Tesoureiro aprova (1/2); a compra é reprovada com motivo para não ficar pendente', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(page, '/financeiro/compras', 'Compras')
    const cartao = cartaoDe(page, compra)
    const livre = await tentarAprovarCompra(page, cartao)
    expect(
      livre.status(),
      'encerrado o conflito, o Tesoureiro volta a poder aprovar',
    ).toBe(200)
    await expect(cartao.getByText(MENSAGEM.primeiraDeDuas)).toBeVisible()
    await ver(page, info, 'conflito encerrado: Tesoureiro aprova (1/2)')
    await reprovarCompra(
      page,
      cartao,
      `Encerrada pelo robô: só provava o conflito de interesse (${RODADA})`,
    )
    await ver(page, info, 'compra do conflito reprovada com motivo')
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 8. REEMBOLSO DE DESPESA (/financeiro/reembolso-despesa): comprovante obrigatório, quem lançou não aprova, e o título que sai
// =====================================================================================================================================
test('Reembolso: comprovante obrigatório, quem lançou não aprova nem reprova o próprio, o beneficiário não deveria aprovar o que recebe, e o título sai com o valor ao centavo', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  const r1 = `Reembolso de teste do robô ${RODADA} [R1 beneficiária sem login]`
  const r2 = `Reembolso de teste do robô ${RODADA} [R2 o beneficiário aprova]`
  const r3 = `Reembolso de teste do robô ${RODADA} [R3 reprovado]`
  let idR1 = 0
  let idR2 = 0
  let idR3 = 0

  /** Com a tela aberta: preenche o formulário (comprovante é um JPEG de verdade gerado pelo navegador), envia e devolve o número do reembolso. */
  const solicitar = async (d: {
    beneficiario: string
    valor: string
    descricao: string
  }): Promise<number> => {
    if ((await formularioDe(page, 'Solicitar reembolso').count()) === 0) {
      await page.getByRole('button', { name: 'Solicitar reembolso' }).click()
    }
    const form = formularioDe(page, 'Solicitar reembolso')
    await expect(form.getByPlaceholder('Descrição da despesa')).toBeVisible()
    await escolherOpcao(
      selectCom(page, form, 'Beneficiário (associado)'),
      d.beneficiario,
    )
    await form.getByPlaceholder('Valor', { exact: true }).fill(d.valor)
    await form.getByPlaceholder('Descrição da despesa').fill(d.descricao)
    await escolherContaDeDespesa(
      selectCom(page, form, 'Conta contábil (Despesa)'),
    )
    const [anexou] = await Promise.all([
      aguardar(page, 'POST', /\/api\/comprovantes\/$/),
      form.locator('input[type="file"]').setInputFiles({
        name: 'comprovante-de-teste.jpg',
        mimeType: 'image/jpeg',
        buffer: await fotoDeTeste(page, `comprovante ${RODADA}`),
      }),
    ])
    expect(anexou.status()).toBe(200)
    await expect(form.getByText('Comprovante anexado.')).toBeVisible()
    const resposta = await acionar(
      page,
      'POST',
      /\/api\/reembolsos-despesa\/$/,
      form.getByRole('button', { name: 'Solicitar reembolso' }),
    )
    const id = await idDe(resposta, 'id_reembolso')
    await expect(form).toHaveCount(0)
    await expect(cartaoDe(page, d.descricao)).toBeVisible()
    return id
  }

  await test.step('1. Marta registra o reembolso R2 (o beneficiário é o Tesoureiro)', async () => {
    await entrarNoFinanceiro(page, 'presidente')
    await abrirTela(
      page,
      '/financeiro/reembolso-despesa',
      'Reembolso de Despesa',
    )
    idR2 = await solicitar({
      beneficiario: FABIO,
      valor: '45.67',
      descricao: r2,
    })
    const cartao = cartaoDe(page, r2)
    await expect(cartao).toContainText('Valor: R$ 45,67')
    await expect(cartao.getByText('Solicitado', { exact: true })).toBeVisible()
    await expect(
      cartao.getByRole('link', { name: 'Ver comprovante' }),
    ).toBeVisible()
    await ver(page, info, 'reembolso R2 solicitado por Marta')
    await sair(page)
  })

  await test.step('2. o Tesoureiro: recusas do formulário e do comprovante, dois reembolsos, e a segregação ao aprovar e reprovar o próprio', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(
      page,
      '/financeiro/reembolso-despesa',
      'Reembolso de Despesa',
    )
    await page.getByRole('button', { name: 'Solicitar reembolso' }).click()
    const form = formularioDe(page, 'Solicitar reembolso')
    await expect(form.getByPlaceholder('Descrição da despesa')).toBeVisible()

    // recusa 1: nada preenchido (as cinco faltas, cada uma no seu campo)
    await form.getByRole('button', { name: 'Solicitar reembolso' }).click()
    for (const mensagem of [
      'Selecione o associado.',
      'Valor deve ser maior que zero.',
      'Informe a descrição da despesa.',
      'Selecione a conta contábil (Despesa).',
      'Anexe o comprovante da despesa.',
    ]) {
      await expect(
        form.getByRole('alert').filter({ hasText: mensagem }),
      ).toHaveCount(1)
    }
    await ver(page, info, 'reembolso vazio: recusado (comprovante obrigatorio)')

    // recusa 2: um arquivo que não é comprovante (texto) é recusado pelo servidor, e o reembolso continua sem comprovante
    const [texto] = await Promise.all([
      aguardar(page, 'POST', /\/api\/comprovantes\/$/),
      form.locator('input[type="file"]').setInputFiles({
        name: 'comprovante.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('isto não é um comprovante'),
      }),
    ])
    expect(texto.status()).toBe(400)
    await expect(
      form.getByText('Formato não suportado. Use PDF, JPG ou PNG.'),
    ).toBeVisible()
    await expect(form.getByText('Comprovante anexado.')).toHaveCount(0)
    await ver(page, info, 'comprovante em formato errado: recusado')
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(form).toHaveCount(0)

    idR1 = await solicitar({
      beneficiario: KARINA,
      valor: '87.65',
      descricao: r1,
    })
    idR3 = await solicitar({
      beneficiario: KARINA,
      valor: '12.34',
      descricao: r3,
    })
    await expect(cartaoDe(page, r1)).toContainText('Valor: R$ 87,65')
    await expect(cartaoDe(page, r3)).toContainText('Valor: R$ 12,34')
    await ver(page, info, 'reembolsos R1 e R3 solicitados pelo Tesoureiro')

    // quem lançou não aprova o próprio (400, a mensagem aparece no cartão)
    const cartao = cartaoDe(page, r1)
    const propria = await acionar(
      page,
      'POST',
      /\/api\/reembolsos-despesa\/\d+\/aprovar$/,
      cartao.getByRole('button', { name: 'Aprovar', exact: true }),
    )
    expect(propria.status()).toBe(400)
    await expect(
      cartao.getByText(
        'Quem solicitou o reembolso não pode aprová-lo (segregação de funções).',
      ),
    ).toBeVisible()
    await expect(cartao.getByText('Solicitado', { exact: true })).toBeVisible()
    await expect
      .soft(
        page.getByText(
          'Quem solicitou o reembolso não pode aprová-lo (segregação de funções).',
        ),
        'a recusa aparece embaixo de TODOS os reembolsos da lista, não só do que foi tentado (o erro é da tela inteira, repetido em cada cartão)',
      )
      .toHaveCount(1)
    await ver(
      page,
      info,
      'Tesoureiro tenta aprovar o proprio reembolso: recusado',
    )

    // nem reprovar o próprio (a recusa aparece no formulário do motivo)
    await cartao.getByRole('button', { name: 'Reprovar', exact: true }).click()
    const motivoForm = formularioDe(page, 'Confirmar', cartao)
    await motivoForm
      .getByPlaceholder('Motivo da reprovação')
      .fill('Tentativa de teste do robô')
    const propriaReprovacao = await acionar(
      page,
      'POST',
      /\/api\/reembolsos-despesa\/\d+\/reprovar$/,
      motivoForm.getByRole('button', { name: 'Confirmar', exact: true }),
    )
    expect(propriaReprovacao.status()).toBe(400)
    await expect(
      motivoForm.getByRole('alert').filter({
        hasText:
          'Quem solicitou o reembolso não pode reprová-lo (segregação de funções).',
      }),
    ).toBeVisible()
    await cartao.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(motivoForm).toHaveCount(0)
    await ver(
      page,
      info,
      'Tesoureiro tenta reprovar o proprio reembolso: recusado',
    )

    // achado provável: o Tesoureiro é o BENEFICIÁRIO do R2 (que a Marta lançou) e aprova o próprio dinheiro
    const cartaoR2 = cartaoDe(page, r2)
    const doBeneficiario = await acionar(
      page,
      'POST',
      /\/api\/reembolsos-despesa\/\d+\/aprovar$/,
      cartaoR2.getByRole('button', { name: 'Aprovar', exact: true }),
    )
    expect
      .soft(
        doBeneficiario.ok(),
        'o Tesoureiro APROVOU um reembolso em que ELE é o beneficiário: app/services/reembolso.py::aprovar_reembolso só compara quem lançou com quem aprova, não quem recebe',
      )
      .toBe(false)
    await ver(
      page,
      info,
      doBeneficiario.ok()
        ? 'DEFEITO: beneficiario aprovou o proprio reembolso'
        : 'beneficiario aprovando o proprio reembolso: recusado',
    )
    await sair(page)
  })

  await test.step('3. a Presidente pelo cargo aprova (R1), reprova com motivo (R3), abre o comprovante e confere o título', async () => {
    await entrarNoFinanceiro(page, 'cargo_presidente')
    await abrirTela(
      page,
      '/financeiro/reembolso-despesa',
      'Reembolso de Despesa',
    )
    const cartao = cartaoDe(page, r1)
    await expect(cartao).toBeVisible()

    // "Ver comprovante": o link abre o arquivo que foi anexado (JPEG de verdade)
    const endereco = await cartao
      .getByRole('link', { name: 'Ver comprovante' })
      .getAttribute('href')
    expect(endereco).toContain('/uploads/comprovantes/')
    const arquivo = await page.request.get(endereco ?? '')
    expect(arquivo.status()).toBe(200)
    expect(arquivo.headers()['content-type']).toContain('image/jpeg')
    info.annotations.push({
      type: 'comprovante',
      description:
        'o comprovante abre por link direto, sem login (por desenho: a única barreira é o nome aleatório do arquivo); confirmar se um comprovante pode ter CPF ou dados bancários',
    })

    const aprovou = await acionar(
      page,
      'POST',
      /\/api\/reembolsos-despesa\/\d+\/aprovar$/,
      cartao.getByRole('button', { name: 'Aprovar', exact: true }),
    )
    expect(aprovou.status()).toBe(200)
    await expect(cartao.getByText('Aprovado', { exact: true })).toBeVisible()
    await ver(page, info, 'reembolso R1 aprovado pela Presidente do cargo')

    // reprovar o R3: motivo curto é recusado na tela; com motivo, vira Reprovado e o motivo aparece
    const cartaoR3 = cartaoDe(page, r3)
    await cartaoR3
      .getByRole('button', { name: 'Reprovar', exact: true })
      .click()
    const motivoForm = formularioDe(page, 'Confirmar', cartaoR3)
    await motivoForm.getByPlaceholder('Motivo da reprovação').fill('ab')
    await motivoForm
      .getByRole('button', { name: 'Confirmar', exact: true })
      .click()
    await expect(
      motivoForm.getByRole('alert').filter({ hasText: 'Informe o motivo.' }),
    ).toBeVisible()
    await motivoForm
      .getByPlaceholder('Motivo da reprovação')
      .fill(`Sem nota fiscal legível (robô ${RODADA})`)
    const reprovou = await acionar(
      page,
      'POST',
      /\/api\/reembolsos-despesa\/\d+\/reprovar$/,
      motivoForm.getByRole('button', { name: 'Confirmar', exact: true }),
    )
    expect(reprovou.status()).toBe(200)
    await expect(cartaoR3.getByText('Reprovado', { exact: true })).toBeVisible()
    await expect(cartaoR3).toContainText(
      `Motivo: Sem nota fiscal legível (robô ${RODADA})`,
    )
    await ver(page, info, 'reembolso R3 reprovado com motivo')

    // o R2: se o Tesoureiro não conseguiu aprovar, a Presidente aprova para não deixar pendente
    const cartaoR2 = cartaoDe(page, r2)
    if ((await cartaoR2.getByText('Solicitado', { exact: true }).count()) > 0) {
      const r2Aprovado = await acionar(
        page,
        'POST',
        /\/api\/reembolsos-despesa\/\d+\/aprovar$/,
        cartaoR2.getByRole('button', { name: 'Aprovar', exact: true }),
      )
      expect(r2Aprovado.status()).toBe(200)
      await expect(
        cartaoR2.getByText('Aprovado', { exact: true }),
      ).toBeVisible()
    }

    // o título "A Pagar" do R1: valor ao centavo, e quem é o beneficiário (a associada a ser reembolsada)
    const titulo = await tituloDe(page, `Reembolso #${idR1} — ${r1}`)
    await expect(titulo).toHaveCount(1)
    await expect(titulo).toContainText(`A Pagar — Reembolso #${idR1} — ${r1}`)
    await expect(titulo).toContainText('Original R$ 87,65 · Saldo R$ 87,65')
    await expect
      .soft(
        titulo,
        'o título do reembolso não diz a quem pagar: o beneficiário aparece como "-" (app/services/reembolso.py::aprovar_reembolso não leva o associado para o título)',
      )
      .toContainText(KARINA)
    await ver(page, info, 'titulo do reembolso R1: R$ 87,65')

    // Auditoria
    await abrirAuditoria(page, 'reembolsos_despesa')
    for (const [id, quem] of [
      [idR1, FABIO],
      [idR3, FABIO],
      [idR2, MARTA],
    ] as const) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id, quem }),
      ).toBeVisible()
    }
    await expect(
      linhasDaAuditoria(page, 'APROVACAO', { registro: idR1 }),
    ).toHaveCount(1)
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', { registro: idR1, quem: ANA }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'REPROVACAO', { registro: idR3, quem: ANA }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: reembolsos pedidos, aprovado e reprovado')
    await abrirAuditoria(page, 'comprovantes_financeiros')
    await expect(
      linhaDaAuditoria(page, 'UPLOAD', { quem: FABIO }),
    ).toBeVisible()
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 9. CONTAS A PAGAR RECORRENTES (/financeiro/contas-a-pagar-recorrentes): cadastro, prévia, geração do mês sem duplicar, inativar
// =====================================================================================================================================
test('Contas a pagar recorrentes: cadastro com recusas, prévia e geração do mês (título com R$ 777,77 e vencimento no dia certo), geração repetida não duplica, competência inválida e inativar', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  const descricao = `Aluguel da sede de teste do robô ${RODADA}`
  const competencia = '2099-12'
  const outraCompetencia = '2099-11'
  let idConta = 0

  const lerPrevia = async (): Promise<{
    quantidade: number
    centavos: number
  }> => {
    const texto = await page
      .getByText(/conta\(s\) a gerar, totalizando/)
      .innerText({ timeout: 3_000 })
    const achado = /^(\d+) conta\(s\) a gerar, totalizando (.+)$/.exec(
      texto.replace(/\s+/g, ' ').trim(),
    )
    if (!achado) throw new Error(`prévia ilegível: ${texto}`)
    return {
      quantidade: Number(achado[1]),
      centavos: centavosDe(achado[2] ?? ''),
    }
  }
  const verPrevia = async (mes: string): Promise<Resposta> => {
    await campo(page, 'Competência (AAAA-MM)').fill(mes)
    return acionar(
      page,
      'POST',
      /\/api\/contas-a-pagar-recorrentes\/gerar\/$/,
      page.getByRole('button', { name: 'Ver prévia' }),
    )
  }

  await test.step('1. o Tesoureiro cadastra a conta recorrente (com as recusas do formulário)', async () => {
    await entrarNoFinanceiro(page, 'tesoureiro')
    await abrirTela(
      page,
      '/financeiro/contas-a-pagar-recorrentes',
      'Contas a Pagar Recorrentes',
    )
    await page.getByRole('button', { name: 'Nova conta recorrente' }).click()
    const form = formularioDe(page, 'Cadastrar')
    await expect(
      form.getByPlaceholder('Descrição (ex.: Aluguel da sede)'),
    ).toBeVisible()

    // recusa 1: nada preenchido (o dia já vem como 10)
    await form.getByRole('button', { name: 'Cadastrar' }).click()
    for (const mensagem of [
      'Informe a descrição.',
      'Valor deve ser maior que zero.',
      'Selecione a conta contábil (Despesa).',
    ]) {
      await expect(
        form.getByRole('alert').filter({ hasText: mensagem }),
      ).toHaveCount(1)
    }
    await ver(page, info, 'conta recorrente vazia: recusada')

    // recusa 2: descrição curta e dia 32
    await form.getByPlaceholder('Descrição (ex.: Aluguel da sede)').fill('ab')
    await form.getByPlaceholder('Valor', { exact: true }).fill('10')
    await form.getByPlaceholder('Dia de vencimento').fill('32')
    await form.getByRole('button', { name: 'Cadastrar' }).click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'Informe a descrição.' }),
    ).toHaveCount(1)
    await expect(
      form.getByRole('alert').filter({ hasText: 'Dia inválido.' }),
    ).toHaveCount(1)
    await form.getByPlaceholder('Dia de vencimento').fill('0')
    await form.getByRole('button', { name: 'Cadastrar' }).click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'Dia inválido.' }),
    ).toHaveCount(1)
    await ver(page, info, 'conta recorrente com dia invalido: recusada')

    // certo: R$ 777,77 no dia 15, do Alfa
    await form
      .getByPlaceholder('Descrição (ex.: Aluguel da sede)')
      .fill(descricao)
    await form.getByPlaceholder('Valor', { exact: true }).fill('777.77')
    await form.getByPlaceholder('Dia de vencimento').fill('15')
    await escolherContaDeDespesa(
      selectCom(page, form, 'Conta contábil (Despesa)'),
    )
    await escolherOpcao(selectCom(page, form, 'Sem fornecedor'), ALFA)
    idConta = await idDe(
      await acionar(
        page,
        'POST',
        /\/api\/contas-a-pagar-recorrentes\/$/,
        form.getByRole('button', { name: 'Cadastrar' }),
      ),
      'id_conta_recorrente',
    )
    await expect(form).toHaveCount(0)
    await expect(cartaoDe(page, descricao)).toContainText(
      'R$ 777,77 · vencimento dia 15',
    )
    await ver(page, info, 'conta recorrente cadastrada: R$ 777,77 no dia 15')
  })

  await test.step('2. a geração do mês: formato inválido recusado, prévia, confirmação, título certo e geração repetida sem duplicar', async () => {
    // recusa: competência vazia e fora do formato
    await campo(page, 'Competência (AAAA-MM)').fill('')
    await page.getByRole('button', { name: 'Ver prévia' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Use o formato AAAA-MM.' }),
    ).toHaveCount(1)
    await campo(page, 'Competência (AAAA-MM)').fill('dezembro')
    await page.getByRole('button', { name: 'Ver prévia' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Use o formato AAAA-MM.' }),
    ).toHaveCount(1)
    await ver(page, info, 'competencia fora do formato: recusada')

    // prévia: a conta nova está entre as que serão geradas (outras contas ativas, se houver, também entram)
    expect((await verPrevia(competencia)).status()).toBe(200)
    await expect(
      page.getByText(`Prévia — competência ${competencia}`),
    ).toBeVisible()
    const previa = await lerPrevia()
    expect(previa.quantidade).toBeGreaterThanOrEqual(1)
    expect(previa.centavos).toBeGreaterThanOrEqual(77_777)
    await ver(page, info, `previa de ${competencia}`)

    // confirmar: o servidor gera, a tela diz quantas e quanto
    const confirmar = page.getByRole('button', {
      name: /^Confirmar geração de/,
    })
    await expect(confirmar).toContainText(`${previa.quantidade} conta(s)`)
    const gerou = await acionar(
      page,
      'POST',
      /\/api\/contas-a-pagar-recorrentes\/gerar\/$/,
      confirmar,
    )
    expect(gerou.status()).toBe(200)
    await expect(
      page.getByText(
        `${previa.quantidade} conta(s) geradas para a competência ${competencia}.`,
      ),
    ).toBeVisible()
    await ver(page, info, 'contas geradas para a competencia')

    // o título: A Pagar, R$ 777,77 ao centavo, vencimento dia 15 (o dia do mês, não o dia anterior), com o fornecedor
    const titulo = await tituloDe(
      page,
      `${descricao} — competência ${competencia}`,
    )
    await expect(titulo).toHaveCount(1)
    await expect(titulo).toContainText(
      `A Pagar — ${descricao} — competência ${competencia}`,
    )
    await expect(titulo).toContainText('Original R$ 777,77 · Saldo R$ 777,77')
    await expect(titulo).toContainText('Vencimento 15/12/2099')
    await expect(titulo).toContainText(ALFA)
    await ver(page, info, 'titulo gerado: R$ 777,77, vencimento 15/12/2099')

    // gerar de novo a mesma competência não duplica: nada a gerar, o que já existe é contado, e não há botão de confirmar
    await abrirTela(
      page,
      '/financeiro/contas-a-pagar-recorrentes',
      'Contas a Pagar Recorrentes',
    )
    expect((await verPrevia(competencia)).status()).toBe(200)
    await expect.poll(async () => (await lerPrevia()).quantidade).toBe(0)
    await expect(
      page.getByText(/já existente\(s\) para esta competência/),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /^Confirmar geração de/ }),
    ).toHaveCount(0)
    await ver(page, info, 'geracao repetida: nada a gerar, nada duplicado')
    const depois = await tituloDe(
      page,
      `${descricao} — competência ${competencia}`,
    )
    await expect(depois).toHaveCount(1)
  })

  await test.step('3. achado provável: a competência "2099-13" (mês 13) passa na prévia e a confirmação é recusada em silêncio', async () => {
    await abrirTela(
      page,
      '/financeiro/contas-a-pagar-recorrentes',
      'Contas a Pagar Recorrentes',
    )
    const previaDoMes13 = await verPrevia('2099-13')
    expect
      .soft(
        previaDoMes13.ok(),
        'a prévia aceitou a competência 2099-13 (mês 13 não existe): só a confirmação confere o mês (app/services/contribuicoes.py::_mes_ano)',
      )
      .toBe(false)
    const confirmar = page.getByRole('button', {
      name: /^Confirmar geração de/,
    })
    if (previaDoMes13.ok()) {
      // a conta do roteiro está ativa e ainda não foi gerada para este mês: a prévia oferece confirmar
      await expect(confirmar).toBeVisible()
      const recusada = await acionar(
        page,
        'POST',
        /\/api\/contas-a-pagar-recorrentes\/gerar\/$/,
        confirmar,
      )
      expect(recusada.status()).toBe(400)
      await expect
        .soft(
          page.getByText(/Competência inválida/),
          'a confirmação do mês 13 foi recusada pelo servidor (400) e a tela não mostrou nada: quem clicou não sabe por quê',
        )
        .toBeVisible({ timeout: 5_000 })
    }
    await ver(page, info, 'competencia com mes 13')
  })

  await test.step('4. inativar tira a conta da geração (a prévia de outro mês muda em uma conta e R$ 777,77) e Reativar devolve', async () => {
    await abrirTela(
      page,
      '/financeiro/contas-a-pagar-recorrentes',
      'Contas a Pagar Recorrentes',
    )
    const cartao = cartaoDe(page, descricao)
    await expect(cartao).toBeVisible()
    expect((await verPrevia(outraCompetencia)).status()).toBe(200)
    await expect(
      page.getByText(`Prévia — competência ${outraCompetencia}`),
    ).toBeVisible()
    const ativa = await lerPrevia()

    const alternar = (nome: string) =>
      acionar(
        page,
        'PUT',
        /\/api\/contas-a-pagar-recorrentes\/\d+\/ativo$/,
        cartao.getByRole('button', { name: nome, exact: true }),
      )
    expect((await alternar('Inativar')).status()).toBe(200)
    await expect(cartao).toContainText('· inativa')
    expect((await verPrevia(outraCompetencia)).status()).toBe(200)
    await expect
      .poll(async () => (await lerPrevia()).quantidade)
      .toBe(ativa.quantidade - 1)
    expect((await lerPrevia()).centavos).toBe(ativa.centavos - 77_777)
    await ver(page, info, 'conta inativada: sai da previa do outro mes')

    expect((await alternar('Reativar')).status()).toBe(200)
    await expect(cartao).not.toContainText('· inativa')
    // fica inativa ao fim (as próximas gerações não a levam junto)
    expect((await alternar('Inativar')).status()).toBe(200)
    await expect(cartao).toContainText('· inativa')
    await ver(page, info, 'conta recorrente inativada ao fim')
    await sair(page)
  })

  await test.step('5. Auditoria (a Presidente do cargo): cadastro, as três mudanças de situação e a geração, tudo pelo Tesoureiro', async () => {
    await entrarNoFinanceiro(page, 'cargo_presidente')
    await abrirAuditoria(page, 'contas_a_pagar_recorrentes')
    await expect(
      linhaDaAuditoria(page, 'CREATE', { registro: idConta, quem: FABIO }),
    ).toBeVisible()
    await expect(
      linhasDaAuditoria(page, 'UPDATE', { registro: idConta, quem: FABIO }),
    ).toHaveCount(3)
    await ver(page, info, 'auditoria: conta recorrente criada e inativada')
    await abrirAuditoria(
      page,
      'titulos_financeiros',
      'GERACAO_CONTAS_A_PAGAR_RECORRENTES',
    )
    await expect(
      linhaDaAuditoria(page, 'GERACAO_CONTAS_A_PAGAR_RECORRENTES', {
        quem: FABIO,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: geracao das contas a pagar do mes')
  })
  expect(vigia.problemas()).toEqual([])
})

test('Contas a pagar recorrentes: a conta SEM fornecedor (a opção que já vem marcada no formulário) tem de ser aceita', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  const vigia = vigiar(page)
  const descricao = `Energia da sede sem fornecedor de teste do robô ${RODADA}`
  await entrarNoFinanceiro(page, 'tesoureiro')
  await abrirTela(
    page,
    '/financeiro/contas-a-pagar-recorrentes',
    'Contas a Pagar Recorrentes',
  )
  await page.getByRole('button', { name: 'Nova conta recorrente' }).click()
  const form = formularioDe(page, 'Cadastrar')
  await expect(
    form.getByPlaceholder('Descrição (ex.: Aluguel da sede)'),
  ).toBeVisible()
  await form
    .getByPlaceholder('Descrição (ex.: Aluguel da sede)')
    .fill(descricao)
  await form.getByPlaceholder('Valor', { exact: true }).fill('11.11')
  await form.getByPlaceholder('Dia de vencimento').fill('5')
  await escolherContaDeDespesa(
    selectCom(page, form, 'Conta contábil (Despesa)'),
  )
  // o fornecedor fica como veio: "Sem fornecedor"
  await expect(selectCom(page, form, 'Sem fornecedor')).toHaveValue('')
  const resposta = await acionar(
    page,
    'POST',
    /\/api\/contas-a-pagar-recorrentes\/$/,
    form.getByRole('button', { name: 'Cadastrar' }),
  )
  expect
    .soft(
      resposta.status(),
      `cadastrar a conta SEM fornecedor (a opção que já vem marcada) falhou com ${resposta.status()}: a tela manda "id_fornecedor: 0" (o campo vazio vira o número 0 pelo zod) e o banco recusa a chave estrangeira; devia mandar nada`,
    )
    .toBeLessThan(500)
  if (resposta.ok()) {
    await expect(form).toHaveCount(0)
    const cartao = cartaoDe(page, descricao)
    await expect(cartao).toContainText('R$ 11,11 · vencimento dia 5')
    await ver(page, info, 'conta recorrente sem fornecedor cadastrada')
    // fica inativa ao fim (senão seria gerada junto na próxima competência)
    await cartao.getByRole('button', { name: 'Inativar', exact: true }).click()
    await expect(cartao).toContainText('· inativa')
  } else {
    await expect
      .soft(
        form.getByRole('alert').first(),
        'a recusa tem de aparecer no formulário (hoje a tela só mostra "Erro inesperado")',
      )
      .toBeVisible()
    await ver(page, info, 'DEFEITO: conta recorrente sem fornecedor recusada')
  }
  // o 5xx deste cadastro já foi dito acima (soft), com a causa; qualquer outro problema continua valendo
  expect(
    vigia
      .problemas()
      .filter((p) => !p.includes('/api/contas-a-pagar-recorrentes/')),
  ).toEqual([])
})

// =====================================================================================================================================
// 10. QUEM NÃO TEM A PERMISSÃO DO FINANCEIRO É BARRADO (o 1º Vice-Presidente tem associados e governança, não financeiro)
// =====================================================================================================================================
test('Acesso: quem não tem o financeiro (1º Vice-Presidente) não vê o módulo e é barrado em cada tela de despesa, mesmo digitando o endereço', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'vice_presidente')
  await expect(page.getByText(new RegExp(`Bem-vindo, ${BRUNO}`))).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Governança' }).first(),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Financeiro' })).toHaveCount(0)
  await ver(page, info, 'Vice-Presidente: governanca sim, financeiro nao')

  for (const rota of [
    '/financeiro/fornecedores',
    '/financeiro/compras',
    '/financeiro/reembolso-despesa',
    '/financeiro/alcadas-aprovacao',
    '/financeiro/contas-a-pagar-recorrentes',
    '/financeiro/titulos',
  ]) {
    await page.goto(rota)
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
      `${rota} tem de negar o acesso`,
    ).toBeVisible()
    await expect(page).toHaveURL(/\/403$/)
    await expect(
      page.getByText(/permissão necessária: financeiro/),
    ).toBeVisible()
    if (rota.endsWith('/compras') || rota.endsWith('/alcadas-aprovacao')) {
      await ver(page, info, `Vice-Presidente barrado em ${rota}`)
    }
  }
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// 11. AS TELAS ABREM E OS CAMPOS TÊM NOME (leitor de tela): inventário de cada formulário de despesa
// =====================================================================================================================================
test('Formulários de despesa: cada campo tem nome acessível (inventário de fornecedores, compras, reembolso, alçadas, delegação, recorrentes e título)', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const semRotulo: string[] = []
  const inventario = async (nome: string) => {
    try {
      await inventariar(page, info, nome)
    } catch (erro) {
      semRotulo.push(`${nome}: ${(erro as Error).message}`)
    }
  }

  await entrarNoFinanceiro(page, 'presidente')

  await abrirTela(page, '/financeiro/fornecedores', 'Fornecedores')
  await page.getByRole('button', { name: 'Novo fornecedor' }).click()
  await expect(page.getByPlaceholder('CNPJ')).toBeVisible()
  await inventario('fornecedores-novo')
  await page.getByRole('button', { name: 'Cancelar' }).first().click()
  await page
    .getByRole('button', { name: 'Dados bancários', exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: 'Solicitar troca' }).first().click()
  await expect(page.getByPlaceholder('Titular da conta')).toBeVisible()
  await inventario('fornecedores-dados-bancarios')

  const comprasCarregadas = aguardar(
    page,
    'GET',
    /\/api\/solicitacoes-compra\/$/,
  )
  await abrirTela(page, '/financeiro/compras', 'Compras')
  await comprasCarregadas
  await page.getByRole('button', { name: 'Nova solicitação' }).click()
  await expect(page.getByPlaceholder('Descrição da compra')).toBeVisible()
  await inventario('compras-nova-solicitacao')
  await page.getByRole('button', { name: 'Cancelar' }).first().click()
  const pendente = page
    .locator('div.rounded-md.border')
    .filter({ has: page.getByRole('button', { name: 'Cotações / Aprovar' }) })
    .first()
  await page.waitForTimeout(500) // a lista não tem estado "carregando": vazia e carregando se parecem
  if ((await pendente.count()) > 0) {
    // o botão do cartão vira "Ocultar" quando o painel abre e o cartão deixa de casar com o filtro acima: o painel aberto é achado na página
    await page
      .getByRole('button', { name: 'Cotações / Aprovar' })
      .first()
      .click()
    await expect(
      page.getByRole('button', { name: 'Adicionar cotação' }).first(),
    ).toBeVisible()
    await inventario('compras-cotacoes-e-aprovacao')
  } else {
    info.annotations.push({
      type: 'inventário',
      description:
        'sem compra aguardando aprovação: o painel de cotações não foi inventariado',
    })
  }

  await abrirTela(page, '/financeiro/reembolso-despesa', 'Reembolso de Despesa')
  await page.getByRole('button', { name: 'Solicitar reembolso' }).click()
  await expect(page.getByPlaceholder('Descrição da despesa')).toBeVisible()
  await inventario('reembolso-solicitar')

  await abrirTela(page, '/financeiro/alcadas-aprovacao', 'Alçadas de Aprovação')
  await page.getByRole('button', { name: 'Nova alçada' }).click()
  await expect(page.getByPlaceholder('Valor mínimo')).toBeVisible()
  await inventario('alcadas-nova')
  await page.getByRole('button', { name: 'Nova delegação' }).click()
  await expect(page.getByPlaceholder('Motivo (ex.: férias)')).toBeVisible()
  await inventario('alcadas-delegacao')

  await abrirTela(
    page,
    '/financeiro/contas-a-pagar-recorrentes',
    'Contas a Pagar Recorrentes',
  )
  await page.getByRole('button', { name: 'Nova conta recorrente' }).click()
  await expect(page.getByPlaceholder('Dia de vencimento')).toBeVisible()
  await inventario('recorrentes-nova-e-gerar-do-mes')

  await abrirTela(page, '/financeiro/titulos?periodo=todos', 'Títulos')
  await page.getByRole('button', { name: 'Novo título' }).click()
  await expect(page.getByPlaceholder('Valor original')).toBeVisible()
  await inventario('titulos-novo')
  await ver(page, info, 'formulario de novo titulo aberto')

  expect
    .soft(
      semRotulo,
      'campo(s) sem nome acessível nos formulários de despesa: quem usa leitor de tela não sabe o que preencher (select e campo de data sem rótulo, aria-label ou placeholder)',
    )
    .toEqual([])
  expect(vigia.problemas()).toEqual([])
})
