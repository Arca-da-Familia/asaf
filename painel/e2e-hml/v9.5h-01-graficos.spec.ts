import { expect, test, type Locator, type Page } from '@playwright/test'

import { entrar, exigirHomologacao, ver, vigiar } from './apoio'

// v9.5h - GRÁFICOS DOS ASSOCIADOS no desenho aprovado pelo Presidente (rodada 5, opção 1 no notebook e no celular): filtros no alto, os 6 números, a grade
// de gráficos e o "Personalizar" guardado por pessoa. O robô confere com o dado da homologação:
//  1. os números batem com os gráficos (o "No quadro" é a soma das situações menos Desligado) e o filtro muda tudo junto; a situação leva à lista;
//  2. Personalizar esconde, mostra, muda a ordem e guarda (continua depois de recarregar); "Voltar ao painel padrão" desfaz;
//  3. no celular, os filtros ficam recolhidos num botão e nada sai da largura da tela.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const numeros = (page: Page) =>
  page.getByRole('region', { name: 'Números principais' })

async function valorDoNumero(page: Page, rotulo: string): Promise<number> {
  const cartao = numeros(page).getByRole('listitem').filter({ hasText: rotulo })
  const texto = await cartao.locator('span').nth(1).innerText()
  return Number(texto.replace(/\D/g, ''))
}

// as linhas da tabela de um gráfico ("Ver em tabela"): nome -> número
async function tabelaDo(cartao: Locator): Promise<Map<string, number>> {
  await cartao.getByRole('button', { name: 'Ver em tabela' }).click()
  const linhas = cartao.getByRole('table').getByRole('row')
  const mapa = new Map<string, number>()
  const total = await linhas.count()
  for (let i = 1; i < total; i++) {
    const linha = linhas.nth(i)
    const nome = (await linha.getByRole('rowheader').innerText()).trim()
    const valor = (await linha.getByRole('cell').first().innerText()).replace(
      /\D/g,
      '',
    )
    mapa.set(nome, Number(valor))
  }
  await cartao.getByRole('button', { name: 'Ver o gráfico' }).click()
  return mapa
}

async function abrirGraficos(page: Page) {
  await page.goto('/associados/graficos')
  await expect(
    page.getByRole('heading', { name: 'Gráficos', level: 1 }),
  ).toBeVisible()
  await expect(numeros(page)).toBeVisible({ timeout: 30_000 })
}

test('os números batem com os gráficos e o filtro muda tudo junto; a situação leva à lista', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirGraficos(page)
  await expect(numeros(page).getByRole('listitem')).toHaveCount(6)
  for (const titulo of [
    'Entradas e saídas por mês',
    'Por situação',
    'Por categoria',
    'Faixa de idade',
    'Tamanho do quadro',
  ])
    await expect(page.getByRole('region', { name: titulo })).toBeVisible()
  await expect(
    page.getByRole('region', { name: /^Filiação em / }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible()
  await ver(page, info, 'graficos no painel padrao')

  const noQuadro = await valorDoNumero(page, 'No quadro')
  const porSituacao = await tabelaDo(
    page.getByRole('region', { name: 'Por situação' }),
  )
  const somaSemDesligados = [...porSituacao.entries()]
    .filter(([nome]) => nome !== 'Desligado')
    .reduce((s, [, n]) => s + n, 0)
  expect(noQuadro, 'No quadro = soma das situações menos Desligado').toBe(
    somaSemDesligados,
  )
  const cadastrados = [...porSituacao.values()].reduce((s, n) => s + n, 0)
  await expect(numeros(page)).toContainText(
    `${cadastrados.toLocaleString('pt-BR')} cadastrados`,
  )

  // o tamanho do quadro no fim do mês atual é o "No quadro" de hoje
  const quadro = await tabelaDo(
    page.getByRole('region', { name: 'Tamanho do quadro' }),
  )
  expect([...quadro.values()].at(-1)).toBe(noQuadro)

  // filtro: só os em dia - o número do alto vira o da situação
  const emDia = porSituacao.get('Ativo - Em Dia') ?? 0
  await page
    .getByLabel('Situação', { exact: true })
    .selectOption('Ativo - Em Dia')
  await expect(page).toHaveURL(/situacao=Ativo/)
  await expect
    .poll(() => valorDoNumero(page, 'No quadro'), { timeout: 30_000 })
    .toBe(emDia)
  await ver(page, info, 'filtrado so os em dia')

  // a linha da situação abre a lista dessas pessoas
  await page
    .getByRole('region', { name: 'Por situação' })
    .getByRole('link', { name: /Ativo - Em Dia.*ver a lista/ })
    .click()
  await expect(page).toHaveURL(/\/associados\?situacao=Ativo\+-\+Em\+Dia/)
  await expect(
    page.getByRole('heading', { name: 'Associados', level: 1 }),
  ).toBeVisible()
  await ver(page, info, 'lista aberta pelo grafico')
  expect(vigia.problemas()).toEqual([])
})

test('Personalizar: esconde, mostra, muda a ordem e guarda; o padrão volta com um clique', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirGraficos(page)
  await page.getByRole('button', { name: 'Personalizar' }).click()
  const janela = page.getByRole('dialog', { name: 'Personalizar o painel' })
  await expect(janela).toBeVisible()
  await janela.getByRole('checkbox', { name: /Por situação/ }).uncheck()
  await janela.getByRole('checkbox', { name: /Onde moram/ }).check()
  await janela
    .getByRole('button', { name: 'Descer Entradas e saídas por mês' })
    .click()
  await janela
    .getByRole('button', { name: 'Descer Entradas e saídas por mês' })
    .click()
  // o painel atrás muda na hora
  await expect(page.getByRole('region', { name: 'Por situação' })).toHaveCount(
    0,
  )
  await ver(page, info, 'personalizar aberto com o painel mudando')
  await janela.getByRole('button', { name: 'Guardar para mim' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Painel guardado para você.' }),
  ).toBeVisible()

  await page.reload()
  await expect(page.getByRole('region', { name: 'Onde moram' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('region', { name: 'Por situação' })).toHaveCount(
    0,
  )
  const titulos = await page.getByRole('heading', { level: 2 }).allInnerTexts()
  expect(titulos.indexOf('Por categoria')).toBeLessThan(
    titulos.indexOf('Entradas e saídas por mês'),
  )
  await expect(
    page.getByText(/Você está vendo o seu painel personalizado/),
  ).toBeVisible()
  await ver(page, info, 'painel guardado depois de recarregar')

  await page.getByRole('button', { name: 'Personalizar' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Voltar ao painel padrão' })
    .click()
  await expect(page.getByRole('region', { name: 'Por situação' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Onde moram' })).toHaveCount(0)
  await ver(page, info, 'painel padrao de volta')
  expect(vigia.problemas()).toEqual([])
})

test('no celular: os filtros recolhidos num botão e nada sai da largura da tela', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await entrar(page, 'presidente')
  await abrirGraficos(page)
  const botaoDosFiltros = page.getByRole('button', {
    name: /^Filtros: 12 meses/,
  })
  await expect(botaoDosFiltros).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Período')).toBeHidden()
  await ver(page, info, 'celular com os filtros recolhidos')
  await botaoDosFiltros.click()
  await expect(page.getByLabel('Período')).toBeVisible()
  const larguras = await page.evaluate(() => ({
    pagina: document.documentElement.scrollWidth,
    tela: window.innerWidth,
  }))
  expect(larguras.pagina, 'nada passa da largura da tela').toBeLessThanOrEqual(
    larguras.tela,
  )
  await ver(page, info, 'celular com os filtros abertos')
  await page
    .getByRole('region', { name: 'Tamanho do quadro' })
    .scrollIntoViewIfNeeded()
  await ver(page, info, 'celular rolando os graficos')
  await page.getByRole('button', { name: 'Personalizar' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Personalizar o painel' }),
  ).toBeVisible()
  await ver(page, info, 'celular com o personalizar')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(vigia.problemas()).toEqual([])
})
