import { expect, test } from '@playwright/test'

// v5.4h - o site lê a Instituição do painel (`/api/publico/instituicao`). O build de teste usa a API simulada COMO ELA É HOJE NA PRODUÇÃO: a Instituição só
// tem o nome e o CNPJ de EXEMPLO (00.000.000/0001-00, inválido). O site não pode mostrar esse CNPJ nem abrir buraco: segue com os dados fixos do Estatuto, sem
// horário nem redes. (O caso "a diretoria preencheu" é conferido por `npm run test:instituicao`, que constrói o site de novo com os dados preenchidos.)
const FIXOS = ['17.631.942/0001-70', '(94) 98412-0703', 'asaf@asaf.org.br']

test('contato: com o CNPJ de exemplo da Instituição o site mostra os dados fixos e nada de horário ou redes', async ({
  page,
}) => {
  await page.goto('/contato/')
  const pagina = page.locator('main')
  for (const fixo of FIXOS) await expect(pagina).toContainText(fixo)
  await expect(page.locator('body')).not.toContainText('00.000.000/0001-00')
  await expect(page.locator('[data-horario-de-atendimento]')).toHaveCount(0)
  await expect(page.locator('[data-redes]')).toHaveCount(0)
  await expect(
    page.locator('a[href="tel:+5594984120703"]').first(),
  ).toBeVisible()
})

test('rodapé, Privacidade e Transparência: o CNPJ e o e-mail são os fixos, e não há link de rede social inventado', async ({
  page,
}) => {
  for (const caminho of ['/', '/privacidade/', '/transparencia/']) {
    await page.goto(caminho)
    await expect(page.locator('footer')).toContainText('asaf@asaf.org.br')
    await expect(page.locator('body')).not.toContainText('00.000.000/0001-00')
    await expect(
      page.locator(
        'footer a[href*="instagram.com"], footer a[href*="facebook.com"]',
      ),
    ).toHaveCount(0)
  }
  await page.goto('/privacidade/')
  await expect(page.locator('main')).toContainText('17.631.942/0001-70')
})

test('dados estruturados da organização: CNPJ fixo e nenhuma rede (sameAs) sem dado', async ({
  page,
}) => {
  await page.goto('/')
  const blocos = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
  const organizacao = blocos
    .map((b) => JSON.parse(b) as Record<string, unknown>)
    .find((j) => j.taxID)
  expect(organizacao).toBeTruthy()
  expect(organizacao!.taxID).toBe('17.631.942/0001-70')
  expect(organizacao!.sameAs).toBeUndefined()
})
