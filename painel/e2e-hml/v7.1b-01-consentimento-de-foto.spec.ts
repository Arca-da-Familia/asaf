import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  fotoDeTeste,
  preencherOTermoDeImagem,
  RODADA,
  ver,
  versaoDoTermo,
  vigiar,
} from './apoio'

// v7.1b - O CONSENTIMENTO DE FOTO COM O TERMO E A VERSÃO. Pelas telas:
//  1. o PRESIDENTE abre um evento (Interno, criado agora) e envia uma foto: o formulário mostra o termo de autorização de imagem em vigor (com o PDF para
//     assinar), pede quem autorizou e como; a foto aparece com "Autorizado por ... · termo versão N"; a versão velha do termo e a falta de quem são recusadas;
//  2. ele apaga a foto dizendo que a pessoa retirou a autorização, com o motivo: Privacidade > Consentimentos mostra o consentimento REVOGADO, com o motivo, e
//     "Ler o aviso desta versão" abre o termo que a pessoa assinou;
//  3. o Tesoureiro (sem a permissão de privacidade) não vê a lista (403), mas lê o termo em vigor.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const TITULO = `Evento do termo de imagem ${RODADA}`
const ALT = `Oficina de teste do termo de imagem ${RODADA}`
const QUEM = `Responsável de teste ${RODADA} (termo em papel)`
const MOTIVO = `A responsável pediu para tirar a foto (${RODADA}).`
let idEvento = 0
let idFoto = 0

async function entrarComToken(
  page: Page,
  papel: Parameters<typeof entrar>[1],
): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, papel)
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

test('o Presidente envia a foto com o termo: quem autorizou, como e a versão ficam registrados', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await entrarComToken(page, 'presidente')
  const inicio = new Date(Date.now() + 15 * 86_400_000)
  const criado = await page.request.post(`${API_HML}/api/eventos/`, {
    headers: { Authorization: token },
    data: {
      titulo: TITULO,
      categoria: 'PALESTRA',
      visibilidade: 'Interna',
      data_hora_inicio: inicio.toISOString().slice(0, 19),
      data_hora_fim: new Date(inicio.getTime() + 2 * 3_600_000)
        .toISOString()
        .slice(0, 19),
    },
  })
  expect(criado.status(), await criado.text()).toBe(200)
  idEvento = ((await criado.json()) as { id_evento: number }).id_evento

  // a rota recusa sem quem autorizou e com a versão velha do termo (a tela confere antes, o servidor de novo)
  const versao = await versaoDoTermo(page, token, 'foto_de_evento')
  const foto = await fotoDeTeste(page, `termo ${RODADA}`)
  const enviarPelaRota = (extra: Record<string, string>) =>
    page.request.post(`${API_HML}/api/eventos/${idEvento}/fotos`, {
      headers: { Authorization: token },
      multipart: {
        arquivo: { name: 'f.jpg', mimeType: 'image/jpeg', buffer: foto },
        alt: ALT,
        autorizacao_imagem: 'true',
        meio: 'termo_em_papel',
        assinado_em: new Date(Date.now() - 86_400_000)
          .toISOString()
          .slice(0, 10),
        quem_autorizou: QUEM,
        versao_do_termo: versao,
        ...extra,
      },
    })
  expect((await enviarPelaRota({ quem_autorizou: '' })).status()).toBe(400)
  const velha = await enviarPelaRota({ versao_do_termo: '1' })
  expect(velha.status()).toBe(422)
  expect(((await velha.json()) as { detail: string }).detail).toContain(
    'recarregue',
  )
  const pdf = await page.request.get(
    `${API_HML}/api/consentimentos/termos/IMAGEM_ATIVIDADE/pdf`,
    { headers: { Authorization: token } },
  )
  expect(pdf.status()).toBe(200)
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // pela tela
  await page.goto(`/eventos?evento=${idEvento}`)
  const contexto = page.getByRole('region', { name: 'Contexto do evento' })
  await expect(contexto).toBeVisible({ timeout: 30_000 })
  const termo = contexto.locator('[data-termo="IMAGEM_ATIVIDADE"]')
  await expect(termo).toContainText(`(versão ${versao})`)
  await termo.getByText('Ler o termo').click()
  await expect(termo).toContainText('um dos pais ou o responsável legal')
  await contexto.locator('input[type="file"]').setInputFiles({
    name: 'oficina.jpg',
    mimeType: 'image/jpeg',
    buffer: foto,
  })
  await contexto
    .getByLabel('Descrição da foto (para quem não enxerga)')
    .fill(ALT)
  await contexto
    .getByRole('checkbox', {
      name: /Todas as pessoas que aparecem na foto assinaram o termo/,
    })
    .check()
  await preencherOTermoDeImagem(contexto, QUEM)
  await ver(page, info, 'formulario-com-o-termo')
  const [enviada] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/eventos/${idEvento}/fotos`,
    ),
    contexto
      .getByRole('button', { name: 'Enviar a foto', exact: true })
      .click(),
  ])
  expect(enviada.status(), await enviada.text()).toBe(201)
  const fotos = (await enviada.json()) as {
    id_foto: number
    alt: string
    consentimento: { titular: string; versao: string; termo: string }
  }[]
  const minha = fotos.find((f) => f.alt === ALT)!
  idFoto = minha.id_foto
  expect(minha.consentimento).toMatchObject({
    titular: QUEM,
    versao,
    termo: 'IMAGEM_ATIVIDADE',
  })
  await expect(
    contexto.locator('[data-consentimento]').filter({ hasText: QUEM }),
  ).toContainText(`termo versão ${versao}`)
  await ver(page, info, 'foto-com-o-consentimento')
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('a pessoa retirou a autorização: apagar revoga o consentimento, que fica como prova em Privacidade > Consentimentos', async ({
  page,
}, info) => {
  expect(idFoto, 'a 1ª parte rodou').toBeGreaterThan(0)
  const token = await entrarComToken(page, 'presidente')
  await page.goto(`/eventos?evento=${idEvento}`)
  const contexto = page.getByRole('region', { name: 'Contexto do evento' })
  await contexto.getByRole('button', { name: `Apagar a foto: ${ALT}` }).click()
  await contexto
    .getByLabel('A pessoa retirou a autorização', { exact: false })
    .check()
  await contexto.getByLabel('Motivo (opcional)').fill(MOTIVO)
  await ver(page, info, 'apagar-pergunta-por-que')
  const [apagada] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' &&
        new URL(r.url()).pathname ===
          `/api/eventos/${idEvento}/fotos/${idFoto}`,
    ),
    contexto
      .getByRole('button', { name: `Confirmar: apagar a foto ${ALT}` })
      .click(),
  ])
  expect(apagada.status()).toBe(200)
  await expect(contexto.getByRole('img', { name: ALT })).toHaveCount(0)

  await page.goto('/privacidade/consentimentos')
  await page.getByLabel('Situação').selectOption('encerrados')
  const linha = page.locator('li').filter({ hasText: QUEM }).first()
  await expect(linha).toContainText('Revogado (a pessoa retirou a autorização)')
  await expect(linha).toContainText(MOTIVO)
  await linha.getByRole('button', { name: 'Ler o aviso desta versão' }).click()
  await expect(linha.getByTestId('aviso-da-versao')).toContainText(
    'Autorização de uso de imagem: fotos das atividades',
  )
  await ver(page, info, 'consentimento-revogado-como-prova')

  const r = await page.request.get(
    `${API_HML}/api/privacidade/consentimentos?situacao=encerrados&origem=foto_de_evento`,
    { headers: { Authorization: token } },
  )
  const { consentimentos } = (await r.json()) as {
    consentimentos: { id_origem: number; encerramento: string }[]
  }
  expect(consentimentos.find((c) => c.id_origem === idFoto)?.encerramento).toBe(
    'revogado',
  )
})

test('o Tesoureiro (sem a permissão de privacidade) lê o termo em vigor, mas não a lista dos consentimentos', async ({
  page,
}) => {
  const token = await entrarComToken(page, 'tesoureiro')
  const termo = await page.request.get(
    `${API_HML}/api/consentimentos/termo-da-tela/foto_da_diretoria`,
    { headers: { Authorization: token } },
  )
  expect(termo.status()).toBe(200)
  const lista = await page.request.get(
    `${API_HML}/api/privacidade/consentimentos`,
    { headers: { Authorization: token } },
  )
  expect(lista.status()).toBe(403)
})
