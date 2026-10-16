import { expect, test } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao, ver, vigiar } from './apoio'

// v5.7d - o vencimento natural, depois da rotina do sistema: o v5.7d-01 deixou uma pessoa nova ("Robô Vencido ...") com um mandato que já terminou e uma foto guardada. O Deploy Homologação
// roda a mesma rotina que o agendamento roda na produção (scripts/apagar_fotos_da_diretoria_vencidas.py). Aqui se confere que a foto SAIU (linha e arquivo), que a Auditoria guardou o fato
// com o usuário em branco (foi o sistema, não uma pessoa) e que as fotos de quem tem mandato vigente continuam onde estavam.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const MARCA_DO_VENCIDO = 'ROBO-V57D-VENCIDO'

type Mandato = {
  id_mandato: number
  id_associado: number
  vigente: boolean
  ato_origem: string | null
}

test('a rotina do sistema apagou a foto de quem ficou sem mandato e deixou as de quem está em mandato', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  const cabecalho = { Authorization: autorizacao }

  const lista = await page.request.get(
    `${API_HML}/api/mandatos/?apenas_vigentes=false&orgao_codigo=CONSELHO_FISCAL`,
    { headers: cabecalho },
  )
  expect(lista.status()).toBe(200)
  const vencidos = ((await lista.json()) as Mandato[])
    .filter((m) => (m.ato_origem ?? '').startsWith(MARCA_DO_VENCIDO))
    .sort((a, b) => b.id_mandato - a.id_mandato)
  expect(
    vencidos.length,
    'o v5.7d-01 deixou uma pessoa com mandato antigo',
  ).toBeGreaterThan(0)
  const dele = vencidos[0]!
  expect(dele.vigente).toBe(false)

  const situacao = await page.request.get(
    `${API_HML}/api/mandatos/associados/${dele.id_associado}/foto-publica`,
    { headers: cabecalho },
  )
  expect(situacao.status()).toBe(200)
  expect(
    ((await situacao.json()) as { foto: unknown }).foto,
    'a foto de quem ficou sem mandato foi apagada pela rotina',
  ).toBeNull()
  const arquivo = await page.request.get(
    `${API_HML}/api/mandatos/associados/${dele.id_associado}/foto-publica/arquivo`,
    { headers: cabecalho },
  )
  expect(arquivo.status(), 'e o arquivo também').toBe(404)

  // a Auditoria: foi o SISTEMA (sem usuário), só o fato
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=fotos_da_diretoria&acao=FOTO_APAGADA_AUTOMATICAMENTE&por_pagina=200`,
    { headers: cabecalho },
  )
  expect(r.status()).toBe(200)
  const { entradas } = (await r.json()) as {
    entradas: Array<{
      id_usuario: number | null
      dados_depois: string | null
    }>
  }
  const doSistema = entradas.filter((e) => e.id_usuario === null)
  expect(
    doSistema.length,
    'a rotina deixou o apagamento na Auditoria, sem usuário',
  ).toBeGreaterThanOrEqual(1)
  expect(String(doSistema[0]!.dados_depois)).not.toMatch(/Rob[ôo] Vencido/)
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  await ver(page, info, 'auditoria-da-rotina-que-apagou-a-foto')

  // quem está em mandato vigente não perdeu a foto (a da Presidente, do v5.7c-01, segue pública)
  const publica = await page.request.get(`${API_HML}/api/publico/diretoria`)
  const diretoria = (await publica.json()) as Array<{
    nome: string
    foto: unknown
  }>
  const ana = diretoria.find((d) => d.nome.startsWith('Ana Lúcia Ferreira'))
  expect(ana, 'a Presidente continua na Diretoria').toBeDefined()
  expect(
    ana!.foto,
    'e a foto dela, que tem mandato vigente, continua lá',
  ).not.toBeNull()
  expect(vigia.problemas()).toEqual([])
})
