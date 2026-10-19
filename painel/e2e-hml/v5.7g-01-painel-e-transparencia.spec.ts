import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.7g - as PONTAS do painel e da transparência, provadas na homologação com a API de teste e as telas:
//  1. "Aplicado por campanha": a página pública de doação mostra, por campanha, o TOTAL já gasto no centro de custo dela (0 sem gasto; vazio, "não acompanhado à parte", sem centro de custo);
//     a tesouraria registra uma saída pela TELA, com o centro de custo da campanha, e o aplicado passa a ser o valor da saída; nada do centro de custo sai na API pública;
//  2. a leitura do Conselho Fiscal é paginada: o conselheiro vê 25 por vez, o total do servidor, a próxima página traz outros itens, a busca acha o título e o lançamento criados aqui, o filtro de
//     situação combina com a busca, e cada consulta (de cada página) fica na Auditoria sem o texto buscado;
//  3. o atalho "Editar o site" tem permissão própria (`editar_site`): a Presidência o vê (e a permissão está no cadastro de permissões); o Secretário, que não tem a permissão, não o vê.
// Fica na homologação, para explorar: o centro de custo, as duas campanhas e a saída do robô.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(420_000)

const S = String(RODADA)
const NOTA = `%PDF-1.4\n% nota fiscal de teste do robô ${S}\n`
const PIX = `%PDF-1.4\n% comprovante de teste do robô ${S}\n`
const DESCRICAO_DA_SAIDA = `Saída do robô v5.7g ${S}`
const VALOR_DA_SAIDA = 123.45
const CENTRO = { codigo: `ROBO-${S}`, nome: `Centro do robô ${S}` }

let autorizacao = ''
const cabecalho = () => ({ Authorization: autorizacao })
const dia = (deslocamento: number) =>
  new Date(Date.now() + deslocamento * 86_400_000).toISOString().slice(0, 10)

type CampanhaPublica = {
  id_campanha: number
  titulo: string
  valor_arrecadado: number
  valor_aplicado: number | null
}
let idDaCampanhaComCentro = 0
let idDaCampanhaSemCentro = 0

async function capturarToken(page: Page): Promise<void> {
  autorizacao = '' // cada pessoa que entra traz o token dela: nunca o do teste anterior
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
}

async function campanhasPublicas(page: Page): Promise<CampanhaPublica[]> {
  const r = await page.request.get(`${API_HML}/api/publico/doacao`)
  expect(r.status()).toBe(200)
  const corpo = (await r.json()) as {
    campanhas: CampanhaPublica[]
  }
  return corpo.campanhas
}

async function escolherQuandoCarregar(seletor: Locator, trecho: string) {
  await expect(
    seletor.locator('option', { hasText: trecho }).first(),
  ).toBeAttached()
  await escolherPorTexto(seletor, trecho)
}

test('preparar e provar o vazio: centro de custo, uma campanha COM e outra SEM centro; a API pública diz 0 e "não acompanhado" e não vaza o centro', async ({
  page,
}) => {
  const vigia = vigiar(page)
  await capturarToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')

  // o Pix aberto para o site (o que a Presidência faz em Instituição), senão a API não mostra campanha nenhuma
  for (const [chave, corpo] of [
    [
      'CHAVE_PIX',
      { valor: 'chave-pix-de-teste@homologacao.example.com', publico: true },
    ],
    ['NOME_BENEFICIARIO_PIX', { valor: 'ASAF Teste' }],
    ['CIDADE_BENEFICIARIO_PIX', { valor: 'Belem' }],
  ] as const) {
    const r = await page.request.put(`${API_HML}/api/instituicao/${chave}`, {
      headers: cabecalho(),
      data: corpo,
    })
    expect(r.status(), await r.text()).toBe(200)
  }

  const centro = await page.request.post(`${API_HML}/api/centros-custo/`, {
    headers: cabecalho(),
    data: CENTRO,
  })
  expect(centro.status(), await centro.text()).toBe(200)
  const idDoCentro = ((await centro.json()) as { id_centro_custo: number })
    .id_centro_custo

  const nova = async (titulo: string, extra: Record<string, unknown>) => {
    const r = await page.request.post(`${API_HML}/api/campanhas-arrecadacao/`, {
      headers: cabecalho(),
      data: {
        titulo,
        descricao: 'Campanha do robô da v5.7g',
        meta_valor: 1000,
        ...extra,
      },
    })
    expect(r.status(), await r.text()).toBe(200)
    return ((await r.json()) as { id_campanha: number }).id_campanha
  }
  idDaCampanhaComCentro = await nova(`Robô com centro ${S}`, {
    id_centro_custo: idDoCentro,
  })
  idDaCampanhaSemCentro = await nova(`Robô sem centro ${S}`, {})

  const publicas = await campanhasPublicas(page)
  const com = publicas.find((c) => c.id_campanha === idDaCampanhaComCentro)
  const sem = publicas.find((c) => c.id_campanha === idDaCampanhaSemCentro)
  expect(com?.valor_aplicado, 'campanha com centro e sem gasto').toBe(0)
  expect(sem?.valor_aplicado, 'campanha sem centro de custo').toBeNull()
  expect(Object.keys(com!).sort()).toEqual([
    'descricao',
    'id_campanha',
    'meta_valor',
    'percentual',
    'prazo',
    'titulo',
    'valor_aplicado',
    'valor_arrecadado',
  ])
  const texto = JSON.stringify(publicas)
  expect(texto).not.toContain('id_centro_custo')
  expect(texto).not.toContain(CENTRO.nome)
  expect(vigia.problemas()).toEqual([])
})

test('a tesouraria registra uma saída pela tela com o centro de custo da campanha: o aplicado passa a ser o valor da saída; a outra campanha segue sem acompanhamento', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await page.goto('/financeiro/registrar-saida')
  await expect(
    page.getByRole('heading', { name: 'Registrar saída', level: 1 }),
  ).toBeVisible()
  await escolherQuandoCarregar(
    page.getByLabel('Categoria da saída'),
    'Despesas',
  )
  await page.getByLabel('Descrição').fill(DESCRICAO_DA_SAIDA)
  const fornecedor = page.getByLabel('Fornecedor', { exact: true })
  await expect(fornecedor.locator('option').nth(1)).toBeAttached()
  await fornecedor.selectOption({ index: 1 })
  await page.getByLabel('Valor (R$)').fill(String(VALOR_DA_SAIDA))
  await page.getByLabel('Forma de pagamento').selectOption('Pix')
  await page.getByLabel('Data da despesa').fill(dia(-1))
  await page.getByLabel('Data do pagamento').fill(dia(-1))
  await escolherQuandoCarregar(
    page.getByLabel('De onde saiu o dinheiro'),
    'Caixa e banco',
  )
  await escolherQuandoCarregar(
    page.getByLabel('Centro de custo (opcional)'),
    CENTRO.nome,
  )
  await page.getByLabel('Nota fiscal', { exact: true }).setInputFiles({
    name: 'nota.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(NOTA),
  })
  await expect(page.getByText('Nota fiscal: anexado.')).toBeVisible()
  await page.getByLabel('Comprovante do pagamento').setInputFiles({
    name: 'pix.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(PIX),
  })
  await expect(
    page.getByText('Comprovante do pagamento: anexado.'),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Registrar saída', exact: true })
    .click()
  await expect(page.locator('section[role="status"]')).toContainText(
    `Saída registrada: “${DESCRICAO_DA_SAIDA}”`,
  )
  await ver(page, info, 'saida-com-o-centro-de-custo-da-campanha')

  const publicas = await campanhasPublicas(page)
  const com = publicas.find((c) => c.id_campanha === idDaCampanhaComCentro)!
  const sem = publicas.find((c) => c.id_campanha === idDaCampanhaSemCentro)!
  expect(com.valor_aplicado).toBeCloseTo(VALOR_DA_SAIDA, 2)
  expect(sem.valor_aplicado, 'a outra campanha segue sem acompanhamento').toBe(
    null,
  )
  expect(vigia.problemas()).toEqual([])
})

test('Conselho Fiscal: 25 por página, o total do servidor, outra página, busca pelo título e pelo lançamento, situação combinada com a busca, e a Auditoria sem o texto buscado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await capturarToken(page)
  await entrar(page, 'conselheiro')
  const total = async (rota: 'titulos' | 'caixa', consulta = '') => {
    const r = await page.request.get(
      `${API_HML}/api/conselho-fiscal/financeiro/${rota}?por_pagina=1${consulta}`,
      { headers: cabecalho() },
    )
    expect(r.status(), await r.text()).toBe(200)
    return ((await r.json()) as { total: number }).total
  }
  // o conselheiro entra com o token dele
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  const totalDeTitulos = await total('titulos')
  const totalDoRazao = await total('caixa')
  expect(
    totalDeTitulos,
    'a homologação cheia tem mais de uma página',
  ).toBeGreaterThan(25)
  expect(
    totalDoRazao,
    'a homologação cheia tem mais de uma página',
  ).toBeGreaterThan(25)

  await page.goto('/financeiro/conselho-fiscal')
  const titulos = page.locator('section').filter({
    has: page.getByRole('heading', { name: /Títulos financeiros/ }),
  })
  const razao = page.locator('section').filter({
    has: page.getByRole('heading', { name: /Razão contábil/ }),
  })
  const navTitulos = titulos.getByRole('navigation', {
    name: 'Páginas de títulos',
  })
  await expect(titulos.getByText(`${totalDeTitulos} títulos`)).toBeVisible()
  await expect(
    navTitulos.getByText(`Página 1 de ${Math.ceil(totalDeTitulos / 25)}`),
  ).toBeVisible()
  await expect(
    navTitulos.getByRole('button', { name: 'Página anterior' }),
  ).toBeDisabled()
  const cartoes = titulos.locator('div.rounded-md.border')
  await expect(cartoes).toHaveCount(25)
  const primeiroDaPagina1 = await cartoes.first().innerText()
  await ver(page, info, 'conselho-fiscal-pagina-1-dos-titulos')

  // a próxima página: outros títulos; a anterior volta
  const proxima = page.waitForResponse(
    (r) =>
      r.url().includes('/api/conselho-fiscal/financeiro/titulos') &&
      r.url().includes('pagina=2') &&
      r.ok(),
  )
  await navTitulos.getByRole('button', { name: 'Próxima página' }).click()
  await proxima
  await expect(
    navTitulos.getByText(`Página 2 de ${Math.ceil(totalDeTitulos / 25)}`),
  ).toBeVisible()
  await expect
    .poll(async () => cartoes.first().innerText())
    .not.toBe(primeiroDaPagina1)
  await navTitulos.getByRole('button', { name: 'Página anterior' }).click()
  await expect
    .poll(async () => cartoes.first().innerText())
    .toBe(primeiroDaPagina1)

  // a busca acha o título da saída do robô; só ele; sem navegação
  const buscaTitulo = page.waitForResponse(
    (r) =>
      r.url().includes('/api/conselho-fiscal/financeiro/titulos') &&
      r.url().includes('busca=') &&
      r.ok(),
  )
  await titulos.getByLabel('Buscar título').fill(DESCRICAO_DA_SAIDA)
  await buscaTitulo
  await expect(titulos.getByText('1 título', { exact: true })).toBeVisible()
  await expect(cartoes).toHaveCount(1)
  await expect(cartoes.first()).toContainText(DESCRICAO_DA_SAIDA)
  await expect(navTitulos).toHaveCount(0)
  await ver(page, info, 'conselho-fiscal-busca-pelo-titulo-do-robo')

  // situação combinada com a busca: a saída está Paga; filtrando "Pendente" não sobra nada
  await titulos
    .getByLabel('Filtrar títulos por situação')
    .selectOption('Pendente')
  await expect(titulos.getByText('Nenhum título encontrado.')).toBeVisible()
  await titulos.getByLabel('Filtrar títulos por situação').selectOption('Pago')
  await expect(cartoes).toHaveCount(1)

  // o razão: páginas e busca pelo histórico (o lançamento da saída do robô)
  const navRazao = razao.getByRole('navigation', { name: 'Páginas do razão' })
  await expect(razao.getByText(`${totalDoRazao} lançamentos`)).toBeVisible()
  await expect(
    navRazao.getByText(`Página 1 de ${Math.ceil(totalDoRazao / 25)}`),
  ).toBeVisible()
  const linhas = razao.locator('tbody tr')
  await expect(linhas).toHaveCount(25)
  const buscaRazao = page.waitForResponse(
    (r) =>
      r.url().includes('/api/conselho-fiscal/financeiro/caixa') &&
      r.url().includes('busca=') &&
      r.ok(),
  )
  await razao.getByLabel('Buscar lançamento').fill(DESCRICAO_DA_SAIDA)
  await buscaRazao
  await expect(linhas.first()).toContainText(DESCRICAO_DA_SAIDA)
  await ver(page, info, 'conselho-fiscal-busca-no-razao')

  // a Auditoria: cada página lida registrou a consulta, com o número da página, e o texto buscado NÃO foi para lá
  await sair(page)
  autorizacao = ''
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=titulos_financeiros&acao=CONSULTA_CONSELHO_FISCAL&por_pagina=50`,
    { headers: cabecalho() },
  )
  const { entradas } = (await r.json()) as {
    entradas: Array<{ dados_depois: unknown }>
  }
  const textos = entradas.map((e) => JSON.stringify(e.dados_depois))
  expect(
    textos.some((t) => t.includes('"pagina": 2') || t.includes('"pagina":2')),
  ).toBe(true)
  expect(
    textos.some(
      (t) => t.includes('"com_busca": true') || t.includes('"com_busca":true'),
    ),
  ).toBe(true)
  expect(textos.join('')).not.toContain(DESCRICAO_DA_SAIDA)
  expect(vigia.problemas()).toEqual([])
})

test('o atalho "Editar o site" tem permissão própria: a Presidência o vê e a permissão está no cadastro; o Secretário não o vê', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await capturarToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  const permissoes = await page.request.get(`${API_HML}/api/permissoes/`, {
    headers: cabecalho(),
  })
  expect(permissoes.status()).toBe(200)
  const lista = (await permissoes.json()) as Array<{
    codigo_permissao: string
    descricao: string
  }>
  const nova = lista.find((p) => p.codigo_permissao === 'editar_site')
  expect(nova?.descricao).toContain('Directus')
  const me = await page.request.get(`${API_HML}/auth/me`, {
    headers: cabecalho(),
  })
  expect(((await me.json()) as { permissoes: string[] }).permissoes).toContain(
    'editar_site',
  )

  await page.goto('/')
  const atalho = page.getByRole('link', { name: /Editar o site/ })
  await expect(atalho).toBeVisible()
  await expect(atalho).toHaveAttribute('target', '_blank')
  expect(await atalho.getAttribute('rel')).toContain('noopener')
  await ver(page, info, 'inicio-da-presidencia-com-o-atalho-editar-o-site')

  await sair(page)
  await entrar(page, 'secretario')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Editar o site/ })).toHaveCount(0)
  await ver(page, info, 'inicio-do-secretario-sem-o-atalho')
  expect(vigia.problemas()).toEqual([])
})
