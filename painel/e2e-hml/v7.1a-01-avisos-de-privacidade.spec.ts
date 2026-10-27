import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'
import textos from '../../site/src/data/textos-de-privacidade.json' with { type: 'json' }

// v7.1a - OS AVISOS DE PRIVACIDADE COM VERSÃO. Pelas telas:
//  1. a PRESIDENTE DO CARGO abre Privacidade > Avisos de privacidade: cada formulário do site com o tipo (aviso, não consentimento), a base legal e as versões; a
//     inscrição em evento deixou o "autorizo" (versão 1) pelo aviso da versão 2; a filiação tem a versão 2 (que dizia que o pedido recusado ficava guardado) e a 3;
//  2. no SITE de teste, a filiação mostra o aviso da versão em vigor (o prazo de 2 anos que a rotina aplica) e a caixa "Li o aviso de privacidade."; a conta de
//     visitante e o voluntariado mostram os seus avisos, com o link da Política;
//  3. um pedido de filiação feito agora pelo site chega ao painel com a versão em vigor, e "Ler o aviso desta versão" mostra o texto exato dela; o aviso antigo
//     (versão 2) reaberto pela API traz o texto daquela época, não o de hoje; quem não é da Presidência lê um aviso, mas não a lista (403).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE_HML = 'https://hml-site.asaf.org.br'
const PESSOA = {
  nome: `Candidata Aviso ${RODADA} de Teste`,
  cpf: cpfValido(700000000 + (RODADA % 90000000)),
  email: `aviso.${RODADA}@homologacao.example.com`,
}

/** Entra e devolve o cabeçalho de autorização que o painel usa (para as conferências pela API). */
async function entrarComToken(
  page: Page,
  papel: Parameters<typeof entrar>[1],
): Promise<Record<string, string>> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, papel)
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return { Authorization: autorizacao }
}

test('a Presidente do cargo vê cada aviso com a base legal e as versões', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'cargo_presidente')
  await page.goto('/privacidade/avisos')
  await expect(
    page.getByRole('heading', { name: 'Avisos de privacidade', level: 1 }),
  ).toBeVisible()
  const inscricao = page.getByRole('region', {
    name: 'Inscrição em evento pelo site',
  })
  await expect(inscricao.getByText('Aviso (não é consentimento)')).toBeVisible()
  await expect(inscricao).toContainText('Art. 7º, V')
  await expect(inscricao).toContainText(
    `versão atual: ${textos.INSCRICAO_EVENTO.versao}`,
  )
  await inscricao.getByText(/^Versão 1, desde/).click()
  await expect(inscricao).toContainText('Ao me inscrever, autorizo')
  const filiacao = page.getByRole('region', {
    name: 'Pedido de filiação pelo site',
  })
  await filiacao.getByText(/^Versão 2, desde .*reconstituída/).click()
  await expect(filiacao).toContainText(
    'Pedidos recusados ou sem andamento ficam guardados no sistema',
  )
  await expect(filiacao).toContainText('2 anos depois da última mudança')
  await ver(page, info, 'avisos-de-privacidade')
  expect(vigia.problemas()).toEqual([])
})

test('o site de teste mostra os avisos do catálogo, com o link da Política', async ({
  page,
}, info) => {
  await page.goto(`${SITE_HML}/seja-associado/`)
  const aviso = page.locator('#aviso-de-privacidade')
  await expect(aviso).toContainText(
    `Aviso de privacidade (versão ${textos.FILIACAO.versao})`,
  )
  await expect(aviso).toContainText('2 anos depois da última mudança')
  await expect(
    aviso.getByRole('link', { name: 'Política de Privacidade' }),
  ).toHaveAttribute('href', '/privacidade/')
  await expect(page.getByLabel('Li o aviso de privacidade.')).toBeVisible()
  await ver(page, info, 'site-filiacao-aviso')

  await page.goto(`${SITE_HML}/seja-voluntario/`)
  await expect(
    page.locator('[data-aviso="ATENDIMENTO_VOLUNTARIADO"]').first(),
  ).toContainText('a secretaria cadastra você como voluntário(a)')
  await page.goto(`${SITE_HML}/minha-conta/`)
  const visitante = page.locator('[data-aviso="VISITANTE"]')
  await expect(visitante).toContainText(
    'O seu e-mail é usado para enviar o código',
  )
  await expect(
    visitante.getByRole('link', { name: 'Política de Privacidade' }),
  ).toHaveAttribute('href', '/privacidade/#conta-do-visitante')
  await ver(page, info, 'site-conta-de-visitante-aviso')

  const r = await page.request.get(
    `${API_HML}/api/publico/eventos/consentimento-lgpd`,
  )
  const corpo = (await r.json()) as {
    versao: string
    texto: string
    paragrafos: string[]
    caixa: string
  }
  expect(corpo.versao).toBe(textos.INSCRICAO_EVENTO.versao)
  expect(corpo.paragrafos).toEqual(textos.INSCRICAO_EVENTO.paragrafos)
  expect(corpo.texto).not.toContain('](')
  expect(corpo.caixa).toBe('Li o aviso de privacidade.')
})

test('o pedido feito agora chega com a versão em vigor; o aviso de cada versão reabre com o texto daquela época', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE_HML}/seja-associado/`)
  await page.getByLabel('Nome completo').fill(PESSOA.nome)
  await page.getByLabel('CPF').fill(PESSOA.cpf)
  await page.getByLabel('Data de nascimento').fill('1988-03-04')
  await page.getByLabel('E-mail').fill(PESSOA.email)
  await page.getByLabel('Li o aviso de privacidade.').check()
  await page.getByRole('button', { name: 'Enviar pedido de filiação' }).click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Recebemos o seu pedido de filiação' }),
  ).toBeVisible()

  const cab = await entrarComToken(page, 'presidente')
  await page.goto('/associados/propostas')
  const proposta = page.getByRole('listitem', {
    name: `Proposta de ${PESSOA.nome}`,
  })
  await expect(proposta).toContainText(
    `Aviso de privacidade aceito (versão ${textos.FILIACAO.versao})`,
  )
  await proposta
    .getByRole('button', { name: 'Ler o aviso desta versão' })
    .click()
  const lido = proposta.getByTestId('aviso-da-versao')
  await expect(lido).toContainText(`versão ${textos.FILIACAO.versao}`)
  await expect(lido).toContainText('2 anos depois da última mudança')
  await ver(page, info, 'proposta-com-o-aviso-lido')

  const antigo = await page.request.get(
    `${API_HML}/api/textos-de-privacidade/FILIACAO/2`,
    { headers: cab },
  )
  expect(antigo.status()).toBe(200)
  const v2 = (await antigo.json()) as {
    texto_sem_links: string
    versao_atual: string
  }
  expect(v2.texto_sem_links).toContain(
    'Pedidos recusados ou sem andamento ficam guardados no sistema',
  )
  expect(v2.versao_atual).toBe(textos.FILIACAO.versao)
  expect(vigia.problemas()).toEqual([])
})

test('quem não cuida da privacidade (o Tesoureiro) lê um aviso, mas não a lista com as bases', async ({
  page,
}) => {
  const cab = await entrarComToken(page, 'tesoureiro')
  const um = await page.request.get(
    `${API_HML}/api/textos-de-privacidade/FILIACAO/1`,
    { headers: cab },
  )
  expect(um.status()).toBe(200)
  const lista = await page.request.get(
    `${API_HML}/api/privacidade/textos-de-privacidade`,
    { headers: cab },
  )
  expect(lista.status()).toBe(403)
})
