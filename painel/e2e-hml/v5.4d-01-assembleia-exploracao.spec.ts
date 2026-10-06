import { expect, test, type Page } from '@playwright/test'

import {
  campo,
  entrar,
  exigirHomologacao,
  inventariar,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.4d — exploração guiada da assembleia de ponta a ponta: o robô cria uma assembleia pela tela e avança pelos estados (rascunho → convocada →
// sessão aberta → ...), inventariando cada um, para o roteiro final ser escrito sobre o que a tela oferece de verdade.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

async function clicarSeExistir(
  page: Page,
  nome: string | RegExp,
): Promise<boolean> {
  const botao = page.getByRole('button', { name: nome }).first()
  if ((await botao.count()) === 0) return false
  await botao.click()
  await page.waitForTimeout(1500)
  return true
}

test('criar a assembleia pela tela e avançar pelos estados, inventariando cada um', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/governanca/nova')
  await campo(page, 'Tipo *').selectOption({ index: 1 })
  const daqui30dias = new Date(Date.now() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 16)
  await campo(page, 'Data e hora da 1ª convocação *').fill(daqui30dias)
  await campo(page, 'Ordem do dia *').fill(
    `Exploração ${RODADA}: aprovação de contas e eleição`,
  )
  await campo(page, 'Local físico').fill('Sede de teste')
  await ver(page, info, 'nova assembleia preenchida')
  await page
    .getByRole('button', { name: 'Criar assembleia (rascunho)' })
    .click()
  await expect(page).toHaveURL(/\/governanca\/\d+$/)
  const base = new URL(page.url()).pathname
  await inventariar(page, info, 'estado-1-rascunho')
  await ver(page, info, 'estado 1 rascunho')

  const passos: [string, string | RegExp][] = [
    ['estado-2-convocada', /Convocar/],
    ['estado-3-sessao-aberta', /Abrir sessão/],
  ]
  for (const [nome, botao] of passos) {
    const clicou = await clicarSeExistir(page, botao)
    await inventariar(page, info, `${nome}${clicou ? '' : '-SEM-BOTAO'}`).catch(
      () => undefined,
    )
    await ver(page, info, nome)
  }
  // a sessão e a ata em cada estado
  await page.goto(`${base}/sessao`)
  await expect(page.locator('h1').first()).toBeVisible()
  await page.waitForTimeout(3000)
  await inventariar(page, info, 'sessao-depois-de-abrir').catch(() => undefined)
  await ver(page, info, 'sessao depois de abrir')
  await page.goto(`${base}/ata`)
  await expect(page.locator('h1').first()).toBeVisible()
  await page.waitForTimeout(3000)
  await inventariar(page, info, 'ata-antes-de-encerrar').catch(() => undefined)
  await ver(page, info, 'ata antes de encerrar')
  expect(vigia.problemas()).toEqual([])
})
