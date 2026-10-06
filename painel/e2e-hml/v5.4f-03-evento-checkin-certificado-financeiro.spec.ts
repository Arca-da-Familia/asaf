import fs from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

import {
  expect,
  test,
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
  inventariar,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4f — EVENTO, segunda metade, ao vivo: crachá e check-in pela portaria (por código, que é o texto do QR), certificado (regra de presença),
// a tela "Documentos emitidos", o financeiro do evento (cobrança, título gerado ao centavo, gratuito, reembolso, fechamento), o painel
// gerencial (inscritos, presentes, vagas, receita) e as exportações com permissão própria. O roteiro cria o SEU projeto, o SEU evento e as
// SUAS pessoas (nomes com a rodada) e não depende de nenhum outro roteiro.
//
// O que este roteiro SABE (lido no código, não suposto):
//  - Não existe tela para inscrever pessoas no evento. Inscrever é: (a) o formulário público do site (`/api/publico/eventos/{id}/inscrever-se`,
//    sem login, devolve o `codigo_checkin` e o valor cobrado; limite de 5 pedidos por IP em 10 minutos, por isso este roteiro faz UM só, em
//    grupo de 3 pessoas) e (b) o autoatendimento do associado logado (`POST /api/eventos/{id}/inscricao`). As duas entradas só são chamadas
//    pela API porque não têm tela no painel (mesma regra do formulário público de filiação da v5.4c).
//  - O código de check-in só existe na inscrição pública; o QR do crachá guarda esse mesmo código, e a portaria aceita o texto do QR no
//    campo de código. O robô não decodifica a imagem do QR dentro do PDF; confere o código pelo mesmo caminho que o QR usa.
//  - A portaria (`/portaria/<token>`) é a tela que registra entrada e saída, sem login: o link é gerado pelo painel e aberto aqui numa janela
//    nova, sem sessão.
//  - O reembolso por cancelamento só roda no cancelamento PÚBLICO, pelo link que vai por e-mail (o token de cancelamento não volta na
//    resposta da inscrição e o painel não tem botão de cancelar com reembolso). O robô não lê e-mail: aqui só se confere a configuração
//    do prazo e do percentual e a Auditoria, e fica registrado que o cálculo do reembolso não é provado ao vivo.
//  - A exportação das inscrições é uma TABELA na tela (não baixa CSV); a das presenças também.
//  - O painel guarda o token da sessão só em memória: para as poucas chamadas diretas à API (recusas que a tela não deixa provocar), o
//    robô reaproveita o cabeçalho de autorização de uma chamada que o próprio painel acabou de fazer.
//
// O que parece DEFEITO do sistema (e não do roteiro) vai para `achados` em vez de derrubar o teste na hora; o último teste lista tudo.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const PRESIDENTE = 'Marta Souza'
const VAGAS = 10
const VALOR = 87.65
const NOME_PROJETO = `Projeto da conferência ${RODADA}`
const TITULO = `Congresso de conferência ${RODADA}`
const P_PRESENTE = `Pessoa Presente ${RODADA}`
const P_AUSENTE = `Pessoa Ausente ${RODADA}`
const P_CANCELADA = `Pessoa Cancelada ${RODADA}`
const CODIGO_CENTRO = `EV-${RODADA}`
const NOME_CENTRO = `Centro do congresso ${RODADA}`
const SECAO_INSCRITOS = 'Inscritos no evento (autoatendimento pelo painel)'
const SECAO_PORTARIA = 'Portaria (check-in sem login)'
const SECAO_ELEGIBILIDADE = 'Elegibilidade, crachá e certificado'
const SECAO_EXPORTAR_PRESENCAS = 'Exportar presença/elegibilidade'
const cpfDa = (n: number) =>
  cpfValido(100_000_000 + ((RODADA + n * 7919) % 190_000_000))

// Estado que atravessa os testes (a ordem é garantida pelo modo serial).
let idProjeto = 0
let idEvento = 0
let idCentro = 0
let idInscricaoMarta = 0
let vagasVazadas = 0
let vagaDevolvidaNoCancelamento = false
const inscricao = {
  presente: { id: 0, codigo: '' },
  ausente: { id: 0, codigo: '' },
  cancelada: { id: 0, codigo: '' },
}
const idPessoa = { presente: 0, ausente: 0 }
let linkPortaria = ''
const docs = {
  crachaPresente: { id: 0, href: '' },
  crachaAusente: { id: 0, href: '' },
  certificado: { id: 0, href: '', codigo: '' },
}
let auditoriaInscricoesAposExportar = 0

// O que o roteiro viu e parece defeito do sistema (um por linha).
const achados: string[] = []

// ------------------------------------------------------------------------------------------------------------------------- apoio local
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

const reais = (valor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    valor,
  )

/** O valor em reais como a tela escreve, em forma de expressão regular (o espaço depois de "R$" é um espaço inseparável). */
const padraoReais = (valor: number): string =>
  reais(valor)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s/g, '\\s')

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

/** A seção da tela do evento pelo título (o `h3` da seção); o container é o `div` mais externo que tem só aquele título. */
function secao(page: Page, titulo: string): Locator {
  return page
    .getByRole('heading', { name: titulo, level: 3, exact: true })
    .locator('xpath=(ancestor::div[count(.//h3)=1])[1]')
}

/** O cartão de uma pessoa dentro de uma seção (a lista de inscritos, o quadro de elegibilidade, a fila de links da portaria). */
const cartaoDe = (escopo: Locator, texto: string): Locator =>
  escopo.locator('div.rounded-md.border.p-2').filter({ hasText: texto })

/**
 * O status que a linha de um inscrito mostra. Não dá para olhar o texto da linha toda: as opções do seletor "Alterar status…" também são texto
 * (uma linha "Cancelado" lista "Pré-inscrito" entre as opções), e o nome das pessoas do roteiro traz "Presente" e "Cancelada".
 */
const statusDe = (linha: Locator): Locator =>
  linha.locator('span.text-muted-foreground').first()

/** Abre a tela do evento do roteiro (o endereço `/eventos?evento=N` abre o evento direto). */
async function abrirEvento(page: Page): Promise<void> {
  await page.goto(`/eventos?evento=${idEvento}`)
  await expect(
    page.getByRole('heading', { name: TITULO, level: 2 }),
  ).toBeVisible()
}

/** Quantas vagas o cabeçalho do evento diz que estão ocupadas (a tela precisa ser recarregada antes: a lista de eventos não se atualiza sozinha). */
async function lerVagas(page: Page): Promise<number> {
  const frase = page.getByText(/\d+\/\d+ vaga\(s\) ocupada\(s\)/).first()
  await expect(frase).toBeVisible()
  const texto = await frase.innerText()
  return Number(/(\d+)\/\d+ vaga/.exec(texto)?.[1] ?? Number.NaN)
}

/** Guarda o cabeçalho de autorização de uma chamada que o painel acabou de fazer, para as poucas chamadas diretas à API (recusas). */
function guardarToken(page: Page) {
  let autorizacao = ''
  page.on('request', (pedido) => {
    const direto = pedido.headers()['authorization']
    if (direto?.startsWith('Bearer ')) autorizacao = direto
    void pedido
      .allHeaders()
      .then((todos) => {
        const completo = todos['authorization']
        if (completo?.startsWith('Bearer ')) autorizacao = completo
      })
      .catch(() => undefined)
  })
  return {
    /** Depois de trocar de pessoa: esquece o token da anterior até o painel fazer uma chamada nova. */
    esquecer: () => {
      autorizacao = ''
    },
    cabecalho: async (): Promise<Record<string, string>> => {
      await expect
        .poll(() => autorizacao, {
          message:
            'o painel ainda não fez nenhuma chamada autenticada para o robô pegar a sessão',
          timeout: 30_000,
        })
        .not.toBe('')
      return { Authorization: autorizacao }
    },
  }
}

type RespostaDaApi = { status: number; json: unknown; texto: string }

async function chamarApi(
  page: Page,
  metodo: 'GET' | 'POST' | 'PUT',
  caminho: string,
  cabecalho: Record<string, string>,
  dados?: object,
): Promise<RespostaDaApi> {
  const resposta = await page.request.fetch(`${API_HML}${caminho}`, {
    method: metodo,
    headers: cabecalho,
    ...(dados === undefined ? {} : { data: dados }),
  })
  const texto = await resposta.text()
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    json = null
  }
  return { status: resposta.status(), json, texto }
}

/** O texto de recusa que o servidor devolveu (`detail`), ou o corpo cru quando não é o formato de sempre. */
function detalhe(resposta: RespostaDaApi): string {
  const d = (resposta.json as { detail?: unknown } | null)?.detail
  return typeof d === 'string' ? d : resposta.texto
}

/** Se a diferença for um defeito, anota (sem derrubar o roteiro). */
function conferir(descricao: string, lido: number, esperado: number): void {
  if (lido !== esperado) {
    achados.push(`${descricao}: esperado ${esperado}, a tela mostrou ${lido}`)
  }
}

// ---- PDF: abre o arquivo, confere o tipo e tenta ler o texto de dentro (o reportlab grava o texto em ASCII85 + Flate)
function ascii85(entrada: string): Buffer {
  const dados = entrada.replace(/\s+/g, '').replace(/^<~/, '').split('~>')[0]
  const saida: number[] = []
  let grupo: number[] = []
  for (const letra of dados ?? '') {
    if (letra === 'z' && grupo.length === 0) {
      saida.push(0, 0, 0, 0)
      continue
    }
    grupo.push(letra.charCodeAt(0) - 33)
    if (grupo.length === 5) {
      let valor = 0
      for (const g of grupo) valor = valor * 85 + g
      saida.push(
        (valor >>> 24) & 255,
        (valor >>> 16) & 255,
        (valor >>> 8) & 255,
        valor & 255,
      )
      grupo = []
    }
  }
  if (grupo.length > 1) {
    const usados = grupo.length
    while (grupo.length < 5) grupo.push(84)
    let valor = 0
    for (const g of grupo) valor = valor * 85 + g
    const bytes = [
      (valor >>> 24) & 255,
      (valor >>> 16) & 255,
      (valor >>> 8) & 255,
      valor & 255,
    ]
    saida.push(...bytes.slice(0, usados - 1))
  }
  return Buffer.from(saida)
}

function textoDoPdf(pdf: Buffer): string {
  const bruto = pdf.toString('latin1')
  const textos: string[] = []
  for (const trecho of bruto.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const dados = (trecho[1] ?? '').trim()
    let conteudo: string
    try {
      conteudo = inflateSync(ascii85(dados)).toString('latin1')
    } catch {
      conteudo = dados.includes('BT') ? dados : ''
    }
    for (const t of conteudo.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      textos.push((t[1] ?? '').replace(/\\([()\\])/g, '$1'))
    }
  }
  return textos.join('\n')
}

/** Abre o endereço do PDF como o navegador abriria: 200, `application/pdf`, começa com `%PDF-`. Devolve o texto de dentro (vazio se não deu para ler). */
async function conferirPdf(page: Page, href: string): Promise<string> {
  const resposta = await page.request.get(href)
  expect(resposta.status(), `abrir ${href}`).toBe(200)
  expect(resposta.headers()['content-type']).toContain('application/pdf')
  const corpo = await resposta.body()
  expect(corpo.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  return textoDoPdf(corpo)
}

/**
 * Inventário da tela atual SEM derrubar o teste: o que faltar de rótulo acessível vai para a lista de achados (e o inventário fica anexado ao
 * relatório do mesmo jeito).
 */
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
    achados.push(`acessibilidade em "${nome}": ${motivo}`)
  }
}

// =====================================================================================================================================
// A. PROJETO E EVENTO
// =====================================================================================================================================
test.describe('A. Projeto e evento do roteiro', () => {
  test('projeto: campos faltando são recusados; o projeto é criado, entra na lista e a Auditoria registra', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'projetos_eventos')
    await page.goto('/projetos')
    await expect(
      page.getByRole('heading', { name: 'Projetos', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Novo projeto' }).click()
    const form = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Criar projeto' }),
    })

    // recusa: nada preenchido (cada falta aparece no seu campo)
    await form.getByRole('button', { name: 'Criar projeto' }).click()
    for (const mensagem of [
      'Informe o nome do projeto.',
      'Informe o foco do projeto.',
      'Informe a data de início.',
      'Informe a data de fim prevista.',
    ]) {
      await expect(
        form.getByRole('alert').filter({ hasText: mensagem }),
      ).toBeVisible()
    }
    await ver(page, info, 'projeto vazio: recusado')

    await form.getByLabel('Nome do projeto', { exact: true }).fill(NOME_PROJETO)
    await form.getByLabel('Foco do projeto', { exact: true }).fill('Social')
    await form.getByLabel('Data de início').fill(diaEmBelem(0).iso)
    await form.getByLabel('Data de fim prevista').fill(diaEmBelem(60).iso)
    const criado = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/projetos/',
    )
    await form.getByRole('button', { name: 'Criar projeto' }).click()
    const resposta = await criado
    expect(resposta.status(), await resposta.text()).toBe(200)
    idProjeto = ((await resposta.json()) as { id_projeto: number }).id_projeto
    await expect(page.getByRole('button', { name: NOME_PROJETO })).toBeVisible()
    await ver(page, info, 'projeto criado na lista')

    expect(await abrirAuditoria(page, 'projetos_eventos')).toBeGreaterThan(
      antes,
    )
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idProjeto,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: projeto criado')
    expect(vigia.problemas()).toEqual([])
  })

  test('evento: vazio, fim antes do início e dado pessoal no título público são recusados; criado com o projeto, 10 vagas, gratuito', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'eventos')
    await page.goto('/eventos')
    await expect(
      page.getByRole('heading', { name: 'Eventos', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Novo evento' }).click()
    const form = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Criar evento' }),
    })
    const categoria = form.locator('select[aria-label="Categoria do evento"]')
    const dia = diaEmBelem(3)

    // recusa 1: nada preenchido
    await form.getByRole('button', { name: 'Criar evento' }).click()
    for (const mensagem of [
      'Informe o título.',
      'Selecione a categoria.',
      'Informe o início do evento.',
    ]) {
      await expect(
        form.getByRole('alert').filter({ hasText: mensagem }),
      ).toBeVisible()
    }
    await ver(page, info, 'evento vazio: recusado')

    // recusa 2: o fim antes do início (o servidor recusa e a frase aparece no alto do formulário)
    await expect(categoria.locator('option').nth(1)).toBeAttached()
    await form.getByPlaceholder('Título do evento').fill(TITULO)
    await categoria.selectOption({ index: 1 })
    await form
      .locator('select[aria-label="Quem pode ver o evento"]')
      .selectOption('Pública')
    await form.getByLabel('Início').fill(`${dia.iso}T09:00`)
    await form.getByLabel('Fim (opcional)').fill(`${dia.iso}T08:00`)
    await form.getByRole('button', { name: 'Criar evento' }).click()
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'O fim do evento precisa ser depois do início.' }),
    ).toBeVisible()
    await ver(page, info, 'evento com fim antes do inicio: recusado')

    // recusa 3: evento Público vai ao site; e-mail de pessoa no título é recusado
    await form.getByLabel('Fim (opcional)').fill(`${dia.iso}T12:00`)
    await form
      .getByPlaceholder('Título do evento')
      .fill(`${TITULO} contato robo@example.org`)
    await form.getByRole('button', { name: 'Criar evento' }).click()
    await expect(
      form.getByRole('alert').filter({
        hasText: "O campo 'título' vai ao site e parece conter dado pessoal",
      }),
    ).toBeVisible()
    await ver(page, info, 'titulo publico com e-mail de pessoa: recusado')

    // certo
    await form.getByPlaceholder('Título do evento').fill(TITULO)
    await form.locator('input[aria-label="Vagas"]').fill(String(VAGAS))
    const opcaoDoProjeto = `${NOME_PROJETO} (nº ${idProjeto})`
    const projetos = form.getByLabel('Projeto (opcional)')
    await expect(
      projetos.locator('option', { hasText: opcaoDoProjeto }),
    ).toBeAttached()
    await projetos.selectOption({ label: opcaoDoProjeto })
    const criado = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/eventos/',
    )
    await form.getByRole('button', { name: 'Criar evento' }).click()
    const resposta = await criado
    expect(resposta.status(), await resposta.text()).toBe(200)
    idEvento = ((await resposta.json()) as { id_evento: number }).id_evento

    const cartaoNaLista = page.getByRole('button', { name: TITULO })
    await expect(cartaoNaLista).toBeVisible()
    await cartaoNaLista.click()
    await expect(
      page.getByRole('heading', { name: TITULO, level: 2 }),
    ).toBeVisible()
    await expect(page.getByText(/Nº do evento:/)).toContainText(
      String(idEvento),
    )
    await expect(
      page.locator('section[aria-label="Contexto do evento"]'),
    ).toContainText(NOME_PROJETO)
    await expect(
      page.getByText(
        new RegExp(
          `Pública · Gratuito · 0/${VAGAS} vaga\\(s\\) ocupada\\(s\\) \\(${VAGAS} livre\\(s\\)\\)`,
        ),
      ),
    ).toBeVisible()
    await ver(page, info, 'evento criado: projeto, vagas e gratuito')

    expect(await abrirAuditoria(page, 'eventos')).toBeGreaterThan(antes)
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idEvento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: evento criado')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// B. FINANCEIRO DO EVENTO
// =====================================================================================================================================
test.describe('B. Financeiro do evento', () => {
  test('centro de custo do evento (código repetido é recusado) e inscrição gratuita: não gera título, ocupa uma vaga, e o repetido é recusado sem gastar vaga', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const api = guardarToken(page)
    await entrar(page, 'presidente')

    // ---- centro de custo, ligado ao evento
    const centrosAntes = await abrirAuditoria(page, 'centros_de_custo')
    await page.goto('/financeiro/centros-custo')
    await expect(
      page.getByRole('heading', { name: 'Centros de Custo', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Novo centro de custo' }).click()
    const form = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Cadastrar', exact: true }),
    })
    await form.getByRole('button', { name: 'Cadastrar', exact: true }).click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'Informe o código.' }),
    ).toBeVisible()
    await expect(
      form.getByRole('alert').filter({ hasText: 'Informe o nome.' }),
    ).toBeVisible()
    await ver(page, info, 'centro de custo vazio: recusado')

    await form.getByPlaceholder('Código').fill(CODIGO_CENTRO)
    await form.getByPlaceholder('Nome').fill(NOME_CENTRO)
    const seletorDoEvento = form.getByTitle(
      'Vincula este centro de custo a um evento (opcional)',
    )
    await expect(
      seletorDoEvento.locator('option', { hasText: TITULO }),
    ).toBeAttached()
    await escolherPorTexto(seletorDoEvento, TITULO)
    const criado = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/centros-custo/',
    )
    await form.getByRole('button', { name: 'Cadastrar', exact: true }).click()
    const resposta = await criado
    expect(resposta.status(), await resposta.text()).toBe(200)
    idCentro = ((await resposta.json()) as { id_centro_custo: number })
      .id_centro_custo
    const cartaoDoCentro = page
      .locator('div.rounded-md.border')
      .filter({ hasText: CODIGO_CENTRO })
    await expect(cartaoDoCentro).toContainText(NOME_CENTRO)
    await expect(cartaoDoCentro).toContainText(`Evento #${idEvento}`)
    await expect(cartaoDoCentro).toContainText('Ativo')
    await ver(page, info, 'centro de custo do evento criado')

    // recusa do servidor: o mesmo código de novo
    await page.getByRole('button', { name: 'Novo centro de custo' }).click()
    const repetido = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Cadastrar', exact: true }),
    })
    await repetido.getByPlaceholder('Código').fill(CODIGO_CENTRO)
    await repetido.getByPlaceholder('Nome').fill(`${NOME_CENTRO} (repetido)`)
    await repetido
      .getByRole('button', { name: 'Cadastrar', exact: true })
      .click()
    await expect(
      repetido
        .getByRole('alert')
        .filter({ hasText: 'Já existe um centro de custo com esse código.' }),
    ).toBeVisible()
    await ver(page, info, 'centro de custo com codigo repetido: recusado')
    await repetido.getByRole('button', { name: 'Cancelar' }).click()

    expect(await abrirAuditoria(page, 'centros_de_custo')).toBe(
      centrosAntes + 1,
    )
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idCentro,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: so o centro certo foi criado')

    // ---- inscrição gratuita (autoatendimento da presidente, que é associada): sem título e uma vaga
    await abrirEvento(page)
    expect(await lerVagas(page)).toBe(0)
    const inscrevendo = await chamarApi(
      page,
      'POST',
      `/api/eventos/${idEvento}/inscricao`,
      await api.cabecalho(),
    )
    expect(inscrevendo.status, inscrevendo.texto).toBe(200)
    idInscricaoMarta = (inscrevendo.json as { id_inscricao: number })
      .id_inscricao
    expect((inscrevendo.json as { status: string }).status).toBe('Pré-inscrito')
    await page.reload()
    expect(await lerVagas(page)).toBe(1)
    await expect(
      statusDe(cartaoDe(secao(page, SECAO_INSCRITOS), PRESIDENTE)),
    ).toHaveText('Pré-inscrito')
    await ver(page, info, 'inscricao gratuita: 1 vaga ocupada')

    // recusa: a mesma pessoa de novo; a recusa não pode gastar vaga
    const repetida = await chamarApi(
      page,
      'POST',
      `/api/eventos/${idEvento}/inscricao`,
      await api.cabecalho(),
    )
    expect(repetida.status).toBe(400)
    expect(detalhe(repetida)).toBe(
      "Esta pessoa já está inscrita neste contexto (status 'Pré-inscrito').",
    )
    await page.reload()
    const depoisDaRecusa = await lerVagas(page)
    if (depoisDaRecusa !== 1) {
      vagasVazadas = depoisDaRecusa - 1
      achados.push(
        `Inscrição repetida (recusada com 400) gasta vaga: o evento mostra ${depoisDaRecusa}/${VAGAS} ocupadas com 1 só inscrito (app/services/vagas.py::inscrever_com_controle_de_vaga reserva a vaga ANTES de o motor recusar a repetida e não devolve)`,
      )
    }
    await ver(page, info, 'inscricao repetida: recusada')

    await abrirAuditoria(page, 'inscricoes')
    await expect(
      linhaDaAuditoria(page, 'INSCRICAO', {
        registro: idInscricaoMarta,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: inscricao gratuita')
    expect(vigia.problemas()).toEqual([])
  })

  test('cobrança: recusas da tela e do servidor; configurada (R$ 87,65, conta de receita, centro de custo) o evento passa a pago, e a Auditoria registra', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const api = guardarToken(page)
    await entrar(page, 'presidente')
    await abrirEvento(page)
    const cobranca = secao(page, 'Cobrança de inscrição')
    await expect(cobranca).toContainText('Atualmente: gratuito.')
    await expect(
      cobranca.getByRole('button', {
        name: 'Tornar evento gratuito (remover cobrança)',
      }),
    ).toBeDisabled()

    // ---- recusas do servidor (a tela só oferece conta de receita e não deixa digitar valor errado: aqui vão direto à API)
    const cabecalho = await api.cabecalho()
    const contas = await chamarApi(page, 'GET', '/api/plano-contas/', cabecalho)
    const plano = contas.json as {
      id_conta: number
      tipo: string
      sintetica: boolean
    }[]
    const contaAtivo = plano.find((c) => c.tipo === 'Ativo' && !c.sintetica)
    const contaReceita = plano.find((c) => c.tipo === 'Receita' && !c.sintetica)
    expect(
      contaAtivo,
      'o plano de contas de teste tem uma conta de Ativo',
    ).toBeTruthy()
    expect(
      contaReceita,
      'o plano de contas de teste tem uma conta de Receita',
    ).toBeTruthy()
    const caminho = `/api/eventos/${idEvento}/cobranca-config`

    const contaErrada = await chamarApi(page, 'PUT', caminho, cabecalho, {
      valor_base: VALOR,
      id_conta_contabil_receita: contaAtivo?.id_conta,
    })
    expect(contaErrada.status).toBe(400)
    expect(detalhe(contaErrada)).toBe(
      "A conta contábil de receita de um evento precisa ser uma conta do tipo Receita (esta é 'Ativo').",
    )
    const valorNegativo = await chamarApi(page, 'PUT', caminho, cabecalho, {
      valor_base: -5,
      id_conta_contabil_receita: contaReceita?.id_conta,
    })
    expect(valorNegativo.status).toBe(422)
    expect(detalhe(valorNegativo)).toBe(
      'Valor base da inscrição precisa ser maior que zero (ou nulo, para evento gratuito).',
    )
    const semConta = await chamarApi(page, 'PUT', caminho, cabecalho, {
      valor_base: VALOR,
    })
    expect(semConta.status).toBe(422)
    expect(detalhe(semConta)).toBe(
      'Informe a conta contábil de receita para cobrar inscrição.',
    )
    const centroInexistente = await chamarApi(page, 'PUT', caminho, cabecalho, {
      valor_base: VALOR,
      id_conta_contabil_receita: contaReceita?.id_conta,
      id_centro_custo: 999_999_999,
    })
    expect(centroInexistente.status).toBe(404)
    expect(detalhe(centroInexistente)).toBe('Centro de custo não encontrado.')
    // valor grande demais para o campo do banco (10 dígitos): a recusa tem que ser 4xx, nunca erro do servidor
    const valorGigante = await chamarApi(page, 'PUT', caminho, cabecalho, {
      valor_base: 99_999_999_999,
      id_conta_contabil_receita: contaReceita?.id_conta,
    })
    if (valorGigante.status >= 500 || valorGigante.status < 400) {
      achados.push(
        `Cobrança com valor de R$ 99.999.999.999 (maior que o campo do banco): o servidor respondeu ${valorGigante.status} em vez de recusar com 4xx (app/services/eventos.py::configurar_cobranca_evento não limita o valor máximo)`,
      )
    }

    // ---- recusas da tela
    const salvar = cobranca.getByRole('button', { name: 'Salvar cobrança' })
    await salvar.click()
    await expect(
      cobranca
        .getByRole('alert')
        .filter({ hasText: 'Informe um valor maior que zero.' }),
    ).toBeVisible()
    await expect(
      cobranca
        .getByRole('alert')
        .filter({ hasText: 'Selecione a conta contábil de receita.' }),
    ).toBeVisible()
    await ver(page, info, 'cobranca vazia: recusada')

    await campo(page, 'Valor da inscrição (R$)').fill(String(VALOR))
    await salvar.click()
    await expect(
      cobranca
        .getByRole('alert')
        .filter({ hasText: 'Selecione a conta contábil de receita.' }),
    ).toBeVisible()
    await expect(
      cobranca
        .getByRole('alert')
        .filter({ hasText: 'Informe um valor maior que zero.' }),
    ).toHaveCount(0)
    await ver(page, info, 'cobranca sem conta de receita: recusada')

    // ---- certo
    const conta = campo(page, 'Conta contábil de receita')
    await expect(conta.locator('option').nth(1)).toBeAttached()
    await conta.selectOption({ index: 1 })
    const centro = campo(page, 'Centro de custo (opcional)')
    await expect(
      centro.locator('option', { hasText: CODIGO_CENTRO }),
    ).toBeAttached()
    await escolherPorTexto(centro, CODIGO_CENTRO)
    const configurando = page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' && new URL(r.url()).pathname === caminho,
    )
    await salvar.click()
    expect((await configurando).status()).toBe(200)
    await expect(cobranca.getByText('Cobrança configurada.')).toBeVisible()
    await expect(cobranca).toContainText('Atualmente: pago.')
    await expect(
      page.getByText(/· Pública · Pago · \d+\/\d+ vaga/),
    ).toBeVisible()
    await ver(page, info, 'cobranca configurada: evento pago')

    await abrirAuditoria(page, 'eventos')
    await expect(
      linhaDaAuditoria(page, 'CONFIGURAR_COBRANCA', {
        registro: idEvento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: cobranca configurada')
    expect(vigia.problemas()).toEqual([])
  })

  test('inscrição pública em grupo de 3: cada pessoa ganha um código e um título de R$ 87,65 (ao centavo); a gratuita não tem título', async ({
    page,
  }, info) => {
    test.setTimeout(600_000)
    const vigia = vigiar(page)
    await entrar(page, 'presidente')

    // o formulário do site: texto de consentimento atual e UM pedido com 3 pessoas (o limite é de 5 pedidos por IP em 10 minutos)
    const consentimento = await chamarApi(
      page,
      'GET',
      '/api/publico/eventos/consentimento-lgpd',
      {},
    )
    expect(consentimento.status).toBe(200)
    const versao = (consentimento.json as { versao: string }).versao
    const corpo = {
      nome_completo: P_PRESENTE,
      cpf: cpfDa(1),
      email: `robo${RODADA}@homologacao.example.com`,
      telefone: '91988887777',
      respostas: {},
      participantes_adicionais: [
        { nome_completo: P_AUSENTE, cpf: cpfDa(2) },
        { nome_completo: P_CANCELADA, cpf: cpfDa(3) },
      ],
      consentimento_lgpd: true,
      versao_texto_consentimento: versao,
    }
    let inscrevendo: RespostaDaApi | null = null
    for (let tentativa = 1; tentativa <= 7; tentativa += 1) {
      inscrevendo = await chamarApi(
        page,
        'POST',
        `/api/publico/eventos/${idEvento}/inscrever-se`,
        {},
        corpo,
      )
      if (inscrevendo.status !== 429) break
      // outro roteiro gastou o limite de pedidos deste endereço: espera a janela de 10 minutos andar
      await page.waitForTimeout(70_000)
    }
    expect(inscrevendo?.status, inscrevendo?.texto).toBe(200)
    const participantes = (
      inscrevendo?.json as {
        participantes: {
          nome_completo: string
          id_inscricao: number
          status: string
          codigo_checkin: string | null
          valor_cobrado: number | null
        }[]
      }
    ).participantes
    expect(participantes).toHaveLength(3)
    for (const p of participantes) {
      expect(p.status, p.nome_completo).toBe('Pré-inscrito')
      expect(p.codigo_checkin).toMatch(/^[0-9A-F]{8}$/)
      expect(p.valor_cobrado, `valor cobrado de ${p.nome_completo}`).toBe(VALOR)
    }
    expect(new Set(participantes.map((p) => p.codigo_checkin)).size).toBe(3)
    const [um, dois, tres] = participantes
    inscricao.presente = {
      id: um?.id_inscricao ?? 0,
      codigo: um?.codigo_checkin ?? '',
    }
    inscricao.ausente = {
      id: dois?.id_inscricao ?? 0,
      codigo: dois?.codigo_checkin ?? '',
    }
    inscricao.cancelada = {
      id: tres?.id_inscricao ?? 0,
      codigo: tres?.codigo_checkin ?? '',
    }

    // a tela do evento: 4 ocupadas (a presidente + 3), todos pré-inscritos
    await abrirEvento(page)
    conferir(
      'Vagas depois da inscrição em grupo (1 gratuita + 3 do grupo)',
      await lerVagas(page),
      4 + vagasVazadas,
    )
    const inscritos = secao(page, SECAO_INSCRITOS)
    for (const nome of [P_PRESENTE, P_AUSENTE, P_CANCELADA]) {
      await expect(statusDe(cartaoDe(inscritos, nome))).toHaveText(
        'Pré-inscrito',
      )
    }
    await ver(page, info, 'inscricao em grupo: tres pre-inscritos')

    // o financeiro: um título "A Receber" por pessoa, de R$ 87,65; a inscrição gratuita não gerou nenhum
    await page.goto('/financeiro/titulos')
    await expect(
      page.getByRole('heading', { name: 'Títulos', level: 1 }),
    ).toBeVisible()
    const cartoes = page.locator('div.rounded-md.border')
    await expect(
      cartoes.first().or(page.getByText('Nenhum título encontrado.')),
    ).toBeVisible()
    for (const nome of [P_PRESENTE, P_AUSENTE, P_CANCELADA]) {
      const titulo = cartoes.filter({ hasText: `Inscrição de ${nome}` })
      await expect(titulo, `título de ${nome}`).toHaveCount(1)
      await expect(titulo).toContainText('A Receber')
      await expect(titulo).toContainText('Pendente')
      await expect(titulo).toContainText(
        new RegExp(
          `Original ${padraoReais(VALOR)} · Saldo ${padraoReais(VALOR)}`,
        ),
      )
    }
    await expect(cartoes.filter({ hasText: `em '${TITULO}'` })).toHaveCount(3)
    await ver(page, info, 'tres titulos de R$ 87,65 gerados pela inscricao')

    // Auditoria: o rastro de cada inscrição pública (sem usuário: é o formulário do site)
    await abrirAuditoria(page, 'inscricoes')
    for (const dados of Object.values(inscricao)) {
      await expect(
        linhaDaAuditoria(page, 'INSCRICAO_PUBLICA', { registro: dados.id }),
      ).toBeVisible()
    }
    await ver(page, info, 'auditoria: inscricoes publicas')
    expect(vigia.problemas()).toEqual([])
  })

  test('gratuito e reembolso: tornar gratuito e voltar a pago; recusas da política de reembolso; prazo e percentual salvos; o servidor também tem que recusar o valor impossível', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const api = guardarToken(page)
    await entrar(page, 'presidente')
    await abrirEvento(page)
    const cobranca = secao(page, 'Cobrança de inscrição')

    // ---- gratuito: remover a cobrança e voltar a cobrar
    await expect(cobranca).toContainText('Atualmente: pago.')
    await cobranca
      .getByRole('button', {
        name: 'Tornar evento gratuito (remover cobrança)',
      })
      .click()
    await expect(cobranca).toContainText('Atualmente: gratuito.')
    await expect(
      page.getByText(/· Pública · Gratuito · \d+\/\d+ vaga/),
    ).toBeVisible()
    await expect(
      cobranca.getByRole('button', {
        name: 'Tornar evento gratuito (remover cobrança)',
      }),
    ).toBeDisabled()
    await ver(page, info, 'evento tornado gratuito')

    await campo(page, 'Valor da inscrição (R$)').fill(String(VALOR))
    const conta = campo(page, 'Conta contábil de receita')
    await expect(conta.locator('option').nth(1)).toBeAttached()
    await conta.selectOption({ index: 1 })
    await escolherPorTexto(
      campo(page, 'Centro de custo (opcional)'),
      CODIGO_CENTRO,
    )
    await cobranca.getByRole('button', { name: 'Salvar cobrança' }).click()
    await expect(cobranca).toContainText('Atualmente: pago.')
    await expect(
      page.getByText(/· Pública · Pago · \d+\/\d+ vaga/),
    ).toBeVisible()
    await ver(page, info, 'evento voltou a ser pago')

    // ---- o servidor também tem que recusar o que a tela já recusa (percentual maior que 100, prazo negativo, número grande demais)
    const cabecalho = await api.cabecalho()
    const caminho = `/api/eventos/${idEvento}/reembolso-config`
    const percentualAlto = await chamarApi(page, 'PUT', caminho, cabecalho, {
      prazo_cancelamento_horas: 48,
      percentual_reembolso_cancelamento: 150,
    })
    if (percentualAlto.status < 400) {
      achados.push(
        `Reembolso de 150%: o servidor aceitou (${percentualAlto.status}); a tela recusa acima de 100%, a API não (app/routers/eventos.py::configurar_reembolso_evento_endpoint não valida o percentual)`,
      )
    }
    const prazoNegativo = await chamarApi(page, 'PUT', caminho, cabecalho, {
      prazo_cancelamento_horas: -5,
      percentual_reembolso_cancelamento: 50,
    })
    if (prazoNegativo.status < 400) {
      achados.push(
        `Prazo de cancelamento de -5 horas: o servidor aceitou (${prazoNegativo.status}) (app/routers/eventos.py::configurar_reembolso_evento_endpoint não valida o prazo)`,
      )
    }
    const percentualGigante = await chamarApi(page, 'PUT', caminho, cabecalho, {
      prazo_cancelamento_horas: 48,
      percentual_reembolso_cancelamento: 100_000,
    })
    if (percentualGigante.status >= 500 || percentualGigante.status < 400) {
      achados.push(
        `Reembolso de 100000%: o servidor respondeu ${percentualGigante.status} em vez de recusar com 4xx (campo numérico do banco estoura; app/routers/eventos.py::configurar_reembolso_evento_endpoint)`,
      )
    }

    // ---- recusas da tela
    await abrirEvento(page)
    const reembolso = secao(page, 'Política de reembolso por cancelamento')
    const salvar = reembolso.getByRole('button', { name: 'Salvar política' })
    const usarPadrao = reembolso.getByLabel('Usar percentual padrão do sistema')
    await expect(usarPadrao).toBeChecked()
    await usarPadrao.uncheck()
    const percentual = campo(page, 'Percentual de reembolso (%)')
    await expect(percentual).toBeVisible()
    await salvar.click()
    await expect(
      reembolso.getByRole('alert').filter({
        hasText:
          'Informe o percentual de reembolso, ou marque "usar padrão do sistema".',
      }),
    ).toBeVisible()
    await ver(page, info, 'reembolso sem percentual: recusado')
    await percentual.fill('150')
    await salvar.click()
    await expect(
      reembolso
        .getByRole('alert')
        .filter({ hasText: 'Informe um percentual entre 0 e 100.' }),
    ).toBeVisible()
    await percentual.fill('50')
    await campo(page, 'Prazo de cancelamento (horas)').fill('-1')
    await salvar.click()
    await expect(
      reembolso
        .getByRole('alert')
        .filter({ hasText: 'Informe um prazo válido, em horas.' }),
    ).toBeVisible()
    await ver(page, info, 'reembolso com prazo negativo: recusado')

    // ---- certo: 48 horas de prazo e 50% fora do prazo
    await campo(page, 'Prazo de cancelamento (horas)').fill('48')
    const configurando = page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' && new URL(r.url()).pathname === caminho,
    )
    await salvar.click()
    expect((await configurando).status()).toBe(200)
    await expect(
      reembolso.getByText('Política de reembolso atualizada.'),
    ).toBeVisible()
    await ver(
      page,
      info,
      'politica de reembolso salva: 48 horas e 50 por cento',
    )
    info.annotations.push({
      type: 'limite do roteiro',
      description:
        'O percentual de reembolso (100% dentro do prazo, 50% fora) só é aplicado no cancelamento pelo link público enviado por e-mail; o robô não lê e-mail, então o cálculo não é provado ao vivo, só a configuração e a Auditoria.',
    })

    await abrirAuditoria(page, 'eventos')
    await expect(
      linhaDaAuditoria(page, 'CONFIGURAR_REEMBOLSO', {
        registro: idEvento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CONFIGURAR_COBRANCA', {
        registro: idEvento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: reembolso e cobranca')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// C. INSCRITOS
// =====================================================================================================================================
test.describe('C. Inscritos do evento', () => {
  test('lista, busca e filtro; cancelar pelo painel muda o status (e uma tela desatualizada é recusada pelo servidor); a vaga tem que voltar', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await abrirEvento(page)
    const inscritos = secao(page, SECAO_INSCRITOS)
    const linhas = inscritos.locator('div.rounded-md.border.p-2')
    await expect(linhas).toHaveCount(4)
    for (const nome of [PRESIDENTE, P_PRESENTE, P_AUSENTE, P_CANCELADA]) {
      await expect(statusDe(cartaoDe(inscritos, nome))).toHaveText(
        'Pré-inscrito',
      )
    }
    await ver(page, info, 'inscritos: quatro pre-inscritos')

    // busca por nome e filtro de status
    await inscritos.getByPlaceholder('Buscar por nome…').fill(P_PRESENTE)
    await expect(linhas).toHaveCount(1)
    await expect(linhas.first()).toContainText(P_PRESENTE)
    await inscritos.getByPlaceholder('Buscar por nome…').fill('')
    await expect(linhas).toHaveCount(4)
    await inscritos.locator('select').first().selectOption('Cancelado')
    await expect(
      inscritos.getByText('Nenhuma inscrição encontrada.'),
    ).toBeVisible()
    await inscritos.locator('select').first().selectOption('')
    await expect(linhas).toHaveCount(4)

    // a segunda aba é aberta ANTES do cancelamento: guarda a tela "desatualizada" para a transição inválida
    const aba2 = await page.context().newPage()
    const vigia2 = vigiar(aba2)
    await aba2.goto(`/eventos?evento=${idEvento}`)
    const inscritos2 = secao(aba2, SECAO_INSCRITOS)
    await expect(statusDe(cartaoDe(inscritos2, P_CANCELADA))).toHaveText(
      'Pré-inscrito',
    )

    // cancelar pelo painel
    const vagasAntes = await lerVagas(page)
    const linhaDaCancelada = cartaoDe(inscritos, P_CANCELADA)
    await linhaDaCancelada.locator('select').selectOption('Cancelado')
    await expect(statusDe(linhaDaCancelada)).toHaveText('Cancelado')
    await expect(linhaDaCancelada.locator('select option')).toHaveText([
      'Alterar status…',
      'Pré-inscrito',
    ])
    await inscritos.locator('select').first().selectOption('Cancelado')
    await expect(linhas).toHaveCount(1)
    await expect(linhas.first()).toContainText(P_CANCELADA)
    await ver(page, info, 'inscrita cancelada pelo painel')
    await inscritos.locator('select').first().selectOption('')

    // a tela desatualizada ainda oferece "Confirmado": o servidor recusa a transição
    await cartaoDe(inscritos2, P_CANCELADA)
      .locator('select')
      .selectOption('Confirmado')
    await expect(
      inscritos2.getByText(
        "Não é possível mudar de 'Cancelado' para 'Confirmado'.",
      ),
    ).toBeVisible()
    await ver(aba2, info, 'tela desatualizada: transicao invalida recusada')
    await aba2.close()

    // a vaga da pessoa cancelada tem que voltar para o evento
    await page.reload()
    const vagasDepois = await lerVagas(page)
    vagaDevolvidaNoCancelamento = vagasDepois === vagasAntes - 1
    if (!vagaDevolvidaNoCancelamento) {
      achados.push(
        `Cancelar a inscrição pelo painel não devolve a vaga: ${vagasAntes}/${VAGAS} ocupadas antes e ${vagasDepois}/${VAGAS} depois de cancelar uma pessoa (app/routers/motores.py::alterar_status_inscricao_endpoint chama só alterar_status; só o cancelamento público libera a vaga e promove a lista de espera)`,
      )
    }
    await expect(
      statusDe(cartaoDe(secao(page, SECAO_INSCRITOS), P_CANCELADA)),
    ).toHaveText('Cancelado')
    await ver(page, info, 'vagas depois do cancelamento')

    await abrirAuditoria(page, 'inscricoes')
    await expect(
      linhaDaAuditoria(page, 'UPDATE', {
        registro: inscricao.cancelada.id,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: cancelamento pelo painel')
    expect(vigia.problemas()).toEqual([])
    expect(vigia2.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// D. CRACHÁ E PORTARIA (CHECK-IN / CHECK-OUT)
// =====================================================================================================================================
test.describe('D. Crachá e portaria', () => {
  test('modelos de documento (cadastrados se faltarem) e crachá: emitido para quem se inscreveu, o PDF abre, quem cancelou não aparece', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const api = guardarToken(page)
    await entrar(page, 'presidente')

    const modelosCarregados = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname === '/api/templates-documento/',
    )
    await page.goto(`/eventos?evento=${idEvento}`)
    const modelos = (await (await modelosCarregados).json()) as {
      codigo: string
    }[]
    await expect(
      page.getByRole('heading', { name: TITULO, level: 2 }),
    ).toBeVisible()
    const eleg = secao(page, SECAO_ELEGIBILIDADE)
    await expect(eleg).toBeVisible()

    // ---- os dois modelos (o motor só cria; um modelo já existente de outra rodada serve)
    const aCadastrar = [
      {
        codigo: 'CRACHA_EVENTO',
        rotulo: 'Crachá de evento',
        texto:
          'CRACHA DE PARTICIPANTE\n{{nome_completo}}\n{{titulo_evento}} - {{data_evento}}',
      },
      {
        codigo: 'CERTIFICADO_EVENTO',
        rotulo: 'Certificado de participação em evento',
        texto:
          'CERTIFICADO DE PARTICIPACAO\n{{nome_completo}}\nparticipou de {{titulo_evento}} em {{data_evento}}, com carga horaria de {{carga_horaria_horas}} horas.',
      },
    ].filter((m) => !modelos.some((existente) => existente.codigo === m.codigo))
    for (const modelo of aCadastrar) {
      const cartao = eleg.locator('div.rounded-md.border').filter({
        hasText: `Modelo de "${modelo.rotulo}" ainda não cadastrado`,
      })
      await expect(cartao).toBeVisible()
      // recusa: sem o texto do documento
      await cartao.getByRole('button', { name: 'Cadastrar modelo' }).click()
      await expect(
        cartao
          .getByRole('alert')
          .filter({ hasText: 'Informe o texto do documento.' }),
      ).toBeVisible()
      await ver(page, info, `modelo ${modelo.codigo} sem texto: recusado`)
      await cartao.locator('textarea').fill(modelo.texto)
      const criando = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname === '/api/templates-documento/',
      )
      await cartao.getByRole('button', { name: 'Cadastrar modelo' }).click()
      const resposta = await criando
      expect(resposta.status(), await resposta.text()).toBe(200)
      await expect(cartao).toHaveCount(0)
      const idModelo = ((await resposta.json()) as { id_template: number })
        .id_template
      await abrirAuditoria(page, 'templates_documento')
      await expect(
        linhaDaAuditoria(page, 'CREATE', {
          registro: idModelo,
          quem: PRESIDENTE,
        }),
      ).toBeVisible()
      await abrirEvento(page)
    }
    await expect(eleg.getByText(/ainda não cadastrado/)).toHaveCount(0)

    // ---- as pessoas do quadro: quem cancelou não entra; a tela diz que a elegibilidade ainda não pode ser calculada
    const presente = cartaoDe(eleg, P_PRESENTE)
    const ausente = cartaoDe(eleg, P_AUSENTE)
    await expect(presente).toBeVisible()
    await expect(ausente).toBeVisible()
    await expect(cartaoDe(eleg, PRESIDENTE)).toBeVisible()
    await expect(eleg.getByText(P_CANCELADA)).toHaveCount(0)
    await expect(presente).toContainText(
      'Elegibilidade indisponível — evento sem carga horária nem sessões configuradas.',
    )
    await ver(
      page,
      info,
      'quadro de elegibilidade: indisponivel, sem a cancelada',
    )
    await inventariarSemTravar(page, info, 'evento-detalhe')

    // ---- crachá: não depende de elegibilidade; o PDF abre
    async function emitirCracha(
      cartaoDaPessoa: Locator,
      nome: string,
    ): Promise<{ id: number; href: string }> {
      const emitindo = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /\/api\/eventos\/\d+\/crachas\/\d+$/.test(new URL(r.url()).pathname),
      )
      await cartaoDaPessoa
        .getByRole('button', { name: 'Emitir crachá' })
        .click()
      const resposta = await emitindo
      expect(resposta.status(), await resposta.text()).toBe(200)
      const dados = (await resposta.json()) as {
        id_documento: number
        caminho_arquivo: string
      }
      const link = cartaoDaPessoa.getByRole('link', {
        name: 'Crachá emitido — baixar PDF',
      })
      await expect(link).toBeVisible()
      await expect(link).toHaveAttribute('target', '_blank')
      const href = (await link.getAttribute('href')) ?? ''
      expect(href.endsWith(dados.caminho_arquivo), nome).toBe(true)
      expect(dados.caminho_arquivo).toMatch(
        /^\/uploads\/documentos\/[0-9a-f]{32}\.pdf$/,
      )
      const texto = await conferirPdf(page, href)
      if (texto && !texto.includes('emitido pelo sistema ASAF')) {
        achados.push(
          `Crachá de ${nome}: o texto do PDF não traz o rodapé "emitido pelo sistema ASAF" (ou o robô não leu o PDF direito)`,
        )
      }
      if (texto && !texto.includes(nome)) {
        achados.push(
          `Crachá de ${nome}: o nome da pessoa não aparece no texto do PDF (o modelo de crachá usado não tem {{nome_completo}}, ou o PDF sai sem o nome)`,
        )
      }
      return { id: dados.id_documento, href }
    }
    docs.crachaPresente = await emitirCracha(presente, P_PRESENTE)
    await ver(page, info, 'cracha da pessoa presente emitido')
    docs.crachaAusente = await emitirCracha(ausente, P_AUSENTE)
    await ver(page, info, 'cracha da pessoa ausente emitido')
    expect(docs.crachaAusente.href).not.toBe(docs.crachaPresente.href)

    // ---- recusa do servidor: pessoa que não existe
    const cabecalho = await api.cabecalho()
    const semPessoa = await chamarApi(
      page,
      'POST',
      `/api/eventos/${idEvento}/crachas/999999999`,
      cabecalho,
    )
    expect(semPessoa.status).toBe(404)
    expect(detalhe(semPessoa)).toBe('Pessoa não encontrada.')

    await abrirAuditoria(page, 'documentos_emitidos')
    for (const cracha of [docs.crachaPresente, docs.crachaAusente]) {
      await expect(
        linhaDaAuditoria(page, 'EMITIR_CRACHA', {
          registro: cracha.id,
          quem: PRESIDENTE,
        }),
      ).toBeVisible()
    }
    await ver(page, info, 'auditoria: crachas emitidos')
    expect(vigia.problemas()).toEqual([])
  })

  test('portaria: o link é gerado pela tela (recusas), abre SEM login; check-in e check-out por código (o texto do QR) com as recusas do servidor; Auditoria', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    const tokensAntes = await abrirAuditoria(page, 'tokens_portaria')
    const presencasAntes = await abrirAuditoria(page, 'registros_presenca')
    await abrirEvento(page)
    const portariaDoEvento = secao(page, SECAO_PORTARIA)
    await expect(portariaDoEvento).toBeVisible()
    const gerar = portariaDoEvento.getByRole('button', {
      name: 'Gerar link da portaria',
    })
    const validade = portariaDoEvento.getByPlaceholder('Validade (horas)')

    // recusa 1: validade zero (a tela mostra no resumo "Corrija para continuar")
    await validade.fill('0')
    await gerar.click()
    await expect(
      portariaDoEvento
        .getByRole('alert')
        .filter({ hasText: 'Informe ao menos 1 hora de validade.' }),
    ).toBeVisible()
    await ver(page, info, 'link da portaria com validade zero: recusado')
    // recusa 2: validade maior que 30 dias (o servidor recusa)
    await validade.fill('1000')
    await gerar.click()
    await expect(
      portariaDoEvento.getByRole('alert').filter({
        hasText: 'Validade do token deve ser entre 1 hora e 30 dias.',
      }),
    ).toBeVisible()
    await ver(page, info, 'link da portaria com 1000 horas: recusado')

    // certo
    await validade.fill('48')
    await portariaDoEvento
      .getByPlaceholder('Descrição (ex.: entrada principal)')
      .fill(`Entrada principal ${RODADA}`)
    await gerar.click()
    const link = portariaDoEvento.getByRole('link', { name: /\/portaria\// })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    linkPortaria = (await link.getAttribute('href')) ?? ''
    expect(linkPortaria).toMatch(/\/portaria\/[^/]+$/)
    await expect(portariaDoEvento.locator('svg').first()).toBeVisible()
    await expect(
      cartaoDe(portariaDoEvento, `Entrada principal ${RODADA}`),
    ).toContainText('expira em')
    await ver(page, info, 'link e QR da portaria gerados')
    expect(await abrirAuditoria(page, 'tokens_portaria')).toBe(tokensAntes + 1)
    await expect(
      linhaDaAuditoria(page, 'CREATE', { quem: PRESIDENTE }),
    ).toBeVisible()

    // ---- a portaria, numa janela nova e SEM login
    const janela = await browser.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Belem',
      viewport: { width: 1366, height: 900 },
    })
    try {
      const portaria = await janela.newPage()
      const vigiaPortaria = vigiar(portaria)
      await portaria.goto(linkPortaria)
      await expect(
        portaria.getByRole('heading', { name: TITULO, level: 1 }),
      ).toBeVisible()
      await expect(portaria.getByRole('button', { name: 'Sair' })).toHaveCount(
        0,
      )
      await expect(portaria.getByText('Conectado')).toBeVisible()
      await expect(portaria.getByText('Tudo sincronizado')).toBeVisible()
      await ver(portaria, info, 'portaria aberta sem login')
      await inventariarSemTravar(portaria, info, 'portaria')

      const cartao = portaria
        .locator('div.rounded-md.border')
        .filter({ hasText: 'Método:' })
      async function agir(
        acao: 'checkin' | 'checkout',
        valor: string,
        metodo: 'codigo' | 'carteirinha' = 'codigo',
      ): Promise<void> {
        await portaria
          .getByRole('button', {
            name: acao === 'checkin' ? 'Check-in' : 'Check-out',
            exact: true,
          })
          .click()
        await portaria
          .getByRole('button', {
            name: metodo === 'codigo' ? 'Código' : 'Carteirinha',
            exact: true,
          })
          .click()
        await portaria.locator('#valor-portaria').fill(valor)
        await portaria
          .getByRole('button', {
            name:
              acao === 'checkin' ? 'Registrar check-in' : 'Registrar check-out',
            exact: true,
          })
          .click()
      }
      async function esperar(
        acao: 'Check-in' | 'Check-out',
        valor: string,
        estado: string | RegExp,
      ): Promise<void> {
        await expect(cartao).toContainText(`${acao} registrado às`)
        await expect(cartao).toContainText(valor)
        await expect(cartao).toContainText(estado)
      }

      // recusa 1: código que não existe
      await agir('checkin', 'ZZZZZZZZ')
      await esperar(
        'Check-in',
        'ZZZZZZZZ',
        'Recusado pelo servidor: Código de check-in não encontrado.',
      )
      const primeiraLinha = await cartao.locator('p.font-medium').innerText()
      if (/Check-in registrado/.test(primeiraLinha)) {
        achados.push(
          'Portaria: um check-in RECUSADO pelo servidor aparece com o título "Check-in registrado às ..." (PortariaGate.tsx, CartaoConfirmacao: o título só olha o tipo da ação, não o status; quem opera lê "registrado" e deixa entrar)',
        )
      }
      await ver(portaria, info, 'portaria: codigo inexistente recusado')
      // recusa 2: inscrição cancelada
      await agir('checkin', inscricao.cancelada.codigo)
      await esperar(
        'Check-in',
        inscricao.cancelada.codigo,
        'Recusado pelo servidor: Esta inscrição foi cancelada - check-in recusado.',
      )
      await ver(portaria, info, 'portaria: inscricao cancelada recusada')
      // recusa 3: carteirinha que não vale
      await agir('checkin', 'token-invalido-do-robo', 'carteirinha')
      await esperar(
        'Check-in',
        'token-invalido-do-robo',
        'Recusado pelo servidor: Carteirinha inválida ou expirada.',
      )
      await ver(portaria, info, 'portaria: carteirinha invalida recusada')
      // recusa 4: saída de quem nunca entrou
      await agir('checkout', inscricao.ausente.codigo)
      await esperar(
        'Check-out',
        inscricao.ausente.codigo,
        'Recusado pelo servidor: Não há check-in em aberto para esta pessoa neste contexto.',
      )
      await ver(portaria, info, 'portaria: saida sem entrada recusada')

      // certo: entrada de quem vai ficar presente
      await agir('checkin', inscricao.presente.codigo)
      await esperar(
        'Check-in',
        inscricao.presente.codigo,
        'Sincronizado com o servidor.',
      )
      await ver(portaria, info, 'portaria: check-in da pessoa presente')
      // recusa 5: entrar de novo sem ter saído
      await agir('checkin', inscricao.presente.codigo)
      await esperar(
        'Check-in',
        inscricao.presente.codigo,
        'Recusado pelo servidor: Já existe um registro de presença em aberto (sem saída) para esta pessoa neste contexto.',
      )
      await ver(portaria, info, 'portaria: check-in repetido recusado')
      // saída (pelo campo de código, o mesmo texto do QR)
      await agir('checkout', inscricao.presente.codigo)
      await esperar(
        'Check-out',
        inscricao.presente.codigo,
        'Sincronizado com o servidor.',
      )
      await ver(portaria, info, 'portaria: check-out da pessoa presente')
      // recusa 6: sair de novo
      await agir('checkout', inscricao.presente.codigo)
      await esperar(
        'Check-out',
        inscricao.presente.codigo,
        'Recusado pelo servidor: Não há check-in em aberto para esta pessoa neste contexto.',
      )
      await ver(portaria, info, 'portaria: check-out repetido recusado')
      expect(vigiaPortaria.problemas()).toEqual([])
    } finally {
      await janela.close()
    }

    // ---- de volta ao painel: a pessoa presente está Presente (estado final), a ausente continua pré-inscrita
    await abrirEvento(page)
    const inscritos = secao(page, SECAO_INSCRITOS)
    const presenteNaLista = cartaoDe(inscritos, P_PRESENTE)
    await expect(statusDe(presenteNaLista)).toHaveText('Presente')
    await expect(presenteNaLista).toContainText('(final)')
    await expect(statusDe(cartaoDe(inscritos, P_AUSENTE))).toHaveText(
      'Pré-inscrito',
    )
    await expect(statusDe(cartaoDe(inscritos, P_CANCELADA))).toHaveText(
      'Cancelado',
    )
    await ver(page, info, 'inscritos depois da portaria')

    // Auditoria: só o que deu certo deixa rastro (uma entrada e uma saída); as seis recusas não gravam nada
    expect(await abrirAuditoria(page, 'registros_presenca')).toBe(
      presencasAntes + 2,
    )
    await expect(linhaDaAuditoria(page, 'CHECKIN_PORTARIA')).toBeVisible()
    await expect(linhaDaAuditoria(page, 'CHECKOUT_PORTARIA')).toBeVisible()
    await ver(page, info, 'auditoria: entrada e saida da portaria')
    expect(vigia.problemas()).toEqual([])
  })

  test('portaria: link revogado e link inválido mostram a tela de link inválido; o outro link continua valendo', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    const revogacoesAntes = await abrirAuditoria(page, 'tokens_portaria')
    await abrirEvento(page)
    const portariaDoEvento = secao(page, SECAO_PORTARIA)
    await portariaDoEvento
      .getByPlaceholder('Descrição (ex.: entrada principal)')
      .fill(`Entrada reserva ${RODADA}`)
    await portariaDoEvento
      .getByRole('button', { name: 'Gerar link da portaria' })
      .click()
    const link = portariaDoEvento.getByRole('link', { name: /\/portaria\// })
    await expect(link).toBeVisible()
    const linkReserva = (await link.getAttribute('href')) ?? ''
    expect(linkReserva).not.toBe(linkPortaria)
    const reserva = cartaoDe(portariaDoEvento, `Entrada reserva ${RODADA}`)
    await expect(reserva).toBeVisible()
    await reserva.getByRole('button', { name: 'Revogar' }).click()
    await expect(reserva).toContainText('REVOGADO')
    await expect(reserva.getByRole('button', { name: 'Revogar' })).toHaveCount(
      0,
    )
    await ver(page, info, 'link da portaria revogado')

    const janela = await browser.newContext({
      locale: 'pt-BR',
      viewport: { width: 1366, height: 900 },
    })
    try {
      const outra = await janela.newPage()
      await outra.goto(linkReserva)
      await expect(
        outra.getByRole('heading', { name: 'Link da portaria inválido' }),
      ).toBeVisible()
      await expect(
        outra.getByText('Este link expirou, foi revogado ou está incorreto.'),
      ).toBeVisible()
      await ver(outra, info, 'portaria: link revogado')

      await outra.goto(`${new URL(linkReserva).origin}/portaria/token-invalido`)
      await expect(
        outra.getByRole('heading', { name: 'Link da portaria inválido' }),
      ).toBeVisible()
      await ver(outra, info, 'portaria: link que nao existe')

      // o primeiro link, que não foi revogado, continua abrindo o evento
      await outra.goto(linkPortaria)
      await expect(
        outra.getByRole('heading', { name: TITULO, level: 1 }),
      ).toBeVisible()
    } finally {
      await janela.close()
    }

    expect(await abrirAuditoria(page, 'tokens_portaria')).toBe(
      revogacoesAntes + 2,
    )
    await expect(
      linhaDaAuditoria(page, 'REVOGAR', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: link criado e revogado')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// E. CERTIFICADO (REGRA DE PRESENÇA)
// =====================================================================================================================================
test.describe('E. Certificado', () => {
  test('certificado: sem carga horária não há cálculo; quem faltou é recusado (mensagem real), quem esteve presente recebe, o PDF abre com o nome e a verificação pública confirma', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const api = guardarToken(page)
    await entrar(page, 'presidente')
    const antesDaConfiguracao = await abrirAuditoria(page, 'eventos')
    await abrirEvento(page)
    const eleg = secao(page, SECAO_ELEGIBILIDADE)
    const presente = cartaoDe(eleg, P_PRESENTE)
    const ausente = cartaoDe(eleg, P_AUSENTE)
    const emitir = (cartaoDaPessoa: Locator) =>
      cartaoDaPessoa.getByRole('button', { name: 'Emitir certificado' })
    const salvarConfiguracao = eleg.getByRole('button', {
      name: 'Salvar configuração',
    })
    const caminhoConfig = `/api/eventos/${idEvento}/elegibilidade-config`

    // ---- 1. sem carga horária nem sessões: a tela não calcula e não deixa emitir; o servidor também recusa
    await expect(presente).toContainText('Elegibilidade indisponível')
    await expect(emitir(presente)).toBeDisabled()
    await expect(emitir(ausente)).toBeDisabled()
    await ver(page, info, 'certificado: elegibilidade indisponivel')
    const cabecalho = await api.cabecalho()
    const quadro = await chamarApi(
      page,
      'GET',
      `/api/eventos/${idEvento}/elegibilidade`,
      cabecalho,
    )
    expect(quadro.status).toBe(200)
    const pessoas = quadro.json as {
      id_pessoa: number
      nome_completo: string
    }[]
    idPessoa.presente =
      pessoas.find((p) => p.nome_completo === P_PRESENTE)?.id_pessoa ?? 0
    idPessoa.ausente =
      pessoas.find((p) => p.nome_completo === P_AUSENTE)?.id_pessoa ?? 0
    expect(idPessoa.presente).toBeGreaterThan(0)
    expect(idPessoa.ausente).toBeGreaterThan(0)
    const semCalculo = await chamarApi(
      page,
      'POST',
      `/api/eventos/${idEvento}/certificados/${idPessoa.ausente}`,
      cabecalho,
    )
    expect(semCalculo.status).toBe(400)
    expect(detalhe(semCalculo)).toBe(
      'Este evento não tem carga horária nem sessões configuradas - não é possível calcular elegibilidade de certificado.',
    )

    // ---- 2. recusas da tela ao configurar
    const minimo = campo(
      page,
      '% mínimo de presença (em branco = padrão institucional)',
    )
    const carga = campo(
      page,
      'Carga horária do evento, em horas (em branco = usa sessões)',
    )
    await minimo.fill('150')
    await carga.fill('0')
    await salvarConfiguracao.click()
    const resumo = eleg
      .getByRole('alert')
      .filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toContainText('Informe um percentual entre 0 e 100.')
    await expect(resumo).toContainText(
      'Informe uma carga horária maior que zero.',
    )
    await ver(
      page,
      info,
      'elegibilidade com percentual e carga invalidos: recusada',
    )

    // ---- 2b. o servidor também tem que recusar o que a tela recusa
    const percentualAlto = await chamarApi(
      page,
      'PUT',
      caminhoConfig,
      cabecalho,
      {
        percentual_minimo: 150,
      },
    )
    if (percentualAlto.status < 400) {
      achados.push(
        `Percentual mínimo de presença de 150%: o servidor aceitou (${percentualAlto.status}); a tela recusa acima de 100%, a API não (app/routers/eventos.py::atualizar_elegibilidade_config_endpoint não valida)`,
      )
    }
    const cargaNegativa = await chamarApi(
      page,
      'PUT',
      caminhoConfig,
      cabecalho,
      {
        carga_horaria_horas: -3,
      },
    )
    if (cargaNegativa.status < 400) {
      achados.push(
        `Carga horária de -3 horas: o servidor aceitou (${cargaNegativa.status}) (app/routers/eventos.py::atualizar_elegibilidade_config_endpoint não valida)`,
      )
    }
    const percentualGigante = await chamarApi(
      page,
      'PUT',
      caminhoConfig,
      cabecalho,
      {
        percentual_minimo: 100_000,
      },
    )
    if (percentualGigante.status >= 500 || percentualGigante.status < 400) {
      achados.push(
        `Percentual mínimo de 100000%: o servidor respondeu ${percentualGigante.status} em vez de recusar com 4xx (campo numérico do banco estoura)`,
      )
    }

    // ---- 3. configuração A (carga de 0,5 hora e mínimo zero: todos "elegíveis"), para guardar uma tela que ficará desatualizada
    await abrirEvento(page)
    await minimo.fill('0')
    await carga.fill('0.5')
    await salvarConfiguracao.click()
    await expect(ausente).toContainText(
      '0% de presença (mínimo exigido: 0%) · elegível',
    )
    await expect(emitir(ausente)).toBeEnabled()
    const textoDaPresente = await presente.innerText()
    const percentualDaPresente = Number(
      /([\d.]+)% de presença/.exec(textoDaPresente)?.[1] ?? Number.NaN,
    )
    expect(percentualDaPresente, textoDaPresente).toBeGreaterThan(0)
    expect(percentualDaPresente).toBeLessThan(100)
    await ver(page, info, 'elegibilidade com minimo zero: todos elegiveis')

    const aba2 = await page.context().newPage()
    const vigia2 = vigiar(aba2)
    await aba2.goto(`/eventos?evento=${idEvento}`)
    const ausente2 = cartaoDe(secao(aba2, SECAO_ELEGIBILIDADE), P_AUSENTE)
    await expect(ausente2).toContainText('· elegível')
    await expect(emitir(ausente2)).toBeEnabled()

    // ---- 4. configuração B (mínimo de 0,01%): a presença conta; quem faltou deixa de ser elegível
    await minimo.fill('0.01')
    await carga.fill('0.5')
    await salvarConfiguracao.click()
    await expect(ausente).toContainText(
      '0% de presença (mínimo exigido: 0.01%) · não elegível',
    )
    await expect(emitir(ausente)).toBeDisabled()
    await expect(emitir(ausente)).toHaveAttribute(
      'title',
      'Pessoa não elegível ao certificado neste momento.',
    )
    await expect(presente).toContainText('(mínimo exigido: 0.01%) · elegível')
    await expect(presente).not.toContainText('não elegível')
    await expect(emitir(presente)).toBeEnabled()
    await expect(cartaoDe(eleg, PRESIDENTE)).toContainText('· não elegível')
    await ver(page, info, 'elegibilidade: presente elegivel, ausente nao')

    // ---- 5. a tela desatualizada ainda deixa clicar: o servidor recusa com a mensagem real, sem certificado
    await emitir(ausente2).click()
    await expect(
      ausente2.getByText(
        /Percentual de presença \(0(\.00)?%\) abaixo do mínimo exigido \(0\.01%\)\./,
      ),
    ).toBeVisible()
    await expect(
      ausente2.getByRole('link', { name: /Certificado emitido/ }),
    ).toHaveCount(0)
    await ver(aba2, info, 'certificado recusado a quem faltou: mensagem real')
    await aba2.close()

    // ---- 6. quem esteve presente recebe: o PDF abre, tem o nome, e a verificação pública confirma
    const emitindo = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/eventos\/\d+\/certificados\/\d+$/.test(
          new URL(r.url()).pathname,
        ),
    )
    await emitir(presente).click()
    const resposta = await emitindo
    expect(resposta.status(), await resposta.text()).toBe(200)
    const dados = (await resposta.json()) as {
      id_documento: number
      caminho_arquivo: string
      codigo_verificacao: string
    }
    const linkDoCertificado = presente.getByRole('link', {
      name: 'Certificado emitido — baixar PDF',
    })
    await expect(linkDoCertificado).toBeVisible()
    const href = (await linkDoCertificado.getAttribute('href')) ?? ''
    expect(href.endsWith(dados.caminho_arquivo)).toBe(true)
    expect(dados.codigo_verificacao).toMatch(/^[0-9A-F]{16}$/)
    expect(dados.caminho_arquivo).toBe(
      `/uploads/documentos/${dados.codigo_verificacao}.pdf`,
    )
    docs.certificado = {
      id: dados.id_documento,
      href,
      codigo: dados.codigo_verificacao,
    }
    const texto = await conferirPdf(page, href)
    if (texto && !texto.includes(P_PRESENTE)) {
      achados.push(
        `Certificado de ${P_PRESENTE}: o nome não aparece no texto do PDF (o modelo de certificado usado não tem {{nome_completo}}, ou o PDF sai sem o nome)`,
      )
    }
    if (texto && !texto.includes('emitido pelo sistema ASAF')) {
      achados.push(
        'Certificado: o texto do PDF não traz o rodapé "emitido pelo sistema ASAF" (ou o robô não leu o PDF direito)',
      )
    }
    if (!texto) {
      info.annotations.push({
        type: 'limite do roteiro',
        description:
          'O robô abriu o PDF do certificado (200, application/pdf, %PDF-) mas não conseguiu ler o texto de dentro dele.',
      })
    }
    await ver(page, info, 'certificado emitido a quem esteve presente')

    // verificação pública (sem login, na API): confirma nome, atividade e tipo; código inventado é recusado
    const verificacao = await chamarApi(
      page,
      'GET',
      `/certificado/verificar/${dados.codigo_verificacao}`,
      {},
    )
    expect(verificacao.status, verificacao.texto).toBe(200)
    expect(verificacao.json).toMatchObject({
      nome_completo: P_PRESENTE,
      atividade: TITULO,
    })
    expect(
      (verificacao.json as { tipo_documento: string | null }).tipo_documento,
    ).toBeTruthy()
    const inventado = await chamarApi(
      page,
      'GET',
      '/certificado/verificar/0000000000000000',
      {},
    )
    expect(inventado.status).toBe(404)
    expect(detalhe(inventado)).toBe('Código de verificação não encontrado.')

    // Auditoria
    expect(await abrirAuditoria(page, 'eventos')).toBeGreaterThanOrEqual(
      antesDaConfiguracao + 2,
    )
    await expect(
      linhaDaAuditoria(page, 'ATUALIZAR_ELEGIBILIDADE', {
        registro: idEvento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await abrirAuditoria(page, 'documentos_emitidos')
    await expect(
      linhaDaAuditoria(page, 'EMITIR_CERTIFICADO', {
        registro: docs.certificado.id,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: certificado emitido')
    expect(vigia.problemas()).toEqual([])
    expect(vigia2.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// F. DOCUMENTOS EMITIDOS (a tela nova)
// =====================================================================================================================================
test.describe('F. Documentos emitidos', () => {
  test('a tela lista o crachá e o certificado emitidos, filtra por evento e cada linha abre o PDF', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto('/documentos-emitidos')
    await expect(
      page.getByRole('heading', { name: 'Documentos emitidos', level: 1 }),
    ).toBeVisible()
    const filtro = page.getByLabel('Evento', { exact: true })
    await expect(filtro.locator('option', { hasText: TITULO })).toBeAttached()
    await filtro.selectOption({ label: TITULO })
    const cartoes = page.locator('div.rounded-md.border.bg-card')
    await expect(cartoes).toHaveCount(3)
    await ver(page, info, 'documentos emitidos do evento')
    await inventariarSemTravar(page, info, 'documentos-emitidos')

    // quem recebeu o quê
    await expect(cartoes.filter({ hasText: P_PRESENTE })).toHaveCount(2)
    await expect(cartoes.filter({ hasText: P_AUSENTE })).toHaveCount(1)
    await expect(cartoes.filter({ hasText: TITULO })).toHaveCount(3)
    await expect(cartoes.filter({ hasText: /Certificad/i })).toHaveCount(1)
    await expect(cartoes.filter({ hasText: /Crach/i })).toHaveCount(2)
    const certificado = cartoes.filter({ hasText: /Certificad/i })
    await expect(certificado).toContainText(P_PRESENTE)
    await expect(certificado).toContainText('Emitido em')

    // os números são sequenciais e nunca repetidos: crachá da presente < crachá da ausente < certificado
    async function numeroDe(cartao: Locator): Promise<number> {
      const texto = await cartao.locator('p.font-medium').first().innerText()
      return Number(/Nº\s*(\d+)/.exec(texto)?.[1] ?? Number.NaN)
    }
    const numeroDoCrachaPresente = await numeroDe(
      cartoes.filter({ hasText: P_PRESENTE }).filter({ hasText: /Crach/i }),
    )
    const numeroDoCrachaAusente = await numeroDe(
      cartoes.filter({ hasText: P_AUSENTE }),
    )
    const numeroDoCertificado = await numeroDe(certificado)
    expect(numeroDoCrachaPresente).toBeGreaterThan(0)
    expect(numeroDoCrachaAusente).toBeGreaterThan(numeroDoCrachaPresente)
    expect(numeroDoCertificado).toBeGreaterThan(numeroDoCrachaAusente)

    // cada linha abre o PDF (o mesmo endereço que a tela do evento mostrou na hora)
    const hrefs: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const link = cartoes.nth(i).getByRole('link', { name: 'Abrir o PDF' })
      await expect(link).toHaveAttribute('target', '_blank')
      const href = (await link.getAttribute('href')) ?? ''
      hrefs.push(href)
      await conferirPdf(page, href)
    }
    expect(new Set(hrefs).size).toBe(3)
    expect([...hrefs].sort()).toEqual(
      [
        docs.crachaPresente.href,
        docs.crachaAusente.href,
        docs.certificado.href,
      ].sort(),
    )

    // outro evento não mostra estes documentos
    const outroEvento = await filtro
      .locator('option')
      .evaluateAll(
        (opcoes, titulo) =>
          (opcoes as HTMLOptionElement[])
            .map((o) => o.textContent ?? '')
            .find((t) => t !== 'Todos os eventos' && t !== titulo) ?? '',
        TITULO,
      )
    if (outroEvento) {
      await filtro.selectOption({ label: outroEvento })
      await expect(page.getByText(P_PRESENTE)).toHaveCount(0)
      await expect(page.getByText(P_AUSENTE)).toHaveCount(0)
      await ver(page, info, 'documentos emitidos de outro evento')
    }
    // sem filtro, os três aparecem entre os de todos os eventos
    await filtro.selectOption('')
    await expect(page.getByText(P_PRESENTE)).toHaveCount(2)
    await expect(page.getByText(P_AUSENTE)).toHaveCount(1)
    await ver(page, info, 'documentos emitidos de todos os eventos')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// G. PAINEL GERENCIAL E FECHAMENTO
// =====================================================================================================================================
test.describe('G. Painel gerencial do evento', () => {
  test('pagar o título da pessoa presente (com o centro de custo do evento), gerar o fechamento e conferir inscritos, presentes, vagas e receita', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    const baixasAntes = await abrirAuditoria(page, 'lancamentos_contabeis')
    const fechamentosAntes = await abrirAuditoria(page, 'fechamentos_evento')

    // ---- a baixa do título, pela tela de Títulos, no centro de custo do evento
    await page.goto('/financeiro/titulos')
    await expect(
      page.getByRole('heading', { name: 'Títulos', level: 1 }),
    ).toBeVisible()
    const cartao = page
      .locator('div.rounded-md.border')
      .filter({ hasText: `Inscrição de ${P_PRESENTE}` })
    await expect(cartao).toHaveCount(1)
    await expect(cartao).toContainText('Pendente')
    await cartao.getByRole('button', { name: 'Baixar', exact: true }).click()
    const form = cartao.locator('form')
    await form.getByPlaceholder('Valor pago').fill(String(VALOR))
    await form.getByPlaceholder('Forma de pagamento').fill('Pix de teste')
    const contrapartida = form.locator('select').nth(0)
    await expect(contrapartida.locator('option').nth(1)).toBeAttached()
    await contrapartida.selectOption({ index: 1 })
    const centro = form.locator('select').nth(1)
    await expect(
      centro.locator('option', { hasText: CODIGO_CENTRO }),
    ).toBeAttached()
    await escolherPorTexto(centro, CODIGO_CENTRO)
    // a data de competência é "opcional" na tela, mas o servidor recusa a data vazia (achado já registrado pelos roteiros v5.4e): aqui vai preenchida
    await form.locator('input[type="date"]').fill(diaEmBelem(0).iso)
    await ver(page, info, 'baixa do titulo preenchida')
    await form.getByRole('button', { name: 'Confirmar baixa' }).click()
    const pago = cartao.getByText('Pago', { exact: true })
    const recusa = form.getByRole('alert')
    await expect(pago.or(recusa).first()).toBeVisible()
    expect(
      await recusa.allInnerTexts(),
      'a baixa do título foi recusada pelo servidor',
    ).toEqual([])
    await expect(pago).toBeVisible()
    await expect(cartao).toContainText(new RegExp(`Saldo ${padraoReais(0)}`))
    await ver(page, info, 'titulo da pessoa presente pago')
    expect(await abrirAuditoria(page, 'lancamentos_contabeis')).toBe(
      baixasAntes + 1,
    )
    await expect(
      linhaDaAuditoria(page, 'BAIXA_TITULO', { quem: PRESIDENTE }),
    ).toBeVisible()

    // ---- o fechamento do evento
    await abrirEvento(page)
    const fechamento = secao(page, 'Fechamento financeiro')
    await expect(fechamento).toContainText('Nenhum fechamento gerado ainda.')
    await fechamento
      .getByRole('button', { name: 'Gerar fechamento agora' })
      .click()
    await expect(
      fechamento.getByText(
        new RegExp(
          `3 inscrito\\(s\\) · 1 presente\\(s\\)\\s+· arrecadado ${padraoReais(VALOR)} · custos ${padraoReais(0)} · resultado ${padraoReais(VALOR)}`,
        ),
      ),
    ).toBeVisible()
    await ver(page, info, 'fechamento gerado: 3 inscritos, 1 presente, receita')

    // ---- o painel do evento depois de recarregar: vagas e comparação (inscritos, presentes, arrecadado, resultado)
    await page.reload()
    await expect(
      page.getByRole('heading', { name: TITULO, level: 2 }),
    ).toBeVisible()
    const ocupadas = await lerVagas(page)
    // inscritos que ocupam vaga: 1 gratuita + 3 do grupo; a cancelada devolve a vaga (o defeito de não devolver já foi anotado em C e não se repete aqui)
    conferir(
      'Vagas ocupadas no painel (a gratuita, a presente e a ausente, mais a cancelada se o sistema não a devolve e mais as vagas gastas por repetidas)',
      ocupadas,
      4 + vagasVazadas - (vagaDevolvidaNoCancelamento ? 1 : 0),
    )
    const linhaDoEvento = page.getByRole('row').filter({ hasText: TITULO })
    await expect(linhaDoEvento).toHaveCount(1)
    const celulas = linhaDoEvento.getByRole('cell')
    await expect(celulas.nth(2)).toHaveText('3')
    await expect(celulas.nth(3)).toHaveText('1')
    await expect(celulas.nth(4)).toHaveText(new RegExp(padraoReais(VALOR)))
    await expect(celulas.nth(5)).toHaveText(new RegExp(padraoReais(VALOR)))
    await expect(celulas.nth(6)).toHaveText('—')
    const inscritos = secao(page, SECAO_INSCRITOS)
    await expect(statusDe(cartaoDe(inscritos, P_PRESENTE))).toHaveText(
      'Presente',
    )
    await expect(statusDe(cartaoDe(inscritos, P_AUSENTE))).toHaveText(
      'Pré-inscrito',
    )
    await expect(statusDe(cartaoDe(inscritos, P_CANCELADA))).toHaveText(
      'Cancelado',
    )
    await ver(
      page,
      info,
      'painel do evento: inscritos, presentes, vagas e receita',
    )

    expect(await abrirAuditoria(page, 'fechamentos_evento')).toBe(
      fechamentosAntes + 1,
    )
    await expect(
      linhaDaAuditoria(page, 'CREATE', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: fechamento gerado')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// H. EXPORTAÇÕES COM PERMISSÃO PRÓPRIA
// =====================================================================================================================================
test.describe('H. Exportações', () => {
  test('quem tem a permissão exporta as inscrições e as presenças (as linhas certas) e a Auditoria registra; coluna que não existe é recusada', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const api = guardarToken(page)
    await entrar(page, 'presidente')
    const exportacoesAntes = await abrirAuditoria(page, 'inscricoes')
    const presencasAntes = await abrirAuditoria(page, 'registros_presenca')
    await abrirEvento(page)

    // ---- inscrições: a tabela traz as 4 inscrições (a cancelada também), com o status de cada uma
    const inscritos = secao(page, SECAO_INSCRITOS)
    const exportando = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname === '/api/inscricoes/exportar',
    )
    await inscritos
      .getByRole('button', { name: 'Exportar', exact: true })
      .click()
    const resposta = await exportando
    expect(resposta.status(), await resposta.text()).toBe(200)
    const linhasDaApi = (await resposta.json()) as {
      id_inscricao: number
      nome_pessoa: string | null
      status: string
    }[]
    expect(linhasDaApi).toHaveLength(4)
    const tabela = inscritos.locator('table')
    await expect(tabela.locator('tbody tr')).toHaveCount(4)
    await expect(tabela.locator('th')).toHaveText([
      'Nome',
      'Status',
      'Inscrito em',
    ])
    const esperado: Record<string, string> = {
      [P_PRESENTE]: 'Presente',
      [P_AUSENTE]: 'Pré-inscrito',
      [P_CANCELADA]: 'Cancelado',
    }
    for (const [nome, status] of Object.entries(esperado)) {
      const linha = tabela.locator('tbody tr').filter({ hasText: nome })
      await expect(linha).toHaveCount(1)
      await expect(linha.getByRole('cell').nth(1)).toHaveText(status)
      expect(
        linhasDaApi.find((l) => l.nome_pessoa === nome)?.status,
        nome,
      ).toBe(status)
    }
    await expect(
      tabela
        .locator('tbody tr')
        .filter({ hasText: PRESIDENTE })
        .getByRole('cell')
        .nth(1),
    ).toHaveText('Pré-inscrito')
    await ver(page, info, 'exportacao das inscricoes: quatro linhas')

    // ---- presenças: as colunas escolhidas e as linhas de quem não cancelou
    const presencas = secao(page, SECAO_EXPORTAR_PRESENCAS)
    const botao = presencas.getByRole('button', {
      name: 'Exportar',
      exact: true,
    })
    const rotulos = [
      'ID da pessoa',
      'Nome completo',
      'Percentual de presença',
      'Limite mínimo aplicado',
      'Elegível ao certificado',
    ]
    for (const rotulo of rotulos) await presencas.getByLabel(rotulo).uncheck()
    await expect(botao).toBeDisabled()
    await ver(page, info, 'presencas sem nenhuma coluna: exportar desligado')
    await presencas.getByLabel('Nome completo').check()
    await presencas.getByLabel('Elegível ao certificado').check()
    const exportandoPresencas = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname ===
          `/api/eventos/${idEvento}/presencas/exportar`,
    )
    await botao.click()
    expect((await exportandoPresencas).status()).toBe(200)
    const tabelaDePresencas = presencas.locator('table')
    await expect(tabelaDePresencas.locator('th')).toHaveText([
      'nome_completo',
      'elegivel',
    ])
    await expect(tabelaDePresencas.locator('tbody tr')).toHaveCount(3)
    await expect(
      tabelaDePresencas
        .locator('tbody tr')
        .filter({ hasText: P_PRESENTE })
        .getByRole('cell')
        .nth(1),
    ).toHaveText('true')
    await expect(
      tabelaDePresencas
        .locator('tbody tr')
        .filter({ hasText: P_AUSENTE })
        .getByRole('cell')
        .nth(1),
    ).toHaveText('false')
    await expect(
      tabelaDePresencas.locator('tbody tr').filter({ hasText: P_CANCELADA }),
    ).toHaveCount(0)
    await ver(page, info, 'exportacao das presencas: duas colunas, tres linhas')

    // recusas do servidor: coluna que não existe (dado pessoal) e nenhuma coluna
    const cabecalho = await api.cabecalho()
    const cpf = await chamarApi(
      page,
      'GET',
      `/api/eventos/${idEvento}/presencas/exportar?colunas=nome_completo,cpf`,
      cabecalho,
    )
    expect(cpf.status).toBe(422)
    expect(detalhe(cpf)).toBe('Coluna(s) desconhecida(s): cpf.')
    const nenhuma = await chamarApi(
      page,
      'GET',
      `/api/eventos/${idEvento}/presencas/exportar?colunas=`,
      cabecalho,
    )
    expect(nenhuma.status).toBe(422)
    expect(detalhe(nenhuma)).toBe('Informe ao menos uma coluna.')

    // Auditoria: uma exportação de inscrições e uma de presenças (as recusas não gravam)
    const totalDeInscricoes = await abrirAuditoria(page, 'inscricoes')
    expect(totalDeInscricoes).toBe(exportacoesAntes + 1)
    auditoriaInscricoesAposExportar = totalDeInscricoes
    await expect(
      linhaDaAuditoria(page, 'EXPORTAR', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: exportacao das inscricoes')
    expect(await abrirAuditoria(page, 'registros_presenca')).toBe(
      presencasAntes + 1,
    )
    await expect(
      linhaDaAuditoria(page, 'EXPORT', {
        registro: idEvento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: exportacao das presencas')
    expect(vigia.problemas()).toEqual([])
  })

  test('sem a permissão: quem tem só "projetos" (presidente do cargo) vê o evento mas não vê nem faz exportação, portaria nem crachá (403 no servidor); quem não tem "projetos" é barrado', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const api = guardarToken(page)

    // ---- Ana Lúcia (cargo de Presidente): tem "projetos", não tem as permissões próprias de exportar e de portaria
    await entrar(page, 'cargo_presidente')
    await abrirEvento(page)
    await expect(secao(page, SECAO_INSCRITOS)).toBeVisible()
    await expect(
      secao(page, SECAO_INSCRITOS).getByRole('button', {
        name: 'Exportar',
        exact: true,
      }),
    ).toHaveCount(0)
    for (const titulo of [
      SECAO_PORTARIA,
      SECAO_ELEGIBILIDADE,
      SECAO_EXPORTAR_PRESENCAS,
    ]) {
      await expect(
        page.getByRole('heading', { name: titulo, level: 3, exact: true }),
      ).toHaveCount(0)
    }
    await expect(
      page.getByRole('heading', {
        name: 'Cobrança de inscrição',
        level: 3,
        exact: true,
      }),
    ).toBeVisible()
    await ver(page, info, 'cargo de Presidente: sem exportar, sem portaria')

    const cabecalho = await api.cabecalho()
    const exportar = await chamarApi(
      page,
      'GET',
      `/api/inscricoes/exportar?contexto_tipo=Evento&id_contexto=${idEvento}`,
      cabecalho,
    )
    expect(exportar.status).toBe(403)
    expect(detalhe(exportar)).toBe(
      "Sem permissão 'exportar_inscricoes_evento'.",
    )
    const exportarPresencas = await chamarApi(
      page,
      'GET',
      `/api/eventos/${idEvento}/presencas/exportar?colunas=nome_completo`,
      cabecalho,
    )
    expect(exportarPresencas.status).toBe(403)
    expect(detalhe(exportarPresencas)).toBe(
      "Sem permissão 'exportar_presencas_evento'.",
    )
    const cracha = await chamarApi(
      page,
      'POST',
      `/api/eventos/${idEvento}/crachas/${idPessoa.presente}`,
      cabecalho,
    )
    expect(cracha.status).toBe(403)
    expect(detalhe(cracha)).toBe("Sem permissão 'gerenciar_checkin_evento'.")
    const token = await chamarApi(
      page,
      'POST',
      `/api/eventos/${idEvento}/tokens-portaria`,
      cabecalho,
      { descricao: 'tentativa sem permissão', horas_validade: 1 },
    )
    expect(token.status).toBe(403)
    await sair(page)

    // ---- Daniel (Secretário): sem "projetos" não abre nem o evento nem os documentos emitidos
    await entrar(page, 'secretario')
    api.esquecer()
    for (const rota of ['/eventos', '/documentos-emitidos']) {
      await page.goto(rota)
      await expect(page).toHaveURL(/\/403$/)
      await expect(
        page.getByRole('heading', { name: 'Acesso negado' }),
      ).toBeVisible()
    }
    await ver(page, info, 'Secretario barrado em eventos e documentos emitidos')
    const semProjetos = await chamarApi(
      page,
      'GET',
      '/api/documentos-emitidos/',
      await api.cabecalho(),
    )
    expect(semProjetos.status).toBe(403)
    expect(detalhe(semProjetos)).toBe("Sem permissão 'projetos'.")
    await sair(page)

    // ---- as recusas não deixaram rastro de exportação na Auditoria
    await entrar(page, 'presidente')
    expect(await abrirAuditoria(page, 'inscricoes')).toBe(
      auditoriaInscricoesAposExportar,
    )
    await ver(page, info, 'auditoria: as recusas nao gravaram exportacao')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
test('fechamento: nenhum achado suspeito ficou registrado neste roteiro', () => {
  expect(
    achados,
    `O roteiro viu ${achados.length} coisa(s) que parece(m) defeito do sistema:\n- ${achados.join('\n- ')}`,
  ).toEqual([])
})
