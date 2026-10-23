import { expect, test } from '@playwright/test'

// v7.0a — o encarregado pelo tratamento de dados (LGPD, art. 41) "em local de destaque e de fácil acesso" (Resolução CD/ANPD nº 18/2024, art. 9º): o rodapé de
// TODAS as páginas leva à seção do encarregado na Política, que dá o nome (do mandato publicado de Presidente) e o substituto (o 1º Vice-Presidente; o 2º na falta
// dele — o mock publica só o 2º).

for (const pagina of ['/', '/contato/', '/transparencia/', '/eventos/']) {
  test(`o rodapé de ${pagina} leva ao encarregado de dados`, async ({
    page,
  }) => {
    await page.goto(pagina)
    const link = page
      .locator('footer')
      .getByRole('link', { name: 'Encarregado de dados' })
    await expect(link).toHaveAttribute('href', '/privacidade/#encarregado')
  })
}

test('o link do rodapé abre a Política na seção do encarregado, com o nome e o substituto', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .locator('footer')
    .getByRole('link', { name: 'Encarregado de dados' })
    .click()
  await expect(page).toHaveURL(/\/privacidade\/#encarregado$/)
  const paragrafo = page.locator('#encarregado')
  await expect(paragrafo).toBeInViewport()
  await expect(paragrafo).toContainText(
    'Encarregado pelo tratamento de dados pessoais',
  )
  await expect(paragrafo).toContainText(
    'o Presidente da ASAF, Maria de Teste da Silva.',
  )
  await expect(paragrafo).toContainText(
    'Nas faltas e impedimentos do Presidente, o Estatuto (art. 21, parágrafo único) atribui a substituição aos Vice-Presidentes (hoje, o 2º Vice-Presidente é Pedro de Teste Alves).',
  )
  await expect(
    paragrafo.getByRole('link', {
      name: 'formulário de solicitação do titular de dados',
    }),
  ).toHaveAttribute('href', '/privacidade/solicitacao-do-titular/')
  // o texto não promete o que depende de ato humano (a assinatura do ato de designação)
  await expect(paragrafo).not.toContainText('assinad')
})

test('a Política nomeia os prestadores e diz que parte do tratamento acontece fora do Brasil (v2.9)', async ({
  page,
}) => {
  await page.goto('/privacidade/')
  const paragrafo = page.locator('[data-operadores]')
  await expect(paragrafo).toHaveCount(1)
  for (const trecho of [
    'Microsoft (Azure)',
    'no Brasil (região Brazil South)',
    'nos Estados Unidos (região South Central US)',
    'GitHub',
    'Google (Google Workspace)',
    'parte do tratamento dos seus dados acontece fora do Brasil',
  ]) {
    await expect(paragrafo).toContainText(trecho)
  }
})
