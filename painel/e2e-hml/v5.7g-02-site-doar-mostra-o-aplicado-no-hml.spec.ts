import { expect, test, type Page } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao, ver, vigiar } from './apoio'

// v5.7g - o que o VISITANTE do site de teste (hml-site) vê na página Doar sobre o APLICADO de cada campanha, num navegador de verdade, DEPOIS de a homologação ser publicada (o site é construído no
// Deploy Homologação): a campanha ligada a um centro de custo mostra o total já gasto nele (a saída que o v5.7g-01 registrou, R$ 123,45), a campanha SEM centro de custo diz que o gasto não é
// acompanhado à parte (nunca um zero inventado), a nota da página explica o "Já aplicado" e nada do centro de custo aparece. Roda DEPOIS do v5.7g-01 (que cria as duas campanhas e a saída).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const CAMINHO = `${SITE}/como-ajudar/doar/`

let autorizacao = ''
const cabecalho = () => ({ Authorization: autorizacao })

async function garantirPixAberto(page: Page): Promise<void> {
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  const r = await page.request.put(`${API_HML}/api/instituicao/CHAVE_PIX`, {
    headers: cabecalho(),
    data: {
      valor: 'chave-pix-de-teste@homologacao.example.com',
      publico: true,
    },
  })
  expect(r.status(), await r.text()).toBe(200)
}

test('a página Doar mostra o aplicado: o valor da saída na campanha com centro de custo e "não acompanhado à parte" na sem centro', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await garantirPixAberto(page)

  const resposta = await page.goto(CAMINHO, { waitUntil: 'networkidle' })
  expect(resposta?.status()).toBe(200)
  await expect(
    page.locator('[data-doacao-vivo] > [data-estado="pronto"]'),
  ).toBeVisible({ timeout: 30_000 })

  const com = page
    .locator('[data-campanha]')
    .filter({ hasText: 'Robô com centro' })
    .first()
  const sem = page
    .locator('[data-campanha]')
    .filter({ hasText: 'Robô sem centro' })
    .first()
  await expect(com).toBeVisible()
  await expect(sem).toBeVisible()
  await expect(com.getByText('Já aplicado')).toBeVisible()
  await expect(com.locator('[data-aplicado]')).toHaveText(/^R\$\s123,45$/)
  await expect(sem.locator('[data-aplicado]')).toHaveText(
    'não acompanhado à parte',
  )
  await expect(page.locator('[data-nota-recebido]')).toContainText(
    '“Já aplicado” é o total que a tesouraria já registrou como gasto ligado à campanha',
  )
  // nada do centro de custo aparece na página
  const corpo = await page.locator('main').innerText()
  expect(corpo).not.toContain('Centro do robô')
  expect(corpo).not.toContain('ROBO-')
  await ver(page, info, 'doar-com-o-aplicado-por-campanha')
  expect(vigia.problemas()).toEqual([])
})
