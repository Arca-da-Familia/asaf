import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
  type Papel,
} from './apoio'
import { pdfComTexto } from './pdfs'

// v7.0a - O ENCARREGADO PELO TRATAMENTO DE DADOS COM ATO FORMAL E SUBSTITUTO (Resolução CD/ANPD nº 18/2024). Pelas telas:
//  1. o TESOUREIRO (sem `privacidade`) não vê o módulo Privacidade, o endereço dá "sem permissão" e o servidor recusa (403) ver, gerar e anexar;
//  2. o 1º VICE-PRESIDENTE (Bruno, que tem `privacidade` pelo CARGO) VÊ o encarregado (a Presidente do cargo, pelo mandato) e ele mesmo como substituto, mas não
//     gera nem registra (privilégio mínimo: o Vice não troca o ato que o Presidente assinou): a tela não oferece e o servidor recusa (403);
//  3. a PRESIDENTE DO CARGO (Ana Lúcia, `privacidade_gerir` pelo cargo) gera o ato, abre o PDF para imprimir, o arquivo que não é PDF de verdade é recusado,
//     anexa a cópia assinada e o ato passa a vigente; baixa a cópia assinada de volta; o servidor recusa anexar outra cópia num ato que já vale;
//  4. a Auditoria (lida pelo Presidente) tem a geração, a assinatura e o download, cada um com quem fez.
// A recusa "sem mandato de Presidente" não se provoca aqui (encerrar o mandato da Presidente do cargo quebraria os outros roteiros): é provada pela suíte.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

let idDoAto = 0

async function comoPapel(page: Page, papel: Papel): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, papel)
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

function respostaDe(page: Page, metodo: string, caminho: RegExp) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === metodo &&
      caminho.test(new URL(r.url()).pathname),
  )
}

test('o Tesoureiro não tem privacidade: sem o módulo, sem a tela, o servidor recusa', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'tesoureiro')
  await expect(page.getByRole('link', { name: 'Privacidade' })).toHaveCount(0)
  await page.goto('/privacidade')
  await expect(page).toHaveURL(/\/403$/)
  await ver(page, info, 'tesoureiro-sem-a-tela-do-encarregado')
  const cab = { Authorization: token }
  expect(
    (
      await page.request.get(`${API_HML}/api/privacidade/encarregado`, {
        headers: cab,
      })
    ).status(),
  ).toBe(403)
  expect(
    (
      await page.request.post(`${API_HML}/api/privacidade/encarregado/atos`, {
        headers: cab,
      })
    ).status(),
  ).toBe(403)
  expect(
    (
      await page.request.post(
        `${API_HML}/api/privacidade/encarregado/atos/1/assinado`,
        {
          headers: cab,
          multipart: {
            arquivo: {
              name: 'a.pdf',
              mimeType: 'application/pdf',
              buffer: pdfComTexto(['tentativa']),
            },
          },
        },
      )
    ).status(),
  ).toBe(403)
  expect(vigia.problemas()).toEqual([])
})

test('o 1º Vice-Presidente vê pelo cargo, aparece como substituto, mas não gera nem registra', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'vice_presidente')
  await page.getByRole('link', { name: 'Privacidade' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Encarregado de dados' }),
  ).toBeVisible()
  await expect(page.getByTestId('substituto-de-hoje')).toContainText('Bruno')
  await expect(page.getByTestId('so-o-presidente-gera')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Gerar/ })).toHaveCount(0)
  await expect(page.getByLabel('Cópia assinada (PDF, JPG ou PNG)')).toHaveCount(
    0,
  )
  await ver(page, info, 'vice-presidente-so-ve')
  expect(
    (
      await page.request.post(`${API_HML}/api/privacidade/encarregado/atos`, {
        headers: { Authorization: token },
      })
    ).status(),
  ).toBe(403)
  expect(vigia.problemas()).toEqual([])
})

test('a Presidente do cargo gera o ato, abre o PDF, anexa a cópia assinada e o ato passa a valer', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'cargo_presidente')
  await page.getByRole('link', { name: 'Privacidade' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Encarregado de dados' }),
  ).toBeVisible()
  const encarregado = page.getByTestId('encarregado-de-hoje')
  const substituto = page.getByTestId('substituto-de-hoje')
  await expect(encarregado).toContainText('Presidente · mandato de')
  await expect(substituto).toContainText('1º Vice-Presidente · mandato de')
  const nomeDoEncarregado = (
    await encarregado.locator('p.font-semibold').innerText()
  ).trim()
  await ver(page, info, 'quem-e-hoje-pelos-mandatos')

  // gerar: o ato aguarda a assinatura (uma rodada anterior pode ter deixado um ato vigente; o novo vai substituí-lo)
  const gerando = respostaDe(
    page,
    'POST',
    /\/api\/privacidade\/encarregado\/atos$/,
  )
  await page
    .getByRole('button', { name: /^Gerar (o ato de designação|de novo)/ })
    .click()
  expect((await gerando).status()).toBe(200)
  const quadro = page.getByTestId('ato-aguardando-assinatura')
  await expect(quadro).toBeVisible()
  const numero = /Ato nº (\d+)/.exec(
    await quadro.getByRole('heading').innerText(),
  )![1]
  await expect(page.getByTestId('avisos-do-encarregado')).toContainText(
    `O Ato nº ${numero} foi gerado e aguarda a cópia assinada`,
  )
  await quadro.getByText('Ler o texto do ato').click()
  await expect(quadro.locator('pre')).toContainText(
    `ATO Nº ${numero} — DESIGNAÇÃO DO ENCARREGADO PELO TRATAMENTO DE DADOS PESSOAIS`,
  )
  await expect(quadro.locator('pre')).toContainText(nomeDoEncarregado)
  await expect(quadro.locator('pre')).toContainText(
    'Resolução CD/ANPD nº 18, de 16 de',
  )
  await ver(page, info, `ato-${numero}-aguardando-assinatura`)

  // o PDF para imprimir: a chamada responde um PDF de verdade
  const abrindo = respostaDe(
    page,
    'GET',
    /\/api\/privacidade\/encarregado\/atos\/\d+\/pdf$/,
  )
  await quadro
    .getByRole('button', { name: 'Abrir o PDF para imprimir' })
    .click()
  const pdf = await abrindo
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toContain('application/pdf')
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  idDoAto = Number(/atos\/(\d+)\/pdf$/.exec(new URL(pdf.url()).pathname)![1])
  for (const aberta of page.context().pages()) {
    if (aberta !== page) await aberta.close()
  }

  // a cópia assinada: nome de PDF com conteúdo que não é PDF é recusada, e o ato continua aguardando
  const arquivo = quadro.locator('input[type="file"]')
  const registrar = quadro.getByRole('button', {
    name: 'Registrar a assinatura',
  })
  await expect(registrar).toBeDisabled()
  await arquivo.setInputFiles({
    name: `ato-falso-${RODADA}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('isto não é um PDF de verdade'),
  })
  await registrar.click()
  await expect(quadro.getByRole('alert')).toContainText(
    'O conteúdo do arquivo não confere com a extensão informada.',
  )
  await ver(page, info, 'arquivo-que-nao-e-pdf-recusado')

  const copia = pdfComTexto([`Ato ${numero} assinado - robo v7.0a ${RODADA}`])
  await arquivo.setInputFiles({
    name: `ato-${numero}-assinado-${RODADA}.pdf`,
    mimeType: 'application/pdf',
    buffer: copia,
  })
  const anexando = respostaDe(
    page,
    'POST',
    /\/api\/privacidade\/encarregado\/atos\/\d+\/assinado$/,
  )
  await registrar.click()
  expect((await anexando).status()).toBe(200)
  const vigente = page.getByTestId('ato-vigente')
  await expect(vigente.getByRole('heading')).toHaveText(`Ato nº ${numero}`)
  await expect(vigente.getByText('Vigente', { exact: true })).toBeVisible()
  await expect(page.getByTestId('ato-aguardando-assinatura')).toHaveCount(0)
  await expect(page.locator('[data-aviso="SEM_ATO"]')).toHaveCount(0)
  await ver(page, info, `ato-${numero}-vigente`)

  // baixar a cópia assinada de volta: o mesmo arquivo
  const baixando = page.waitForEvent('download')
  await vigente.getByRole('button', { name: 'Baixar a cópia assinada' }).click()
  const download = await baixando
  const caminho = await download.path()
  const { readFileSync } = await import('node:fs')
  expect(readFileSync(caminho).equals(copia)).toBe(true)

  // o servidor recusa outra cópia num ato que já vale
  const deNovo = await page.request.post(
    `${API_HML}/api/privacidade/encarregado/atos/${idDoAto}/assinado`,
    {
      headers: { Authorization: token },
      multipart: {
        arquivo: {
          name: 'outra.pdf',
          mimeType: 'application/pdf',
          buffer: copia,
        },
      },
    },
  )
  expect(deNovo.status()).toBe(409)
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Histórico dos atos' }),
  ).toContainText(nomeDoEncarregado)
  await ver(page, info, 'historico-dos-atos')
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guarda a geração, a assinatura e o download, cada um com quem fez', async ({
  page,
}, info) => {
  expect(idDoAto, 'o teste anterior gerou o ato').toBeGreaterThan(0)
  const token = await comoPapel(page, 'presidente')
  for (const acao of ['ATO_GERADO', 'ATO_ASSINADO', 'ATO_ASSINADO_BAIXADO']) {
    const r = await page.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=atos_do_encarregado&acao=${acao}&por_pagina=200`,
      { headers: { Authorization: token } },
    )
    expect(r.status()).toBe(200)
    const { entradas } = (await r.json()) as {
      entradas: Array<{
        id_registro_afetado: number
        id_usuario: number | null
      }>
    }
    const doAto = entradas.filter((e) => e.id_registro_afetado === idDoAto)
    expect(doAto, `${acao} na Auditoria`).toHaveLength(1)
    expect(doAto[0]!.id_usuario, `${acao}: quem fez`).not.toBeNull()
  }
  await page.goto('/auditoria')
  await ver(page, info, 'auditoria')
})
