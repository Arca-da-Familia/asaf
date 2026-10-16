import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.6b - o que o VISITANTE faz no site de teste (hml-site), num navegador de verdade, DEPOIS de a homologação ser publicada (o site é construído no Deploy Homologação): entra em /minha-conta/
// com o e-mail e o código (a API de teste devolve o código na resposta; o robô o lê da rede, como um e-mail faria), vê a inscrição, o pedido de doação que espera a tesouraria (sem recibo),
// abre o link de cancelar (sem cancelar) e volta com a sessão ainda valendo, pede a eliminação dos dados (dois passos) e sai: a sessão some da aba e os dados saem da tela.
// Confere ainda a política de conteúdo (nenhuma violação), a Política de Privacidade 2.2 com o trecho da conta e o link no rodapé.
// Fica na homologação, para explorar: a inscrição, o pedido de doação e o pedido de eliminação do visitante de teste.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const CAMINHO = `${SITE}/minha-conta/`
const EMAIL = `visitante.site.${RODADA}@example.com`
const TITULO_DO_EVENTO = `Robô conta no site ${RODADA}`
const MENSAGEM_DO_CODIGO_INVALIDO =
  'Código inválido ou vencido: confira os números ou peça um novo código.'

let autorizacao = ''
let ipDaVez = 0
const cabecalho = () => ({ Authorization: autorizacao })
const novoIp = () => `10.59.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`

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

const tela = (page: Page, estado: string) =>
  page.locator(`[data-estado="${estado}"]`)

let protocoloDoPedidoDeDoacao = ''
let protocoloDoApagamento = ''

test('preparar: evento público, inscrição e um pedido de doação com o e-mail do visitante de teste', async ({
  page,
}) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
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
  const criado = await page.request.post(`${API_HML}/api/eventos/`, {
    headers: cabecalho(),
    data: {
      titulo: TITULO_DO_EVENTO,
      descricao: 'Evento de teste da conta do visitante no site.',
      categoria: 'PALESTRA',
      data_hora_inicio: new Date(Date.now() + 14 * 86_400_000)
        .toISOString()
        .slice(0, 19),
      endereco_avulso: 'Salão da ASAF (teste)',
      gratuito: true,
      visibilidade: 'Pública',
    },
  })
  expect(criado.status(), await criado.text()).toBe(200)
  const idEvento = ((await criado.json()) as { id_evento: number }).id_evento
  const consentimento = (await (
    await page.request.get(`${API_HML}/api/publico/eventos/consentimento-lgpd`)
  ).json()) as { versao: string }
  const inscricao = await page.request.post(
    `${API_HML}/api/publico/eventos/${idEvento}/inscrever-se`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: {
        nome_completo: 'Visitante do Site Robô',
        cpf: cpfValido((RODADA + 3) % 999_999_999),
        email: EMAIL,
        telefone: '11988887777',
        consentimento_lgpd: true,
        versao_texto_consentimento: consentimento.versao,
      },
    },
  )
  expect(inscricao.status(), await inscricao.text()).toBe(200)
  const publica = (await (
    await page.request.get(`${API_HML}/api/publico/doacao`)
  ).json()) as { versao_aviso_de_privacidade: string }
  const pedido = await page.request.post(
    `${API_HML}/api/publico/doacoes/intencoes`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: {
        nome_completo: 'Visitante do Site Robô',
        email: EMAIL,
        valor: 25,
        consentimento_lgpd: true,
        versao_texto_consentimento: publica.versao_aviso_de_privacidade,
      },
    },
  )
  expect(pedido.status(), await pedido.text()).toBe(200)
  protocoloDoPedidoDeDoacao = ((await pedido.json()) as { protocolo: string })
    .protocolo
  expect(vigia.problemas()).toEqual([])
})

test('o visitante entra pelo e-mail e o código, vê a conta, abre o link de cancelar sem cancelar, pede a eliminação e sai', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await vigiarViolacoes(page)

  const resposta = await page.goto(CAMINHO, { waitUntil: 'networkidle' })
  expect(resposta?.status()).toBe(200)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Minha conta' }),
  ).toBeVisible()
  await expect(tela(page, 'email')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  )
  await ver(page, info, 'tela-do-e-mail')

  // e-mail torto: a página recusa antes de ir à API
  await page.getByLabel('E-mail usado na inscrição ou na doação').fill('torto')
  await page
    .getByRole('button', { name: 'Receber o código por e-mail' })
    .click()
  await expect(
    page.getByText(
      'Esse e-mail não parece certo: confira se está escrito sem erro.',
    ),
  ).toBeVisible()

  // o pedido de verdade: o robô lê o código da resposta de teste (um e-mail faria o mesmo papel)
  await page.getByLabel('E-mail usado na inscrição ou na doação').fill(EMAIL)
  const pedido = page.waitForResponse((r) =>
    r.url().endsWith('/api/publico/visitante/codigo'),
  )
  await page
    .getByRole('button', { name: 'Receber o código por e-mail' })
    .click()
  const { codigo_de_teste: codigo } = (await (await pedido).json()) as {
    codigo_de_teste?: string
  }
  expect(codigo, 'a API de teste devolve o código').toMatch(/^\d{6}$/)
  await expect(tela(page, 'codigo')).toBeVisible()
  await expect(page.locator('[data-email-informado]')).toHaveText(EMAIL)
  await ver(page, info, 'tela-do-codigo')

  // código errado: a frase única
  await page
    .getByLabel('Código de 6 números')
    .fill(codigo === '000000' ? '111111' : '000000')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByText(MENSAGEM_DO_CODIGO_INVALIDO)).toBeVisible()

  // o código certo
  await page.getByLabel('Código de 6 números').fill(codigo!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(tela(page, 'conta')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-email-da-conta]')).toHaveText(EMAIL)
  await expect(page.locator('[data-fim-da-sessao]')).toContainText(
    'horário de Belém',
  )

  const inscricoes = page.locator('[data-lista="inscricoes"] > li')
  await expect(inscricoes).toHaveCount(1)
  await expect(inscricoes.first()).toContainText(TITULO_DO_EVENTO)
  await expect(inscricoes.first()).toContainText('Visitante')
  await expect(inscricoes.first().locator('[data-i-codigo]')).toHaveText(
    /^[0-9A-F]{8}$/,
  )
  const doacoes = page.locator('[data-lista="doacoes"] > li')
  await expect(doacoes).toHaveCount(1)
  await expect(doacoes.first()).toContainText(protocoloDoPedidoDeDoacao)
  await expect(doacoes.first()).toContainText('Ainda sem recibo')
  await expect(doacoes.first()).toContainText('Até lá não há recibo')
  await expect(page.locator('[data-lista="certificados"] > li')).toHaveCount(0)
  await expect(page.locator('[data-vazio="certificados"]')).toBeVisible()
  await ver(page, info, 'a-conta-do-visitante')

  // a sessão fica só na aba; o endereço nunca a leva
  expect(page.url()).toBe(CAMINHO)
  const guardado = await page.evaluate(() => ({
    sessao: sessionStorage.getItem('asaf-conta-visitante'),
    local: Object.keys(localStorage),
    cookies: document.cookie,
  }))
  expect(guardado.sessao).toBeTruthy()
  expect(guardado.local).toEqual([])
  expect(guardado.cookies).toBe('')

  // abrir o que a tela oferece: o link de cancelar leva à página da inscrição (sem cancelar) e a sessão continua valendo ao voltar
  const cancelar = inscricoes
    .first()
    .getByRole('link', { name: 'Cancelar a minha inscrição' })
  await expect(cancelar).toHaveAttribute(
    'href',
    /^\/cancelar-inscricao\/\?token=[A-Za-z0-9_-]+$/,
  )
  await cancelar.click()
  await expect(page).toHaveURL(/\/cancelar-inscricao\/\?token=/)
  await expect(
    page.getByRole('button', { name: 'Cancelar a minha inscrição' }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(TITULO_DO_EVENTO)).toBeVisible()
  await ver(page, info, 'link-de-cancelar-aberto-sem-cancelar')
  await page.goBack()
  await expect(tela(page, 'conta')).toBeVisible({ timeout: 30_000 })
  await expect(inscricoes.first()).toContainText('Vaga reservada')

  // pedir a eliminação: dois passos (confirmação), o protocolo e o prazo
  await page
    .getByRole('button', { name: 'Pedir a eliminação dos meus dados' })
    .click()
  await expect(
    page.getByText('Tem certeza? Abriremos um pedido para eliminar'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Não, voltar' }).click()
  await expect(page.locator('[data-passo-de-confirmacao]')).toBeHidden()
  await page
    .getByRole('button', { name: 'Pedir a eliminação dos meus dados' })
    .click()
  await page.getByRole('button', { name: 'Sim, pedir a eliminação' }).click()
  const resultado = page.locator('[data-resultado-do-apagamento]')
  await expect(resultado).toBeVisible({ timeout: 30_000 })
  await expect(resultado).toContainText(/ASAF-\d{4}-\d{5}/)
  await expect(resultado).toContainText('Prazo de resposta: até')
  protocoloDoApagamento =
    (await resultado.locator('[data-protocolo-do-pedido]').textContent()) ?? ''
  expect(protocoloDoApagamento).toMatch(/^ASAF-\d{4}-\d{5}$/)
  await ver(page, info, 'pedido-de-eliminacao-feito')

  // recarregar: a conta volta direto e mostra o pedido em andamento, sem oferecer outro
  await page.reload()
  await expect(tela(page, 'conta')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-apagamento-em-andamento]')).toContainText(
    protocoloDoApagamento,
  )
  await expect(page.locator('[data-apagamento-formulario]')).toBeHidden()

  // sair: volta ao e-mail, avisa, a sessão some da aba e os dados saem da tela
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(tela(page, 'email')).toBeVisible()
  await expect(page.getByText('Você saiu da sua conta.')).toBeVisible()
  expect(
    await page.evaluate(() => sessionStorage.getItem('asaf-conta-visitante')),
  ).toBeNull()
  const texto = (await page.locator('body').textContent()) ?? ''
  expect(texto).not.toContain(TITULO_DO_EVENTO)
  expect(texto).not.toContain(protocoloDoPedidoDeDoacao)
  await ver(page, info, 'depois-de-sair')

  expect(
    await violacoesDa(page),
    'nenhuma violação da política de conteúdo',
  ).toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('o pedido de eliminação feito pelo site chegou à fila de atendimento do painel', async ({
  page,
}) => {
  await entrarComoPresidente(page)
  expect(protocoloDoApagamento).toMatch(/^ASAF-\d{4}-\d{5}$/)
  const r = await page.request.get(
    `${API_HML}/api/atendimentos/?busca=${protocoloDoApagamento}&por_pagina=5`,
    { headers: cabecalho() },
  )
  const { itens } = (await r.json()) as {
    itens: Array<{
      protocolo: string
      tipo: string
      subtipo: string
      email_contato: string
      status: string
    }>
  }
  const dele = itens.find((i) => i.protocolo === protocoloDoApagamento)
  expect(dele?.tipo).toBe('TITULAR_LGPD')
  expect(dele?.subtipo).toBe('ELIMINACAO')
  expect(dele?.email_contato).toBe(EMAIL)
  expect(dele?.status).toBe('Novo')
})

test('a Política de Privacidade 2.2 tem o trecho da conta e o rodapé leva à página', async ({
  page,
}) => {
  const vigia = vigiar(page)
  await vigiarViolacoes(page)
  const resposta = await page.goto(`${SITE}/privacidade/`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)
  await expect(
    page.getByText(/Versão 2\.2 · em vigor desde \d+ de \w+ de 2026/),
  ).toBeVisible()
  const trecho = page.locator('[data-conta-visitante-politica]')
  await expect(trecho).toBeVisible()
  await expect(trecho).toContainText('código de 6 números')
  await expect(trecho).toContainText(
    'vale 10 minutos, serve uma vez e aceita 5 tentativas',
  )
  await expect(trecho).toContainText('nada é apagado na hora')
  await expect(page.locator('[data-prazos-de-guarda] > li')).toHaveCount(7)

  await page.goto(SITE, { waitUntil: 'networkidle' })
  const link = page.locator('footer').getByRole('link', { name: 'Minha conta' })
  await expect(link).toHaveAttribute('href', '/minha-conta/')
  await link.click()
  await expect(page).toHaveURL(/\/minha-conta\/$/)
  await expect(tela(page, 'email')).toBeVisible()
  expect(await violacoesDa(page)).toEqual([])
  expect(vigia.problemas()).toEqual([])
})
