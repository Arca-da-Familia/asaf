import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import textos from '../../site/src/data/textos-de-privacidade.json' with { type: 'json' }

import {
  API_HML,
  cadastrarPelaTela,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v7.2c - A ENTREGA DO RELATÓRIO DOS DADOS PELA MINHA CONTA (decisões 2 e 11 do Presidente, 2026-10-28). Como o Presidente e como a pessoa:
//  1. uma associada inventada pede, pelo site, o acesso aos dados dela (a identidade nasce validada pelo e-mail do cadastro);
//  2. no painel, o Presidente abre o pedido, confere o relatório que será entregue e só então libera (o botão espera a marca "conferi"); a liberação vai à Auditoria;
//  3. no SITE de homologação, ela entra na Minha conta com o código e baixa o PDF e o arquivo para levar a outro serviço (o arquivo tem o cadastro dela);
//     cada download vai à Auditoria;
//  4. o que tem de ser recusado: outra pessoa (outro e-mail) não baixa o relatório dela; o Tesoureiro (sem a permissão do encarregado) não libera.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const VERSAO_DO_AVISO = (textos as Record<string, { versao: string }>)
  .ATENDIMENTO_TITULAR!.versao
let ipDaVez = 0
const novoIp = () => `10.73.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`
const NOME = `Associada Da Entrega ${RODADA}`
const CPF = cpfValido((RODADA + 74) % 999_999_999)
const EMAIL = `entrega.v72c.${RODADA}@homologacao.example.com`

let protocolo = ''
let idAtendimento = 0

async function entrarComToken(
  page: Page,
  papel: Parameters<typeof entrar>[1] = 'presidente',
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

async function pedirPeloSite(
  page: Page,
  nome: string,
  email: string,
  cpf: string,
): Promise<string> {
  const r = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    headers: { 'X-Forwarded-For': novoIp() },
    data: {
      tipo: 'TITULAR_LGPD',
      subtipo: 'ACESSO',
      mensagem:
        'Quero saber todos os dados que a associação tem sobre mim (teste do robô da v7.2c).',
      nome_completo: nome,
      cpf: cpf.replace(/\D/g, ''),
      email_contato: email,
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO,
    },
  })
  expect(r.status(), await r.text()).toBe(200)
  return ((await r.json()) as { protocolo: string }).protocolo
}

async function sessaoDeVisitante(page: Page, email: string): Promise<string> {
  const codigo = await page.request.post(
    `${API_HML}/api/publico/visitante/codigo`,
    { headers: { 'X-Forwarded-For': novoIp() }, data: { email } },
  )
  expect(codigo.status(), await codigo.text()).toBe(200)
  const { codigo_de_teste } = (await codigo.json()) as {
    codigo_de_teste?: string
  }
  const entrada = await page.request.post(
    `${API_HML}/api/publico/visitante/entrar`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: { email, codigo: codigo_de_teste },
    },
  )
  expect(entrada.status(), await entrada.text()).toBe(200)
  return ((await entrada.json()) as { token: string }).token
}

test('o Presidente confere e libera o relatório pela tela do pedido', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await entrarComToken(page)
  await cadastrarPelaTela(page, { nome: NOME, cpf: CPF, email: EMAIL })
  protocolo = await pedirPeloSite(page, NOME, EMAIL, CPF)

  await page.goto('/atendimentos?situacao=todas')
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  const cartao = page.getByRole('listitem', {
    name: `Atendimento ${protocolo}`,
  })
  await cartao.getByRole('button', { name: 'Abrir' }).click()
  const entrega = cartao.getByRole('region', {
    name: 'Entregar o relatório pela Minha conta',
  })
  await expect(entrega).toBeVisible({ timeout: 30_000 })

  // conferir: o link abre o relatório do próprio pedido, e é nele que se libera
  await entrega
    .getByRole('link', { name: 'Conferir e liberar o relatório' })
    .click()
  const relatorio = page.getByRole('article', { name: 'Relatório dos dados' })
  await expect(relatorio).toContainText(NOME, { timeout: 30_000 })
  await expect(
    relatorio.getByRole('region', { name: 'Dados na tabela atendimentos' }),
  ).toContainText(protocolo)
  idAtendimento = Number(new URL(page.url()).searchParams.get('id_atendimento'))
  expect(idAtendimento).toBeGreaterThan(0)
  const liberacao = relatorio.getByRole('region', {
    name: 'Liberar este relatório na Minha conta',
  })
  const liberar = liberacao.getByRole('button', {
    name: 'Liberar na Minha conta por 15 dias',
  })
  await expect(liberar, 'só libera depois de conferir').toBeDisabled()
  await ver(page, info, 'relatorio-conferido-antes-de-liberar')
  await liberacao
    .getByRole('checkbox', {
      name: 'Conferi o relatório: não há nele dado de outra pessoa',
    })
    .check()
  await liberar.click()
  await expect(liberacao.getByRole('status')).toContainText(
    'Liberado: a pessoa baixa este relatório',
  )
  await ver(page, info, 'relatorio-liberado')

  // de volta ao pedido: o cartão diz até quando vale
  await page.goto('/atendimentos?situacao=todas')
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  await cartao.getByRole('button', { name: 'Abrir' }).click()
  await expect(entrega.locator('[data-liberado-ate]')).toContainText(
    'Liberado: a pessoa baixa',
    { timeout: 30_000 },
  )

  const auditoria = await page.request.get(
    `${API_HML}/api/auditoria/?acao=RELATORIO_DO_TITULAR_LIBERADO&por_pagina=20`,
    { headers: { Authorization: token } },
  )
  const { entradas } = (await auditoria.json()) as {
    entradas: { id_registro_afetado: number; dados_depois: string | null }[]
  }
  const minha = entradas.find((e) => e.id_registro_afetado === idAtendimento)
  expect(minha, 'a liberação ficou na Auditoria').toBeDefined()
  expect(minha!.dados_depois).not.toContain(NOME)
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('ela baixa, pela Minha conta do site, o PDF e o arquivo para levar a outro serviço', async ({
  page,
}, info) => {
  expect(protocolo).not.toBe('')
  await page.goto(`${SITE}/minha-conta/`)
  // a API de teste devolve o código na resposta: o robô o lê do que o próprio site recebeu
  const respostaDoCodigo = page.waitForResponse((r) =>
    r.url().endsWith('/api/publico/visitante/codigo'),
  )
  await page
    .getByLabel(
      'E-mail usado na inscrição, na doação ou no pedido sobre dados pessoais',
    )
    .fill(EMAIL)
  await page
    .getByRole('button', { name: 'Receber o código por e-mail' })
    .click()
  const { codigo_de_teste } = (await (await respostaDoCodigo).json()) as {
    codigo_de_teste?: string
  }
  expect(
    codigo_de_teste,
    'a homologação devolve o código de teste',
  ).toBeTruthy()
  await page.getByLabel('Código de 6 números').fill(codigo_de_teste!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()

  const pedido = page
    .locator('[data-lista="pedidos-do-titular"] > li')
    .filter({ hasText: protocolo })
  const caixa = pedido.locator('[data-p-relatorio]')
  await expect(caixa).toBeVisible({ timeout: 30_000 })
  await expect(caixa.locator('[data-p-relatorio-ate]')).toContainText(
    'Disponível para baixar até',
  )
  await ver(page, info, 'minha-conta-com-o-relatorio')

  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    caixa.getByRole('button', { name: 'Baixar o relatório (PDF)' }).click(),
  ])
  expect(pdf.suggestedFilename()).toBe(`meus-dados-asaf-${protocolo}.pdf`)
  const bytesDoPdf = await readFile((await pdf.path())!)
  expect(bytesDoPdf.subarray(0, 4).toString()).toBe('%PDF')

  const [arquivo] = await Promise.all([
    page.waitForEvent('download'),
    caixa
      .getByRole('button', {
        name: 'Baixar os dados em arquivo (para levar a outro serviço)',
      })
      .click(),
  ])
  expect(arquivo.suggestedFilename()).toBe(`meus-dados-asaf-${protocolo}.json`)
  const corpo = JSON.parse(
    await readFile((await arquivo.path())!, 'utf-8'),
  ) as {
    titular: string
    dados: Record<string, Record<string, unknown>[]>
  }
  expect(corpo.titular).toBe(NOME)
  expect(corpo.dados.pessoas?.[0]?.cpf).toBe(CPF.replace(/\D/g, ''))
  expect(
    corpo.dados.registros_atendimento,
    'o prontuário não vai na portabilidade',
  ).toBeUndefined()
  await expect(caixa.locator('[data-p-relatorio-falha]')).toBeHidden()

  // os dois downloads ficaram na Auditoria (como o Presidente)
  const token = await entrarComToken(page)
  const auditoria = await page.request.get(
    `${API_HML}/api/auditoria/?acao=DOWNLOAD_RELATORIO_DO_TITULAR&por_pagina=50`,
    { headers: { Authorization: token } },
  )
  const { entradas } = (await auditoria.json()) as {
    entradas: { id_registro_afetado: number; dados_depois: string | null }[]
  }
  const formatos = entradas
    .filter((e) => e.id_registro_afetado === idAtendimento)
    .map(
      (e) =>
        (JSON.parse(e.dados_depois ?? '{}') as { formato?: string }).formato,
    )
  expect(formatos).toEqual(expect.arrayContaining(['pdf', 'json']))
})

test('outra pessoa não baixa o relatório dela e o Tesoureiro não libera', async ({
  page,
}) => {
  expect(idAtendimento).toBeGreaterThan(0)
  // a outra pessoa também tem um pedido (sem nenhum vínculo, o código nem é emitido)
  const emailDaOutra = `outra.v72c.${RODADA}@homologacao.example.com`
  await pedirPeloSite(
    page,
    `Outra Pessoa ${RODADA}`,
    emailDaOutra,
    cpfValido((RODADA + 75) % 999_999_999),
  )
  const deOutra = await sessaoDeVisitante(page, emailDaOutra)
  const tentativa = await page.request.get(
    `${API_HML}/api/visitante/pedidos/${encodeURIComponent(protocolo)}/relatorio?formato=pdf`,
    { headers: { Authorization: `Bearer ${deOutra}` } },
  )
  expect(tentativa.status(), 'o pedido é de outro e-mail').toBe(404)
  const semSessao = await page.request.get(
    `${API_HML}/api/visitante/pedidos/${encodeURIComponent(protocolo)}/relatorio?formato=pdf`,
  )
  expect(semSessao.status()).toBe(401)

  const token = await entrarComToken(page, 'tesoureiro')
  const r = await page.request.post(
    `${API_HML}/api/privacidade/titulares/entregas/${idAtendimento}`,
    { headers: { Authorization: token } },
  )
  expect(r.status()).toBe(403)
})
