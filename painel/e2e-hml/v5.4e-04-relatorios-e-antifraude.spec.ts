import fs from 'node:fs'
import path from 'node:path'

import {
  expect,
  test,
  type Locator,
  type Page,
  type Response as Resposta,
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

// v5.4e — FASE 3 ao vivo, parte 4: RELATÓRIOS E PRESTAÇÃO DE CONTAS, CONTROLES ANTIFRAUDE E VALORES CENTAVO A CENTAVO, pela tela do hml-painel.
//
// O que este roteiro SABE do sistema (lido em painel/src/pages/Relatorios.tsx, app/services/relatorios.py e app/services/antifraude.py):
//  - /financeiro/relatorios tem 7 blocos: Balancete por período, Receitas x despesas (por conta e por centro de custo), Inadimplência, Extrato por
//    Conta Financeira, Por projeto, Padrões suspeitos (Conselho Fiscal) e Prestação de contas do exercício. NÃO há botão de exportar, baixar nem
//    imprimir em nenhum deles (a exportação para o contador é a FASE 17): o único "arquivo" que o financeiro abre é o comprovante (Razão Contábil).
//  - Os alertas antifraude (relatório de exceção mensal) só existem dentro de Relatórios, bloco "Padrões suspeitos": o Início do Financeiro é uma
//    página "em construção" e o sino de Notificações do topo não faz nada. Os 5 padrões: lançamento fora do expediente (FUSO_HORARIO,
//    HORA_INICIO_EXPEDIENTE=7, HORA_FIM_EXPEDIENTE=20), solicitação de compra a menos de 10% do teto de uma alçada, primeira operação com
//    fornecedor já a partir de R$ 1.000,00, 3 estornos do mesmo usuário no mês e pagamento a fornecedor nos 30 dias seguintes a uma troca de
//    dados bancários APROVADA. Os parâmetros desses limites não têm tela (só a API /api/configuracoes/{chave}).
//  - O mês do alerta é o do instante em que o lançamento foi gravado (UTC), nunca o da data de competência.
//
// COMO O ROTEIRO PROVA OS NÚMEROS: cria as suas próprias 3 contas (Ativo, Receita, Despesa), uma conta financeira e um centro de custo ligado a um
// projeto, lança 5 títulos, baixa, estorna, e mantém um "livro de referência" em memória com cada partida em centavos. Os relatórios são conferidos
// contra esse livro (conta por conta, período por período), então os valores das contas do robô são exatos mesmo com o banco de teste acumulando
// dados de outras rodadas. O que o robô não conhece (as contas dos outros roteiros) é conferido por consistência interna (soma dos débitos = soma
// dos créditos, soma das linhas = total, resultado = receitas - despesas, saldo corrente do extrato).
//
// O que parece DEFEITO do sistema (e não do roteiro) vai para `achados` (um por linha) em vez de derrubar o teste na hora; o último teste lista
// tudo de uma vez. O que é só observação de projeto (não é falha) vai para `observacoes` e para as anotações do relatório.
test.beforeAll(() => exigirHomologacao())
test.describe.configure({ mode: 'serial' })

const S = String(RODADA)
const PRESIDENTE = 'Marta Souza'
const TESOUREIRO = 'Fábio Henrique Dias de Teste'

const NAVEGADOR = {
  baseURL: process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br',
  locale: 'pt-BR',
  timezoneId: 'America/Belem',
  viewport: { width: 1366, height: 900 },
}

// ------------------------------------------------------------------------------------------------------------------------------ dinheiro
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})
/** Como o painel escreve (Intl pt-BR): "R$ 1.234,56". */
const brl = (centavos: number): string => BRL.format(centavos / 100)
// o dinheiro que o SERVIDOR escreve nas mensagens e nos textos gerados (alertas, prestação de contas): R$ 1.234,56
const reaisSrv = (centavos: number): string =>
  `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Como o servidor escreve nos textos (Python `:.2f`): "1234.56". */
const decimal = (centavos: number): string => (centavos / 100).toFixed(2)
const REAIS = /([-−])?R\$\s?([-−])?([\d.]+),(\d{2})/g

/** Todos os valores em reais de um texto da tela, em centavos (inteiros: nunca ponto flutuante). */
function valoresEmCentavos(texto: string): number[] {
  return [...texto.matchAll(REAIS)].map((m) => {
    const negativo = Boolean(m[1] ?? m[2])
    const centavos = Number(`${(m[3] ?? '').replace(/\./g, '')}${m[4] ?? '00'}`)
    return negativo ? -centavos : centavos
  })
}

function emCentavos(texto: string): number {
  const valor = valoresEmCentavos(texto)[0]
  if (valor === undefined) throw new Error(`sem valor em reais em: ${texto}`)
  return valor
}

/** "Debito R$ 5.000,00 · Credito R$ 5.000,00" (com ou sem o nome da conta no meio) -> ["Debito|500000", "Credito|500000"]. */
function partidasLidas(texto: string): string[] {
  return [
    ...texto.matchAll(/(Debito|Credito)\s.*?(-?R\$\s?[\d.]+,\d{2})/g),
  ].map((m) => `${m[1]}|${emCentavos(m[2] ?? '')}`)
}

// ------------------------------------------------------------------------------------------------------------------------------ datas
/** Dia (AAAA-MM-DD) daqui a `deslocamentoDias`, no relógio de Belém (UTC-3), que é o do navegador do robô. */
function diaEmBelem(deslocamentoDias = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + deslocamentoDias * 86_400_000))
}
/** O dia em UTC: é com ele que o servidor carimba o lançamento (`datetime.utcnow()`). */
const diaUtc = (): string => new Date().toISOString().slice(0, 10)
const mesUtc = (): string => new Date().toISOString().slice(0, 7)
function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
const dataBr = (iso: string): string => iso.split('-').reverse().join('/')
const amanha = (): string => {
  const a = diaUtc()
  const b = diaEmBelem(0)
  return somarDias(a > b ? a : b, 1)
}
/** Hora cheia (0-23) em São Paulo: o fuso padrão do sistema (FUSO_HORARIO) para o expediente do antifraude. */
function horaEmSaoPaulo(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  )
}
const HORA_INICIO = 7
const HORA_FIM = 20
const foraDoExpediente = (hora: number): boolean =>
  hora < HORA_INICIO || hora >= HORA_FIM

// ------------------------------------------------------------------------------------------------------------------------------ o que o robô cria
type ChaveConta = 'ATV' | 'REC' | 'DES'
const CHAVES_CONTA: ChaveConta[] = ['ATV', 'REC', 'DES']
const CONTAS: Record<
  ChaveConta,
  { codigo: string; descricao: string; tipo: string; credora: boolean }
> = {
  ATV: {
    codigo: `4E04.1.${S}`,
    descricao: `Caixa do robô 4e04 ${S}`,
    tipo: 'Ativo',
    credora: false,
  },
  REC: {
    codigo: `4E04.2.${S}`,
    descricao: `Receita do robô 4e04 ${S}`,
    tipo: 'Receita',
    credora: true,
  },
  DES: {
    codigo: `4E04.3.${S}`,
    descricao: `Despesa do robô 4e04 ${S}`,
    tipo: 'Despesa',
    credora: false,
  },
}
const CENTRO = {
  codigo: `CC-4E04-${S}`,
  nome: `Centro do robô 4e04 ${S}`,
}

/** CNPJ (só dígitos) com os dois dígitos verificadores certos, filial 9999 (que não existe de verdade), a partir de uma raiz inventada. */
function cnpjValidoSoDigitos(raiz: number): string {
  const base = `${String(raiz).padStart(8, '0').slice(-8)}9999`
  const digito = (numeros: number[], pesos: number[]): number => {
    const soma = numeros.reduce((acc, n, i) => acc + n * (pesos[i] ?? 0), 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const numeros = base.split('').map(Number)
  const d1 = digito(numeros, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digito([...numeros, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${d1}${d2}`
}

type ChaveFornecedor = 'F1' | 'F2'
const FORNECEDORES: Record<ChaveFornecedor, { razao: string; cnpj: string }> = {
  F1: {
    razao: `Fornecedor Um do robô ${S}`,
    cnpj: cnpjValidoSoDigitos((RODADA % 80_000_000) + 10_000_000),
  },
  F2: {
    razao: `Fornecedor Dois do robô ${S}`,
    cnpj: cnpjValidoSoDigitos((RODADA % 80_000_000) + 10_000_001),
  },
}
const cnpjFormatado = (d: string): string =>
  `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`

type ChaveTitulo = 'A' | 'B' | 'C' | 'D' | 'E'
const CHAVES_TITULO: ChaveTitulo[] = ['A', 'B', 'C', 'D', 'E']
const TITULOS: Record<
  ChaveTitulo,
  {
    tipo: 'A Pagar' | 'A Receber'
    conta: ChaveConta
    valor: number
    descricao: string
    fornecedor?: ChaveFornecedor
  }
> = {
  A: {
    tipo: 'A Receber',
    conta: 'REC',
    valor: 500_000,
    descricao: `Receita A do robô ${S}`,
  },
  B: {
    tipo: 'A Receber',
    conta: 'REC',
    valor: 123_456,
    descricao: `Receita B do robô ${S}`,
  },
  C: {
    tipo: 'A Pagar',
    conta: 'DES',
    valor: 100_000,
    descricao: `Despesa C do robô ${S}`,
    fornecedor: 'F1',
  },
  D: {
    tipo: 'A Pagar',
    conta: 'DES',
    valor: 99_999,
    descricao: `Despesa D do robô ${S}`,
    fornecedor: 'F2',
  },
  E: {
    tipo: 'A Pagar',
    conta: 'DES',
    valor: 250_025,
    descricao: `Despesa E do robô ${S}`,
    fornecedor: 'F1',
  },
}
/** Quanto cada baixa paga (D é parcial: sobra saldo). */
const PAGO: Record<ChaveTitulo, number> = {
  A: 500_000,
  B: 123_456,
  C: 100_000,
  D: 40_000,
  E: 250_025,
}
const COMPETENCIA_ANTIGA = '2025-03-10'

// A alçada do robô: valores altos e fora do comum, para nenhuma solicitação de outro roteiro cair na faixa dela. O teto termina em múltiplo de
// 10 centavos para o limite inferior (teto x 0,9, `PERCENTUAL_ALERTA_FRACIONAMENTO` = 10) ser um número inteiro de centavos.
const ALCADA_MINIMO = 600_000_000
const ALCADA_TETO = 700_000_000 + 10 * (RODADA % 100)
const ALCADA_LIMITE_INFERIOR = Math.round(ALCADA_TETO * 0.9)
type ChaveSolicitacao = 'A' | 'B' | 'C'
const SOLICITACOES: Record<
  ChaveSolicitacao,
  { valor: number; descricao: string; alerta: boolean }
> = {
  // dentro da faixa de 10% abaixo do teto: tem de alertar
  A: {
    valor: ALCADA_TETO - 5_000_000,
    descricao: `Compra A do robô ${S} (perto do teto)`,
    alerta: true,
  },
  // um centavo ABAIXO do limite inferior: não alerta
  B: {
    valor: ALCADA_LIMITE_INFERIOR - 1,
    descricao: `Compra B do robô ${S} (um centavo fora da faixa)`,
    alerta: false,
  },
  // um centavo ACIMA do teto: não é "logo abaixo do teto", não alerta
  C: {
    valor: ALCADA_TETO + 1,
    descricao: `Compra C do robô ${S} (um centavo acima do teto)`,
    alerta: false,
  },
}

// ------------------------------------------------------------------------------------------------------------------------------ estado
const TABELAS = [
  'plano_de_contas',
  'contas_financeiras',
  'centros_de_custo',
  'fornecedores',
  'titulos_financeiros',
  'lancamentos_contabeis',
  'dados_bancarios_fornecedor',
  'alcadas_aprovacao',
  'solicitacoes_compra',
  'prestacoes_de_contas',
]
/** Total de registros da Auditoria de cada tabela ANTES de o roteiro mexer (as recusas não podem somar). */
const antes: Record<string, number> = {}
const total0 = (tabela: string): number => antes[tabela] ?? 0

const estado = {
  idConta: { ATV: 0, REC: 0, DES: 0 } as Record<ChaveConta, number>,
  idContaFinanceira: 0,
  idCentro: 0,
  projeto: '',
  idFornecedor: { F1: 0, F2: 0 } as Record<ChaveFornecedor, number>,
  idDadosBancarios: { F1: 0, F2: 0 } as Record<ChaveFornecedor, number>,
  idTitulo: { A: 0, B: 0, C: 0, D: 0, E: 0 } as Record<ChaveTitulo, number>,
  idAlcada: 0,
  alcadaAtiva: false,
  idSolicitacao: { A: 0, B: 0, C: 0 } as Record<ChaveSolicitacao, number>,
  competenciaVazia: 'não testada' as 'aceita' | 'recusada' | 'não testada',
  caixaAntes: 0,
  mes: '',
  estornosAntes: new Map<number, number>(),
  estornosDepoisDe2: new Map<number, number>(),
}

type Partida = {
  conta: ChaveConta
  lado: 'D' | 'C'
  centavos: number
  centro: boolean
}
type Lancamento = {
  rotulo: string
  id: number
  numero: number
  /** Dia (AAAA-MM-DD) que o sistema usa para o período: a competência, ou o dia UTC do carimbo quando a competência vem vazia. */
  dia: string
  historico: string
  partidas: Partida[]
  estornado: boolean
  /** Hora (São Paulo) logo antes e logo depois da ação que gravou o lançamento (para o alerta de fora do expediente). */
  horas: [number, number]
  comprovante: boolean
}
const livro: Lancamento[] = []

const achados: string[] = []
const observacoes: string[] = []
function achar(texto: string): void {
  achados.push(texto)
  test.info().annotations.push({ type: 'achado', description: texto })
}
function observar(texto: string): void {
  observacoes.push(texto)
  test.info().annotations.push({ type: 'observação', description: texto })
}

// ------------------------------------------------------------------------------------------------------------------------------ o livro de referência
function partidasDaBaixa(
  tipo: 'A Pagar' | 'A Receber',
  conta: ChaveConta,
  centavos: number,
): Partida[] {
  return tipo === 'A Pagar'
    ? [
        { conta, lado: 'D', centavos, centro: true },
        { conta: 'ATV', lado: 'C', centavos, centro: true },
      ]
    : [
        { conta: 'ATV', lado: 'D', centavos, centro: true },
        { conta, lado: 'C', centavos, centro: true },
      ]
}
const invertidas = (partidas: Partida[]): Partida[] =>
  partidas.map((p) => ({ ...p, lado: p.lado === 'D' ? 'C' : 'D' }))
const doLivro = (rotulo: string): Lancamento => {
  const l = livro.find((x) => x.rotulo === rotulo)
  if (!l) throw new Error(`lançamento ${rotulo} ainda não está no livro`)
  return l
}

type Saldos = {
  anterior: number
  debitos: number
  creditos: number
  atual: number
}
/** O balancete que o sistema TEM de mostrar para as contas do robô (null = conta sem movimento e sem saldo: a tela não a lista). */
function balanceteEsperado(
  de: string,
  ate: string,
): Record<ChaveConta, Saldos | null> {
  const bruto: Record<
    ChaveConta,
    { anterior: number; debitos: number; creditos: number }
  > = {
    ATV: { anterior: 0, debitos: 0, creditos: 0 },
    REC: { anterior: 0, debitos: 0, creditos: 0 },
    DES: { anterior: 0, debitos: 0, creditos: 0 },
  }
  for (const l of livro) {
    for (const p of l.partidas) {
      const alvo = bruto[p.conta]
      if (l.dia < de) alvo.anterior += p.lado === 'D' ? p.centavos : -p.centavos
      else if (l.dia <= ate) {
        if (p.lado === 'D') alvo.debitos += p.centavos
        else alvo.creditos += p.centavos
      }
    }
  }
  const resultado = {} as Record<ChaveConta, Saldos | null>
  for (const chave of CHAVES_CONTA) {
    const b = bruto[chave]
    const credora = CONTAS[chave].credora
    const anterior = credora ? 0 - b.anterior : b.anterior // `0 -` e não `-`: menos zero (-0) não é igual a zero no toEqual
    const liquido = credora ? b.creditos - b.debitos : b.debitos - b.creditos
    const atual = anterior + liquido
    resultado[chave] =
      atual === 0 && b.debitos === 0 && b.creditos === 0
        ? null
        : { anterior, debitos: b.debitos, creditos: b.creditos, atual }
  }
  return resultado
}
/** Receitas x despesas por conta: o valor do período de cada conta de Receita/Despesa do robô (null = não aparece). */
function receitasDespesasEsperadas(
  de: string,
  ate: string,
): { REC: number | null; DES: number | null } {
  const b = balanceteEsperado(de, ate)
  const valor = (chave: ChaveConta): number | null => {
    const s = b[chave]
    return s && s.atual !== s.anterior ? s.atual - s.anterior : null
  }
  return { REC: valor('REC'), DES: valor('DES') }
}
/** Receitas x despesas do centro de custo do robô no período (null = o centro não tem partida de Receita/Despesa no período). */
function centroEsperado(
  de: string,
  ate: string,
): { receitas: number; despesas: number; resultado: number } | null {
  let tem = false
  let receitas = 0
  let despesas = 0
  for (const l of livro) {
    if (l.dia < de || l.dia > ate) continue
    for (const p of l.partidas) {
      if (!p.centro || p.conta === 'ATV') continue
      tem = true
      if (p.conta === 'REC')
        receitas += p.lado === 'C' ? p.centavos : -p.centavos
      else despesas += p.lado === 'D' ? p.centavos : -p.centavos
    }
  }
  return tem ? { receitas, despesas, resultado: receitas - despesas } : null
}
/** Movimentos da conta ATV (a Conta Financeira do robô), com o efeito de cada um no saldo. */
function movimentosAtv(): { tipo: 'Debito' | 'Credito'; centavos: number }[] {
  return livro.flatMap((l) =>
    l.partidas
      .filter((p) => p.conta === 'ATV')
      .map((p) => ({
        tipo: p.lado === 'D' ? ('Debito' as const) : ('Credito' as const),
        centavos: p.centavos,
      })),
  )
}
const saldoAtv = (): number =>
  movimentosAtv().reduce(
    (s, m) => s + (m.tipo === 'Debito' ? m.centavos : -m.centavos),
    0,
  )
const PERIODOS = [
  { nome: 'tudo (2025 até amanhã)', de: '2025-01-01', ate: amanha() },
  { nome: 'março de 2025', de: '2025-03-01', ate: '2025-03-31' },
  { nome: 'antes do lançamento antigo', de: '2025-01-01', ate: '2025-03-09' },
  { nome: 'depois do lançamento antigo', de: '2025-03-11', ate: amanha() },
]

// ------------------------------------------------------------------------------------------------------------------------------ ajudas de tela
/** Resposta da API a uma chamada que ainda vai acontecer (criar ANTES do clique que a dispara). */
function respostaDe(
  page: Page,
  metodo: string,
  caminho: RegExp | string,
): Promise<Resposta> {
  return page.waitForResponse((r) => {
    if (r.request().method() !== metodo) return false
    const rota = new URL(r.url()).pathname
    return typeof caminho === 'string' ? rota === caminho : caminho.test(rota)
  })
}

/** Um bloco da página de Relatórios pelo título (cada bloco é uma <section> com um <h2>). */
const secao = (page: Page, titulo: string): Locator =>
  page.locator('section').filter({
    has: page.getByRole('heading', { name: titulo, exact: true }),
  })
/** Cartão de lista (`div.rounded-md.border`) que traz o texto. */
const cartao = (escopo: Page | Locator, texto: string | RegExp): Locator =>
  escopo.locator('div.rounded-md.border').filter({ hasText: texto })

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

/** Inventário da tela SEM derrubar o teste: o que faltar de rótulo acessível vai para a lista de achados. */
async function inventariarSemTravar(
  page: Page,
  info: TestInfo,
  nome: string,
): Promise<void> {
  try {
    await inventariar(page, info, nome)
  } catch (erro) {
    const roteiro = path.basename(info.file).replace(/\.spec\.ts$/, '')
    const arquivo = path.join(
      'prints-hml',
      roteiro,
      `inventario-${nome.replace(/[^a-zA-Z0-9]+/g, '-')}.txt`,
    )
    let motivo = (erro as Error).message.split('\n')[0] ?? ''
    try {
      motivo =
        fs
          .readFileSync(arquivo, 'utf-8')
          .split('\n')
          .find((linha) => linha.startsWith('SEM RÓTULO:')) ?? motivo
    } catch {
      // sem arquivo: fica a mensagem do erro
    }
    achar(`acessibilidade em "${nome}": ${motivo}`)
  }
}

// ------------------------------------------------------------------------------------------------------------------------------ ações pela tela
async function criarConta(page: Page, chave: ChaveConta): Promise<number> {
  const c = CONTAS[chave]
  const form = page.locator('form')
  if ((await form.count()) === 0) {
    await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
    await expect(form).toBeVisible()
  }
  await form.getByPlaceholder('Código contábil').fill(c.codigo)
  await form.getByPlaceholder('Descrição', { exact: true }).fill(c.descricao)
  const tipo = form.locator('select').first()
  await expect(tipo.locator('option', { hasText: c.tipo })).toBeAttached()
  await tipo.selectOption(c.tipo)
  const [resposta] = await Promise.all([
    respostaDe(page, 'POST', '/plano-contas/'),
    form.getByRole('button', { name: 'Salvar' }).click(),
  ])
  expect(resposta.status(), await resposta.text()).toBe(200)
  const { id_conta } = (await resposta.json()) as { id_conta: number }
  await expect(form).toHaveCount(0)
  await expect(page.getByText(`${c.codigo} — ${c.descricao}`)).toBeVisible()
  return id_conta
}

async function criarFornecedor(
  page: Page,
  chave: ChaveFornecedor,
): Promise<number> {
  const f = FORNECEDORES[chave]
  const form = page.locator('form')
  if ((await form.count()) === 0) {
    await page.getByRole('button', { name: 'Novo fornecedor' }).click()
    await expect(form).toBeVisible()
  }
  await form.getByPlaceholder('Razão social').fill(f.razao)
  await form.getByPlaceholder('CNPJ').fill(f.cnpj)
  await form
    .getByPlaceholder('Categoria de serviço')
    .fill('Serviços de teste do robô')
  await form.getByPlaceholder('Telefone').fill('91988887777')
  const [resposta] = await Promise.all([
    respostaDe(page, 'POST', '/fornecedores/'),
    form.getByRole('button', { name: 'Salvar' }).click(),
  ])
  expect(resposta.status(), await resposta.text()).toBe(200)
  const { id_fornecedor } = (await resposta.json()) as {
    id_fornecedor: number
  }
  await expect(form).toHaveCount(0)
  await expect(cartao(page, f.razao)).toContainText(cnpjFormatado(f.cnpj))
  return id_fornecedor
}

async function lancarTitulo(page: Page, chave: ChaveTitulo): Promise<number> {
  const t = TITULOS[chave]
  const form = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Registrar título' }),
  })
  if ((await form.count()) === 0) {
    await page.getByRole('button', { name: 'Novo título' }).click()
    await expect(form).toBeVisible()
  }
  if (t.tipo === 'A Receber') {
    await form.locator('select').nth(0).selectOption('A Receber')
  }
  const contas = form.locator('select').nth(1)
  await expect(
    contas.locator('option', { hasText: CONTAS[t.conta].codigo }),
  ).toBeAttached()
  await escolherPorTexto(contas, CONTAS[t.conta].codigo)
  await form.getByPlaceholder('Descrição', { exact: true }).fill(t.descricao)
  await form.getByPlaceholder('Valor original').fill(decimal(t.valor))
  await form.locator('input[type="date"]').fill(diaEmBelem(20))
  if (t.fornecedor) {
    const razao = FORNECEDORES[t.fornecedor].razao
    await form.locator('select').nth(2).selectOption('fornecedor')
    const fornecedores = form.locator('select').nth(3)
    await expect(
      fornecedores.locator('option', { hasText: razao }),
    ).toBeAttached()
    await escolherPorTexto(fornecedores, razao)
  }
  const [resposta] = await Promise.all([
    respostaDe(page, 'POST', '/titulos/'),
    form.getByRole('button', { name: 'Registrar título' }).click(),
  ])
  expect(resposta.status(), await resposta.text()).toBe(200)
  const { id_titulo } = (await resposta.json()) as { id_titulo: number }
  await expect(form).toHaveCount(0)
  await expect(page.getByText(t.descricao).first()).toBeVisible()
  return id_titulo
}

/** Abre o formulário "Baixar" do título (o cartão traz a descrição, que é única da rodada). */
async function abrirBaixa(
  page: Page,
  chave: ChaveTitulo,
): Promise<{ card: Locator; form: Locator }> {
  const card = cartao(page, TITULOS[chave].descricao)
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: 'Baixar', exact: true }).click()
  const form = card.locator('form')
  await expect(form).toBeVisible()
  return { card, form }
}

/** Preenche valor, forma, contrapartida e centro de custo (a competência e o comprovante são opcionais e ficam por conta de quem chama). */
async function preencherBaixa(form: Locator, centavos: number): Promise<void> {
  await form.getByPlaceholder('Valor pago').fill(decimal(centavos))
  await form.getByPlaceholder('Forma de pagamento').fill('Pix')
  const contrapartida = form.locator('select').nth(0)
  await expect(
    contrapartida.locator('option', { hasText: CONTAS.ATV.codigo }),
  ).toBeAttached()
  await escolherPorTexto(contrapartida, CONTAS.ATV.codigo)
  const centros = form.locator('select').nth(1)
  await expect(
    centros.locator('option', { hasText: CENTRO.codigo }),
  ).toBeAttached()
  await escolherPorTexto(centros, CENTRO.codigo)
}

async function anexarComprovante(form: Locator): Promise<void> {
  await form.locator('input[type="file"]').setInputFiles({
    name: 'comprovante-do-robo.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(COMPROVANTE),
  })
  await expect(form.getByText('Comprovante anexado.')).toBeVisible()
}
const COMPROVANTE = `%PDF-1.4\n% comprovante de teste do robô ${S}\n`

async function submeterBaixa(page: Page, form: Locator): Promise<Resposta> {
  const [resposta] = await Promise.all([
    respostaDe(page, 'POST', '/baixar-titulo/'),
    form.getByRole('button', { name: 'Confirmar baixa' }).click(),
  ])
  return resposta
}

/** Guarda no livro de referência a baixa que o sistema aceitou. */
async function registrarBaixa(
  chave: ChaveTitulo,
  resposta: Resposta,
  dia: string,
  horas: [number, number],
  comprovante: boolean,
): Promise<{ saldo_restante: number }> {
  const corpo = (await resposta.json()) as {
    saldo_restante: number
    id_lancamento: number
    numero_sequencial: number
  }
  const t = TITULOS[chave]
  livro.push({
    rotulo: chave,
    id: corpo.id_lancamento,
    numero: corpo.numero_sequencial,
    dia,
    historico: `Baixa do título #${estado.idTitulo[chave]} — ${t.descricao}`,
    partidas: partidasDaBaixa(t.tipo, t.conta, PAGO[chave]),
    estornado: false,
    horas,
    comprovante,
  })
  return corpo
}

/** Baixa completa e aceita (competência explícita, comprovante se pedido). */
async function baixarComSucesso(
  page: Page,
  chave: ChaveTitulo,
  competencia: string,
  comComprovante: boolean,
): Promise<{ saldo_restante: number }> {
  const { form } = await abrirBaixa(page, chave)
  await preencherBaixa(form, PAGO[chave])
  await form.locator('input[type="date"]').fill(competencia)
  if (comComprovante) await anexarComprovante(form)
  const antes1 = horaEmSaoPaulo()
  const resposta = await submeterBaixa(page, form)
  const depois1 = horaEmSaoPaulo()
  expect(resposta.status(), await resposta.text()).toBe(200)
  const corpo = await registrarBaixa(
    chave,
    resposta,
    competencia,
    [antes1, depois1],
    comComprovante,
  )
  await expect(form).toHaveCount(0)
  return corpo
}

type Padrao = {
  tipo: string
  descricao: string
  id_lancamento?: number
  id_solicitacao?: number
  id_titulo?: number
  id_fornecedor?: number
  id_usuario?: number
  quantidade?: number
}
const ROTA_PADROES = '/api/antifraude/padroes-suspeitos'

/** Abre Relatórios e devolve os alertas do mês pedido (o da API, que é o que a tela tem de mostrar) e o bloco da tela. */
async function lerPadroes(
  page: Page,
  mes: string,
): Promise<{ lista: Padrao[]; sec: Locator }> {
  const inicial = page.waitForResponse(
    (r) => new URL(r.url()).pathname === ROTA_PADROES,
  )
  await page.goto('/financeiro/relatorios')
  const primeira = await inicial
  const sec = secao(page, 'Padrões suspeitos (Conselho Fiscal)')
  await expect(sec).toBeVisible()
  const mesPadrao = new URL(primeira.url()).searchParams.get('competencia')
  let resposta = primeira
  if (mesPadrao !== mes) {
    ;[resposta] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === ROTA_PADROES &&
          new URL(r.url()).searchParams.get('competencia') === mes,
      ),
      sec.locator('input[type="month"]').fill(mes),
    ])
  }
  expect(resposta.status(), await resposta.text()).toBe(200)
  return { lista: (await resposta.json()) as Padrao[], sec }
}

/** A tela mostra exatamente os alertas que a API devolveu (tipo e descrição de cada um). */
async function conferirPadroesNaTela(
  sec: Locator,
  lista: Padrao[],
): Promise<void> {
  const cartoes = sec.locator('div.rounded-md.border')
  if (lista.length === 0) {
    await expect(
      sec.getByText('Nenhum padrão suspeito encontrado nesta competência.'),
    ).toBeVisible()
    return
  }
  await expect(cartoes).toHaveCount(lista.length)
  const naTela = await cartoes.evaluateAll((els) =>
    els.map((el) =>
      Array.from(el.querySelectorAll('p')).map((p) => p.textContent ?? ''),
    ),
  )
  expect(naTela.map((c) => `${c[0]}|${c[1]}`).sort()).toEqual(
    lista.map((a) => `${a.tipo}|${a.descricao}`).sort(),
  )
}

const ehDoRobo = (a: Padrao): boolean =>
  (a.id_lancamento !== undefined &&
    livro.some((l) => l.id === a.id_lancamento)) ||
  (a.id_solicitacao !== undefined &&
    Object.values(estado.idSolicitacao).includes(a.id_solicitacao)) ||
  (a.id_titulo !== undefined &&
    Object.values(estado.idTitulo).includes(a.id_titulo)) ||
  (a.id_fornecedor !== undefined &&
    Object.values(estado.idFornecedor).includes(a.id_fornecedor))

/** Alertas de estorno por usuário (id do usuário -> quantidade). */
function estornosPorUsuario(lista: Padrao[]): Map<number, number> {
  const mapa = new Map<number, number>()
  for (const a of lista) {
    if (
      a.tipo === 'SEQUENCIA_DE_ESTORNOS_MESMO_USUARIO' &&
      a.id_usuario !== undefined
    ) {
      mapa.set(a.id_usuario, a.quantidade ?? 0)
    }
  }
  return mapa
}

/** O que o servidor tem de dizer sobre os alertas do robô: confere cada um dos cinco padrões com a API. */
function conferirAlertasDoRobo(lista: Padrao[]): void {
  const f1 = FORNECEDORES.F1
  // 1. primeira operação com fornecedor novo já a partir de R$ 1.000,00 (inclusive): C (1000,00) alerta; D (999,99) e E (2º do F1) não
  const novos = lista.filter((a) => a.tipo === 'FORNECEDOR_NOVO_PAGAMENTO_ALTO')
  const doC = novos.filter((a) => a.id_titulo === estado.idTitulo.C)
  expect(
    doC,
    'a primeira operação do fornecedor 1 (R$ 1.000,00 exatos) tem de gerar UM alerta',
  ).toHaveLength(1)
  expect(doC[0]?.id_fornecedor).toBe(estado.idFornecedor.F1)
  expect(doC[0]?.descricao).toBe(
    `Primeira operação com o fornecedor '${f1.razao}' já é de ${reaisSrv(TITULOS.C.valor)}.`,
  )
  expect(
    novos.filter(
      (a) =>
        a.id_titulo === estado.idTitulo.D || a.id_titulo === estado.idTitulo.E,
    ),
    'R$ 999,99 (abaixo do limite) e a segunda operação do mesmo fornecedor não geram alerta',
  ).toHaveLength(0)

  // 2. solicitação de compra logo abaixo do teto da alçada
  const tetos = lista.filter(
    (a) => a.tipo === 'VALOR_PROXIMO_DO_TETO_DE_ALCADA',
  )
  for (const chave of ['A', 'B', 'C'] as ChaveSolicitacao[]) {
    const s = SOLICITACOES[chave]
    const deste = tetos.filter(
      (a) => a.id_solicitacao === estado.idSolicitacao[chave],
    )
    expect(
      deste,
      `solicitação ${chave} (${reaisSrv(s.valor)}): ${s.alerta ? 'tem de alertar' : 'não pode alertar'}`,
    ).toHaveLength(s.alerta ? 1 : 0)
    if (s.alerta) {
      expect(deste[0]?.descricao).toContain(
        `Solicitação de compra #${estado.idSolicitacao[chave]} (${reaisSrv(s.valor)})`,
      )
      expect(deste[0]?.descricao).toContain(
        `está a menos de 10% do teto de alçada (${reaisSrv(ALCADA_TETO)}) - possível fracionamento.`,
      )
    }
  }

  // 3. pagamento a fornecedor depois de a troca de dados bancários ser APROVADA (F1); antes da troca (C), troca rejeitada (F2) e sem troca: nada
  const aposTroca = lista.filter(
    (a) => a.tipo === 'PAGAMENTO_APOS_TROCA_DE_DADOS_BANCARIOS',
  )
  const pagamentoE = doLivro('E')
  const doE = aposTroca.filter((a) => a.id_lancamento === pagamentoE.id)
  expect(
    doE,
    'o pagamento do título E ao fornecedor 1 (troca aprovada) tem de gerar UM alerta',
  ).toHaveLength(1)
  expect(doE[0]?.id_fornecedor).toBe(estado.idFornecedor.F1)
  expect(doE[0]?.descricao).toContain(
    `Pagamento (lançamento #${pagamentoE.numero}) ao fornecedor #${estado.idFornecedor.F1} 0 dia(s) após a troca de dados bancários ser aprovada.`,
  )
  expect(
    aposTroca.filter((a) => a.id_lancamento === doLivro('C').id),
    'o pagamento feito ANTES da troca ser aprovada não gera alerta',
  ).toHaveLength(0)
  expect(
    aposTroca.filter((a) => a.id_fornecedor === estado.idFornecedor.F2),
    'troca REJEITADA não vale como troca: o pagamento ao fornecedor 2 não gera alerta',
  ).toHaveLength(0)

  // 4. lançamento fora do expediente: depende da hora em que o roteiro rodou
  const fora = lista.filter((a) => a.tipo === 'LANCAMENTO_FORA_DO_HORARIO')
  for (const l of livro) {
    const alerta = fora.find((a) => a.id_lancamento === l.id)
    const [h1, h2] = l.horas
    if (foraDoExpediente(h1) && foraDoExpediente(h2)) {
      expect(
        alerta,
        `o lançamento ${l.rotulo} foi gravado às ${h1}h (fora do expediente ${HORA_INICIO}h-${HORA_FIM}h): tem de alertar`,
      ).toBeDefined()
    } else if (!foraDoExpediente(h1) && !foraDoExpediente(h2)) {
      expect(
        alerta,
        `o lançamento ${l.rotulo} foi gravado às ${h1}h (dentro do expediente): não pode alertar`,
      ).toBeUndefined()
    }
  }
  for (const a of fora) {
    const hora = Number(/registrado às (\d{2})h/.exec(a.descricao)?.[1])
    expect(
      foraDoExpediente(hora),
      `alerta de fora do expediente com hora de expediente: ${a.descricao}`,
    ).toBe(true)
    expect(a.descricao).toContain(
      `fora do expediente (${String(HORA_INICIO).padStart(2, '0')}h-${String(HORA_FIM).padStart(2, '0')}h)`,
    )
  }
}

// ------------------------------------------------------------------------------------------------------------------------------ relatórios
type LinhaBalancete = {
  codigo: string
  anterior: number
  debitos: number
  creditos: number
  atual: number
}
async function lerBalancete(sec: Locator): Promise<LinhaBalancete[]> {
  const celulas = await sec
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''),
      ),
    )
  return celulas.flatMap((c) => {
    if (c.length < 5) return []
    const rotulo = (c[0] ?? '').trim()
    const v = c.slice(1, 5).map((t) => emCentavos(t))
    return [
      {
        codigo: rotulo.split(' — ')[0] ?? rotulo,
        anterior: v[0] ?? Number.NaN,
        debitos: v[1] ?? Number.NaN,
        creditos: v[2] ?? Number.NaN,
        atual: v[3] ?? Number.NaN,
      },
    ]
  })
}
function minhasLinhasDoBalancete(
  linhas: LinhaBalancete[],
): Record<ChaveConta, Saldos | null> {
  const r = {} as Record<ChaveConta, Saldos | null>
  for (const chave of CHAVES_CONTA) {
    const l = linhas.find((x) => x.codigo === CONTAS[chave].codigo)
    r[chave] = l
      ? {
          anterior: l.anterior,
          debitos: l.debitos,
          creditos: l.creditos,
          atual: l.atual,
        }
      : null
  }
  return r
}

async function lerLinhasDeValor(
  sec: Locator,
): Promise<{ rotulo: string; valor: string }[]> {
  const celulas = await sec
    .locator('div.v3-space-y-1 > div')
    .evaluateAll((els) =>
      els.map((el) => Array.from(el.children).map((c) => c.textContent ?? '')),
    )
  return celulas.flatMap((c) =>
    c.length >= 2 ? [{ rotulo: (c[0] ?? '').trim(), valor: c[1] ?? '' }] : [],
  )
}

/** Muda o período de um bloco (De e Até) e devolve a resposta da API para o par exato de datas. */
async function definirPeriodo(
  page: Page,
  sec: Locator,
  rota: string,
  de: string,
  ate: string,
): Promise<Resposta> {
  const datas = sec.locator('input[type="date"]')
  const inicio = datas.nth(0)
  const fim = datas.nth(1)
  const [deAtual, ateAtual] = [
    await inicio.inputValue(),
    await fim.inputValue(),
  ]
  if (deAtual === de && ateAtual === ate) {
    throw new Error(`o período ${de} a ${ate} é o que a tela já tinha`)
  }
  // a ordem dos dois campos evita um período invertido no meio do caminho (o painel consulta a cada mudança)
  const ordem: [Locator, string][] =
    de > ateAtual
      ? [
          [fim, ate],
          [inicio, de],
        ]
      : [
          [inicio, de],
          [fim, ate],
        ]
  const esperada = page.waitForResponse((r) => {
    const url = new URL(r.url())
    return (
      url.pathname === rota &&
      url.searchParams.get('data_inicio') === `${de}T00:00:00` &&
      url.searchParams.get('data_fim') === `${ate}T23:59:59`
    )
  })
  for (const [campoDeData, valor] of ordem) await campoDeData.fill(valor)
  const resposta = await esperada
  expect(resposta.status(), await resposta.text()).toBe(200)
  return resposta
}

type LinhaInadimplencia = {
  nome_completo: string
  total_devido: number
  quantidade_titulos_vencidos: number
  dias_atraso_maximo: number
}
type PrestacaoListada = {
  id_prestacao: number
  ano_exercicio: number
  versao: number
}

/** As 7 respostas que a página de Relatórios pede ao abrir (a da data padrão: 1º de janeiro até agora). */
async function abrirRelatorios(page: Page): Promise<{
  inadimplencia: LinhaInadimplencia[]
  padroes: Padrao[]
  prestacoes: PrestacaoListada[]
}> {
  const ok = (caminho: string) =>
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === caminho && r.status() === 200,
    )
  const esperadas = Promise.all([
    ok('/api/relatorios/balancete'),
    ok('/api/relatorios/receitas-despesas'),
    ok('/api/relatorios/inadimplencia'),
    ok('/api/relatorios/por-projeto'),
    ok(ROTA_PADROES),
    ok('/api/prestacoes-de-contas/'),
    ok('/api/contas-financeiras/'),
  ])
  await page.goto('/financeiro/relatorios')
  const [, , inadimplencia, , padroes, prestacoes] = await esperadas
  await expect(
    page.getByRole('heading', { name: 'Relatórios', level: 1 }),
  ).toBeVisible()
  return {
    inadimplencia: (await inadimplencia.json()) as LinhaInadimplencia[],
    padroes: (await padroes.json()) as Padrao[],
    prestacoes: (await prestacoes.json()) as PrestacaoListada[],
  }
}

const TITULOS_DOS_BLOCOS = [
  'Balancete por período',
  'Receitas x despesas',
  'Inadimplência',
  'Extrato por Conta Financeira',
  'Por projeto',
  'Padrões suspeitos (Conselho Fiscal)',
  'Prestação de contas do exercício',
]

// ------------------------------------------------------------------------------------------------------------------------------ limpeza
// Se o roteiro cair no meio, a alçada de teste (valores gigantes) não pode ficar ativa para as próximas rodadas.
test.afterAll(async ({ browser }) => {
  if (!estado.alcadaAtiva) return
  test.setTimeout(240_000)
  exigirHomologacao()
  const contexto = await browser.newContext(NAVEGADOR)
  try {
    const page = await contexto.newPage()
    await entrar(page, 'presidente')
    await page.goto('/financeiro/alcadas-aprovacao')
    const minha = cartao(
      page,
      `${brl(ALCADA_MINIMO)} até ${brl(ALCADA_TETO)}`,
    ).filter({ has: page.getByText('Ativa', { exact: true }) })
    await expect(minha.first()).toBeVisible()
    for (let i = 0; i < 5; i += 1) {
      const ativas = await minha.count()
      if (ativas === 0) break
      await minha.first().getByRole('button', { name: 'Inativar' }).click()
      await expect(minha).toHaveCount(ativas - 1)
    }
    test.info().annotations.push({
      type: 'restauro',
      description: 'a alçada de teste ficou inativa',
    })
  } finally {
    await contexto.close()
  }
})

// =====================================================================================================================================
// A. OS DADOS (pela tela, com as recusas e a Auditoria)
// =====================================================================================================================================
test('1. base: o Presidente cria as três contas, a conta financeira e o centro de custo ligado a um projeto; vazio e repetido são recusados e a Auditoria registra', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  for (const tabela of TABELAS)
    antes[tabela] = await abrirAuditoria(page, tabela)

  // ---- plano de contas
  await page.goto('/financeiro/plano-contas')
  await expect(
    page.getByRole('heading', { name: 'Plano de Contas', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
  const formConta = page.locator('form')
  await expect(formConta).toBeVisible()
  await formConta.getByRole('button', { name: 'Salvar' }).click()
  for (const mensagem of [
    'Informe o código contábil.',
    'Informe a descrição.',
    'Selecione o tipo.',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'conta contabil vazia: recusada')
  for (const chave of CHAVES_CONTA) {
    estado.idConta[chave] = await criarConta(page, chave)
  }
  await ver(page, info, 'as tres contas do robo criadas')
  // repetir o código é recusado e a tela diz por quê
  await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
  await formConta.getByPlaceholder('Código contábil').fill(CONTAS.ATV.codigo)
  await formConta
    .getByPlaceholder('Descrição', { exact: true })
    .fill(`Repetida ${S}`)
  const tipoRepetida = formConta.locator('select').first()
  await expect(
    tipoRepetida.locator('option', { hasText: 'Ativo' }),
  ).toBeAttached()
  await tipoRepetida.selectOption('Ativo')
  const [repetida] = await Promise.all([
    respostaDe(page, 'POST', '/plano-contas/'),
    formConta.getByRole('button', { name: 'Salvar' }).click(),
  ])
  expect(repetida.status()).toBe(400)
  await expect(
    page.getByText('Já existe uma conta com esse código contábil.'),
  ).toBeVisible()
  await ver(page, info, 'conta com codigo repetido: recusada')
  await formConta.getByRole('button', { name: 'Cancelar' }).click()

  // ---- conta financeira (o Caixa do robô)
  await page.goto('/financeiro/contas-financeiras')
  await expect(
    page.getByRole('heading', { name: 'Contas Financeiras', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Nova conta financeira' }).click()
  const formCf = page.locator('form')
  await formCf.getByRole('button', { name: 'Cadastrar' }).click()
  for (const mensagem of ['Selecione a conta contábil.', 'Selecione o tipo.']) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'conta financeira vazia: recusada')
  const escolherContaFinanceira = async () => {
    const conta = formCf.locator('select').nth(0)
    await expect(
      conta.locator('option', { hasText: CONTAS.ATV.codigo }),
    ).toBeAttached()
    await escolherPorTexto(conta, CONTAS.ATV.codigo)
    const tipo = formCf.locator('select').nth(1)
    await expect(tipo.locator('option', { hasText: 'Caixa' })).toBeAttached()
    await tipo.selectOption('Caixa')
  }
  await escolherContaFinanceira()
  const [criadaCf] = await Promise.all([
    respostaDe(page, 'POST', '/api/contas-financeiras/'),
    formCf.getByRole('button', { name: 'Cadastrar' }).click(),
  ])
  expect(criadaCf.status(), await criadaCf.text()).toBe(200)
  estado.idContaFinanceira = (
    (await criadaCf.json()) as { id_conta_financeira: number }
  ).id_conta_financeira
  const cartaoCf = cartao(page, CONTAS.ATV.codigo)
  await expect(cartaoCf).toContainText('Caixa')
  await expect(cartaoCf).toContainText(brl(0))
  await ver(page, info, 'conta financeira criada com saldo zero')
  // a mesma conta contábil não vira Conta Financeira duas vezes
  await page.getByRole('button', { name: 'Nova conta financeira' }).click()
  await escolherContaFinanceira()
  const [repetidaCf] = await Promise.all([
    respostaDe(page, 'POST', '/api/contas-financeiras/'),
    formCf.getByRole('button', { name: 'Cadastrar' }).click(),
  ])
  expect(repetidaCf.status()).toBe(400)
  await expect(
    formCf.getByRole('alert').filter({
      hasText: 'Esta conta contábil já é uma Conta Financeira.',
    }),
  ).toBeVisible()
  await ver(page, info, 'conta financeira repetida: recusada')
  await formCf.getByRole('button', { name: 'Cancelar' }).click()

  // ---- centro de custo ligado a um projeto
  await page.goto('/financeiro/centros-custo')
  await expect(
    page.getByRole('heading', { name: 'Centros de Custo', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Novo centro de custo' }).click()
  const formCc = page.locator('form')
  await formCc.getByRole('button', { name: 'Cadastrar' }).click()
  for (const mensagem of ['Informe o código.', 'Informe o nome.']) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'centro de custo vazio: recusado')
  const preencherCentro = async () => {
    await formCc.getByPlaceholder('Código').fill(CENTRO.codigo)
    await formCc.getByPlaceholder('Nome').fill(CENTRO.nome)
    const projeto = formCc.locator(
      'select[title="Vincula este centro de custo a um projeto (opcional)"]',
    )
    await expect(projeto.locator('option')).not.toHaveCount(1)
    await projeto.selectOption({ index: 1 })
    estado.projeto = (await projeto.locator('option').nth(1).innerText()).trim()
  }
  await preencherCentro()
  const [criadoCc] = await Promise.all([
    respostaDe(page, 'POST', '/api/centros-custo/'),
    formCc.getByRole('button', { name: 'Cadastrar' }).click(),
  ])
  expect(criadoCc.status(), await criadoCc.text()).toBe(200)
  estado.idCentro = (
    (await criadoCc.json()) as { id_centro_custo: number }
  ).id_centro_custo
  const cartaoCc = cartao(page, CENTRO.codigo)
  await expect(cartaoCc).toContainText(CENTRO.nome)
  await expect(cartaoCc).toContainText('Ativo')
  await expect(cartaoCc).toContainText('Projeto #')
  await ver(page, info, 'centro de custo criado e ligado ao projeto')
  await page.getByRole('button', { name: 'Novo centro de custo' }).click()
  await preencherCentro()
  const [repetidoCc] = await Promise.all([
    respostaDe(page, 'POST', '/api/centros-custo/'),
    formCc.getByRole('button', { name: 'Cadastrar' }).click(),
  ])
  expect(repetidoCc.status()).toBe(400)
  await expect(
    formCc.getByRole('alert').filter({
      hasText: 'Já existe um centro de custo com esse código.',
    }),
  ).toBeVisible()
  await ver(page, info, 'centro de custo repetido: recusado')
  await formCc.getByRole('button', { name: 'Cancelar' }).click()

  // ---- Auditoria: cada criação deixou um registro (e só elas: as recusas não somaram)
  expect(await abrirAuditoria(page, 'plano_de_contas')).toBe(
    total0('plano_de_contas') + 3,
  )
  for (const chave of CHAVES_CONTA) {
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: estado.idConta[chave],
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria: as tres contas')
  expect(await abrirAuditoria(page, 'contas_financeiras')).toBe(
    total0('contas_financeiras') + 1,
  )
  await expect(
    linhaDaAuditoria(page, 'CREATE', {
      registro: estado.idContaFinanceira,
      quem: PRESIDENTE,
    }),
  ).toBeVisible()
  expect(await abrirAuditoria(page, 'centros_de_custo')).toBe(
    total0('centros_de_custo') + 1,
  )
  await expect(
    linhaDaAuditoria(page, 'CREATE', {
      registro: estado.idCentro,
      quem: PRESIDENTE,
    }),
  ).toBeVisible()
  await ver(page, info, 'auditoria: centro de custo')
  expect(vigia.problemas()).toEqual([])
})

test('2. a tesouraria cadastra dois fornecedores e lança os cinco títulos; campos vazios, CNPJ incompleto e CNPJ repetido são recusados', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  // as permissões do cargo chegaram quando o Início oferece o Financeiro
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
  await page.goto('/financeiro/fornecedores')
  await expect(
    page.getByRole('heading', { name: 'Fornecedores', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Novo fornecedor' }).click()
  const form = page.locator('form')
  await form.getByRole('button', { name: 'Salvar' }).click()
  for (const mensagem of [
    'Informe a razão social.',
    'CNPJ deve ter 14 dígitos.',
    'Informe a categoria de serviço.',
    'Informe o telefone.',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'fornecedor vazio: recusado')
  // CNPJ com 17 caracteres mas só 12 dígitos: passa na tela e o servidor recusa
  await form.getByPlaceholder('Razão social').fill(FORNECEDORES.F1.razao)
  await form.getByPlaceholder('CNPJ').fill('12.345.678/0001-9')
  await form.getByPlaceholder('Categoria de serviço').fill('Serviços de teste')
  await form.getByPlaceholder('Telefone').fill('91988887777')
  const [incompleto] = await Promise.all([
    respostaDe(page, 'POST', '/fornecedores/'),
    form.getByRole('button', { name: 'Salvar' }).click(),
  ])
  expect(incompleto.status()).toBe(422)
  await expect(
    page.getByRole('alert').filter({ hasText: 'CNPJ deve conter 14 dígitos.' }),
  ).toHaveCount(1)
  await ver(page, info, 'CNPJ com 12 digitos: recusado pelo servidor')
  estado.idFornecedor.F1 = await criarFornecedor(page, 'F1')
  await page.getByRole('button', { name: 'Novo fornecedor' }).click()
  estado.idFornecedor.F2 = await criarFornecedor(page, 'F2')
  await ver(page, info, 'os dois fornecedores do robo')
  // o mesmo CNPJ não entra duas vezes
  await page.getByRole('button', { name: 'Novo fornecedor' }).click()
  await form.getByPlaceholder('Razão social').fill(`Duplicado ${S}`)
  await form.getByPlaceholder('CNPJ').fill(FORNECEDORES.F1.cnpj)
  await form.getByPlaceholder('Categoria de serviço').fill('Serviços de teste')
  await form.getByPlaceholder('Telefone').fill('91988887777')
  const [duplicado] = await Promise.all([
    respostaDe(page, 'POST', '/fornecedores/'),
    form.getByRole('button', { name: 'Salvar' }).click(),
  ])
  expect(duplicado.status()).toBe(400)
  await expect(
    page.getByText('Já existe um fornecedor com esse CNPJ.'),
  ).toBeVisible()
  await ver(page, info, 'CNPJ repetido: recusado')
  await form.getByRole('button', { name: 'Cancelar' }).click()

  // ---- os cinco títulos
  await page.goto('/financeiro/titulos')
  await expect(
    page.getByRole('heading', { name: 'Títulos', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Novo título' }).click()
  await expect(page.getByPlaceholder('Valor original')).toBeVisible()
  await inventariarSemTravar(page, info, 'titulos-novo')
  for (const chave of CHAVES_TITULO) {
    estado.idTitulo[chave] = await lancarTitulo(page, chave)
  }
  for (const chave of CHAVES_TITULO) {
    const c = cartao(page, TITULOS[chave].descricao)
    await expect(c).toContainText('Pendente')
    await expect(c).toContainText(
      `Original ${brl(TITULOS[chave].valor)} · Saldo ${brl(TITULOS[chave].valor)}`,
    )
  }
  await ver(page, info, 'os cinco titulos lancados, todos pendentes')
  expect(vigia.problemas()).toEqual([])
})

test('3. as baixas A, B e C: campos vazios, valor a mais e falta de comprovante são recusados; a competência antiga vai para o período dela; o razão registra', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()

  // o saldo em caixa (todas as contas Ativo) antes de o robô mexer: o saldo final tem de somar exatamente o que ele lançou
  await page.goto('/financeiro/razao-contabil')
  const saldoCaixa = page.getByText(/^Saldo em caixa \(contas Ativo\):/)
  await expect(saldoCaixa).toBeVisible()
  estado.caixaAntes = emCentavos(await saldoCaixa.innerText())

  await page.goto('/financeiro/titulos')
  await expect(
    page.getByRole('heading', { name: 'Títulos', level: 1 }),
  ).toBeVisible()

  // ---- A (a receber, R$ 5.000,00): tudo vazio é recusado na tela
  const a = await abrirBaixa(page, 'A')
  await a.form.getByRole('button', { name: 'Confirmar baixa' }).click()
  for (const mensagem of [
    'Informe um valor maior que zero.',
    'Informe a forma de pagamento.',
    'Selecione a conta de contrapartida.',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'baixa vazia: recusada na tela')
  // sem data de competência (o campo é opcional: "se vazia, usa a data de hoje")
  await preencherBaixa(a.form, PAGO.A)
  const horaA1 = horaEmSaoPaulo()
  const vazia = await submeterBaixa(page, a.form)
  const horaA2 = horaEmSaoPaulo()
  expect(vazia.status(), await vazia.text()).toBeLessThan(500)
  if (vazia.ok()) {
    estado.competenciaVazia = 'aceita'
    await registrarBaixa('A', vazia, diaUtc(), [horaA1, horaA2], false)
    await expect(a.form).toHaveCount(0)
  } else {
    estado.competenciaVazia = 'recusada'
    const aviso = (await a.form.getByRole('alert').first().innerText())
      .replace(/\s+/g, ' ')
      .trim()
    achar(
      `a baixa sem data de competência (campo "opcional") foi RECUSADA com HTTP ${vazia.status()}: o formulário manda data_competencia vazia e o servidor não a aceita; a tela mostra "${aviso}"`,
    )
    await ver(page, info, 'baixa sem competencia: recusada (achado)')
    await a.form.locator('input[type="date"]').fill(diaEmBelem(0))
    const horaA3 = horaEmSaoPaulo()
    const refeita = await submeterBaixa(page, a.form)
    const horaA4 = horaEmSaoPaulo()
    expect(refeita.status(), await refeita.text()).toBe(200)
    await registrarBaixa('A', refeita, diaEmBelem(0), [horaA3, horaA4], false)
    await expect(a.form).toHaveCount(0)
  }
  const cartaoA = cartao(page, TITULOS.A.descricao)
  await expect(cartaoA).toContainText('Pago')
  await expect(cartaoA).toContainText(
    `Original ${brl(TITULOS.A.valor)} · Saldo ${brl(0)}`,
  )
  await ver(page, info, 'titulo A pago')

  // ---- B (a receber, R$ 1.234,56) com competência de 10/03/2025: cai no período de março de 2025
  await baixarComSucesso(page, 'B', COMPETENCIA_ANTIGA, false)
  const cartaoB = cartao(page, TITULOS.B.descricao)
  await expect(cartaoB).toContainText('Pago')
  await expect(cartaoB).toContainText(
    `Original ${brl(TITULOS.B.valor)} · Saldo ${brl(0)}`,
  )
  await ver(page, info, 'titulo B pago com competencia antiga')

  // ---- C (a pagar, R$ 1.000,00, fornecedor 1): valor a mais e falta de comprovante são recusados
  const c = await abrirBaixa(page, 'C')
  await preencherBaixa(c.form, TITULOS.C.valor + 1)
  await c.form.locator('input[type="date"]').fill(diaEmBelem(0))
  const [aMais] = await Promise.all([
    respostaDe(page, 'POST', '/baixar-titulo/'),
    c.form.getByRole('button', { name: 'Confirmar baixa' }).click(),
  ])
  expect(aMais.status()).toBe(400)
  const textoAMais = (await c.form.getByRole('alert').first().innerText())
    .replace(/\s+/g, ' ')
    .trim()
  expect(textoAMais).toContain(
    `Valor pago maior que o saldo devedor (${reaisSrv(TITULOS.C.valor)})`,
  )
  if (/id_conta_contabil_adiantamento/.test(textoAMais)) {
    achar(
      `a recusa de valor a mais mostra nome de campo interno ao usuário: "${textoAMais}"`,
    )
  }
  await ver(page, info, 'baixa com valor a mais: recusada')
  await c.form.getByPlaceholder('Valor pago').fill(decimal(PAGO.C))
  const [semComprovante] = await Promise.all([
    respostaDe(page, 'POST', '/baixar-titulo/'),
    c.form.getByRole('button', { name: 'Confirmar baixa' }).click(),
  ])
  expect(semComprovante.status()).toBe(400)
  const textoSemComprovante = (
    await c.form.getByRole('alert').first().innerText()
  )
    .replace(/\s+/g, ' ')
    .trim()
  expect(textoSemComprovante).toContain(
    "Comprovante obrigatório para lançamento em conta do tipo 'Despesa'",
  )
  if (/POST \/api\//.test(textoSemComprovante)) {
    achar(
      `a recusa de falta de comprovante manda o usuário "Enviar por POST /api/comprovantes/" (instrução técnica na tela): "${textoSemComprovante}"`,
    )
  }
  await ver(page, info, 'baixa de despesa sem comprovante: recusada')
  await anexarComprovante(c.form)
  const horaC1 = horaEmSaoPaulo()
  const pagaC = await submeterBaixa(page, c.form)
  const horaC2 = horaEmSaoPaulo()
  expect(pagaC.status(), await pagaC.text()).toBe(200)
  const corpoC = await registrarBaixa(
    'C',
    pagaC,
    diaEmBelem(0),
    [horaC1, horaC2],
    true,
  )
  expect(corpoC.saldo_restante).toBeCloseTo(0, 2)
  await expect(c.form).toHaveCount(0)
  const cartaoC = cartao(page, TITULOS.C.descricao)
  await expect(cartaoC).toContainText('Pago')
  await expect(cartaoC).toContainText(
    `Original ${brl(TITULOS.C.valor)} · Saldo ${brl(0)}`,
  )
  await ver(page, info, 'titulo C pago com comprovante')

  // ---- o razão registra: lançamento, partidas, competência e comprovante
  await page.goto('/financeiro/razao-contabil')
  await expect(
    page.getByRole('heading', { name: 'Razão Contábil', level: 1 }),
  ).toBeVisible()
  const razaoB = cartao(page, doLivro('B').historico)
  await expect(razaoB).toHaveCount(1)
  await expect(razaoB).toContainText(
    `Debito ${CONTAS.ATV.descricao} ${brl(TITULOS.B.valor)} · Credito ${CONTAS.REC.descricao} ${brl(TITULOS.B.valor)}`,
  )
  await expect(razaoB).toContainText(
    `Competência: ${dataBr(COMPETENCIA_ANTIGA)}`,
  )
  const razaoC = cartao(page, doLivro('C').historico)
  await expect(razaoC).toContainText(
    `Debito ${CONTAS.DES.descricao} ${brl(TITULOS.C.valor)} · Credito ${CONTAS.ATV.descricao} ${brl(TITULOS.C.valor)}`,
  )
  await expect(
    razaoC.getByRole('link', { name: 'Ver comprovante' }),
  ).toBeVisible()
  await ver(page, info, 'razao: baixas B e C')
  expect(vigia.problemas()).toEqual([])
})

test('4. a tesouraria pede a troca dos dados bancários dos dois fornecedores; aprovar a própria troca é recusado', async ({
  page,
}, info) => {
  test.setTimeout(420_000)
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
  await page.goto('/financeiro/fornecedores')
  await expect(
    page.getByRole('heading', { name: 'Fornecedores', level: 1 }),
  ).toBeVisible()
  for (const chave of ['F1', 'F2'] as ChaveFornecedor[]) {
    const f = FORNECEDORES[chave]
    const card = cartao(page, f.razao)
    await expect(card).toHaveCount(1)
    await card.getByRole('button', { name: 'Dados bancários' }).click()
    await card.getByRole('button', { name: 'Solicitar troca' }).click()
    const form = card.locator('form')
    await expect(form).toBeVisible()
    if (chave === 'F1') {
      await form
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
          card.getByRole('alert').filter({ hasText: mensagem }),
        ).toHaveCount(1)
      }
      await ver(page, info, 'troca de dados bancarios vazia: recusada')
    }
    await form.getByPlaceholder('Banco', { exact: true }).fill('Banco de Teste')
    await form.getByPlaceholder('Agência', { exact: true }).fill('0001')
    await form.getByPlaceholder('Conta', { exact: true }).fill('12345-6')
    await form.getByPlaceholder('Tipo (Corrente/Poupança)').fill('Corrente')
    await form
      .getByPlaceholder('Titular da conta')
      .fill(`Titular ${chave} ${S}`)
    const [pedida] = await Promise.all([
      respostaDe(page, 'POST', /^\/api\/fornecedores\/dados-bancarios$/),
      form
        .getByRole('button', { name: 'Solicitar (aguarda segundo aprovador)' })
        .click(),
    ])
    expect(pedida.status(), await pedida.text()).toBe(200)
    estado.idDadosBancarios[chave] = (
      (await pedida.json()) as { id_dados_bancarios: number }
    ).id_dados_bancarios
    await expect(card.getByText('Pendente', { exact: true })).toBeVisible()
    if (chave === 'F1') {
      // quem pediu a troca não a aprova
      const [propria] = await Promise.all([
        respostaDe(page, 'POST', /\/aprovar$/),
        card.getByRole('button', { name: 'Aprovar (2º aprovador)' }).click(),
      ])
      expect(propria.status()).toBe(400)
      await expect(
        card.getByText(
          'Quem solicitou a troca de dados bancários não pode aprová-la - exige um segundo aprovador.',
        ),
      ).toBeVisible()
      await expect(card.getByText('Pendente', { exact: true })).toBeVisible()
      await ver(page, info, 'aprovar a propria troca: recusado')
    } else {
      await ver(page, info, 'troca do fornecedor 2 pedida')
    }
  }
  expect(vigia.problemas()).toEqual([])
})

test('5. o Presidente aprova a troca do fornecedor 1, rejeita a do 2 e cadastra a alçada; a Auditoria mostra as quatro ações dos dados bancários', async ({
  page,
}, info) => {
  test.setTimeout(420_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/financeiro/fornecedores')
  await expect(
    page.getByRole('heading', { name: 'Fornecedores', level: 1 }),
  ).toBeVisible()
  const c1 = cartao(page, FORNECEDORES.F1.razao)
  await c1.getByRole('button', { name: 'Dados bancários' }).click()
  await expect(c1.getByText('Pendente', { exact: true })).toBeVisible()
  const [aprovada] = await Promise.all([
    respostaDe(page, 'POST', /\/aprovar$/),
    c1.getByRole('button', { name: 'Aprovar (2º aprovador)' }).click(),
  ])
  expect(aprovada.status(), await aprovada.text()).toBe(200)
  await expect(c1.getByText('Aprovado', { exact: true })).toBeVisible()
  await ver(page, info, 'troca do fornecedor 1 aprovada pelo Presidente')
  const c2 = cartao(page, FORNECEDORES.F2.razao)
  await c2.getByRole('button', { name: 'Dados bancários' }).click()
  await expect(c2.getByText('Pendente', { exact: true })).toBeVisible()
  const [rejeitada] = await Promise.all([
    respostaDe(page, 'POST', /\/rejeitar$/),
    c2.getByRole('button', { name: 'Rejeitar' }).click(),
  ])
  expect(rejeitada.status(), await rejeitada.text()).toBe(200)
  await expect(c2.getByText('Rejeitado', { exact: true })).toBeVisible()
  await ver(page, info, 'troca do fornecedor 2 rejeitada')

  // ---- a alçada do robô (valores altos, só para o alerta de "perto do teto")
  await page.goto('/financeiro/alcadas-aprovacao')
  await expect(
    page.getByRole('heading', { name: 'Alçadas de Aprovação', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Nova alçada' }).click()
  const form = page.locator('form')
  await form.getByRole('button', { name: 'Cadastrar alçada' }).click()
  await expect(
    page.getByRole('alert').filter({
      hasText: 'Informe ao menos um cargo (códigos separados por vírgula).',
    }),
  ).toHaveCount(1)
  await ver(page, info, 'alcada sem cargo: recusada')
  await form.getByPlaceholder('Valor mínimo').fill(decimal(ALCADA_MINIMO))
  await form.getByPlaceholder('Valor máximo').fill(decimal(ALCADA_TETO))
  await form.getByPlaceholder('Cargos').fill('PRESIDENTE')
  const [alcada] = await Promise.all([
    respostaDe(page, 'POST', '/api/alcadas-aprovacao/'),
    form.getByRole('button', { name: 'Cadastrar alçada' }).click(),
  ])
  expect(alcada.status(), await alcada.text()).toBe(200)
  estado.idAlcada = ((await alcada.json()) as { id_alcada: number }).id_alcada
  estado.alcadaAtiva = true
  const minha = cartao(
    page,
    `${brl(ALCADA_MINIMO)} até ${brl(ALCADA_TETO)}`,
  ).first()
  await expect(minha).toContainText('Ativa')
  await expect(minha).toContainText('Cargos: PRESIDENTE')
  await ver(page, info, 'alcada do robo cadastrada e ativa')

  // ---- Auditoria dos dados bancários: 2 pedidos, 1 aprovação, 1 rejeição, e nada da tentativa recusada
  expect(await abrirAuditoria(page, 'dados_bancarios_fornecedor')).toBe(
    total0('dados_bancarios_fornecedor') + 4,
  )
  for (const chave of ['F1', 'F2'] as ChaveFornecedor[]) {
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: estado.idDadosBancarios[chave],
        quem: TESOUREIRO,
      }),
    ).toBeVisible()
  }
  await expect(
    linhaDaAuditoria(page, 'APROVACAO', {
      registro: estado.idDadosBancarios.F1,
      quem: PRESIDENTE,
    }),
  ).toBeVisible()
  await expect(
    linhaDaAuditoria(page, 'REJEICAO', {
      registro: estado.idDadosBancarios.F2,
      quem: PRESIDENTE,
    }),
  ).toBeVisible()
  await ver(
    page,
    info,
    'auditoria: dados bancarios (pedidos, aprovacao, rejeicao)',
  )
  expect(await abrirAuditoria(page, 'alcadas_aprovacao')).toBe(
    total0('alcadas_aprovacao') + 1,
  )
  await expect(
    linhaDaAuditoria(page, 'CREATE', {
      registro: estado.idAlcada,
      quem: PRESIDENTE,
    }),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('6. as baixas D (parcial, fornecedor de troca rejeitada) e E (fornecedor de troca aprovada) e as três solicitações de compra perto e longe do teto', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
  await page.goto('/financeiro/titulos')
  await expect(
    page.getByRole('heading', { name: 'Títulos', level: 1 }),
  ).toBeVisible()

  // ---- D: R$ 999,99 e o robô paga só R$ 400,00: sobra saldo de R$ 599,99
  const corpoD = await baixarComSucesso(page, 'D', diaEmBelem(0), true)
  expect(corpoD.saldo_restante).toBeCloseTo((TITULOS.D.valor - PAGO.D) / 100, 2)
  const cartaoD = cartao(page, TITULOS.D.descricao)
  await expect(cartaoD).toContainText('Pendente')
  await expect(cartaoD).toContainText(
    `Original ${brl(TITULOS.D.valor)} · Saldo ${brl(TITULOS.D.valor - PAGO.D)}`,
  )
  await ver(page, info, 'titulo D pago em parte: saldo 599,99')

  // ---- E: R$ 2.500,25 pago por inteiro, depois de a troca de dados bancários do fornecedor 1 ser aprovada
  await baixarComSucesso(page, 'E', diaEmBelem(0), true)
  const cartaoE = cartao(page, TITULOS.E.descricao)
  await expect(cartaoE).toContainText('Pago')
  await expect(cartaoE).toContainText(
    `Original ${brl(TITULOS.E.valor)} · Saldo ${brl(0)}`,
  )
  await ver(page, info, 'titulo E pago depois da troca aprovada')

  // ---- as três solicitações de compra (perto do teto, um centavo fora da faixa, um centavo acima do teto)
  await page.goto('/financeiro/compras')
  await expect(
    page.getByRole('heading', { name: 'Compras', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Nova solicitação' }).click()
  const form = page.locator('form')
  await form.getByRole('button', { name: 'Criar solicitação' }).click()
  for (const mensagem of [
    'Informe a descrição da compra.',
    'Valor estimado deve ser maior que zero.',
    'Selecione a conta contábil (Despesa).',
  ]) {
    await expect(
      page.getByRole('alert').filter({ hasText: mensagem }),
    ).toHaveCount(1)
  }
  await ver(page, info, 'solicitacao vazia: recusada')
  for (const chave of ['A', 'B', 'C'] as ChaveSolicitacao[]) {
    const s = SOLICITACOES[chave]
    if ((await form.count()) === 0) {
      await page.getByRole('button', { name: 'Nova solicitação' }).click()
      await expect(form).toBeVisible()
    }
    await form.getByPlaceholder('Descrição da compra').fill(s.descricao)
    await form.getByPlaceholder('Valor estimado').fill(decimal(s.valor))
    const conta = form.locator('select').first()
    await expect(
      conta.locator('option', { hasText: CONTAS.DES.codigo }),
    ).toBeAttached()
    await escolherPorTexto(conta, CONTAS.DES.codigo)
    const [criada] = await Promise.all([
      respostaDe(page, 'POST', '/api/solicitacoes-compra/'),
      form.getByRole('button', { name: 'Criar solicitação' }).click(),
    ])
    expect(criada.status(), await criada.text()).toBe(200)
    estado.idSolicitacao[chave] = (
      (await criada.json()) as { id_solicitacao: number }
    ).id_solicitacao
    await expect(form).toHaveCount(0)
    const c = cartao(page, s.descricao)
    await expect(c).toContainText(`Valor estimado: ${brl(s.valor)}`)
    await expect(c).toContainText('Aguardando Aprovação')
  }
  await ver(page, info, 'as tres solicitacoes de compra')
  expect(vigia.problemas()).toEqual([])
})

test('7. o Tesoureiro faz três estornos (motivo curto é recusado, estornar duas vezes é recusado) e os títulos voltam a ficar pendentes com o saldo certo', async ({
  page,
}, info) => {
  test.setTimeout(900_000)
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()

  // quantos estornos cada usuário já tem no mês (alerta a partir de 3): o que mudar daqui em diante é do robô
  const mes = mesUtc()
  estado.estornosAntes = estornosPorUsuario((await lerPadroes(page, mes)).lista)

  const estornar = async (
    chave: ChaveTitulo,
    motivo: string,
  ): Promise<{ id_lancamento_estorno: number; numero_sequencial: number }> => {
    const original = doLivro(chave)
    const card = cartao(page, original.historico)
    await expect(card).toHaveCount(1)
    await card.getByRole('button', { name: 'Estornar', exact: true }).click()
    const form = card.locator('form')
    await expect(form).toBeVisible()
    await form.getByPlaceholder('Motivo do estorno').fill(motivo)
    const horas1 = horaEmSaoPaulo()
    const [resposta] = await Promise.all([
      respostaDe(page, 'POST', /\/estornar$/),
      form.getByRole('button', { name: 'Confirmar estorno' }).click(),
    ])
    const horas2 = horaEmSaoPaulo()
    expect(resposta.status(), await resposta.text()).toBe(200)
    const corpo = (await resposta.json()) as {
      id_lancamento_estorno: number
      numero_sequencial: number
    }
    livro.push({
      rotulo: `E${chave}`,
      id: corpo.id_lancamento_estorno,
      numero: corpo.numero_sequencial,
      dia: diaUtc(),
      historico: `Estorno do lançamento #${original.numero}: ${motivo}`,
      partidas: invertidas(original.partidas),
      estornado: false,
      horas: [horas1, horas2],
      comprovante: false,
    })
    original.estornado = true
    await expect(card).toContainText('Estornado')
    await expect(card).toContainText(`Motivo do estorno: ${motivo}`)
    await expect(card).toContainText(
      `(lançamento #${corpo.id_lancamento_estorno})`,
    )
    await expect(
      card.getByRole('button', { name: 'Estornar', exact: true }),
    ).toHaveCount(0)
    return corpo
  }

  await page.goto('/financeiro/razao-contabil')
  await expect(
    page.getByRole('heading', { name: 'Razão Contábil', level: 1 }),
  ).toBeVisible()

  // ---- estorno 1 (B): motivo vazio, curto e curto depois de aparado são recusados
  const cartaoB = cartao(page, doLivro('B').historico)
  await cartaoB.getByRole('button', { name: 'Estornar', exact: true }).click()
  const formB = cartaoB.locator('form')
  await formB.getByRole('button', { name: 'Confirmar estorno' }).click()
  await expect(
    cartaoB.getByRole('alert').filter({
      hasText: 'Informe o motivo (mínimo 5 caracteres).',
    }),
  ).toHaveCount(1)
  await formB.getByPlaceholder('Motivo do estorno').fill('abc')
  await formB.getByRole('button', { name: 'Confirmar estorno' }).click()
  await expect(
    cartaoB.getByRole('alert').filter({
      hasText: 'Informe o motivo (mínimo 5 caracteres).',
    }),
  ).toHaveCount(1)
  await ver(page, info, 'estorno com motivo curto: recusado na tela')
  await formB.getByPlaceholder('Motivo do estorno').fill('  ab  ')
  const [aparado] = await Promise.all([
    respostaDe(page, 'POST', /\/estornar$/),
    formB.getByRole('button', { name: 'Confirmar estorno' }).click(),
  ])
  expect(aparado.status()).toBe(422)
  await expect(
    cartaoB.getByRole('alert').filter({
      hasText: 'Informe o motivo do estorno (mínimo 5 caracteres).',
    }),
  ).toHaveCount(1)
  await ver(page, info, 'estorno com motivo curto depois de aparado: recusado')
  await formB.getByRole('button', { name: 'Cancelar' }).click()
  await estornar(
    'B',
    `Estorno de teste do robô ${S}: baixa antiga lançada por engano`,
  )
  await ver(page, info, 'razao: estorno da baixa B')

  // ---- estorno 2 (D): com outra aba ainda com o pedido aberto, que depois leva a recusa de estornar duas vezes
  const outra = await page.context().newPage()
  const vigiaOutra = vigiar(outra)
  await outra.goto('/financeiro/razao-contabil')
  const cartaoDNaOutra = cartao(outra, doLivro('D').historico)
  await cartaoDNaOutra
    .getByRole('button', { name: 'Estornar', exact: true })
    .click()
  await cartaoDNaOutra
    .getByPlaceholder('Motivo do estorno')
    .fill(`Segunda tentativa do robô ${S}`)
  await estornar(
    'D',
    `Estorno de teste do robô ${S}: pagamento parcial devolvido`,
  )
  const [duplo] = await Promise.all([
    outra.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/estornar$/.test(new URL(r.url()).pathname),
    ),
    cartaoDNaOutra.getByRole('button', { name: 'Confirmar estorno' }).click(),
  ])
  expect(duplo.status()).toBe(400)
  await expect(
    cartaoDNaOutra.getByRole('alert').filter({
      hasText: 'Este lançamento já foi estornado.',
    }),
  ).toBeVisible()
  await ver(outra, info, 'outra aba: estornar duas vezes e recusado')
  expect(vigiaOutra.problemas()).toEqual([])
  await outra.close()

  // ---- com 2 estornos do robô, o usuário dele ainda não chegou ao limite de atenção por causa deles (3)
  estado.estornosDepoisDe2 = estornosPorUsuario(
    (await lerPadroes(page, mes)).lista,
  )

  // ---- estorno 3 (C): agora são 3 no mês
  await page.goto('/financeiro/razao-contabil')
  await expect(
    page.getByRole('heading', { name: 'Razão Contábil', level: 1 }),
  ).toBeVisible()
  await estornar(
    'C',
    `Estorno de teste do robô ${S}: pagamento devolvido pelo fornecedor`,
  )
  estado.mes = mesUtc()
  await ver(page, info, 'razao: os tres estornos')

  // ---- os títulos estornados voltam a pendentes, com o saldo original, centavo a centavo
  await page.goto('/financeiro/titulos')
  await expect(
    page.getByRole('heading', { name: 'Títulos', level: 1 }),
  ).toBeVisible()
  const situacoes: Record<ChaveTitulo, { status: string; saldo: number }> = {
    A: { status: 'Pago', saldo: 0 },
    B: { status: 'Pendente', saldo: TITULOS.B.valor },
    C: { status: 'Pendente', saldo: TITULOS.C.valor },
    D: { status: 'Pendente', saldo: TITULOS.D.valor },
    E: { status: 'Pago', saldo: 0 },
  }
  for (const chave of CHAVES_TITULO) {
    const c = cartao(page, TITULOS[chave].descricao)
    await expect(c).toContainText(situacoes[chave].status)
    await expect(c).toContainText(
      `Original ${brl(TITULOS[chave].valor)} · Saldo ${brl(situacoes[chave].saldo)}`,
    )
  }
  await ver(
    page,
    info,
    'titulos depois dos estornos: B, C e D pendentes de novo',
  )

  // ---- o saldo em caixa (todas as contas Ativo) subiu exatamente o que o robô deixou no Caixa dele
  await page.goto('/financeiro/razao-contabil')
  const saldoCaixa = page.getByText(/^Saldo em caixa \(contas Ativo\):/)
  await expect(saldoCaixa).toBeVisible()
  await expect
    .poll(async () => emCentavos(await saldoCaixa.innerText()), {
      message:
        'saldo em caixa: o que havia antes + o que o robô deixou no Caixa dele',
    })
    .toBe(estado.caixaAntes + saldoAtv())
  expect(saldoAtv()).toBe(TITULOS.A.valor - TITULOS.E.valor)
  expect(vigia.problemas()).toEqual([])
})

test('8. Auditoria: cada ação do roteiro deixou um registro, as recusas não deixaram nenhum, e o comprovante anexado abre e é o mesmo arquivo', async ({
  page,
  request,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')

  expect(await abrirAuditoria(page, 'fornecedores')).toBe(
    total0('fornecedores') + 2,
  )
  for (const chave of ['F1', 'F2'] as ChaveFornecedor[]) {
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: estado.idFornecedor[chave],
        quem: TESOUREIRO,
      }),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria: fornecedores')

  expect(await abrirAuditoria(page, 'titulos_financeiros')).toBe(
    total0('titulos_financeiros') + 5,
  )
  for (const chave of CHAVES_TITULO) {
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: estado.idTitulo[chave],
        quem: TESOUREIRO,
      }),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria: os cinco titulos')

  // 5 baixas aceitas + 3 estornos; as 3 baixas recusadas (valor a mais, sem comprovante, e a de competência vazia, se recusada) e os estornos
  // recusados não entram
  expect(await abrirAuditoria(page, 'lancamentos_contabeis')).toBe(
    total0('lancamentos_contabeis') + 8,
  )
  for (const chave of CHAVES_TITULO) {
    await expect(
      linhaDaAuditoria(page, 'BAIXA_TITULO', {
        registro: doLivro(chave).id,
        quem: TESOUREIRO,
      }),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria: as baixas')
  for (const chave of ['B', 'C', 'D'] as ChaveTitulo[]) {
    await expect(
      linhaDaAuditoria(page, 'ESTORNO', {
        registro: doLivro(chave).id,
        quem: TESOUREIRO,
      }),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria: os estornos')

  expect(await abrirAuditoria(page, 'solicitacoes_compra')).toBe(
    total0('solicitacoes_compra') + 3,
  )
  for (const chave of ['A', 'B', 'C'] as ChaveSolicitacao[]) {
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: estado.idSolicitacao[chave],
        quem: TESOUREIRO,
      }),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria: as tres solicitacoes de compra')

  // ---- o razão mostra cada lançamento do robô como o livro de referência diz (partidas em centavos, situação, estorno)
  await page.goto('/financeiro/razao-contabil')
  await expect(
    page.getByRole('heading', { name: 'Razão Contábil', level: 1 }),
  ).toBeVisible()
  for (const l of livro) {
    const card = cartao(page, l.historico)
    await expect(card, `razão: lançamento ${l.rotulo}`).toHaveCount(1)
    await expect(card).toContainText(`#${l.numero} — ${l.historico}`)
    await expect(card).toContainText(l.estornado ? 'Estornado' : 'Normal')
    const esperado = l.partidas.map(
      (p) => `${p.lado === 'D' ? 'Debito' : 'Credito'}|${p.centavos}`,
    )
    expect(
      partidasLidas(await card.innerText()),
      `razão: partidas do lançamento ${l.rotulo}`,
    ).toEqual(esperado)
  }
  await ver(page, info, 'razao: todos os lancamentos do robo conferidos')

  // ---- o comprovante da baixa C abre e é exatamente o arquivo anexado
  const razaoC = cartao(page, doLivro('C').historico)
  const link = razaoC.getByRole('link', { name: 'Ver comprovante' })
  await expect(link).toBeVisible()
  const href = (await link.getAttribute('href')) ?? ''
  expect(href).toMatch(/\/uploads\/comprovantes\/[\w-]+\.pdf$/)
  const arquivo = await page.request.get(href)
  expect(arquivo.status()).toBe(200)
  expect(arquivo.headers()['content-type']).toBe('application/pdf')
  expect((await arquivo.body()).toString()).toBe(COMPROVANTE)
  // sem login, qualquer pessoa com o endereço baixa o comprovante (a rota /uploads é pública; só o nome aleatório protege): limitação registrada
  // no próprio servidor (app/routers/arquivos.py), anotada aqui para constar
  const semLogin = await request.get(href)
  if (semLogin.status() === 200) {
    observar(
      'o comprovante financeiro abre SEM login para quem tiver o endereço (/uploads/comprovantes/<uuid>.pdf): limitação conhecida do servidor, protegida só pelo nome aleatório',
    )
  }
  await info.attach('comprovante: endereço e resposta sem login', {
    body: `${href}\nsem login: HTTP ${semLogin.status()}`,
    contentType: 'text/plain',
  })
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// B. ANTIFRAUDE: os alertas que o sistema TEM de disparar, vistos por quem tem de vê-los
// =====================================================================================================================================
test('9. o Conselheiro Fiscal vê os alertas que as ações do roteiro provocaram (e só eles): fornecedor novo, perto do teto, troca de dados bancários, estornos e fora do expediente', async ({
  page,
}, info) => {
  test.setTimeout(420_000)
  const vigia = vigiar(page)
  await entrar(page, 'conselheiro')
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
  const { lista, sec } = await lerPadroes(page, estado.mes)
  await conferirPadroesNaTela(sec, lista)
  await ver(page, info, 'conselheiro fiscal: padroes suspeitos do mes')

  conferirAlertasDoRobo(lista)

  // estornos: três estornos do mesmo usuário no mês geram o alerta (limite de atenção 3). O robô fez 3 como Tesoureiro: a contagem dele cresceu
  // exatamente 3; e depois do 2º estorno do robô o alerta só existia se a contagem anterior dele já fosse 1 ou mais.
  const depois = estornosPorUsuario(lista)
  const mudaram = [...depois.entries()].filter(
    ([usuario, n]) => n !== (estado.estornosAntes.get(usuario) ?? 0),
  )
  expect(
    mudaram,
    'só o usuário que estornou (o Tesoureiro) muda de contagem no alerta de estornos',
  ).toHaveLength(1)
  const [usuarioDoRobo, quantidade] = mudaram[0] ?? [0, 0]
  const antesDele = estado.estornosAntes.get(usuarioDoRobo)
  if (antesDele === undefined) {
    expect(
      quantidade,
      'sem alerta antes, o usuário passou a ter 3 estornos ou mais',
    ).toBeGreaterThanOrEqual(3)
  } else {
    expect(quantidade, 'o alerta já existia: cresceu exatamente 3').toBe(
      antesDele + 3,
    )
  }
  const alertaEstornos = lista.find(
    (a) =>
      a.tipo === 'SEQUENCIA_DE_ESTORNOS_MESMO_USUARIO' &&
      a.id_usuario === usuarioDoRobo,
  )
  expect(alertaEstornos?.descricao).toBe(
    `Usuário #${usuarioDoRobo} fez ${quantidade} estornos no período (limite de atenção: 3).`,
  )
  expect(alertaEstornos?.quantidade).toBe(quantidade)
  const antesDosTres = quantidade - 3
  const depoisDeDois = antesDosTres + 2
  expect(
    estado.estornosDepoisDe2.get(usuarioDoRobo),
    `com ${depoisDeDois} estorno(s) no mês o alerta ${depoisDeDois >= 3 ? `diz ${depoisDeDois}` : 'ainda não existe (limite 3)'}`,
  ).toBe(depoisDeDois >= 3 ? depoisDeDois : undefined)
  await ver(page, info, 'conselheiro: alertas conferidos contra a API')

  // ---- o que os alertas oferecem: só texto (sem link para o lançamento, sem "marcar como revisado")
  const algum = sec.locator('div.rounded-md.border').first()
  if ((await algum.count()) > 0) {
    const ligacoes = await algum.getByRole('link').count()
    const botoes = await algum.getByRole('button').count()
    if (ligacoes === 0 && botoes === 0) {
      observar(
        'o alerta antifraude é só texto: não tem link para o lançamento/solicitação/título nem botão de "marcar como revisado" (o Conselho Fiscal não consegue dar baixa no que já analisou)',
      )
    }
  }

  // ---- os alertas só existem aqui: o Início do Financeiro não os destaca e o sino de Notificações não abre nada
  await page.goto('/')
  await expect(page.getByText(/Bem-vindo, /)).toBeVisible()
  await page.getByRole('button', { name: 'Notificações' }).click()
  await page.waitForTimeout(600)
  const abriu =
    (await page.getByRole('dialog').count()) +
    (await page.getByRole('menu').count()) +
    (await page.getByText(/suspeit|alerta/i).count())
  if (abriu === 0) {
    observar(
      'o sino de Notificações do topo não abre nada e o Início não destaca nenhum alerta antifraude: eles só aparecem se alguém abrir Financeiro > Relatórios',
    )
  }
  await ver(page, info, 'inicio do conselheiro: nenhum destaque de alerta')
  expect(vigia.problemas()).toEqual([])
})

test('10. os alertas seguem os dados: o mês é o da gravação (não o da competência), a alçada inativa apaga o alerta e reativada o traz de volta; competência vazia não pode derrubar o relatório', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')

  // ---- o mês de março de 2025 (competência da baixa B) e o mês seguinte ao de hoje não têm nenhum alerta do robô: vale o dia em que foi gravado
  for (const mes of [
    '2025-03',
    somarDias(`${estado.mes}-15`, 40).slice(0, 7),
  ]) {
    const { lista, sec } = await lerPadroes(page, mes)
    expect(lista.filter(ehDoRobo), `mês ${mes}: nenhum alerta do robô`).toEqual(
      [],
    )
    await conferirPadroesNaTela(sec, lista)
    await ver(page, info, `padroes suspeitos de ${mes}`)
  }

  // ---- a alçada ativa/inativa muda o alerta de "perto do teto"
  const temAlertaA = async (): Promise<boolean> => {
    const { lista } = await lerPadroes(page, estado.mes)
    return lista.some(
      (a) =>
        a.tipo === 'VALOR_PROXIMO_DO_TETO_DE_ALCADA' &&
        a.id_solicitacao === estado.idSolicitacao.A,
    )
  }
  const alternarAlcada = async (rotulo: 'Inativar' | 'Reativar') => {
    await page.goto('/financeiro/alcadas-aprovacao')
    const minha = cartao(
      page,
      `${brl(ALCADA_MINIMO)} até ${brl(ALCADA_TETO)}`,
    ).first()
    await expect(minha).toBeVisible()
    const [resposta] = await Promise.all([
      respostaDe(page, 'PUT', /\/api\/alcadas-aprovacao\/\d+\/ativo$/),
      minha.getByRole('button', { name: rotulo }).click(),
    ])
    expect(resposta.status(), await resposta.text()).toBe(200)
    estado.alcadaAtiva = rotulo === 'Reativar'
    await expect(minha).toContainText(
      rotulo === 'Inativar' ? 'Inativa' : 'Ativa',
    )
    await ver(page, info, `alcada do robo: ${rotulo}`)
  }
  expect(
    await temAlertaA(),
    'alçada ativa: o alerta da solicitação A existe',
  ).toBe(true)
  await alternarAlcada('Inativar')
  expect(
    await temAlertaA(),
    'alçada inativa: o alerta da solicitação A some',
  ).toBe(false)
  await alternarAlcada('Reativar')
  expect(
    await temAlertaA(),
    'alçada reativada: o alerta da solicitação A volta',
  ).toBe(true)
  await alternarAlcada('Inativar')
  expect(await temAlertaA(), 'alçada inativa de novo: o alerta some').toBe(
    false,
  )
  expect(await abrirAuditoria(page, 'alcadas_aprovacao')).toBe(
    total0('alcadas_aprovacao') + 4,
  )
  await expect(
    linhaDaAuditoria(page, 'UPDATE', {
      registro: estado.idAlcada,
      quem: PRESIDENTE,
    }),
  ).toBeVisible()
  await ver(
    page,
    info,
    'auditoria: criacao e tres trocas de situacao da alcada',
  )

  // ---- competência vazia (campo de mês limpo): a tela ignora o campo vazio (nenhuma consulta sai) e continua no mês que já estava
  const { sec } = await lerPadroes(page, estado.mes)
  const consultas: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === ROTA_PADROES) consultas.push(r.url())
  })
  await sec.locator('input[type="month"]').fill('')
  await page.waitForTimeout(3_000)
  expect(
    consultas,
    'o campo de mês limpo não pode mandar uma consulta sem competência',
  ).toEqual([])
  await expect(sec.locator('input[type="month"]')).toHaveValue(estado.mes)
  await ver(page, info, 'padroes suspeitos com competencia vazia: ignorada')
  // o único 5xx permitido neste teste é o da consulta com a competência vazia, que já virou achado
  expect(vigia.problemas().filter((p) => !p.includes(ROTA_PADROES))).toEqual([])
})

test('11. quem lê os relatórios e os alertas: Presidente, Tesoureiro, 1ª Presidente (cargo) e Conselheiro leem; Secretário e os dois Vice-Presidentes são barrados', async ({
  page,
}, info) => {
  test.setTimeout(900_000)
  const vigia = vigiar(page)
  const MATRIZ: { papel: Papel; le: boolean }[] = [
    { papel: 'presidente', le: true },
    { papel: 'tesoureiro', le: true },
    { papel: 'cargo_presidente', le: true },
    { papel: 'conselheiro', le: true },
    { papel: 'secretario', le: false },
    { papel: 'vice_presidente', le: false },
    { papel: 'vice_presidente_2', le: false },
  ]
  for (const [i, { papel, le }] of MATRIZ.entries()) {
    await entrar(page, papel)
    await expect(page.getByText(/Bem-vindo, /)).toBeVisible()
    if (le) {
      await expect(
        page.getByRole('link', { name: 'Financeiro' }).first(),
      ).toBeVisible()
      const { lista, sec } = await lerPadroes(page, estado.mes)
      for (const titulo of TITULOS_DOS_BLOCOS) {
        await expect(
          secao(page, titulo),
          `${papel} vê o bloco ${titulo}`,
        ).toBeVisible()
      }
      // vê o mesmo alerta de fornecedor novo que o servidor devolve
      const doC = lista.filter(
        (a) =>
          a.tipo === 'FORNECEDOR_NOVO_PAGAMENTO_ALTO' &&
          a.id_titulo === estado.idTitulo.C,
      )
      expect(doC, `${papel} recebe o alerta do fornecedor novo`).toHaveLength(1)
      await expect(
        sec.getByText(doC[0]?.descricao ?? 'sem alerta', { exact: true }),
      ).toBeVisible()
      if (papel === 'conselheiro') {
        const gerar = secao(page, 'Prestação de contas do exercício').getByRole(
          'button',
          { name: 'Gerar nova versão' },
        )
        if (await gerar.isEnabled()) {
          observar(
            'quem fiscaliza (o Conselheiro Fiscal) também pode gerar versões novas da prestação de contas: o botão e a rota só pedem a permissão "financeiro"',
          )
        }
      }
      if (papel === 'tesoureiro' && lista.some(ehDoRobo)) {
        observar(
          'o Tesoureiro (quem lança e estorna) lê o relatório de exceção sobre os próprios lançamentos: o bloco "Padrões suspeitos (Conselho Fiscal)" abre para qualquer pessoa com a permissão "financeiro", não só para o Conselho Fiscal',
        )
      }
      await ver(page, info, `${papel} le os relatorios e os alertas`)
    } else {
      await expect(page.getByRole('link', { name: 'Financeiro' })).toHaveCount(
        0,
      )
      for (const destino of [
        '/financeiro/relatorios',
        '/financeiro',
        '/financeiro/titulos',
      ]) {
        await page.goto(destino)
        await expect(
          page.getByRole('heading', { name: 'Acesso negado' }),
          `${papel} em ${destino}`,
        ).toBeVisible()
        await expect(
          page.getByText(/permissão necessária: financeiro/),
        ).toBeVisible()
      }
      await expect(
        page.getByRole('heading', {
          name: 'Padrões suspeitos (Conselho Fiscal)',
        }),
      ).toHaveCount(0)
      await ver(page, info, `${papel} barrado nos relatorios`)
    }
    if (i < MATRIZ.length - 1) await sair(page)
  }
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
// C. RELATÓRIOS: o que a tela oferece e os valores, centavo a centavo
// =====================================================================================================================================
test('12. o Início do Financeiro e a navegação até Relatórios; o que a página oferece (e o que não oferece: nenhuma exportação)', async ({
  page,
}, info) => {
  test.setTimeout(420_000)
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await page.getByRole('link', { name: 'Financeiro' }).first().click()
  await expect(page).toHaveURL(/\/financeiro$/)
  await expect(
    page.getByRole('heading', { name: 'Financeiro', level: 1 }),
  ).toBeVisible()
  if (await page.getByText(/entra nas fases seguintes do plano/).isVisible()) {
    achar(
      'o Início do Financeiro é a página de obra "A navegação e a guarda de permissão já estão funcionando. O conteúdo de negócio deste módulo entra nas fases seguintes do plano": sem painel de pendências, saldo nem alertas antifraude',
    )
  }
  await ver(page, info, 'inicio do financeiro')
  for (const item of [
    'Conselho Fiscal',
    'Títulos',
    'Plano de Contas',
    'Fornecedores',
    'Exercícios',
    'Razão Contábil',
    'Contas Financeiras',
    'Centros de Custo',
    'Planos de Contribuição',
    'Gerar Cobranças',
    'Conciliação',
    'Negociação de Dívida',
    'Compras',
    'Reembolso de Despesa',
    'Alçadas de Aprovação',
    'Contas a Pagar Recorrentes',
    'Doações',
    'Orçamento e Fluxo de Caixa',
    'Relatórios',
  ]) {
    await expect(
      page.getByRole('link', { name: item, exact: true }),
      `o menu do Financeiro oferece ${item}`,
    ).toBeVisible()
  }
  const inicial = Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/relatorios/balancete' &&
        r.status() === 200,
    ),
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === ROTA_PADROES && r.status() === 200,
    ),
  ])
  await page.getByRole('link', { name: 'Relatórios', exact: true }).click()
  await inicial
  await expect(page).toHaveURL(/\/financeiro\/relatorios$/)
  await expect(
    page.getByRole('heading', { name: 'Relatórios', level: 1 }),
  ).toBeVisible()
  for (const titulo of TITULOS_DOS_BLOCOS) {
    await expect(secao(page, titulo), titulo).toBeVisible()
  }
  await inventariarSemTravar(page, info, 'relatorios')
  await ver(page, info, 'relatorios: os sete blocos')

  // nenhuma exportação, impressão ou download em lugar nenhum da página
  const exporta = page.getByRole('button', {
    name: /exportar|baixar|imprimir|pdf|csv|excel|planilha|download/i,
  })
  const links = page.locator('main').getByRole('link', {
    name: /exportar|baixar|imprimir|pdf|csv|excel|planilha|download/i,
  })
  const quantosArquivos = (await exporta.count()) + (await links.count())
  expect(quantosArquivos).toBe(0)
  observar(
    'Relatórios não oferece exportar, baixar nem imprimir nada (nenhum PDF/CSV/planilha: a exportação para o contador é a FASE 17); a prestação de contas só pode ser lida na tela',
  )
  observar(
    'a leitura dos relatórios e dos padrões suspeitos não é registrada na Auditoria (a leitura do Conselho Fiscal, em Financeiro > Conselho Fiscal, é)',
  )
  observar(
    'os limites do antifraude (expediente, 10% do teto, R$ 1.000,00, 3 estornos, 30 dias) e o fuso não têm tela: só a API /api/configuracoes/{chave} os altera',
  )
  expect(vigia.problemas()).toEqual([])
})

test('13. Balancete, Receitas x despesas (por conta e por centro de custo), Por projeto e Extrato: cada valor das contas do robô confere centavo a centavo, período por período; o período inválido é recusado', async ({
  page,
}, info) => {
  test.setTimeout(900_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const inicio = await abrirRelatorios(page)

  // ---- Inadimplência: cada cartão da tela é o que a API devolveu, e o total é positivo
  const inad = secao(page, 'Inadimplência')
  if (inicio.inadimplencia.length === 0) {
    await expect(
      inad.getByText('Nenhum associado inadimplente no momento.'),
    ).toBeVisible()
  } else {
    await expect(inad.locator('div.rounded-md.border')).toHaveCount(
      inicio.inadimplencia.length,
    )
    for (const l of inicio.inadimplencia) {
      const c = cartao(inad, l.nome_completo)
      await expect(c.first()).toContainText(
        brl(Math.round(l.total_devido * 100)),
      )
      await expect(c.first()).toContainText(
        `${l.quantidade_titulos_vencidos} título(s) vencido(s) · até ${l.dias_atraso_maximo} dias de atraso`,
      )
      expect(l.total_devido).toBeGreaterThan(0)
      expect(l.quantidade_titulos_vencidos).toBeGreaterThan(0)
      expect(l.dias_atraso_maximo).toBeGreaterThan(0)
    }
  }
  await ver(page, info, 'relatorios: inadimplencia')

  const bal = secao(page, 'Balancete por período')
  const rd = secao(page, 'Receitas x despesas')
  const proj = secao(page, 'Por projeto')

  for (const p of PERIODOS) {
    // ---- balancete
    await definirPeriodo(page, bal, '/api/relatorios/balancete', p.de, p.ate)
    const esperado = balanceteEsperado(p.de, p.ate)
    await expect
      .poll(async () => minhasLinhasDoBalancete(await lerBalancete(bal)), {
        message: `balancete ${p.nome}: as três contas do robô`,
        timeout: 30_000,
      })
      .toEqual(esperado)
    const linhas = await lerBalancete(bal)
    // partida dobrada: em qualquer período a soma dos débitos é igual à soma dos créditos, e cada saldo muda exatamente o movimento
    expect(
      linhas.reduce((s, l) => s + l.debitos, 0),
      `balancete ${p.nome}: soma dos débitos = soma dos créditos`,
    ).toBe(linhas.reduce((s, l) => s + l.creditos, 0))
    for (const l of linhas) {
      expect(
        Math.abs(l.atual - l.anterior),
        `balancete ${p.nome}: conta ${l.codigo}, saldo atual - saldo anterior = movimento do período`,
      ).toBe(Math.abs(l.debitos - l.creditos))
    }
    await ver(page, info, `balancete: ${p.nome}`)

    // ---- receitas x despesas, por conta
    await definirPeriodo(
      page,
      rd,
      '/api/relatorios/receitas-despesas',
      p.de,
      p.ate,
    )
    const rdEsperado = receitasDespesasEsperadas(p.de, p.ate)
    const lerRd = async () => {
      const lidas = await lerLinhasDeValor(rd)
      return lidas.flatMap((l) => {
        const m = /^\[(Receita|Despesa)\]\s+(\S+)\s+—/.exec(l.rotulo)
        return m
          ? [
              {
                tipo: m[1] ?? '',
                codigo: m[2] ?? '',
                valor: emCentavos(l.valor),
              },
            ]
          : []
      })
    }
    await expect
      .poll(
        async () => {
          const lidas = await lerRd()
          const valor = (chave: ChaveConta) =>
            lidas.find((x) => x.codigo === CONTAS[chave].codigo)?.valor ?? null
          return { REC: valor('REC'), DES: valor('DES') }
        },
        { message: `receitas x despesas ${p.nome}`, timeout: 30_000 },
      )
      .toEqual(rdEsperado)
    const lidas = await lerRd()
    const somaDe = (tipo: string) =>
      lidas.filter((x) => x.tipo === tipo).reduce((s, x) => s + x.valor, 0)
    const [receitas, despesas, resultado] = valoresEmCentavos(
      await rd.locator('p.border-t').innerText(),
    )
    expect(receitas, `${p.nome}: total de receitas = soma das linhas`).toBe(
      somaDe('Receita'),
    )
    expect(despesas, `${p.nome}: total de despesas = soma das linhas`).toBe(
      somaDe('Despesa'),
    )
    expect(resultado, `${p.nome}: resultado = receitas - despesas`).toBe(
      somaDe('Receita') - somaDe('Despesa'),
    )

    // ---- receitas x despesas, por centro de custo (o centro do robô só tem o que o robô lançou)
    const ver1 = respostaDe(
      page,
      'GET',
      '/api/relatorios/receitas-despesas-por-centro-custo',
    )
    await rd.getByRole('button', { name: 'Ver por centro de custo' }).click()
    const respCentro = await ver1
    expect(respCentro.status(), await respCentro.text()).toBe(200)
    const centroEsperado1 = centroEsperado(p.de, p.ate)
    const centrosApi = (await respCentro.json()) as {
      nome_centro_custo: string
      receitas: number
      despesas: number
      resultado: number
    }[]
    const doRoboApi = centrosApi.find(
      (c) => c.nome_centro_custo === CENTRO.nome,
    )
    if (centroEsperado1 === null) {
      expect(
        doRoboApi,
        `centro de custo ${p.nome}: sem movimento do robô`,
      ).toBeUndefined()
    } else {
      expect(doRoboApi).toBeDefined()
      await expect
        .poll(
          async () => {
            const l = (await lerLinhasDeValor(rd)).find(
              (x) => x.rotulo === CENTRO.nome,
            )
            const v = l ? valoresEmCentavos(l.valor) : []
            return v.length === 3
              ? { receitas: v[0], despesas: v[1], resultado: v[2] }
              : null
          },
          { message: `por centro de custo ${p.nome}`, timeout: 30_000 },
        )
        .toEqual(centroEsperado1)
    }
    for (const l of await lerLinhasDeValor(rd)) {
      const v = valoresEmCentavos(l.valor)
      if (v.length === 3) {
        expect(
          (v[0] ?? 0) - (v[1] ?? 0),
          `centro "${l.rotulo}" (${p.nome}): receitas - despesas = resultado`,
        ).toBe(v[2])
      }
    }
    await ver(page, info, `receitas x despesas por centro de custo: ${p.nome}`)
    await rd.getByRole('button', { name: 'Ver por conta' }).click()

    // ---- por projeto: o centro do robô está ligado a um projeto e aparece com o nome dele
    const respProjeto = await definirPeriodo(
      page,
      proj,
      '/api/relatorios/por-projeto',
      p.de,
      p.ate,
    )
    const porProjeto = (await respProjeto.json()) as {
      nome_projeto: string
      receitas: number
      despesas: number
      resultado: number
    }[]
    const procurado = centroEsperado1
    if (procurado !== null) {
      expect(
        porProjeto.some(
          (l) =>
            l.nome_projeto === estado.projeto &&
            Math.round(l.receitas * 100) === procurado.receitas &&
            Math.round(l.despesas * 100) === procurado.despesas &&
            Math.round(l.resultado * 100) === procurado.resultado,
        ),
        `por projeto ${p.nome}: o projeto "${estado.projeto}" mostra ${brl(procurado.receitas)} - ${brl(procurado.despesas)} = ${brl(procurado.resultado)}`,
      ).toBe(true)
      await expect
        .poll(
          async () =>
            (await lerLinhasDeValor(proj)).some((l) => {
              const v = valoresEmCentavos(l.valor)
              return (
                l.rotulo === estado.projeto &&
                v[0] === procurado.receitas &&
                v[1] === procurado.despesas &&
                v[2] === procurado.resultado
              )
            }),
          { message: `por projeto ${p.nome} (tela)`, timeout: 30_000 },
        )
        .toBe(true)
    }
    for (const l of await lerLinhasDeValor(proj)) {
      const v = valoresEmCentavos(l.valor)
      if (v.length === 3) {
        expect(
          (v[0] ?? 0) - (v[1] ?? 0),
          `projeto "${l.rotulo}" (${p.nome}): receitas - despesas = resultado`,
        ).toBe(v[2])
      }
    }
    await ver(page, info, `por projeto: ${p.nome}`)
  }

  // ---- extrato da Conta Financeira do robô: cada movimento, o saldo corrente e o saldo final
  const ext = secao(page, 'Extrato por Conta Financeira')
  const seletor = ext.locator('select')
  await expect(
    seletor.locator('option', { hasText: CONTAS.ATV.codigo }),
  ).toBeAttached()
  const [respExtrato] = await Promise.all([
    respostaDe(
      page,
      'GET',
      /^\/api\/relatorios\/extrato-conta-financeira\/\d+$/,
    ),
    escolherPorTexto(seletor, CONTAS.ATV.codigo),
  ])
  expect(respExtrato.status(), await respExtrato.text()).toBe(200)
  const esperadoMov = movimentosAtv()
  const lerExtrato = async () => {
    const saldoTexto = await ext
      .getByText(/^Saldo atual:/)
      .innerText({ timeout: 10_000 })
    const linhas = await lerLinhasDeValor(ext)
    return {
      saldoAtual: emCentavos(saldoTexto),
      movimentos: linhas.flatMap((l) => {
        const m = /^(\d{2}\/\d{2}\/\d{4}) · (Debito|Credito)$/.exec(l.rotulo)
        const v = valoresEmCentavos(l.valor)
        return m && v.length === 2
          ? [
              {
                data: m[1] ?? '',
                tipo: m[2] ?? '',
                valor: v[0] ?? 0,
                saldo: v[1] ?? 0,
              },
            ]
          : []
      }),
    }
  }
  await expect
    .poll(
      async () => (await lerExtrato().catch(() => null))?.movimentos.length,
      {
        message: 'extrato: um movimento para cada partida do Caixa do robô',
        timeout: 30_000,
      },
    )
    .toBe(esperadoMov.length)
  const extrato = await lerExtrato()
  expect(
    extrato.movimentos.map((m) => `${m.tipo}|${m.valor}`).sort(),
    'extrato: os mesmos movimentos do livro de referência',
  ).toEqual(esperadoMov.map((m) => `${m.tipo}|${m.centavos}`).sort())
  let corrente = 0
  let dataAnterior = ''
  for (const m of extrato.movimentos) {
    corrente += m.tipo === 'Debito' ? m.valor : -m.valor
    expect(
      m.saldo,
      `extrato: saldo corrente depois de ${m.tipo} ${brl(m.valor)}`,
    ).toBe(corrente)
    const iso = m.data.split('/').reverse().join('-')
    expect(iso >= dataAnterior, 'extrato: datas em ordem').toBe(true)
    dataAnterior = iso
  }
  expect(
    extrato.saldoAtual,
    'extrato: saldo atual = último saldo corrente',
  ).toBe(corrente)
  expect(extrato.saldoAtual, 'extrato: saldo atual = o que o livro diz').toBe(
    saldoAtv(),
  )
  // a data de competência 10/03/2025 tem de aparecer como 10/03/2025 (a tela de Razão a mostra assim)
  const antigo = extrato.movimentos.find(
    (m) => m.tipo === 'Debito' && m.valor === TITULOS.B.valor,
  )
  expect(antigo, 'extrato: a baixa B (débito de R$ 1.234,56)').toBeDefined()
  if (antigo && antigo.data !== dataBr(COMPETENCIA_ANTIGA)) {
    achar(
      `o extrato mostra a baixa de competência ${dataBr(COMPETENCIA_ANTIGA)} como ${antigo.data} (data só-dia lida como instante UTC e convertida para Belém); o Razão Contábil mostra ${dataBr(COMPETENCIA_ANTIGA)}`,
    )
  }
  await ver(page, info, 'extrato da conta financeira do robo')

  // ---- o mesmo saldo na tela de Contas Financeiras
  await page.goto('/financeiro/contas-financeiras')
  const cartaoCf = cartao(page, CONTAS.ATV.codigo)
  await expect(cartaoCf).toBeVisible()
  expect(emCentavos(await cartaoCf.innerText())).toBe(extrato.saldoAtual)
  await expect(cartaoCf).toContainText(brl(saldoAtv()))
  await ver(page, info, 'contas financeiras: o mesmo saldo do extrato')

  // ---- período inválido: fim antes do início e data apagada. O servidor recusa; a tela tem de dizer.
  await page.goto('/financeiro/relatorios')
  const bal2 = secao(page, 'Balancete por período')
  await expect(bal2).toBeVisible()
  const datas = bal2.locator('input[type="date"]')
  const [invertido] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/relatorios/balancete' &&
        r.status() === 400,
    ),
    datas.nth(0).fill(somarDias(diaUtc(), 30)),
  ])
  expect(
    ((await invertido.json()) as { detail: string }).detail,
    'o servidor recusa o fim antes do início',
  ).toBe('Data final não pode ser anterior à data inicial.')
  await page.waitForTimeout(3_000) // uma nova tentativa do painel antes de dar por falha
  const mostrouErro = await bal2
    .getByText('Data final não pode ser anterior à data inicial.')
    .isVisible()
  const mostrouVazio = await bal2
    .getByText('Sem movimento no período.')
    .isVisible()
  if (!mostrouErro) {
    achar(
      `Balancete com início depois do fim: o servidor recusa (HTTP 400 "Data final não pode ser anterior à data inicial.") mas a tela ${mostrouVazio ? 'diz "Sem movimento no período." (como se o período fosse válido e vazio)' : 'não mostra nenhuma mensagem'}`,
    )
  }
  await ver(page, info, 'balancete com inicio depois do fim')
  // data apagada no campo: a tela ignora (uma data vazia não é período) e continua no que estava, sem mandar consulta nenhuma
  const consultasDoBalancete: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/relatorios/balancete')
      consultasDoBalancete.push(r.url())
  })
  const valorAntes = await datas.nth(0).inputValue()
  await datas.nth(0).fill('')
  await page.waitForTimeout(3_000)
  expect(
    consultasDoBalancete,
    'a data apagada não pode mandar uma consulta sem data inicial',
  ).toEqual([])
  await expect(datas.nth(0)).toHaveValue(valorAntes)
  await ver(page, info, 'balancete com a data apagada: ignorada')
  expect(
    vigia.problemas(),
    'nenhum 5xx nos relatórios (os 400 do período inválido são esperados)',
  ).toEqual([])
})

test('14. Prestação de contas do exercício: ano inválido é recusado; cada versão guarda o texto, os números conferem com o razão e com a tela de Receitas x despesas, a versão anterior não muda', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const inicio = await abrirRelatorios(page)
  const ANO = Number(diaEmBelem(0).slice(0, 4))
  const sec = secao(page, 'Prestação de contas do exercício')
  const ano = sec.locator('input[type="number"]')
  await expect(ano).toHaveValue(String(ANO))
  const maisAntiga = inicio.prestacoes.length

  // ---- ano inválido (antes de 2000 e depois de 2200): recusado, e nada vira versão nova
  for (const invalido of ['1999', '2201']) {
    await ano.fill(invalido)
    const [recusada] = await Promise.all([
      respostaDe(page, 'POST', '/api/prestacoes-de-contas/'),
      sec.getByRole('button', { name: 'Gerar nova versão' }).click(),
    ])
    expect(recusada.status()).toBe(422)
    await expect(sec.getByText('Ano inválido.')).toHaveCount(1)
  }
  await ver(page, info, 'prestacao de contas com ano invalido: recusada')
  expect(await abrirAuditoria(page, 'prestacoes_de_contas')).toBe(
    total0('prestacoes_de_contas'),
  )
  await page.goto('/financeiro/relatorios')
  await expect(sec).toBeVisible()

  // ---- gerar duas versões do exercício do ano corrente
  const gerar = async () => {
    await ano.fill(String(ANO))
    const [resposta] = await Promise.all([
      respostaDe(page, 'POST', '/api/prestacoes-de-contas/'),
      sec.getByRole('button', { name: 'Gerar nova versão' }).click(),
    ])
    expect(resposta.status(), await resposta.text()).toBe(200)
    return (await resposta.json()) as {
      id_prestacao: number
      versao: number
      ano_exercicio: number
      conteudo: string
      id_parecer: number | null
    }
  }
  const primeira = await gerar()
  const segunda = await gerar()
  expect(primeira.ano_exercicio).toBe(ANO)
  expect(segunda.versao, 'a versão cresce de 1 em 1').toBe(primeira.versao + 1)
  const cartaoDaVersao = (versao: number) =>
    sec.locator('div.rounded-md.border').filter({
      hasText: new RegExp(`Exercício ${ANO} — versão ${versao}(?!\\d)`),
    })
  await expect(cartaoDaVersao(primeira.versao)).toHaveCount(1)
  await expect(cartaoDaVersao(segunda.versao)).toHaveCount(1)
  await expect(sec.locator('div.rounded-md.border')).toHaveCount(maisAntiga + 2)
  await ver(page, info, 'prestacao de contas: duas versoes na lista')

  // ---- o texto da tela é o do servidor, e a versão antiga continua igual
  await cartaoDaVersao(primeira.versao)
    .getByRole('button', { name: 'Ver' })
    .click()
  await expect(cartaoDaVersao(primeira.versao).locator('pre')).toHaveText(
    primeira.conteudo,
  )
  await ver(page, info, 'prestacao de contas: texto da versao anterior')
  expect(
    segunda.conteudo,
    'sem lançamento novo entre as duas, o texto é o mesmo',
  ).toBe(primeira.conteudo)

  // ---- os números do texto conferem com o livro de referência (as contas do robô) e entre si
  const texto = primeira.conteudo
  expect(texto).toContain(`PRESTAÇÃO DE CONTAS — EXERCÍCIO ${ANO}`)
  const de = `${ANO}-01-01`
  const ate = `${ANO}-12-31`
  const balanco = balanceteEsperado(de, ate)
  const periodo = receitasDespesasEsperadas(de, ate)
  for (const chave of CHAVES_CONTA) {
    const c = CONTAS[chave]
    const b = balanco[chave]
    if (b) {
      expect(texto, `prestação: saldo de ${chave}`).toContain(
        `${c.codigo} — ${c.descricao}: saldo ${reaisSrv(b.atual)}`,
      )
    }
  }
  if (periodo.REC !== null) {
    expect(texto).toContain(
      `[Receita] ${CONTAS.REC.codigo} — ${CONTAS.REC.descricao}: ${reaisSrv(periodo.REC)}`,
    )
  }
  if (periodo.DES !== null) {
    expect(texto).toContain(
      `[Despesa] ${CONTAS.DES.codigo} — ${CONTAS.DES.descricao}: ${reaisSrv(periodo.DES)}`,
    )
  }
  const centavosDoTexto = (v: string) => Math.round(Number(v) * 100)
  const linhasRd = [
    ...texto.matchAll(/^\s+\[(Receita|Despesa)\] .*: R\$ (-?\d+\.\d{2})$/gm),
  ].map((m) => ({ tipo: m[1], valor: centavosDoTexto(m[2] ?? '0') }))
  const total =
    /TOTAL RECEITAS: R\$ (-?\d+\.\d{2}) — TOTAL DESPESAS: R\$ (-?\d+\.\d{2}) — RESULTADO: R\$ (-?\d+\.\d{2})/.exec(
      texto,
    )
  expect(total, 'a prestação traz a linha de totais').not.toBeNull()
  const totalReceitas = centavosDoTexto(total?.[1] ?? '0')
  const totalDespesas = centavosDoTexto(total?.[2] ?? '0')
  const resultado = centavosDoTexto(total?.[3] ?? '0')
  expect(
    linhasRd
      .filter((l) => l.tipo === 'Receita')
      .reduce((s, l) => s + l.valor, 0),
    'prestação: total de receitas = soma das linhas',
  ).toBe(totalReceitas)
  expect(
    linhasRd
      .filter((l) => l.tipo === 'Despesa')
      .reduce((s, l) => s + l.valor, 0),
    'prestação: total de despesas = soma das linhas',
  ).toBe(totalDespesas)
  expect(resultado, 'prestação: resultado = receitas - despesas').toBe(
    totalReceitas - totalDespesas,
  )

  // ---- o parecer do Conselho Fiscal só vem anexado se existir (o texto e o rótulo da lista concordam)
  const comParecer =
    /Parecer (Favorável|Com ressalva|Contrário) \(emitido em/.test(texto)
  expect(
    texto.includes('Nenhum parecer do Conselho Fiscal emitido'),
    'a prestação diz "nenhum parecer" se e só se não anexou nenhum',
  ).toBe(!comParecer)
  expect(primeira.id_parecer !== null).toBe(comParecer)
  if (comParecer) {
    await expect(cartaoDaVersao(primeira.versao)).toContainText(
      'com parecer do Conselho Fiscal anexado',
    )
  } else {
    await expect(cartaoDaVersao(primeira.versao)).not.toContainText(
      'com parecer do Conselho Fiscal anexado',
    )
  }

  // ---- os totais do texto são os mesmos da tela de Receitas x despesas para o mesmo ano
  const rd = secao(page, 'Receitas x despesas')
  await definirPeriodo(page, rd, '/api/relatorios/receitas-despesas', de, ate)
  await expect
    .poll(
      async () => valoresEmCentavos(await rd.locator('p.border-t').innerText()),
      {
        message:
          'Receitas x despesas do ano na tela = totais da prestação de contas',
        timeout: 30_000,
      },
    )
    .toEqual([totalReceitas, totalDespesas, resultado])
  await ver(page, info, 'receitas x despesas do ano = totais da prestacao')

  // ---- Auditoria: as duas gerações, nada mais
  expect(await abrirAuditoria(page, 'prestacoes_de_contas')).toBe(
    total0('prestacoes_de_contas') + 2,
  )
  for (const v of [primeira, segunda]) {
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: v.id_prestacao,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria: as duas versoes da prestacao de contas')
  expect(vigia.problemas()).toEqual([])
})

test('15. o Conselho Fiscal lê os mesmos números das telas de Títulos e de Razão Contábil, centavo a centavo', async ({
  page,
}, info) => {
  test.setTimeout(420_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')

  // o que a tela de Títulos diz de cada título do robô
  await page.goto('/financeiro/titulos')
  await expect(
    page.getByRole('heading', { name: 'Títulos', level: 1 }),
  ).toBeVisible()
  const pelaTelaDeTitulos: Record<
    string,
    { original: number; saldo: number; status: string }
  > = {}
  for (const chave of CHAVES_TITULO) {
    const c = cartao(page, TITULOS[chave].descricao)
    await expect(c).toHaveCount(1)
    const texto = await c.innerText()
    const v = valoresEmCentavos(texto)
    pelaTelaDeTitulos[chave] = {
      original: v[0] ?? Number.NaN,
      saldo: v[1] ?? Number.NaN,
      status: /Pendente/.test(texto) ? 'Pendente' : 'Pago',
    }
  }

  // o que o Conselho Fiscal lê (títulos e razão), com as duas consultas auditadas
  const leituras = Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/api/conselho-fiscal/financeiro/titulos') && r.ok(),
    ),
    page.waitForResponse(
      (r) =>
        r.url().includes('/api/conselho-fiscal/financeiro/caixa') && r.ok(),
    ),
  ])
  await page.goto('/financeiro/conselho-fiscal')
  await leituras
  await expect(
    page.getByRole('heading', { name: 'Conselho Fiscal', level: 1 }),
  ).toBeVisible()
  const titulosCf = page.locator('section').filter({
    has: page.getByRole('heading', { name: /Títulos financeiros/ }),
  })
  const razaoCf = page.locator('section').filter({
    has: page.getByRole('heading', { name: /Razão contábil/ }),
  })
  const esperadoFinal: Record<ChaveTitulo, { saldo: number; status: string }> =
    {
      A: { saldo: 0, status: 'Pago' },
      B: { saldo: TITULOS.B.valor, status: 'Pendente' },
      C: { saldo: TITULOS.C.valor, status: 'Pendente' },
      D: { saldo: TITULOS.D.valor, status: 'Pendente' },
      E: { saldo: 0, status: 'Pago' },
    }
  for (const chave of CHAVES_TITULO) {
    const c = cartao(titulosCf, TITULOS[chave].descricao)
    await expect(c, `Conselho Fiscal: título ${chave}`).toHaveCount(1)
    const texto = await c.innerText()
    const v = valoresEmCentavos(texto)
    const status = /Pendente/.test(texto) ? 'Pendente' : 'Pago'
    const tela = pelaTelaDeTitulos[chave]
    expect(v[0], `título ${chave}: valor original igual nas duas telas`).toBe(
      tela?.original,
    )
    expect(v[1], `título ${chave}: saldo igual nas duas telas`).toBe(
      tela?.saldo,
    )
    expect(status, `título ${chave}: situação igual nas duas telas`).toBe(
      tela?.status,
    )
    expect(v[0]).toBe(TITULOS[chave].valor)
    expect(v[1]).toBe(esperadoFinal[chave].saldo)
    expect(status).toBe(esperadoFinal[chave].status)
  }
  await ver(page, info, 'conselho fiscal: os titulos do robo')

  // o razão do Conselho Fiscal e o da tela de Razão Contábil: mesmo número, mesmas partidas, mesma situação
  const linhasCf = razaoCf.getByRole('row')
  for (const l of livro) {
    const linha = linhasCf.filter({ hasText: l.historico })
    await expect(
      linha,
      `Conselho Fiscal: razão, lançamento ${l.rotulo}`,
    ).toHaveCount(1)
    const celulas = await linha
      .getByRole('cell')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''))
    expect(
      Number(celulas[0]),
      `lançamento ${l.rotulo}: número sequencial`,
    ).toBe(l.numero)
    expect(celulas[4], `lançamento ${l.rotulo}: situação`).toBe(
      l.estornado ? 'Estornado' : 'Normal',
    )
    expect(
      partidasLidas(celulas[3] ?? ''),
      `Conselho Fiscal: partidas do lançamento ${l.rotulo}`,
    ).toEqual(
      l.partidas.map(
        (p) => `${p.lado === 'D' ? 'Debito' : 'Credito'}|${p.centavos}`,
      ),
    )
  }
  await ver(page, info, 'conselho fiscal: o razao do robo')

  // a Auditoria registrou as duas consultas, com o nome de quem leu
  for (const tabela of ['titulos_financeiros', 'lancamentos_contabeis']) {
    await abrirAuditoria(page, tabela)
    await expect(
      linhaDaAuditoria(page, 'CONSULTA_CONSELHO_FISCAL', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, `auditoria: a consulta do conselho (${tabela})`)
  }
  expect(vigia.problemas()).toEqual([])
})

test('16. fechamento: o que o roteiro viu e parece defeito do sistema', () => {
  test.info().annotations.push({
    type: 'resumo',
    description: `${achados.length} achado(s), ${observacoes.length} observação(ões); baixa sem competência: ${estado.competenciaVazia}`,
  })
  expect(
    achados,
    `O roteiro viu ${achados.length} coisa(s) que parece(m) defeito do sistema`,
  ).toEqual([])
})
