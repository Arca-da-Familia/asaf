import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Registrar saída: o sistema é só o REGISTRO do que já aconteceu (decisão do Presidente, 2026-10-08): um formulário lança a saída e dá a baixa de uma
// vez, com categoria, nota fiscal e comprovante, sem fila de assinatura (a dupla assinatura é do banco). O que o roteiro prova, pela tela: o formulário
// vazio diz o que falta; data no futuro é recusada pelo servidor (sem rastro); a saída entra já Paga e aparece em Saídas com o link da nota; saída lançada
// muito depois do pagamento avisa que é lançamento tardio; reembolso é a saída com um associado como quem recebeu; o Conselheiro Fiscal abre a nota e o
// comprovante na Auditoria financeira e vê o aviso de lançamento tardio; os arquivos abrem e são os enviados; a Auditoria do sistema guarda cada saída;
// quem não tem o Financeiro (Secretário) é barrado.
test.describe.configure({ mode: 'serial' })
test.setTimeout(420_000)

const S = String(RODADA)
const NOTA = `%PDF-1.4\n% nota fiscal de teste do robô ${S}\n`
const PIX = `%PDF-1.4\n% comprovante de teste do robô ${S}\n`
const DESCRICAO_EM_DIA = `Saída de teste ${S} em dia`
const DESCRICAO_TARDIA = `Saída de teste ${S} tardia`
const DESCRICAO_REEMBOLSO = `Saída de teste ${S} reembolso`
const REEMBOLSADO = 'Leonardo Batista Reis'

/** A data de hoje (UTC, como o servidor) deslocada em dias, no formato AAAA-MM-DD. */
const dia = (deslocamento: number) =>
  new Date(Date.now() + deslocamento * 86_400_000).toISOString().slice(0, 10)

let totalAntes = 0

async function escolherQuandoCarregar(seletor: Locator, trecho: string) {
  await expect(
    seletor.locator('option', { hasText: trecho }).first(),
  ).toBeAttached()
  await escolherPorTexto(seletor, trecho)
}

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
      r.url().includes('tabela_afetada=titulos_financeiros'),
  )
  await campo(page, 'Tabela').fill('titulos_financeiros')
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

async function abrirOFormulario(page: Page) {
  await page.goto('/financeiro/registrar-saida')
  await expect(
    page.getByRole('heading', { name: 'Registrar saída', level: 1 }),
  ).toBeVisible()
  await expect(
    page
      .getByLabel('Categoria da saída')
      .locator('option', { hasText: 'Despesas' })
      .first(),
  ).toBeAttached()
}

/** Preenche e envia o formulário; devolve nada (cada teste confere o que quer depois). */
async function preencher(
  page: Page,
  d: {
    descricao: string
    despesa: string
    pagamento: string
    quem?: 'fornecedor' | 'associado'
    associado?: string
  },
) {
  await escolherQuandoCarregar(
    page.getByLabel('Categoria da saída'),
    'Despesas',
  )
  await page.getByLabel('Descrição').fill(d.descricao)
  if (d.quem === 'associado') {
    await page.getByLabel('Quem recebeu').selectOption('associado')
    await escolherQuandoCarregar(
      page.getByLabel('Associado', { exact: true }),
      d.associado ?? REEMBOLSADO,
    )
  } else {
    // o primeiro fornecedor da lista (a homologação tem fornecedores inventados)
    const fornecedor = page.getByLabel('Fornecedor', { exact: true })
    await expect(fornecedor.locator('option').nth(1)).toBeAttached()
    await fornecedor.selectOption({ index: 1 })
  }
  await page.getByLabel('Valor (R$)').fill('123.45')
  await page.getByLabel('Forma de pagamento').selectOption('Pix')
  await page.getByLabel('Data da despesa').fill(d.despesa)
  await page.getByLabel('Data do pagamento').fill(d.pagamento)
  await escolherQuandoCarregar(
    page.getByLabel('De onde saiu o dinheiro'),
    'Caixa e banco',
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
}

const resultado = (page: Page) => page.locator('section[role="status"]')

test('o formulário vazio diz o que falta; data no futuro é recusada pelo servidor e não deixa saída nem rastro', async ({
  page,
}, info) => {
  exigirHomologacao()
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  totalAntes = await totalNaAuditoria(page)
  await sair(page)

  await entrar(page, 'tesoureiro')
  // o caminho do dia a dia: Financeiro, Saídas e o botão de registrar
  await page.getByRole('link', { name: 'Financeiro' }).first().click()
  await page
    .getByRole('complementary')
    .getByRole('link', { name: 'Saídas', exact: true })
    .click()
  await page.getByRole('link', { name: 'Registrar saída (já paga)' }).click()
  await expect(
    page.getByRole('heading', { name: 'Registrar saída', level: 1 }),
  ).toBeVisible()

  await page
    .getByRole('button', { name: 'Registrar saída', exact: true })
    .click()
  for (const texto of [
    'Escolha a categoria da saída.',
    'Descreva a saída (pelo menos 3 letras).',
    'Escolha o fornecedor.',
    'Informe um valor maior que zero.',
    'Informe a forma de pagamento.',
    'Informe a data da despesa.',
    'Informe a data do pagamento.',
    'Escolha de onde saiu o dinheiro.',
    'Anexe a nota fiscal.',
    'Anexe o comprovante do pagamento.',
  ]) {
    await expect(page.getByText(texto)).toBeVisible()
  }
  await ver(page, info, 'registrar-saida-formulario-vazio')

  // preenchido certo, mas com a data da despesa no futuro: quem manda é o servidor, e ele recusa
  await preencher(page, {
    descricao: `Saída de teste ${S} futura`,
    despesa: dia(5),
    pagamento: dia(-1),
  })
  await page
    .getByRole('button', { name: 'Registrar saída', exact: true })
    .click()
  await expect(page.getByText(/não pode estar no futuro/)).toBeVisible()
  await expect(resultado(page)).toHaveCount(0)
  await ver(page, info, 'registrar-saida-data-no-futuro-recusada')
  expect(vigia.problemas()).toEqual([])
})

test('a saída que já aconteceu entra paga, com a nota fiscal, e aparece em Saídas', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await abrirOFormulario(page)
  await preencher(page, {
    descricao: DESCRICAO_EM_DIA,
    despesa: dia(-1),
    pagamento: dia(-1),
  })
  await page
    .getByRole('button', { name: 'Registrar saída', exact: true })
    .click()
  await expect(resultado(page)).toContainText(
    `Saída registrada: “${DESCRICAO_EM_DIA}”`,
  )
  await expect(resultado(page)).not.toContainText('Atenção')
  await ver(page, info, 'registrar-saida-registrada')

  // o atalho leva para Saídas já filtrada: o título está Pago e tem o link da nota fiscal
  await resultado(page).getByRole('link', { name: 'Ver em Saídas' }).click()
  const cartao = page
    .locator('div.rounded-md.border')
    .filter({ hasText: DESCRICAO_EM_DIA })
  await expect(cartao).toHaveCount(1)
  await expect(cartao).toContainText('A Pagar')
  await expect(cartao).toContainText('Pago')
  await expect(cartao).toContainText('R$ 123,45')
  const nota = cartao.getByRole('link', { name: 'Ver nota fiscal' })
  await expect(nota).toBeVisible()
  // a nota abre e é o arquivo enviado
  const href = (await nota.getAttribute('href')) ?? ''
  expect(href).toMatch(/\/uploads\/comprovantes\/[\w-]+\.pdf$/)
  const arquivo = await page.request.get(href)
  expect(arquivo.status()).toBe(200)
  expect((await arquivo.body()).toString()).toBe(NOTA)
  await ver(page, info, 'saidas-com-a-saida-registrada-e-a-nota')
  expect(vigia.problemas()).toEqual([])
})

test('saída lançada muito depois do pagamento avisa o lançamento tardio; o reembolso é a saída com um associado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await abrirOFormulario(page)
  await preencher(page, {
    descricao: DESCRICAO_TARDIA,
    despesa: dia(-20),
    pagamento: dia(-20),
  })
  await page
    .getByRole('button', { name: 'Registrar saída', exact: true })
    .click()
  await expect(resultado(page)).toContainText(
    'Atenção: esta saída foi lançada 20 dias depois do pagamento',
  )
  await ver(page, info, 'registrar-saida-lancamento-tardio')

  await abrirOFormulario(page)
  await preencher(page, {
    descricao: DESCRICAO_REEMBOLSO,
    despesa: dia(-2),
    pagamento: dia(-2),
    quem: 'associado',
  })
  await page
    .getByRole('button', { name: 'Registrar saída', exact: true })
    .click()
  await expect(resultado(page)).toContainText(
    `Saída registrada: “${DESCRICAO_REEMBOLSO}”`,
  )
  await resultado(page).getByRole('link', { name: 'Ver em Saídas' }).click()
  const cartao = page
    .locator('div.rounded-md.border')
    .filter({ hasText: DESCRICAO_REEMBOLSO })
  await expect(cartao).toContainText(REEMBOLSADO)
  await expect(cartao).toContainText('Pago')
  await ver(page, info, 'saidas-com-o-reembolso')
  expect(vigia.problemas()).toEqual([])
})

test('o Conselheiro Fiscal abre a nota e o comprovante na Auditoria financeira e vê o aviso de lançamento tardio', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'conselheiro')
  const cartaoDe = (descricao: string) =>
    page.locator('div.rounded-md.border').filter({ hasText: descricao })

  // a saída em dia (mês de ontem): nota e comprovante abrem e são os arquivos enviados
  await page.goto(
    `/financeiro/auditoria-financeira?mes=${dia(-1).slice(0, 7)}&busca=${encodeURIComponent(DESCRICAO_EM_DIA)}`,
  )
  await expect(cartaoDe(DESCRICAO_EM_DIA)).toHaveCount(1)
  const emDia = cartaoDe(DESCRICAO_EM_DIA)
  const nota = emDia.getByRole('link', { name: 'Ver nota fiscal' })
  const comprovante = emDia.getByRole('link', {
    name: 'Ver comprovante do pagamento',
  })
  await expect(nota).toBeVisible()
  await expect(comprovante).toBeVisible()
  for (const [link, conteudo] of [
    [nota, NOTA],
    [comprovante, PIX],
  ] as const) {
    const href = (await link.getAttribute('href')) ?? ''
    const resposta = await page.request.get(href)
    expect(resposta.status()).toBe(200)
    expect((await resposta.body()).toString()).toBe(conteudo)
  }
  await expect(emDia).not.toContainText('Lançamento tardio')
  await ver(page, info, 'auditoria-financeira-com-nota-e-comprovante')

  // a saída tardia (mês de 20 dias atrás): o aviso aparece para o Conselho
  await page.goto(
    `/financeiro/auditoria-financeira?mes=${dia(-20).slice(0, 7)}&busca=${encodeURIComponent(DESCRICAO_TARDIA)}`,
  )
  await expect(cartaoDe(DESCRICAO_TARDIA)).toHaveCount(1)
  await expect(cartaoDe(DESCRICAO_TARDIA)).toContainText(
    'Lançamento tardio: lançada 20 dia(s) depois da despesa.',
  )
  await ver(page, info, 'auditoria-financeira-lancamento-tardio')
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria do sistema guarda as três saídas (a recusa da data no futuro não deixou rastro) e o Secretário é barrado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'secretario')
  await page.goto('/financeiro/registrar-saida')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const recusado = await page.request.fetch(`${API_HML}/api/saidas/registrar`, {
    method: 'POST',
    headers: { Authorization: token(), 'Content-Type': 'application/json' },
    data: '{}',
  })
  expect(recusado.status()).toBe(403)
  await sair(page)

  await entrar(page, 'presidente')
  const total = await totalNaAuditoria(page)
  expect(total - totalAntes, 'três saídas registradas na Auditoria').toBe(3)
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('cell', { name: 'REGISTRAR_SAIDA', exact: true }),
    }),
  ).not.toHaveCount(0)
  await ver(page, info, 'auditoria-das-saidas-registradas')
  expect(vigia.problemas()).toEqual([])
})
