import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

import {
  API_HML,
  campo,
  cpfValido,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  fotoDeTeste,
  type Papel,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4g - FASE 5 ao vivo, item "Parcerias e emendas": o módulo inteiro, pelas telas do hml-painel, e o que a API PÚBLICA (a fonte do site de transparência)
// mostra de volta. O que o roteiro prova, nesta ordem:
//  1. cadastrar a parceria: o formulário diz o que falta; dado pessoal no texto que vai ao site e identificador repetido são recusados; a parceria nasce como
//     RASCUNHO, com o centro de custo exclusivo (PARC-nnnn), e a API pública não a mostra;
//  2. parcelas (a soma não passa do valor), etapa de execução (Realizada exige a data), relatório de prestação de contas (resultado exige apresentação e data),
//     situação da parceria (exige o número do termo; "Concluída" exige a prestação final);
//  3. fotos da etapa: sem foto, sem a autorização de imagem, sem a descrição, com CPF na descrição e arquivo que não é imagem são recusados; a foto boa abre
//     (só para quem tem login) e apagar tira do armazenamento;
//  4. o dinheiro vem do LIVRO-CAIXA: a receita e as duas despesas são lançadas pelas telas do Financeiro (Títulos > Baixar, marcando o centro de custo da
//     parceria); a Razão Contábil e o relatório "Receitas x despesas por centro de custo" mostram os mesmos valores;
//  5. cada movimento é CLASSIFICADO por uma pessoa (texto público; equipe só com a função); sem classificar a publicação fica travada; o texto se corrige;
//  6. publicação: quem criou/enviou NÃO aprova (a tela nem oferece o botão e a API recusa com a mensagem); outra pessoa (Presidente ou Secretário) aprova;
//  7. a API pública (sem login) mostra só o aprovado, com o valor que BATE com o livro-caixa, sem CPF/e-mail/telefone, com a foto que abre; a edição DEPOIS de
//     aprovada vai direto ao site (decisão do Presidente de 2026-10-04) e o dinheiro novo do livro-caixa entra no valor na hora; retirar do site tira da API;
//  8. cada ação fica na Auditoria (e a tentativa de aprovar a própria também), e quem não tem a permissão é barrado na tela e na API.
// Tudo leva o número da rodada (RODADA): o banco de teste acumula dados entre as execuções e a lista pública já traz a emenda semeada.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(600_000)

const S = String(RODADA)
// centavos que mudam a cada rodada (de 10 a 99): o valor mostrado é conferido ao centavo
const C = (RODADA % 90) + 10

const TOTAL = 3_000_000 + C
const PARCELA_1 = 1_200_000 + C
const PARCELA_2 = 1_200_000
const PARCELA_ACIMA_DO_VALOR = TOTAL + 100
const RECEBIDO = PARCELA_1
const PAGO_OUTRO = 300_000 + C
const PAGO_EQUIPE = 150_050
const PAGO = PAGO_OUTRO + PAGO_EQUIPE
const RECEBIDO_DEPOIS = 50_000

const TITULO_A = `Emenda de Teste ${S} - Oficinas de teatro`
const OBJETO_A = `Oficinas de teatro para crianças do bairro de teste, texto inventado pelo robô na rodada ${S}.`
const ORGAO = 'Secretaria Municipal de Teste'
const PROPONENTE = 'Vereador de Teste'
const NUMERO_EMENDA = `${S.slice(-5)}/2026`
const ID_UNICO = `EMD-${S}`
const NUMERO_TERMO = `TF-${S}`
const TITULO_B = `Parceria de Teste B ${S} - so para aprovar`
const OBJETO_B =
  'Parceria só para provar a aprovação por outra pessoa, texto inventado pelo robô.'

const TITULO_ETAPA_1 = `Oficina de teatro ${S}`
const TITULO_ETAPA_2 = `Etapa criada depois de aprovada ${S}`
const LOCAL_ETAPA = 'Quadra de teste'
const PUBLICO_ATENDIDO = 35
const ALT_1 = `Foto de teste inventada da rodada ${S}: crianças ensaiando uma peça de teatro na quadra`
const ALT_2 = `Segunda foto de teste da rodada ${S}: cenário da peça montado no palco`

// o "oficineiro" e o CPF dele só existem no histórico INTERNO do livro-caixa: a API pública nunca pode trazê-los
const NOME_EQUIPE = `Fulano de Tal Inventado ${S}`
const CPF_EQUIPE = cpfValido(400_000_000 + (RODADA % 90_000_000))
const CPF_DA_RECUSA = cpfValido(500_000_000 + (RODADA % 9_000_000))
const FUNCAO = 'Oficineiro de teatro'

const CONTA_RECEITA = 'Repasses de emendas (teste)'
const CONTA_DESPESA = 'Despesas de projetos (teste)'
const DESC_RECEBIMENTO = `Repasse da emenda de teste ${S}`
const DESC_PAGAMENTO = `Compra de figurinos e cenário de teste ${S}`
const DESC_EQUIPE = `Pagamento de oficineiro ${NOME_EQUIPE} CPF ${CPF_EQUIPE}`
const DESC_RECEBIMENTO_2 = `Repasse complementar da emenda de teste ${S}`
const TEXTO_RECEBIMENTO = `Repasse da 1ª parcela da emenda ${S}`
const TEXTO_PAGAMENTO = `Compra de figurinos e cenário ${S}`
const TEXTO_PAGAMENTO_CORRIGIDO = `${TEXTO_PAGAMENTO} (texto corrigido)`
const TEXTO_EQUIPE = `Pagamento de oficina ${S}`
const TEXTO_RECEBIMENTO_2 = `Repasse complementar ${S}`

const PUBLICO = `${API_HML}/api/publico/transparencia/parcerias`

// ------------------------------------------------------------------------------------------------ datas e dinheiro
/** O dia (AAAA-MM-DD) daqui a `deslocamento` dias no relógio de Belém, que é o do navegador do robô. */
function dia(deslocamento: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + deslocamento * 86_400_000))
}
const br = (iso: string) => iso.split('-').reverse().join('/')
function maisDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
// as datas que os cenários 2 e 7 comparam entre si ficam fixas na execução (uma virada de meia-noite no meio não desencontra nada)
const DIA_DA_ETAPA_PREVISTA = dia(-12)
const DIA_DA_ETAPA_REALIZADA = dia(-10)
const DIA_DA_APRESENTACAO = dia(-3)
const DIA_DO_RESULTADO = dia(-1)

// ------------------------------------------------------------------------------------------------ o que um cenário guarda para o seguinte
type Movimento = {
  idTitulo: number
  numero: number
  idLancamento: number
  descricao: string
  centavos: number
  /** O dia de hoje (relógio de Belém) na hora da baixa: é o dia que a API pública tem de mostrar. */
  dia: string
}
type Resumo = {
  valor: number
  recebido: number
  pago: number
  saldo: number
}

const estado = {
  totalAntes: 0,
  recusasAntes: 0,
  recusasFeitas: 0,
  idA: 0,
  idB: 0,
  centroA: '',
  fotoEnviada: Buffer.alloc(0) as Buffer,
  idFoto: 0,
  livro: { receitas: 0, despesas: 0 },
  resumoClassificado: undefined as Resumo | undefined,
  rec: undefined as Movimento | undefined,
  pagOutro: undefined as Movimento | undefined,
  pagEquipe: undefined as Movimento | undefined,
}
/** As ações que cada parceria tem de ter na Auditoria, em ordem: cada passo que deu certo acrescenta a sua; a recusa não acrescenta nada. */
const trilhaA: string[] = []
const trilhaB: string[] = []

function movimento(m: Movimento | undefined, nome: string): Movimento {
  if (!m) throw new Error(`o cenário do livro-caixa (${nome}) não rodou antes`)
  return m
}

// ------------------------------------------------------------------------------------------------ dinheiro
const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})
/** O valor como o painel mostra ("R$ 1.234,56"), com espaço comum no lugar do espaço sem quebra. */
const reais = (centavos: number) =>
  MOEDA.format(centavos / 100).replace(/\s/g, ' ')
/** O valor como se digita num campo numérico ("1234.56"). */
const numeroDeCampo = (centavos: number) => (centavos / 100).toFixed(2)
/** O valor como uma pessoa o digita no Brasil ("1.234,56"). */
const comoDigitado = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
/** Todos os "R$ 1.234,56" de um texto, em centavos. */
function valoresDe(texto: string): number[] {
  const achados: number[] = []
  for (const m of texto
    .replace(/\s/g, ' ')
    .matchAll(/(-?)R\$ ([\d.]+),(\d{2})/g)) {
    const inteiro = Number((m[2] ?? '0').replace(/\./g, ''))
    achados.push((m[1] ? -1 : 1) * (inteiro * 100 + Number(m[3] ?? '0')))
  }
  return achados
}
/** O número que a API devolve (reais, com ponto) em centavos inteiros. */
const emCentavos = (valor: unknown) => Math.round(Number(valor) * 100)

// ------------------------------------------------------------------------------------------------ rede
function vigiarToken(page: Page): { valor: () => string; zerar: () => void } {
  let token = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token = cab
  })
  return {
    valor: () => token,
    // antes de trocar de usuário: sem isto o token do anterior serviria de resposta ao do próximo
    zerar: () => {
      token = ''
    },
  }
}

async function comLogin(
  page: Page,
  token: { valor: () => string },
  metodo: 'GET' | 'POST' | 'PATCH',
  caminho: string,
  corpo?: object,
): Promise<APIResponse> {
  await expect.poll(() => token.valor(), { timeout: 20_000 }).not.toBe('')
  return page.request.fetch(`${API_HML}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: token.valor(),
      'Content-Type': 'application/json',
    },
    data: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
}

async function entrarComo(
  page: Page,
  token: { zerar: () => void },
  papel: Papel,
): Promise<void> {
  token.zerar()
  await entrar(page, papel)
}

// ------------------------------------------------------------------------------------------------ a API pública
type PublicoFoto = {
  id_foto: number
  alt: string
  largura: number
  altura: number
  sha256: string
  arquivo: string
}
type PublicoEtapa = {
  titulo: string
  descricao: string | null
  data_realizacao: string | null
  local: string | null
  publico_atendido: number | null
  situacao: string
  fotos: PublicoFoto[]
}
type PublicoParceria = {
  id_parceria: number
  titulo: string
  objeto: string
  situacao: string
  proponente: string | null
  numero_emenda: string | null
  numero_termo: string | null
  identificador_unico: string | null
  valor_total: number
  recebido: number
  pago: number
  lancamentos_em_classificacao: number
  ultima_atualizacao: string
  parcelas?: {
    numero: number
    valor_previsto: number
    valor_recebido: number
  }[]
  recebimentos?: {
    data: string | null
    valor: number
    descricao: string
    parcela: number | null
  }[]
  pagamentos?: {
    data: string | null
    valor: number
    descricao: string
    categoria: string | null
    funcao: string | null
    fornecedor: unknown
  }[]
  etapas?: PublicoEtapa[]
  relatorios?: {
    tipo: string
    data_apresentacao: string | null
    prazo_analise_dias: number
    data_limite_analise: string | null
    resultado: string
    data_resultado: string | null
  }[]
}

async function listaPublica(page: Page): Promise<PublicoParceria[]> {
  const r = await page.request.get(PUBLICO)
  expect(r.status(), 'a lista pública abre sem login').toBe(200)
  return (await r.json()) as PublicoParceria[]
}
async function detalhePublico(
  page: Page,
  id: number,
): Promise<PublicoParceria> {
  const r = await page.request.get(`${PUBLICO}/${id}`)
  expect(r.status(), `o detalhe público da parceria ${id}`).toBe(200)
  return (await r.json()) as PublicoParceria
}
async function aindaNaoEPublica(page: Page, id: number, onde: string) {
  const lista = await listaPublica(page)
  expect(
    lista.some((p) => p.id_parceria === id),
    `${onde}: a parceria ${id} não pode estar na lista pública`,
  ).toBe(false)
  const r = await page.request.get(`${PUBLICO}/${id}`)
  expect(r.status(), `${onde}: o detalhe público tem de responder 404`).toBe(
    404,
  )
}

/** O que, no texto cru da API pública, seria dado pessoal (o sha256 das fotos é hexadecimal e pode ter uma sequência de dígitos: sai antes). */
function achadosDePessoal(texto: string): string[] {
  const limpo = texto.replace(/"sha256":\s*"[0-9a-f]{64}"/g, '"sha256":""')
  const regras: [string, RegExp][] = [
    ['CPF formatado', /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/],
    ['CPF só com dígitos', /(?<!\d)\d{11}(?!\d)/],
    ['e-mail', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/],
    [
      'celular',
      /(?<!\d)(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9\d{4}[\s.-]?\d{4}(?!\d)/,
    ],
  ]
  return regras.filter(([, regra]) => regra.test(limpo)).map(([nome]) => nome)
}

// ------------------------------------------------------------------------------------------------ telas
const regiao = (page: Page, nome: string): Locator =>
  page.getByRole('region', { name: nome })
const alerta = (page: Page, texto: string | RegExp): Locator =>
  page.getByRole('alert').filter({ hasText: texto })
/** O selo da publicação da parceria (Rascunho, Em revisão, Aprovado, Retirado), ao lado da situação da parceria. */
const selo = (page: Page): Locator =>
  page
    .locator('span.rounded-full')
    .filter({ hasText: /^(Rascunho|Em revisão|Aprovado|Retirado)$/ })
const proximoPasso = (page: Page): Locator =>
  page.locator('p[role="status"]').filter({ hasText: 'Próximo passo:' })
const formularioDaParceria = (page: Page): Locator =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: 'Cadastrar parceria' }),
  })

async function abrirParceria(
  page: Page,
  id: number,
  titulo: string,
): Promise<void> {
  await page.goto(`/parcerias/${id}`)
  await expect(
    page.getByRole('heading', { name: titulo, level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await expect(regiao(page, 'Resumo financeiro')).toBeVisible()
}

async function lerResumo(page: Page): Promise<Resumo> {
  const resumo = regiao(page, 'Resumo financeiro')
  const ler = async (rotulo: string): Promise<number> => {
    const bloco = resumo
      .locator('dl > div')
      .filter({ has: page.getByText(rotulo, { exact: true }) })
    await expect(bloco).toHaveCount(1)
    return valoresDe(await bloco.innerText())[0] ?? Number.NaN
  }
  return {
    valor: await ler('Valor da parceria'),
    recebido: await ler('Recebido'),
    pago: await ler('Pago'),
    saldo: await ler('Saldo (recebido menos pago)'),
  }
}

async function preencherFormulario(
  form: Locator,
  d: {
    titulo?: string
    objeto?: string
    valor?: string
    ano?: string
    orgao?: string
    proponente?: string
    numeroEmenda?: string
    identificador?: string
  },
): Promise<void> {
  if (d.titulo !== undefined) await form.getByLabel(/^Título/).fill(d.titulo)
  if (d.objeto !== undefined) await form.getByLabel(/^Objeto/).fill(d.objeto)
  if (d.valor !== undefined) await form.getByLabel(/^Valor total/).fill(d.valor)
  if (d.ano !== undefined) await form.getByLabel(/^Ano/).fill(d.ano)
  if (d.orgao !== undefined)
    await form.getByLabel(/^Órgão concedente/).fill(d.orgao)
  if (d.proponente !== undefined)
    await form.getByLabel(/^Proponente/).fill(d.proponente)
  if (d.numeroEmenda !== undefined)
    await form.getByLabel(/^Número da emenda/).fill(d.numeroEmenda)
  if (d.identificador !== undefined)
    await form.getByLabel(/^Identificador único/).fill(d.identificador)
}

/** Cadastra uma parceria pelo formulário (caminho certo, sem erro) e devolve o número que a tela abriu. */
async function cadastrarParceria(
  page: Page,
  d: { titulo: string; objeto: string; valor: string },
): Promise<number> {
  await page.goto('/parcerias/nova')
  await expect(
    page.getByRole('heading', { name: 'Nova parceria ou emenda', level: 1 }),
  ).toBeVisible()
  const form = formularioDaParceria(page)
  await preencherFormulario(form, d)
  await form.getByRole('button', { name: 'Cadastrar parceria' }).click()
  await expect(page).toHaveURL(/\/parcerias\/\d+$/)
  return Number(new URL(page.url()).pathname.split('/').pop())
}

/** Print só da área visível, com o alvo rolado para dentro dela: a Razão e a lista de Títulos listam o banco inteiro, e a página inteira não caberia. */
async function verTrecho(
  page: Page,
  info: TestInfo,
  nome: string,
  alvo: Locator,
): Promise<void> {
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await alvo.first().scrollIntoViewIfNeeded()
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

// ------------------------------------------------------------------------------------------------ o livro-caixa, pelas telas do Financeiro
const comOpcao = (escopo: Locator, opcao: string): Locator =>
  escopo
    .locator('select')
    .filter({ has: escopo.page().locator('option', { hasText: opcao }) })

async function escolher(seletor: Locator, trecho: string): Promise<void> {
  await expect(
    seletor.locator('option', { hasText: trecho }).first(),
    `a opção "${trecho}" tem de existir no campo`,
  ).toBeAttached()
  await escolherPorTexto(seletor, trecho)
}

const cartaoDoTitulo = (page: Page, descricao: string): Locator =>
  page.locator('div.rounded-md.border').filter({
    has: page.locator('p.font-medium', { hasText: descricao }),
  })

/**
 * Lança um título pela tela (Títulos > Novo título) e dá a baixa (Baixar), escolhendo o centro de custo da parceria: é assim que o dinheiro entra no livro-caixa
 * DAQUELA parceria. Despesa exige o comprovante (regra do plano de contas). Devolve o número do lançamento que o servidor gerou.
 */
async function lancarEBaixar(
  page: Page,
  d: {
    tipo: 'A Receber' | 'A Pagar'
    conta: string
    descricao: string
    centavos: number
  },
): Promise<Movimento> {
  const hoje = dia(0)
  await page.goto(
    `/financeiro/titulos?periodo=todos&busca=${encodeURIComponent(d.descricao)}`,
  )
  await expect(
    page.getByRole('heading', { name: 'Títulos', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Novo título', exact: true }).click()
  const form = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Registrar título' }),
  })
  await expect(form).toBeVisible()
  // o primeiro campo do formulário é o tipo (A Pagar / A Receber); procurá-lo pela opção "A Receber" poderia casar com o nome de uma conta
  await form.locator('select').first().selectOption(d.tipo)
  await escolher(comOpcao(form, 'Selecione a conta contábil…'), d.conta)
  await form.getByPlaceholder('Descrição', { exact: true }).fill(d.descricao)
  await form.getByPlaceholder('Valor original').fill(numeroDeCampo(d.centavos))
  await form.locator('input[type="date"]').fill(hoje)
  const [titulo] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/titulos/',
    ),
    form.getByRole('button', { name: 'Registrar título' }).click(),
  ])
  expect(
    titulo.ok(),
    `lançar o título "${d.descricao}": ${await titulo.text()}`,
  ).toBe(true)
  const { id_titulo } = (await titulo.json()) as { id_titulo: number }
  await expect(form).toHaveCount(0)
  const cartao = cartaoDoTitulo(page, d.descricao)
  await expect(cartao).toBeVisible()

  await cartao.getByRole('button', { name: 'Baixar', exact: true }).click()
  const baixa = cartao.locator('form')
  await expect(baixa.getByPlaceholder('Valor pago')).toBeVisible()
  await baixa.getByPlaceholder('Valor pago').fill(numeroDeCampo(d.centavos))
  await baixa.getByPlaceholder('Forma de pagamento').fill('Pix')
  await escolher(
    comOpcao(baixa, 'Conta de contrapartida (Caixa/Banco)…'),
    'Caixa e banco (teste)',
  )
  await escolher(comOpcao(baixa, 'Sem centro de custo'), `${estado.centroA} — `)
  await baixa.locator('input[type="date"]').fill(hoje)
  if (d.tipo === 'A Pagar') {
    await baixa.locator('input[type="file"]').setInputFiles({
      name: 'comprovante-de-teste.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4\n% comprovante de teste do robô ${S}\n`),
    })
    await expect(baixa.getByText('Comprovante anexado.')).toBeVisible()
  }
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/baixar-titulo/',
    ),
    baixa.getByRole('button', { name: 'Confirmar baixa' }).click(),
  ])
  expect(
    resposta.ok(),
    `baixar "${d.descricao}": ${await resposta.text()}`,
  ).toBe(true)
  const corpo = (await resposta.json()) as {
    id_lancamento: number
    numero_sequencial: number
  }
  await expect(baixa).toHaveCount(0)
  await expect(cartao).toContainText('Pago')
  return {
    idTitulo: id_titulo,
    numero: corpo.numero_sequencial,
    idLancamento: corpo.id_lancamento,
    descricao: d.descricao,
    centavos: d.centavos,
    dia: hoje,
  }
}

/** Na tela da parceria: classifica o recebimento que está esperando (texto público e, se pedido, a parcela a que ele se refere). */
async function classificarRecebimento(
  page: Page,
  d: { descricao: string; texto: string; indiceDaParcela: number },
): Promise<void> {
  const pendentes = regiao(page, 'Movimentos do livro-caixa a classificar')
  const item = pendentes.getByRole('listitem').filter({ hasText: d.descricao })
  await expect(item).toHaveCount(1)
  await item.getByLabel(/^Texto público/).fill(d.texto)
  await item
    .getByLabel(/^Parcela a que se refere/)
    .selectOption({ index: d.indiceDaParcela })
  await item.getByRole('button', { name: 'Classificar para o site' }).click()
  await expect(
    regiao(page, 'Movimentos classificados'),
    'o movimento passa para a lista dos que aparecem no site',
  ).toContainText(`No site: “${d.texto}”`)
}

// ------------------------------------------------------------------------------------------------ Auditoria
async function totalNaAuditoria(page: Page, tabela: string): Promise<number> {
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

const contar = (acoes: string[]): [string, number][] => {
  const contagem = new Map<string, number>()
  for (const a of acoes) contagem.set(a, (contagem.get(a) ?? 0) + 1)
  return [...contagem.entries()]
}

// =====================================================================================================================================
test('1. cadastrar a parceria: o formulário diz o que falta, dado pessoal e identificador repetido são recusados, e ela nasce como rascunho, com centro de custo próprio e fora do site', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  // a régua da Auditoria, antes de qualquer coisa (só quem tem a permissão da Auditoria a abre)
  await entrar(page, 'presidente')
  estado.totalAntes = await totalNaAuditoria(page, 'parcerias')
  estado.recusasAntes = await totalNaAuditoria(page, 'recusas')
  await sair(page)

  await entrar(page, 'tesoureiro')
  // o caminho do dia a dia: o módulo é um cartão do Início
  await page
    .getByRole('link', { name: /Parcerias e emendas/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Parcerias e emendas', level: 1 }),
  ).toBeVisible()
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Nova parceria' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Nova parceria ou emenda', level: 1 }),
  ).toBeVisible()

  const form = formularioDaParceria(page)
  const cadastrar = form.getByRole('button', { name: 'Cadastrar parceria' })
  await cadastrar.click()
  await expect(
    alerta(page, 'Dê um título à parceria (pelo menos 3 letras).'),
  ).toBeVisible()
  await ver(page, info, 'nova parceria: formulario vazio recusado')

  await preencherFormulario(form, { titulo: TITULO_A })
  await cadastrar.click()
  await expect(
    alerta(
      page,
      'Descreva o objeto (o que será feito), com pelo menos 10 letras.',
    ),
  ).toBeVisible()

  // o objeto vai ao site: dado pessoal nele é recusado pelo servidor (e-mail de pessoa), e nada é criado
  await preencherFormulario(form, {
    objeto:
      'Contato do coordenador: coordenador.teste@exemplo.com.br para as oficinas.',
  })
  await cadastrar.click()
  await expect(
    alerta(page, 'Informe o valor total em reais, por exemplo 50.000,00.'),
  ).toBeVisible()
  await preencherFormulario(form, { valor: 'abc' })
  await cadastrar.click()
  await expect(
    alerta(page, 'Informe o valor total em reais, por exemplo 50.000,00.'),
  ).toBeVisible()
  await preencherFormulario(form, { valor: comoDigitado(TOTAL), ano: '1999' })
  await cadastrar.click()
  await expect(alerta(page, 'Informe o ano (entre 2000 e 2100).')).toBeVisible()
  await preencherFormulario(form, { ano: '2026' })
  await cadastrar.click()
  await expect(
    alerta(page, /O campo 'objeto' vai ao site e parece conter dado pessoal/),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/parcerias\/nova$/)
  await ver(page, info, 'nova parceria: e-mail no objeto recusado')

  // o certo
  await preencherFormulario(form, {
    objeto: OBJETO_A,
    orgao: ORGAO,
    proponente: PROPONENTE,
    numeroEmenda: NUMERO_EMENDA,
    identificador: ID_UNICO,
  })
  await cadastrar.click()
  await expect(page).toHaveURL(/\/parcerias\/\d+$/)
  estado.idA = Number(new URL(page.url()).pathname.split('/').pop())
  trilhaA.push('CRIADO')
  await expect(
    page.getByRole('heading', { name: TITULO_A, level: 1 }),
  ).toBeVisible()
  await expect(selo(page)).toHaveText('Rascunho')
  // o centro de custo exclusivo nasce junto, e o dinheiro (que ainda não existe) é lido do livro-caixa
  const textoDoCentro = await page
    .getByText(/centro de custo PARC-\d+/)
    .first()
    .textContent()
  estado.centroA = /(PARC-\d+)/.exec(textoDoCentro ?? '')?.[1] ?? ''
  expect(
    estado.centroA,
    'o centro de custo PARC-nnnn nasce com a parceria',
  ).toMatch(/^PARC-\d+$/)
  const resumo = regiao(page, 'Resumo financeiro')
  await expect(resumo).toContainText(reais(TOTAL))
  expect(await lerResumo(page)).toEqual({
    valor: TOTAL,
    recebido: 0,
    pago: 0,
    saldo: 0,
  })
  await expect(proximoPasso(page)).toContainText('Tudo certo para publicar')
  await ver(page, info, 'parceria cadastrada: rascunho com centro de custo')

  // o mesmo identificador de novo: recusado, com o número da parceria que já o tem
  await page.goto('/parcerias/nova')
  const form2 = formularioDaParceria(page)
  await preencherFormulario(form2, {
    titulo: `${TITULO_A} (repetida)`,
    objeto: OBJETO_A,
    valor: comoDigitado(TOTAL),
    identificador: ID_UNICO,
  })
  await form2.getByRole('button', { name: 'Cadastrar parceria' }).click()
  await expect(
    alerta(
      page,
      `O identificador único '${ID_UNICO}' já está na parceria nº ${estado.idA}`,
    ),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/parcerias\/nova$/)
  await ver(page, info, 'nova parceria: identificador repetido recusado')

  // a lista: uma só (as recusas não criaram nada), com o valor e a publicação em rascunho; o filtro "Publicação" separa
  await page.goto('/parcerias')
  const filtros = page.getByRole('search', { name: 'Filtrar parcerias' })
  await filtros.getByLabel(/^Buscar/).fill(S)
  const linha = page.getByRole('row').filter({ hasText: TITULO_A })
  await expect(linha).toHaveCount(1)
  await expect(linha).toContainText(`emenda ${NUMERO_EMENDA}`)
  await expect(linha).toContainText(PROPONENTE)
  await expect(linha).toContainText(reais(TOTAL))
  await expect(linha).toContainText('Rascunho')
  await expect(linha).toContainText('Proposta')
  await filtros.getByLabel(/^Publicação/).selectOption('Aprovado')
  await expect(linha).toHaveCount(0)
  await filtros.getByLabel(/^Publicação/).selectOption('Rascunho')
  await expect(linha).toHaveCount(1)
  await ver(page, info, 'lista de parcerias: a nova em rascunho')

  // rascunho não é público
  await aindaNaoEPublica(page, estado.idA, 'rascunho')
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
test('2. parcelas (a soma não passa do valor), etapa de execução, relatório de prestação de contas e situação da parceria: cada regra recusa o que é errado e aceita o certo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await abrirParceria(page, estado.idA, TITULO_A)

  // ---- parcelas
  const parcelas = regiao(page, 'Parcelas previstas')
  const novaParcela = async (centavos: number | null, data?: string) => {
    await parcelas
      .getByLabel(/^Valor da nova parcela/)
      .fill(centavos === null ? '' : comoDigitado(centavos))
    await parcelas.getByLabel(/^Prevista para/).fill(data ?? '')
    await parcelas.getByRole('button', { name: 'Adicionar parcela' }).click()
  }
  await novaParcela(null)
  await expect(
    parcelas.getByRole('alert').filter({
      hasText: 'Informe o valor da parcela em reais, por exemplo 10.000,00.',
    }),
  ).toBeVisible()
  await novaParcela(PARCELA_ACIMA_DO_VALOR)
  await expect(
    alerta(page, 'passaria do valor total da parceria'),
    'parcela que faz a soma passar do valor da parceria é recusada pelo servidor',
  ).toBeVisible()
  await expect(parcelas).toContainText('Nenhuma parcela cadastrada.')
  await ver(page, info, 'parcela acima do valor da parceria: recusada')

  await novaParcela(PARCELA_1, dia(5))
  await expect(
    parcelas.getByRole('row').filter({ hasText: '1ª' }),
  ).toContainText(reais(PARCELA_1))
  trilhaA.push('PARCELA_CRIADA')
  await novaParcela(PARCELA_2, dia(35))
  await expect(
    parcelas.getByRole('row').filter({ hasText: '2ª' }),
  ).toContainText(reais(PARCELA_2))
  trilhaA.push('PARCELA_CRIADA')
  await expect(parcelas).toContainText(
    `As parcelas somam ${reais(PARCELA_1 + PARCELA_2)} de ${reais(TOTAL)} (faltam ${reais(TOTAL - PARCELA_1 - PARCELA_2)} para detalhar).`,
  )
  await expect(regiao(page, 'Pendências e avisos')).toContainText(
    'as parcelas cadastradas somam',
  )
  await ver(page, info, 'duas parcelas cadastradas')

  // ---- etapa de execução
  const etapas = regiao(page, 'Etapas de execução')
  await etapas.getByRole('button', { name: 'Adicionar etapa' }).click()
  await expect(
    etapas.getByRole('alert').filter({
      hasText: 'Dê um título à etapa (pelo menos 3 letras).',
    }),
  ).toBeVisible()
  await etapas.getByLabel('Título da nova etapa').fill(TITULO_ETAPA_1)
  await etapas
    .getByLabel(/^Descrição \(opcional\)/)
    .fill('Contato da oficineira: oficineira.teste@exemplo.com.br')
  await etapas.getByRole('button', { name: 'Adicionar etapa' }).click()
  await expect(
    alerta(page, /O campo 'descrição da etapa' vai ao site/),
    'e-mail na descrição da etapa (que vai ao site) é recusado',
  ).toBeVisible()
  await etapas
    .getByLabel(/^Descrição \(opcional\)/)
    .fill('Ensaios de uma peça de teatro com as crianças, texto inventado.')
  await etapas.getByLabel(/^Local/).fill(LOCAL_ETAPA)
  await etapas.getByLabel(/^Prevista para/).fill(DIA_DA_ETAPA_PREVISTA)
  await etapas.getByRole('button', { name: 'Adicionar etapa' }).click()
  const etapa = etapas.getByRole('listitem').filter({ hasText: TITULO_ETAPA_1 })
  await expect(etapa).toHaveCount(1)
  await expect(etapa).toContainText(
    `Prevista para ${br(DIA_DA_ETAPA_PREVISTA)}`,
  )
  trilhaA.push('ETAPA_CRIADA')

  // "Realizada" sem a data é recusada; com a data e o público, vira realizada
  await etapa.getByLabel(/^Situação/).selectOption('Realizada')
  await etapa.getByRole('button', { name: 'Salvar situação' }).click()
  await expect(
    alerta(page, 'informe a data de realização para marcá-la como Realizada'),
  ).toBeVisible()
  await etapa.getByLabel(/^Realizada em/).fill(DIA_DA_ETAPA_REALIZADA)
  await etapa.getByLabel(/^Pessoas atendidas/).fill(String(PUBLICO_ATENDIDO))
  await etapa.getByRole('button', { name: 'Salvar situação' }).click()
  await expect(etapa).toContainText(
    `Realizada em ${br(DIA_DA_ETAPA_REALIZADA)} · ${LOCAL_ETAPA} · ${PUBLICO_ATENDIDO} pessoa(s) atendida(s)`,
  )
  trilhaA.push('ETAPA_EDITADA')
  await ver(page, info, 'etapa realizada, com local e publico atendido')

  // ---- relatório de prestação de contas
  const relatorios = regiao(page, 'Relatórios e prestação de contas')
  await relatorios.getByLabel(/^Novo relatório/).selectOption('PARCIAL')
  await relatorios.getByLabel(/^Data prevista/).fill(dia(60))
  await relatorios.getByRole('button', { name: 'Adicionar relatório' }).click()
  const relatorio = relatorios
    .getByRole('listitem')
    .filter({ hasText: 'Prestação de contas parcial' })
  await expect(relatorio).toHaveCount(1)
  await expect(relatorio).toContainText(
    'Prestação de contas parcial — Em análise',
  )
  trilhaA.push('RELATORIO_CRIADO')

  // resultado sem apresentação, e apresentação sem a data do resultado: o servidor recusa as duas
  await relatorio.getByLabel(/^Resultado da análise/).selectOption('Regulares')
  await relatorio.getByRole('button', { name: 'Salvar relatório' }).click()
  await expect(
    alerta(page, "só pode ter resultado ('Regulares') depois de apresentado"),
  ).toBeVisible()
  await relatorio.getByLabel(/^Apresentada em/).fill(DIA_DA_APRESENTACAO)
  await relatorio.getByRole('button', { name: 'Salvar relatório' }).click()
  await expect(
    alerta(page, "informe a data do resultado ('Regulares')"),
  ).toBeVisible()
  await relatorio.getByLabel(/^Data do resultado/).fill(DIA_DO_RESULTADO)
  await relatorio.getByRole('button', { name: 'Salvar relatório' }).click()
  await expect(relatorio).toContainText(
    'Prestação de contas parcial — Regulares',
  )
  await expect(relatorio).toContainText(
    `Apresentada: ${br(DIA_DA_APRESENTACAO)}`,
  )
  await expect(relatorio).toContainText(
    `Análise até ${br(maisDias(DIA_DA_APRESENTACAO, 150))} (150 dias)`,
  )
  await expect(relatorio).toContainText(`Resultado em ${br(DIA_DO_RESULTADO)}`)
  trilhaA.push('RELATORIO_EDITADO')
  await ver(
    page,
    info,
    'relatorio apresentado, resultado Regulares, prazo de analise de 150 dias',
  )

  // ---- situação da parceria: exige o número do termo; "Concluída" exige a prestação FINAL
  const dados = regiao(page, 'Dados da parceria')
  await dados.getByRole('button', { name: 'Editar os dados' }).click()
  const edicao = dados.locator('form')
  const situacao = edicao.getByLabel(/^Situação da parceria/)
  await expect(
    situacao.locator('option', { hasText: 'Em execução' }),
  ).toBeAttached()
  await situacao.selectOption('Em execução')
  await edicao.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(
    alerta(page, 'Informe o número do termo antes de mudar a situação'),
  ).toBeVisible()
  await edicao.getByLabel(/^Número do termo/).fill(NUMERO_TERMO)
  await edicao.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(
    dados.getByRole('button', { name: 'Editar os dados' }),
  ).toBeVisible()
  await expect(dados).toContainText(NUMERO_TERMO)
  trilhaA.push('EDITADO')

  await dados.getByRole('button', { name: 'Editar os dados' }).click()
  await edicao.getByLabel(/^Situação da parceria/).selectOption('Concluída')
  await edicao.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(
    alerta(
      page,
      'Só dá para marcar como Concluída depois de apresentar a prestação de contas FINAL',
    ),
  ).toBeVisible()
  await ver(page, info, 'concluida sem prestacao final: recusada')
  await edicao.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dados.locator('form')).toHaveCount(0)
  await expect(
    page.locator('span.rounded-full', { hasText: /^Em execução$/ }),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
test('3. fotos da etapa: sem autorização de imagem, sem descrição, com CPF na descrição e arquivo que não é foto são recusados; a foto boa abre (só com login) e apagar tira do armazenamento', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = vigiarToken(page)
  await entrar(page, 'tesoureiro')
  await abrirParceria(page, estado.idA, TITULO_A)
  const etapa = regiao(page, 'Etapas de execução')
    .getByRole('listitem')
    .filter({ hasText: TITULO_ETAPA_1 })
  const enviar = etapa.getByRole('button', { name: 'Enviar a foto' })
  const arquivo = etapa.locator('input[type="file"]')
  const descricao = etapa.getByLabel(/^Descrição da foto/)
  const autorizacao = etapa.getByRole('checkbox')
  const envioDeFoto = () =>
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/etapas\/\d+\/fotos$/.test(new URL(r.url()).pathname),
    )

  // a tela recusa antes de enviar: sem arquivo, sem a autorização, sem a descrição
  await enviar.click()
  await expect(
    etapa.getByRole('alert').filter({ hasText: 'Escolha a foto.' }),
  ).toBeVisible()
  const foto1 = await fotoDeTeste(page, `parceria ${S}, foto 1`)
  await arquivo.setInputFiles({
    name: 'oficina-de-teatro.jpg',
    mimeType: 'image/jpeg',
    buffer: foto1,
  })
  await enviar.click()
  await expect(
    etapa.getByRole('alert').filter({
      hasText:
        'Confirme a autorização de uso de imagem: sem ela a foto não é aceita.',
    }),
  ).toBeVisible()
  await autorizacao.check()
  await descricao.fill('curta')
  await enviar.click()
  await expect(
    etapa.getByRole('alert').filter({
      hasText: 'Descreva a foto para quem não enxerga (pelo menos 10 letras).',
    }),
  ).toBeVisible()
  await ver(page, info, 'foto sem descricao suficiente: recusada na tela')

  // o servidor recusa dado pessoal na descrição (ela vai ao site) e arquivo que não é imagem
  await descricao.fill(
    `Foto da oficina, responsável pela criança, CPF ${CPF_DA_RECUSA}`,
  )
  await enviar.click()
  await expect(
    alerta(
      page,
      /O campo 'descrição da foto' vai ao site e parece conter dado pessoal/,
    ),
  ).toBeVisible()
  await descricao.fill(ALT_1)
  await arquivo.setInputFiles({
    name: 'nao-e-foto.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('isto não é uma imagem, é só texto'),
  })
  await enviar.click()
  await expect(
    alerta(page, 'Formato não suportado. Use foto JPG, PNG ou WEBP.'),
  ).toBeVisible()
  await ver(page, info, 'arquivo que nao e foto: recusado pelo servidor')

  // a foto boa
  estado.fotoEnviada = foto1
  await arquivo.setInputFiles({
    name: 'oficina-de-teatro.jpg',
    mimeType: 'image/jpeg',
    buffer: foto1,
  })
  const [aceita] = await Promise.all([envioDeFoto(), enviar.click()])
  expect(aceita.status(), await aceita.text()).toBe(201)
  type Detalhe = {
    etapas: {
      titulo: string
      fotos: { id_foto: number; largura: number; altura: number; alt: string }[]
    }[]
  }
  const fotos =
    ((await aceita.json()) as Detalhe).etapas.find(
      (e) => e.titulo === TITULO_ETAPA_1,
    )?.fotos ?? []
  expect(fotos).toHaveLength(1)
  const primeira = fotos[0]
  if (!primeira) throw new Error('a foto não voltou no detalhe da parceria')
  estado.idFoto = primeira.id_foto
  expect(primeira.alt).toBe(ALT_1)
  // regravada pelo servidor: o tamanho da foto de teste (640 x 480) continua, o arquivo é outro (mais abaixo, na API pública)
  expect([primeira.largura, primeira.altura]).toEqual([640, 480])
  trilhaA.push('FOTO_ENVIADA')
  await expect(
    etapa.locator('p[role="status"]', { hasText: 'Foto enviada.' }),
  ).toBeVisible()
  const miniatura = etapa.locator(`img[alt="${ALT_1}"]`)
  await expect(miniatura).toBeVisible()
  await expect
    .poll(() => miniatura.evaluate((i: HTMLImageElement) => i.naturalWidth), {
      message: 'a miniatura da foto carregou (com o login da pessoa)',
    })
    .toBeGreaterThan(0)
  await ver(page, info, 'foto da etapa enviada, com a miniatura')

  // a foto abre só para quem tem login; antes de a parceria ser aprovada, o endereço público não a mostra
  const caminho = `/api/parcerias/${estado.idA}/fotos/${estado.idFoto}/arquivo`
  const comToken = await comLogin(page, token, 'GET', caminho)
  expect(comToken.status()).toBe(200)
  expect(comToken.headers()['content-type']).toContain('image/jpeg')
  expect([...(await comToken.body()).subarray(0, 3)]).toEqual([
    0xff, 0xd8, 0xff,
  ])
  const semLogin = await page.request.get(`${API_HML}${caminho}`)
  expect([401, 403], 'a foto privada pede login').toContain(semLogin.status())
  const publica = await page.request.get(
    `${PUBLICO}/${estado.idA}/fotos/${estado.idFoto}`,
  )
  expect(
    publica.status(),
    'parceria que não foi aprovada não mostra foto',
  ).toBe(404)

  // uma segunda foto, e a retirada da autorização: apagar tira da tela e do armazenamento
  const foto2 = await fotoDeTeste(page, `parceria ${S}, foto 2`)
  await arquivo.setInputFiles({
    name: 'palco.jpg',
    mimeType: 'image/jpeg',
    buffer: foto2,
  })
  await autorizacao.check()
  await descricao.fill(ALT_2)
  const [segunda] = await Promise.all([envioDeFoto(), enviar.click()])
  expect(segunda.status(), await segunda.text()).toBe(201)
  trilhaA.push('FOTO_ENVIADA')
  const idSegunda =
    ((await segunda.json()) as Detalhe).etapas
      .find((e) => e.titulo === TITULO_ETAPA_1)
      ?.fotos.find((f) => f.alt === ALT_2)?.id_foto ?? 0
  expect(idSegunda).toBeGreaterThan(0)
  await expect(etapa.getByRole('img', { name: ALT_2 })).toBeVisible()
  const apagar = etapa.getByRole('button', { name: `Apagar a foto: ${ALT_2}` })
  await apagar.click()
  await expect(apagar).toHaveCount(0)
  await expect(etapa.getByRole('img', { name: ALT_2 })).toHaveCount(0)
  trilhaA.push('FOTO_APAGADA')
  const apagada = await comLogin(
    page,
    token,
    'GET',
    `/api/parcerias/${estado.idA}/fotos/${idSegunda}/arquivo`,
  )
  expect(apagada.status(), 'a foto apagada não abre mais').toBe(404)
  await expect(etapa.getByRole('img', { name: ALT_1 })).toBeVisible()
  await ver(page, info, 'foto apagada: so a primeira ficou')
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
test('4. o dinheiro vem do livro-caixa: a receita e as duas despesas são lançadas pelas telas do Financeiro no centro de custo da parceria, e a Razão e o relatório por centro de custo mostram os mesmos valores', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')

  estado.rec = await lancarEBaixar(page, {
    tipo: 'A Receber',
    conta: CONTA_RECEITA,
    descricao: DESC_RECEBIMENTO,
    centavos: RECEBIDO,
  })
  await verTrecho(
    page,
    info,
    'titulo a receber baixado no centro de custo da parceria',
    cartaoDoTitulo(page, DESC_RECEBIMENTO),
  )
  estado.pagOutro = await lancarEBaixar(page, {
    tipo: 'A Pagar',
    conta: CONTA_DESPESA,
    descricao: DESC_PAGAMENTO,
    centavos: PAGO_OUTRO,
  })
  estado.pagEquipe = await lancarEBaixar(page, {
    tipo: 'A Pagar',
    conta: CONTA_DESPESA,
    descricao: DESC_EQUIPE,
    centavos: PAGO_EQUIPE,
  })
  await verTrecho(
    page,
    info,
    'titulo a pagar baixado com comprovante no centro da parceria',
    cartaoDoTitulo(page, DESC_EQUIPE),
  )

  // a Razão Contábil: cada baixa é um lançamento em partida dobrada, com os mesmos valores
  await page.goto('/financeiro/razao-contabil')
  await expect(
    page.getByRole('heading', { name: 'Razão Contábil', level: 1 }),
  ).toBeVisible()
  const lancamentos: [Movimento, string, string][] = [
    [
      estado.rec,
      `Debito Caixa e banco (teste) ${reais(RECEBIDO)}`,
      `Credito ${CONTA_RECEITA} ${reais(RECEBIDO)}`,
    ],
    [
      estado.pagOutro,
      `Debito ${CONTA_DESPESA} ${reais(PAGO_OUTRO)}`,
      `Credito Caixa e banco (teste) ${reais(PAGO_OUTRO)}`,
    ],
    [
      estado.pagEquipe,
      `Debito ${CONTA_DESPESA} ${reais(PAGO_EQUIPE)}`,
      `Credito Caixa e banco (teste) ${reais(PAGO_EQUIPE)}`,
    ],
  ]
  for (const [m, lado1, lado2] of lancamentos) {
    const cartao = page.locator('div.rounded-md.border').filter({
      has: page.locator('p.font-medium', {
        hasText: `#${m.numero} — Baixa do título #${m.idTitulo} — ${m.descricao}`,
      }),
    })
    await expect(cartao, `a Razão tem o lançamento #${m.numero}`).toHaveCount(1)
    await expect(cartao).toContainText('Normal')
    await expect(cartao).toContainText(lado1)
    await expect(cartao).toContainText(lado2)
  }
  await verTrecho(
    page,
    info,
    'razao contabil: o lancamento da receita da parceria',
    page.locator('div.rounded-md.border').filter({
      has: page.locator('p.font-medium', {
        hasText: `#${estado.rec.numero} — Baixa do título`,
      }),
    }),
  )

  // Receitas x despesas por centro de custo: soma do livro-caixa DAQUELA parceria
  await page.goto('/financeiro/relatorios')
  const secao = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Receitas x despesas' }),
  })
  await secao.getByRole('button', { name: 'Ver por centro de custo' }).click()
  const linha = secao.locator('div.flex').filter({
    hasText: `Parceria: ${TITULO_A}`,
  })
  await expect(linha).toHaveCount(1)
  await expect(linha).toContainText(
    `${reais(RECEBIDO)} − ${reais(PAGO)} = ${reais(RECEBIDO - PAGO)}`,
  )
  const [receitas, despesas] = valoresDe(await linha.innerText())
  estado.livro = {
    receitas: receitas ?? Number.NaN,
    despesas: despesas ?? Number.NaN,
  }
  expect(estado.livro).toEqual({ receitas: RECEBIDO, despesas: PAGO })
  await verTrecho(
    page,
    info,
    'relatorio: receitas x despesas por centro de custo da parceria',
    linha,
  )

  // a tela da parceria enxerga o mesmo dinheiro, sem ninguém digitar: recebido, pago e saldo; e os 3 movimentos esperam a classificação
  await abrirParceria(page, estado.idA, TITULO_A)
  expect(await lerResumo(page)).toEqual({
    valor: TOTAL,
    recebido: RECEBIDO,
    pago: PAGO,
    saldo: RECEBIDO - PAGO,
  })
  const pendentes = regiao(page, 'Movimentos do livro-caixa a classificar')
  await expect(pendentes.getByRole('listitem')).toHaveCount(3)
  for (const [m, natureza] of [
    [estado.rec, 'Recebimento'],
    [estado.pagOutro, 'Pagamento'],
    [estado.pagEquipe, 'Pagamento'],
  ] as const) {
    const item = pendentes.getByRole('listitem').filter({
      hasText: `Baixa do título #${m.idTitulo}`,
    })
    await expect(item).toContainText(`${natureza} de ${reais(m.centavos)}`)
    await expect(item).toContainText(`lançamento nº ${m.numero}`)
    await expect(item).toContainText('Histórico interno (não vai ao site)')
  }
  await expect(proximoPasso(page)).toContainText(
    'Resolva a pendência abaixo para poder enviar para revisão.',
  )
  await ver(
    page,
    info,
    'parceria: o dinheiro do livro-caixa e 3 movimentos a classificar',
  )
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
test('5. cada movimento é classificado por uma pessoa (equipe só com a função, sem dado pessoal); sem classificar a publicação fica travada; o texto se corrige', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await abrirParceria(page, estado.idA, TITULO_A)
  const rec = movimento(estado.rec, 'recebimento')
  const pagOutro = movimento(estado.pagOutro, 'pagamento')
  const pagEquipe = movimento(estado.pagEquipe, 'pagamento de equipe')
  const pendentes = regiao(page, 'Movimentos do livro-caixa a classificar')
  const classificados = regiao(page, 'Movimentos classificados')
  const publicacao = regiao(page, 'Publicação no site de transparência')
  const item = (m: Movimento) =>
    pendentes
      .getByRole('listitem')
      .filter({ hasText: `Baixa do título #${m.idTitulo}` })

  // com movimento sem classificação, a parceria não vai para revisão: o servidor devolve a pendência, com o nome do registro
  await expect(regiao(page, 'Pendências e avisos')).toContainText(
    '3 lançamento(s) do livro-caixa neste centro de custo ainda não foram classificados para o site',
  )
  await publicacao.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(
    alerta(page, 'A parceria tem pendências que impedem a publicação.'),
  ).toContainText('ainda não foram classificados para o site')
  await expect(selo(page)).toHaveText('Rascunho')
  await ver(
    page,
    info,
    'enviar para revisao com movimento sem classificar: recusado',
  )

  // recebimento: o texto público é obrigatório; liga à 1ª parcela
  await item(rec)
    .getByRole('button', { name: 'Classificar para o site' })
    .click()
  await expect(
    item(rec).getByRole('alert').filter({
      hasText: 'Escreva o texto público (pelo menos 3 letras).',
    }),
  ).toBeVisible()
  await classificarRecebimento(page, {
    descricao: rec.descricao,
    texto: TEXTO_RECEBIMENTO,
    indiceDaParcela: 1,
  })
  trilhaA.push('LANCAMENTO_CLASSIFICADO')
  await expect(classificados).toContainText(`Recebimento de ${reais(RECEBIDO)}`)
  await expect(classificados).toContainText('(1ª parcela)')

  // pagamento: CPF no texto público é recusado pelo servidor; o certo passa como "Outro pagamento"
  await item(pagOutro)
    .getByLabel(/^Texto público/)
    .fill(`Compra paga ao oficineiro de CPF ${CPF_DA_RECUSA}`)
  await item(pagOutro)
    .getByRole('button', { name: 'Classificar para o site' })
    .click()
  await expect(
    alerta(
      page,
      /O campo 'descrição pública' vai ao site e parece conter dado pessoal/,
    ),
  ).toBeVisible()
  await item(pagOutro)
    .getByLabel(/^Texto público/)
    .fill(TEXTO_PAGAMENTO)
  await item(pagOutro)
    .getByRole('button', { name: 'Classificar para o site' })
    .click()
  await expect(classificados).toContainText(`No site: “${TEXTO_PAGAMENTO}”`)
  trilhaA.push('LANCAMENTO_CLASSIFICADO')

  // pagamento de equipe: só com a função (o nome nunca vai ao site)
  await item(pagEquipe)
    .getByLabel(/^Tipo de pagamento/)
    .selectOption('EQUIPE')
  await item(pagEquipe)
    .getByLabel(/^Texto público/)
    .fill(TEXTO_EQUIPE)
  await item(pagEquipe)
    .getByRole('button', { name: 'Classificar para o site' })
    .click()
  await expect(
    item(pagEquipe).getByRole('alert').filter({
      hasText:
        'Pagamento de equipe: informe a função (o nome não vai ao site).',
    }),
  ).toBeVisible()
  await ver(page, info, 'pagamento de equipe sem funcao: recusado')
  await item(pagEquipe)
    .getByLabel(/^Função/)
    .fill(FUNCAO)
  await item(pagEquipe)
    .getByRole('button', { name: 'Classificar para o site' })
    .click()
  await expect(classificados).toContainText(
    `No site: “${TEXTO_EQUIPE}” — função: ${FUNCAO}`,
  )
  trilhaA.push('LANCAMENTO_CLASSIFICADO')
  await expect(pendentes).toContainText(
    'Nenhum movimento esperando classificação.',
  )
  // o histórico interno (com o nome e o CPF do oficineiro) fica só no livro-caixa: a tela de classificados mostra apenas o texto público
  await expect(classificados).not.toContainText(NOME_EQUIPE)
  await expect(classificados).not.toContainText(CPF_EQUIPE)

  // corrigir o texto público de um movimento já classificado
  const doPagamento = classificados
    .getByRole('listitem')
    .filter({ hasText: TEXTO_PAGAMENTO })
  await doPagamento.getByRole('button', { name: 'Corrigir o texto' }).click()
  await doPagamento.getByLabel(/^Texto público/).fill(TEXTO_PAGAMENTO_CORRIGIDO)
  await doPagamento.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(classificados).toContainText(
    `No site: “${TEXTO_PAGAMENTO_CORRIGIDO}”`,
  )
  trilhaA.push('LANCAMENTO_EDITADO')

  // a parcela que já recebeu dinheiro não se apaga
  const parcelas = regiao(page, 'Parcelas previstas')
  await expect(
    parcelas.getByRole('row').filter({ hasText: '1ª' }),
  ).toContainText(`${reais(PARCELA_1)}`)
  await expect(
    parcelas.getByRole('row').filter({ hasText: '1ª' }),
  ).toContainText(reais(RECEBIDO))
  await parcelas.getByRole('button', { name: /^Apagar a parcela 1$/ }).click()
  await expect(
    alerta(
      page,
      'Esta parcela tem recebimento ligado a ela: desfaça a ligação antes de apagar.',
    ),
  ).toBeVisible()
  await expect(parcelas.getByRole('row').filter({ hasText: '1ª' })).toHaveCount(
    1,
  )

  // tudo classificado: o dinheiro não mudou, só passou a ser publicável
  estado.resumoClassificado = await lerResumo(page)
  expect(estado.resumoClassificado).toEqual({
    valor: TOTAL,
    recebido: RECEBIDO,
    pago: PAGO,
    saldo: RECEBIDO - PAGO,
  })
  await expect(proximoPasso(page)).toContainText('Tudo certo para publicar')
  await ver(page, info, 'tres movimentos classificados: pronta para revisao')
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
test('6. publicação: o Tesoureiro envia para revisão; quem criou ou enviou não aprova (a tela nem oferece o botão e a API recusa); o Presidente e o Secretário, que são outras pessoas, aprovam', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = vigiarToken(page)

  // ---- o Tesoureiro prepara e envia
  await entrar(page, 'tesoureiro')
  await abrirParceria(page, estado.idA, TITULO_A)
  const publicacao = regiao(page, 'Publicação no site de transparência')
  await expect(selo(page)).toHaveText('Rascunho')
  await publicacao.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(selo(page)).toHaveText('Em revisão')
  trilhaA.push('ENVIADO_REVISAO')
  await expect(
    publicacao.getByRole('button', { name: 'Aprovar a publicação' }),
  ).toHaveCount(0)
  await expect(proximoPasso(page)).toContainText(
    'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).',
  )
  await ver(
    page,
    info,
    'enviada para revisao: o Tesoureiro nao tem o botao de aprovar',
  )
  // pela API também: quem não tem a permissão de aprovar é recusado (e a recusa fica na Auditoria)
  const semPermissao = await comLogin(
    page,
    token,
    'POST',
    `/api/parcerias/${estado.idA}/aprovar`,
  )
  expect(semPermissao.status()).toBe(403)
  expect(((await semPermissao.json()) as { detail: string }).detail).toBe(
    "Sem permissão 'aprovar_publicacao'.",
  )
  estado.recusasFeitas += 1
  await aindaNaoEPublica(page, estado.idA, 'em revisão')
  await sair(page)

  // ---- o Presidente cria e envia a B: não pode aprovar a própria
  await entrarComo(page, token, 'presidente')
  estado.idB = await cadastrarParceria(page, {
    titulo: TITULO_B,
    objeto: OBJETO_B,
    valor: comoDigitado(500_000),
  })
  trilhaB.push('CRIADO')
  await expect(
    page.getByRole('heading', { name: TITULO_B, level: 1 }),
  ).toBeVisible()
  const publicacaoB = regiao(page, 'Publicação no site de transparência')
  await publicacaoB.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(selo(page)).toHaveText('Em revisão')
  trilhaB.push('ENVIADO_REVISAO')
  await expect(
    publicacaoB.getByRole('button', { name: 'Aprovar a publicação' }),
    'quem criou e enviou não tem o botão de aprovar a própria parceria',
  ).toHaveCount(0)
  await expect(proximoPasso(page)).toContainText(
    'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).',
  )
  await ver(
    page,
    info,
    'B enviada pelo Presidente: sem botao de aprovar a propria',
  )
  const propria = await comLogin(
    page,
    token,
    'POST',
    `/api/parcerias/${estado.idB}/aprovar`,
  )
  expect(propria.status()).toBe(403)
  expect(((await propria.json()) as { detail: string }).detail).toContain(
    'Quem criou ou enviou a parceria para revisão não pode aprová-la',
  )
  estado.recusasFeitas += 1
  await aindaNaoEPublica(page, estado.idB, 'B em revisão')

  // ---- o Presidente aprova a A (preparada e enviada pelo Tesoureiro): o aviso da lista leva até ela
  await page.goto('/parcerias')
  const aviso = page.locator('p[role="status"]').filter({ hasText: /aguarda/ })
  await expect(aviso.getByRole('link', { name: TITULO_A })).toBeVisible()
  await expect(
    aviso.getByRole('link', { name: TITULO_B }),
    'a B é dele: não está entre as que esperam a aprovação dele',
  ).toHaveCount(0)
  await aviso.getByRole('link', { name: TITULO_A }).click()
  await expect(
    page.getByRole('heading', { name: TITULO_A, level: 1 }),
  ).toBeVisible()
  const painel = regiao(page, 'Publicação no site de transparência')
  await expect(painel.getByRole('button', { name: 'Recusar' })).toBeVisible()
  await painel.getByRole('button', { name: 'Aprovar a publicação' }).click()
  await expect(painel).toContainText(
    'passam a ser vistos por qualquer pessoa no site de transparência',
  )
  await ver(
    page,
    info,
    'aprovar a publicacao: a confirmacao avisa que o publico vai ver',
  )
  await painel.getByRole('button', { name: 'Voltar' }).click()
  await expect(selo(page)).toHaveText('Em revisão')
  await painel.getByRole('button', { name: 'Aprovar a publicação' }).click()
  await painel.getByRole('button', { name: 'Confirmar aprovação' }).click()
  await expect(selo(page)).toHaveText('Aprovado')
  await expect(painel).toContainText('No site desde')
  trilhaA.push('APROVADO')
  await expect(proximoPasso(page)).toContainText('Publicada no site.')
  // o histórico: quem enviou e quem aprovou são pessoas diferentes
  const historico = regiao(page, 'Histórico')
  await expect(historico).toContainText('Aprovada para o site')
  const texto = await historico.innerText()
  const enviou = /Enviada para revisão por (\S+)/.exec(texto)?.[1]
  const aprovou = /Aprovada para o site por (\S+)/.exec(texto)?.[1]
  expect(enviou, 'o histórico diz quem enviou').toBeTruthy()
  expect(aprovou, 'o histórico diz quem aprovou').toBeTruthy()
  expect(aprovou, 'quem aprovou não é quem enviou').not.toBe(enviou)
  await ver(page, info, 'A aprovada pelo Presidente: no site desde agora')
  await sair(page)

  // ---- o Secretário (só aprova, não gerencia) aprova a B
  await entrarComo(page, token, 'secretario')
  await page.goto('/parcerias')
  await expect(
    page.getByRole('heading', { name: 'Parcerias e emendas', level: 1 }),
  ).toBeVisible()
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Nova parceria' }),
    'o Secretário não cadastra parceria: só aprova',
  ).toHaveCount(0)
  const avisoDele = page
    .locator('p[role="status"]')
    .filter({ hasText: /aguarda/ })
  await expect(avisoDele.getByRole('link', { name: TITULO_B })).toBeVisible()
  await ver(page, info, 'lista do Secretario: a B espera a aprovacao dele')
  await avisoDele.getByRole('link', { name: TITULO_B }).click()
  await expect(
    page.getByRole('heading', { name: TITULO_B, level: 1 }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Editar os dados' }),
  ).toHaveCount(0)
  const painelB = regiao(page, 'Publicação no site de transparência')
  await painelB.getByRole('button', { name: 'Aprovar a publicação' }).click()
  await painelB.getByRole('button', { name: 'Confirmar aprovação' }).click()
  await expect(selo(page)).toHaveText('Aprovado')
  await expect(painelB).toContainText('No site desde')
  trilhaB.push('APROVADO')
  await ver(page, info, 'B aprovada pelo Secretario')
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
test('7. a API pública mostra só o aprovado, com o valor que bate com o livro-caixa e sem dado pessoal; a edição depois de aprovada vai direto ao site; retirar do site tira da API', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = vigiarToken(page)
  const rec = movimento(estado.rec, 'recebimento')

  // ---- sem login: a lista e o detalhe
  const lista = await listaPublica(page)
  const daLista = lista.find((p) => p.id_parceria === estado.idA)
  if (!daLista) throw new Error('a parceria aprovada não está na lista pública')
  expect(
    lista.some((p) => p.id_parceria === estado.idB),
    'a B (aprovada pelo Secretário) também',
  ).toBe(true)
  const respostaDoDetalhe = await page.request.get(`${PUBLICO}/${estado.idA}`)
  expect(respostaDoDetalhe.status()).toBe(200)
  const corpoCru = await respostaDoDetalhe.text()
  const d = JSON.parse(corpoCru) as PublicoParceria

  // sem dado pessoal: o corpo CRU não traz CPF, e-mail nem telefone, e nada do histórico interno do livro-caixa
  expect(achadosDePessoal(corpoCru), 'dado pessoal no detalhe público').toEqual(
    [],
  )
  expect(
    achadosDePessoal(JSON.stringify(lista)),
    'dado pessoal na lista pública',
  ).toEqual([])
  for (const proibido of [
    NOME_EQUIPE,
    CPF_EQUIPE,
    CPF_EQUIPE.replace(/\D/g, ''),
    'Baixa do título',
    'Histórico interno',
  ]) {
    expect(
      corpoCru,
      `"${proibido}" não pode estar na API pública`,
    ).not.toContain(proibido)
  }
  expect(corpoCru).not.toMatch(/PARC-\d+|id_usuario|centro_custo/)

  // o dinheiro: o que o site mostra é o do livro-caixa (lido nas telas do Financeiro), centavo a centavo
  expect(emCentavos(d.valor_total)).toBe(TOTAL)
  expect(
    emCentavos(d.recebido),
    'recebido = receitas do relatório por centro de custo',
  ).toBe(estado.livro.receitas)
  expect(
    emCentavos(d.pago),
    'pago = despesas do relatório por centro de custo',
  ).toBe(estado.livro.despesas)
  expect(emCentavos(d.recebido)).toBe(RECEBIDO)
  expect(emCentavos(d.pago)).toBe(PAGO)
  expect(emCentavos(d.recebido) - emCentavos(d.pago)).toBe(
    estado.resumoClassificado?.saldo,
  )
  for (const campoDoDinheiro of ['valor_total', 'recebido', 'pago'] as const) {
    expect(
      emCentavos(daLista[campoDoDinheiro]),
      `lista = detalhe em ${campoDoDinheiro}`,
    ).toBe(emCentavos(d[campoDoDinheiro]))
  }
  const somaDe = (itens: { valor: number }[] | undefined) =>
    (itens ?? []).reduce((soma, i) => soma + emCentavos(i.valor), 0)
  expect(
    somaDe(d.recebimentos),
    'soma dos recebimentos listados = recebido',
  ).toBe(emCentavos(d.recebido))
  expect(somaDe(d.pagamentos), 'soma dos pagamentos listados = pago').toBe(
    emCentavos(d.pago),
  )
  expect(d.lancamentos_em_classificacao).toBe(0)
  expect(d.situacao).toBe('Em execução')
  expect(d.numero_termo).toBe(NUMERO_TERMO)
  expect(d.identificador_unico).toBe(ID_UNICO)
  expect(d.proponente).toBe(PROPONENTE)

  expect(
    (d.parcelas ?? []).map((p) => [
      p.numero,
      emCentavos(p.valor_previsto),
      emCentavos(p.valor_recebido),
    ]),
  ).toEqual([
    [1, PARCELA_1, RECEBIDO],
    [2, PARCELA_2, 0],
  ])
  expect(
    (d.recebimentos ?? []).map((r) => [
      r.descricao,
      emCentavos(r.valor),
      r.parcela,
      r.data,
    ]),
  ).toEqual([[TEXTO_RECEBIMENTO, RECEBIDO, 1, rec.dia]])
  expect(
    (d.pagamentos ?? []).map((p) => [
      p.descricao,
      emCentavos(p.valor),
      p.categoria,
      p.funcao,
    ]),
  ).toEqual([
    [TEXTO_PAGAMENTO_CORRIGIDO, PAGO_OUTRO, 'OUTRO', null],
    [TEXTO_EQUIPE, PAGO_EQUIPE, 'EQUIPE', FUNCAO],
  ])
  expect(
    (d.relatorios ?? []).map((r) => [
      r.tipo,
      r.resultado,
      r.data_apresentacao,
      r.prazo_analise_dias,
      r.data_limite_analise,
    ]),
  ).toEqual([
    [
      'Prestação de contas parcial',
      'Regulares',
      DIA_DA_APRESENTACAO,
      150,
      maisDias(DIA_DA_APRESENTACAO, 150),
    ],
  ])

  // a etapa, com a foto que a tela enviou: o endereço público abre, é uma JPEG regravada e o sha256 declarado confere
  const etapa = (d.etapas ?? []).find((e) => e.titulo === TITULO_ETAPA_1)
  if (!etapa) throw new Error('a etapa não está na API pública')
  expect([
    etapa.situacao,
    etapa.local,
    etapa.publico_atendido,
    etapa.data_realizacao,
  ]).toEqual([
    'Realizada',
    LOCAL_ETAPA,
    PUBLICO_ATENDIDO,
    DIA_DA_ETAPA_REALIZADA,
  ])
  expect(etapa.fotos).toHaveLength(1)
  const foto = etapa.fotos[0]
  if (!foto) throw new Error('a foto não está na API pública')
  expect([foto.alt, foto.largura, foto.altura]).toEqual([ALT_1, 640, 480])
  expect(foto.id_foto).toBe(estado.idFoto)
  const imagem = await page.request.get(`${API_HML}${foto.arquivo}`)
  expect(imagem.status()).toBe(200)
  expect(imagem.headers()['content-type']).toContain('image/jpeg')
  const bytes = await imagem.body()
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(foto.sha256)
  expect(
    Buffer.compare(bytes, estado.fotoEnviada),
    'o servidor regravou a imagem: o arquivo público não é o enviado',
  ).not.toBe(0)
  await info.attach('api-publica-da-parceria-A.json', {
    body: JSON.stringify(d, null, 2),
    contentType: 'application/json',
  })

  // ---- depois de aprovada: a edição vai DIRETO ao site (sem nova aprovação), e o livro-caixa novo muda o valor na hora
  await entrarComo(page, token, 'tesoureiro')
  await abrirParceria(page, estado.idA, TITULO_A)
  await expect(selo(page)).toHaveText('Aprovado')
  const dados = regiao(page, 'Dados da parceria')
  await dados.getByRole('button', { name: 'Editar os dados' }).click()
  const objetoNovo = `${OBJETO_A} Texto atualizado depois de aprovada (${S}).`
  await dados.getByLabel(/^Objeto/).fill(objetoNovo)
  await dados.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(
    dados.getByRole('button', { name: 'Editar os dados' }),
  ).toBeVisible()
  await expect(
    selo(page),
    'a edição não devolve a parceria para a aprovação',
  ).toHaveText('Aprovado')
  trilhaA.push('EDITADO')
  await expect
    .poll(async () => (await detalhePublico(page, estado.idA)).objeto, {
      message: 'o texto novo chegou à API pública',
      timeout: 30_000,
    })
    .toBe(objetoNovo)
  const depoisDaEdicao = await detalhePublico(page, estado.idA)
  expect(Date.parse(depoisDaEdicao.ultima_atualizacao)).toBeGreaterThan(
    Date.parse(d.ultima_atualizacao),
  )

  const etapas = regiao(page, 'Etapas de execução')
  await etapas.getByLabel('Título da nova etapa').fill(TITULO_ETAPA_2)
  await etapas.getByRole('button', { name: 'Adicionar etapa' }).click()
  await expect(etapas).toContainText(TITULO_ETAPA_2)
  trilhaA.push('ETAPA_CRIADA')
  await expect
    .poll(
      async () =>
        ((await detalhePublico(page, estado.idA)).etapas ?? []).map(
          (e) => e.titulo,
        ),
      { message: 'a etapa nova chegou à API pública', timeout: 30_000 },
    )
    .toContain(TITULO_ETAPA_2)

  // dinheiro novo no livro-caixa: o valor público muda na hora, e o movimento só aparece no site depois de classificado
  const rec2 = await lancarEBaixar(page, {
    tipo: 'A Receber',
    conta: CONTA_RECEITA,
    descricao: DESC_RECEBIMENTO_2,
    centavos: RECEBIDO_DEPOIS,
  })
  await expect
    .poll(
      async () => emCentavos((await detalhePublico(page, estado.idA)).recebido),
      { message: 'o recebido público segue o livro-caixa', timeout: 30_000 },
    )
    .toBe(RECEBIDO + RECEBIDO_DEPOIS)
  const antesDeClassificar = await detalhePublico(page, estado.idA)
  expect(antesDeClassificar.lancamentos_em_classificacao).toBe(1)
  expect(
    antesDeClassificar.recebimentos,
    'o movimento novo ainda não foi classificado: o site só diz que há um em classificação',
  ).toHaveLength(1)
  await abrirParceria(page, estado.idA, TITULO_A)
  await expect(proximoPasso(page)).toContainText(
    'Publicada no site. 1 lançamento(s) novo(s) do livro-caixa esperam classificação: o site só mostra depois.',
  )
  await expect(regiao(page, 'Resumo financeiro')).toContainText(
    reais(RECEBIDO + RECEBIDO_DEPOIS),
  )
  await ver(
    page,
    info,
    'aprovada, com um movimento novo esperando classificacao',
  )
  await classificarRecebimento(page, {
    descricao: rec2.descricao,
    texto: TEXTO_RECEBIMENTO_2,
    indiceDaParcela: 2,
  })
  trilhaA.push('LANCAMENTO_CLASSIFICADO')
  await expect
    .poll(
      async () => {
        const novo = await detalhePublico(page, estado.idA)
        return [
          novo.lancamentos_em_classificacao,
          (novo.recebimentos ?? []).map((r) => r.descricao),
          (novo.parcelas ?? []).map((p) => emCentavos(p.valor_recebido)),
        ]
      },
      { message: 'o movimento classificado entrou no site', timeout: 30_000 },
    )
    .toEqual([
      0,
      [TEXTO_RECEBIMENTO, TEXTO_RECEBIMENTO_2],
      [RECEBIDO, RECEBIDO_DEPOIS],
    ])
  const final = await detalhePublico(page, estado.idA)
  expect(somaDe(final.recebimentos)).toBe(emCentavos(final.recebido))
  expect(emCentavos(final.recebido)).toBe(RECEBIDO + RECEBIDO_DEPOIS)
  expect(emCentavos(final.pago)).toBe(PAGO)
  expect(achadosDePessoal(JSON.stringify(final))).toEqual([])
  await sair(page)

  // ---- retirar do site (Presidente): a B some da API; a A continua
  await entrarComo(page, token, 'presidente')
  await abrirParceria(page, estado.idB, TITULO_B)
  const painelB = regiao(page, 'Publicação no site de transparência')
  await painelB.getByRole('button', { name: 'Retirar do site' }).click()
  await painelB.getByLabel(/^Por que sair do site/).fill('curto')
  await painelB.getByRole('button', { name: 'Confirmar retirada' }).click()
  await expect(
    alerta(page, 'Explique o motivo da retirada (pelo menos 10 caracteres).'),
  ).toBeVisible()
  const motivo = `Retirada de teste do robô, rodada ${S}`
  await painelB.getByLabel(/^Por que sair do site/).fill(motivo)
  await painelB.getByRole('button', { name: 'Confirmar retirada' }).click()
  await expect(selo(page)).toHaveText('Retirado')
  await expect(painelB).toContainText('Retirada do site em')
  await expect(painelB).toContainText(motivo)
  trilhaB.push('RETIRADO')
  await ver(page, info, 'B retirada do site, com o motivo')
  await aindaNaoEPublica(page, estado.idB, 'B retirada')
  expect(
    (await listaPublica(page)).some((p) => p.id_parceria === estado.idA),
    'a A continua no site',
  ).toBe(true)
  expect(vigia.problemas()).toEqual([])
})

// =====================================================================================================================================
test('8. quem não tem a permissão é barrado na tela e na API (403), e cada ação, mais as tentativas de aprovar que o sistema recusou, ficaram na Auditoria', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = vigiarToken(page)

  // ---- o Secretário aprova, mas não gerencia: nem cadastra, nem edita
  await entrarComo(page, token, 'secretario')
  await page.goto('/parcerias/nova')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/403$/)
  await expect(page.getByText(/permissão necessária: parcerias/)).toBeVisible()
  await ver(page, info, 'Secretario barrado em Nova parceria')
  const lerComoSecretario = await comLogin(page, token, 'GET', '/api/parcerias')
  expect(lerComoSecretario.status(), 'quem aprova também lê').toBe(200)
  for (const [metodo, caminho] of [
    ['POST', '/api/parcerias'],
    ['PATCH', `/api/parcerias/${estado.idA}`],
    ['POST', `/api/parcerias/${estado.idA}/parcelas`],
    ['POST', `/api/parcerias/${estado.idA}/enviar-revisao`],
  ] as const) {
    const r = await comLogin(page, token, metodo, caminho, {})
    expect(r.status(), `${metodo} ${caminho} como Secretário`).toBe(403)
    expect(((await r.json()) as { detail: string }).detail).toBe(
      "Sem permissão 'parcerias'.",
    )
  }
  await sair(page)

  // ---- o 1º Vice-Presidente não tem nem o módulo
  await entrarComo(page, token, 'vice_presidente')
  for (const rota of [
    '/parcerias',
    `/parcerias/${estado.idA}`,
    '/parcerias/nova',
  ]) {
    await page.goto(rota)
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
      `${rota} tem de negar o acesso`,
    ).toBeVisible()
    await expect(page).toHaveURL(/\/403$/)
    await expect(
      page.getByText(/permissão necessária: parcerias/),
    ).toBeVisible()
  }
  await ver(page, info, 'Vice-Presidente barrado nas parcerias')
  const lista = await comLogin(page, token, 'GET', '/api/parcerias')
  expect(lista.status()).toBe(403)
  expect(((await lista.json()) as { detail: string }).detail).toBe(
    'Sem permissão para ver as parcerias e emendas.',
  )
  for (const caminho of [
    `/api/parcerias/${estado.idA}`,
    '/api/parcerias/opcoes',
    `/api/parcerias/${estado.idA}/historico`,
  ]) {
    expect(
      (await comLogin(page, token, 'GET', caminho)).status(),
      `GET ${caminho} sem a permissão`,
    ).toBe(403)
  }
  expect(
    (await comLogin(page, token, 'POST', '/api/parcerias', {})).status(),
  ).toBe(403)
  // o que é público continua público, sem login
  expect((await page.request.get(PUBLICO)).status()).toBe(200)
  await sair(page)

  // ---- o Presidente confere a Auditoria
  await entrarComo(page, token, 'presidente')
  const total = await totalNaAuditoria(page, 'parcerias')
  const esperadas = trilhaA.length + trilhaB.length
  expect(
    total - estado.totalAntes,
    'ações das parcerias desta rodada na Auditoria',
  ).toBe(esperadas)
  // a trilha de cada parceria (a mesma que a tela dela mostra) é exatamente a lista de ações que o roteiro fez, em ordem
  for (const [id, trilha] of [
    [estado.idA, trilhaA],
    [estado.idB, trilhaB],
  ] as const) {
    const r = await comLogin(
      page,
      token,
      'GET',
      `/api/parcerias/${id}/historico`,
    )
    expect(r.status()).toBe(200)
    expect(
      ((await r.json()) as { acao: string }[]).map((e) => e.acao),
      `trilha da parceria ${id}`,
    ).toEqual(trilha)
  }
  // e cada uma está na tela da Auditoria (as 24 mais novas cabem na primeira página de 25)
  expect(esperadas).toBeLessThanOrEqual(25)
  for (const [id, trilha] of [
    [estado.idA, trilhaA],
    [estado.idB, trilhaB],
  ] as const) {
    for (const [acao, quantidade] of contar(trilha)) {
      await expect(
        page
          .getByRole('row')
          .filter({ has: page.getByRole('cell', { name: acao, exact: true }) })
          .filter({
            has: page.getByRole('cell', { name: String(id), exact: true }),
          }),
        `Auditoria: ${acao} da parceria ${id}`,
      ).toHaveCount(quantidade)
    }
  }
  await ver(page, info, 'auditoria das parcerias')

  // as tentativas de aprovar que o sistema recusou (sem a permissão; a própria parceria) também deixaram rastro, na tabela das recusas
  const recusas = await totalNaAuditoria(page, 'recusas')
  expect(
    recusas - estado.recusasAntes,
    'recusas de aprovação desta rodada',
  ).toBe(estado.recusasFeitas)
  await expect(
    page
      .getByRole('row')
      .filter({
        has: page.getByRole('cell', { name: 'RECUSA_APROVACAO', exact: true }),
      })
      .first(),
  ).toBeVisible()
  await ver(
    page,
    info,
    'auditoria: as tentativas de aprovar que foram recusadas',
  )
  expect(vigia.problemas()).toEqual([])
})
