import { expect, test, type Page } from '@playwright/test'

import { entrar, exigirHomologacao, RODADA, ver, vigiar } from './apoio'

// v9.5k - O CRIADOR DE CREDENCIAL, no desenho escolhido pelo Presidente (rodada 6: a página inicial com os modelos e o editor de arrastar):
//  1. a página inicial; começa do pronto "Faixa do lado"; troca a cor da faixa; move o nome pelas setas e arrasta "Associado desde" com o mouse;
//     provoca o aviso de contraste (letra branca no fundo branco), que trava o Guardar, e desfaz; guarda e usa para todos; a folha A4 sai com o
//     modelo novo; a Auditoria registra; no fim, a homologação volta ao desenho padrão (o modelo do robô é apagado);
//  2. no celular, a página inicial e o editor sem rolagem para o lado.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const NOME = `Robô ${RODADA}`
const PADRAO = 'Padrão da homologação'

async function semRolagemLateral(page: Page) {
  const larguras = await page.evaluate(() => ({
    pagina: document.documentElement.scrollWidth,
    tela: window.innerWidth,
  }))
  expect(larguras.pagina, 'nada passa da largura da tela').toBeLessThanOrEqual(
    larguras.tela,
  )
}

/** Apaga os modelos que robôs anteriores deixaram (só os que não estão em uso aparecem em "guardados"). */
async function apagarModelosDeRobo(page: Page) {
  for (;;) {
    const apagar = page
      .getByRole('button', { name: /^Apagar Robô \d+$/ })
      .first()
    if (!(await apagar.isVisible().catch(() => false))) return
    await apagar.click()
    await page.getByRole('button', { name: 'Sim, apagar' }).click()
    await expect(page.getByText('Modelo apagado.')).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Criador de credencial', level: 1 }),
    ).toBeVisible()
  }
}

test('começar de um pronto, arrastar, recusar a cor difícil de ler, usar para todos e voltar ao padrão', async ({
  page,
  context,
}, info) => {
  test.setTimeout(300_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados/credenciais/criador')
  await expect(
    page.getByRole('heading', { name: 'Criador de credencial', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText('Em uso agora')).toBeVisible({ timeout: 30_000 })
  await apagarModelosDeRobo(page)
  await ver(page, info, 'pagina inicial do criador')

  await page
    .getByRole('link', { name: 'Começar do modelo Faixa do lado' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Modelo novo', level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Faixa azul' }).click()
  await expect(
    page.getByRole('button', { name: 'Faixa azul' }),
  ).toHaveAttribute('aria-pressed', 'true')

  // as setas movem a parte escolhida
  const nome = page.getByRole('button', { name: /^Nome: 30,0 mm da esquerda/ })
  await nome.click()
  await nome.press('ArrowDown')
  await nome.press('ArrowDown')
  await expect(
    page.getByRole('button', {
      name: /^Nome: 30,0 mm da esquerda, 7,0 mm do alto$/,
    }),
  ).toBeVisible()

  // o mouse arrasta "Associado desde" para baixo
  const desde = page.getByRole('button', { name: /^Associado desde: / })
  const caixa = (await desde.boundingBox())!
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    caixa.x + caixa.width / 2,
    caixa.y + caixa.height / 2 + 30,
    {
      steps: 6,
    },
  )
  await page.mouse.up()
  await expect(
    page.getByRole('button', {
      name: /^Associado desde: 30,0 mm da esquerda, 27,5 mm do alto$/,
    }),
  ).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Tudo certo/ })).toBeVisible()
  await ver(page, info, 'editor com a faixa azul e as partes movidas')

  // o erro que tem de ser recusado: letra branca no fundo branco
  await page.getByRole('button', { name: /^Nome: / }).click()
  await page
    .getByRole('group', { name: 'Cor da letra' })
    .getByRole('button', { name: 'Branca' })
    .click()
  await expect(
    page.getByRole('heading', { name: /Antes de guardar, corrija/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Guardar e usar para todos' }),
  ).toBeDisabled()
  await ver(page, info, 'aviso de contraste travando o guardar')
  await page.getByRole('button', { name: 'Desfazer' }).click()
  await expect(page.getByRole('heading', { name: /Tudo certo/ })).toBeVisible()

  await page.getByLabel('Nome do modelo').fill(NOME)
  await page.getByRole('button', { name: 'Guardar e usar para todos' }).click()
  await page.getByRole('button', { name: 'Sim, usar para todos' }).click()
  await expect(
    page.getByText(/é o desenho de todas as credenciais/),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: NOME })).toBeVisible()
  await ver(page, info, 'o modelo do robo em uso')

  // a folha A4 sai com o modelo novo (só abre; não registra impressão)
  await page.goto('/associados/credenciais')
  const primeira = page
    .getByRole('table', { name: 'Credenciais dos associados' })
    .getByRole('checkbox')
    .nth(1)
  await expect(primeira).toBeVisible({ timeout: 30_000 })
  await primeira.check()
  const [folha] = await Promise.all([
    context.waitForEvent('page'),
    page
      .getByRole('button', { name: 'Imprimir as marcadas (folha A4)' })
      .click(),
  ])
  await folha.waitForLoadState()
  const cartao = folha.getByRole('img', { name: /^Credencial de / }).first()
  await expect(cartao).toBeVisible({ timeout: 30_000 })
  await expect(cartao).toContainText('Matrícula nº')
  await ver(folha, info, 'folha A4 com o modelo novo')
  await folha.close()

  // a Auditoria registrou
  await page.goto('/auditoria?tabela=associados&acao=MODELO_CREDENCIAL_EM_USO')
  await expect(
    page.locator('[data-acao="MODELO_CREDENCIAL_EM_USO"]').first(),
  ).toBeVisible({ timeout: 30_000 })
  await ver(page, info, 'auditoria com o modelo em uso')

  // a homologação volta ao desenho padrão e o modelo do robô sai da lista
  await page.goto('/associados/credenciais/criador')
  await expect(page.getByText('Em uso agora')).toBeVisible({ timeout: 30_000 })
  const padrao = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: PADRAO }),
  })
  if (await padrao.count()) {
    await padrao.getByRole('button', { name: 'Usar para todos' }).click()
    await padrao.getByRole('button', { name: 'Sim, usar para todos' }).click()
    await expect(
      page.getByText(/é o desenho de todas as credenciais/),
    ).toBeVisible()
  } else {
    await page
      .getByRole('link', { name: 'Começar do modelo Faixa no alto' })
      .click()
    await page.getByLabel('Nome do modelo').fill(PADRAO)
    await page
      .getByRole('button', { name: 'Guardar e usar para todos' })
      .click()
    await page.getByRole('button', { name: 'Sim, usar para todos' }).click()
  }
  await expect(page.getByRole('heading', { name: PADRAO })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('button', { name: `Apagar ${NOME}` }).click()
  await page.getByRole('button', { name: 'Sim, apagar' }).click()
  await expect(page.getByText('Modelo apagado.')).toBeVisible()
  await ver(page, info, 'de volta ao padrao')
  expect(vigia.problemas()).toEqual([])
})

test('no celular: a página inicial e o editor cabem na tela', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await entrar(page, 'presidente')
  await page.goto('/associados/credenciais/criador')
  await expect(page.getByText('Em uso agora')).toBeVisible({ timeout: 30_000 })
  await semRolagemLateral(page)
  await ver(page, info, 'celular pagina inicial do criador')
  await page
    .getByRole('link', { name: 'Começar do modelo Foto no centro' })
    .click()
  await expect(
    page.getByRole('button', { name: /^QR de conferência:/ }),
  ).toBeVisible()
  await semRolagemLateral(page)
  await ver(page, info, 'celular editor')
  expect(vigia.problemas()).toEqual([])
})
