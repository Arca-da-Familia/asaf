import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  ataAssinadaDeAssembleiaRealizada,
  entrar,
  exigirHomologacao,
  sair,
  ver,
  vigiar,
} from './apoio'

// v6.3a - A ATA NO SITE, EM TEXTO, E QUEM APROVOU (parte 1: prepara). Pelas telas:
//  1. o Presidente abre uma ata ASSINADA da homologação e clica "Publicar no site (em texto)": abre o documento com o texto da ata, sem a opção de PDF;
//  2. um CPF no texto é RECUSADO pelo verificador (o achado vem mascarado); com o texto limpo passa e vai para revisão;
//  3. o Secretário (outra pessoa, pelo cargo) aprova: na API pública o documento diz quem aprovou, nome e "1º Secretário";
//  4. uma segunda versão (a correção) parte do texto já publicado e também é aprovada: as duas ficam publicadas, no mesmo grupo.
// A parte 2 (v6.3a-02) roda depois de uma nova publicação da homologação, que monta o site de teste com esses dados.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const CPF_DE_MENTIRA = '529.982.247-25'
const RODADA = Date.now()
const TEXTO_LIMPO = `Ata de teste para o site (rodada ${RODADA}). Reuniram-se os associados na sede da ASAF e a Assembleia aprovou por maioria o que estava na pauta. Nada mais havendo, encerrou-se a sessão.`
let idAta = 0
let idAssembleia = 0
let v1 = 0
let v2 = 0

async function comToken(page: Page): Promise<() => string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  return () => autorizacao
}

const secaoPublica = (page: Page) =>
  page.getByRole('region', { name: 'Versão pública (a que pode ir ao site)' })

async function enviarTexto(page: Page, texto: string) {
  await secaoPublica(page).getByLabel('Texto da ata para o site').fill(texto)
  await secaoPublica(page)
    .getByRole('button', { name: 'Enviar o texto e conferir' })
    .click()
}

async function prepararPelaAta(page: Page): Promise<number> {
  await page.goto(`/governanca/${idAssembleia}/ata?ata=${idAta}`)
  await page
    .getByRole('button', { name: 'Publicar no site (em texto)' })
    .click()
  await expect(page).toHaveURL(/\/documentos\/\d+$/)
  return Number(/\/documentos\/(\d+)$/.exec(page.url())![1])
}

async function aprovarComOSecretario(page: Page, id: number) {
  await sair(page)
  await entrar(page, 'secretario')
  await page.goto(`/documentos/${id}`)
  await page.getByRole('button', { name: 'Aprovar a publicação' }).click()
  await page.getByRole('button', { name: 'Confirmar aprovação' }).click()
  await expect(
    page.getByText('Publicado no site de transparência.'),
  ).toBeVisible()
}

test('a ata assinada abre o documento do site com o texto da ata, sem PDF; CPF é recusado; o Secretário aprova e o público vê quem aprovou', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const assinada = await ataAssinadaDeAssembleiaRealizada(page, token())
  idAta = assinada.id_ata
  idAssembleia = assinada.id_assembleia

  v1 = await prepararPelaAta(page)
  await expect(
    secaoPublica(page).getByText(/A ata vai ao site só em texto/),
  ).toBeVisible()
  // nenhuma opção de PDF; o texto vem preenchido (o da ata ou, se a ata já foi ao site antes, o da última versão)
  await expect(
    secaoPublica(page).getByText('Enviar a versão pública (PDF)'),
  ).toHaveCount(0)
  await expect(
    secaoPublica(page).getByLabel('Texto da ata para o site'),
  ).not.toHaveValue('')
  await ver(page, info, 'o texto da ata chega preenchido')

  // o dado pessoal é recusado (mascarado no resultado)
  await enviarTexto(
    page,
    `${TEXTO_LIMPO} Presente o associado de CPF ${CPF_DE_MENTIRA}.`,
  )
  await expect(page.getByRole('alert').first()).toContainText('NÃO foi aceita')
  await expect(
    page.getByRole('region', {
      name: 'Resultado da conferência da versão pública',
    }),
  ).not.toContainText(CPF_DE_MENTIRA)
  await ver(page, info, 'o cpf e recusado')

  await enviarTexto(page, TEXTO_LIMPO)
  await page.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(
    page.getByText(
      'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).',
    ),
  ).toBeVisible()
  await aprovarComOSecretario(page, v1)
  await ver(page, info, 'aprovado pelo secretario')

  const publico = (await (
    await page.request.get(`${API_HML}/api/publico/transparencia/documentos`)
  ).json()) as Array<{
    id_documento: number
    formato: string
    aprovado_por: { nome: string; cargo: string | null } | null
  }>
  const doSite = publico.find((d) => d.id_documento === v1)
  expect(doSite, 'a ata no público').toBeTruthy()
  expect(doSite!.formato).toBe('TEXTO')
  expect(doSite!.aprovado_por?.cargo).toBe('1º Secretário')
  expect(doSite!.aprovado_por?.nome).toBeTruthy()
  const texto = (await (
    await page.request.get(
      `${API_HML}/api/publico/transparencia/documentos/${v1}`,
    )
  ).json()) as { texto: string }
  expect(texto.texto).toBe(TEXTO_LIMPO)
  expect(vigia.problemas()).toEqual([])
})

test('a correção vira a versão 2, parte do texto publicado, e a versão 1 continua publicada no mesmo grupo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  expect(v1, 'o teste anterior').toBeGreaterThan(0)
  await entrar(page, 'presidente')
  v2 = await prepararPelaAta(page)
  expect(v2).not.toBe(v1)
  await expect(
    secaoPublica(page).getByLabel('Texto da ata para o site'),
  ).toHaveValue(TEXTO_LIMPO)
  await enviarTexto(
    page,
    `${TEXTO_LIMPO} Retificação de teste: a sessão foi encerrada às dezoito horas.`,
  )
  await page.getByRole('button', { name: 'Enviar para revisão' }).click()
  await aprovarComOSecretario(page, v2)
  await ver(page, info, 'a versao 2 aprovada')

  const publico = (await (
    await page.request.get(`${API_HML}/api/publico/transparencia/documentos`)
  ).json()) as Array<{
    id_documento: number
    versao: number
    vigente: boolean
    grupo_versao: string
  }>
  const a = publico.find((d) => d.id_documento === v1)!
  const b = publico.find((d) => d.id_documento === v2)!
  expect(a.grupo_versao).toBe(b.grupo_versao)
  expect(a.vigente).toBe(false)
  expect(b.vigente).toBe(true)
  expect(b.versao).toBe(a.versao + 1)
  expect(vigia.problemas()).toEqual([])
})
