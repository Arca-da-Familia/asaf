import { expect, test, type Page } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao, ver, vigiar } from './apoio'

// v5.7b - depois da publicação de teste (que rodou a rotina de retenção contra o banco de TESTE): o dado RECENTE que o v5.7b-01 deixou (pedido da fila e pedido de doação, com nome de teste) está INTACTO,
// a Auditoria não registrou nenhuma aplicação da retenção (nada na homologação passou do prazo) e o site de teste mostra, na Política de Privacidade 2.1, os sete prazos que a rotina aplica.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const SITE = 'https://hml-site.asaf.org.br'
const PREFIXO = 'Robô Retenção'

let autorizacao = ''
const cabecalho = () => ({ Authorization: autorizacao })

async function entrarComoPresidente(page: Page): Promise<void> {
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
}

test('o pedido da fila e o pedido de doação recentes seguem intactos, e a Auditoria não registrou nenhuma aplicação da retenção', async ({
  page,
}) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)

  const fila = await page.request.get(
    `${API_HML}/api/atendimentos/?busca=${encodeURIComponent(PREFIXO)}&por_pagina=20`,
    { headers: cabecalho() },
  )
  expect(fila.status()).toBe(200)
  const { itens } = (await fila.json()) as {
    itens: Array<{
      nome_completo: string
      mensagem: string
      email_contato: string | null
    }>
  }
  expect(itens.length, 'o v5.7b-01 deixou pedidos na fila').toBeGreaterThan(0)
  for (const a of itens) {
    expect(a.nome_completo).toContain(PREFIXO)
    expect(a.mensagem, 'a mensagem recente segue inteira').toContain(
      'Mensagem recente do roteiro de retenção',
    )
    expect(a.mensagem).not.toContain('apagado pelo prazo de guarda')
    expect(a.email_contato).toContain('@homologacao.example.com')
  }

  const doacoes = await page.request.get(
    `${API_HML}/api/intencoes-doacao/?busca=${encodeURIComponent(PREFIXO)}&por_pagina=20`,
    { headers: cabecalho() },
  )
  expect(doacoes.status()).toBe(200)
  const pedidos = (await doacoes.json()) as {
    itens: Array<{ nome_doador: string; email_doador: string }>
  }
  expect(
    pedidos.itens.length,
    'o v5.7b-01 deixou pedidos de doação',
  ).toBeGreaterThan(0)
  for (const p of pedidos.itens) {
    expect(p.nome_doador).toContain(PREFIXO)
    expect(p.email_doador).toContain('@homologacao.example.com')
    expect(p.email_doador).not.toContain('exemplo.invalid')
  }

  // nada na homologação passou do prazo: a rotina rodou e não aplicou nada
  const auditoria = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=retencao&acao=RETENCAO_APLICADA&por_pagina=20`,
    { headers: cabecalho() },
  )
  expect(auditoria.status()).toBe(200)
  const { entradas } = (await auditoria.json()) as { entradas: unknown[] }
  expect(entradas, 'a retenção não aplicou nada a dado recente').toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('a Política de Privacidade do site de teste mostra os sete prazos que a rotina aplica', async ({
  page,
}, info) => {
  const resposta = await page.goto(`${SITE}/privacidade/`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)
  expect(
    (await page.locator('body').innerText()).replace(/\s+/g, ' '),
  ).toContain('Versão 2.1')
  const lista = page.locator('[data-prazos-de-guarda]')
  await expect(lista).toBeVisible()
  await expect(lista.locator('li')).toHaveCount(7)
  await expect(lista).toContainText('6 meses, depois é apagado')
  await expect(lista).toContainText(
    '5 anos depois de respondidos ou encerrados',
  )
  await expect(lista).toContainText('10 anos depois da doação')
  await expect(page.locator('[data-prazos-de-guarda-limite]')).toContainText(
    'Ainda não há rotina automática de prazo para os demais dados',
  )
  await ver(page, info, 'politica-com-os-prazos-de-guarda')
})
