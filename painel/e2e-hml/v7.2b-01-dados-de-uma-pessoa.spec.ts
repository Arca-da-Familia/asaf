import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v7.2b - O RELATÓRIO DOS DADOS DE UMA PESSOA (só o encarregado; a Auditoria fica de fora; a leitura fica registrada). Pela tela, como o Presidente:
//  1. monta uma pessoa inventada (beneficiária com o termo e um atendimento, pela API);
//  2. Privacidade > Dados de uma pessoa: busca pelo nome, gera o relatório; aparecem o cadastro, o beneficiário, o prontuário (com o relato) e o consentimento,
//     cada um com para que serve, a base legal, com quem é compartilhado e o prazo; a Auditoria não aparece;
//  3. a leitura fica na Auditoria (sem os valores); o Tesoureiro (sem `privacidade_gerir`) recebe 403.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const NOME = `Titular Do Relatorio ${RODADA}`
const RELATO = `Relato inventado do relatorio ${RODADA}.`

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

let idPessoa = 0

test('o encarregado gera pela tela o relatório de todos os dados de uma pessoa', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await entrarComToken(page)
  const cab = { Authorization: token }
  const json = async (r: Awaited<ReturnType<Page['request']['post']>>) => {
    expect(r.status(), `${r.url()}: ${await r.text()}`).toBe(200)
    return (await r.json()) as Record<string, unknown>
  }
  const iso = (d: Date) => d.toISOString().slice(0, 19)
  const agora = new Date()
  const projeto = await json(
    await page.request.post(`${API_HML}/projetos/`, {
      headers: cab,
      data: {
        nome_projeto: `Projeto do relatorio ${RODADA}`,
        tipo_foco: 'Assistencial',
        necessita_alvara_bombeiros: false,
        data_inicio: iso(agora),
        data_fim_prevista: iso(new Date(agora.getTime() + 90 * 86_400_000)),
      },
    }),
  )
  const beneficiario = await json(
    await page.request.post(`${API_HML}/api/beneficiarios/`, {
      headers: cab,
      data: { nome_completo: NOME, data_nascimento: '1990-03-04T00:00:00' },
    }),
  )
  const termo = await json(
    await page.request.get(
      `${API_HML}/api/consentimentos/termo-da-tela/beneficiario`,
      { headers: cab },
    ),
  )
  await json(
    await page.request.post(
      `${API_HML}/api/beneficiarios/${String(beneficiario.id_beneficiario)}/consentimento`,
      {
        headers: cab,
        data: {
          dado_por: 'titular',
          nome_responsavel: null,
          vinculo: null,
          meio: 'termo_em_papel',
          id_documento: null,
          assinado_em: new Date(Date.now() - 86_400_000)
            .toISOString()
            .slice(0, 10),
          versao_do_termo: termo.versao,
        },
      },
    ),
  )
  const vinculo = await json(
    await page.request.post(`${API_HML}/api/beneficiarios-projeto/`, {
      headers: cab,
      data: {
        id_beneficiario: beneficiario.id_beneficiario,
        id_projeto: projeto.id_projeto,
        papel: 'ATENDIDO',
        atendimento_por_familia: false,
      },
    }),
  )
  const eu = await json(
    await page.request.get(`${API_HML}/auth/me`, { headers: cab }),
  )
  await json(
    await page.request.post(
      `${API_HML}/api/projetos/${String(projeto.id_projeto)}/equipe`,
      {
        headers: cab,
        data: { id_associado: eu.id_associado, papel: 'COORDENADOR' },
      },
    ),
  )
  await json(
    await page.request.post(
      `${API_HML}/api/beneficiarios-projeto/${String(vinculo.id_vinculo)}/atendimentos`,
      {
        headers: cab,
        data: { relato: RELATO },
      },
    ),
  )

  await page.goto('/privacidade/titulares')
  await expect(
    page.getByRole('heading', { name: 'Dados de uma pessoa', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Nome, CPF ou e-mail do cadastro').fill(NOME)
  await page.getByRole('button', { name: 'Buscar' }).click()
  await page
    .getByRole('button', { name: `Gerar o relatório de ${NOME}` })
    .click()
  const relatorio = page.getByRole('article', { name: 'Relatório dos dados' })
  await expect(relatorio).toContainText(NOME, { timeout: 30_000 })
  idPessoa = Number(new URL(page.url()).searchParams.get('id_pessoa'))
  const prontuario = relatorio.getByRole('region', {
    name: 'Dados na tabela registros_atendimento',
  })
  await expect(prontuario).toContainText(RELATO)
  await expect(prontuario).toContainText('Para que serve:')
  await expect(prontuario).toContainText('Base legal:')
  await expect(prontuario).toContainText('Com quem é compartilhado:')
  await expect(
    relatorio.getByRole('region', { name: 'Dados na tabela consentimentos' }),
  ).toBeVisible()
  await expect(
    relatorio.getByRole('region', { name: 'Dados na tabela pessoas' }),
  ).toBeVisible()
  await expect(
    relatorio.getByRole('region', { name: 'Dados na tabela audit_log' }),
  ).toHaveCount(0)
  await expect(relatorio).toContainText('A Auditoria do sistema')
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible()
  await ver(page, info, 'relatorio-dos-dados-de-uma-pessoa')

  const auditoria = await page.request.get(
    `${API_HML}/api/auditoria/?acao=CONSULTA_RELATORIO_DO_TITULAR&por_pagina=20`,
    { headers: cab },
  )
  const { entradas } = (await auditoria.json()) as {
    entradas: { id_registro_afetado: number; dados_depois: string | null }[]
  }
  const minha = entradas.find((e) => e.id_registro_afetado === idPessoa)
  expect(minha, 'a leitura ficou na Auditoria').toBeDefined()
  expect(minha!.dados_depois).not.toContain(NOME)
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('o Tesoureiro (sem a permissão do encarregado) não gera o relatório', async ({
  page,
}) => {
  expect(idPessoa).toBeGreaterThan(0)
  const token = await entrarComToken(page, 'tesoureiro')
  const r = await page.request.get(
    `${API_HML}/api/privacidade/titulares/relatorio?id_pessoa=${idPessoa}`,
    { headers: { Authorization: token } },
  )
  expect(r.status()).toBe(403)
})
