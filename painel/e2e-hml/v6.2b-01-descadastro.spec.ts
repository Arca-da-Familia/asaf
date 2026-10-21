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

// v6.2b - PREFERÊNCIAS DE CONTATO E DESCADASTRO DE VERDADE (decisões do Presidente, 2026-10-20: só Convocação e Mudança de regra são obrigatórias). Provado na
// homologação, pelas telas, com as pessoas de teste:
//  1. o CONSELHEIRO abre Meu Perfil > E-mails da ASAF: três escolhas (avisos não obrigatórios, lembretes de mensalidade, avisos de evento), a convocação e a mudança
//     de regra NÃO aparecem como opção (a tela diz por quê); ele desliga os avisos;
//  2. o SECRETÁRIO publica, para o Conselho Fiscal, um aviso Geral e uma Convocação, os dois também por e-mail: a conferência diz que alguém desligou; no relatório,
//     o conselheiro aparece como "Desligou por escolha" no Geral e "Na fila" na Convocação (a obrigatória chega mesmo assim);
//  3. o link do conselheiro (a homologação não tem e-mail: só ali o painel entrega à própria pessoa o link dela) abre a página do SITE DE TESTE, que diz que ele não
//     recebe mais; ele clica "Quero voltar a receber" e o Meu Perfil mostra a escolha de volta; a Auditoria guarda as duas mudanças (a do link, sem usuário);
//  4. um link adulterado é recusado pela página e pela API (404). Os avisos de teste são retirados no fim.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const TITULO_GERAL = `Aviso geral v6.2b ${RODADA}`
const TITULO_CONVOCACAO = `Convocação v6.2b ${RODADA}`
let nomeDoConselheiro = ''
let linkDoConselheiro = ''
const avisos: number[] = []

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

// mesmo se um passo falhar no meio: o conselheiro volta a receber os avisos e os avisos de teste saem do mural (os próximos robôs não herdam o estado)
test.afterAll(async ({ browser }) => {
  const pagina = await browser.newPage()
  try {
    const conselheiro = await comoPapel(pagina, 'conselheiro')
    await pagina.request.put(
      `${API_HML}/api/minhas-preferencias-de-comunicacao/`,
      {
        headers: { Authorization: conselheiro },
        data: { tipo: 'avisos', recebe: true },
      },
    )
    const presidente = await comoPapel(pagina, 'presidente')
    for (const id of avisos) {
      // 409 = já retirado no último passo: tudo certo
      await pagina.request.post(`${API_HML}/api/avisos/${id}/retirar`, {
        headers: { Authorization: presidente },
        data: { motivo: 'Aviso de teste do robô retirado.' },
      })
    }
  } finally {
    await pagina.close()
  }
})

async function abrirEmailsDaAsaf(page: Page) {
  await page.goto('/perfil')
  await page.getByRole('button', { name: 'E-mails da ASAF' }).click()
  await expect(
    page.getByRole('heading', { name: 'E-mails da ASAF' }),
  ).toBeVisible()
}

test('o Conselheiro vê as três escolhas no Meu Perfil e desliga os avisos por e-mail', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'conselheiro')
  nomeDoConselheiro = (
    (await (
      await page.request.get(`${API_HML}/auth/me`, {
        headers: { Authorization: token },
      })
    ).json()) as { nome_completo: string }
  ).nome_completo
  await abrirEmailsDaAsaf(page)
  const avisosPorEmail = page.getByRole('checkbox', {
    name: /^Avisos do mural/,
  })
  await expect(avisosPorEmail).toBeVisible()
  await expect(
    page.getByRole('checkbox', { name: /^Lembretes de mensalidade/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('checkbox', { name: /^Avisos sobre eventos/ }),
  ).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Convocação/ })).toHaveCount(
    0,
  )
  await expect(page.getByText(/não podem ser desligadas/)).toBeVisible()
  if (!(await avisosPorEmail.isChecked())) {
    await avisosPorEmail.check() // começa do estado padrão
    await expect(avisosPorEmail).toBeChecked()
  }
  await avisosPorEmail.uncheck()
  await expect(
    page.getByText(/Você não receberá mais: avisos do mural/),
  ).toBeVisible()
  await expect(avisosPorEmail).not.toBeChecked()
  // a homologação não tem e-mail: só aqui o painel mostra à própria pessoa o link que iria no fim do e-mail
  const link = page
    .getByRole('link', { name: /\/descadastrar\/\?token=/ })
    .first()
  linkDoConselheiro = (await link.getAttribute('href')) ?? ''
  expect(linkDoConselheiro).toMatch(
    /^https:\/\/hml-site\.asaf\.org\.br\/descadastrar\/\?token=\d+\.avisos\.[0-9a-f]{32}$/,
  )
  await ver(page, info, 'meu-perfil-avisos-desligados')
  expect(vigia.problemas()).toEqual([])
})

test('o Secretário publica um aviso comum e uma convocação: o comum não vai por e-mail a quem desligou, a convocação vai', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await comoPapel(page, 'secretario')
  for (const [titulo, categoria] of [
    [TITULO_GERAL, 'Geral'],
    [TITULO_CONVOCACAO, 'Convocação'],
  ] as const) {
    await page.goto('/comunicacao/novo')
    await page.getByLabel('Título').fill(titulo)
    await page.getByLabel(/^Texto/).fill('Aviso de teste do robô da v6.2b.')
    await page.getByLabel(/^Categoria/).selectOption({ label: categoria })
    await page.getByRole('checkbox', { name: /Também por e-mail/ }).check()
    await page.getByLabel('Quem tem uma permissão').check()
    await page
      .getByLabel(/^Permissão/)
      .selectOption({ value: 'financeiro_auditar' })
    await page
      .getByRole('button', { name: 'Conferir quem vai receber' })
      .click()
    await expect(
      page.getByText(
        categoria === 'Geral'
          ? /desligaram os avisos por e-mail e não recebem este por e-mail/
          : /desligaram os avisos por e-mail, mas este é obrigatório e chega a eles também/,
      ),
    ).toBeVisible()
    await ver(page, info, `conferencia-${categoria}`)
    await page.getByRole('button', { name: /^Publicar para/ }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Publicar para/ })
      .click()
    await expect(page.getByRole('heading', { name: titulo })).toBeVisible()
    avisos.push(Number(page.url().match(/\/comunicacao\/(\d+)$/)?.[1]))
    const linha = page.getByRole('row').filter({ hasText: nomeDoConselheiro })
    await expect(linha).toContainText(
      categoria === 'Geral' ? 'Desligou por escolha' : 'Na fila',
    )
    await ver(page, info, `relatorio-${categoria}`)
  }
  expect(vigia.problemas()).toEqual([])
})

test('o link do Conselheiro abre a página do site de teste, e ele volta a receber por ela', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(linkDoConselheiro)
  const situacao = page.locator('[data-situacao]')
  await expect(situacao).toContainText(
    'Você NÃO recebe mais este tipo de e-mail da ASAF',
  )
  await ver(page, info, 'site-o-link-mostra-que-nao-recebe')
  await page.getByRole('button', { name: 'Quero voltar a receber' }).click()
  await expect(page.locator('[data-resultado]')).toHaveText(
    'Pronto: você voltará a receber este tipo de e-mail.',
  )
  await ver(page, info, 'site-voltou-a-receber')

  // um link adulterado é recusado (a página e a API)
  const adulterado = linkDoConselheiro.replace(/[0-9a-f]$/, (c) =>
    c === '0' ? '1' : '0',
  )
  await page.goto(adulterado)
  await expect(
    page
      .getByText('Este link não é válido ou está incompleto')
      .filter({ visible: true }),
  ).toBeVisible()
  const token = new URL(adulterado).searchParams.get('token') ?? ''
  expect(
    (
      await page.request.get(
        `${API_HML}/api/publico/descadastro?token=${token}`,
      )
    ).status(),
  ).toBe(404)

  // de volta ao painel: a escolha voltou
  await comoPapel(page, 'conselheiro')
  await abrirEmailsDaAsaf(page)
  await expect(
    page.getByRole('checkbox', { name: /^Avisos do mural/ }),
  ).toBeChecked()
  await ver(page, info, 'meu-perfil-recebe-de-novo')
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guarda as duas mudanças; os avisos de teste são retirados', async ({
  page,
}) => {
  const presidente = await comoPapel(page, 'presidente')
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=preferencias_de_comunicacao&acao=PREFERENCIA_DE_COMUNICACAO_ALTERADA&por_pagina=20`,
    { headers: { Authorization: presidente } },
  )
  const { entradas } = (await r.json()) as {
    entradas: Array<{ id_usuario: number | null; dados_depois: string }>
  }
  const doPainel = entradas.find(
    (e) =>
      String(e.dados_depois).includes('"origem": "painel"') &&
      String(e.dados_depois).includes('"recebe": false'),
  )
  const doLink = entradas.find(
    (e) =>
      String(e.dados_depois).includes('"origem": "link do e-mail"') &&
      String(e.dados_depois).includes('"recebe": true'),
  )
  expect(doPainel?.id_usuario, 'pelo painel: com quem mudou').not.toBeNull()
  expect(doLink, 'pelo link: registrada').toBeTruthy()
  expect(doLink!.id_usuario, 'pelo link: sem usuário').toBeNull()

  for (const id of avisos) {
    const retirar = await page.request.post(
      `${API_HML}/api/avisos/${id}/retirar`,
      {
        headers: { Authorization: presidente },
        data: { motivo: 'Aviso de teste do robô retirado.' },
      },
    )
    expect(retirar.status()).toBe(200)
  }
})
