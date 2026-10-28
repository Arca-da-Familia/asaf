import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, ver, vigiar } from './apoio'

// Ponto de Revisão da FASE 7 (1/3) - "o consentimento é versionado com o texto exato da época: reabrir um consentimento antigo mostra o texto que valia então,
// não o atual". Pela TELA: Privacidade > Consentimentos > um consentimento da versão 1 (a declaração antiga das fotos, que a migração 7c4e1a9d2b63 trouxe na
// homologação) > "Ler o aviso desta versão" mostra o texto da versão 1, diz que hoje vale a 2 e que quem marcava a caixa era a equipe; e o da versão 2 mostra o termo
// de hoje, assinado.
test.beforeAll(() => exigirHomologacao())
test.setTimeout(180_000)

test('reabrir pela tela um consentimento antigo mostra o texto daquela versão, não o de hoje', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/privacidade/consentimentos')
  await expect(
    page.getByRole('heading', { name: 'Consentimentos', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Situação').selectOption('')

  const antigo = page
    .locator('li[data-consentimento]')
    .filter({ hasText: /Termo versão 1 \(hoje vale a 2\)/ })
    .first()
  // a lista vem do mais novo para o mais antigo, de 50 em 50: passa as páginas até achar a versão 1
  await expect(page.locator('li[data-consentimento]').first()).toBeVisible({
    timeout: 30_000,
  })
  const proxima = page.getByRole('button', { name: 'Próxima página' })
  for (let i = 0; i < 40 && !(await antigo.isVisible()); i++) {
    if (!(await proxima.isVisible()) || (await proxima.isDisabled())) break
    await proxima.click()
    await expect(page.getByText(/página \d+ de \d+/)).toBeVisible()
    await page.waitForTimeout(500)
  }
  await expect(
    antigo,
    'a homologação tem consentimento da versão 1',
  ).toBeVisible()
  await antigo.getByRole('button', { name: 'Ler o aviso desta versão' }).click()
  const aviso = antigo.getByTestId('aviso-da-versao')
  await expect(aviso).toContainText('versão 1')
  await expect(aviso).toContainText('hoje vale a versão 2')
  await expect(aviso).toContainText('Quem registrava no painel marcava')
  await ver(page, info, 'consentimento-da-versao-1-reaberto')

  const de_hoje = page
    .locator('li[data-consentimento]')
    .filter({ hasText: /Termo versão 2/ })
    .filter({ hasNotText: /hoje vale/ })
    .first()
  await expect(de_hoje).toBeVisible()
  await de_hoje
    .getByRole('button', { name: 'Ler o aviso desta versão' })
    .click()
  const termo = de_hoje.getByTestId('aviso-da-versao')
  await expect(termo).toContainText('versão 2')
  await expect(termo).not.toContainText('hoje vale a versão')
  await expect(termo).toContainText('Dado pela assinatura no termo impresso')
  await ver(page, info, 'consentimento-da-versao-2-reaberto')
  expect(vigia.problemas()).toEqual([])
})
