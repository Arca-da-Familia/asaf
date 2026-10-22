import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  ataAssinadaDeAssembleiaRealizada,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v6.3b - AS CONTAS DO EXERCÍCIO NO SITE (parte 1: prepara). Decisão do Presidente: as contas só vão ao site depois de a Assembleia aprovar e de outra pessoa
// confirmar a publicação; o texto e os números são gerados dos lançamentos. O roteiro:
//  1. o Tesoureiro registra uma receita de competência do ANO PASSADO (o exercício encerrado), o Conselheiro registra o parecer desse ano e o Presidente
//     registra a deliberação de aprovação das contas numa Assembleia de hoje (realizada, ata assinada) - pela API, como o painel faz; a parte nova é a
//     publicação. A Assembleia tem de ser depois do fim do exercício, e os números são os registrados até ela;
//  2. pela tela de Documentos, o Secretário prepara as contas do ano: o documento é GERADO (sem campo de texto nem de arquivo) e vai para revisão;
//  3. o Presidente (outra pessoa) aprova: a API pública passa a ter as contas do ano, com os mesmos totais do texto publicado.
// A parte 2 (v6.3b-02) roda depois de uma nova publicação da homologação (o site de teste lê a API no build).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const ANO = new Date().getFullYear() - 1
const CONTA = `Doações de teste do robô v6.3b (${RODADA})`
let idDocumento = 0

async function comToken(page: Page): Promise<() => string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  return () => autorizacao
}

test('o parecer e a aprovação em ata assinada liberam a preparação; o documento é gerado e o Presidente aprova', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comToken(page)

  // 1a. uma receita de competência do ano passado, numa conta só do robô (para o número dela aparecer nas contas publicadas)
  await entrar(page, 'tesoureiro')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const cab = { headers: { Authorization: token() } }
  const codigo = (sufixo: string) => `R63B${RODADA}${sufixo}`.slice(0, 20)
  const receita = await page.request.post(`${API_HML}/plano-contas/`, {
    ...cab,
    data: {
      codigo_contabil: codigo('R'),
      descricao_conta: CONTA,
      tipo: 'Receita',
    },
  })
  expect(receita.status(), await receita.text()).toBe(200)
  const caixa = await page.request.post(`${API_HML}/plano-contas/`, {
    ...cab,
    data: {
      codigo_contabil: codigo('C'),
      descricao_conta: `Caixa de teste do robô v6.3b (${RODADA})`,
      tipo: 'Ativo',
    },
  })
  expect(caixa.status(), await caixa.text()).toBe(200)
  const titulo = await page.request.post(`${API_HML}/titulos/`, {
    ...cab,
    data: {
      tipo_titulo: 'A Receber',
      id_conta_contabil: (await receita.json()).id_conta,
      descricao: 'Receita de teste do robô v6.3b',
      valor_original: 123.45,
      data_vencimento: new Date(Date.now() + 5 * 86_400_000)
        .toISOString()
        .slice(0, 19),
    },
  })
  expect(titulo.status(), await titulo.text()).toBe(200)
  const baixa = await page.request.post(`${API_HML}/baixar-titulo/`, {
    ...cab,
    data: {
      id_titulo: (await titulo.json()).id_titulo,
      valor_pago: 123.45,
      forma_pagamento: 'Pix',
      id_conta_contabil_contrapartida: (await caixa.json()).id_conta,
      data_competencia: `${ANO}-06-15T12:00:00`,
    },
  })
  expect(baixa.status(), await baixa.text()).toBe(200)
  await sair(page)

  // 1b. o parecer do Conselho Fiscal do ano (o conselheiro tem o cargo pelo mandato)
  await entrar(page, 'conselheiro')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const parecer = await page.request.post(
    `${API_HML}/api/conselho-fiscal/pareceres`,
    {
      headers: { Authorization: token() },
      data: {
        ano_exercicio: ANO,
        tipo: 'Favorável',
        texto: `Contas de teste do exercício ${ANO} conferidas pelo robô, sem ressalvas.`,
      },
    },
  )
  expect(parecer.status(), await parecer.text()).toBe(200)
  await sair(page)

  // 1c. a aprovação das contas numa Assembleia de hoje (depois do fim do exercício), realizada, ata assinada
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const { id_ata: idAta } = await ataAssinadaDeAssembleiaRealizada(
    page,
    token(),
    { nova: true },
  )
  const deliberacao = await page.request.post(
    `${API_HML}/api/atas/${idAta}/deliberacoes`,
    {
      headers: { Authorization: token() },
      data: {
        tipo: 'Aprovação de contas',
        texto: `A Assembleia aprovou as contas do exercício ${ANO} (robô v6.3b).`,
        ano_exercicio: ANO,
      },
    },
  )
  expect(deliberacao.status(), await deliberacao.text()).toBe(200)
  await sair(page)

  // 2. o Secretário prepara pela tela de Documentos
  await entrar(page, 'secretario')
  await page.goto('/documentos')
  const bloco = page.getByRole('region', {
    name: 'Contas do exercício para o site',
  })
  await bloco.getByLabel('Exercício').fill(String(ANO))
  await expect(bloco.getByRole('status')).toContainText(
    `Contas de ${ANO} aprovadas pela Assembleia`,
  )
  await ver(page, info, 'as contas do ano aprovadas pela assembleia')
  // a primeira rodada prepara; numa rodada seguinte as contas do ano já existem: a versão nova pede confirmação (abrir só abre)
  const versaoNova = bloco.getByRole('button', {
    name: 'Preparar uma versão nova',
  })
  const deNovo = bloco.getByRole('button', { name: 'Gerar os números de novo' })
  const preparar = bloco.getByRole('button', {
    name: 'Preparar as contas para o site',
  })
  if (await versaoNova.count()) {
    await versaoNova.click()
    await ver(page, info, 'a versao nova pede confirmacao')
    await bloco.getByRole('button', { name: 'Confirmar a versão nova' }).click()
  } else if (await deNovo.count()) await deNovo.click()
  else if (await preparar.count()) await preparar.click()
  else
    await bloco
      .getByRole('button', { name: 'Abrir as contas deste exercício' })
      .click()
  await expect(page).toHaveURL(/\/documentos\/\d+$/)
  idDocumento = Number(/\/documentos\/(\d+)$/.exec(page.url())![1])
  await expect(
    page.getByRole('region', { name: 'Gerado pelo sistema' }),
  ).toBeVisible()
  await expect(page.getByText('Ou cole o texto da versão pública')).toHaveCount(
    0,
  )
  await expect(page.getByText('Enviar a versão pública (PDF)')).toHaveCount(0)
  await ver(page, info, 'o documento gerado sem campo de texto nem arquivo')
  // nenhuma "Criar nova versão" no gerado: a versão nova é só pela tela de Documentos
  await expect(
    page.getByRole('button', { name: 'Criar nova versão' }),
  ).toHaveCount(0)
  const enviar = page.getByRole('button', { name: 'Enviar para revisão' })
  if (await enviar.count()) await enviar.click()
  await expect(
    page.getByText(
      'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).',
    ),
  ).toBeVisible()
  await sair(page)

  // 3. o Presidente aprova
  await entrar(page, 'presidente')
  await page.goto(`/documentos/${idDocumento}`)
  await page.getByRole('button', { name: 'Aprovar a publicação' }).click()
  await page.getByRole('button', { name: 'Confirmar aprovação' }).click()
  await expect(
    page.getByText('Publicado no site de transparência.'),
  ).toBeVisible()
  await ver(page, info, 'as contas aprovadas para o site')

  const contas = (await (
    await page.request.get(`${API_HML}/api/publico/transparencia/contas`)
  ).json()) as Array<{
    ano: number
    id_documento: number
    dados: {
      total_receitas: string
      resultado: string
      receitas: Array<{ conta: string; valor: string }>
    }
  }>
  const doAno = contas.find((c) => c.ano === ANO)
  expect(doAno, 'as contas do ano no público').toBeTruthy()
  expect(doAno!.id_documento).toBe(idDocumento)
  // a receita do robô está nas contas publicadas (os números não são zero nem de outro corte)
  expect(doAno!.dados.receitas).toContainEqual(
    expect.objectContaining({ conta: CONTA, valor: '123.45' }),
  )
  const texto = (
    (await (
      await page.request.get(
        `${API_HML}/api/publico/transparencia/documentos/${idDocumento}`,
      )
    ).json()) as { texto: string }
  ).texto
  const reais = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
    .format(Number(doAno!.dados.resultado))
    .replace(/\s/g, ' ')
  expect(texto.replace(/\s/g, ' ')).toContain(
    `Resultado do exercício: ${reais}`,
  )
  expect(vigia.problemas()).toEqual([])
})
