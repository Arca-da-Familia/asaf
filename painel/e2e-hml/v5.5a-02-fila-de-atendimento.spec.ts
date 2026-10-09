import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.5a - a fila única de atendimento, vista pelo PAINEL: três pedidos chegam pela rota pública (contato, pedido de informação sobre recursos públicos e solicitação de
// titular de dados da LGPD), o Presidente é avisado no sino, abre a fila e vê cada um com protocolo e prazo; abre, assume, responde (resposta curta recusada em português),
// encerra (motivo curto recusado); o CPF do titular só aparece inteiro dentro do pedido, e os outros pedidos da mesma pessoa aparecem juntos; a Auditoria guarda cada
// ação; quem não tem a permissão (Secretário) é barrado na tela e na API. O envio do formulário pelo SITE é provado no roteiro v5.5a-01.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const S = String(RODADA)
const CPF_TITULAR = cpfValido(700000000 + (RODADA % 200000000))
const VERSAO_DO_AVISO = '1'

const CONTATO = {
  tipo: 'CONTATO',
  assunto: `Quero conhecer a associação ${S}`,
  mensagem: `Gostaria de saber como participar das atividades. Rodada ${S}.`,
  nome_completo: `Contato do Robô ${S} de Teste`,
  telefone_whatsapp: '(91) 98888-1111',
}
const PEDIDO = {
  tipo: 'PEDIDO_INFORMACAO',
  assunto: `Recursos de emendas ${S}`,
  mensagem: `Quanto a associação recebeu de emendas parlamentares neste ano? Rodada ${S}.`,
  nome_completo: `Pedido do Robô ${S} de Teste`,
  email_contato: `pedido.${S}@homologacao.example.com`,
}
const TITULAR = {
  tipo: 'TITULAR_LGPD',
  subtipo: 'ACESSO',
  mensagem: `Quero ver todos os dados que a associação guarda sobre mim. Rodada ${S}.`,
  nome_completo: `Titular do Robô ${S} de Teste`,
  telefone_whatsapp: '(91) 98888-2222',
  cpf: CPF_TITULAR,
}
const TITULAR_2 = {
  ...TITULAR,
  subtipo: 'CORRECAO',
  mensagem: `Quero corrigir o meu endereço no cadastro da associação. Rodada ${S}.`,
}

const protocolos: Record<string, string> = {}

async function enviarPelaRotaPublica(
  page: Page,
  corpo: Record<string, unknown>,
): Promise<string> {
  const r = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    data: {
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO,
      ...corpo,
    },
  })
  expect(r.status(), await r.text()).toBe(200)
  const dados = (await r.json()) as { protocolo: string; prazo_dias: number }
  expect(dados.protocolo).toMatch(/^ASAF-\d{4}-\d{5}$/)
  return dados.protocolo
}

const cartao = (page: Page, protocolo: string): Locator =>
  page.getByRole('listitem', { name: `Atendimento ${protocolo}` })

async function abrirAFila(page: Page): Promise<void> {
  await page
    .getByRole('link', { name: /^Atendimento/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Atendimento', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
}

async function buscar(page: Page, texto: string): Promise<void> {
  await page.getByLabel('Buscar atendimento').fill(texto)
}

/** Abre a Auditoria filtrada pela tabela e devolve o total de registros (lido da resposta da própria tela). */
async function totalNaAuditoria(page: Page): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes('tabela_afetada=atendimentos'),
  )
  await campo(page, 'Tabela').fill('atendimentos')
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

let totalAntes = 0

test('três pedidos chegam pela rota pública; o Presidente é avisado no sino, abre a fila e vê cada um com protocolo e prazo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  totalAntes = await totalNaAuditoria(page)
  await sair(page)

  protocolos['contato'] = await enviarPelaRotaPublica(page, CONTATO)
  protocolos['pedido'] = await enviarPelaRotaPublica(page, PEDIDO)
  protocolos['titular'] = await enviarPelaRotaPublica(page, TITULAR)

  await entrar(page, 'presidente')
  const sino = page.getByRole('button', {
    name: /^Notificações \(\d+ novas?\)$/,
  })
  await expect(sino).toBeVisible()
  await sino.click()
  const avisos = page.getByRole('region', { name: 'Avisos do painel' })
  await expect(
    avisos.getByRole('listitem').filter({ hasText: protocolos['contato']! }),
  ).toContainText('Novo atendimento')
  await ver(page, info, 'sino-com-o-aviso-do-atendimento')
  await avisos
    .getByRole('listitem')
    .filter({ hasText: protocolos['contato']! })
    .getByRole('link', { name: /Novo atendimento/ })
    .click()

  await expect(
    page.getByRole('heading', { name: 'Atendimento', level: 1 }),
  ).toBeVisible()
  await buscar(page, S)
  await expect(cartao(page, protocolos['contato']!)).toBeVisible()
  await expect(cartao(page, protocolos['pedido']!)).toBeVisible()
  await expect(cartao(page, protocolos['titular']!)).toBeVisible()

  // cada tipo com o seu rótulo, a situação Novo e o prazo do tipo (contato 10 dias, pedido de informação 20, titular 15)
  const contato = cartao(page, protocolos['contato']!)
  await expect(contato).toContainText('Contato')
  await expect(contato).toContainText('Novo')
  await expect(contato).toContainText(/Vence em (9|10) dias/)
  const pedido = cartao(page, protocolos['pedido']!)
  await expect(pedido).toContainText(
    'Pedido de informação sobre recursos públicos',
  )
  await expect(pedido).toContainText(/Vence em (19|20) dias/)
  const titular = cartao(page, protocolos['titular']!)
  await expect(titular).toContainText('Solicitação de titular de dados (LGPD)')
  await expect(titular).toContainText(/Vence em (14|15) dias/)
  // na lista o CPF nunca vem inteiro
  await expect(page.getByText(CPF_TITULAR, { exact: false })).toHaveCount(0)
  await expect(
    page.getByText(CPF_TITULAR.replace(/\D/g, ''), { exact: false }),
  ).toHaveCount(0)
  await ver(page, info, 'fila-com-os-tres-pedidos')

  // os cartões do resumo existem e há pedidos novos
  await expect(page.getByLabel(/^Novos: \d+$/)).toBeVisible()
  await expect(page.getByLabel(/^Vencidos: \d+$/)).toBeVisible()
  await expect(page.getByLabel(/^Vencem em 3 dias: \d+$/)).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('os filtros da fila: por tipo, por situação e a busca (inclusive pelo número do protocolo)', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirAFila(page)
  await buscar(page, S)
  await expect(cartao(page, protocolos['contato']!)).toBeVisible()

  await page
    .getByLabel('Tipo', { exact: true })
    .selectOption('PEDIDO_INFORMACAO')
  await expect(cartao(page, protocolos['pedido']!)).toBeVisible()
  await expect(cartao(page, protocolos['contato']!)).toHaveCount(0)
  await expect(cartao(page, protocolos['titular']!)).toHaveCount(0)
  await ver(page, info, 'fila-so-pedidos-de-informacao')

  await page.getByLabel('Tipo', { exact: true }).selectOption('')
  await buscar(page, protocolos['titular']!)
  await expect(cartao(page, protocolos['titular']!)).toBeVisible()
  await expect(cartao(page, protocolos['contato']!)).toHaveCount(0)

  await buscar(page, 'zzzz-ninguem-escreveu-isto')
  await expect(page.getByText(/Nenhum atendimento/)).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('abrir o contato mostra o pedido inteiro; assumir muda a situação; resposta curta é recusada em português e a boa é registrada', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirAFila(page)
  await buscar(page, protocolos['contato']!)
  const c = cartao(page, protocolos['contato']!)
  await c.getByRole('button', { name: 'Abrir' }).click()
  await expect(c).toContainText(CONTATO.mensagem)
  await expect(c).toContainText(CONTATO.telefone_whatsapp)
  await expect(c).toContainText(`versão ${VERSAO_DO_AVISO}`)
  await ver(page, info, 'contato-aberto')

  await c.getByRole('button', { name: 'Assumir' }).click()
  await expect(c).toContainText('Em atendimento')

  await c.getByLabel('Resposta').fill('ok')
  await c.getByRole('button', { name: 'Registrar resposta' }).click()
  await expect(c.getByRole('alert')).toContainText('pelo menos 10')
  await expect(c).toContainText('Em atendimento')
  await ver(page, info, 'resposta-curta-recusada')

  await c
    .getByLabel('Resposta')
    .fill(
      `Obrigado pelo contato ${S}: veja a página Como ajudar do nosso site.`,
    )
  await c.getByRole('button', { name: 'Registrar resposta' }).click()
  // o contato foi feito só pelo telefone: não há e-mail para a resposta, e a tela diz para avisar a pessoa pelo telefone
  await expect(page.getByText(/Sem e-mail cadastrado/).first()).toBeVisible()
  await ver(page, info, 'resposta-registrada')

  // por um endereço novo: a resposta veio do servidor
  await page.reload()
  await page.getByLabel('Situação', { exact: true }).selectOption('Respondido')
  await buscar(page, protocolos['contato']!)
  const respondido = cartao(page, protocolos['contato']!)
  await expect(respondido).toBeVisible()
  await expect(respondido).toContainText('Respondido no prazo')
  expect(vigia.problemas()).toEqual([])
})

test('o pedido de informação é respondido (com e-mail: o resultado do envio aparece) e depois encerrado: motivo curto é recusado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirAFila(page)
  await buscar(page, protocolos['pedido']!)
  const c = cartao(page, protocolos['pedido']!)
  await c.getByRole('button', { name: 'Abrir' }).click()
  await expect(c).toContainText(PEDIDO.email_contato)
  await c.getByRole('button', { name: 'Assumir' }).click()
  await expect(c).toContainText('Em atendimento')
  await c
    .getByLabel('Resposta')
    .fill(
      `Os valores recebidos estão na página Transparência do site. Rodada ${S}.`,
    )
  await c.getByRole('button', { name: 'Registrar resposta' }).click()
  // o pedido tinha e-mail: ou a resposta saiu por e-mail, ou a tela avisa que a pessoa precisa ser avisada por outro meio (o e-mail da homologação pode não estar ligado)
  await expect(
    page
      .getByText(
        /A resposta foi enviada por e-mail|Não foi possível enviar por e-mail/,
      )
      .first(),
  ).toBeVisible()
  await ver(page, info, 'pedido-respondido')

  await page.getByLabel('Situação', { exact: true }).selectOption('Respondido')
  await buscar(page, protocolos['pedido']!)
  const respondido = cartao(page, protocolos['pedido']!)
  await respondido.getByRole('button', { name: 'Abrir' }).click()
  await respondido.getByLabel('Motivo do encerramento').fill('ok')
  await respondido.getByRole('button', { name: 'Encerrar atendimento' }).click()
  await expect(respondido.getByRole('alert')).toContainText('pelo menos 5')
  await respondido
    .getByLabel('Motivo do encerramento')
    .fill('Pessoa satisfeita com a resposta.')
  await respondido.getByRole('button', { name: 'Encerrar atendimento' }).click()

  await page.reload()
  await page.getByLabel('Situação', { exact: true }).selectOption('Encerrado')
  await buscar(page, protocolos['pedido']!)
  await expect(cartao(page, protocolos['pedido']!)).toContainText('Encerrado')
  await ver(page, info, 'pedido-encerrado')
  expect(vigia.problemas()).toEqual([])
})

test('a solicitação de titular: o CPF só aparece inteiro dentro do pedido, e os outros pedidos da mesma pessoa aparecem juntos', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  protocolos['titular2'] = await enviarPelaRotaPublica(page, TITULAR_2)
  await entrar(page, 'presidente')
  await abrirAFila(page)
  await buscar(page, protocolos['titular']!)
  const c = cartao(page, protocolos['titular']!)
  await expect(c).toContainText(
    'Acessar os dados que a associação tem sobre mim',
  )
  await expect(c).not.toContainText(CPF_TITULAR)
  await c.getByRole('button', { name: 'Abrir' }).click()
  await expect(c).toContainText(CPF_TITULAR.replace(/\D/g, ''))
  const outros = c.getByRole('region', { name: 'Outros pedidos desta pessoa' })
  await expect(outros).toContainText(protocolos['titular2']!)
  await ver(page, info, 'titular-aberto-com-os-outros-pedidos')

  // a busca pelo CPF (só números ou com pontuação) acha os dois; letras junto não casam com o CPF
  await buscar(page, CPF_TITULAR)
  await expect(cartao(page, protocolos['titular']!)).toBeVisible()
  await expect(cartao(page, protocolos['titular2']!)).toBeVisible()
  await buscar(page, `zzqx ${CPF_TITULAR.slice(0, 6)}`)
  await expect(page.getByText(/Nenhum atendimento/)).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guarda cada ação da fila, e a Auditoria do sistema cresceu exatamente com elas', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const total = await totalNaAuditoria(page)
  // 4 envios pelo site (3 + o segundo do titular) + contato: assumir e responder + pedido: assumir, responder e encerrar = 9
  expect(total - totalAntes, 'as ações do roteiro na Auditoria').toBe(9)
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('cell', {
        name: 'ATENDIMENTO_RESPONDIDO',
        exact: true,
      }),
    }),
  ).not.toHaveCount(0)
  await ver(page, info, 'auditoria-da-fila')
  expect(vigia.problemas()).toEqual([])
})

test('quem não atende (Secretário) não vê o módulo, é barrado na tela e a API recusa', async ({
  page,
}) => {
  const token: { valor: string } = { valor: '' }
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token.valor = cab
  })
  await entrar(page, 'secretario')
  await expect(page.getByRole('link', { name: /^Atendimento/ })).toHaveCount(0)
  await page.goto('/atendimentos')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  const r = await page.request.fetch(`${API_HML}/api/atendimentos/`, {
    headers: { Authorization: token.valor },
  })
  expect(r.status()).toBe(403)
  await sair(page)
})
