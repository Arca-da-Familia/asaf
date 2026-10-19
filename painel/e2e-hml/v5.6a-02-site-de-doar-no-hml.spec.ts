import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.6a - o que o VISITANTE do site de teste (hml-site) vê na página Doar, num navegador de verdade, DEPOIS de a homologação ser publicada de novo (o site é construído no Deploy Homologação):
// a campanha do v5.6a-01 com o que já foi RECEBIDO (lida ao vivo da API de teste), o Pix sem se identificar (código, QR Code e chave), o formulário de quem se identifica (protocolo, que a tesouraria
// enxerga na conferência), a Política 2.0 e a política de conteúdo sem violação. E a trava mais importante: se a Presidência desmarca "vai para o site" na Chave Pix, a página fecha sozinha, sem
// novo publicar (o roteiro desmarca, confere e RESTAURA, mesmo se falhar).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const CAMINHO = `${SITE}/como-ajudar/doar/`

let autorizacao = ''
const cabecalho = () => ({ Authorization: autorizacao })

async function entrarComoPresidente(page: Page): Promise<void> {
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
}

/** Vigia as violações da política de conteúdo (o navegador as anuncia no próprio documento). */
async function vigiarViolacoes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as { __v: string[] }).__v = []
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(window as unknown as { __v: string[] }).__v.push(
        `${e.violatedDirective} ← ${e.blockedURI || 'inline'}`,
      )
    })
  })
}
const violacoesDa = (page: Page) =>
  page.evaluate(() => (window as unknown as { __v: string[] }).__v)

const anonima = (page: Page) => page.locator('form[data-doacao-anonima]')
const identificada = (page: Page) =>
  page.locator('form[data-doacao-identificada]')

async function abrir(page: Page): Promise<void> {
  const resposta = await page.goto(CAMINHO, { waitUntil: 'networkidle' })
  expect(resposta?.status()).toBe(200)
  await expect(
    page.locator('[data-doacao-vivo] > [data-estado="pronto"]'),
  ).toBeVisible({ timeout: 30_000 })
}

async function marcarChavePixParaOSite(
  page: Page,
  publico: boolean,
): Promise<void> {
  const r = await page.request.put(`${API_HML}/api/instituicao/CHAVE_PIX`, {
    headers: cabecalho(),
    data: { publico },
  })
  expect(r.status(), await r.text()).toBe(200)
}

/** A doação pelo site só abre com a Chave Pix marcada "vai para o site" (o v5.6a-01 deixa assim; aqui se garante, para o roteiro valer sozinho). */
async function garantirPixAberto(page: Page): Promise<void> {
  const r = await page.request.put(`${API_HML}/api/instituicao/CHAVE_PIX`, {
    headers: cabecalho(),
    data: {
      valor: 'chave-pix-de-teste@homologacao.example.com',
      publico: true,
    },
  })
  expect(r.status(), await r.text()).toBe(200)
}

test('a página Doar do site de teste: campanha ao vivo, Pix sem se identificar com código e QR, e a Política de Privacidade', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await vigiarViolacoes(page)
  await entrarComoPresidente(page)
  await garantirPixAberto(page)

  await abrir(page)
  await expect(page.locator('[data-antes-de-doar]')).toContainText(
    'O Pix cai direto na conta da associação',
  )
  // a campanha do v5.6a-01, com o RECEBIDO (100 de 1000)
  const campanha = page
    .locator('[data-campanha]')
    .filter({ hasText: `Robô doação ${RODADA}`.slice(0, 11) })
    .first()
  await expect(campanha).toBeVisible()
  await expect(campanha.locator('[data-percentual]')).toContainText('%')
  await ver(page, info, 'doar-com-a-campanha')

  // Pix sem se identificar, para a campanha, com valor
  const forma = anonima(page)
  await forma
    .getByLabel('Para onde vai a sua doação')
    .selectOption({ index: 1 })
  await forma.getByLabel('Valor (opcional)').fill('25,50')
  const [resposta] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/publico/doacao/pix')),
    forma.getByRole('button', { name: 'Mostrar o código Pix' }).click(),
  ])
  expect(resposta.ok()).toBe(true)
  const { copia_e_cola: codigoDaApi } = (await resposta.json()) as {
    copia_e_cola: string
  }
  const resultado = page.locator('[data-resultado-anonimo]')
  await expect(resultado).toBeVisible()
  await expect(resultado.locator('[data-codigo-pix]')).toHaveText(codigoDaApi)
  await expect(resultado.locator('svg[data-qr-pix]')).toHaveAttribute(
    'role',
    'img',
  )
  await expect(resultado.locator('[data-chave-pix]')).not.toBeEmpty()
  await ver(page, info, 'pix-sem-se-identificar')

  // Política 2.0 com o parágrafo da doação
  await page.goto(`${SITE}/privacidade/`, { waitUntil: 'networkidle' })
  expect(
    (await page.locator('body').innerText()).replace(/\s+/g, ' '),
  ).toContain('Versão 2.')
  await expect(page.locator('[data-doacao]')).toBeVisible()
  await ver(page, info, 'politica-de-privacidade-2-0')

  expect(
    await violacoesDa(page),
    'nenhuma violação da política de conteúdo',
  ).toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('quem se identifica no site recebe o protocolo, e a tesouraria o enxerga na conferência', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await vigiarViolacoes(page)
  await entrarComoPresidente(page)
  await garantirPixAberto(page)
  await abrir(page)

  const forma = identificada(page)
  const email = `doacao.site.${RODADA}@homologacao.example.com`
  await forma.getByLabel('Nome completo').fill(`Doador do Site ${RODADA}`)
  await forma.getByLabel('E-mail').fill(email)
  await forma.getByLabel('Valor (opcional)').fill('40')
  await forma.getByLabel('Li e aceito o aviso de privacidade.').check()
  await ver(page, info, 'formulario-de-quem-se-identifica')
  await forma.getByRole('button', { name: 'Enviar e ver o código Pix' }).click()

  const protocolo = page.locator('[data-protocolo]')
  await expect(protocolo).toBeVisible({ timeout: 30_000 })
  const texto = (await protocolo.innerText()).trim()
  expect(texto).toMatch(/DOA-\d{4}-\d{5}/)
  const codigo = /DOA-\d{4}-\d{5}/.exec(texto)![0]
  await expect(
    page.locator('[data-confirmacao-identificada] [data-codigo-pix]'),
  ).not.toBeEmpty()
  await expect(
    page.locator('[data-confirmacao-identificada] svg[data-qr-pix]'),
  ).toBeVisible()
  await expect(page.locator('[data-aviso-de-pagamento]')).toBeVisible()
  await ver(page, info, 'protocolo-e-codigo-pix')

  // a conferência da tesouraria enxerga o pedido que veio do site
  const r = await page.request.get(
    `${API_HML}/api/intencoes-doacao/?busca=${codigo}&por_pagina=5`,
    { headers: cabecalho() },
  )
  expect(r.status()).toBe(200)
  const { itens } = (await r.json()) as {
    itens: Array<{ protocolo: string; status: string; email_doador: string }>
  }
  const dele = itens.find((i) => i.protocolo === codigo)
  expect(dele?.status).toBe('PENDENTE')
  expect(dele?.email_doador).toBe(email)

  expect(await violacoesDa(page)).toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('se a Presidência desmarca "vai para o site" na Chave Pix, a página fecha sozinha (e o roteiro devolve como estava)', async ({
  page,
}, info) => {
  await entrarComoPresidente(page)
  try {
    await marcarChavePixParaOSite(page, false)
    await page.goto(CAMINHO, { waitUntil: 'networkidle' })
    const fechada = page.locator('[data-estado="indisponivel"]')
    await expect(fechada).toBeVisible({ timeout: 30_000 })
    await expect(fechada).toContainText(
      'A doação pelo site ainda não está disponível',
    )
    await expect(identificada(page)).toBeHidden()
    await expect(anonima(page)).toBeHidden()
    await ver(page, info, 'doacao-fechada-chave-nao-marcada')
  } finally {
    await marcarChavePixParaOSite(page, true)
  }
  await abrir(page)
  await expect(identificada(page)).toBeVisible()
})
