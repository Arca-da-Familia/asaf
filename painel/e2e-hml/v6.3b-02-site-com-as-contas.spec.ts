import { expect, test } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v6.3b - parte 2: depois de uma nova publicação da homologação (o site de teste lê a API no build), a página das contas mostra o exercício publicado pelo
// v6.3b-01 com os MESMOS números da API (receitas, despesas, resultado), o parecer e a ligação com o texto publicado; a Transparência tem o cartão das contas.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const ANO = new Date().getFullYear() - 1
const reais = (valor: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number(valor))
    .replace(/\s/g, ' ')

test('a página das contas mostra o exercício com os números da API e liga ao texto publicado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const contas = (await (
    await page.request.get(`${API_HML}/api/publico/transparencia/contas`)
  ).json()) as Array<{
    ano: number
    id_documento: number
    dados: {
      total_receitas: string
      total_despesas: string
      resultado: string
      pareceres: { tipo: string }[]
    }
  }>
  const doAno = contas.find((c) => c.ano === ANO)
  expect(
    doAno,
    'as contas publicadas pelo v6.3b-01 (rode-o e publique a homologação antes)',
  ).toBeTruthy()

  const resposta = await page.goto(`${SITE}/transparencia/contas/`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)
  const secao = page.locator(`section[data-contas="${ANO}"]`)
  await expect(
    secao,
    'o site de teste não tem as contas: a publicação da homologação rodou antes do v6.3b-01?',
  ).toHaveCount(1)
  const limpo = async (loc: ReturnType<typeof page.locator>) =>
    (await loc.innerText()).replace(/\s/g, ' ')
  expect(
    await limpo(
      secao.getByRole('table', { name: `Receitas de ${ANO}` }).locator('tfoot'),
    ),
  ).toContain(reais(doAno!.dados.total_receitas))
  expect(
    await limpo(
      secao.getByRole('table', { name: `Despesas de ${ANO}` }).locator('tfoot'),
    ),
  ).toContain(reais(doAno!.dados.total_despesas))
  expect(await limpo(secao.locator('[data-resultado-do-ano]'))).toContain(
    reais(doAno!.dados.resultado),
  )
  // todos os pareceres do ano emitidos até a aprovação (um por conselheiro), cada um com a data
  await expect(secao.locator('[data-parecer]')).toHaveCount(
    doAno!.dados.pareceres.length,
  )
  await ver(page, info, 'a pagina das contas do exercicio')

  await secao.getByRole('link', { name: /texto publicado/ }).click()
  await expect(page.locator('[data-documento-em-texto]')).toContainText(
    `Prestação de contas do exercício ${ANO}`,
  )
  await page.goto(`${SITE}/transparencia/`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-cartao="contas"]')).toContainText(
    String(ANO),
  )
  expect(vigia.problemas()).toEqual([])
})
