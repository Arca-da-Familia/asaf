import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  AVISO,
  cadastrarPelaTela,
  campo,
  cpfValido,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
  preencherOTermoDeImagem,
  versaoDoTermo,
} from './apoio'
import { jpegComLocalizacao } from './imagens'

// v5.7d - APAGAR DE VERDADE (decisões do Presidente, 2026-10-15): a foto da Diretoria não fica guardada depois do mandato, e o QR da carteirinha não vale por tempo indeterminado.
//  1. Encerrar um mandato (vacância) apaga a foto da pessoa na hora (arquivo e linha), a tela avisa e a Auditoria guarda o fato sem dado pessoal. O mandato é devolvido ao fim (a Gisele,
//     2ª Tesoureira de teste, volta com um mandato novo, como o v5.4d-04 faz com o Tesoureiro).
//  2. O vencimento natural (que nenhum clique provoca): este roteiro PREPARA uma pessoa nova com um mandato antigo e uma foto; quem a apaga é a rotina do sistema, que o Deploy Homologação roda
//     contra o banco de teste. O v5.7d-02 confere depois da nova publicação.
//  3. O QR da carteirinha novo vale os dias da regra (15), e a regra aparece em Regras do sistema.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const GISELE = 'Gisele Moraes Pinto'
const DIRETORIA = 'Diretoria Executiva'
const CARGO_GISELE = '2º Tesoureiro'
const MARCA_DO_VENCIDO = 'ROBO-V57D-VENCIDO'

type Mandato = {
  id_mandato: number
  id_associado: number
  cargo_codigo: string
  orgao_codigo: string
  vigente: boolean
  ato_origem: string | null
}
type SituacaoDaFoto = {
  foto: { id_foto: number } | null
  aparece_no_site: boolean
}

let autorizacao = ''

const cabecalho = () => ({ Authorization: autorizacao })

async function entrarComoPresidente(page: Page): Promise<void> {
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
}

async function mandatos(page: Page, query = ''): Promise<Mandato[]> {
  const r = await page.request.get(`${API_HML}/api/mandatos/${query}`, {
    headers: cabecalho(),
  })
  expect(r.status()).toBe(200)
  return (await r.json()) as Mandato[]
}

async function situacaoDaFoto(
  page: Page,
  idAssociado: number,
): Promise<SituacaoDaFoto> {
  const r = await page.request.get(
    `${API_HML}/api/mandatos/associados/${idAssociado}/foto-publica`,
    { headers: cabecalho() },
  )
  expect(r.status()).toBe(200)
  return (await r.json()) as SituacaoDaFoto
}

const bloco = (page: Page, nome: string): Locator =>
  page.locator(`section[aria-label^="Foto no site de ${nome}"]`)

const secaoMandatos = (page: Page) =>
  page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Mandatos por órgão e cargo' }),
  })
const linhasDeMandato = (page: Page) =>
  secaoMandatos(page).locator('div.rounded-md')

async function abrirMandatos(page: Page): Promise<void> {
  await page.goto('/governanca/mandatos')
  await expect(
    page.getByRole('heading', { name: 'Mandatos e órgãos' }),
  ).toBeVisible()
  await expect(linhasDeMandato(page).first()).toBeVisible()
  await expect(page.getByText(/^Associado #\d+$/)).toHaveCount(0)
}

async function registrarPelaTela(
  page: Page,
  d: {
    associado: string
    orgao: string
    cargo: string
    inicio: string
    fim?: string
    ato?: string
  },
): Promise<number> {
  await abrirMandatos(page)
  await page
    .getByRole('button', { name: 'Registrar mandato', exact: true })
    .click()
  await expect(page.getByLabel('Órgão', { exact: true })).toBeVisible()
  await escolherPorTexto(
    page.getByLabel('Associado', { exact: true }),
    d.associado,
  )
  await page
    .getByLabel('Órgão', { exact: true })
    .selectOption({ label: d.orgao })
  await page
    .getByLabel('Cargo', { exact: true })
    .selectOption({ label: d.cargo })
  await campo(page, 'Data de início').fill(d.inicio)
  if (d.fim) await campo(page, 'Data de fim previsto (opcional)').fill(d.fim)
  if (d.ato) await campo(page, 'Ato de origem (opcional)').fill(d.ato)
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/mandatos\/$/.test(new URL(r.url()).pathname),
    ),
    page
      .getByRole('button', { name: 'Registrar mandato', exact: true })
      .click(),
  ])
  const texto = await resposta.text()
  expect(resposta.ok(), `registrar mandato foi recusado: ${texto}`).toBe(true)
  return (JSON.parse(texto) as { id_mandato: number }).id_mandato
}

async function enviarFotoPelaTela(b: Locator): Promise<void> {
  await b.getByRole('button', { name: /^(Enviar|Trocar) foto/ }).click()
  const formulario = b.locator('form')
  await formulario.locator('input[type="file"]').setInputFiles({
    name: 'foto.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegComLocalizacao(),
  })
  await formulario
    .getByLabel(
      'Esta pessoa assinou o termo de autorização de uso da imagem dela no site da ASAF',
    )
    .check()
  await preencherOTermoDeImagem(formulario)
  await formulario.getByRole('button', { name: 'Enviar a foto' }).click()
  await expect(formulario.getByRole('status')).toContainText('Foto enviada', {
    timeout: 30_000,
  })
  await expect(b.getByText('Aparece no site', { exact: true })).toBeVisible()
}

test.afterAll(async ({ browser }) => {
  // o que NÃO pode ficar mexido: a 2ª Tesoureira de teste sem cargo. Roda até depois de falha.
  const contexto = await browser.newContext({
    baseURL: process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br',
    locale: 'pt-BR',
    timezoneId: 'America/Belem',
  })
  const page = await contexto.newPage()
  try {
    await entrarComoPresidente(page)
    const dela = (await mandatos(page, '?apenas_vigentes=true')).filter(
      (m) => m.cargo_codigo === 'VICE_TESOUREIRO',
    )
    if (dela.length === 0) {
      const hoje = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Belem',
      }).format(new Date())
      await registrarPelaTela(page, {
        associado: GISELE,
        orgao: DIRETORIA,
        cargo: CARGO_GISELE,
        inicio: hoje,
        ato: `Restauro do roteiro v5.7d ${RODADA}: a 2ª Tesoureira de teste estava sem cargo`,
      })
    }
  } finally {
    await contexto.close()
  }
})

test('encerrar o mandato apaga a foto na hora, a tela avisa e a Auditoria guarda o fato sem dado pessoal', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
  const dela = (await mandatos(page, '?apenas_vigentes=true')).find(
    (m) => m.cargo_codigo === 'VICE_TESOUREIRO',
  )
  expect(dela, `${GISELE} tem mandato vigente de 2º Tesoureiro`).toBeDefined()

  // 1. a foto entra pela tela
  await abrirMandatos(page)
  const b = bloco(page, GISELE)
  await expect(b).toBeVisible({ timeout: 30_000 })
  await enviarFotoPelaTela(b)
  const antes = await situacaoDaFoto(page, dela!.id_associado)
  expect(antes.foto, 'a foto foi guardada').not.toBeNull()
  const idFoto = antes.foto!.id_foto
  await ver(page, info, 'foto-da-2a-tesoureira-antes-de-encerrar')

  // 2. o aviso ANTES de encerrar
  const linha = linhasDeMandato(page)
    .filter({ hasText: GISELE })
    .filter({ has: page.getByText('Vigente', { exact: true }) })
    .first()
  await linha.getByRole('button', { name: 'Encerrar mandato' }).click()
  await expect(linha).toContainText(
    'Quem fica sem nenhum mandato tem a foto do site apagada junto',
  )
  await linha.getByLabel('Motivo do encerramento').selectOption('Renúncia')
  await linha
    .getByPlaceholder('Referência do ato (opcional)')
    .fill(`roteiro v5.7d ${RODADA}`)
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/mandatos\/\d+\/encerrar$/.test(new URL(r.url()).pathname),
    ),
    linha.getByRole('button', { name: 'Confirmar encerramento' }).click(),
  ])
  expect(resposta.ok(), await resposta.text()).toBe(true)
  expect(
    ((await resposta.json()) as { foto_apagada: boolean }).foto_apagada,
    'o servidor diz que apagou a foto',
  ).toBe(true)

  // 3. a tela avisa e a foto saiu do sistema (a consulta autenticada mostra que a linha e o arquivo sumiram)
  await expect(
    page
      .locator(AVISO)
      .filter({ hasText: 'A foto desta pessoa no site foi apagada' }),
  ).toBeVisible()
  await ver(page, info, 'mandato-encerrado-e-foto-apagada')
  const depois = await situacaoDaFoto(page, dela!.id_associado)
  expect(depois.foto, 'a foto saiu do sistema').toBeNull()
  const arquivo = await page.request.get(
    `${API_HML}/api/mandatos/associados/${dela!.id_associado}/foto-publica/arquivo`,
    { headers: cabecalho() },
  )
  expect(arquivo.status(), 'e o arquivo também').toBe(404)
  const publica = await page.request.get(
    `${API_HML}/api/publico/diretoria/fotos/${idFoto}`,
  )
  expect(publica.status()).toBe(404)

  // 4. a Auditoria: o fato, quem encerrou o mandato, e nenhum nome
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=fotos_da_diretoria&acao=FOTO_APAGADA_AUTOMATICAMENTE&por_pagina=200`,
    { headers: cabecalho() },
  )
  expect(r.status()).toBe(200)
  const { entradas } = (await r.json()) as {
    entradas: Array<{
      id_registro_afetado: number
      id_usuario: number | null
      dados_depois: string | null
    }>
  }
  const dela1 = entradas.filter((e) => Number(e.id_registro_afetado) === idFoto)
  expect(
    dela1.length,
    'a Auditoria guardou o apagamento',
  ).toBeGreaterThanOrEqual(1)
  expect(dela1[0]!.id_usuario, 'com quem encerrou o mandato').not.toBeNull()
  expect(String(dela1[0]!.dados_depois)).not.toContain('Gisele')
  expect(vigia.problemas()).toEqual([])
})

test('prepara o vencimento natural: pessoa nova com mandato antigo e uma foto, para a rotina do sistema apagar (confere o v5.7d-02)', async ({
  page,
}, info) => {
  await entrarComoPresidente(page)
  const nome = `Robô Vencido ${RODADA}`
  await cadastrarPelaTela(page, {
    nome,
    cpf: cpfValido(Number(String(RODADA).slice(-9))),
    email: `robo.vencido.${RODADA}@homologacao.example.com`,
    forcar: false,
  })

  // um mandato que já terminou (2019 a 2023): no Conselho Fiscal, sem tocar nos três lugares de hoje
  const idMandato = await registrarPelaTela(page, {
    associado: nome,
    orgao: 'Conselho Fiscal',
    cargo: 'Conselheiro Fiscal',
    inicio: '2019-01-01',
    fim: '2023-01-01',
    ato: `${MARCA_DO_VENCIDO} ${RODADA}`,
  })
  const dele = (await mandatos(page, '?apenas_vigentes=false')).find(
    (m) => m.id_mandato === idMandato,
  )
  expect(dele, 'o mandato antigo foi registrado').toBeDefined()
  expect(dele!.vigente, 'e já não está vigente').toBe(false)

  // não há tela para subir foto de quem não tem mandato vigente (o bloco só aparece em mandato vigente): a foto vai pela rota, como a tela faria
  const r = await page.request.post(
    `${API_HML}/api/mandatos/associados/${dele!.id_associado}/foto-publica`,
    {
      headers: cabecalho(),
      multipart: {
        autorizacao_imagem: 'true',
        // v7.1b: o termo que a pessoa assinou (a versão em vigor) e como
        meio: 'termo_em_papel',
        assinado_em: new Date().toISOString().slice(0, 10),
        versao_do_termo: await versaoDoTermo(
          page,
          cabecalho().Authorization,
          'foto_da_diretoria',
        ),
        arquivo: {
          name: 'foto.jpg',
          mimeType: 'image/jpeg',
          buffer: jpegComLocalizacao(),
        },
      },
    },
  )
  expect(r.status(), await r.text()).toBe(201)
  const situacao = await situacaoDaFoto(page, dele!.id_associado)
  expect(situacao.foto, 'a foto está guardada').not.toBeNull()
  expect(
    situacao.aparece_no_site,
    'mas não aparece no site (sem mandato vigente)',
  ).toBe(false)
  await ver(page, info, 'pessoa-com-mandato-vencido-e-foto-guardada')
})

test('o QR da carteirinha novo vale os dias da regra (15) e a regra aparece em Regras do sistema', async ({
  page,
}, info) => {
  await entrarComoPresidente(page)
  const presidente = (
    await mandatos(
      page,
      '?apenas_vigentes=true&orgao_codigo=DIRETORIA_EXECUTIVA',
    )
  ).find((m) => m.cargo_codigo === 'PRESIDENTE')
  expect(presidente).toBeDefined()

  const r = await page.request.get(
    `${API_HML}/api/associados/${presidente!.id_associado}/carteirinha`,
    { headers: cabecalho() },
  )
  expect(r.status(), await r.text()).toBe(200)
  const { token } = (await r.json()) as { token: string }
  const carga = JSON.parse(
    Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'),
  ) as { iat: number; exp: number }
  expect(carga.exp - carga.iat, 'o QR novo vale 15 dias, não 365').toBe(
    15 * 86400,
  )
  const verificacao = await page.request.get(
    `${API_HML}/carteirinha/verificar/${token}`,
  ) // pública: sem login
  expect(verificacao.status()).toBe(200)
  const textoDaVerificacao = await verificacao.text()
  const corpo = JSON.parse(textoDaVerificacao) as {
    valido: boolean
    valido_ate: string
    foto: string | null
  }
  expect(corpo.valido).toBe(true)
  // a foto do cadastro não sai pelo endereço aberto (`/uploads/...`): sai por uma rota que confere o QR a cada pedido
  expect(textoDaVerificacao).not.toContain('/uploads/')
  expect(
    corpo.foto === null ||
      corpo.foto === `/carteirinha/verificar/${token}/foto`,
  ).toBe(true)
  if (corpo.foto !== null) {
    const foto = await page.request.get(`${API_HML}${corpo.foto}`)
    expect(foto.status()).toBe(200)
  }
  const dias = (Date.parse(corpo.valido_ate) - Date.now()) / 86400_000
  expect(dias).toBeGreaterThan(14.5)
  expect(dias).toBeLessThanOrEqual(15)

  // a regra está na tela, no padrão de fábrica
  await page.goto('/regras')
  await expect(
    page.getByRole('heading', { name: 'Regras do sistema', level: 1 }),
  ).toBeVisible()
  const linhaDaRegra = page.getByRole('listitem', {
    name: 'DIAS_VALIDADE_CARTEIRINHA',
  })
  await expect(linhaDaRegra).toBeVisible({ timeout: 30_000 })
  await expect(linhaDaRegra.getByRole('spinbutton')).toHaveValue('15')
  await ver(page, info, 'regras-com-a-validade-da-carteirinha')
})
