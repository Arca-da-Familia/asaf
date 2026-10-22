import { expect, test } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v6.3c - parte 2: depois de uma nova publicação da homologação (o site de teste lê a API no build), a página do relatório anual mostra o ano publicado
// pelo v6.3c-01 com a MESMA apresentação e os mesmos números da API, e liga ao texto publicado; a Transparência tem o cartão do relatório.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const ANO = new Date().getFullYear() - 1

test('a página do relatório anual mostra a apresentação e os números da API e liga ao texto publicado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const relatorios = (await (
    await page.request.get(
      `${API_HML}/api/publico/transparencia/relatorios-anuais`,
    )
  ).json()) as Array<{
    ano: number
    dados: {
      apresentacao: string
      eventos: unknown[]
      associados_no_fim_do_ano: number
    }
  }>
  const doAno = relatorios.find((r) => r.ano === ANO)
  expect(
    doAno,
    'o relatório publicado pelo v6.3c-01 (rode-o e publique a homologação antes)',
  ).toBeTruthy()

  const resposta = await page.goto(`${SITE}/transparencia/relatorio-anual/`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)
  const secao = page.locator(`section[data-relatorio-anual="${ANO}"]`)
  await expect(
    secao,
    'o site de teste não tem o relatório: a publicação da homologação rodou antes do v6.3c-01?',
  ).toHaveCount(1)
  await expect(secao.locator('[data-apresentacao]')).toContainText(
    doAno!.dados.apresentacao,
  )
  const numeros = secao.locator('[data-numeros-do-ano]')
  await expect(numeros).toContainText(
    `Eventos abertos ao público${doAno!.dados.eventos.length}`,
  )
  await expect(numeros).toContainText(
    `Associados em 31/12/${ANO}${doAno!.dados.associados_no_fim_do_ano.toLocaleString('pt-BR')}`,
  )
  await ver(page, info, 'a pagina do relatorio anual')

  await secao.getByRole('link', { name: /texto publicado/ }).click()
  await expect(page.locator('[data-documento-em-texto]')).toContainText(
    doAno!.dados.apresentacao,
  )
  await page.goto(`${SITE}/transparencia/`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-cartao="relatorio-anual"]')).toContainText(
    String(ANO),
  )
  expect(vigia.problemas()).toEqual([])
})
