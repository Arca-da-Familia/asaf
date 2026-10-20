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

// v6.2a - O AVISO TAMBÉM POR E-MAIL (decisões do Presidente, 2026-10-20). A homologação NÃO tem servidor de e-mail (decisão de 2026-10-05: nada sai para gente inventada), então
// aqui se prova o que é do sistema: a caixa "também por e-mail" (marcada sozinha na Convocação), a conferência com quantos têm e-mail, a FILA de cada pessoa no relatório (nada sai
// daqui: ninguém aparece como "Enviado"), retirar cancela o que estava na fila, um aviso sem e-mail não tem a coluna, a Auditoria guarda que o aviso foi por e-mail, e quem não tem
// `comunicar` não reenvia (403). O envio em si (enviado, falha, limite do Google, tetos) é provado pelos testes do servidor contra um servidor de e-mail simulado.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const TITULO = `Convocação de teste v6.2a ${RODADA}`
const TITULO_SO_PAINEL = `Aviso só no painel v6.2a ${RODADA}`
let idDoAviso = 0

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

async function novoAviso(page: Page, titulo: string, categoria: string) {
  await page.goto('/comunicacao/novo')
  await expect(page.getByRole('heading', { name: 'Novo aviso' })).toBeVisible()
  await page.getByLabel('Título').fill(titulo)
  await page
    .getByLabel(/^Texto/)
    .fill('Assembleia geral ordinária no sábado às 9h, na sede.')
  await page.getByLabel(/^Categoria/).selectOption({ label: categoria })
  await page.getByLabel('Quem tem uma permissão').check()
  await page
    .getByLabel(/^Permissão/)
    .selectOption({ value: 'financeiro_auditar' })
}

test('o Secretário publica uma Convocação: a caixa "também por e-mail" vem marcada e a conferência diz quantos têm e-mail', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await comoPapel(page, 'secretario')
  await novoAviso(page, TITULO, 'Convocação')
  const caixa = page.getByRole('checkbox', { name: /Também por e-mail/ })
  await expect(caixa).toBeChecked()
  await page.getByRole('button', { name: 'Conferir quem vai receber' }).click()
  await expect(
    page.getByText(/Por e-mail: \d+ de \d+ têm e-mail no cadastro/),
  ).toBeVisible()
  await ver(page, info, 'convocacao-com-a-caixa-do-e-mail-marcada')
  await page.getByRole('button', { name: /^Publicar para/ }).click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText('Também sai por e-mail para')
  await dialogo.getByRole('button', { name: /^Publicar para/ }).click()

  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible()
  idDoAviso = Number(page.url().match(/\/comunicacao\/(\d+)$/)?.[1])
  await expect(page.getByText(/^E-mail: /)).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'E-mail' })).toBeVisible()
  // a homologação não tem servidor de e-mail: tudo fica na fila (ou sem e-mail no cadastro), nada como enviado
  await expect(
    page.getByRole('cell', { name: 'Na fila', exact: true }).first(),
  ).toBeVisible()
  await expect(page.getByRole('cell', { name: /^Enviado/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Reenviar/ })).toHaveCount(0)
  await ver(page, info, 'relatorio-com-a-fila-do-e-mail')
  expect(vigia.problemas()).toEqual([])
})

test('quem não tem comunicar não reenvia; a Auditoria guarda que o aviso foi por e-mail', async ({
  page,
}) => {
  const tokenDoTesoureiro = await comoPapel(page, 'tesoureiro')
  const recusa = await page.request.post(
    `${API_HML}/api/avisos/${idDoAviso}/reenviar-emails`,
    {
      headers: { Authorization: tokenDoTesoureiro },
    },
  )
  expect(recusa.status()).toBe(403)

  const presidente = await page.context().browser()!.newPage()
  const tokenDoPresidente = await comoPapel(presidente, 'presidente')
  const r = await presidente.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=avisos&acao=AVISO_PUBLICADO&por_pagina=200`,
    { headers: { Authorization: tokenDoPresidente } },
  )
  const { entradas } = (await r.json()) as {
    entradas: Array<{ id_registro_afetado: number; dados_depois: string }>
  }
  const doAviso = entradas.filter((e) => e.id_registro_afetado === idDoAviso)
  expect(doAviso).toHaveLength(1)
  expect(String(doAviso[0]!.dados_depois)).toContain('"por_email": true')
  await presidente.close()
})

test('retirar cancela o e-mail que ainda estava na fila', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await comoPapel(page, 'secretario')
  await page.goto(`/comunicacao/${idDoAviso}`)
  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible()
  await page.getByRole('button', { name: 'Retirar do mural' }).click()
  await page
    .getByLabel(/Motivo da retirada/)
    .fill('Convocação de teste retirada pelo robô.')
  await page.getByRole('button', { name: 'Retirar o aviso' }).click()
  await expect(page.getByText('Aviso retirado do mural.')).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'Cancelado', exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'Na fila', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText(/^E-mail: .*cancelados/)).toBeVisible()
  await ver(page, info, 'retirado-com-o-e-mail-cancelado')
  expect(vigia.problemas()).toEqual([])
})

test('um aviso de categoria comum sai só no painel: sem a caixa marcada, o relatório não tem a coluna do e-mail', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await comoPapel(page, 'secretario')
  await novoAviso(page, TITULO_SO_PAINEL, 'Geral')
  await expect(
    page.getByRole('checkbox', { name: /Também por e-mail/ }),
  ).not.toBeChecked()
  await page.getByRole('button', { name: 'Conferir quem vai receber' }).click()
  await expect(page.getByText(/Por e-mail:/)).toHaveCount(0)
  await page.getByRole('button', { name: /^Publicar para/ }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /^Publicar para/ })
    .click()
  await expect(
    page.getByRole('heading', { name: TITULO_SO_PAINEL }),
  ).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'E-mail' })).toHaveCount(
    0,
  )
  await expect(page.getByText(/^E-mail: /)).toHaveCount(0)
  await ver(page, info, 'aviso-so-no-painel')
  // limpa: o aviso de teste sai do mural das pessoas de teste
  await page.getByRole('button', { name: 'Retirar do mural' }).click()
  await page
    .getByLabel(/Motivo da retirada/)
    .fill('Aviso de teste retirado pelo robô.')
  await page.getByRole('button', { name: 'Retirar o aviso' }).click()
  await expect(page.getByText('Aviso retirado do mural.')).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})
