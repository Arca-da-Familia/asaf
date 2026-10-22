import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  RODADA,
  entrar,
  exigirHomologacao,
  sair,
  ver,
  vigiar,
} from './apoio'

// Ponto de Revisão FASE 6 (2/2) - as correções dos achados (parte 1: prepara). Pelo Presidente (tem `projetos`, `comunicar` e `documentos`):
//  1. monta um projeto de teste com UMA pessoa na equipe; publica um aviso para o grupo; põe uma SEGUNDA pessoa na equipe; "Incluir quem entrou no grupo
//     depois" mostra a contagem ANTES (1 pessoa) e só inclui com o total visto;
//  2. agenda um aviso para o grupo (agora 2 pessoas) para daqui a 6 minutos e põe uma TERCEIRA pessoa: na hora, o grupo cresceu desde a conferência e o
//     aviso não sai (a parte 2, v6.2-ponto-02, confere depois da nova publicação da homologação, que roda a rotina dos agendados);
//  3. um Balanço digitado à mão na biblioteca não vai para revisão (só o gerado pelo sistema).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(400_000)

const NOME_DO_PROJETO = `Projeto do Ponto FASE 6 ${RODADA}`
const TITULO_AGENDADO = `Agendado do Ponto FASE 6 ${RODADA}`

function comToken(page: Page): () => string {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  return () => autorizacao
}

test('incluir quem entrou depois pede a contagem; o agendado é preparado para o grupo crescer; Balanço à mão não vai ao site', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = comToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const cab = () => ({ headers: { Authorization: token() } })
  const ok = async <T>(r: ReturnType<typeof page.request.get>) => {
    const resposta = await r
    expect(resposta.ok(), await resposta.text()).toBe(true)
    return (await resposta.json()) as T
  }

  // três associados quaisquer da homologação
  const associados = await ok<Array<{ id_associado: number }>>(
    page.request.get(`${API_HML}/api/associados/`, cab()),
  )
  expect(associados.length).toBeGreaterThanOrEqual(3)
  const [a, b, c] = associados.slice(-3).map((x) => x.id_associado)
  const hoje = new Date()
  const { id_projeto } = await ok<{ id_projeto: number }>(
    page.request.post(`${API_HML}/api/projetos/`, {
      ...cab(),
      data: {
        nome_projeto: NOME_DO_PROJETO,
        tipo_foco: 'Social',
        necessita_alvara_bombeiros: false,
        data_inicio: hoje.toISOString().slice(0, 19),
        data_fim_prevista: new Date(hoje.getTime() + 60 * 86_400_000)
          .toISOString()
          .slice(0, 19),
      },
    }),
  )
  const naEquipe = (id: number) =>
    ok(
      page.request.post(`${API_HML}/api/projetos/${id_projeto}/equipe`, {
        ...cab(),
        data: { id_associado: id, papel: 'VOLUNTARIO' },
      }),
    )
  await naEquipe(a)
  const publico = {
    tipo: 'projeto',
    id_projeto,
    partes_do_projeto: ['equipe'],
    situacoes: [],
  }
  const validoAte = new Date(hoje.getTime() + 10 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const corpo = (titulo: string, total: number) => ({
    titulo,
    texto: `Aviso de teste do Ponto de Revisão FASE 6 (${RODADA}): conferência da contagem.`,
    categoria: 'GERAL',
    valido_ate: validoAte,
    exige_confirmacao: false,
    por_email: false,
    publico,
    total_confirmado: total,
  })
  const aviso = await ok<{ id_aviso: number }>(
    page.request.post(`${API_HML}/api/avisos/`, {
      ...cab(),
      data: corpo(`Aviso do Ponto FASE 6 ${RODADA}`, 1),
    }),
  )
  await naEquipe(b)

  // 1. incluir quem entrou: a contagem vem ANTES
  await page.goto(`/comunicacao/${aviso.id_aviso}`)
  await page
    .getByRole('button', { name: 'Incluir quem entrou no grupo depois' })
    .click()
  const conferencia = page.getByRole('group', {
    name: 'Conferir quem será incluído',
  })
  await expect(conferencia).toContainText(
    '1 pessoa entrou no grupo depois da publicação',
  )
  await ver(page, info, 'a contagem antes de incluir')
  // o servidor recusa um total que não é o conferido
  const errado = await page.request.post(
    `${API_HML}/api/avisos/${aviso.id_aviso}/incluir-novos`,
    { ...cab(), data: { total_confirmado: 9 } },
  )
  expect(errado.status()).toBe(409)
  await conferencia.getByRole('button', { name: 'Incluir 1 pessoa' }).click()
  await expect(page.getByText('1 pessoa incluída.')).toBeVisible()

  // 2. agenda para o grupo de agora (2 pessoas) e o grupo cresce antes da hora
  const daqui6min = new Date(Date.now() + 6 * 60_000).toISOString()
  const agendado = await ok<{ id_agendado: number; total_conferido: number }>(
    page.request.post(`${API_HML}/api/avisos-agendados/`, {
      ...cab(),
      data: { ...corpo(TITULO_AGENDADO, 2), publicar_em: daqui6min },
    }),
  )
  expect(agendado.total_conferido).toBe(2)
  await naEquipe(c)

  // 3. Balanço digitado à mão: não vai para revisão
  const balanco = await page.request.post(`${API_HML}/api/documentos`, {
    ...cab(),
    multipart: {
      tipo: 'BALANCO',
      titulo: `Balanço digitado à mão ${RODADA}`,
      classificacao: 'Pública',
      publicar_no_site: 'true',
    },
  })
  expect(balanco.status(), await balanco.text()).toBe(200)
  const idBalanco = ((await balanco.json()) as { id_documento: number })
    .id_documento
  const texto = await page.request.post(
    `${API_HML}/api/documentos/${idBalanco}/versao-publica-texto`,
    {
      ...cab(),
      data: {
        texto: `Balanço de teste do robô (${RODADA}), digitado à mão, com receitas e despesas inventadas para provar a recusa.`,
      },
    },
  )
  expect(texto.status(), await texto.text()).toBe(200)
  await page.goto(`/documentos/${idBalanco}`)
  await page.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(page.getByRole('alert').first()).toContainText(
    'só gerado pelo sistema',
  )
  await ver(page, info, 'balanco a mao recusado')
  await sair(page)
  expect(vigia.problemas()).toEqual([])
})
