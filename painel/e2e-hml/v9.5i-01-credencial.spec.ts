import { expect, test, type Browser, type Page } from '@playwright/test'

import {
  abrirMenuPessoal,
  cadastrarPelaTela,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v9.5i - A CREDENCIAL DO ASSOCIADO (decisão do Presidente, 14/11/2026: o QR vale sempre e quem o lê vê a situação de AGORA; revoga a de 15/10).
//  1. Minha carteirinha: abre pelo menu pessoal; o cartão com nome, matrícula, situação e o QR; "Imprimir a carteirinha" no canto de baixo, à direita.
//  2. Quem lê o QR, SEM login: a página de conferência com a situação de agora, a foto (ou o lugar dela) e os dados - nunca CPF.
//  3. Na ficha (aba Situação), "Emitir outra credencial" (quem perdeu o cartão): a anterior passa a mostrar "Esta credencial não vale", sem nome.
//  4. No celular: frente e verso ("Mostrar o QR" / "Ver a frente") e nada passa da largura da tela.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const NAVEGADOR = {
  baseURL: process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br',
  locale: 'pt-BR',
  timezoneId: 'America/Belem',
  viewport: { width: 390, height: 844 },
}
const NOME = `Credencial Robo ${RODADA} de Teste`
const CPF = /\d{3}\.\d{3}\.\d{3}-\d{2}/

// quem lê o QR não está logado: um navegador limpo, do tamanho de um celular
async function conferirSemLogin(browser: Browser, pagina: string) {
  const contexto = await browser.newContext(NAVEGADOR)
  const leitor = await contexto.newPage()
  await leitor.goto(pagina)
  const caixa = leitor.getByRole('region', { name: 'Situação de agora' })
  await expect(caixa).toBeVisible({ timeout: 30_000 })
  return { contexto, leitor, caixa }
}

async function abrirMinhaCarteirinha(page: Page) {
  await abrirMenuPessoal(page)
  const resposta = page.waitForResponse(
    (r) => r.url().includes('/api/minha-credencial') && r.status() === 200,
  )
  await page.getByRole('link', { name: /Minha carteirinha/ }).click()
  const corpo = (await (await resposta).json()) as {
    pagina: string
    nome_completo: string
  }
  await expect(
    page.getByRole('heading', { name: 'Minha carteirinha', level: 1 }),
  ).toBeVisible()
  return corpo
}

test('Minha carteirinha: o cartão com o QR e a impressão; quem lê o QR sem login vê a situação de agora', async ({
  page,
  browser,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const minha = await abrirMinhaCarteirinha(page)
  await expect(page.getByText(minha.nome_completo).first()).toBeVisible()
  await expect(
    page.getByRole('img', { name: /QR da sua carteirinha/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Imprimir a carteirinha' }),
  ).toBeVisible()
  await expect(page.getByText('Onde a carteirinha vale')).toBeVisible()
  await ver(page, info, 'minha carteirinha no computador')

  const { contexto, leitor, caixa } = await conferirSemLogin(
    browser,
    minha.pagina,
  )
  await expect(caixa).not.toContainText('não vale')
  await expect(leitor.getByText(minha.nome_completo)).toBeVisible()
  await expect(
    leitor.getByText(/Conferido em .* \(horário de Belém\)/),
  ).toBeVisible()
  expect(await leitor.locator('body').innerText()).not.toMatch(CPF)
  await ver(leitor, info, 'quem le o QR sem login')
  await contexto.close()
  expect(vigia.problemas()).toEqual([])
})

test('Emitir outra credencial na ficha: a anterior deixa de valer na hora, sem foto e sem nome', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000)
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await cadastrarPelaTela(page, {
    nome: NOME,
    cpf: cpfValido(RODADA % 1_000_000_000),
    email: `credencial.${RODADA}@homologacao.example.com`,
  })
  await page.getByLabel('Filtrar').fill(String(RODADA))
  await page.getByRole('link', { name: NOME }).click()
  await expect(page.getByRole('heading', { name: NOME })).toBeVisible()
  await page.getByRole('button', { name: 'Situação', exact: true }).click()

  const cartao = page.getByRole('region', { name: 'Credencial (carteirinha)' })
  const link = cartao.getByRole('link', {
    name: 'Abrir a página de conferência',
  })
  await expect(link).toBeVisible({ timeout: 30_000 })
  const antiga = (await link.getAttribute('href'))!
  await cartao.getByRole('button', { name: 'Emitir outra credencial' }).click()
  await ver(page, info, 'confirmar emitir outra')
  await cartao.getByRole('button', { name: 'Sim, emitir outra' }).click()
  await expect(cartao.getByRole('status')).toContainText(
    'A anterior deixou de valer.',
  )
  await expect(link).not.toHaveAttribute('href', antiga)
  const nova = (await link.getAttribute('href'))!
  await ver(page, info, 'credencial nova emitida')

  const velha = await conferirSemLogin(browser, antiga)
  await expect(velha.caixa).toContainText('Esta credencial não vale')
  await expect(velha.leitor.getByText(NOME)).toHaveCount(0)
  await expect(
    velha.leitor.getByText('Sem foto: a credencial não vale'),
  ).toBeVisible()
  await ver(velha.leitor, info, 'a credencial antiga nao vale')
  await velha.contexto.close()

  const atual = await conferirSemLogin(browser, nova)
  await expect(atual.caixa).not.toContainText('não vale')
  await expect(atual.leitor.getByText(NOME)).toBeVisible()
  await atual.contexto.close()
  expect(vigia.problemas()).toEqual([])
})

test('no celular: frente e verso e nada passa da largura da tela', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await entrar(page, 'presidente')
  await abrirMinhaCarteirinha(page)
  const virar = page.getByRole('button', { name: 'Mostrar o QR' })
  await expect(virar).toBeVisible()
  await expect(
    page.getByRole('img', { name: /QR da sua carteirinha/ }),
  ).toBeHidden()
  await ver(page, info, 'celular frente')
  await virar.click()
  await expect(
    page.getByRole('img', { name: /QR da sua carteirinha/ }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ver a frente' })).toBeVisible()
  await ver(page, info, 'celular verso com o QR')
  const larguras = await page.evaluate(() => ({
    pagina: document.documentElement.scrollWidth,
    tela: window.innerWidth,
  }))
  expect(larguras.pagina, 'nada passa da largura da tela').toBeLessThanOrEqual(
    larguras.tela,
  )
  expect(vigia.problemas()).toEqual([])
})
