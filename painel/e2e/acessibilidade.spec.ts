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

// v9.1c - só com o teclado: a ordem do Tab na tela de entrar e o erro LIGADO ao campo (marcado, apontando para a mensagem, com o foco nele)
test('entrar só com o teclado: a ordem do Tab e o CPF errado marcado, com o foco nele', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(
    page.getByRole('heading', { name: 'ASAF · Painel' }),
  ).toBeVisible()
  await page.locator('body').evaluate((b) => (b as HTMLElement).focus())
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('CPF')).toBeFocused()
  await page.keyboard.type('11111111111')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Senha')).toBeFocused()
  await page.keyboard.type('qualquer')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Entrar', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: 'Esqueci a minha senha' }),
  ).toBeFocused()

  await page.getByLabel('Senha').focus()
  await page.keyboard.press('Enter')
  const aviso = page.getByRole('alert')
  await expect(aviso).toHaveText(
    'CPF inválido. Confira os dígitos e tente novamente.',
  )
  const cpf = page.getByLabel('CPF')
  await expect(cpf).toBeFocused()
  await expect(cpf).toHaveAttribute('aria-invalid', 'true')
  await expect(cpf).toHaveAttribute(
    'aria-describedby',
    (await aviso.getAttribute('id'))!,
  )
  await expect(page.getByLabel('Senha')).not.toHaveAttribute('aria-invalid')
  // corrigido o CPF, a marca some junto com o aviso
  await cpf.fill('529.982.247-25')
  await page.route('**/auth/login', (rota) =>
    rota.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'CPF ou senha incorretos.' }),
    }),
  )
  await page.keyboard.press('Enter')
  await expect(aviso).toHaveText('CPF ou senha incorretos.')
  await expect(cpf).not.toHaveAttribute('aria-invalid')
})

test('esqueci a senha só com o teclado: o CPF errado fica marcado, com o foco nele', async ({
  page,
}) => {
  await page.goto('/esqueci-a-senha')
  const cpf = page.getByLabel('CPF')
  await cpf.focus()
  await page.keyboard.type('123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('CPF inválido')
  await expect(cpf).toBeFocused()
  await expect(cpf).toHaveAttribute('aria-invalid', 'true')
  await expect(cpf).toHaveAttribute('aria-describedby', 'erro-do-formulario')
})
