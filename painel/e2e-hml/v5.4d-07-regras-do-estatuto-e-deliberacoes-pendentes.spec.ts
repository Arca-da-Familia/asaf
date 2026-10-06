import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  campo,
  entrar,
  exigirHomologacao,
  inventariar,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4d — as duas telas que a v2.x deixou só no servidor: "Regras do Estatuto" (lista, histórico e reforma de um parâmetro, com validação e
// confirmação) e "Deliberações pendentes" (painel da Diretoria, de todas as assembleias). A reforma muda uma regra de verdade na homologação, então
// o roteiro usa um parâmetro inofensivo (PRAZO_RECURSO_IMPUGNACAO_DIAS, 5 dias) e o DEVOLVE ao valor de origem no fim.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const PARAMETRO = 'PRAZO_RECURSO_IMPUGNACAO_DIAS'
const OUTRO_PARAMETRO = 'QUORUM_1A_CONVOCACAO'

async function abrirRegras(page: Page): Promise<void> {
  await page.goto('/governanca/estatuto')
  await expect(
    page.getByRole('heading', { name: 'Regras do Estatuto', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(PARAMETRO, { exact: true })).toBeVisible()
}

/** O cartão da regra (o `div` que tem o nome do parâmetro). */
function cartaoDaRegra(page: Page, parametro: string): Locator {
  return page
    .locator('div.rounded-md.border')
    .filter({ has: page.getByText(parametro, { exact: true }) })
    .first()
}

async function totalNaAuditoria(page: Page, tabela: string): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${tabela}`),
  )
  await campo(page, 'Tabela').fill(tabela)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

async function reformarPelaTela(
  page: Page,
  parametro: string,
  valor: string,
): Promise<void> {
  const cartao = cartaoDaRegra(page, parametro)
  await cartao.getByRole('button', { name: `Reformar ${parametro}` }).click()
  const novo = cartao.getByLabel('Novo valor')
  await novo.fill(valor)
  await cartao.getByRole('button', { name: 'Reformar regra' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Reformar regra' })
    .click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(
    cartaoDaRegra(page, parametro).locator('span.font-mono').first(),
  ).toHaveText(valor)
}

test('a lista mostra cada regra com o valor, o artigo de origem e a descrição (do estatuto de verdade)', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirRegras(page)
  await expect(
    page.getByRole('button', { name: /^Reformar / }),
  ).not.toHaveCount(0)
  const quorum = cartaoDaRegra(page, OUTRO_PARAMETRO)
  await expect(quorum).toContainText('2/3')
  await expect(quorum).toContainText('Art. 6º')
  await expect(quorum).toContainText('Vale desde')
  const impugnacao = cartaoDaRegra(page, PARAMETRO)
  await expect(impugnacao.locator('span.font-mono').first()).toHaveText('5')
  await inventariar(page, info, 'regras-do-estatuto')
  await ver(page, info, 'regras do estatuto: a lista')
  expect(vigia.problemas()).toEqual([])
})

test('valor que quebraria o sistema é recusado no campo, igual ao que já vale também, e nada é gravado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const antes = await totalNaAuditoria(page, 'regras_estatutarias')
  await abrirRegras(page)

  // prazo em dias: zero e texto não servem
  const cartao = cartaoDaRegra(page, PARAMETRO)
  await cartao.getByRole('button', { name: `Reformar ${PARAMETRO}` }).click()
  const novo = cartao.getByLabel('Novo valor')
  await novo.fill('0')
  await cartao.getByRole('button', { name: 'Reformar regra' }).click()
  await expect(cartao.getByRole('alert')).toContainText(
    'número inteiro maior que zero',
  )
  await ver(page, info, 'prazo zero: recusado')
  await novo.fill('abc')
  await cartao.getByRole('button', { name: 'Reformar regra' }).click()
  await expect(cartao.getByRole('alert')).toContainText(
    'número inteiro maior que zero',
  )
  // igual ao que já vale não é reforma
  await novo.fill('5')
  await cartao.getByRole('button', { name: 'Reformar regra' }).click()
  await expect(cartao.getByRole('alert')).toContainText('igual ao que já vale')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await cartao.getByRole('button', { name: 'Cancelar' }).click()
  await expect(cartao.getByLabel('Novo valor')).toHaveCount(0)

  // quórum: fração impossível
  const quorum = cartaoDaRegra(page, OUTRO_PARAMETRO)
  await quorum
    .getByRole('button', { name: `Reformar ${OUTRO_PARAMETRO}` })
    .click()
  await quorum.getByLabel('Novo valor').fill('2/0')
  await quorum.getByRole('button', { name: 'Reformar regra' }).click()
  await expect(quorum.getByRole('alert')).toContainText('fração como 2/3')
  await quorum.getByLabel('Novo valor').fill('5/3')
  await quorum.getByRole('button', { name: 'Reformar regra' }).click()
  await expect(quorum.getByRole('alert')).toContainText('fração como 2/3')
  await ver(page, info, 'quorum com fracao impossivel: recusado')
  await quorum.getByRole('button', { name: 'Cancelar' }).click()

  // nada foi gravado: nem a regra mudou, nem a Auditoria ganhou uma reforma
  await abrirRegras(page)
  await expect(
    cartaoDaRegra(page, OUTRO_PARAMETRO).locator('span.font-mono').first(),
  ).toHaveText('2/3')
  expect(await totalNaAuditoria(page, 'regras_estatutarias')).toBe(antes)
  expect(vigia.problemas()).toEqual([])
})

test('reformar de verdade: pede confirmação, a regra muda, o histórico guarda as duas, a Auditoria registra; depois devolve ao valor de origem', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const antes = await totalNaAuditoria(page, 'regras_estatutarias')
  await abrirRegras(page)

  const cartao = cartaoDaRegra(page, PARAMETRO)
  await cartao.getByRole('button', { name: `Reformar ${PARAMETRO}` }).click()
  await cartao.getByLabel('Novo valor').fill('6')
  await cartao.getByRole('button', { name: 'Reformar regra' }).click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText('De “5” para “6”')
  await ver(page, info, 'reforma: pede confirmacao')
  // desistir não muda nada
  await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(dialogo).toHaveCount(0)
  await expect(
    cartaoDaRegra(page, PARAMETRO).locator('span.font-mono').first(),
  ).toHaveText('5')

  await reformarPelaTela(page, PARAMETRO, '6')
  await ver(page, info, 'regra reformada para 6')

  // o histórico guarda as duas vigências
  await cartaoDaRegra(page, PARAMETRO)
    .getByRole('button', { name: `Histórico de ${PARAMETRO}` })
    .click()
  const historico = cartaoDaRegra(page, PARAMETRO).locator('li')
  await expect(historico.filter({ hasText: '(vigente)' })).toContainText('6')
  await expect(
    historico.filter({ hasText: 'até' }).filter({ hasText: '5' }).first(),
  ).toBeVisible()
  await ver(page, info, 'historico das vigencias da regra')

  // a Auditoria registra a reforma
  expect(await totalNaAuditoria(page, 'regras_estatutarias')).toBe(antes + 1)
  await expect(
    page
      .getByRole('row')
      .filter({
        has: page.getByRole('cell', { name: 'REFORMA', exact: true }),
      })
      .first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria: reforma da regra')

  // devolve ao valor de origem (a homologação fica como estava)
  await abrirRegras(page)
  await reformarPelaTela(page, PARAMETRO, '5')
  expect(await totalNaAuditoria(page, 'regras_estatutarias')).toBe(antes + 2)
  expect(vigia.problemas()).toEqual([])
})

test('deliberações pendentes: a tela abre para a Diretoria e cada deliberação leva até a ata onde ela se conclui', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/governanca/deliberacoes')
  await expect(
    page.getByRole('heading', { name: 'Deliberações pendentes', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await inventariar(page, info, 'deliberacoes-pendentes')
  await ver(page, info, 'deliberacoes pendentes')

  const links = page.getByRole('link', { name: 'Abrir a ata' })
  if ((await links.count()) === 0) {
    await expect(page.getByText('Nenhuma deliberação pendente')).toBeVisible()
  } else {
    await links.first().click()
    await expect(page).toHaveURL(/\/governanca\/\d+\/ata\?ata=\d+$/)
    await expect(
      page.getByRole('heading', { name: /^Ata/ }).first(),
    ).toBeVisible()
    await ver(page, info, 'a ata da deliberacao pendente')
  }

  // quem não é da Diretoria não alcança o painel
  await sair(page)
  await entrar(page, 'tesoureiro')
  await page.goto('/governanca/deliberacoes')
  await expect(page).toHaveURL(/\/403$/)
  expect(vigia.problemas()).toEqual([])
})
