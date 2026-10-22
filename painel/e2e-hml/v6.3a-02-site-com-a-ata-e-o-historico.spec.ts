import { expect, test } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v6.3a - parte 2: depois de uma nova publicação da homologação (o site de teste lê a API NO BUILD), o site mostra a ata publicada pelo v6.3a-01: o cartão diz quem
// aprovou (nome e "1º Secretário"), a versão anterior continua lá, dentro do cartão, "substituída pela versão N", e a página da versão anterior liga à nova. Sempre olha o
// documento mais novo do tipo Ata em texto aprovado pelo Secretário.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'

type DocumentoPublico = {
  id_documento: number
  tipo_codigo: string
  titulo: string
  formato: string
  versao: number
  vigente: boolean
  grupo_versao: string
  aprovado_por: { nome: string; cargo: string | null } | null
}

test('o site de teste mostra quem aprovou a ata e a versão anterior ligada à nova', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const publico = (await (
    await page.request.get(`${API_HML}/api/publico/transparencia/documentos`)
  ).json()) as DocumentoPublico[]
  const atas = publico.filter(
    (d) =>
      d.tipo_codigo === 'ATA' &&
      d.formato === 'TEXTO' &&
      d.aprovado_por?.cargo === '1º Secretário',
  )
  const atual = atas
    .filter((d) => d.vigente)
    .sort((a, b) => b.id_documento - a.id_documento)[0]
  expect(
    atual,
    'a ata publicada pelo v6.3a-01 (rode-o e publique a homologação antes)',
  ).toBeTruthy()
  const anterior = publico
    .filter(
      (d) =>
        d.grupo_versao === atual!.grupo_versao &&
        d.versao === atual!.versao - 1,
    )
    .at(0)
  expect(anterior, 'a versão anterior no mesmo grupo').toBeTruthy()

  const resposta = await page.goto(`${SITE}/transparencia/documentos/`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)
  // o endereço da página de texto começa pelo número do documento (o resto é o título no formato de endereço)
  const prefixoAtual = `/transparencia/documentos/${atual!.id_documento}-`
  const cartao = page.locator('li[data-documento]', {
    has: page.locator(`a[href^="${prefixoAtual}"]`),
  })
  await expect(
    cartao,
    'o site de teste não tem a ata: a publicação da homologação rodou antes do v6.3a-01?',
  ).toHaveCount(1)
  await expect(cartao.locator('[data-aprovacao]')).toContainText(
    `Aprovado para publicação por ${atual!.aprovado_por!.nome}, 1º Secretário, em`,
  )
  await cartao.locator('[data-versoes-anteriores] summary').click()
  const linhaAnterior = cartao.locator('[data-versao-anterior]', {
    hasText: `Versão ${anterior!.versao}`,
  })
  await expect(linhaAnterior).toContainText(
    `substituída pela versão ${atual!.versao}`,
  )
  await ver(page, info, 'o cartao da ata com quem aprovou e a versao anterior')

  await linhaAnterior
    .getByRole('link', { name: `Versão ${anterior!.versao}` })
    .click()
  await expect(page.locator('[data-substituida]')).toContainText(
    `Esta é a versão ${anterior!.versao}, substituída pela versão ${atual!.versao}`,
  )
  await expect(page.locator('[data-documento-em-texto]')).not.toContainText(
    '529.982.247-25',
  )
  await ver(page, info, 'a pagina da versao anterior liga a nova')
  await page
    .locator('[data-substituida]')
    .getByRole('link', { name: `versão ${atual!.versao}` })
    .click()
  await expect(page).toHaveURL(new RegExp(`${prefixoAtual}[a-z0-9-]+/$`))
  expect(vigia.problemas()).toEqual([])
})
