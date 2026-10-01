import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { PAGINAS_NAO_INDEXAVEIS, caminhosIndexaveis } from './paginas'

// Meta de acessibilidade (v5.0): zero violação WCAG 2.1 A/AA em TODA página, em desktop e em
// celular. Falhou aqui, o deploy do site não sai — "melhorar depois" nunca acontece.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

async function auditar(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  // Mensagem legível quando falha: qual regra, qual elemento.
  const resumo = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes.map((n) => `   ${n.target.join(' ')}`).join('\n'),
  )
  expect(resumo, resumo.join('\n')).toEqual([])
}

const TODAS = [...caminhosIndexaveis(), ...PAGINAS_NAO_INDEXAVEIS]

for (const caminho of TODAS) {
  test(`axe desktop — ${caminho}`, async ({ page }) => {
    await page.goto(caminho)
    await page.waitForLoadState('networkidle')
    await auditar(page)
  })

  test(`axe celular (375px) — ${caminho}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await page.goto(caminho)
    await page.waitForLoadState('networkidle')
    await auditar(page)
  })
}

test.describe('home com a ilha de eventos em cada estado', () => {
  test('estado de erro (API fora do ar) também é acessível', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos', (rota) => rota.abort())
    await page.goto('/')
    await expect(page.locator('[data-estado="erro"]')).toBeVisible()
    await auditar(page)
  })

  test('estado vazio também é acessível', async ({ page }) => {
    await page.route('**/api/publico/eventos', (rota) =>
      rota.fulfill({ json: [] }),
    )
    await page.goto('/')
    await expect(page.locator('[data-estado="vazio"]')).toBeVisible()
    await auditar(page)
  })
})

test('navegação por teclado: o primeiro Tab leva ao "Pular para o conteúdo"', async ({
  page,
}) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  const foco = page.locator(':focus')
  await expect(foco).toHaveText('Pular para o conteúdo')
  await expect(foco).toBeVisible()
})
