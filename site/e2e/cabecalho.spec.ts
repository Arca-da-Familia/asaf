import { expect, test } from '@playwright/test'

// O menu do topo tem 7 itens + "Área do associado": em computador ele precisa caber em UMA linha (em 1024 px, o
// menor "computador"), senão a segunda linha empurra o conteúdo e o visitante acha que o site quebrou.
for (const largura of [1024, 1280, 1440]) {
  test(`menu do topo em uma linha só com ${largura}px de largura`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: largura, height: 800 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Principal', exact: true })
    const topos = await nav
      .locator('a')
      .evaluateAll((links) =>
        links.map((a) => Math.round(a.getBoundingClientRect().top)),
      )
    expect(topos.length).toBeGreaterThanOrEqual(8)
    // Itens de texto (py-2) e o botão (py-2) ficam na mesma linha: o topo varia poucos pixels.
    expect(Math.max(...topos) - Math.min(...topos)).toBeLessThan(12)
  })
}

test('Notícias está no menu do topo, no do celular e no rodapé', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(
    page
      .getByRole('navigation', { name: 'Principal', exact: true })
      .getByRole('link', { name: 'Notícias' }),
  ).toHaveAttribute('href', '/noticias/')
  await expect(
    page.locator('footer a[href="/noticias/"]').first(),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 800 })
  await page.locator('header summary').click()
  await expect(
    page
      .getByRole('navigation', { name: 'Principal (celular)' })
      .getByRole('link', { name: 'Notícias' }),
  ).toBeVisible()
})
