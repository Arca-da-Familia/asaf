import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  cadastrarPelaTela,
  campo,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v7.0b - A CLASSIFICAÇÃO DOS DADOS LIGA CONTROLES (o que se vê na homologação):
//  1. o PRESIDENTE cadastra um associado e registra, pela tela, uma licença por motivo de SAÚDE: o histórico mostra "Licença — Saúde"; a Auditoria guarda que a
//     licença foi registrada SEM o motivo (dado sensível; a Auditoria não tem prazo de guarda) e guarda a LEITURA do histórico (quem leu);
//  2. um encaminhamento ao POSTO DE SAÚDE (dado sensível, de beneficiário que pode ser criança): na Auditoria, o registro guarda que houve o encaminhamento,
//     com a rede escondida ("[omitido: dado pessoal sensível]"), e a LEITURA da lista de encaminhamentos fica registrada com quem leu.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(400_000)

const NOME = `Associada Licenca Saude ${RODADA}`
const MASCARA = '[omitido: dado pessoal sensível]'

type Entrada = {
  id_registro_afetado: number | null
  id_usuario: number | null
  dados_depois: string | null
}

async function comToken(page: Page): Promise<() => string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return () => autorizacao
}

async function auditoria(
  page: Page,
  token: string,
  tabela: string,
  acao: string,
): Promise<Entrada[]> {
  const r = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=${tabela}&acao=${acao}&por_pagina=200`,
    { headers: { Authorization: token } },
  )
  expect(r.status()).toBe(200)
  return ((await r.json()) as { entradas: Entrada[] }).entradas
}

async function abrirAuditoriaNaTela(page: Page, tabela: string) {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${tabela}`),
  )
  await campo(page, 'Tabela').fill(tabela)
  await resposta
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
}

test('licença por saúde pela tela: o histórico mostra o motivo, a Auditoria não o guarda e registra quem leu o histórico', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comToken(page)
  await cadastrarPelaTela(page, {
    nome: NOME,
    cpf: cpfValido(700_000_000 + (RODADA % 99_999_999)),
    email: `licenca.saude.${RODADA}@teste.asaf.org.br`,
  })
  await page.getByLabel('Filtrar').fill(String(RODADA))
  await page.getByRole('link', { name: NOME }).click()
  await expect(page.getByRole('heading', { name: NOME })).toBeVisible()
  const idAssociado = Number(/\/associados\/(\d+)/.exec(page.url())![1])

  const lendo = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith(
      `/api/associados/${idAssociado}/historico-situacao`,
    ),
  )
  await page.getByRole('button', { name: 'Situação', exact: true }).click()
  expect((await lendo).status()).toBe(200)
  const retorno = new Date(Date.now() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  await page.getByRole('button', { name: 'Registrar licença' }).click()
  await page.getByLabel('Motivo *').selectOption('SAUDE')
  await page.getByLabel('Retorno previsto *').fill(retorno)
  await page.getByRole('button', { name: 'Confirmar licença' }).click()
  await expect(page.getByTestId('situacao-atual')).toHaveText('Licenciado')
  await expect(page.getByText('Licença — Saúde')).toBeVisible()
  await ver(page, info, 'licenca-por-saude-no-historico')

  const licenca = (
    await auditoria(page, token(), 'associados', 'LICENCA_REGISTRADA')
  ).filter((e) => e.id_registro_afetado === idAssociado)
  expect(licenca, 'a licença está na Auditoria').toHaveLength(1)
  expect(licenca[0]!.dados_depois ?? '').not.toContain('SAUDE')
  expect(licenca[0]!.dados_depois ?? '').not.toContain('motivo')
  const leituras = (
    await auditoria(
      page,
      token(),
      'mudancas_situacao',
      'CONSULTA_HISTORICO_SITUACAO',
    )
  ).filter((e) => e.id_registro_afetado === idAssociado)
  expect(
    leituras.length,
    'a leitura do histórico ficou registrada',
  ).toBeGreaterThanOrEqual(1)
  expect(leituras[0]!.id_usuario).not.toBeNull()
  await abrirAuditoriaNaTela(page, 'mudancas_situacao')
  await expect(
    page
      .getByRole('cell', { name: 'CONSULTA_HISTORICO_SITUACAO', exact: true })
      .first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria-leitura-do-historico')
  expect(vigia.problemas()).toEqual([])
})

test('encaminhamento ao posto de saúde: a Auditoria esconde a rede e registra quem leu a lista', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comToken(page)
  const cab = () => ({ Authorization: token() })
  const api = async (
    metodo: 'get' | 'post',
    caminho: string,
    data?: object,
  ) => {
    const r = await page.request[metodo](`${API_HML}${caminho}`, {
      headers: cab(),
      data,
    })
    expect(r.status(), `${metodo} ${caminho}`).toBe(200)
    return (await r.json()) as Record<string, unknown>
  }
  const agora = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 19)
  const projeto = await api('post', '/projetos/', {
    nome_projeto: `Projeto Encaminhamento ${RODADA}`,
    tipo_foco: 'Assistencial',
    necessita_alvara_bombeiros: false,
    data_inicio: iso(agora),
    data_fim_prevista: iso(new Date(agora.getTime() + 90 * 86_400_000)),
  })
  const beneficiario = await api('post', '/api/beneficiarios/', {
    nome_completo: `Beneficiaria Encaminhamento ${RODADA}`,
  })
  const vinculo = await api('post', '/api/beneficiarios-projeto/', {
    id_beneficiario: beneficiario.id_beneficiario,
    id_projeto: projeto.id_projeto,
    papel: 'ATENDIDO',
    atendimento_por_familia: false,
  })
  const eu = await api('get', '/auth/me')
  await api('post', `/api/projetos/${String(projeto.id_projeto)}/equipe`, {
    id_associado: eu.id_associado,
    papel: 'COORDENADOR',
  })
  const idVinculo = Number(vinculo.id_vinculo)
  const criado = await api(
    'post',
    `/api/beneficiarios-projeto/${idVinculo}/encaminhamentos`,
    {
      tipo_rede: 'POSTO_DE_SAUDE',
      descricao: `Encaminhada para avaliacao (robo v7.0b ${RODADA}).`,
    },
  )
  const lista = await page.request.get(
    `${API_HML}/api/beneficiarios-projeto/${idVinculo}/encaminhamentos`,
    { headers: cab() },
  )
  expect(lista.status()).toBe(200)
  expect(
    ((await lista.json()) as Array<{ tipo_rede: string }>)[0]!.tipo_rede,
    'quem é da equipe lê o encaminhamento',
  ).toBe('POSTO_DE_SAUDE')

  const registro = (
    await auditoria(page, token(), 'encaminhamentos_rede_externa', 'CREATE')
  ).filter((e) => e.id_registro_afetado === criado.id_encaminhamento)
  expect(registro).toHaveLength(1)
  expect(registro[0]!.dados_depois ?? '').toContain(MASCARA)
  expect(registro[0]!.dados_depois ?? '').not.toContain('POSTO_DE_SAUDE')
  const leitura = (
    await auditoria(
      page,
      token(),
      'encaminhamentos_rede_externa',
      'CONSULTA_ENCAMINHAMENTOS',
    )
  ).filter((e) => e.id_registro_afetado === idVinculo)
  expect(leitura).toHaveLength(1)
  expect(leitura[0]!.id_usuario).not.toBeNull()

  await abrirAuditoriaNaTela(page, 'encaminhamentos_rede_externa')
  await expect(
    page
      .getByRole('cell', { name: 'CONSULTA_ENCAMINHAMENTOS', exact: true })
      .first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria-dos-encaminhamentos')
  expect(vigia.problemas()).toEqual([])
})
