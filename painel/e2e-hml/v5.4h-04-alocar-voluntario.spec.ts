import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  AVISO,
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Alocar voluntário direto num turno (a tela que faltava): no projeto, a equipe escolhe a pessoa, a função e o turno e a alocação já nasce
// confirmada; a escala do projeto mostra quem está alocado. O que o roteiro prova, pela tela: o formulário vazio diz o que falta; quem não tem o
// termo de voluntariado vigente é recusado em português (e a recusa não deixa rastro); quem tem entra na escala e continua lá ao recarregar; a
// Auditoria registra a alocação; quem não tem a permissão de projetos (Secretário) é barrado.
test.describe.configure({ mode: 'serial' })
test.setTimeout(420_000)

const S = String(RODADA)
const NOME_DO_PROJETO = `Projeto da Escala ${S}`
const COM_TERMO = 'Karina Duarte Melo'
const SEM_TERMO = 'Leonardo Batista Reis'
const FUNCAO = `Apoio na cozinha ${S.slice(-4)}`
const TABELA = 'alocacoes_voluntarios'

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const itemDoProjeto = (page: Page, nome: string): Locator =>
  page
    .locator('div[role="button"][aria-pressed]')
    .filter({ hasText: new RegExp(`^\\s*${escapar(nome)}\\s+nº\\s+\\d+`) })

const detalheDoProjeto = (page: Page, nome: string): Locator =>
  page
    .getByRole('heading', { name: nome, level: 2, exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')

/** O bloco "Alocar voluntário direto num turno" do projeto aberto. */
async function abrirOBloco(page: Page): Promise<Locator> {
  await page.goto('/projetos')
  await expect(
    page.getByRole('heading', { name: 'Projetos', level: 1 }),
  ).toBeVisible()
  const item = itemDoProjeto(page, NOME_DO_PROJETO)
  await expect(item).toBeVisible()
  await item.click()
  const detalhe = detalheDoProjeto(page, NOME_DO_PROJETO)
  await expect(detalhe).toBeVisible()
  const bloco = detalhe.locator(
    'xpath=.//p[starts-with(normalize-space(.), "Alocar voluntário direto num turno")]/..',
  )
  await expect(bloco).toBeVisible()
  await expect(bloco.getByText(/^Carregando/)).toHaveCount(0)
  return bloco
}

async function totalNaAuditoria(page: Page): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${TABELA}`),
  )
  await campo(page, 'Tabela').fill(TABELA)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

async function capturarToken(page: Page): Promise<() => string> {
  let token = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token = cab
  })
  return () => token
}

let totalAntes = 0

test('preparo: o projeto de teste e o termo de voluntariado de quem vai ser alocado (na ficha, em Vínculos)', async ({
  page,
}, info) => {
  exigirHomologacao()
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')

  const criado = await page.request.fetch(`${API_HML}/projetos/`, {
    method: 'POST',
    headers: { Authorization: token(), 'Content-Type': 'application/json' },
    data: JSON.stringify({
      nome_projeto: NOME_DO_PROJETO,
      tipo_foco: 'Social',
      necessita_alvara_bombeiros: false,
      data_inicio: new Date(Date.now() + 86_400_000).toISOString(),
      data_fim_prevista: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    }),
  })
  expect(criado.status(), 'criar o projeto de teste').toBe(200)

  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(COM_TERMO)
  await page
    .getByRole('link', { name: new RegExp(COM_TERMO) })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: new RegExp(COM_TERMO) }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Vínculos' }).click()
  await page
    .getByRole('button', { name: /^(Registrar|Renovar) termo de adesão$/ })
    .click()
  await page.getByLabel('Atividade *').fill('Apoio em projetos (teste do robô)')
  await page.getByLabel('Carga horária semanal *').fill('4')
  await page
    .getByLabel('Fim da vigência *')
    .fill(new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Confirmar termo de adesão' }).click()
  await expect(page.locator(AVISO)).toContainText('Termo de adesão registrado')
  await ver(page, info, 'termo-de-adesao-registrado')

  totalAntes = await totalNaAuditoria(page)
  expect(vigia.problemas()).toEqual([])
})

test('o formulário vazio diz o que falta; quem não tem termo vigente é recusado em português e nada fica na escala', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const bloco = await abrirOBloco(page)
  await expect(
    bloco.getByText('Ninguém está na escala deste projeto ainda.'),
  ).toBeVisible()

  await bloco.getByRole('button', { name: 'Alocar agora' }).click()
  await expect(bloco.getByText('Escolha o voluntário.')).toBeVisible()
  await expect(bloco.getByText('Informe a função.')).toBeVisible()
  await expect(bloco.getByText('Informe o início do turno.')).toBeVisible()
  await expect(bloco.getByText('Informe o fim do turno.')).toBeVisible()

  await escolherPorTexto(
    bloco.getByLabel('Voluntário', { exact: true }),
    SEM_TERMO,
  )
  await bloco.getByLabel('Função do voluntário').fill(FUNCAO)
  await bloco
    .getByLabel('Início do turno do voluntário')
    .fill('2088-03-02T08:00')
  await bloco.getByLabel('Fim do turno do voluntário').fill('2088-03-02T12:00')
  await bloco.getByRole('button', { name: 'Alocar agora' }).click()
  await expect(bloco.getByRole('alert')).toContainText(/termo/i)
  await expect(
    bloco.getByText('Ninguém está na escala deste projeto ainda.'),
  ).toBeVisible()
  await ver(page, info, 'recusa-sem-termo-de-voluntariado')
  expect(vigia.problemas()).toEqual([])
})

test('quem tem o termo vigente é alocado, aparece na escala (e continua lá ao recarregar) e a Auditoria registra', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const bloco = await abrirOBloco(page)
  await escolherPorTexto(
    bloco.getByLabel('Voluntário', { exact: true }),
    COM_TERMO,
  )
  await bloco.getByLabel('Função do voluntário').fill(FUNCAO)
  await bloco
    .getByLabel('Início do turno do voluntário')
    .fill('2088-03-02T08:00')
  await bloco.getByLabel('Fim do turno do voluntário').fill('2088-03-02T12:00')
  await bloco.getByLabel('Horas previstas do voluntário').fill('4')
  await bloco.getByRole('button', { name: 'Alocar agora' }).click()

  const linha = bloco
    .locator('div.rounded-md.border')
    .filter({ hasText: `${COM_TERMO} — ${FUNCAO}` })
  await expect(linha).toHaveCount(1)
  await expect(linha).toContainText('4 h previstas · CONFIRMADA')
  await ver(page, info, 'voluntario-na-escala')

  // por um endereço novo: o que aparece veio do servidor
  const blocoDeNovo = await abrirOBloco(page)
  await expect(
    blocoDeNovo
      .locator('div.rounded-md.border')
      .filter({ hasText: `${COM_TERMO} — ${FUNCAO}` }),
  ).toHaveCount(1)

  const total = await totalNaAuditoria(page)
  expect(
    total - totalAntes,
    'uma alocação na Auditoria (a recusa não deixou rastro)',
  ).toBe(1)
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('cell', { name: 'CREATE', exact: true }),
    }),
  ).not.toHaveCount(0)
  await ver(page, info, 'auditoria-da-alocacao')
  expect(vigia.problemas()).toEqual([])
})

test('quem não tem a permissão de projetos (Secretário) é barrado na tela e na API', async ({
  page,
}) => {
  const token = await capturarToken(page)
  await entrar(page, 'secretario')
  await page.goto('/projetos')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  const r = await page.request.fetch(`${API_HML}/api/projetos/1/alocacoes`, {
    headers: { Authorization: token() },
  })
  expect(r.status()).toBe(403)
})
