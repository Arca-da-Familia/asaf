import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  type Papel,
  ver,
  vigiar,
} from './apoio'

// v6.2c - parte 2: depois de uma nova publicação da homologação (que roda a rotina de publicar os agendados, como a tarefa periódica faz na produção), o aviso agendado pelo
// v6.2c-01 saiu: em Agendados aparece "Publicado" com o link do aviso; o relatório diz o modelo e a versão usada; o Conselheiro lê o texto com o PRÓPRIO primeiro nome; a Auditoria
// guarda a publicação pelo sistema. No fim o aviso de teste é retirado.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const PREFIXO = 'Agendado v6.2c'
let idDoAviso = 0
let titulo = ''

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

test('o agendado saiu: Publicado em Agendados, com o modelo e a versão no relatório', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'secretario')
  // o agendamento MAIS NOVO desta rodada (qualquer situação), e ele tem de ter saído: se a publicação da homologação rodou antes da hora marcada, falha dizendo isso
  const lista = (await (
    await page.request.get(`${API_HML}/api/avisos-agendados/`, {
      headers: { Authorization: token },
    })
  ).json()) as Array<{
    titulo: string
    id_aviso: number | null
    id_agendado: number
    situacao: string
  }>
  const meu = lista
    .filter(
      (a) => a.titulo.startsWith(PREFIXO) && !a.titulo.endsWith('cancelado'),
    )
    .sort((a, b) => b.id_agendado - a.id_agendado)[0]
  expect(meu, 'o agendamento do v6.2c-01').toBeTruthy()
  expect(
    meu!.situacao,
    'a publicação da homologação rodou antes da hora marcada (rode o v6.2c-01, espere 7 minutos, publique a homologação e rode o v6.2c-02)',
  ).toBe('Publicado')
  idDoAviso = meu!.id_aviso!
  titulo = meu!.titulo
  await page.goto('/comunicacao/agendados')
  await page.getByLabel(/^Situação/).selectOption('Publicado')
  const item = page.getByRole('listitem').filter({ hasText: titulo })
  await item.getByRole('link', { name: 'Ver o aviso publicado' }).click()
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible()
  await expect(page.getByText(/Modelo usado: .* \(versão 2\)/)).toBeVisible()
  await ver(page, info, 'agendado-publicado-relatorio')
  expect(vigia.problemas()).toEqual([])
})

test('o Conselheiro lê o aviso com o próprio primeiro nome', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'conselheiro')
  const eu = (await (
    await page.request.get(`${API_HML}/auth/me`, {
      headers: { Authorization: token },
    })
  ).json()) as { nome_completo: string }
  const primeiroNome = eu.nome_completo.split(' ')[0]!
  await page.goto(`/meus-avisos/${idDoAviso}`)
  await expect(
    page.getByText(
      `Olá, ${primeiroNome}! A reunião do Conselho é na sexta às 19h.`,
    ),
  ).toBeVisible()
  await ver(page, info, 'texto-com-o-proprio-nome')
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guarda a publicação pelo sistema; o aviso de teste é retirado', async ({
  page,
}) => {
  const presidente = await comoPapel(page, 'presidente')
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=avisos_agendados&acao=AVISO_AGENDADO_PUBLICADO&por_pagina=50`,
    {
      headers: { Authorization: presidente },
    },
  )
  const { entradas } = (await r.json()) as {
    entradas: Array<{ id_usuario: number | null; dados_depois: string }>
  }
  const daPublicacao = entradas.find((e) =>
    String(e.dados_depois).includes(`"id_aviso": ${idDoAviso}`),
  )
  expect(daPublicacao, 'a publicação na Auditoria').toBeTruthy()
  expect(daPublicacao!.id_usuario, 'quem publicou foi o sistema').toBeNull()
  const retirar = await page.request.post(
    `${API_HML}/api/avisos/${idDoAviso}/retirar`,
    {
      headers: { Authorization: presidente },
      data: { motivo: 'Aviso de teste do robô retirado.' },
    },
  )
  expect(retirar.status()).toBe(200)
})
