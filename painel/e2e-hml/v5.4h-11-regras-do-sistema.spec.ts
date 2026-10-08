import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  entrar,
  exigirHomologacao,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Regras do sistema: os limites e prazos que o sistema usa, ajustáveis pela presidência na própria tela (antes só por API). O roteiro prova, pela tela:
// a lista das regras; o limite do lançamento tardio (padrão 5 dias) muda e continua mudado ao recarregar; o que vale no servidor é o valor novo (a saída
// registrada e o relatório de exceção usam o limite da tela); valor inválido é recusado em português e não é gravado; cada mudança fica na Auditoria com o
// valor antes e depois; quem não administra o acesso (Secretário) é barrado. No fim o limite volta para 5, para os outros roteiros partirem do estado de fábrica.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const CHAVE = 'DIAS_ALERTA_LANCAMENTO_TARDIO'
const PADRAO = '5'
const TABELA = 'configuracoes_institucionais'

const linha = (page: Page) => page.getByRole('listitem', { name: CHAVE })
const campoDoLimite = (page: Page) =>
  linha(page).getByRole('spinbutton', { name: /lançamento é tardio/ })

async function abrirRegras(page: Page): Promise<void> {
  // os módulos aparecem como cartões no Início (o menu lateral só mostra os itens do módulo em que se está)
  await page
    .getByRole('link', { name: /^Regras do sistema/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Regras do sistema', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await expect(linha(page)).toBeVisible()
}

async function capturarToken(page: Page): Promise<() => string> {
  let token = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token = cab
  })
  return () => token
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

async function salvarLimite(page: Page, valor: string): Promise<void> {
  await campoDoLimite(page).fill(valor)
  await linha(page).getByRole('button', { name: 'Salvar' }).click()
  await expect(linha(page).getByRole('status')).toContainText('Salvo.')
}

let totalAntes = 0
let alteracoes = 0

test('a tela mostra as regras ajustáveis, com o limite do lançamento tardio no padrão de fábrica', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  totalAntes = await totalNaAuditoria(page)
  await page.goto('/')
  await abrirRegras(page)
  await expect(page.getByRole('listitem').first()).toBeVisible()
  expect(await page.getByRole('listitem').count()).toBeGreaterThan(5)
  // só as regras de funcionamento: dado institucional e identidade não entram aqui
  await expect(page.getByText('DATA_MAGNA')).toHaveCount(0)
  await expect(page.getByText('NOME_INSTITUICAO')).toHaveCount(0)
  // partir do estado certo: se uma rodada anterior falhou no meio, o limite pode estar diferente
  if ((await campoDoLimite(page).inputValue()) !== PADRAO) {
    await salvarLimite(page, PADRAO)
    alteracoes += 1
  }
  await expect(campoDoLimite(page)).toHaveValue(PADRAO)
  await expect(
    linha(page).getByRole('button', { name: 'Salvar' }),
  ).toBeDisabled()
  await ver(page, info, 'regras-do-sistema')
  expect(vigia.problemas()).toEqual([])
})

test('mudar o limite grava, continua gravado ao recarregar e vale no servidor; valor inválido é recusado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'presidente')
  await abrirRegras(page)

  await salvarLimite(page, '7')
  alteracoes += 1
  await ver(page, info, 'limite-mudado-para-7')
  await page.reload()
  await expect(campoDoLimite(page)).toHaveValue('7')

  // o servidor devolve o valor novo (a mesma regra que a saída registrada e o relatório de exceção leem)
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const lido = await page.request.fetch(
    `${API_HML}/api/configuracoes/${CHAVE}`,
    {
      headers: { Authorization: token() },
    },
  )
  expect(lido.status()).toBe(200)
  expect((await lido.json()).valor).toBe('7')

  // valor que não é número: o servidor recusa (a tela de número nem deixa digitar letras, então a recusa é provada pela API) e nada muda
  const recusado = await page.request.fetch(
    `${API_HML}/api/configuracoes/${CHAVE}`,
    {
      method: 'PUT',
      headers: { Authorization: token(), 'Content-Type': 'application/json' },
      data: JSON.stringify({ valor: 'muitos' }),
    },
  )
  expect(recusado.status()).toBe(422)
  expect(await recusado.text()).toContain('número')
  await page.reload()
  await expect(campoDoLimite(page)).toHaveValue('7')
  await ver(page, info, 'valor-invalido-recusado-e-limite-intacto')

  // volta ao padrão de fábrica
  await salvarLimite(page, PADRAO)
  alteracoes += 1
  await page.reload()
  await expect(campoDoLimite(page)).toHaveValue(PADRAO)
  expect(vigia.problemas()).toEqual([])
})

test('cada mudança fica na Auditoria e o Secretário é barrado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'secretario')
  await page.goto('/regras')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const barrado = await page.request.fetch(
    `${API_HML}/api/configuracoes/${CHAVE}`,
    {
      method: 'PUT',
      headers: { Authorization: token(), 'Content-Type': 'application/json' },
      data: JSON.stringify({ valor: '99' }),
    },
  )
  expect(barrado.status()).toBe(403)
  await sair(page)

  await entrar(page, 'presidente')
  const total = await totalNaAuditoria(page)
  expect(total - totalAntes, 'mudanças desta rodada na Auditoria').toBe(
    alteracoes,
  )
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'UPDATE', exact: true }) })
      .first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria-das-regras')
  expect(vigia.problemas()).toEqual([])
})
