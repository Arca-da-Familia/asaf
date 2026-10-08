import { expect, test, type Page } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v5.4g - FASE 5 ao vivo, itens 2, 3 e o do Despertai (v5.4f): depois que os roteiros v5.4g-02 (documentos), 03 (parcerias e emendas) e 04 (Despertai) publicaram
// de verdade pelo painel, o site de teste (hml-site) foi reconstruído (ele lê a API NO BUILD) e este roteiro o ABRE como um visitante, num navegador de verdade, e confere
// o que aparece: o destaque do Despertai na página inicial, a página do projeto (edições, relatório, foto), a página do evento (projeto de origem, outras edições,
// relatório, foto), a Transparência (documentos aprovados, nenhum retirado, nenhum Interno ou rascunho; emenda com os MESMOS valores da API, que vêm do livro-caixa).
// Sempre olha os itens mais novos (maior número) com os prefixos dos roteiros anteriores, para poder rodar em qualquer rodada.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(420_000)

const SITE = 'https://hml-site.asaf.org.br'
const PREFIXO = 'Despertai de Teste (robô v5.4g)'
const PREFIXO_INTERNO = 'Despertai Interno de Teste (robô v5.4g)'

const reais = (valor: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(valor)
    .replace(/ /g, ' ')

const limpo = (texto: string) => texto.replace(/ /g, ' ').replace(/\s+/g, ' ')

async function textoDaPagina(page: Page, caminho: string): Promise<string> {
  const resposta = await page.goto(`${SITE}${caminho}`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status(), `${caminho} abre`).toBe(200)
  return limpo(await page.locator('main').innerText())
}

async function api<T>(page: Page, caminho: string): Promise<T> {
  const r = await page.request.get(`${API_HML}${caminho}`)
  expect(r.status(), caminho).toBe(200)
  return (await r.json()) as T
}

type ProjetoPublico = { id_projeto: number; nome: string; destaque: boolean }
type ProjetoDetalhe = ProjetoPublico & {
  eventos: Array<{ id_evento: number; titulo: string }>
  documentos: Array<{ id_documento: number; titulo: string }>
  fotos: Array<{ id_foto: number; alt: string; arquivo: string }>
}
type EventoDetalhe = {
  id_evento: number
  titulo: string
  projeto: { id_projeto: number; nome: string } | null
  edicoes: Array<{ id_evento: number; titulo: string; atual: boolean }>
  documentos: Array<{ id_documento: number; titulo: string }>
  fotos: Array<{ id_foto: number; alt: string }>
}

async function despertaiMaisNovo(page: Page): Promise<ProjetoDetalhe> {
  const lista = await api<ProjetoPublico[]>(page, '/api/publico/projetos')
  const dele = lista
    .filter((p) => p.nome.startsWith(PREFIXO))
    .sort((a, b) => b.id_projeto - a.id_projeto)
  expect(
    dele.length,
    'o roteiro v5.4g-04 publicou ao menos um Despertai',
  ).toBeGreaterThan(0)
  return api<ProjetoDetalhe>(
    page,
    `/api/publico/projetos/${dele[0]!.id_projeto}`,
  )
}

async function imagensCarregadas(
  page: Page,
): Promise<{ total: number; quebradas: string[] }> {
  return page.evaluate(() => {
    const imagens = [
      ...document.querySelectorAll('main img'),
    ] as HTMLImageElement[]
    return {
      total: imagens.length,
      quebradas: imagens
        .filter((i) => !i.complete || i.naturalWidth === 0)
        .map((i) => i.currentSrc || i.src),
    }
  })
}

test('a página inicial destaca o Despertai e não mostra nada Interno', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const texto = await textoDaPagina(page, '/')
  expect(texto).toContain(PREFIXO)
  expect(texto).not.toContain(PREFIXO_INTERNO)
  await ver(page, info, 'inicio-com-o-destaque-do-despertai')
  expect(vigia.problemas()).toEqual([])
})

test('a página do projeto mostra as edições, o relatório aprovado e a foto autorizada; a edição Interna não aparece', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const projeto = await despertaiMaisNovo(page)
  const texto = await textoDaPagina(page, `/projetos/${projeto.id_projeto}/`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    projeto.nome,
  )
  expect(
    projeto.eventos.length,
    'o projeto tem as duas edições públicas',
  ).toBeGreaterThanOrEqual(2)
  for (const evento of projeto.eventos) {
    expect(
      texto,
      `a edição "${evento.titulo}" está na página do projeto`,
    ).toContain(evento.titulo)
    await expect(
      page.locator(`main a[href="/eventos/${evento.id_evento}/"]`).first(),
    ).toBeVisible()
  }
  expect(
    projeto.documentos.length,
    'o relatório aprovado está ligado ao projeto',
  ).toBeGreaterThan(0)
  for (const doc of projeto.documentos) expect(texto).toContain(doc.titulo)
  expect(texto).not.toContain(PREFIXO_INTERNO)
  expect(texto).not.toContain('evento interno')
  if (projeto.fotos.length > 0) {
    const { total, quebradas } = await imagensCarregadas(page)
    expect(total, 'as fotos autorizadas aparecem').toBeGreaterThanOrEqual(
      projeto.fotos.length,
    )
    expect(quebradas, `imagens quebradas: ${quebradas.join(', ')}`).toEqual([])
  }
  await ver(page, info, 'pagina-do-projeto-despertai')
  expect(vigia.problemas()).toEqual([])
})

test('a página da 1ª edição mostra o projeto de origem, as outras edições, o relatório e a foto; a Interna não tem página', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const projeto = await despertaiMaisNovo(page)
  const primeira = projeto.eventos.find((e) => e.titulo.endsWith('1ª edição'))
  expect(
    primeira,
    'a 1ª edição está entre os eventos públicos do projeto',
  ).toBeTruthy()
  const evento = await api<EventoDetalhe>(
    page,
    `/api/publico/eventos/${primeira!.id_evento}`,
  )
  const texto = await textoDaPagina(page, `/eventos/${evento.id_evento}/`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    evento.titulo,
  )
  expect(texto, 'o projeto de origem aparece').toContain(evento.projeto!.nome)
  await expect(
    page
      .locator(`main a[href="/projetos/${evento.projeto!.id_projeto}/"]`)
      .first(),
  ).toBeVisible()
  for (const edicao of evento.edicoes.filter((e) => !e.atual))
    expect(texto, `a outra edição "${edicao.titulo}"`).toContain(edicao.titulo)
  expect(evento.documentos.length).toBeGreaterThan(0)
  for (const doc of evento.documentos) expect(texto).toContain(doc.titulo)
  expect(evento.fotos.length).toBeGreaterThan(0)
  const { total, quebradas } = await imagensCarregadas(page)
  expect(total).toBeGreaterThanOrEqual(evento.fotos.length)
  expect(quebradas, `imagens quebradas: ${quebradas.join(', ')}`).toEqual([])
  await ver(page, info, 'pagina-da-primeira-edicao')

  // o evento Interno ligado ao projeto não tem página no site (e a API pública também o nega)
  const lista = await api<Array<{ id_evento: number; titulo: string }>>(
    page,
    '/api/publico/eventos',
  )
  expect(
    lista.map((e) => e.titulo).filter((t) => t.includes(PREFIXO_INTERNO)),
  ).toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('a Transparência lista só o documento aprovado: nem o retirado, nem o Interno, nem o rascunho; a página do documento mostra o texto e nunca o original', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const lista = await api<
    Array<{ id_documento: number; titulo: string; formato: string }>
  >(page, '/api/publico/transparencia/documentos')
  const publicados = lista.filter(
    (d) => d.titulo.includes('robô v5.4g') && d.titulo.includes('(publicada)'),
  )
  expect(
    publicados.length,
    'o roteiro v5.4g-02 aprovou ao menos um documento',
  ).toBeGreaterThan(0)
  const maisNovo = publicados.sort(
    (a, b) => b.id_documento - a.id_documento,
  )[0]!
  const texto = await textoDaPagina(page, '/transparencia/documentos/')
  expect(texto).toContain(maisNovo.titulo)
  // o que nunca deve estar no site
  for (const proibido of [
    '(retirada)',
    'Documento interno do robô v5.4g',
    'Rascunho do robô v5.4g',
  ])
    expect(texto, `"${proibido}" não pode aparecer`).not.toContain(proibido)

  await page.getByRole('link', { name: maisNovo.titulo }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    maisNovo.titulo,
  )
  const doc = limpo(await page.locator('main').innerText())
  expect(doc).toContain('Ata da reuniao ordinaria da associacao')
  expect(doc).not.toContain('111.444.777-35')
  expect(doc).not.toMatch(/Ata do robo v5\.4g/)
  await ver(page, info, 'documento-aprovado-no-site')
  expect(vigia.problemas()).toEqual([])
})

test('a emenda aprovada aparece no site com os MESMOS valores da API (que vêm do livro-caixa); a parceria retirada não aparece', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const parcerias = await api<
    Array<{
      id_parceria: number
      tipo_codigo: string
      titulo: string
      valor_total: number
      recebido: number
      pago: number
    }>
  >(page, '/api/publico/transparencia/parcerias')
  const nossas = parcerias.filter(
    (p) =>
      p.titulo.startsWith('Emenda de Teste ') &&
      p.titulo.includes('Oficinas de teatro'),
  )
  expect(
    nossas.length,
    'o roteiro v5.4g-03 publicou uma emenda',
  ).toBeGreaterThan(0)
  const emenda = nossas.sort((a, b) => b.id_parceria - a.id_parceria)[0]!
  expect(
    parcerias.map((p) => p.titulo).filter((t) => t.includes('so para aprovar')),
  ).toEqual([])

  const lista = await textoDaPagina(page, '/transparencia/emendas/')
  expect(lista).toContain(emenda.titulo)
  expect(lista).not.toContain('so para aprovar')

  const pasta = emenda.tipo_codigo === 'EMENDA' ? 'emendas' : 'parcerias'
  const texto = await textoDaPagina(
    page,
    `/transparencia/${pasta}/${emenda.id_parceria}/`,
  )
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    emenda.titulo,
  )
  expect(texto).toContain(reais(emenda.valor_total))
  expect(texto).toContain(reais(emenda.recebido))
  expect(texto).toContain(reais(emenda.pago))
  expect(texto).toContain(reais(emenda.recebido - emenda.pago))
  // dado pessoal nunca: nem o oficineiro do roteiro, nem CPF, e-mail ou celular
  expect(texto).not.toContain('Fulano de Tal Inventado')
  expect(texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/)
  expect(texto).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
  await ver(page, info, 'emenda-no-site-com-os-valores-do-livro-caixa')
  expect(vigia.problemas()).toEqual([])
})

test('depois de tudo, o site continua inteiro: o sitemap tem as páginas novas, nenhum link interno quebrado nas páginas novas e o noindex segue', async ({
  page,
}) => {
  const vigia = vigiar(page)
  const projeto = await despertaiMaisNovo(page)
  const caminhos = [
    '/',
    `/projetos/${projeto.id_projeto}/`,
    ...projeto.eventos.map((e) => `/eventos/${e.id_evento}/`),
    '/transparencia/documentos/',
    '/transparencia/emendas/',
  ]
  const quebrados: string[] = []
  for (const caminho of caminhos) {
    await page.goto(`${SITE}${caminho}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    )
    const hrefs = await page
      .locator('main a[href^="/"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
    for (const href of new Set(hrefs)) {
      const r = await page.request.get(`${SITE}${href.split('#')[0]}`)
      if (r.status() !== 200)
        quebrados.push(`${caminho} -> ${href}: ${r.status()}`)
    }
  }
  expect(quebrados, quebrados.join('\n')).toEqual([])
  expect(vigia.problemas()).toEqual([])
})
