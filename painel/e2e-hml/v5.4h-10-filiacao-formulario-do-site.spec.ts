import { expect, test, type Page } from '@playwright/test'

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

// v5.4h - o formulário público de filiação no SITE de teste (hml-site), de ponta a ponta: a pessoa preenche a página, o pedido atravessa a API (de outra
// origem, então o CORS também é provado aqui), cai na caixa da Diretoria COM o que ela declarou (idade, aceite do aviso, declaração dos pais de quem tem 16 a
// 17 anos), os sócios o veem só com nome e idade, e a Auditoria guarda o envio. As recusas são provocadas pela própria página: formulário em branco, CPF que não
// confere, menor de 16 anos, 16 a 17 anos sem a declaração e pedido repetido; e o campo escondido dos robôs é provado pela API.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE_HML = 'https://hml-site.asaf.org.br'
const S = String(RODADA)
const base = (k: number) => 800000000 + ((RODADA + k * 6173) % 150000000)

const ADULTA = {
  nome: `Candidata do Site ${S} de Teste`,
  cpf: cpfValido(base(1)),
  email: `candidata.site.${S}@homologacao.example.com`,
  telefone: '(91) 98888-1234',
  nascimento: '1990-05-10',
}
const MENOR = {
  nome: `Menor do Site ${S} de Teste`,
  cpf: cpfValido(base(2)),
  email: `menor.site.${S}@homologacao.example.com`,
}
const ROBO_CPF = cpfValido(base(3))

const dataDe = (anosAtras: number): string => {
  const d = new Date()
  const ano = d.getUTCFullYear() - anosAtras
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(d.getUTCDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

async function abrirFormulario(page: Page) {
  await page.goto(`${SITE_HML}/seja-associado/`)
  await expect(
    page.getByRole('heading', { name: 'Faça o seu pedido de filiação' }),
  ).toBeVisible()
}

async function preencher(
  page: Page,
  v: {
    nome: string
    cpf: string
    nascimento: string
    email?: string
    telefone?: string
  },
) {
  await page.getByLabel('Nome completo').fill(v.nome)
  await page.getByLabel('CPF').fill(v.cpf)
  await page.getByLabel('Data de nascimento').fill(v.nascimento)
  await page.getByLabel('E-mail').fill(v.email ?? '')
  await page.getByLabel('Telefone ou WhatsApp').fill(v.telefone ?? '')
}

const aceitarAviso = (page: Page) =>
  page.getByLabel(/Li o aviso de privacidade/).check()
const enviar = (page: Page) =>
  page.getByRole('button', { name: 'Enviar pedido de filiação' }).click()

test('o formulário do site recusa o que está errado antes de enviar, e depois aceita o pedido certo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await abrirFormulario(page)
  await ver(page, info, 'formulario-do-site')

  // em branco: o resumo diz quantos campos faltam e o foco vai ao primeiro
  await enviar(page)
  await expect(page.getByRole('alert').first()).toContainText(
    /Há \d+ campos para corrigir\./,
  )
  await expect(page.getByLabel('Nome completo')).toBeFocused()
  await ver(page, info, 'formulario-em-branco-recusado')

  // CPF que não confere
  await preencher(page, { ...ADULTA, cpf: '111.444.777-36' })
  await aceitarAviso(page)
  await enviar(page)
  await expect(page.locator('#erro-cpf')).toContainText('não confere')

  // menor de 16 anos não se filia
  await page.getByLabel('CPF').fill(ADULTA.cpf)
  await page.getByLabel('Data de nascimento').fill(dataDe(15))
  await enviar(page)
  await expect(page.locator('#erro-nascimento')).toContainText(
    'a partir dos 16 anos',
  )

  // sem e-mail nem telefone a secretaria não tem como falar com a pessoa
  await page.getByLabel('Data de nascimento').fill(ADULTA.nascimento)
  await page.getByLabel('E-mail').fill('')
  await page.getByLabel('Telefone ou WhatsApp').fill('')
  await enviar(page)
  await expect(page.locator('#erro-contato')).toContainText(
    'e-mail ou um telefone',
  )

  // pedido certo: atravessa a API (outra origem) e a página confirma
  await page.getByLabel('E-mail').fill(ADULTA.email)
  await page.getByLabel('Telefone ou WhatsApp').fill(ADULTA.telefone)
  await enviar(page)
  const confirmacao = page
    .getByRole('status')
    .filter({ hasText: 'Recebemos o seu pedido de filiação' })
  await expect(confirmacao).toBeVisible()
  await ver(page, info, 'pedido-recebido')

  // o mesmo CPF de novo: a API recusa e a página mostra o motivo (a mesma frase para "já é sócio" e "já tem pedido")
  await abrirFormulario(page)
  await preencher(page, ADULTA)
  await aceitarAviso(page)
  await enviar(page)
  await expect(
    page.getByRole('alert').filter({
      hasText:
        'Já existe um pedido em andamento ou um cadastro com estes dados',
    }),
  ).toBeVisible()
  await ver(page, info, 'pedido-repetido-recusado')
  expect(vigia.problemas().filter((p) => !p.startsWith('400 '))).toEqual([])
})

test('de 16 a 17 anos a página pede a declaração dos pais e só então aceita o pedido', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await abrirFormulario(page)
  const declaracao = page.getByLabel(/autorização expressa e por escrito/)
  await expect(declaracao).toBeHidden()
  await preencher(page, { ...MENOR, nascimento: dataDe(17) })
  await aceitarAviso(page)
  await expect(declaracao).toBeVisible()
  await enviar(page)
  await expect(page.locator('#erro-autorizacao')).toContainText(
    'pais ou responsáveis',
  )
  await ver(page, info, 'menor-sem-a-declaracao-recusado')
  await declaracao.check()
  await enviar(page)
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Recebemos o seu pedido de filiação' }),
  ).toBeVisible()
  await ver(page, info, 'menor-com-a-declaracao-aceito')
  expect(vigia.problemas()).toEqual([])
})

test('a API descarta em silêncio o pedido de quem preencheu o campo escondido dos robôs', async ({
  page,
}) => {
  const r = await page.request.post(`${API_HML}/api/filiacao/propor`, {
    data: {
      nome_completo: `Robo do Site ${S} de Teste`,
      cpf: ROBO_CPF.replace(/\D/g, ''),
      email_contato: `robo.${S}@homologacao.example.com`,
      data_nascimento: '1990-05-10',
      consentimento_lgpd: true,
      versao_texto_consentimento: '1',
      pagina_web: 'http://spam.example',
    },
  })
  // finge sucesso (o robô não aprende nada) e não grava: a Diretoria não vê esse nome (conferido no teste seguinte)
  expect(r.status(), await r.text()).toBe(200)
  expect((await r.json()).id_proposta).toBeNull()
})

test('a Diretoria vê os pedidos do site com o que a pessoa declarou; o robô descartado não aparece', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados/propostas')
  await expect(
    page.getByRole('heading', { name: 'Propostas de filiação' }),
  ).toBeVisible()

  const adulta = page.getByRole('listitem', {
    name: `Proposta de ${ADULTA.nome}`,
  })
  await expect(adulta).toContainText(ADULTA.email)
  await expect(adulta).toContainText('Aviso de privacidade aceito (versão 1)')
  await expect(adulta.getByText(/^Recebida em .* · \d+ anos$/)).toBeVisible()
  await expect(adulta.locator('[data-aviso-de-menor]')).toHaveCount(0)

  const menor = page.getByRole('listitem', {
    name: `Proposta de ${MENOR.nome}`,
  })
  await expect(menor).toContainText('17 anos')
  await expect(menor.locator('[data-aviso-de-menor]')).toContainText(
    'autorização dos pais ou responsáveis',
  )
  await ver(page, info, 'diretoria-ve-o-que-a-pessoa-declarou')

  await expect(
    page.getByRole('listitem', {
      name: `Proposta de Robo do Site ${S} de Teste`,
    }),
  ).toHaveCount(0)
  expect(vigia.problemas()).toEqual([])
})

test('o sócio vê o candidato só com nome e idade, e a Auditoria guarda os dois envios do site', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  await page.goto('/filiacao/para-propor')
  const cartao = page.getByRole('listitem', {
    name: `Pedido de ${ADULTA.nome}`,
  })
  await expect(cartao).toBeVisible()
  await expect(cartao).toContainText(/\d+ anos/)
  // o aviso de privacidade promete: "eles veem só o seu nome e a sua idade"
  await expect(page.getByText(ADULTA.email)).toHaveCount(0)
  await expect(page.getByText(ADULTA.cpf)).toHaveCount(0)
  await expect(page.getByText(ADULTA.cpf.replace(/\D/g, ''))).toHaveCount(0)
  await expect(page.getByText('98888-1234')).toHaveCount(0)
  await ver(page, info, 'socio-ve-so-nome-e-idade')
  await sair(page)

  await entrar(page, 'presidente')
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  await campo(page, 'Tabela').fill('propostas_filiacao')
  await expect(
    page
      .getByRole('row')
      .filter({
        has: page.getByRole('cell', { name: 'PROPOSTA_PUBLICA', exact: true }),
      })
      .first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria-do-envio-do-site')
  expect(vigia.problemas()).toEqual([])
})
