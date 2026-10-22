import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v6.3c - O RELATÓRIO ANUAL DE ATIVIDADES (parte 1: monta e aprova). Decisão do Presidente: o sistema monta os números do ano, a secretaria escreve a
// apresentação e o Presidente ou o Secretário (outra pessoa) aprova. Pelas telas:
//  1. o Secretário, em Documentos: o ano corrente e um ano anterior ao início do sistema são recusados (na homologação, o início fictício é 02/01/2025);
//     ele monta o relatório do ano passado (numa rodada seguinte, a versão nova pede confirmação);
//  2. a única parte escrita é a apresentação: com um CPF é recusada (mascarada, e nada fica gravado); o Presidente escreve a boa;
//  3. o Secretário envia; o Presidente, que ESCREVEU a apresentação, não tem o botão de aprovar e a API recusa; a Presidente do cargo (outra pessoa) aprova;
//     a Auditoria guarda quem escreveu e a API pública passa a ter o relatório com a apresentação.
// A parte 2 (v6.3c-02) roda depois de uma nova publicação da homologação (o site de teste lê a API no build).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(400_000)

const ANO = new Date().getFullYear() - 1
const APRESENTACAO = `Relatório de teste do robô v6.3c (${RODADA}): um ano de oficinas, de eventos com a comunidade e de voluntariado.`
const CPF_DE_MENTIRA = '529.982.247-25'

function comToken(page: Page): () => string {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  return () => autorizacao
}

async function blocoDoRelatorio(page: Page, ano: number) {
  await page.goto('/documentos')
  const bloco = page.getByRole('region', {
    name: 'Relatório anual de atividades',
  })
  await bloco.getByLabel('Ano do relatório').fill(String(ano))
  await expect(bloco.getByRole('status')).toContainText(`${ano}`)
  return bloco
}

test('o ano corrente e o anterior ao sistema são recusados; o relatório é montado, quem escreve não aprova e outra pessoa aprova', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = comToken(page)

  // 1. as recusas da tela e a montagem, pelo Secretário
  await entrar(page, 'secretario')
  let bloco = await blocoDoRelatorio(page, ANO + 1)
  await expect(bloco.getByRole('status')).toContainText('ainda não acabou')
  await expect(
    bloco.getByRole('button', { name: 'Montar o relatório do ano' }),
  ).toBeDisabled()
  bloco = await blocoDoRelatorio(page, 2024)
  await expect(bloco.getByRole('status')).toContainText(
    'só tem registros desde 02/01/2025',
  )
  await expect(
    bloco.getByRole('button', { name: 'Montar o relatório do ano' }),
  ).toBeDisabled()
  await ver(page, info, 'ano anterior ao sistema recusado')

  bloco = await blocoDoRelatorio(page, ANO)
  // uma rodada anterior que parou em revisão: a Presidente do cargo devolve (recusa com motivo) e a rodada continua
  if ((await bloco.getByRole('status').innerText()).includes('em revisão')) {
    const id = await bloco
      .getByRole('button', { name: 'Abrir o relatório deste ano' })
      .click()
      .then(() => /\/documentos\/(\d+)$/.exec(page.url())?.[1])
    await sair(page)
    await entrar(page, 'cargo_presidente')
    await page.goto(`/documentos/${id}`)
    await page.getByRole('button', { name: 'Recusar' }).click()
    await page
      .getByLabel(/Por que a publicação foi recusada/)
      .fill('Rodada anterior do robô interrompida: volta ao rascunho.')
    await page.getByRole('button', { name: 'Confirmar recusa' }).click()
    await sair(page)
    await entrar(page, 'secretario')
    bloco = await blocoDoRelatorio(page, ANO)
  }
  const versaoNova = bloco.getByRole('button', {
    name: 'Preparar uma versão nova do relatório',
  })
  const deNovo = bloco.getByRole('button', {
    name: 'Montar os números de novo',
  })
  if (await versaoNova.count()) {
    await versaoNova.click()
    await bloco
      .getByRole('button', { name: 'Confirmar a versão nova do relatório' })
      .click()
  } else if (await deNovo.count()) await deNovo.click()
  else
    await bloco
      .getByRole('button', { name: 'Montar o relatório do ano' })
      .click()
  await expect(page).toHaveURL(/\/documentos\/\d+$/)
  const idDocumento = Number(/\/documentos\/(\d+)$/.exec(page.url())![1])
  const gerado = page.getByRole('region', { name: 'Gerado pelo sistema' })
  await expect(gerado).toBeVisible()
  await expect(page.getByText('Ou cole o texto da versão pública')).toHaveCount(
    0,
  )
  await expect(
    page.getByRole('button', { name: 'Criar nova versão' }),
  ).toHaveCount(0)

  // 2. a apresentação com CPF é recusada (mascarada)
  const campo = gerado.getByLabel(/^Apresentação da diretoria/)
  await campo.fill(`${APRESENTACAO} Contato: CPF ${CPF_DE_MENTIRA}.`)
  await gerado.getByRole('button', { name: 'Salvar a apresentação' }).click()
  await expect(page.getByRole('alert').first()).toContainText(
    'A apresentação tem dado pessoal',
  )
  await expect(
    page.getByRole('region', {
      name: 'Resultado da conferência da versão pública',
    }),
  ).not.toContainText(CPF_DE_MENTIRA)
  await ver(page, info, 'o cpf na apresentacao e recusado')
  await sair(page)

  // ... e o Presidente escreve a boa
  await entrar(page, 'presidente')
  await page.goto(`/documentos/${idDocumento}`)
  const campoDoPresidente = page
    .getByRole('region', { name: 'Gerado pelo sistema' })
    .getByLabel(/^Apresentação da diretoria/)
  await campoDoPresidente.fill(APRESENTACAO)
  await page.getByRole('button', { name: 'Salvar a apresentação' }).click()
  await expect(page.getByText(/alteração ainda não salva/)).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await ver(page, info, 'a apresentacao salva')
  await sair(page)

  // 3. o Secretário envia; quem escreveu não aprova
  await entrar(page, 'secretario')
  await page.goto(`/documentos/${idDocumento}`)
  await page.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(
    page.getByText(
      'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).',
    ),
  ).toBeVisible()
  await sair(page)

  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  await page.goto(`/documentos/${idDocumento}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Aprovar a publicação' }),
  ).toHaveCount(0)
  const recusada = await page.request.post(
    `${API_HML}/api/documentos/${idDocumento}/aprovar`,
    { headers: { Authorization: token() } },
  )
  expect(recusada.status()).toBe(403)
  expect(await recusada.text()).toContain('escreveu a apresentação')
  await ver(page, info, 'quem escreveu nao tem o botao de aprovar')
  // a Auditoria guarda quem escreveu (e o SHA-256 do que escreveu)
  const { entradas } = (await (
    await page.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=documentos_institucionais&acao=APRESENTACAO_ESCRITA&por_pagina=50`,
      { headers: { Authorization: token() } },
    )
  ).json()) as {
    entradas: Array<{
      id_registro_afetado: number
      dados_depois: string | null
    }>
  }
  const daApresentacao = entradas.find(
    (e) => e.id_registro_afetado === idDocumento,
  )
  expect(daApresentacao, 'a apresentação escrita na Auditoria').toBeTruthy()
  expect(String(daApresentacao!.dados_depois)).toContain('sha256')
  await sair(page)

  // a Presidente do cargo (outra pessoa, com a permissão de aprovar) aprova
  await entrar(page, 'cargo_presidente')
  await page.goto(`/documentos/${idDocumento}`)
  await page.getByRole('button', { name: 'Aprovar a publicação' }).click()
  await page.getByRole('button', { name: 'Confirmar aprovação' }).click()
  await expect(
    page.getByText('Publicado no site de transparência.'),
  ).toBeVisible()
  await ver(page, info, 'o relatorio anual aprovado para o site')

  const relatorios = (await (
    await page.request.get(
      `${API_HML}/api/publico/transparencia/relatorios-anuais`,
    )
  ).json()) as Array<{
    ano: number
    id_documento: number
    dados: { apresentacao: string; registros_desde: string | null }
  }>
  const doAno = relatorios.find((r) => r.ano === ANO)
  expect(doAno, 'o relatório do ano no público').toBeTruthy()
  expect(doAno!.id_documento).toBe(idDocumento)
  expect(doAno!.dados.apresentacao).toBe(APRESENTACAO)
  const texto = (
    (await (
      await page.request.get(
        `${API_HML}/api/publico/transparencia/documentos/${idDocumento}`,
      )
    ).json()) as { texto: string }
  ).texto
  expect(texto).toContain(APRESENTACAO)
  expect(texto).not.toContain(CPF_DE_MENTIRA)
  expect(vigia.problemas()).toEqual([])
})
