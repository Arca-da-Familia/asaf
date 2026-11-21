import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import {
  abrirNoMenuDoModulo,
  API_HML,
  autorizacaoDaSessao,
  entrar,
  exigirHomologacao,
  menuDoModulo,
  telaNoMenuDoModulo,
  ver,
  vigiar,
} from './apoio'

// v9.6b - A CASCA DO MÓDULO FINANCEIRO, no desenho escolhido pelo Presidente (rodada 7b: o menu `fin-menu-2` "Os cinco grupos, com os seus mais usados
// no alto" e a Visão geral `fin-inicio-2` "Com a cor do lado e o botão da ação" / no celular "Os 4 lugares mudam sozinhos"). Pelas telas da homologação:
//  1. o Tesoureiro: a Visão geral (o saldo nas contas e até 6 lugares, na ordem: em atraso, o que precisa de você, os mais usados, os atalhos), os
//     números de pendência do menu batendo com GET /api/financeiro/pendencias, a janela de aprovar compra (abre, mostra o resumo e fecha sem aprovar),
//     "Seus mais usados" aparecendo conforme ele abre as telas, e o menu recolhido (um ícone por grupo, a lista ao lado, Esc fecha e o foco volta);
//  2. o Conselho Fiscal (só audita): o Início do módulo o leva ao Conselho Fiscal; o menu tem 2 grupos e 3 telas, sem a Visão geral e sem números;
//     a rota das pendências o recusa (403);
//  3. no celular: 4 lugares, nada rola de lado (com a gaveta do menu aberta também) e a tela abre pela gaveta.
// Nada é gravado: o robô só lê e navega (a janela de aprovar fecha sem aprovar).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const GRUPOS = [
  'Dia a dia',
  'Rotina do mês',
  'Cadastros',
  'Relatórios',
  'Controle',
]
// a ordem das cores dos lugares: o que está em atraso vem antes de tudo, depois o que precisa de você, depois os mais usados e os atalhos
const ORDEM_DOS_ESTADOS = ['atraso', 'pend', 'usado', 'atalho']
// a tela do menu que mostra cada número de pendência
const TELA_DO_NUMERO: Record<string, string> = {
  compras: 'Compras',
  doacoes: 'Doações',
  reembolsos: 'Reembolsos',
  conciliacao: 'Conciliação bancária',
}

type Pendencias = {
  compras_para_aprovar: { total: number }
  mensalidades_em_atraso: { titulos: number }
  a_pagar_vencidas: { total: number }
  contadores: Record<string, number>
}

async function semRolagemLateral(page: Page, onde: string) {
  const larguras = await page.evaluate(() => ({
    pagina: document.documentElement.scrollWidth,
    tela: window.innerWidth,
  }))
  expect(
    larguras.pagina,
    `${onde}: nada passa da largura da tela`,
  ).toBeLessThanOrEqual(larguras.tela)
}

async function semViolacoesDoAxe(page: Page, onde: string) {
  // as cores do menu mudam com uma transição curta (150 ms) ao trocar de tela: o contraste é medido depois dela
  await page.waitForTimeout(400)
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
    `${onde}: sem violações do axe (WCAG 2.2 AA)`,
  ).toEqual([])
}

const estadosDosLugares = (page: Page) =>
  page
    .locator('li[data-lugar]')
    .evaluateAll((lis) =>
      lis.map((li) => (li as HTMLElement).dataset.estado ?? ''),
    )

const maisUsados = (page: Page) =>
  menuDoModulo(page)
    .getByRole('list', { name: 'Seus mais usados' })
    .getByRole('link')

test('o Tesoureiro: a Visão geral, os números do menu, a janela de aprovar, os mais usados e o menu recolhido', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await page.getByRole('link', { name: 'Financeiro' }).first().click()
  await expect(page).toHaveURL(/\/financeiro$/)
  await expect(
    page.getByRole('heading', { name: 'Visão geral', level: 1 }),
  ).toBeVisible()
  const cab = await autorizacaoDaSessao(page, '/financeiro')
  const resposta = await page.request.get(
    `${API_HML}/api/financeiro/pendencias`,
    {
      headers: { Authorization: cab },
    },
  )
  expect(resposta.status(), await resposta.text()).toBe(200)
  const pendencias = (await resposta.json()) as Pendencias

  // o saldo nas contas e os lugares (1 a 6), na ordem das cores
  await expect(
    page.getByRole('region', { name: 'Saldo nas contas hoje' }),
  ).toBeVisible()
  await expect(page.getByText('Carregando o que precisa de você…')).toHaveCount(
    0,
  )
  const estados = await estadosDosLugares(page)
  expect(estados.length).toBeGreaterThan(0)
  expect(estados.length).toBeLessThanOrEqual(6)
  const posicoes = estados.map((e) => ORDEM_DOS_ESTADOS.indexOf(e))
  expect(posicoes, `a ordem dos lugares: ${estados.join(', ')}`).toEqual(
    [...posicoes].sort((a, b) => a - b),
  )
  if (pendencias.mensalidades_em_atraso.titulos > 0)
    await expect(page.locator('li[data-lugar="mensalidades"]')).toHaveAttribute(
      'data-estado',
      'atraso',
    )
  if (pendencias.a_pagar_vencidas.total > 0)
    await expect(page.locator('li[data-lugar="a-pagar"]')).toHaveAttribute(
      'data-estado',
      'atraso',
    )

  // o menu: a Visão geral fixa no alto (a tela aberta), os 5 grupos fechados, e os números batendo com o servidor
  const menu = menuDoModulo(page)
  await expect(menu.getByRole('link', { name: 'Visão geral' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  for (const grupo of GRUPOS)
    await expect(
      menu.getByRole('button', { name: new RegExp(`^${grupo} \\d+ telas?$`) }),
      grupo,
    ).toHaveAttribute('aria-expanded', 'false')
  for (const [chave, tela] of Object.entries(TELA_DO_NUMERO)) {
    const n = pendencias.contadores[chave] ?? 0
    const link = telaNoMenuDoModulo(page, tela)
    await expect(link, tela).toHaveCount(1)
    await expect(link).toHaveText(tela)
    // o número fica ao lado do link, por cima dele (fora do link: o nome que o leitor de tela ouve vem do aria-label)
    if (n > 0) {
      await expect(link, `${tela}: o nome com o número`).toHaveAttribute(
        'aria-label',
        `${tela} ${n} ${n === 1 ? 'pendente' : 'pendentes'}`,
      )
      await expect(
        link.locator('xpath=..'),
        `${tela}: o número do menu`,
      ).toHaveText(`${tela}${n}`)
    } else
      await expect(link, `${tela}: sem número`).not.toHaveAttribute(
        'aria-label',
      )
  }
  await expect(
    menu.getByText('As telas que você mais abrir aparecem aqui.'),
  ).toBeVisible()
  await semViolacoesDoAxe(page, 'Visão geral')
  await ver(page, info, 'visao geral do tesoureiro')

  // a janela de aprovar: abre com o resumo e fecha sem aprovar (nenhum pedido de aprovação sai)
  if (pendencias.compras_para_aprovar.total > 0) {
    const aprovacoes: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/aprovar/.test(r.url()))
        aprovacoes.push(r.url())
    })
    await page.getByRole('button', { name: /compras? para aprovar/ }).click()
    const janela = page.getByRole('alertdialog', {
      name: /Compras? para aprovar/,
    })
    await expect(janela).toBeVisible()
    await expect(janela.getByText('Regra da alçada').first()).toBeVisible()
    await expect(janela.getByText('Já assinaram').first()).toBeVisible()
    await semViolacoesDoAxe(page, 'janela de aprovar')
    await ver(page, info, 'janela de aprovar com o resumo do pedido')
    await janela.getByRole('button', { name: 'Fechar' }).click()
    await expect(janela).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /compras? para aprovar/ }),
    ).toBeFocused()
    expect(aprovacoes, 'fechar a janela não aprova nada').toEqual([])
  } else {
    info.annotations.push({
      type: 'aviso',
      description:
        'nenhuma compra esperava a assinatura do Tesoureiro: a janela de aprovar não foi aberta nesta rodada',
    })
  }

  // os mais usados aparecem conforme ele abre as telas (Saídas 2 vezes, Gerar cobranças 1)
  await abrirNoMenuDoModulo(page, 'Dia a dia', 'Saídas')
  await expect(
    page.getByRole('heading', { name: 'Saídas', level: 1 }),
  ).toBeVisible()
  await abrirNoMenuDoModulo(page, 'Rotina do mês', 'Gerar cobranças')
  await expect(page).toHaveURL(/\/financeiro\/gerar-cobrancas$/)
  // a tela chega a abrir (é baixada na hora): só então conta para os mais usados
  await expect(
    page.getByRole('heading', { name: 'Gerar Cobranças', level: 1 }),
  ).toBeVisible()
  await abrirNoMenuDoModulo(page, 'Dia a dia', 'Saídas')
  await expect(
    page.getByRole('heading', { name: 'Saídas', level: 1 }),
  ).toBeVisible()
  await menu.getByRole('link', { name: 'Visão geral' }).click()
  await expect(
    page.getByRole('heading', { name: 'Visão geral', level: 1 }),
  ).toBeVisible()
  await expect(maisUsados(page)).toHaveText(['Saídas', 'Gerar cobranças'])
  // nos lugares, um "mais usado" é sempre uma das telas que ele abriu
  for (const chave of await page
    .locator('li[data-estado="usado"]')
    .evaluateAll((lis) =>
      lis.map((li) => (li as HTMLElement).dataset.lugar ?? ''),
    ))
    expect([
      'usado:/financeiro/saidas',
      'usado:/financeiro/gerar-cobrancas',
    ]).toContain(chave)
  await ver(page, info, 'mais usados no alto do menu')
  // o atalho leva à tela
  await maisUsados(page).first().click()
  await expect(
    page.getByRole('heading', { name: 'Saídas', level: 1 }),
  ).toBeVisible()

  // o menu recolhido: um ícone por grupo; a lista do grupo abre ao lado, com o foco na primeira tela; Esc fecha e devolve o foco
  await page.getByRole('button', { name: 'Recolher menu' }).click()
  const faixa = menuDoModulo(page)
  await expect(faixa.getByRole('link', { name: 'Início' })).toBeVisible()
  await expect(faixa.getByRole('link', { name: 'Visão geral' })).toBeVisible()
  const diaADia = faixa.getByRole('button', { name: /^Dia a dia/ })
  await diaADia.click()
  const lista = faixa.getByRole('group', { name: 'Dia a dia' })
  await expect(lista).toBeVisible()
  await expect(lista.getByRole('link', { name: 'Entradas' })).toBeFocused()
  await expect(lista.getByRole('link', { name: /^Saídas/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await semRolagemLateral(page, 'lista do grupo aberta ao lado')
  await semViolacoesDoAxe(page, 'menu recolhido com a lista aberta')
  await ver(page, info, 'menu recolhido com a lista do grupo ao lado')
  await page.keyboard.press('Escape')
  await expect(lista).toHaveCount(0)
  await expect(diaADia).toBeFocused()
  await abrirNoMenuDoModulo(page, 'Cadastros', 'Fornecedores')
  await expect(page).toHaveURL(/\/financeiro\/fornecedores$/)
  await expect(faixa.getByRole('group')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expandir menu' }).click()
  await expect(
    menuDoModulo(page).getByRole('list', { name: 'Seus mais usados' }),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('o Conselho Fiscal (só audita): cai no Conselho Fiscal, vê 2 grupos e 3 telas, e a rota das pendências o recusa', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'conselheiro')
  await page.getByRole('link', { name: 'Financeiro' }).first().click()
  await expect(page).toHaveURL(/\/financeiro\/conselho-fiscal$/)
  await expect(
    page.getByRole('heading', { name: /Conselho Fiscal/, level: 1 }),
  ).toBeVisible()
  const menu = menuDoModulo(page)
  await expect(menu.getByRole('link', { name: 'Visão geral' })).toHaveCount(0)
  await expect(
    menu.getByRole('button', { name: /^(Relatórios|Controle) / }),
  ).toHaveCount(2)
  for (const grupo of ['Dia a dia', 'Rotina do mês', 'Cadastros'])
    await expect(
      menu.getByRole('button', { name: new RegExp(`^${grupo}`) }),
    ).toHaveCount(0)
  await expect(menu.locator('[role="group"] a')).toHaveCount(3)
  for (const tela of ['Relatórios', 'Conselho Fiscal', 'Auditoria financeira'])
    await expect(telaNoMenuDoModulo(page, tela), tela).toHaveCount(1)
  await expect(menu.getByText(/pendentes?$/)).toHaveCount(0)
  await ver(page, info, 'menu do Conselho Fiscal so com o que audita')

  // o servidor revalida: a rota das pendências é de quem opera
  const cab = await autorizacaoDaSessao(page, '/financeiro/conselho-fiscal')
  const r = await page.request.get(`${API_HML}/api/financeiro/pendencias`, {
    headers: { Authorization: cab },
  })
  expect(r.status()).toBe(403)
  expect(await r.text()).toContain("'financeiro'")

  // digitar o endereço da Visão geral o leva de volta ao Conselho Fiscal
  await page.goto('/financeiro')
  await expect(page).toHaveURL(/\/financeiro\/conselho-fiscal$/)
  await abrirNoMenuDoModulo(page, 'Relatórios', 'Relatórios')
  await expect(
    page.getByRole('heading', { name: 'Relatórios', level: 1 }),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test.describe('no celular', () => {
  test.use({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  })

  test('4 lugares, nada rola de lado (com a gaveta aberta também) e a tela abre pela gaveta', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'tesoureiro')
    await page.goto('/financeiro')
    await expect(
      page.getByRole('heading', { name: 'Visão geral', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText('Carregando o que precisa de você…'),
    ).toHaveCount(0)
    const lugares = page.locator('li[data-lugar]')
    expect(await lugares.count()).toBeLessThanOrEqual(6)
    expect(await lugares.filter({ visible: true }).count()).toBeLessThanOrEqual(
      4,
    )
    // no celular o alto fica só com o mês (os botões ficam nos lugares e no menu)
    await expect(page.getByRole('link', { name: 'Novo título' })).toBeHidden()
    await expect(page.getByRole('group', { name: 'Mês' })).toBeVisible()
    await semRolagemLateral(page, 'Visão geral no celular')
    await ver(page, info, 'visao geral no celular')

    await page.getByRole('button', { name: 'Abrir menu' }).click()
    const menu = menuDoModulo(page)
    await expect(
      menu.getByRole('link', { name: 'Visão geral' }),
    ).toBeInViewport()
    await semRolagemLateral(page, 'gaveta do menu aberta')
    await ver(page, info, 'gaveta do menu no celular')
    await abrirNoMenuDoModulo(page, 'Dia a dia', 'Entradas')
    await expect(
      page.getByRole('heading', { name: 'Entradas', level: 1 }),
    ).toBeVisible()
    await expect(
      menu.getByRole('link', { name: 'Visão geral' }),
    ).not.toBeInViewport()
    await semRolagemLateral(page, 'Entradas no celular')
    expect(vigia.problemas()).toEqual([])
  })
})
