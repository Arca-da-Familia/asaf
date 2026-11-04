import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { TAGS } from './regras-do-axe'

// v9.1b - a barra de preferências de leitura (tamanho da letra e alto contraste) e o respeito a "menos movimento". O que se prova: a escolha vale na hora e
// nas outras páginas, guarda só a escolha (e voltar ao normal apaga), o alto contraste passa no axe, a letra muito maior não cria rolagem para o lado no
// celular, e sem JavaScript a barra nem aparece.
const PAGINAS = [
  '/',
  '/privacidade/',
  '/seja-associado/',
  '/eventos/2/',
  '/transparencia/',
]

async function semViolacoes(page: Page, onde: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map(
      (v) =>
        `${onde}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
  ).toEqual([])
}

test('a letra maior vale na hora, nas outras páginas e volta ao normal apagando a escolha', async ({
  page,
}) => {
  await page.goto('/')
  const barra = page.getByRole('group', { name: 'Tamanho da letra:' })
  await expect(
    barra.getByRole('button', { name: 'A letra normal' }),
  ).toHaveAttribute('aria-pressed', 'true')
  const tamanho = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
  expect(await tamanho()).toBe('16px')

  await barra.getByRole('button', { name: 'A+ letra maior' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-letra', 'maior')
  await expect(
    barra.getByRole('button', { name: 'A+ letra maior' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    barra.getByRole('button', { name: 'A letra normal' }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect(await tamanho()).toBe('18px')

  await page.goto('/quem-somos/')
  await expect(page.locator('html')).toHaveAttribute('data-letra', 'maior')
  expect(await tamanho()).toBe('18px')
  await page.getByRole('button', { name: 'A++ letra muito maior' }).click()
  expect(await tamanho()).toBe('20px')
  // só a escolha, nada mais
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
    'asaf-letra',
  ])

  await page.getByRole('button', { name: 'A letra normal' }).click()
  expect(await tamanho()).toBe('16px')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
})

test('o alto contraste troca as cores, vale nas outras páginas e o botão diz se está ligado', async ({
  page,
}) => {
  await page.goto('/')
  const botao = page.getByRole('button', { name: 'Alto contraste' })
  await expect(botao).toHaveAttribute('aria-pressed', 'false')
  await botao.click()
  await expect(botao).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-contraste', 'alto')
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe('rgb(0, 0, 0)')
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(
    'rgb(255, 255, 255)',
  )
  await page.goto('/contato/')
  await expect(
    page.getByRole('button', { name: 'Alto contraste' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Alto contraste' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-contraste', 'normal')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
})

for (const caminho of PAGINAS) {
  test(`alto contraste e letra muito maior passam no axe e não criam rolagem para o lado no celular — ${caminho}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('asaf-contraste', 'alto')
      localStorage.setItem('asaf-letra', 'muito-maior')
    })
    await page.goto(caminho)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('html')).toHaveAttribute('data-contraste', 'alto')
    await semViolacoes(page, `${caminho} (computador)`)
    await page.setViewportSize({ width: 375, height: 700 })
    await semViolacoes(page, `${caminho} (celular)`)
    const sobra = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(sobra, 'a página rola para o lado').toBeLessThanOrEqual(0)
  })
}

test('uma escolha estragada no navegador é ignorada (letra normal, sem contraste)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('asaf-letra', 'gigante')
    localStorage.setItem('asaf-contraste', 'sim')
  })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-letra', 'normal')
  await expect(page.locator('html')).toHaveAttribute('data-contraste', 'normal')
})

test('quem pede menos movimento ao aparelho não vê transição nem animação, mesmo uma que alguém inclua no futuro', async ({
  page,
}) => {
  // o site não tem transição nenhuma hoje: o teste PÕE uma num botão para provar que a regra a anula (sem a regra, 2 s; com ela, ~0)
  const duracoes = async () =>
    page.getByRole('button', { name: 'Alto contraste' }).evaluate((b) => {
      b.style.transition = 'color 2s'
      b.style.animation = 'girar 2s infinite'
      const estilo = getComputedStyle(b)
      return [
        parseFloat(estilo.transitionDuration),
        parseFloat(estilo.animationDuration),
      ]
    })
  await page.goto('/')
  expect(await duracoes()).toEqual([2, 2])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const [transicao, animacao] = await duracoes()
  expect(transicao).toBeLessThan(0.001)
  expect(animacao).toBeLessThan(0.001)
})

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('a barra não aparece (os botões não fariam nada)', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('button', { name: 'Alto contraste' }),
    ).toBeHidden()
  })
})
