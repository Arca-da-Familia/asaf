import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  cadastrarPelaTela,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.7f - A IDENTIDADE DE QUEM PEDE DADO PESSOAL é validada antes de a equipe responder (decisão do Presidente, 2026-10-19), provado na homologação com a API de teste e a tela de quem atende.
//  1. a solicitação do titular exige e-mail (só telefone é recusado pela API); os outros pedidos seguem aceitando só telefone;
//  2. a DONA do cadastro (associada cadastrada pela tela, com e-mail e CPF) pede com o e-mail do cadastro: a identidade nasce validada sozinha (a tela diz, e a Auditoria guarda o fato SEM usuário),
//     a equipe responde pela tela e a resposta é lida na área Minha conta com o e-mail do pedido (código de uso único);
//  3. um INTRUSO digita o CPF da dona com o e-mail dele: a identidade fica por validar, a tela trava a resposta e o servidor também (400), o intruso entra na Minha conta dele e NÃO vê dado nenhum;
//     a equipe encerra o pedido com o motivo, e o motivo aparece só na Minha conta do intruso (a conta da dona nem lista o pedido dele);
//  4. a dona pede com OUTRO e-mail dela: por validar; a equipe valida pela tela escrevendo o que conferiu (nota curta é recusada), a tela mostra quem e o quê, a Auditoria guarda quem e como (sem
//     o texto da nota), a resposta destrava e aparece na Minha conta daquele e-mail;
//  5. o pedido de eliminação aberto DENTRO da Minha conta já nasce validado pelo código; os outros tipos de pedido (contato) não têm cartão de identidade e respondem como sempre.
// Fica na homologação, para explorar: a associada de teste e os pedidos dela (respondidos, encerrado e validado à mão).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

let autorizacao = ''
let ipDaVez = 0
const cabecalho = () => ({ Authorization: autorizacao })
/** Cada pedido sai de um endereço novo: a homologação confia no primeiro item do cabeçalho (o limite é por IP). */
const novoIp = () => `10.60.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`

const NOME_DA_DONA = `Titular Robô ${RODADA}`
const CPF_DA_DONA = cpfValido((RODADA + 31) % 999_999_999)
const EMAIL_DA_DONA = `titular.dona.${RODADA}@example.com`
const EMAIL_DO_INTRUSO = `titular.intruso.${RODADA}@example.com`
const OUTRO_EMAIL_DA_DONA = `titular.dona.outro.${RODADA}@example.com`
const VERSAO_DO_AVISO = '2'
const RESPOSTA_DA_DONA =
  'Guardamos o seu nome, o seu e-mail e o seu telefone de cadastro. Conferido pela equipe.'
const RESPOSTA_DO_OUTRO_EMAIL =
  'Guardamos o seu cadastro de associada. Resposta entregue só pela área Minha conta.'
const MOTIVO_DO_ENCERRAMENTO =
  'Não foi possível conferir a identidade de quem fez o pedido.'
const NOTA_DE_IDENTIDADE =
  'Conferi o documento com foto da associada na secretaria.'

type PedidoDoTitular = {
  protocolo: string
  o_que_pediu: string | null
  situacao: string
  respondido_em: string | null
  resposta: string | null
  encerrado_em: string | null
  motivo_do_encerramento: string | null
}
type Conta = {
  email: string
  pedidos_do_titular: PedidoDoTitular[]
  pedido_de_apagamento: { protocolo: string } | null
}

let protocoloDaDona = ''
let protocoloDoIntruso = ''
let protocoloDoOutroEmail = ''
let protocoloDoApagamento = ''
let tokenDaDona = ''
let tokenDoIntruso = ''
let tokenDoOutroEmail = ''

async function entrarComoPresidente(page: Page): Promise<void> {
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
}

async function enviarPedido(
  page: Page,
  corpo: Record<string, unknown>,
): Promise<{ status: number; texto: string; protocolo: string }> {
  const r = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    headers: { 'X-Forwarded-For': novoIp() },
    data: {
      mensagem:
        'Quero saber quais dados a associação guarda sobre mim, por favor.',
      nome_completo: NOME_DA_DONA,
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO,
      ...corpo,
    },
  })
  const texto = await r.text()
  let protocolo = ''
  try {
    protocolo = (JSON.parse(texto) as { protocolo?: string }).protocolo ?? ''
  } catch {
    // resposta que não é JSON (erro): fica o texto
  }
  return { status: r.status(), texto, protocolo }
}

const pedidoDoTitular = (
  page: Page,
  email: string,
  subtipo = 'ACESSO',
  cpf = CPF_DA_DONA,
) =>
  enviarPedido(page, {
    tipo: 'TITULAR_LGPD',
    subtipo,
    cpf: cpf.replace(/\D/g, ''),
    email_contato: email,
  })

/** O código de teste só volta na API de teste, e só para e-mail com vínculo. */
async function entrarNaMinhaConta(page: Page, email: string): Promise<string> {
  const pedido = await page.request.post(
    `${API_HML}/api/publico/visitante/codigo`,
    { headers: { 'X-Forwarded-For': novoIp() }, data: { email } },
  )
  expect(pedido.status(), await pedido.text()).toBe(200)
  const { codigo_de_teste: codigo } = (await pedido.json()) as {
    codigo_de_teste?: string
  }
  expect(codigo, `a API de teste devolve o código de ${email}`).toMatch(
    /^\d{6}$/,
  )
  const entrada = await page.request.post(
    `${API_HML}/api/publico/visitante/entrar`,
    { headers: { 'X-Forwarded-For': novoIp() }, data: { email, codigo } },
  )
  expect(entrada.status(), await entrada.text()).toBe(200)
  return ((await entrada.json()) as { token: string }).token
}

async function conta(page: Page, token: string): Promise<Conta> {
  const r = await page.request.get(`${API_HML}/api/visitante/minha-conta`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()) as Conta
}

async function abrirNaFila(
  page: Page,
  protocolo: string,
): Promise<{ cartao: Locator; dentro: Locator }> {
  await page.goto('/atendimentos?situacao=todas')
  await expect(
    page.getByRole('heading', { name: 'Atendimento', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  const cartao = page.getByRole('listitem', {
    name: `Atendimento ${protocolo}`,
  })
  await expect(cartao).toBeVisible()
  await cartao.getByRole('button', { name: 'Abrir' }).click()
  await expect(
    cartao.getByRole('region', { name: 'Mensagem recebida' }),
  ).toBeVisible()
  return { cartao, dentro: cartao }
}

async function idDoAtendimento(page: Page, protocolo: string): Promise<number> {
  const r = await page.request.get(
    `${API_HML}/api/atendimentos/?busca=${protocolo}&por_pagina=5`,
    { headers: cabecalho() },
  )
  const { itens } = (await r.json()) as {
    itens: Array<{ id_atendimento: number; protocolo: string }>
  }
  const achado = itens.find((i) => i.protocolo === protocolo)
  expect(achado, `o pedido ${protocolo} está na fila`).toBeTruthy()
  return achado!.id_atendimento
}

async function auditoria(
  page: Page,
  acao: string,
  idDoRegistro: number,
): Promise<
  Array<{
    id_usuario: number | null
    dados_depois: unknown
    dados_antes: unknown
  }>
> {
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=atendimentos&acao=${acao}&por_pagina=200`,
    { headers: cabecalho() },
  )
  expect(r.status()).toBe(200)
  const { entradas } = (await r.json()) as {
    entradas: Array<{
      id_registro_afetado: number
      id_usuario: number | null
      dados_depois: unknown
      dados_antes: unknown
    }>
  }
  return entradas.filter((e) => e.id_registro_afetado === idDoRegistro)
}

test('preparar: a associada de teste, cadastrada pela tela com e-mail e CPF; a API recusa solicitação do titular sem e-mail e os outros pedidos seguem aceitando só telefone', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
  await cadastrarPelaTela(page, {
    nome: NOME_DA_DONA,
    cpf: CPF_DA_DONA,
    email: EMAIL_DA_DONA,
    nascimento: '1985-03-12',
  })
  await ver(page, info, 'associada-de-teste-cadastrada')

  const semEmail = await enviarPedido(page, {
    tipo: 'TITULAR_LGPD',
    subtipo: 'ACESSO',
    cpf: CPF_DA_DONA.replace(/\D/g, ''),
    telefone_whatsapp: '91988887777',
  })
  expect(semEmail.status, semEmail.texto).toBe(422)
  expect(semEmail.texto).toContain('Informe o seu e-mail')
  expect(semEmail.texto).toContain('Minha conta')

  const contato = await enviarPedido(page, {
    tipo: 'CONTATO',
    assunto: 'Horário de funcionamento',
    telefone_whatsapp: '91988887777',
  })
  expect(contato.status, contato.texto).toBe(200)
  expect(contato.protocolo).toMatch(/^ASAF-\d{4}-\d{5}$/)
  expect(vigia.problemas()).toEqual([])
})

test('a dona pede com o e-mail do cadastro: nasce validada, a equipe responde pela tela e a resposta só é lida na Minha conta', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
  const pedido = await pedidoDoTitular(page, EMAIL_DA_DONA.toUpperCase())
  expect(pedido.status, pedido.texto).toBe(200)
  protocoloDaDona = pedido.protocolo
  const id = await idDoAtendimento(page, protocoloDaDona)

  const { dentro } = await abrirNaFila(page, protocoloDaDona)
  const identidade = dentro.getByRole('region', {
    name: 'Identidade de quem pediu',
  })
  await expect(identidade).toHaveAttribute('data-identidade', 'validada')
  await expect(identidade).toContainText('validada automaticamente')
  await expect(identidade).toContainText(
    'o e-mail digitado é o do cadastro de associado deste CPF',
  )
  await expect(dentro.getByLabel('O que você conferiu')).toHaveCount(0)
  await expect(dentro.getByLabel('Resposta')).toBeEnabled()
  await expect(
    dentro.getByText(/a pessoa a lê na área Minha conta do site/),
  ).toBeVisible()
  await ver(page, info, 'titular-validada-sozinha')

  // o fato fica na Auditoria, sem usuário (foi o sistema)
  const auto = await auditoria(
    page,
    'ATENDIMENTO_IDENTIDADE_VALIDADA_AUTOMATICAMENTE',
    id,
  )
  expect(auto, 'a validação automática na Auditoria').toHaveLength(1)
  expect(auto[0]!.id_usuario).toBeNull()

  // antes de responder, a dona entra na Minha conta (o pedido abre a conta): vê o pedido, sem resposta
  tokenDaDona = await entrarNaMinhaConta(page, EMAIL_DA_DONA)
  const antes = (await conta(page, tokenDaDona)).pedidos_do_titular
  expect(antes.map((p) => p.protocolo)).toEqual([protocoloDaDona])
  expect(antes[0]!.resposta).toBeNull()
  expect(antes[0]!.situacao).not.toBe('Respondido')

  // a equipe responde pela tela
  await dentro.getByLabel('Resposta').fill(RESPOSTA_DA_DONA)
  await dentro.getByRole('button', { name: 'Registrar resposta' }).click()
  const registrada = dentro.getByRole('region', {
    name: 'Resposta registrada',
  })
  await expect(registrada).toContainText(RESPOSTA_DA_DONA)
  // a homologação não tem e-mail: o aviso diz que a pessoa precisa ser avisada por outro meio, sem prometer o envio da resposta
  await expect(
    registrada.getByText(/Não foi possível avisar a pessoa por e-mail/),
  ).toBeVisible()
  await ver(page, info, 'titular-respondida-pela-tela')

  // a dona lê a resposta na Minha conta (a mesma sessão) e só lá
  const depois = (await conta(page, tokenDaDona)).pedidos_do_titular
  expect(depois).toHaveLength(1)
  expect(depois[0]!.situacao).toBe('Respondido')
  expect(depois[0]!.resposta).toBe(RESPOSTA_DA_DONA)
  expect(depois[0]!.respondido_em).toBeTruthy()
  expect(Object.keys(depois[0]!).join()).not.toMatch(/cpf|mensagem/)

  // encerrar DEPOIS de responder é o último passo de quem atende: a resposta continua na Minha conta (o pedido não vira "encerrado sem resposta")
  const encerrou = await page.request.post(
    `${API_HML}/api/atendimentos/${id}/encerrar`,
    {
      headers: cabecalho(),
      data: { motivo: 'Atendimento concluído e arquivado.' },
    },
  )
  expect(encerrou.status(), await encerrou.text()).toBe(200)
  const arquivado = (await conta(page, tokenDaDona)).pedidos_do_titular
  expect(arquivado[0]!.situacao).toBe('Respondido')
  expect(arquivado[0]!.resposta).toBe(RESPOSTA_DA_DONA)
  expect(arquivado[0]!.motivo_do_encerramento).toBeNull()
  expect(vigia.problemas()).toEqual([])
})

test('o intruso digita o CPF da dona com o e-mail dele: fica por validar, a tela e o servidor travam a resposta, ele não vê dado nenhum, e o pedido é encerrado com o motivo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
  const pedido = await pedidoDoTitular(page, EMAIL_DO_INTRUSO)
  expect(pedido.status, pedido.texto).toBe(200)
  protocoloDoIntruso = pedido.protocolo
  const id = await idDoAtendimento(page, protocoloDoIntruso)

  const { dentro } = await abrirNaFila(page, protocoloDoIntruso)
  const identidade = dentro.getByRole('region', {
    name: 'Identidade de quem pediu',
  })
  await expect(identidade).toHaveAttribute('data-identidade', 'pendente')
  await expect(identidade).toContainText('Identidade ainda não validada')
  await expect(dentro.getByLabel('Resposta')).toBeDisabled()
  await expect(
    dentro.getByRole('button', { name: 'Registrar resposta' }),
  ).toBeDisabled()
  await expect(
    dentro.getByText(/Valide a identidade de quem pediu/),
  ).toBeVisible()
  await ver(page, info, 'titular-por-validar-com-a-resposta-travada')

  // o servidor também recusa (não é só a tela): com o token do Presidente
  const recusa = await page.request.post(
    `${API_HML}/api/atendimentos/${id}/responder`,
    {
      headers: cabecalho(),
      data: { resposta: 'Resposta que nunca poderia sair daqui.' },
    },
  )
  expect(recusa.status()).toBe(400)
  expect(await recusa.text()).toContain('valide a identidade')

  // o intruso entra na Minha conta DELE (o pedido abriu a conta) e não vê nada de ninguém
  tokenDoIntruso = await entrarNaMinhaConta(page, EMAIL_DO_INTRUSO)
  const doIntruso = await conta(page, tokenDoIntruso)
  expect(doIntruso.pedidos_do_titular.map((p) => p.protocolo)).toEqual([
    protocoloDoIntruso,
  ])
  expect(doIntruso.pedidos_do_titular[0]!.resposta).toBeNull()
  expect(JSON.stringify(doIntruso)).not.toContain(RESPOSTA_DA_DONA)
  expect(JSON.stringify(doIntruso)).not.toContain(NOME_DA_DONA)

  // a equipe encerra com o motivo (pela tela); a tela avisa que o motivo aparece para a pessoa
  await expect(
    dentro.getByText(/este motivo aparece para a pessoa na área Minha conta/),
  ).toBeVisible()
  await dentro.getByLabel('Motivo do encerramento').fill(MOTIVO_DO_ENCERRAMENTO)
  await dentro.getByRole('button', { name: 'Encerrar atendimento' }).click()
  await expect(dentro.getByText(/Encerrado em/)).toBeVisible()
  await expect(dentro.getByText(MOTIVO_DO_ENCERRAMENTO)).toBeVisible()
  // a homologação não tem e-mail: a tela diz que a pessoa NÃO foi avisada e que é preciso avisar por outro meio (o aviso fica registrado no pedido)
  await expect(dentro.locator('[data-envio-do-encerramento]')).toContainText(
    'Não foi possível avisar a pessoa por e-mail',
  )
  await ver(page, info, 'titular-do-intruso-encerrada-com-o-motivo')

  // o motivo aparece SÓ na conta do intruso; a conta da dona nem lista o pedido dele
  const encerrado = (await conta(page, tokenDoIntruso)).pedidos_do_titular[0]!
  expect(encerrado.situacao).toBe('Encerrado')
  expect(encerrado.motivo_do_encerramento).toBe(MOTIVO_DO_ENCERRAMENTO)
  expect(encerrado.resposta).toBeNull()
  const daDona = await conta(page, tokenDaDona)
  expect(daDona.pedidos_do_titular.map((p) => p.protocolo)).toEqual([
    protocoloDaDona,
  ])
  expect(JSON.stringify(daDona)).not.toContain(MOTIVO_DO_ENCERRAMENTO)
  expect(vigia.problemas()).toEqual([])
})

test('a dona pede com OUTRO e-mail dela: por validar; a equipe valida pela tela escrevendo o que conferiu; a Auditoria guarda quem e como; a resposta destrava e é lida na Minha conta daquele e-mail', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
  const pedido = await pedidoDoTitular(page, OUTRO_EMAIL_DA_DONA, 'CORRECAO')
  expect(pedido.status, pedido.texto).toBe(200)
  protocoloDoOutroEmail = pedido.protocolo
  const id = await idDoAtendimento(page, protocoloDoOutroEmail)

  const { dentro } = await abrirNaFila(page, protocoloDoOutroEmail)
  const identidade = dentro.getByRole('region', {
    name: 'Identidade de quem pediu',
  })
  await expect(identidade).toHaveAttribute('data-identidade', 'pendente')
  await expect(dentro.getByLabel('Resposta')).toBeDisabled()

  // nota curta: a tela recusa sem ir ao servidor
  await dentro.getByLabel('O que você conferiu').fill('ok')
  await dentro.getByRole('button', { name: 'Validar identidade' }).click()
  await expect(dentro.getByRole('alert')).toContainText(
    'Escreva o que você conferiu',
  )
  await expect(identidade).toHaveAttribute('data-identidade', 'pendente')
  await ver(page, info, 'validacao-recusada-por-nota-curta')

  // a nota certa: a tela mostra quem e o quê, e a resposta destrava
  await dentro.getByLabel('O que você conferiu').fill(NOTA_DE_IDENTIDADE)
  await dentro.getByRole('button', { name: 'Validar identidade' }).click()
  await expect(identidade).toHaveAttribute('data-identidade', 'validada', {
    timeout: 20_000,
  })
  await expect(identidade).toContainText('Identidade validada pela equipe por')
  await expect(identidade).toContainText(NOTA_DE_IDENTIDADE)
  await expect(dentro.getByLabel('Resposta')).toBeEnabled()
  await expect(dentro.getByLabel('O que você conferiu')).toHaveCount(0)
  await ver(page, info, 'titular-validada-pela-equipe')

  // a Auditoria: quem validou (usuário) e como; o texto da nota NÃO vai para ela
  const validada = await auditoria(page, 'ATENDIMENTO_IDENTIDADE_VALIDADA', id)
  expect(validada, 'a validação à mão na Auditoria').toHaveLength(1)
  expect(validada[0]!.id_usuario).not.toBeNull()
  expect(JSON.stringify(validada[0]!.dados_depois)).toContain('MANUAL')
  expect(JSON.stringify(validada)).not.toContain('documento com foto')

  // a segunda validação é recusada pelo servidor
  const repetida = await page.request.post(
    `${API_HML}/api/atendimentos/${id}/validar-identidade`,
    { headers: cabecalho(), data: { nota: 'Conferi o documento outra vez.' } },
  )
  expect(repetida.status()).toBe(400)

  // o pedido destravado: antes de responder, o e-mail dela já abre a conta; depois a resposta aparece lá
  tokenDoOutroEmail = await entrarNaMinhaConta(page, OUTRO_EMAIL_DA_DONA)
  expect(
    (await conta(page, tokenDoOutroEmail)).pedidos_do_titular[0]!.resposta,
  ).toBeNull()
  await dentro.getByLabel('Resposta').fill(RESPOSTA_DO_OUTRO_EMAIL)
  await dentro.getByRole('button', { name: 'Registrar resposta' }).click()
  await expect(
    dentro.getByRole('region', { name: 'Resposta registrada' }),
  ).toContainText(RESPOSTA_DO_OUTRO_EMAIL)
  const lida = (await conta(page, tokenDoOutroEmail)).pedidos_do_titular
  expect(lida).toHaveLength(1)
  expect(lida[0]!.protocolo).toBe(protocoloDoOutroEmail)
  expect(lida[0]!.resposta).toBe(RESPOSTA_DO_OUTRO_EMAIL)
  // a conta do e-mail do cadastro continua só com o pedido dela
  expect(
    (await conta(page, tokenDaDona)).pedidos_do_titular.map((p) => p.protocolo),
  ).toEqual([protocoloDaDona])
  expect(vigia.problemas()).toEqual([])
})

test('o pedido de eliminação aberto DENTRO da Minha conta já nasce validado pelo código; os outros tipos de pedido não têm cartão de identidade', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
  const r = await page.request.post(
    `${API_HML}/api/visitante/pedir-apagamento`,
    { headers: { Authorization: `Bearer ${tokenDaDona}` } },
  )
  expect(r.status(), await r.text()).toBe(200)
  protocoloDoApagamento = ((await r.json()) as { protocolo: string }).protocolo
  const { dentro } = await abrirNaFila(page, protocoloDoApagamento)
  const identidade = dentro.getByRole('region', {
    name: 'Identidade de quem pediu',
  })
  await expect(identidade).toHaveAttribute('data-identidade', 'validada')
  await expect(identidade).toContainText('aberto dentro da área Minha conta')
  await expect(dentro.getByLabel('Resposta')).toBeEnabled()
  await ver(page, info, 'eliminacao-aberta-na-minha-conta-ja-validada')
  const id = await idDoAtendimento(page, protocoloDoApagamento)
  const registro = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=atendimentos&acao=VISITANTE_PEDIU_APAGAMENTO&por_pagina=200`,
    { headers: cabecalho() },
  )
  const { entradas } = (await registro.json()) as {
    entradas: Array<{ id_registro_afetado: number; dados_depois: unknown }>
  }
  const dele = entradas.find((e) => e.id_registro_afetado === id)
  expect(JSON.stringify(dele?.dados_depois)).toContain('CODIGO_NO_EMAIL')
  expect(JSON.stringify(entradas)).not.toContain(EMAIL_DA_DONA)

  // um pedido de contato: sem cartão de identidade, responde como sempre
  const contato = await enviarPedido(page, {
    tipo: 'CONTATO',
    assunto: 'Horário de funcionamento',
    email_contato: `contato.${RODADA}@example.com`,
  })
  expect(contato.status, contato.texto).toBe(200)
  const { dentro: doContato } = await abrirNaFila(page, contato.protocolo)
  await expect(
    doContato.getByRole('region', { name: 'Identidade de quem pediu' }),
  ).toHaveCount(0)
  await expect(doContato.getByLabel('Resposta')).toBeEnabled()
  await expect(doContato.getByText(/também é enviada por e-mail/)).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})
