import { expect, test } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v7.0a - parte 2: o SITE de teste (montado na publicação da homologação, lendo a API de teste) mostra o encarregado "em local de destaque e de fácil acesso"
// (Resolução CD/ANPD nº 18/2024, art. 9º): o rodapé de todas as páginas leva à seção do encarregado na Política, com o nome do Presidente e o do substituto que
// a API publica (os mandatos de Presidente e de 1º Vice-Presidente da homologação).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'

test('o rodapé leva ao encarregado, com o nome do Presidente e do substituto que a API publica', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const diretoria = (await (
    await page.request.get(`${API_HML}/api/publico/diretoria`)
  ).json()) as Array<{
    orgao_codigo: string
    cargo_codigo: string
    nome: string
  }>
  const daDiretoria = (cargo: string) =>
    diretoria.find(
      (m) =>
        m.orgao_codigo === 'DIRETORIA_EXECUTIVA' && m.cargo_codigo === cargo,
    )?.nome
  const presidente = daDiretoria('PRESIDENTE')
  const substituto =
    daDiretoria('VICE_PRESIDENTE') ?? daDiretoria('VICE_PRESIDENTE_2')
  expect(presidente, 'a homologação tem mandato de Presidente').toBeTruthy()
  expect(
    substituto,
    'a homologação tem mandato de Vice-Presidente',
  ).toBeTruthy()

  for (const caminho of ['/', '/contato/', '/transparencia/']) {
    const resposta = await page.goto(`${SITE}${caminho}`)
    expect(resposta?.status()).toBe(200)
    await expect(
      page
        .locator('footer')
        .getByRole('link', { name: 'Encarregado de dados' }),
    ).toHaveAttribute('href', '/privacidade/#encarregado')
  }
  await page
    .locator('footer')
    .getByRole('link', { name: 'Encarregado de dados' })
    .click()
  await expect(page).toHaveURL(/\/privacidade\/#encarregado$/)
  const paragrafo = page.locator('#encarregado')
  await expect(paragrafo).toBeInViewport()
  await expect(paragrafo).toContainText(`o Presidente da ASAF, ${presidente}.`)
  await expect(paragrafo).toContainText(`Vice-Presidente é ${substituto})`)
  await expect(page.getByText(/^Versão 2\.\d+ · em vigor desde/)).toBeVisible()
  await ver(page, info, 'politica-na-secao-do-encarregado')
  expect(vigia.problemas()).toEqual([])
})
