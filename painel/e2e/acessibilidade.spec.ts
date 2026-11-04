import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { isolarDaProducao } from './apoio'

// v9.1a - o axe (WCAG 2.2 AA) num navegador de verdade, a cada publicação do painel, nas telas que se abrem SEM sessão (entrar e recuperar a senha): são as
// primeiras que qualquer pessoa vê, e as únicas que dá para abrir aqui sem a API. As telas de dentro são varridas inteiras na homologação, com dado de verdade,
// pelo robô e2e-hml/v9.1a-01-acessibilidade-do-painel.spec.ts; os testes de componente (jest-axe) não medem contraste. Qualquer violação reprova.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test.beforeEach(async ({ page }) => {
  await isolarDaProducao(page)
  // sem sessão: o painel abre a tela de entrar
  await page.route('**/auth/refresh', (rota) =>
    rota.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  )
})

for (const [caminho, titulo] of [
  ['/login', 'ASAF · Painel'],
  ['/esqueci-a-senha', 'Esqueci a minha senha'],
] as const) {
  for (const largura of [1280, 375]) {
    test(`axe — ${caminho} (${largura}px)`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 800 })
      await page.goto(caminho)
      await expect(page.getByRole('heading', { name: titulo })).toBeVisible()
      const { violations } = await new AxeBuilder({ page })
        .withTags(TAGS)
        .analyze()
      expect(
        violations.map(
          (v) =>
            `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([])
    })
  }
}
