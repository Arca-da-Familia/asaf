import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Inscrição pela secretaria (a tela que faltava): no evento, quem cuida de projetos inscreve um associado. Passa pelo mesmo controle de vagas da
// inscrição do próprio associado: com 1 vaga, o primeiro entra (Pré-inscrito) e o segundo vai para a Lista de Espera, nunca uma vaga a mais; a mesma
// pessoa não entra duas vezes (recusa em português, sem rastro); cada inscrição deixa a Auditoria; quem não tem a permissão de projetos (Secretário)
// é barrado na tela e na API.
test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

/** Escolhe a opção pelo texto, esperando a lista chegar do servidor (sem isso a escolha corre na frente do carregamento). */
async function escolherQuandoCarregar(seletor: Locator, trecho: string) {
  await expect(
    seletor.locator('option', { hasText: trecho }).first(),
  ).toBeAttached()
  await escolherPorTexto(seletor, trecho)
}

const S = String(RODADA)
const TITULO = `Evento da Secretaria ${S}`
const PRIMEIRA = 'Karina Duarte Melo'
const SEGUNDO = 'Leonardo Batista Reis'
const TABELA = 'inscricoes'

let idEvento = 0
let totalAntes = 0

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

/** A seção "Inscritos no evento" do evento de teste (aberto pelo endereço `/eventos?evento=N`). */
async function abrirOsInscritos(page: Page): Promise<Locator> {
  await page.goto(`/eventos?evento=${idEvento}`)
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  const detalhe = page
    .locator('div.rounded-xl')
    .filter({
      has: page.getByRole('heading', {
        name: TITULO,
        level: 2,
        exact: true,
      }),
    })
    .last()
  await expect(detalhe).toBeVisible()
  const secao = detalhe.locator(
    'xpath=.//h3[starts-with(normalize-space(.), "Inscritos no evento")]/..',
  )
  await expect(secao).toBeVisible()
  return secao
}

test('preparo: um evento interno com 1 vaga e o total da Auditoria de inscrições', async ({
  page,
}) => {
  exigirHomologacao()
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const criado = await page.request.fetch(`${API_HML}/api/eventos/`, {
    method: 'POST',
    headers: { Authorization: token(), 'Content-Type': 'application/json' },
    data: JSON.stringify({
      titulo: TITULO,
      categoria: 'PALESTRA',
      data_hora_inicio: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      visibilidade: 'Interna',
      vagas: 1,
    }),
  })
  expect(criado.status(), 'criar o evento de teste').toBe(200)
  idEvento = ((await criado.json()) as { id_evento: number }).id_evento
  totalAntes = await totalNaAuditoria(page)
  expect(vigia.problemas()).toEqual([])
})

test('a secretaria inscreve duas pessoas: a primeira ocupa a vaga, a segunda vai para a lista de espera; a mesma pessoa não entra duas vezes', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const secao = await abrirOsInscritos(page)
  const escolher = (nome: string) =>
    escolherQuandoCarregar(secao.getByLabel('Inscrever um associado'), nome)
  const inscrever = () =>
    secao.getByRole('button', { name: 'Inscrever', exact: true })
  const linha = (nome: string) =>
    secao.locator('div.rounded-md.border.p-2').filter({ hasText: nome })

  await expect(inscrever()).toBeDisabled()
  await escolher(PRIMEIRA)
  await inscrever().click()
  await expect(secao.getByRole('status')).toContainText(
    `Inscrição registrada: ${PRIMEIRA} — situação Pré-inscrito.`,
  )
  await expect(linha(PRIMEIRA)).toHaveCount(1)

  await escolher(SEGUNDO)
  await inscrever().click()
  await expect(secao.getByRole('status')).toContainText(
    `Inscrição registrada: ${SEGUNDO} — situação Lista de Espera.`,
  )
  await expect(linha(SEGUNDO)).toHaveCount(1)
  await expect(secao.locator('div.rounded-md.border.p-2')).toHaveCount(2)
  await ver(page, info, 'duas-inscricoes-uma-vaga-e-uma-lista-de-espera')

  // a mesma pessoa de novo: recusa em português e nada muda
  await escolher(PRIMEIRA)
  await inscrever().click()
  await expect(secao.getByRole('alert')).toContainText('já está inscrita')
  await expect(secao.locator('div.rounded-md.border.p-2')).toHaveCount(2)

  // por um endereço novo: o que aparece veio do servidor
  const depois = await abrirOsInscritos(page)
  await expect(
    depois.locator('div.rounded-md.border.p-2').filter({ hasText: PRIMEIRA }),
  ).toHaveCount(1)
  await expect(
    depois.locator('div.rounded-md.border.p-2').filter({ hasText: SEGUNDO }),
  ).toHaveCount(1)
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guarda as duas inscrições (a recusa não deixou rastro)', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const total = await totalNaAuditoria(page)
  expect(total - totalAntes, 'duas inscrições novas na Auditoria').toBe(2)
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('cell', {
        name: 'INSCRICAO_PELA_SECRETARIA',
        exact: true,
      }),
    }),
  ).not.toHaveCount(0)
  await ver(page, info, 'auditoria-das-inscricoes-pela-secretaria')
  expect(vigia.problemas()).toEqual([])
})

test('quem não tem a permissão de projetos (Secretário) é barrado na tela e na API', async ({
  page,
}) => {
  const token = await capturarToken(page)
  await entrar(page, 'secretario')
  await page.goto('/eventos')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  const r = await page.request.fetch(
    `${API_HML}/api/eventos/${idEvento}/inscrever-associado`,
    {
      method: 'POST',
      headers: { Authorization: token(), 'Content-Type': 'application/json' },
      data: JSON.stringify({ id_associado: 1 }),
    },
  )
  expect(r.status()).toBe(403)
})
