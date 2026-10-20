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

// v6.1 - COMUNICAÇÃO INTERNA NO PAINEL (decisões do Presidente, 2026-10-20). Provado na homologação, pelas telas, com as pessoas de teste:
//  1. o SECRETÁRIO publica: ele tem `comunicar` pelo CARGO de 1º Secretário (a migração deu a permissão ao cargo). Na tela "Novo aviso" ele confere o grupo antes
//     (associados em dia: a contagem diz quantos não têm acesso ao painel; mudar o grupo apaga a contagem), escolhe "quem tem a permissão financeiro_auditar"
//     (o Conselho Fiscal), e só então publica, com o número de pessoas no botão e na confirmação. O servidor recusa um total errado (409) e não grava nada;
//  2. o TESOUREIRO (sem `comunicar`) não vê o módulo, o endereço dá "sem permissão" e o servidor recusa (403); ele não está no grupo: o aviso não aparece no mural
//     dele e abrir pelo número dá 404;
//  3. o CONSELHEIRO vê o aviso no sino e no mural ("Pede a sua confirmação"), abre (a leitura fica registrada) e confirma ("Li e estou ciente");
//  4. o relatório de leitura mostra quem leu e confirmou; "incluir quem entrou depois" diz que ninguém é novo; retirar exige motivo e tira do mural;
//     a Auditoria (lida pelo Presidente) guarda a publicação, a confirmação e a retirada;
//  5. o conselheiro vê o aviso retirado, com o motivo, na caixa de entrada (fora do mural) e sem o botão de confirmar.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const TITULO = `Aviso de teste v6.1 ${RODADA}`
const TEXTO =
  'Reunião do Conselho Fiscal na sexta às 19h.\nTraga o relatório do mês.'
const MOTIVO = 'A reunião mudou de data; um novo aviso vai a seguir.'
let idDoAviso = 0
let totalDoGrupo = 0
let nomeDoConselheiro = ''

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

test('o Secretário (pelo cargo) confere o grupo e publica para o Conselho Fiscal; o servidor recusa um total errado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'secretario')
  await page.getByRole('link', { name: 'Comunicação' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Avisos publicados' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Novo aviso' }).first().click()
  await expect(page.getByRole('heading', { name: 'Novo aviso' })).toBeVisible()

  await page.getByLabel('Título').fill(TITULO)
  await page.getByLabel(/^Texto/).fill(TEXTO)
  await page.getByLabel(/^Categoria/).selectOption({ label: 'Convocação' })
  await page.getByLabel(/Pedir confirmação de leitura/).check()
  await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled()

  // a prévia de um grupo de associados: a homologação tem associados sem acesso ao painel, e a tela diz quantos
  await page.getByLabel('Ativo - Em Dia').check()
  await page.getByRole('button', { name: 'Conferir quem vai receber' }).click()
  const previa = page
    .getByRole('status')
    .filter({ hasText: 'Associados em situação Ativo - Em Dia' })
  await expect(previa).toBeVisible()
  await expect(previa).toContainText('sem acesso ao painel')
  await page.getByText('Ver os nomes').click()
  await ver(page, info, 'previa-associados-em-dia-com-quem-nao-tem-acesso')

  // trocar o grupo apaga a contagem: publicar volta a ficar travado
  await page.getByLabel('Quem tem uma permissão').check()
  await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Conferir quem vai receber' }),
  ).toBeDisabled()
  await page
    .getByLabel(/^Permissão/)
    .selectOption({ value: 'financeiro_auditar' })
  await page.getByRole('button', { name: 'Conferir quem vai receber' }).click()
  const publicar = page.getByRole('button', { name: /^Publicar para \d+ / })
  await expect(publicar).toBeEnabled()
  totalDoGrupo = Number(
    ((await publicar.textContent()) ?? '').match(/(\d+)/)?.[1] ?? '0',
  )
  expect(
    totalDoGrupo,
    'os três do Conselho Fiscal, ao menos',
  ).toBeGreaterThanOrEqual(3)
  await ver(page, info, 'grupo-conferido-conselho-fiscal')

  // o servidor recusa um total diferente do que ele calcula (e não grava nada)
  const errado = await page.request.post(`${API_HML}/api/avisos/`, {
    headers: { Authorization: token },
    data: {
      titulo: TITULO,
      texto: TEXTO,
      categoria: 'CONVOCACAO',
      valido_ate: new Date(Date.now() + 10 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      exige_confirmacao: true,
      publico: { tipo: 'permissao', codigo_permissao: 'financeiro_auditar' },
      total_confirmado: totalDoGrupo + 100,
    },
  })
  expect(errado.status()).toBe(409)
  expect((await errado.json()).detail).toContain('O grupo mudou')

  await publicar.click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText(`vai para ${totalDoGrupo} pessoas`)
  await ver(page, info, 'confirmacao-com-o-numero-de-pessoas')
  await dialogo.getByRole('button', { name: /^Publicar para/ }).click()

  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible()
  await expect(page).toHaveURL(/\/comunicacao\/\d+$/)
  idDoAviso = Number(page.url().match(/\/comunicacao\/(\d+)$/)?.[1])
  await expect(page.getByText(`Receberam: ${totalDoGrupo}`)).toBeVisible()
  await expect(page.getByText('Ainda não leu').first()).toBeVisible()
  await ver(page, info, 'aviso-publicado-relatorio-de-leitura')

  const lista = await page.request.get(
    `${API_HML}/api/avisos/?busca=${encodeURIComponent(TITULO)}`,
    { headers: { Authorization: token } },
  )
  expect((await lista.json()).total, 'um aviso só: o 409 não gravou nada').toBe(
    1,
  )
  expect(vigia.problemas()).toEqual([])
})

test('o Tesoureiro não tem comunicar: sem o módulo, sem a tela, o servidor recusa; e, fora do grupo, não vê o aviso', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'tesoureiro')
  await expect(
    page.getByRole('heading', { name: 'Mural de avisos' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: TITULO })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Comunicação' })).toHaveCount(0)
  await ver(page, info, 'inicio-do-tesoureiro-sem-o-modulo-e-sem-o-aviso')
  await page.goto('/comunicacao')
  await expect(page).toHaveURL(/\/403$/)
  await page.goto(`/meus-avisos/${idDoAviso}`)
  await expect(page.getByRole('alert')).toContainText('Aviso não encontrado.')
  await ver(page, info, 'aviso-de-outro-grupo-nao-abre')

  const cab = { Authorization: token }
  expect(
    (
      await page.request.get(`${API_HML}/api/avisos/`, { headers: cab })
    ).status(),
  ).toBe(403)
  expect(
    (
      await page.request.get(`${API_HML}/api/avisos/${idDoAviso}`, {
        headers: cab,
      })
    ).status(),
  ).toBe(403)
  expect(
    (
      await page.request.post(`${API_HML}/api/avisos/${idDoAviso}/retirar`, {
        headers: cab,
        data: { motivo: 'tentativa de quem não pode' },
      })
    ).status(),
  ).toBe(403)
  expect(
    (
      await page.request.get(`${API_HML}/api/meus-avisos/${idDoAviso}`, {
        headers: cab,
      })
    ).status(),
  ).toBe(404)
  expect(
    (
      await page.request.post(
        `${API_HML}/api/meus-avisos/${idDoAviso}/confirmar`,
        { headers: cab },
      )
    ).status(),
  ).toBe(404)
  expect(vigia.problemas()).toEqual([])
})

test('o Conselheiro vê o aviso no sino e no mural, abre e confirma que leu', async ({
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
  expect(nomeDoConselheiro).not.toBe('')

  await page.getByRole('button', { name: /^Notificações/ }).click()
  await expect(
    page.getByRole('link', { name: `Novo aviso: ${TITULO}` }),
  ).toBeVisible()
  await ver(page, info, 'o-sino-avisa')
  await page.keyboard.press('Escape')

  const noMural = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: TITULO }) })
  await expect(noMural).toContainText('Pede a sua confirmação')
  await ver(page, info, 'o-mural-no-inicio')
  await noMural.getByRole('link', { name: TITULO }).click()

  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible()
  await expect(page.getByText('Traga o relatório do mês.')).toBeVisible()
  await expect(page.getByText(/Você leu em/)).toBeVisible()
  await page.getByRole('button', { name: 'Li e estou ciente' }).click()
  await expect(
    page.getByText(/Você confirmou que leu e está ciente em/),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Li e estou ciente' }),
  ).toHaveCount(0)
  await ver(page, info, 'aviso-aberto-e-confirmado')

  await page
    .getByRole('link', { name: 'Meus avisos', exact: true })
    .first()
    .click()
  await expect(
    page.getByRole('listitem').filter({ hasText: TITULO }),
  ).toContainText('confirmado em')
  await ver(page, info, 'meus-avisos-com-a-confirmacao')
  expect(vigia.problemas()).toEqual([])
})

test('o relatório mostra quem leu e confirmou; incluir não acha ninguém novo; retirar exige motivo; a Auditoria guarda tudo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await comoPapel(page, 'secretario')
  await page.goto(`/comunicacao/${idDoAviso}`)
  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible()
  const linha = page.getByRole('row').filter({ hasText: nomeDoConselheiro })
  await expect(linha).toContainText('Leu')
  await expect(linha.getByRole('cell').nth(3)).not.toHaveText('—')
  await expect(page.getByText(/Leram: [1-9]/)).toBeVisible()
  await expect(page.getByText(/Confirmaram: [1-9]/)).toBeVisible()
  await page.getByLabel(/^Mostrar/).selectOption('nao_confirmaram')
  await expect(
    page.getByRole('row').filter({ hasText: nomeDoConselheiro }),
  ).toHaveCount(0)
  await page.getByLabel(/^Mostrar/).selectOption('todos')
  await ver(page, info, 'relatorio-com-a-leitura-e-a-confirmacao')

  await page
    .getByRole('button', { name: 'Incluir quem entrou no grupo depois' })
    .click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Ninguém novo' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Retirar do mural' }).click()
  await page.getByLabel(/Motivo da retirada/).fill('curto')
  await expect(
    page.getByRole('button', { name: 'Retirar o aviso' }),
  ).toBeDisabled()
  await page.getByLabel(/Motivo da retirada/).fill(MOTIVO)
  await page.getByRole('button', { name: 'Retirar o aviso' }).click()
  await expect(page.getByText('Aviso retirado do mural.')).toBeVisible()
  await expect(page.getByText(`Motivo: ${MOTIVO}`)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Retirar do mural' }),
  ).toHaveCount(0)
  await ver(page, info, 'aviso-retirado-com-o-motivo')
  expect(vigia.problemas()).toEqual([])

  // a Auditoria, lida por quem tem a permissão (o Presidente)
  const presidente = await page
    .context()
    .browser()!
    .newPage({ baseURL: info.project.use.baseURL })
  const tokenDoPresidente = await comoPapel(presidente, 'presidente')
  for (const acao of [
    'AVISO_PUBLICADO',
    'AVISO_CONFIRMADO',
    'AVISO_RETIRADO',
  ]) {
    const r = await presidente.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=avisos&acao=${acao}&por_pagina=200`,
      { headers: { Authorization: tokenDoPresidente } },
    )
    expect(r.status()).toBe(200)
    const { entradas } = (await r.json()) as {
      entradas: Array<{
        id_registro_afetado: number
        id_usuario: number | null
      }>
    }
    const doAviso = entradas.filter((e) => e.id_registro_afetado === idDoAviso)
    expect(doAviso, `${acao} na Auditoria`).toHaveLength(1)
    expect(
      doAviso[0]!.id_usuario,
      `${acao}: quem fez fica registrado`,
    ).not.toBeNull()
  }
  await presidente.goto('/auditoria')
  await ver(presidente, info, 'auditoria')
  await presidente.close()
})

test('o Conselheiro vê o aviso retirado, com o motivo, fora do mural e sem o botão de confirmar', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await comoPapel(page, 'conselheiro')
  await expect(
    page.getByRole('heading', { name: 'Mural de avisos' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: TITULO })).toHaveCount(0)
  await page
    .getByRole('link', { name: 'Meus avisos', exact: true })
    .first()
    .click()
  const item = page.getByRole('listitem').filter({ hasText: TITULO })
  await expect(item).toContainText('Retirado')
  await item.getByRole('link', { name: TITULO }).click()
  await expect(page.getByText(`Motivo: ${MOTIVO}`)).toBeVisible()
  await expect(
    page.getByText(/Você confirmou que leu e está ciente/),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Li e estou ciente' }),
  ).toHaveCount(0)
  await ver(page, info, 'retirado-na-caixa-de-entrada-do-conselheiro')
  expect(vigia.problemas()).toEqual([])
})
