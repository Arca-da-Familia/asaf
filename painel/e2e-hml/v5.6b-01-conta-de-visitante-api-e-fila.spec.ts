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

// v5.6b - a CONTA DO VISITANTE (entrar pelo e-mail com um código de uso único, sem senha), provada na homologação de verdade: banco de teste, API de teste, o painel de quem atende.
//  1. preparação: um evento público, uma inscrição pelo formulário público, um pedido de doação que fica esperando e outro que a tesouraria confirma (com recibo), todos com o MESMO e-mail;
//  2. pedir o código: a resposta é IDÊNTICA para um e-mail com vínculo e para um sem (só a variável de teste da homologação devolve o código, e só para quem tem vínculo);
//  3. entrar: código errado, de e-mail sem vínculo e certo; a conta mostra a inscrição (com o link secreto), a doação pendente SEM recibo e a confirmada COM recibo, sem CPF nem telefone;
//     a sessão do visitante não abre o painel e o token do painel não abre a conta;
//  4. uso único, cinco erros queimam o código, o quarto pedido na hora é recusado (429) para qualquer e-mail;
//  5. pedir a eliminação dos dados: UM pedido de titular (eliminação) na fila de atendimento (visto na tela, com o e-mail provado pelo código), o segundo pedido devolve o mesmo protocolo, e a
//     Auditoria guarda o fato sem o e-mail; 6. sair encerra a sessão.
// Fica na homologação, para explorar: a inscrição, as duas doações e o pedido de eliminação do visitante de teste. O que o VISITANTE vê no site é o v5.6b-02.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

let autorizacao = ''
let ipDaVez = 0
const cabecalho = () => ({ Authorization: autorizacao })
/** Cada pedido sai de um endereço novo: a homologação confia no primeiro item do cabeçalho (o limite é por IP). */
const novoIp = () => `10.58.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`

const EMAIL = `visitante.${RODADA}@example.com`
const SEM_VINCULO = `ninguem.${RODADA}@example.com`
const CPF = cpfValido(RODADA % 999_999_999)
const TELEFONE = '11988887777'
const TITULO_DO_EVENTO = `Robô conta de visitante ${RODADA}`
const MENSAGEM_DO_CODIGO_INVALIDO =
  'Código inválido ou vencido: confira os números ou peça um novo código.'

type PedidoDeCodigo = {
  mensagem: string
  minutos_de_validade: number
  codigo_de_teste?: string
}
type Conta = {
  email: string
  sessao_expira_em: string
  inscricoes: Array<{
    status: string
    primeiro_nome: string
    codigo_checkin: string | null
    pode_cancelar: boolean
    token: string | null
    evento: { titulo: string }
  }>
  certificados: unknown[]
  doacoes: Array<{
    protocolo: string
    situacao: string
    valor_recebido: number | null
    numero_do_recibo: number | null
  }>
  pedido_de_apagamento: { protocolo: string; prazo_em: string } | null
}

async function entrarComoPresidente(page: Page): Promise<void> {
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
}

async function pedirCodigo(page: Page, email: string, extra = {}) {
  return page.request.post(`${API_HML}/api/publico/visitante/codigo`, {
    headers: { 'X-Forwarded-For': novoIp() },
    data: { email, ...extra },
  })
}

async function entrarComCodigo(page: Page, email: string, codigo: string) {
  return page.request.post(`${API_HML}/api/publico/visitante/entrar`, {
    headers: { 'X-Forwarded-For': novoIp() },
    data: { email, codigo },
  })
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

async function conta(page: Page, token: string): Promise<Conta> {
  const r = await page.request.get(`${API_HML}/api/visitante/minha-conta`, {
    headers: bearer(token),
  })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()) as Conta
}

let protocoloPendente = ''
let protocoloConfirmado = ''
let protocoloDoApagamento = ''
/** A sessão aberta no teste de entrar: os testes seguintes a reusam (o limite é de 3 pedidos de código por e-mail na hora). */
let tokenDaConta = ''

test('preparar: evento público, inscrição pelo formulário público e dois pedidos de doação com o mesmo e-mail', async ({
  page,
}) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)

  // o Pix aberto para o site (o que a Presidência faz em Instituição), para o pedido de doação existir
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
      descricao: 'Evento de teste da conta do visitante.',
      categoria: 'PALESTRA',
      data_hora_inicio: new Date(Date.now() + 12 * 86_400_000)
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
        nome_completo: 'Visitante Robô da Silva',
        cpf: CPF,
        email: EMAIL,
        telefone: TELEFONE,
        consentimento_lgpd: true,
        versao_texto_consentimento: consentimento.versao,
      },
    },
  )
  expect(inscricao.status(), await inscricao.text()).toBe(200)

  const publica = (await (
    await page.request.get(`${API_HML}/api/publico/doacao`)
  ).json()) as { versao_aviso_de_privacidade: string }
  for (const valor of [30, 50]) {
    const r = await page.request.post(
      `${API_HML}/api/publico/doacoes/intencoes`,
      {
        headers: { 'X-Forwarded-For': novoIp() },
        data: {
          nome_completo: 'Visitante Robô da Silva',
          email: EMAIL,
          valor,
          consentimento_lgpd: true,
          versao_texto_consentimento: publica.versao_aviso_de_privacidade,
        },
      },
    )
    expect(r.status(), await r.text()).toBe(200)
    const { protocolo } = (await r.json()) as { protocolo: string }
    if (valor === 30) protocoloPendente = protocolo
    else protocoloConfirmado = protocolo
  }

  // a tesouraria confirma o segundo (com o valor RECEBIDO, que pode ser diferente do informado): nasce o recibo
  const lista = await page.request.get(
    `${API_HML}/api/intencoes-doacao/?busca=${protocoloConfirmado}&por_pagina=5`,
    { headers: cabecalho() },
  )
  const { itens } = (await lista.json()) as {
    itens: Array<{ id_intencao: number; protocolo: string }>
  }
  const dela = itens.find((i) => i.protocolo === protocoloConfirmado)
  expect(dela, 'a conferência lista o pedido').toBeDefined()
  const confirmada = await page.request.post(
    `${API_HML}/api/intencoes-doacao/${dela!.id_intencao}/confirmar`,
    {
      headers: cabecalho(),
      data: {
        valor_recebido: 45,
        id_conta_contabil: 1,
        id_conta_contabil_caixa: 2,
      },
    },
  )
  expect(confirmada.status(), await confirmada.text()).toBe(200)
  expect(vigia.problemas()).toEqual([])
})

test('pedir o código: a resposta é a mesma com ou sem vínculo, e só quem tem vínculo recebe o código', async ({
  page,
}) => {
  const com = await pedirCodigo(page, EMAIL)
  const sem = await pedirCodigo(page, SEM_VINCULO)
  expect(com.status()).toBe(200)
  expect(sem.status()).toBe(200)
  const { codigo_de_teste: codigoDeQuemTem, ...restoCom } =
    (await com.json()) as PedidoDeCodigo
  const { codigo_de_teste: codigoDeQuemNaoTem, ...restoSem } =
    (await sem.json()) as PedidoDeCodigo
  expect(restoSem, 'quem está de fora não descobre se há vínculo').toEqual(
    restoCom,
  )
  expect(restoCom.minutos_de_validade).toBe(10)
  expect(codigoDeQuemTem, 'a homologação devolve o código de teste').toMatch(
    /^\d{6}$/,
  )
  expect(
    codigoDeQuemNaoTem,
    'para quem não tem vínculo não há código nenhum',
  ).toBeUndefined()

  // e-mail com erro de escrita: recusado em português, antes de qualquer coisa
  const torto = await pedirCodigo(page, 'isto-nao-e-email')
  expect(torto.status()).toBe(422)
  expect(await torto.text()).toContain('e-mail')

  // armadilha de robô: finge sucesso e não faz nada
  const armadilha = await pedirCodigo(page, EMAIL, {
    pagina_web: 'http://spam.example',
  })
  expect(armadilha.status()).toBe(200)
  expect(
    ((await armadilha.json()) as PedidoDeCodigo).codigo_de_teste,
  ).toBeUndefined()
})

test('entrar: código errado, de e-mail sem vínculo e certo; a conta mostra só o que é do e-mail, sem CPF nem telefone', async ({
  page,
}) => {
  // o código do pedido anterior foi gasto pelo próprio teste anterior? Não: aqui se pede um novo (o anterior deixa de valer)
  const pedido = await pedirCodigo(page, EMAIL)
  const { codigo_de_teste: codigo } = (await pedido.json()) as PedidoDeCodigo
  expect(codigo).toMatch(/^\d{6}$/)

  const errado = await entrarComCodigo(
    page,
    EMAIL,
    codigo === '000000' ? '111111' : '000000',
  )
  expect(errado.status()).toBe(400)
  expect(((await errado.json()) as { detail: string }).detail).toBe(
    MENSAGEM_DO_CODIGO_INVALIDO,
  )
  const semVinculo = await entrarComCodigo(page, SEM_VINCULO, codigo!)
  expect(semVinculo.status()).toBe(400)
  expect(((await semVinculo.json()) as { detail: string }).detail).toBe(
    MENSAGEM_DO_CODIGO_INVALIDO,
  )

  const certo = await entrarComCodigo(page, EMAIL, codigo!)
  expect(certo.status(), await certo.text()).toBe(200)
  const { token, expira_em: expiraEm } = (await certo.json()) as {
    token: string
    expira_em: string
  }
  const minutos = (Date.parse(`${expiraEm}Z`) - Date.now()) / 60_000
  expect(minutos, 'a sessão é curta (60 minutos)').toBeGreaterThan(55)
  expect(minutos).toBeLessThanOrEqual(61)

  // o código serve uma vez só
  const denovo = await entrarComCodigo(page, EMAIL, codigo!)
  expect(denovo.status()).toBe(400)

  tokenDaConta = token
  const minhaConta = await conta(page, token)
  expect(minhaConta.email).toBe(EMAIL)
  expect(minhaConta.inscricoes).toHaveLength(1)
  const inscricao = minhaConta.inscricoes[0]!
  expect(inscricao.evento.titulo).toBe(TITULO_DO_EVENTO)
  expect(inscricao.primeiro_nome).toBe('Visitante')
  expect(inscricao.pode_cancelar).toBe(true)
  expect(
    inscricao.token,
    'o link secreto só vem quando há o que fazer',
  ).toMatch(/^[A-Za-z0-9_-]{8,}$/)
  expect(inscricao.codigo_checkin).toMatch(/^[0-9A-F]{8}$/)
  expect(minhaConta.certificados).toEqual([])

  const doacoes = Object.fromEntries(
    minhaConta.doacoes.map((d) => [d.protocolo, d]),
  )
  expect(Object.keys(doacoes).sort()).toEqual(
    [protocoloPendente, protocoloConfirmado].sort(),
  )
  expect(doacoes[protocoloPendente]!.situacao).toBe('PENDENTE')
  expect(
    doacoes[protocoloPendente]!.numero_do_recibo,
    'pedido não confirmado não é dinheiro: não há recibo',
  ).toBeNull()
  expect(doacoes[protocoloPendente]!.valor_recebido).toBeNull()
  expect(doacoes[protocoloConfirmado]!.situacao).toBe('CONFIRMADA')
  expect(doacoes[protocoloConfirmado]!.valor_recebido).toBe(45)
  expect(doacoes[protocoloConfirmado]!.numero_do_recibo).not.toBeNull()

  const corpo = JSON.stringify(minhaConta)
  expect(corpo).not.toContain(CPF)
  expect(corpo).not.toContain(CPF.replace(/\D/g, ''))
  expect(corpo).not.toContain(TELEFONE)

  // a sessão do visitante não abre o painel, e o token do painel não abre a conta
  for (const rota of [
    '/api/associados/',
    '/api/atendimentos/',
    '/api/intencoes-doacao/',
  ]) {
    const r = await page.request.get(`${API_HML}${rota}`, {
      headers: bearer(token),
    })
    expect([401, 403], `${rota} com a sessão do visitante`).toContain(
      r.status(),
    )
  }
  const comTokenDoPainel = await page.request.get(
    `${API_HML}/api/visitante/minha-conta`,
    { headers: cabecalho() },
  )
  expect(comTokenDoPainel.status()).toBe(401)
  for (const cab of [{}, bearer('inventado'), { Authorization: 'Basic abc' }]) {
    const r = await page.request.get(`${API_HML}/api/visitante/minha-conta`, {
      headers: cab,
    })
    expect(r.status()).toBe(401)
  }
})

test('cinco erros queimam o código e o quarto pedido do mesmo e-mail na hora é recusado para qualquer e-mail', async ({
  page,
}) => {
  const email = `queima.${RODADA}@example.com`
  const outroSemVinculo = `ninguem2.${RODADA}@example.com`
  // este e-mail precisa de vínculo para receber código: uma inscrição rápida no evento de teste
  const lista = await page.request.get(`${API_HML}/api/publico/eventos`)
  const evento = (
    (await lista.json()) as Array<{ id_evento: number; titulo: string }>
  ).find((e) => e.titulo === TITULO_DO_EVENTO)
  expect(evento, 'o evento de teste aparece na lista pública').toBeDefined()
  const consentimento = (await (
    await page.request.get(`${API_HML}/api/publico/eventos/consentimento-lgpd`)
  ).json()) as { versao: string }
  const inscricao = await page.request.post(
    `${API_HML}/api/publico/eventos/${evento!.id_evento}/inscrever-se`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: {
        nome_completo: 'Visitante Queima Robô',
        cpf: cpfValido((RODADA + 7) % 999_999_999),
        email,
        telefone: TELEFONE,
        consentimento_lgpd: true,
        versao_texto_consentimento: consentimento.versao,
      },
    },
  )
  expect(inscricao.status(), await inscricao.text()).toBe(200)

  const pedido = await pedirCodigo(page, email)
  const { codigo_de_teste: certo } = (await pedido.json()) as PedidoDeCodigo
  expect(certo).toMatch(/^\d{6}$/)
  const errado = certo === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i += 1) {
    expect((await entrarComCodigo(page, email, errado)).status()).toBe(400)
  }
  const tardio = await entrarComCodigo(page, email, certo!)
  expect(
    tardio.status(),
    'cinco erros queimaram o código, até para quem acerta',
  ).toBe(400)
  expect(((await tardio.json()) as { detail: string }).detail).toBe(
    MENSAGEM_DO_CODIGO_INVALIDO,
  )

  // pedir um novo resolve (2º pedido), e um novo pedido invalida o anterior (3º)
  const segundo = (
    (await (await pedirCodigo(page, email)).json()) as PedidoDeCodigo
  ).codigo_de_teste!
  const terceiro = (
    (await (await pedirCodigo(page, email)).json()) as PedidoDeCodigo
  ).codigo_de_teste!
  if (segundo !== terceiro) {
    expect(
      (await entrarComCodigo(page, email, segundo)).status(),
      'o código anterior morreu',
    ).toBe(400)
  }
  expect((await entrarComCodigo(page, email, terceiro)).status()).toBe(200)

  // o 4º pedido na hora: 429, igual para o e-mail que não tem vínculo nenhum
  for (const alvo of [email, outroSemVinculo]) {
    let ultimo = 200
    for (let i = alvo === email ? 3 : 0; i < 4; i += 1) {
      ultimo = (await pedirCodigo(page, alvo)).status()
    }
    expect(
      ultimo,
      `o limite vale também para ${alvo === email ? 'quem tem' : 'quem não tem'} vínculo`,
    ).toBe(429)
  }
})

test('pedir a eliminação dos dados: um pedido de titular na fila (visto na tela), o segundo devolve o mesmo, e a Auditoria não guarda o e-mail', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = tokenDaConta
  expect(token, 'a sessão do teste de entrar').not.toBe('')

  const primeiro = await page.request.post(
    `${API_HML}/api/visitante/pedir-apagamento`,
    { headers: bearer(token) },
  )
  expect(primeiro.status(), await primeiro.text()).toBe(200)
  const corpo = (await primeiro.json()) as {
    protocolo: string
    prazo_dias: number
    ja_existia: boolean
  }
  expect(corpo.protocolo).toMatch(/^ASAF-\d{4}-\d{5}$/)
  expect(corpo.prazo_dias).toBe(15)
  expect(corpo.ja_existia).toBe(false)
  protocoloDoApagamento = corpo.protocolo

  const segundo = await page.request.post(
    `${API_HML}/api/visitante/pedir-apagamento`,
    { headers: bearer(token) },
  )
  const dois = (await segundo.json()) as {
    protocolo: string
    ja_existia: boolean
  }
  expect(dois.protocolo, 'um pedido só, não vários').toBe(protocoloDoApagamento)
  expect(dois.ja_existia).toBe(true)
  expect((await conta(page, token)).pedido_de_apagamento?.protocolo).toBe(
    protocoloDoApagamento,
  )

  // a fila de atendimento, na tela de quem atende
  await entrarComoPresidente(page)
  await page
    .getByRole('link', { name: /^Atendimento/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Atendimento', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Buscar atendimento').fill(protocoloDoApagamento)
  const cartao = page.getByRole('listitem', {
    name: `Atendimento ${protocoloDoApagamento}`,
  })
  await expect(cartao).toBeVisible()
  await expect(cartao).toContainText('Solicitação de titular de dados (LGPD)')
  await expect(cartao).toContainText('Novo')
  await expect(cartao).toContainText(/Vence em (14|15) dias/)
  await ver(page, info, 'fila-com-o-pedido-do-visitante')

  // o pedido por dentro (a API que a tela usa): o direito, o e-mail provado pelo código e o que pede
  const achados = await page.request.get(
    `${API_HML}/api/atendimentos/?busca=${protocoloDoApagamento}&por_pagina=5`,
    { headers: cabecalho() },
  )
  const { itens } = (await achados.json()) as {
    itens: Array<{
      id_atendimento: number
      protocolo: string
      subtipo: string
      tipo: string
    }>
  }
  const dele = itens.find((i) => i.protocolo === protocoloDoApagamento)
  expect(dele?.tipo).toBe('TITULAR_LGPD')
  expect(dele?.subtipo).toBe('ELIMINACAO')
  const aberto = await page.request.get(
    `${API_HML}/api/atendimentos/${dele!.id_atendimento}`,
    { headers: cabecalho() },
  )
  const detalhe = (await aberto.json()) as {
    mensagem: string
    email_contato: string
  }
  expect(detalhe.email_contato).toBe(EMAIL)
  expect(detalhe.mensagem).toContain('confirmado por código de uso único')
  expect(detalhe.mensagem).toContain('recibos')

  // a Auditoria: o fato e o IP, sem o e-mail e sem usuário
  for (const [tabela, acao] of [
    ['atendimentos', 'VISITANTE_PEDIU_APAGAMENTO'],
    ['sessoes_de_visitante', 'VISITANTE_ENTROU'],
  ]) {
    const r = await page.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=${tabela}&acao=${acao}&por_pagina=200`,
      { headers: cabecalho() },
    )
    expect(r.status()).toBe(200)
    const { entradas } = (await r.json()) as {
      entradas: Array<{ id_usuario: number | null; acao: string }>
    }
    expect(entradas.length, `${acao} na Auditoria`).toBeGreaterThan(0)
    expect(entradas.every((e) => e.id_usuario === null)).toBe(true)
    expect(JSON.stringify(entradas)).not.toContain(EMAIL)
  }
  expect(vigia.problemas()).toEqual([])
})

test('sair encerra a sessão: a conta passa a recusar o mesmo token', async ({
  page,
}) => {
  const token = tokenDaConta
  expect((await conta(page, token)).email).toBe(EMAIL)
  const saiu = await page.request.post(`${API_HML}/api/visitante/sair`, {
    headers: bearer(token),
  })
  expect(saiu.status()).toBe(200)
  for (const r of [
    await page.request.get(`${API_HML}/api/visitante/minha-conta`, {
      headers: bearer(token),
    }),
    await page.request.post(`${API_HML}/api/visitante/sair`, {
      headers: bearer(token),
    }),
    await page.request.post(`${API_HML}/api/visitante/pedir-apagamento`, {
      headers: bearer(token),
    }),
  ]) {
    expect(r.status()).toBe(401)
  }
})
