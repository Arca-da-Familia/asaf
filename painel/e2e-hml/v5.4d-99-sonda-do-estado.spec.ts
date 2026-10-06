import { test } from '@playwright/test'

import { entrar, exigirHomologacao, ver } from './apoio'

// Sonda (só leitura): mostra o estado atual dos mandatos e o fim da Auditoria da homologação, para entender um resultado inesperado de outro
// roteiro. Não grava nada. O texto da tela vai como anexo do relatório.
test.beforeAll(() => exigirHomologacao())

test('sonda: mandatos (vigentes e encerrados) e a Auditoria de mandatos', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/governanca/mandatos')
  await page
    .getByRole('heading', { name: 'Mandatos por órgão e cargo' })
    .waitFor()
  await page.getByLabel('Só vigentes').uncheck()
  await page.waitForTimeout(1500)
  await info.attach('mandatos-todos', {
    body: await page.locator('main').innerText(),
    contentType: 'text/plain',
  })
  await ver(page, info, 'sonda mandatos (todos)')

  await page.goto('/auditoria')
  await page.waitForTimeout(2500)
  await info.attach('auditoria-recente', {
    body: await page.locator('main').innerText(),
    contentType: 'text/plain',
  })
  await ver(page, info, 'sonda auditoria')
})
