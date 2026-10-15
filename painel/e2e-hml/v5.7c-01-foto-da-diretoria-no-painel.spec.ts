import { createHash } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  fotoDeTeste,
  ver,
  vigiar,
} from './apoio'
import {
  APARELHO_ESCONDIDO,
  COMENTARIO_ESCONDIDO,
  jpegComLocalizacao,
  lerJpeg,
  metadadosDoJpeg,
} from './imagens'

// v5.7c - a FOTO de quem está na Diretoria e no Conselho, pela tela Mandatos do hml-painel (a Presidente e o Bruno são pessoas inventadas da população de teste). O Presidente do
// sistema sobe a foto SÓ com a autorização de uso de imagem; o servidor a regrava em JPEG sem localização nem dados do aparelho; a API pública a entrega a quem não tem login, com a
// impressão digital certa, só enquanto há mandato vigente; trocar substitui, apagar (a pessoa retirou a autorização) tira do sistema na hora; tudo fica na Auditoria.
// O que o site de teste mostra (depois de uma nova publicação da homologação) é o v5.7c-02. A foto da Ana Lúcia FICA no sistema ao fim (a homologação é para explorar).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const PRESIDENTE = 'Ana Lúcia Ferreira'
const OUTRO = 'Bruno Carvalho Lima'

type FotoPublica = {
  id_foto: number
  alt: string
  sha256: string
  largura: number
  altura: number
  arquivo: string
}
type Dirigente = { nome: string; cargo: string; foto: FotoPublica | null }

const sha = (b: Buffer | Uint8Array) =>
  createHash('sha256').update(b).digest('hex')

async function dirigentes(page: Page): Promise<Dirigente[]> {
  const r = await page.request.get(`${API_HML}/api/publico/diretoria`)
  expect(r.status()).toBe(200)
  return (await r.json()) as Dirigente[]
}

async function dirigente(page: Page, nome: string): Promise<Dirigente> {
  const achado = (await dirigentes(page)).find((d) => d.nome.startsWith(nome))
  expect(achado, `${nome} está na Diretoria pública`).toBeDefined()
  return achado!
}

function bloco(page: Page, nome: string): Locator {
  return page.locator(`section[aria-label^="Foto no site de ${nome}"]`)
}

async function abrirMandatos(page: Page, nome: string): Promise<Locator> {
  await page.goto('/governanca/mandatos')
  const b = bloco(page, nome)
  await expect(b).toBeVisible({ timeout: 30_000 })
  return b
}

/** Abre o formulário do bloco, anexa o arquivo e marca (ou não) a autorização; devolve o formulário. */
async function prepararEnvio(
  b: Locator,
  arquivo: Buffer,
  autorizar: boolean,
): Promise<Locator> {
  await b.getByRole('button', { name: /^(Enviar|Trocar) foto/ }).click()
  const formulario = b.locator('form')
  await formulario.locator('input[type="file"]').setInputFiles({
    name: 'foto.jpg',
    mimeType: 'image/jpeg',
    buffer: arquivo,
  })
  const caixa = formulario.getByLabel(
    'Esta pessoa autorizou o uso da imagem dela no site da ASAF',
  )
  if (autorizar) await caixa.check()
  else await expect(caixa).not.toBeChecked()
  return formulario
}

async function foto(page: Page, nome: string): Promise<Buffer> {
  const d = await dirigente(page, nome)
  expect(d.foto, `${nome} tem foto pública`).not.toBeNull()
  const r = await page.request.get(`${API_HML}${d.foto!.arquivo}`) // SEM login
  expect(r.status()).toBe(200)
  expect(r.headers()['content-type']).toBe('image/jpeg')
  return Buffer.from(await r.body())
}

let autorizacao = ''

test('sem a autorização de imagem a foto não é aceita; com ela aparece, sem localização nem dados do aparelho, e a impressão digital confere', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')

  const antes = (await dirigente(page, PRESIDENTE)).foto
  const b = await abrirMandatos(page, PRESIDENTE)
  await ver(page, info, 'mandatos-com-o-bloco-da-foto')

  // 1. sem marcar a autorização: o painel recusa com a frase combinada e nada muda no sistema
  const sem = await prepararEnvio(b, jpegComLocalizacao(), false)
  await sem.getByRole('button', { name: 'Enviar a foto' }).click()
  await expect(sem.getByRole('alert')).toContainText(
    'Sem a autorização de uso de imagem a foto não é aceita',
  )
  expect((await dirigente(page, PRESIDENTE)).foto?.sha256).toBe(antes?.sha256)
  await ver(page, info, 'recusa-sem-a-autorizacao')

  // 2. com a autorização: a foto entra
  await sem
    .getByLabel('Esta pessoa autorizou o uso da imagem dela no site da ASAF')
    .check()
  await sem.getByRole('button', { name: 'Enviar a foto' }).click()
  await expect(sem.getByRole('status')).toContainText('Foto enviada', {
    timeout: 30_000,
  })
  await expect(b.getByText('Aparece no site', { exact: true })).toBeVisible()
  await ver(page, info, 'foto-enviada-aparece-no-site')

  // 3. a API pública: a foto de quem autorizou, com o texto alternativo do nome e do cargo, e o arquivo SEM login
  const d = await dirigente(page, PRESIDENTE)
  expect(d.foto, 'a Presidente passou a ter foto pública').not.toBeNull()
  expect(Object.keys(d.foto!).sort()).toEqual(
    ['alt', 'altura', 'arquivo', 'id_foto', 'largura', 'sha256'].sort(),
  )
  expect(d.foto!.alt).toBe(`Foto de ${d.nome}, ${d.cargo}`)
  const bytes = await foto(page, PRESIDENTE)
  expect(sha(bytes), 'a impressão digital da API é a do arquivo').toBe(
    d.foto!.sha256,
  )
  // 4. regravada: o que o JPEG de teste escondia (Exif com aparelho e GPS, comentário) não está mais lá
  expect(metadadosDoJpeg(bytes), 'nenhum metadado na foto publicada').toEqual(
    [],
  )
  expect(bytes.includes(Buffer.from(COMENTARIO_ESCONDIDO, 'latin1'))).toBe(
    false,
  )
  expect(bytes.includes(Buffer.from(APARELHO_ESCONDIDO, 'latin1'))).toBe(false)
  const { largura, altura } = lerJpeg(bytes)
  expect([largura, altura]).toEqual([d.foto!.largura, d.foto!.altura])
  expect(vigia.problemas()).toEqual([])
})

test('trocar a foto substitui a anterior (uma só por pessoa) e fica na Auditoria', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  const b = await abrirMandatos(page, PRESIDENTE)
  const antes = (await dirigente(page, PRESIDENTE)).foto!
  const nova = await fotoDeTeste(page, 'troca') // outra imagem, 640x480

  const formulario = await prepararEnvio(b, nova, true)
  await formulario.getByRole('button', { name: 'Enviar a foto' }).click()
  await expect(formulario.getByRole('status')).toContainText('Foto enviada', {
    timeout: 30_000,
  })

  const depois = (await dirigente(page, PRESIDENTE)).foto!
  expect(depois.sha256, 'o conteúdo mudou: é a foto nova').not.toBe(
    antes.sha256,
  )
  expect([depois.largura, depois.altura]).toEqual([640, 480])
  expect(sha(await foto(page, PRESIDENTE))).toBe(depois.sha256)
  expect(
    (await dirigentes(page)).filter((x) => x.nome.startsWith(PRESIDENTE)),
    'a Presidente aparece uma vez só na lista pública',
  ).toHaveLength(1)
  expect(depois.id_foto, 'mesma linha, uma foto por pessoa').toBe(antes.id_foto)

  // a Auditoria (a mesma consulta da tela): envio e troca deixaram linhas, com quem foi
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=fotos_da_diretoria&por_pagina=200`,
    { headers: { Authorization: autorizacao } },
  )
  expect(r.status()).toBe(200)
  const { entradas } = (await r.json()) as {
    entradas: Array<{ acao: string; id_usuario: number | null }>
  }
  const enviadas = entradas.filter((e) => e.acao === 'FOTO_ENVIADA')
  expect(
    enviadas.length,
    'cada envio ficou na Auditoria',
  ).toBeGreaterThanOrEqual(2)
  expect(enviadas.every((e) => e.id_usuario !== null)).toBe(true)
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Tabela').fill('fotos_da_diretoria')
  await expect(
    page.getByRole('cell', { name: 'FOTO_ENVIADA', exact: true }).first(),
  ).toBeVisible({ timeout: 30_000 })
  await ver(page, info, 'auditoria-da-foto-da-diretoria')
})

test('apagar a foto (a pessoa retirou a autorização) pede confirmação e a tira do sistema na hora', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  const b = await abrirMandatos(page, OUTRO)

  const formulario = await prepararEnvio(b, jpegComLocalizacao(), true)
  await formulario.getByRole('button', { name: 'Enviar a foto' }).click()
  await expect(formulario.getByRole('status')).toContainText('Foto enviada', {
    timeout: 30_000,
  })
  const enviada = (await dirigente(page, OUTRO)).foto
  expect(enviada, `${OUTRO} passou a ter foto`).not.toBeNull()
  await formulario.getByRole('button', { name: 'Fechar' }).click()

  // cancelar o diálogo não apaga
  await b.getByRole('button', { name: /^Apagar a foto \(retirou/ }).click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText(`Apagar a foto de ${OUTRO}`)
  await ver(page, info, 'confirmacao-de-apagar-a-foto')
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  expect((await dirigente(page, OUTRO)).foto).not.toBeNull()

  // confirmar apaga: some do sistema e da API pública na hora
  await b.getByRole('button', { name: /^Apagar a foto \(retirou/ }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Apagar a foto', exact: true })
    .click()
  await expect(b.getByText(/^Sem foto/)).toBeVisible({ timeout: 30_000 })
  expect(
    (await dirigente(page, OUTRO)).foto,
    'a API pública não a traz mais',
  ).toBeNull()
  const arquivo = await page.request.get(`${API_HML}${enviada!.arquivo}`)
  expect(arquivo.status(), 'o endereço antigo da foto dá 404').toBe(404)
  await ver(page, info, 'foto-apagada')

  // quem apagou ficou na Auditoria
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=fotos_da_diretoria&acao=FOTO_APAGADA&por_pagina=50`,
    { headers: { Authorization: autorizacao } },
  )
  expect(r.status()).toBe(200)
  const { entradas } = (await r.json()) as { entradas: unknown[] }
  expect(entradas.length).toBeGreaterThanOrEqual(1)
})

test('sem login ninguém envia, vê a foto de cadastro nem apaga; foto que não existe dá 404 igual', async ({
  page,
}) => {
  const rota = `${API_HML}/api/mandatos/associados/1/foto-publica`
  expect((await page.request.get(rota)).status()).toBe(401)
  expect(
    (
      await page.request.post(rota, {
        multipart: {
          autorizacao_imagem: 'true',
          arquivo: {
            name: 'x.jpg',
            mimeType: 'image/jpeg',
            buffer: jpegComLocalizacao(),
          },
        },
      })
    ).status(),
  ).toBe(401)
  expect((await page.request.delete(rota)).status()).toBe(401)
  expect(
    (
      await page.request.get(`${API_HML}/api/publico/diretoria/fotos/99999999`)
    ).status(),
  ).toBe(404)
})
