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

// v5.7f - o que a PESSOA faz no site de teste (hml-site), num navegador de verdade, DEPOIS de a homologação ser publicada (o site é construído no Deploy Homologação): a página da solicitação do
// titular explica como a identidade é conferida e como a resposta chega (e exige o e-mail), a confirmação do pedido diz que a resposta NÃO vai por e-mail, e a área Minha conta mostra os pedidos sobre dados
// pessoais (a resposta da equipe, o pedido em andamento e o encerrado com o motivo), com o texto da equipe sempre como TEXTO (nunca como HTML). Confere também a Política de Privacidade 2.3
// (o parágrafo novo) e a política de conteúdo (nenhuma violação).
// O robô prepara três pedidos pela API (respondido, em andamento, encerrado) para a pessoa ver os três estados. Fica na homologação, para explorar.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const CAMINHO_DO_FORMULARIO = `${SITE}/privacidade/solicitacao-do-titular/`
const EMAIL = `titular.site.${RODADA}@example.com`
const EMAIL_DO_FORMULARIO = `titular.formulario.${RODADA}@example.com`
const CPF = cpfValido((RODADA + 47) % 999_999_999).replace(/\D/g, '')
const NOME = `Titular Site ${RODADA}`
const VERSAO_DO_AVISO = '2'
const RESPOSTA = `Guardamos o seu <strong>nome</strong> e o seu e-mail (${RODADA}).\nNão guardamos o seu CPF completo.`
const MOTIVO = 'Não foi possível conferir a identidade de quem fez o pedido.'
const CODIGO_DA_PAGINA =
  'E-mail usado na inscrição, na doação ou no pedido sobre dados pessoais'

let autorizacao = ''
let ipDaVez = 0
const cabecalho = () => ({ Authorization: autorizacao })
const novoIp = () => `10.61.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`

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

let protocoloRespondido = ''
let protocoloEmAndamento = ''
let protocoloEncerrado = ''

async function pedidoDoTitular(
  page: Page,
  subtipo: string,
): Promise<{ protocolo: string; id: number }> {
  const r = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    headers: { 'X-Forwarded-For': novoIp() },
    data: {
      tipo: 'TITULAR_LGPD',
      subtipo,
      cpf: CPF,
      email_contato: EMAIL,
      nome_completo: NOME,
      mensagem: `Pedido do robô do site (${subtipo}) para ver a Minha conta, rodada ${RODADA}.`,
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO,
    },
  })
  expect(r.status(), await r.text()).toBe(200)
  const { protocolo } = (await r.json()) as { protocolo: string }
  const achados = await page.request.get(
    `${API_HML}/api/atendimentos/?busca=${protocolo}&por_pagina=5`,
    { headers: cabecalho() },
  )
  const { itens } = (await achados.json()) as {
    itens: Array<{ id_atendimento: number; protocolo: string }>
  }
  const id = itens.find((i) => i.protocolo === protocolo)!.id_atendimento
  return { protocolo, id }
}

test('preparar: três pedidos sobre dados pessoais do mesmo e-mail (respondido depois de validar a identidade, em andamento e encerrado com o motivo)', async ({
  page,
}) => {
  await entrarComoPresidente(page)

  const respondido = await pedidoDoTitular(page, 'ACESSO')
  protocoloRespondido = respondido.protocolo
  const validou = await page.request.post(
    `${API_HML}/api/atendimentos/${respondido.id}/validar-identidade`,
    {
      headers: cabecalho(),
      data: { nota: 'Conferi o documento com foto na secretaria (robô).' },
    },
  )
  expect(validou.status(), await validou.text()).toBe(200)
  const respondeu = await page.request.post(
    `${API_HML}/api/atendimentos/${respondido.id}/responder`,
    { headers: cabecalho(), data: { resposta: RESPOSTA } },
  )
  expect(respondeu.status(), await respondeu.text()).toBe(200)

  protocoloEmAndamento = (await pedidoDoTitular(page, 'CORRECAO')).protocolo

  const encerrado = await pedidoDoTitular(page, 'PORTABILIDADE')
  protocoloEncerrado = encerrado.protocolo
  const encerrou = await page.request.post(
    `${API_HML}/api/atendimentos/${encerrado.id}/encerrar`,
    { headers: cabecalho(), data: { motivo: MOTIVO } },
  )
  expect(encerrou.status(), await encerrou.text()).toBe(200)
})

test('a página da solicitação do titular: explica o caminho em três passos, pede o e-mail como obrigatório e a confirmação diz que a resposta não vai por e-mail', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await vigiarViolacoes(page)
  const resposta = await page.goto(CAMINHO_DO_FORMULARIO, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)

  const secao = page.locator('[data-como-a-resposta-chega]')
  await expect(
    secao.getByRole('heading', { name: 'Como a resposta chega até você' }),
  ).toBeVisible()
  await expect(secao.locator('ol > li')).toHaveCount(3)
  await expect(secao).toContainText(
    'Se o e-mail é o do seu cadastro de associado',
  )
  await expect(secao).toContainText('A resposta não vai nesse e-mail')
  await ver(page, info, 'pagina-do-titular-como-a-resposta-chega')

  const form = page.locator('form[data-atendimento-form]')
  await expect(form.getByLabel('E-mail (obrigatório)')).toBeVisible()
  await expect(
    form.getByText('O e-mail é obrigatório: a resposta sobre os seus dados'),
  ).toBeVisible()

  // só telefone: a página recusa antes de ir à API
  let foiParaAApi = false
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/publico/atendimentos'))
      foiParaAApi = true
  })
  await form.getByLabel('Nome completo').fill(NOME)
  await form.getByLabel('Telefone/WhatsApp').fill('91988887777')
  await form.getByLabel('CPF').fill(CPF)
  await form.getByLabel('O que você quer pedir').selectOption('ACESSO')
  await form
    .getByLabel('Mensagem')
    .fill('Quero saber quais dados a associação guarda sobre mim.')
  await form.getByLabel('Li e aceito o aviso de privacidade.').check()
  await form.getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(form.locator('[data-erro="email_contato"]')).toContainText(
    'Informe o seu e-mail',
  )
  expect(foiParaAApi, 'nada foi para a API sem e-mail').toBe(false)
  await ver(page, info, 'titular-sem-email-recusada-na-pagina')

  // com e-mail: o pedido segue e a confirmação promete a Minha conta, não o e-mail
  await form.getByLabel('E-mail (obrigatório)').fill(EMAIL_DO_FORMULARIO)
  await form.getByRole('button', { name: 'Enviar pedido' }).click()
  const aviso = page
    .getByRole('status')
    .filter({ hasText: 'Recebemos o seu pedido.' })
  await expect(aviso).toBeVisible({ timeout: 60_000 })
  await expect(aviso.locator('[data-protocolo]')).toHaveText(
    /^ASAF-\d{4}-\d{5}$/,
  )
  const frase = aviso.locator('[data-resposta-do-titular]')
  await expect(frase).toContainText('não vai por e-mail')
  await expect(
    frase.getByRole('link', { name: 'Minha conta' }),
  ).toHaveAttribute('href', '/minha-conta/')
  await ver(page, info, 'titular-enviada-confirmacao-na-minha-conta')
  expect(await violacoesDa(page), 'política de conteúdo').toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('a Minha conta mostra os pedidos sobre dados pessoais: a resposta (texto, nunca HTML), o pedido em andamento e o encerrado com o motivo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await vigiarViolacoes(page)
  await page.goto(`${SITE}/minha-conta/`, { waitUntil: 'networkidle' })
  await page.getByLabel(CODIGO_DA_PAGINA).fill(EMAIL)
  const pedido = page.waitForResponse((r) =>
    r.url().endsWith('/api/publico/visitante/codigo'),
  )
  await page
    .getByRole('button', { name: 'Receber o código por e-mail' })
    .click()
  const { codigo_de_teste: codigo } = (await (await pedido).json()) as {
    codigo_de_teste?: string
  }
  expect(
    codigo,
    'a API de teste devolve o código (o pedido do titular abre a conta)',
  ).toMatch(/^\d{6}$/)
  await expect(tela(page, 'codigo')).toBeVisible()
  await page.getByLabel('Código de 6 números').fill(codigo!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(tela(page, 'conta')).toBeVisible({ timeout: 30_000 })

  await expect(
    page.getByRole('heading', { name: 'Meus pedidos sobre dados pessoais' }),
  ).toBeVisible()
  await expect(
    page.getByText('ela nunca vai por e-mail', { exact: false }),
  ).toBeVisible()
  const pedidos = page.locator('[data-lista="pedidos-do-titular"] > li')
  await expect(pedidos).toHaveCount(3)

  const respondido = pedidos.filter({ hasText: protocoloRespondido })
  await expect(respondido).toContainText('Respondido')
  await expect(respondido).toContainText('Acessar os dados que a associação')
  const resposta = respondido.locator('[data-p-resposta]')
  await expect(resposta).toContainText('Guardamos o seu <strong>nome</strong>')
  await expect(resposta).toContainText('Não guardamos o seu CPF completo.')
  await expect(
    resposta.locator('strong'),
    'o texto da equipe nunca vira HTML',
  ).toHaveCount(0)
  await expect(respondido.locator('[data-p-resposta-rotulo]')).toHaveText(
    'Resposta da associação',
  )

  const andamento = pedidos.filter({ hasText: protocoloEmAndamento })
  await expect(andamento).toContainText('Em andamento')
  await expect(andamento.locator('[data-p-explicacao]')).toContainText(
    'confere que quem pediu é o titular dos dados',
  )
  await expect(andamento.locator('[data-p-resposta-caixa]')).toBeHidden()

  const encerrado = pedidos.filter({ hasText: protocoloEncerrado })
  await expect(encerrado).toContainText('Encerrado')
  await expect(encerrado.locator('[data-p-resposta-rotulo]')).toHaveText(
    'Motivo do encerramento',
  )
  await expect(encerrado.locator('[data-p-resposta]')).toHaveText(MOTIVO)
  await ver(page, info, 'minha-conta-com-os-pedidos-do-titular')

  // o CPF e o texto do pedido nunca chegam à página
  const corpo = (await page.locator('body').innerText()).toLowerCase()
  expect(corpo).not.toContain(CPF)
  expect(corpo).not.toContain('pedido do robô do site')

  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(tela(page, 'email')).toBeVisible()
  await expect(
    page.locator('[data-lista="pedidos-do-titular"] > li'),
  ).toHaveCount(0)
  expect(await violacoesDa(page), 'política de conteúdo').toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('a Política de Privacidade 2.3 tem o parágrafo de como a identidade é conferida e como a resposta chega, e a conta passa a mostrar a resposta', async ({
  page,
}) => {
  await vigiarViolacoes(page)
  const resposta = await page.goto(`${SITE}/privacidade/`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)
  await expect(page.getByText(/Versão 2\.\d+ · em vigor desde /)).toBeVisible()
  const trecho = page.locator('[data-identidade-do-titular]')
  await expect(trecho).toBeVisible()
  await expect(trecho).toContainText(
    'depois de a ASAF conferir a identidade de quem pediu',
  )
  await expect(trecho).toContainText('A resposta não vai por e-mail')
  await expect(trecho).toContainText('o sistema não deixa a equipe responder')
  const conta = page.locator('[data-conta-visitante-politica]')
  await expect(conta).toContainText(
    'solicitação do titular de dados feita com ele',
  )
  await expect(conta).toContainText('já nasce com a identidade validada')
  expect(await violacoesDa(page), 'política de conteúdo').toEqual([])
})
