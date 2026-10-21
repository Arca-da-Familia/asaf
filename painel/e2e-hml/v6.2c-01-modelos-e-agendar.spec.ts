import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  RODADA,
  entrar,
  exigirHomologacao,
  type Papel,
  ver,
  vigiar,
} from './apoio'

// v6.2c - MODELOS, VARIÁVEIS, PRÉ-VISUALIZAÇÃO, ENVIO DE TESTE E AGENDAMENTO (parte 1: prepara). Pelas telas, com o Secretário:
//  1. cria um modelo com {primeiro_nome}, edita (vira a versão 2; a 1 fica no histórico);
//  2. no Novo aviso, começa do modelo (preenche tudo), pré-visualiza (o texto chega com o primeiro nome de uma pessoa do Conselho Fiscal) e pede o envio de teste: a homologação não
//     tem servidor de e-mail, então o sistema RECUSA com a explicação (o envio em si é provado pelos testes do servidor);
//  3. agenda o aviso para daqui a 7 minutos para o Conselho Fiscal (aparece em Agendados) e agenda um segundo, que cancela com motivo;
//  4. o servidor recusa agendar para daqui a 1 minuto e recusa a variável que não existe.
// A parte 2 (v6.2c-02) roda depois de uma nova publicação da homologação, que roda a rotina de publicar os agendados.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const NOME_DO_MODELO = `Lembrete do Conselho v6.2c ${RODADA}`
const PREFIXO_DO_AGENDADO = 'Agendado v6.2c'
const TITULO = `${PREFIXO_DO_AGENDADO} ${RODADA}`

async function comoPapel(page: Page, papel: Papel): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, papel)
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

/** A hora local do NAVEGADOR daqui a N minutos, no formato do campo datetime-local. */
async function horaDaquiA(page: Page, minutos: number): Promise<string> {
  return page.evaluate((m) => {
    const d = new Date(Date.now() + m * 60_000)
    const dois = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`
  }, minutos)
}

async function escolherOConselho(page: Page) {
  await page.getByLabel('Quem tem uma permissão').check()
  await page
    .getByLabel(/^Permissão/)
    .selectOption({ value: 'financeiro_auditar' })
}

test('o Secretário cria um modelo e o edita: a versão nova entra em uso e a anterior fica no histórico', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await comoPapel(page, 'secretario')
  await page.goto('/comunicacao/modelos')
  await page.getByRole('button', { name: 'Novo modelo' }).click()
  await page.getByLabel(/^Nome do modelo/).fill(NOME_DO_MODELO)
  await page.getByLabel('Título do aviso').fill(TITULO)
  await page
    .getByLabel(/^Texto do aviso/)
    .fill('Olá, {primeiro_nome}! Reunião do Conselho na sexta.')
  await page.getByLabel(/^Categoria/).selectOption({ label: 'Geral' })
  await page.getByRole('button', { name: 'Criar modelo' }).click()
  await expect(
    page.getByText(`Modelo “${NOME_DO_MODELO}” criado.`),
  ).toBeVisible()

  const cartao = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: NOME_DO_MODELO }) })
  await cartao.getByRole('button', { name: 'Editar' }).click()
  await page
    .getByLabel(/^Texto do aviso/)
    .fill('Olá, {primeiro_nome}! A reunião do Conselho é na sexta às 19h.')
  await page.getByRole('button', { name: 'Salvar como versão nova' }).click()
  await expect(
    page.getByText(/salvo como versão 2; a anterior ficou no histórico/),
  ).toBeVisible()
  await cartao.getByRole('button', { name: 'Ver versões' }).click()
  await expect(cartao.getByText(/Versão 2 .* em uso/)).toBeVisible()
  await expect(cartao.getByText(/Versão 1/)).toBeVisible()
  await ver(page, info, 'modelo-com-duas-versoes')
  expect(vigia.problemas()).toEqual([])
})

test('no Novo aviso: começa do modelo, pré-visualiza com o nome de uma pessoa e o teste é recusado (sem e-mail na homologação); agenda e cancela', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'secretario')
  await page.goto('/comunicacao/novo')
  await page
    .getByLabel(/^Começar de um modelo/)
    .selectOption({ label: `${NOME_DO_MODELO} (versão 2)` })
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue(TITULO)
  await escolherOConselho(page)

  await page.getByRole('button', { name: 'Pré-visualizar' }).click()
  const previa = page.getByRole('status').filter({ hasText: 'Como chega para' })
  await expect(previa).toContainText(
    /Olá, [A-ZÁ-Ú][a-zá-ú]+! A reunião do Conselho é na sexta às 19h\./,
  )
  await expect(previa).not.toContainText('{primeiro_nome}')
  await ver(page, info, 'pre-visualizacao-com-o-nome')

  await page
    .getByRole('button', { name: 'Enviar um teste para o meu e-mail' })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Este ambiente não tem servidor de e-mail',
  )

  await page.getByLabel('Depois (agendar)').check()
  await page
    .getByLabel(/^Data e hora da publicação/)
    .fill(await horaDaquiA(page, 7))
  await page.getByRole('button', { name: 'Conferir quem vai receber' }).click()
  await page.getByRole('button', { name: /^Agendar para \d+ / }).click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText('com o grupo calculado naquela hora')
  await dialogo.getByRole('button', { name: /^Agendar para/ }).click()
  await expect(page).toHaveURL(/\/comunicacao\/agendados$/)
  await expect(
    page.getByRole('listitem').filter({ hasText: TITULO }).first(),
  ).toContainText('Publicar em')
  await ver(page, info, 'agendado-na-lista')

  // o servidor recusa o que tem de recusar
  const base = {
    titulo: `${TITULO} recusado`,
    texto: 'Oi {apelido}',
    categoria: 'GERAL',
    valido_ate: new Date(Date.now() + 20 * 86_400_000)
      .toISOString()
      .slice(0, 10),
    exige_confirmacao: false,
    por_email: false,
    publico: { tipo: 'permissao', codigo_permissao: 'financeiro_auditar' },
    total_confirmado: 0,
    publicar_em: new Date(Date.now() + 60 * 60_000).toISOString(),
  }
  const variavel = await page.request.post(`${API_HML}/api/avisos-agendados/`, {
    headers: { Authorization: token },
    data: base,
  })
  expect(variavel.status()).toBe(422)
  const cedo = await page.request.post(`${API_HML}/api/avisos-agendados/`, {
    headers: { Authorization: token },
    data: {
      ...base,
      texto: 'ok',
      publicar_em: new Date(Date.now() + 60_000).toISOString(),
    },
  })
  expect(cedo.status()).toBe(422)
  expect((await cedo.json()).detail).toContain('5 minutos')

  // um segundo agendamento, cancelado com motivo
  await page.goto('/comunicacao/novo')
  await page.getByLabel('Título', { exact: true }).fill(`${TITULO} cancelado`)
  await page.getByLabel(/^Texto/).fill('Este agendamento vai ser cancelado.')
  await escolherOConselho(page)
  await page.getByLabel('Depois (agendar)').check()
  await page
    .getByLabel(/^Data e hora da publicação/)
    .fill(await horaDaquiA(page, 120))
  await page.getByRole('button', { name: 'Conferir quem vai receber' }).click()
  await page.getByRole('button', { name: /^Agendar para \d+ / }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /^Agendar para/ })
    .click()
  const item = page
    .getByRole('listitem')
    .filter({ hasText: `${TITULO} cancelado` })
  await item.getByRole('button', { name: 'Cancelar' }).click()
  await page
    .getByLabel(/Motivo do cancelamento/)
    .fill('Teste do robô: este não sai.')
  await page.getByRole('button', { name: 'Cancelar o agendamento' }).click()
  await expect(page.getByText(/o aviso não será publicado/)).toBeVisible()
  await page.getByLabel(/^Situação/).selectOption('Cancelado')
  await expect(
    page.getByRole('listitem').filter({ hasText: `${TITULO} cancelado` }),
  ).toContainText('Motivo: Teste do robô: este não sai.')
  await ver(page, info, 'cancelado-com-motivo')
  expect(vigia.problemas()).toEqual([])
})
