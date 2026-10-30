import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, ver } from './apoio'

// v7.3c - O QUE OS TERMOS DE CADA PRESTADOR DIZEM (decisão do Presidente de 30/10: nada é pedido às empresas; o texto é honesto e baseado nos termos):
//  1. a Política de Privacidade 2.17 no site de homologação: o Google com as cláusulas-padrão da ANPD, a Microsoft sem elas mas obrigada a cumprir as leis
//     aplicáveis, o GitHub gratuito sem contrato de proteção de dados, a cópia de segurança nos EUA por escolha da ASAF;
//  2. o inventário de dados, no painel, mostra os termos de cada prestador.
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'

test('a Política 2.17 diz o que os termos de cada prestador trazem', async ({
  page,
}, info) => {
  await page.goto(`${SITE}/privacidade/`)
  await expect(page.getByText(/Versão 2\.17 · em vigor desde/)).toBeVisible()
  const paragrafo = page.locator('[data-transferencia]')
  await expect(paragrafo).toContainText(
    'cláusulas-padrão contratuais aprovadas pela Autoridade Nacional de Proteção de Dados (ANPD)',
  )
  await expect(paragrafo).toContainText(
    'O GitHub, no plano gratuito que a ASAF usa, não tem contrato de proteção de dados com a ASAF',
  )
  await expect(paragrafo).toContainText(
    'escolheu também guardar uma cópia de segurança nos Estados Unidos',
  )
  await ver(page, info, 'politica-2-17-prestadores')
})

test('o inventário mostra os termos de cada prestador', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/privacidade/inventario')
  await expect(
    page
      .getByText(/Termos: Adendo de Tratamento de Dados do Google Cloud/)
      .first(),
  ).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page
      .getByText(
        /Termos: Adendo de Proteção de Dados dos Produtos e Serviços da Microsoft/,
      )
      .first(),
  ).toBeVisible()
  await ver(page, info, 'inventario-com-os-termos')
})
