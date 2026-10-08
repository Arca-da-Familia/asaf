import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'
import { pdfComTexto, pdfSoImagem } from './pdfs'

// v5.4g - FASE 5 ao vivo, item 2: DOCUMENTOS (a biblioteca de documentos institucionais e o que vai ao site de transparência), pela tela e conferindo a API pública:
//  - o Secretário prepara (cadastra com o ORIGINAL em PDF, que tem dado pessoal de mentira, e a versão pública em texto);
//  - a versão pública com CPF, e-mail e celular é recusada (com o que achou, mascarado e sem gravar nada); PDF só imagem, PDF que traz CPF e arquivo que não é PDF
//    também são recusados;
//  - quem enviou para revisão NÃO aprova o próprio documento (o botão some e a API recusa); o Presidente aprova;
//  - aprovado, a API pública mostra o texto; o ORIGINAL nunca sai pela API pública nem por /uploads, e só baixa autenticado (e o download fica na Auditoria);
//  - documento Interno e documento que ainda é rascunho nunca aparecem; retirar do site pede o motivo e o documento sai da API pública.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(420_000)

const S = String(RODADA)
const TABELA = 'documentos_institucionais'
const CPF_DE_MENTIRA = '111.444.777-35'
const MARCA_DO_ORIGINAL = `Ata do robo v5.4g ${S}`
const ORIGINAL = pdfComTexto([
  MARCA_DO_ORIGINAL,
  `Presente: Fulana de Tal, CPF ${CPF_DE_MENTIRA}, que votou a favor.`,
])
const TITULO_A = `Ata de teste do robô v5.4g ${S} (publicada)`
const TITULO_INTERNO = `Documento interno do robô v5.4g ${S}`
const TITULO_RASCUNHO = `Rascunho do robô v5.4g ${S}`
const TITULO_RETIRADO = `Ata de teste do robô v5.4g ${S} (retirada)`
const TEXTO_LIMPO =
  'Ata da reuniao ordinaria da associacao, realizada na sede. Foram tratados o calendario de eventos do segundo semestre e a prestacao de contas do mes. Nao ha dado pessoal neste texto.'

let idA = 0
let idInterno = 0
let idRascunho = 0
let idRetirado = 0
let totalAntes = 0

async function capturarToken(page: Page): Promise<() => string> {
  let token = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token = cab
  })
  return () => token
}

async function totalNaAuditoria(page: Page): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${TABELA}`),
  )
  await campo(page, 'Tabela').fill(TABELA)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

async function cadastrar(
  page: Page,
  d: {
    titulo: string
    classificacao?: 'Pública' | 'Interna' | 'Restrita'
    publicar?: boolean
    original?: boolean
  },
): Promise<number> {
  await page.goto('/documentos/novo')
  await expect(
    page.getByRole('heading', { name: 'Novo documento', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Título').fill(d.titulo)
  if (d.classificacao)
    await page
      .getByRole('radio', { name: new RegExp(`^${d.classificacao}`) })
      .check()
  const publicar = page.getByRole('checkbox', {
    name: /Publicar no site de transparência/,
  })
  if (d.publicar === false) await publicar.uncheck()
  if (d.original !== false)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'ata-com-dados.pdf',
      mimeType: 'application/pdf',
      buffer: ORIGINAL,
    })
  await page.getByRole('button', { name: 'Cadastrar documento' }).click()
  await expect(page).toHaveURL(/\/documentos\/\d+$/)
  await expect(
    page.getByRole('heading', { name: d.titulo, level: 1 }),
  ).toBeVisible()
  return Number(/\/documentos\/(\d+)$/.exec(page.url())![1])
}

const secaoPublica = (page: Page) =>
  page.getByRole('region', { name: 'Versão pública (a que pode ir ao site)' })
const resultadoDaConferencia = (page: Page) =>
  page.getByRole('region', {
    name: 'Resultado da conferência da versão pública',
  })

async function colarTexto(page: Page, texto: string) {
  await secaoPublica(page)
    .getByLabel('Ou cole o texto da versão pública')
    .fill(texto)
  await secaoPublica(page)
    .getByRole('button', { name: 'Enviar o texto e conferir' })
    .click()
}

/** O achado vem MASCARADO: o CPF inteiro não está escrito no resultado, no aviso nem no histórico (a caixa de texto, que é o que a pessoa digitou, fica de fora). */
async function conferirQueOCpfNaoApareceInteiro(page: Page): Promise<void> {
  await expect(resultadoDaConferencia(page)).not.toContainText(CPF_DE_MENTIRA)
  await expect(page.getByRole('alert')).not.toContainText(CPF_DE_MENTIRA)
  const amostra = await resultadoDaConferencia(page)
    .locator('code')
    .first()
    .innerText()
  expect(amostra).not.toBe(CPF_DE_MENTIRA)
  expect(amostra).toContain('*')
}

async function enviarPdfPublico(
  page: Page,
  nome: string,
  conteudo: Buffer,
): Promise<void> {
  await secaoPublica(page).locator('input[type="file"]').setInputFiles({
    name: nome,
    mimeType: 'application/pdf',
    buffer: conteudo,
  })
  await secaoPublica(page)
    .getByRole('button', { name: 'Enviar e conferir' })
    .click()
}

async function publicoLista(page: Page) {
  const r = await page.request.get(
    `${API_HML}/api/publico/transparencia/documentos`,
  )
  expect(r.status()).toBe(200)
  return (await r.json()) as Array<{
    id_documento: number
    titulo: string
    formato: string
  }>
}

async function aprovarComOPresidente(page: Page, id: number) {
  await sair(page)
  await entrar(page, 'presidente')
  await page.goto(`/documentos/${id}`)
  await page.getByRole('button', { name: 'Aprovar a publicação' }).click()
  await page.getByRole('button', { name: 'Confirmar aprovação' }).click()
  await expect(
    page.getByText('Publicado no site de transparência.'),
  ).toBeVisible()
}

test('o Secretário cadastra um documento Restrito para o site, com o original (que tem CPF de mentira) na área privada e sem versão pública ainda', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  totalAntes = await totalNaAuditoria(page)
  await sair(page)

  await entrar(page, 'secretario')
  await page.goto('/documentos/novo')
  // título curto: recusado na própria tela, sem ir ao servidor
  await page.getByLabel('Título').fill('ab')
  await page.getByRole('button', { name: 'Cadastrar documento' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Dê um título ao documento (pelo menos 3 letras).',
  )
  idA = await cadastrar(page, { titulo: TITULO_A })

  const original = page.getByRole('region', {
    name: 'Arquivo original (área privada)',
  })
  await expect(original).toContainText('ata-com-dados.pdf')
  await expect(original).toContainText('SHA-256:')
  await expect(secaoPublica(page)).toContainText(
    'Nenhuma versão pública aceita ainda.',
  )
  await expect(page.getByText('Restrita').first()).toBeVisible()
  await expect(page.getByText('Envie a versão pública')).toBeVisible()
  await ver(page, info, 'documento-cadastrado-com-original-privado')
  expect(vigia.problemas()).toEqual([])
})

test('a versão pública com dado pessoal é recusada (e nada é gravado): texto com CPF, e-mail e celular; PDF com CPF; PDF só imagem; arquivo que não é PDF', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  await page.goto(`/documentos/${idA}`)
  await expect(secaoPublica(page)).toBeVisible()

  await colarTexto(
    page,
    `Ata de teste da reuniao. Presente: Fulana de Tal, CPF ${CPF_DE_MENTIRA}, celular (91) 98888-7777 e e-mail fulana@gmail.com, que votou a favor da proposta.`,
  )
  const resultado = resultadoDaConferencia(page)
  await expect(resultado).toContainText('Não pode ir ao site do jeito que está')
  await expect(resultado).toContainText('CPF na versão pública')
  await expect(resultado).toContainText('e-mail que não é da ASAF')
  await expect(resultado).toContainText('celular que não é da ASAF')
  // o que a tela mostra do achado vem mascarado: o CPF inteiro não aparece escrito em lugar nenhum da página
  await conferirQueOCpfNaoApareceInteiro(page)
  await expect(page.getByRole('alert')).toContainText('NÃO foi aceita')
  await ver(page, info, 'versao-publica-recusada-com-dado-pessoal')
  await expect(secaoPublica(page)).toContainText(
    'Nenhuma versão pública aceita ainda.',
  )

  await enviarPdfPublico(
    page,
    'versao-com-cpf.pdf',
    pdfComTexto([
      'Ata de teste.',
      `Fulana de Tal, CPF ${CPF_DE_MENTIRA}, presente na reuniao.`,
    ]),
  )
  await expect(resultadoDaConferencia(page)).toContainText(
    'CPF na versão pública',
  )
  await conferirQueOCpfNaoApareceInteiro(page)

  await enviarPdfPublico(page, 'so-imagem.pdf', pdfSoImagem())
  await expect(resultadoDaConferencia(page)).toContainText('o PDF é só imagem')
  await ver(page, info, 'pdf-so-imagem-recusado')

  await enviarPdfPublico(
    page,
    'nao-e-pdf.pdf',
    Buffer.from('isto nao e um PDF de verdade'),
  )
  await expect(resultadoDaConferencia(page)).toContainText(
    'o arquivo não é um PDF',
  )

  await expect(secaoPublica(page)).toContainText(
    'Nenhuma versão pública aceita ainda.',
  )
  expect(vigia.problemas().filter((p) => !p.startsWith('422 '))).toEqual([])
})

test('o texto limpo é aceito; quem enviou para revisão não aprova o próprio documento (a tela esconde o botão e a API recusa); o Presidente aprova', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'secretario')
  await page.goto(`/documentos/${idA}`)
  await colarTexto(page, TEXTO_LIMPO)
  await expect(secaoPublica(page)).toContainText(
    'Versão pública aceita (texto de',
  )
  await expect(resultadoDaConferencia(page)).toContainText(
    'Passou na conferência automática',
  )
  await expect(
    page.getByText(
      'A versão pública passou na conferência. Envie para revisão.',
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(
    page.getByText(
      'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).',
    ),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Aprovar a publicação' }),
  ).toHaveCount(0)
  await ver(page, info, 'em-revisao-quem-enviou-nao-aprova')

  // mesmo sabendo o endereço, a API recusa quem enviou
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const recusada = await page.request.fetch(
    `${API_HML}/api/documentos/${idA}/aprovar`,
    { method: 'POST', headers: { Authorization: token() } },
  )
  expect(recusada.status()).toBe(403)
  expect(await recusada.text()).toContain('Quem criou ou enviou o documento')

  await aprovarComOPresidente(page, idA)
  await ver(page, info, 'aprovado-pelo-presidente')
  expect(vigia.problemas()).toEqual([])
})

test('aprovado, a API pública mostra o texto e NUNCA o original; o original só baixa autenticado (e fica na Auditoria); /uploads não o serve', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  const lista = await publicoLista(page)
  const publicado = lista.find((d) => d.id_documento === idA)
  expect(publicado, 'o documento aprovado está na lista pública').toBeTruthy()
  expect(publicado!.titulo).toBe(TITULO_A)
  expect(publicado!.formato).toBe('TEXTO')
  expect(JSON.stringify(lista)).not.toMatch(/original/i)

  const detalhe = await page.request.get(
    `${API_HML}/api/publico/transparencia/documentos/${idA}`,
  )
  expect(detalhe.status()).toBe(200)
  const corpo = await detalhe.text()
  expect(corpo).toContain('Ata da reuniao ordinaria da associacao')
  expect(corpo).not.toContain(CPF_DE_MENTIRA)
  expect(corpo).not.toContain(MARCA_DO_ORIGINAL)
  expect(corpo).not.toMatch(/original/i)
  // documento em texto não tem PDF para baixar
  expect(
    (
      await page.request.get(
        `${API_HML}/api/publico/transparencia/documentos/${idA}/arquivo`,
      )
    ).status(),
  ).toBe(404)
  // o original não está em nenhum endereço de arquivos abertos
  for (const caminho of [
    '/uploads/ata-com-dados.pdf',
    '/uploads/documentos/ata-com-dados.pdf',
    '/uploads/originais/ata-com-dados.pdf',
    `/api/documentos/${idA}/original`,
  ]) {
    const r = await page.request.get(`${API_HML}${caminho}`)
    expect(
      [401, 403, 404],
      `${caminho} não pode servir o original sem login`,
    ).toContain(r.status())
    expect(await r.text()).not.toContain(MARCA_DO_ORIGINAL)
  }

  // quem tem a permissão baixa o original: pela tela, e o arquivo é o enviado
  await entrar(page, 'presidente')
  await page.goto(`/documentos/${idA}`)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Baixar o original/ }).click(),
  ])
  const baixado = readFileSync(await download.path())
  expect(
    baixado.equals(ORIGINAL),
    'o arquivo baixado é exatamente o original enviado',
  ).toBe(true)
  await ver(page, info, 'original-baixado-por-quem-tem-permissao')

  // e pela API, só autenticado
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const autenticado = await page.request.fetch(
    `${API_HML}/api/documentos/${idA}/original`,
    { headers: { Authorization: token() } },
  )
  expect(autenticado.status()).toBe(200)
  expect(
    (await autenticado.body()).includes(Buffer.from(MARCA_DO_ORIGINAL)),
  ).toBe(true)
  expect(
    (
      await page.request.get(`${API_HML}/api/documentos/${idA}/original`)
    ).status(),
  ).toBe(401)
  expect(vigia.problemas()).toEqual([])
})

test('documento Interno e documento ainda em rascunho nunca aparecem na API pública', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  idInterno = await cadastrar(page, {
    titulo: TITULO_INTERNO,
    classificacao: 'Interna',
    publicar: false,
  })
  await expect(
    page.getByText(
      'Documento interno: fica guardado no sistema e não vai ao site.',
    ),
  ).toBeVisible()
  await expect(secaoPublica(page)).toHaveCount(0)
  await ver(page, info, 'documento-interno-nao-vai-ao-site')

  idRascunho = await cadastrar(page, { titulo: TITULO_RASCUNHO })
  await colarTexto(page, TEXTO_LIMPO)
  await expect(secaoPublica(page)).toContainText(
    'Versão pública aceita (texto de',
  )
  // aceito pela conferência, mas ninguém aprovou: continua fora do site

  const lista = await publicoLista(page)
  const titulos = lista.map((d) => d.titulo)
  expect(titulos).not.toContain(TITULO_INTERNO)
  expect(titulos).not.toContain(TITULO_RASCUNHO)
  for (const id of [idInterno, idRascunho]) {
    const r = await page.request.get(
      `${API_HML}/api/publico/transparencia/documentos/${id}`,
    )
    expect(r.status(), `documento ${id} não pode aparecer no site`).toBe(404)
  }
  expect(vigia.problemas()).toEqual([])
})

test('retirar do site pede o motivo; depois o documento sai da API pública e a tela diz quando e por quê', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  idRetirado = await cadastrar(page, { titulo: TITULO_RETIRADO })
  await colarTexto(page, TEXTO_LIMPO)
  await expect(secaoPublica(page)).toContainText(
    'Versão pública aceita (texto de',
  )
  await page.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(
    page.getByText(
      'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).',
    ),
  ).toBeVisible()
  await aprovarComOPresidente(page, idRetirado)
  expect((await publicoLista(page)).map((d) => d.titulo)).toContain(
    TITULO_RETIRADO,
  )

  await page.getByRole('button', { name: 'Retirar do site' }).click()
  const caixa = page.getByLabel('Por que sair do site? (pelo menos 10 letras)')
  await caixa.fill('curto')
  await page.getByRole('button', { name: 'Confirmar retirada' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Explique o motivo da retirada (pelo menos 10 caracteres).',
  )
  expect((await publicoLista(page)).map((d) => d.titulo)).toContain(
    TITULO_RETIRADO,
  )

  await caixa.fill('Documento substituído por outra versão (teste do robô).')
  await page.getByRole('button', { name: 'Confirmar retirada' }).click()
  await expect(
    page.getByText(/^Retirado do site em .*: Documento substituído/),
  ).toBeVisible()
  await expect(
    page.getByText('Retirado do site. Todo o histórico foi preservado.'),
  ).toBeVisible()
  await ver(page, info, 'documento-retirado-do-site')

  expect((await publicoLista(page)).map((d) => d.titulo)).not.toContain(
    TITULO_RETIRADO,
  )
  const r = await page.request.get(
    `${API_HML}/api/publico/transparencia/documentos/${idRetirado}`,
  )
  expect(r.status()).toBe(404)
  // o histórico continua: quem fez o quê e quando
  await expect(
    page.getByRole('region', { name: 'Histórico (quem fez o quê)' }),
  ).toContainText('Retirado do site')
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guarda cada passo (criação, versão recusada e aceita, revisão, aprovação, download do original, retirada)', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const total = await totalNaAuditoria(page)
  // A: criado, 4 versões recusadas, 1 aceita, revisão, aprovação, 2 downloads do original; interno e rascunho: criado (+ versão do rascunho);
  // retirado: criado, versão, revisão, aprovação, retirada
  expect(
    total - totalAntes,
    'passos desta rodada na Auditoria',
  ).toBeGreaterThanOrEqual(17)
  for (const acao of [
    'CRIADO',
    'VERSAO_PUBLICA_RECUSADA',
    'APROVADO',
    'RETIRADO',
  ]) {
    await expect(
      page
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: acao, exact: true }) })
        .first(),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria-dos-documentos')
  expect(vigia.problemas()).toEqual([])
})
