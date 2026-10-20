import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.7h - a notícia do site pode se ligar a uma EMENDA (campo "Número da emenda" no editor do site, Directus). Esse número é o da emenda no sistema, e quem o descobre é a pessoa que edita o site,
// olhando o painel. Provado aqui, pelas telas do hml-painel e com a API pública:
//  1. cadastrada uma emenda pela tela, o alto da página dela mostra "Nº da emenda: <o mesmo número do endereço da página>" e diz que é esse número que se digita no editor do site;
//  2. o número continua lá ao reabrir a página, e a emenda que ainda é rascunho NÃO está na lista pública (por isso o aviso "só vale depois de a emenda ser publicada" é verdadeiro: o site só liga
//     notícia a emenda que a API pública lista);
//  3. uma parceria que NÃO é emenda (termo de fomento) não mostra o número: a ligação da notícia é só com emenda.
// A ligação em si (a notícia mostrando "Sobre a emenda ..." e a emenda listando a notícia) é provada pelo servidor de teste do site (testes de navegador do Deploy Site), porque o site de teste não tem Directus.
// Fica na homologação, para explorar: a emenda e o termo do robô (rascunhos).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const S = String(RODADA)
const TITULO_DA_EMENDA = `Emenda de Teste ${S} - numero para a noticia`
const TITULO_DO_TERMO = `Termo de Teste ${S} - sem numero de emenda`
const OBJETO = `Parceria inventada pelo robô v5.7h na rodada ${S}, só para conferir o número que a notícia usa.`

let idDaEmenda = 0
let idDoTermo = 0

async function cadastrar(
  page: Page,
  titulo: string,
  tipo: string | null,
): Promise<number> {
  await page.goto('/parcerias/nova')
  await expect(
    page.getByRole('heading', { name: 'Nova parceria ou emenda', level: 1 }),
  ).toBeVisible()
  const form = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Cadastrar parceria' }),
  })
  if (tipo !== null) {
    await escolherPorTexto(form.getByLabel(/^Tipo/), tipo)
  }
  await form.getByLabel(/^Título/).fill(titulo)
  await form.getByLabel(/^Objeto/).fill(OBJETO)
  await form.getByLabel(/^Valor total/).fill('50.000,00')
  await form.getByRole('button', { name: 'Cadastrar parceria' }).click()
  await expect(page).toHaveURL(/\/parcerias\/\d+$/)
  await expect(
    page.getByRole('heading', { name: titulo, level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return Number(new URL(page.url()).pathname.split('/').pop())
}

test('a emenda cadastrada mostra o número que se digita no editor do site, igual ao do endereço da página', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  idDaEmenda = await cadastrar(page, TITULO_DA_EMENDA, null)
  expect(idDaEmenda).toBeGreaterThan(0)

  const numero = page.getByText('Nº da emenda:', { exact: false })
  await expect(numero).toHaveCount(1)
  await expect(numero).toContainText(`Nº da emenda: ${idDaEmenda}`)
  await expect(numero).toContainText('no editor do site')
  await expect(numero).toContainText('ligar uma notícia à emenda')
  await expect(numero).toContainText('só vale depois de a emenda ser publicada')
  await ver(page, info, 'emenda-nova-com-o-numero-para-a-noticia')
  expect(vigia.problemas()).toEqual([])
})

test('o número persiste ao reabrir a página e a emenda em rascunho ainda não está na lista pública', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto(`/parcerias/${idDaEmenda}`)
  await expect(
    page.getByRole('heading', { name: TITULO_DA_EMENDA, level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await expect(page.getByText('Nº da emenda:', { exact: false })).toContainText(
    `Nº da emenda: ${idDaEmenda}`,
  )

  const lista = await page.request.get(
    `${API_HML}/api/publico/transparencia/parcerias`,
  )
  expect(lista.status()).toBe(200)
  const publicas = (await lista.json()) as Array<{
    id_parceria: number
    tipo_codigo: string
  }>
  expect(
    publicas.some((p) => p.id_parceria === idDaEmenda),
    'a emenda em rascunho não pode estar na lista pública',
  ).toBe(false)
  await ver(page, info, 'emenda-reaberta-com-o-mesmo-numero')
  expect(vigia.problemas()).toEqual([])
})

test('uma parceria que não é emenda (termo de fomento) não mostra o número da emenda', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  idDoTermo = await cadastrar(page, TITULO_DO_TERMO, 'Termo de fomento')
  expect(idDoTermo).not.toBe(idDaEmenda)
  await expect(page.getByText('Termo de fomento').first()).toBeVisible()
  await expect(page.getByText(/Nº da emenda/)).toHaveCount(0)
  await ver(page, info, 'termo-de-fomento-sem-numero-de-emenda')

  // e a emenda, ao lado, continua com o número dela
  await page.goto(`/parcerias/${idDaEmenda}`)
  await expect(
    page.getByRole('heading', { name: TITULO_DA_EMENDA, level: 1 }),
  ).toBeVisible()
  await expect(page.getByText('Nº da emenda:', { exact: false })).toContainText(
    `Nº da emenda: ${idDaEmenda}`,
  )
  await sair(page)
  expect(vigia.problemas()).toEqual([])
})
