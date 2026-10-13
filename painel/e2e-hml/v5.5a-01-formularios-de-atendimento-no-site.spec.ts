import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.5a - os três formulários de atendimento do SITE de teste (hml-site), de ponta a ponta, como um visitante: a pessoa preenche a página, o pedido atravessa a API (de
// outra origem, então o CORS também é provado aqui), a tela mostra o protocolo e o prazo que vieram do servidor, e o pedido aparece na fila do painel do Presidente com o
// tipo certo e o CPF mascarado. As recusas são provocadas pela própria página (formulário em branco, aceite do aviso, CPF que não confere) e o duplo envio vira um
// protocolo só. A Política de Privacidade 1.4 nomeia o encarregado de dados. Roda DEPOIS de a homologação ser publicada com esta versão (o site de teste é reconstruído
// pelo Deploy Homologação).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE_HML = 'https://hml-site.asaf.org.br'
const S = String(RODADA)
const CPF_TITULAR = cpfValido(500000000 + (RODADA % 300000000))

const protocolos: Record<string, string> = {}

const campoPorRotulo = (page: Page, rotulo: string | RegExp): Locator =>
  page.getByLabel(rotulo, { exact: typeof rotulo === 'string' })

async function aceitarOAviso(page: Page): Promise<void> {
  await page.getByLabel('Li e aceito o aviso de privacidade.').check()
}

async function lerProtocolo(page: Page): Promise<string> {
  const confirmacao = page.locator('div[data-confirmacao]')
  await expect(confirmacao).toBeVisible({ timeout: 60_000 })
  await expect(confirmacao).toContainText('Recebemos o seu pedido.')
  const protocolo = (
    await confirmacao.locator('[data-protocolo]').innerText()
  ).trim()
  expect(protocolo).toMatch(/^ASAF-\d{4}-\d{5}$/)
  await expect(confirmacao).toContainText('Guarde este número.')
  return protocolo
}

test('contato: o formulário em branco diz o que falta; sem aceitar o aviso não envia; o pedido certo recebe protocolo e prazo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE_HML}/contato/`)
  await expect(
    page.getByRole('heading', { name: 'Escreva para a associação' }),
  ).toBeVisible()
  // o contato não pede CPF
  await expect(page.getByLabel('CPF', { exact: true })).toHaveCount(0)
  // o aviso de privacidade (versão 1) está na página, com o texto de verdade
  await expect(page.getByText('Aviso de privacidade (versão 1)')).toBeVisible()
  await expect(
    page.getByText(
      'Usamos o que você escrever aqui só para responder ao seu pedido.',
    ),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(page.locator('[data-erro="nome_completo"]')).toBeVisible()
  await expect(page.locator('[data-erro="contato"]')).toBeVisible()
  await expect(page.locator('[data-erro="assunto"]')).toBeVisible()
  await expect(page.locator('[data-erro="mensagem"]')).toBeVisible()
  await expect(page.locator('[data-erro="consentimento_lgpd"]')).toBeVisible()
  await ver(page, info, 'contato-em-branco-diz-o-que-falta')

  await campoPorRotulo(page, 'Nome completo').fill(
    `Visitante do Site ${S} de Teste`,
  )
  await campoPorRotulo(page, 'Telefone/WhatsApp').fill('(91) 98888-3333')
  await campoPorRotulo(page, 'Assunto').fill(`Quero ajudar ${S}`)
  await campoPorRotulo(page, 'Mensagem').fill(
    `Gostaria de conhecer o trabalho da associação e saber como posso ajudar. Rodada ${S}.`,
  )
  // sem aceitar o aviso: não envia
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(page.locator('[data-erro="consentimento_lgpd"]')).toBeVisible()
  await expect(page.locator('div[data-confirmacao]')).toBeHidden()
  await ver(page, info, 'contato-sem-aceitar-o-aviso')

  await aceitarOAviso(page)
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  protocolos['contato'] = await lerProtocolo(page)
  // o prazo vem da API (contato: 10 dias) e é escrito com a data
  await expect(page.locator('[data-prazo-da-resposta]')).toContainText(
    /Respondemos em até 10 dias \(até .+\)/,
  )
  await ver(page, info, 'contato-recebido-com-protocolo-e-prazo')
  expect(vigia.problemas()).toEqual([])
})

test('pedido de informação sobre recursos públicos: a página explica, o formulário envia e o prazo é o do tipo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE_HML}/transparencia/pedido-de-informacao/`)
  await expect(
    page.getByRole('heading', {
      name: 'Pedido de informação sobre recursos públicos',
      level: 1,
    }),
  ).toBeVisible()
  await expect(page.getByLabel('CPF', { exact: true })).toHaveCount(0)
  await campoPorRotulo(page, 'Nome completo').fill(
    `Cidadão do Site ${S} de Teste`,
  )
  await campoPorRotulo(page, 'E-mail').fill(
    `cidadao.${S}@homologacao.example.com`,
  )
  await campoPorRotulo(page, 'Assunto').fill(`Emendas recebidas ${S}`)
  await campoPorRotulo(page, 'Mensagem').fill(
    `Quanto a associação recebeu de emendas parlamentares e em que gastou? Rodada ${S}.`,
  )
  await aceitarOAviso(page)
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  protocolos['pedido'] = await lerProtocolo(page)
  await expect(page.locator('[data-prazo-da-resposta]')).toContainText(
    /Respondemos em até 20 dias/,
  )
  await ver(page, info, 'pedido-de-informacao-recebido')
  expect(vigia.problemas()).toEqual([])
})

test('solicitação do titular: lista os direitos, exige o CPF que confere e o direito escolhido, e o prazo é o de 15 dias', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE_HML}/privacidade/solicitacao-do-titular/`)
  await expect(
    page.getByRole('heading', {
      name: 'Solicitação do titular de dados',
      level: 1,
    }),
  ).toBeVisible()
  await expect(
    page.getByText('Acessar os dados que a associação tem sobre mim').first(),
  ).toBeVisible()

  await campoPorRotulo(page, 'Nome completo').fill(
    `Titular do Site ${S} de Teste`,
  )
  await campoPorRotulo(page, 'Telefone/WhatsApp').fill('(91) 98888-4444')
  await campoPorRotulo(page, 'Mensagem').fill(
    `Quero ver todos os dados que a associação guarda sobre mim. Rodada ${S}.`,
  )
  await aceitarOAviso(page)
  // sem o direito escolhido e com CPF que não confere: a página recusa e diz onde
  await campoPorRotulo(page, 'CPF').fill('111.111.111-11')
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(page.locator('[data-erro="cpf"]')).toBeVisible()
  await expect(page.locator('[data-erro="subtipo"]')).toBeVisible()
  await ver(page, info, 'titular-cpf-invalido-e-direito-nao-escolhido')

  await campoPorRotulo(page, 'CPF').fill(CPF_TITULAR)
  await campoPorRotulo(page, 'O que você quer pedir').selectOption('ACESSO')
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  protocolos['titular'] = await lerProtocolo(page)
  await expect(page.locator('[data-prazo-da-resposta]')).toContainText(
    /Respondemos em até 15 dias/,
  )
  await ver(page, info, 'titular-recebido')
  expect(vigia.problemas()).toEqual([])
})

test('o mesmo pedido mandado duas vezes é um protocolo só; a armadilha de robô finge sucesso e não cria nada', async ({
  page,
}) => {
  const corpo = {
    tipo: 'CONTATO',
    assunto: `Duplo clique ${S}`,
    mensagem: `Mensagem enviada duas vezes de propósito. Rodada ${S}.`,
    nome_completo: `Duplo Clique ${S} de Teste`,
    telefone_whatsapp: '(91) 98888-5555',
    consentimento_lgpd: true,
    versao_texto_consentimento: '1',
  }
  const a = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    data: corpo,
  })
  const b = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    data: corpo,
  })
  expect(a.status()).toBe(200)
  expect(b.status()).toBe(200)
  const protocoloA = ((await a.json()) as { protocolo: string }).protocolo
  expect(((await b.json()) as { protocolo: string }).protocolo).toBe(protocoloA)
  protocolos['duplo'] = protocoloA

  const robo = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    data: { ...corpo, assunto: `Robô ${S}`, pagina_web: 'http://spam.example' },
  })
  expect(robo.status()).toBe(200)
  expect(
    ((await robo.json()) as { protocolo: string | null }).protocolo,
  ).toBeNull()

  // aviso de privacidade velho é recusado em português
  const velho = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    data: {
      ...corpo,
      assunto: `Aviso velho ${S}`,
      versao_texto_consentimento: '0',
    },
  })
  expect(velho.status()).toBe(422)
  expect(await velho.text()).toContain('aviso de privacidade foi atualizado')
})

test('os três pedidos do site estão na fila do Presidente com o tipo certo, o CPF do titular mascarado e um protocolo só para o duplo envio', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page
    .getByRole('link', { name: /^Atendimento/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Atendimento', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Buscar atendimento').fill(S)
  const cartao = (protocolo: string) =>
    page.getByRole('listitem', { name: `Atendimento ${protocolo}` })
  await expect(cartao(protocolos['contato']!)).toContainText('Contato')
  await expect(cartao(protocolos['pedido']!)).toContainText(
    'Pedido de informação sobre recursos públicos',
  )
  await expect(cartao(protocolos['titular']!)).toContainText(
    'Solicitação de titular de dados (LGPD)',
  )
  await expect(cartao(protocolos['duplo']!)).toHaveCount(1)
  // o pedido com aviso velho e o do robô não viraram atendimento
  await expect(page.getByText(`Aviso velho ${S}`)).toHaveCount(0)
  await expect(page.getByText(`Robô ${S}`)).toHaveCount(0)
  // na lista o CPF nunca vem inteiro
  await expect(page.getByText(CPF_TITULAR.replace(/\D/g, ''))).toHaveCount(0)
  await ver(page, info, 'fila-com-os-pedidos-do-site')
  expect(vigia.problemas()).toEqual([])
})

test('a Política de Privacidade (qualquer versão) nomeia o encarregado de dados (o Presidente) e leva à solicitação do titular', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE_HML}/privacidade/`)
  await expect(page.getByText(/Versão \d+\.\d+/)).toBeVisible()
  const encarregado = page.locator('[data-encarregado]')
  await expect(encarregado).toContainText(
    'Encarregado pelo tratamento de dados pessoais',
  )
  await expect(encarregado).toContainText('o Presidente da ASAF')
  // a homologação tem um Presidente nos mandatos de teste: o nome dele aparece; se um dia não houver mandato, a página manda olhar a Diretoria
  const dirigentes = (await (
    await page.request.get(`${API_HML}/api/publico/diretoria`)
  ).json()) as Array<{
    cargo_codigo: string
    orgao_codigo: string
    nome: string
  }>
  const presidente = dirigentes.find(
    (d) =>
      d.orgao_codigo === 'DIRETORIA_EXECUTIVA' &&
      d.cargo_codigo === 'PRESIDENTE',
  )
  if (presidente) await expect(encarregado).toContainText(presidente.nome)
  else
    await expect(
      encarregado.getByRole('link', { name: 'Diretoria' }),
    ).toBeVisible()
  await expect(page.locator('[data-formularios-de-atendimento]')).toContainText(
    'Formulários de atendimento.',
  )
  await ver(page, info, 'politica-de-privacidade-com-o-encarregado')
  await page
    .getByRole('link', {
      name: 'formulário de solicitação do titular de dados',
    })
    .first()
    .click()
  await expect(
    page.getByRole('heading', {
      name: 'Solicitação do titular de dados',
      level: 1,
    }),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})
