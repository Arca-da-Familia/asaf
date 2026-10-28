import { expect, test, type Page } from '@playwright/test'

import textos from '../../site/src/data/textos-de-privacidade.json' with { type: 'json' }

import {
  API_HML,
  campo,
  consentimentoPelaRota,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v7.1d - OS PRAZOS QUE FALTAVAM E A ELIMINAÇÃO DO PRONTUÁRIO A PEDIDO. A publicação de teste semeia dado ANTIGO inventado (scripts/hml_dados_antigos_da_retencao.py:
// um evento de 6 anos, um voluntário encerrado, um certificado e uma entrada da Auditoria de 11 anos) e roda a rotina de guarda; aqui se confere, como o Presidente:
//  1. o evento antigo continua com a inscrição e a presença (as contagens), mas a pessoa virou "Pessoa removida (prazo de guarda)";
//  2. o voluntário encerrado ficou com as horas, sem o texto delas;
//  3. o certificado de 11 anos continua VÁLIDO na verificação pública, sem o nome; a tela Documentos emitidos diz que o PDF foi apagado;
//  4. a entrada antiga da Auditoria ficou sem quem, sem IP e sem valores;
//  5. as 5 regras novas estão em Configurações (Regras do sistema);
//  6. a ELIMINAÇÃO do prontuário pela tela: com o consentimento revogado e o protocolo de uma solicitação do titular com a identidade validada, o relato some e o
//     atendimento continua contado; a Auditoria guarda PRONTUARIO_ELIMINADO.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const NOME_APAGADO = 'Pessoa removida (prazo de guarda)'
const MARCADOR = '(texto apagado pelo prazo de guarda)'
const BENEFICIARIA = `Beneficiaria Eliminacao ${RODADA} de Teste`
const RELATO = `Relato inventado ${RODADA} para eliminar.`
let ipDaVez = 0
const novoIp = () => `10.71.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`

async function entrarComToken(page: Page): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

async function lerJson<T>(
  page: Page,
  caminho: string,
  token: string,
): Promise<T> {
  const r = await page.request.get(`${API_HML}${caminho}`, {
    headers: { Authorization: token },
  })
  expect(r.status(), `${caminho}: ${await r.text()}`).toBe(200)
  return (await r.json()) as T
}

type Evento = { id_evento: number; titulo: string }

test('a rotina de guarda agiu no dado antigo: as contagens ficam e a pessoa sai', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await entrarComToken(page)
  const eventos = await lerJson<Evento[]>(page, '/api/eventos/', token)
  const antigos = eventos
    .filter((e) => e.titulo.startsWith('Evento antigo do teste da retenção'))
    .sort((a, b) => b.id_evento - a.id_evento)
  expect(antigos.length, 'a publicação semeou o evento antigo').toBeGreaterThan(
    0,
  )
  const evento = antigos[0]!

  // 1. a inscrição e a presença ficam; a pessoa, não
  const inscritos = await lerJson<
    { nome_pessoa: string | null; status: string }[]
  >(
    page,
    `/api/inscricoes/?contexto_tipo=Evento&id_contexto=${evento.id_evento}`,
    token,
  )
  expect(inscritos).toHaveLength(1)
  expect(inscritos[0]).toMatchObject({
    nome_pessoa: NOME_APAGADO,
    status: 'Presente',
  })
  const presencas = await lerJson<unknown[]>(
    page,
    `/api/presencas/?contexto_tipo=Evento&id_contexto=${evento.id_evento}`,
    token,
  )
  expect(presencas.length, 'a presença continua contada').toBe(1)

  // 2. o voluntário encerrado: a Auditoria diz quem foi anonimizado por isso; as horas ficam, sem o texto
  const { entradas: anonimizados } = await lerJson<{
    entradas: { id_registro_afetado: number; dados_depois: string | null }[]
  }>(
    page,
    '/api/auditoria/?acao=ANONIMIZADO&tabela_afetada=pessoas&por_pagina=100',
    token,
  )
  const doVoluntario = anonimizados.find((e) =>
    (e.dados_depois ?? '').includes('voluntário'),
  )
  expect(
    doVoluntario,
    'a rotina anonimizou o voluntário encerrado',
  ).toBeDefined()
  const horas = await lerJson<{
    total_horas: number
    registros: { descricao_atividade: string | null; horas: number }[]
  }>(
    page,
    `/api/pessoas/${doVoluntario!.id_registro_afetado}/horas-voluntariado`,
    token,
  )
  expect(horas.total_horas).toBeGreaterThan(0)
  expect(horas.registros.every((r) => r.descricao_atividade === MARCADOR)).toBe(
    true,
  )

  // 3. o certificado de 11 anos: válido, sem o nome; a tela diz que o PDF saiu
  const doCertificado = eventos
    .filter((e) =>
      e.titulo.startsWith('Evento antigo do certificado do teste da retenção'),
    )
    .sort((a, b) => b.id_evento - a.id_evento)[0]
  expect(doCertificado).toBeDefined()
  const verificacao = await page.request.get(
    `${API_HML}/certificado/verificar/HMLRETENCAO${doCertificado!.id_evento}`,
  )
  expect(verificacao.status()).toBe(200)
  expect(await verificacao.json()).toMatchObject({
    nome_completo: null,
    nome_retirado: true,
  })
  await page.goto('/documentos-emitidos')
  await expect(page.locator('[data-pdf-apagado]').first()).toBeVisible({
    timeout: 30_000,
  })
  await ver(page, info, 'documentos-emitidos-com-o-pdf-apagado')

  // 4. a Auditoria de 11 anos: sem quem, sem IP, sem valores
  const { entradas } = await lerJson<{
    entradas: { ip_origem: string | null; dados_depois: string | null }[]
  }>(page, '/api/auditoria/?acao=TESTE_DA_RETENCAO&por_pagina=100', token)
  expect(entradas.length).toBeGreaterThan(0)
  for (const e of entradas) {
    expect(e.ip_origem).toBeNull()
    expect(e.dados_depois).toBeNull()
  }

  // 5. as regras novas, editáveis
  const configuracoes = await lerJson<{ chave: string; valor: string }[]>(
    page,
    '/api/configuracoes/',
    token,
  )
  const chaves = new Map(configuracoes.map((c) => [c.chave, c.valor]))
  expect(chaves.get('PRAZO_RETENCAO_INSCRICOES_DIAS')).toBe('1825')
  expect(chaves.get('PRAZO_RETENCAO_PARTICIPANTE_DIAS')).toBe('1825')
  expect(chaves.get('PRAZO_RETENCAO_VOLUNTARIO_DIAS')).toBe('1825')
  expect(chaves.get('PRAZO_RETENCAO_CERTIFICADOS_DIAS')).toBe('3650')
  expect(chaves.get('PRAZO_RETENCAO_AUDITORIA_DIAS')).toBe('3650')
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('o encarregado elimina o prontuário a pedido do titular, pela tela', async ({
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
        nome_projeto: `Projeto da eliminacao ${RODADA}`,
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
      data: {
        nome_completo: BENEFICIARIA,
        data_nascimento: '1990-03-04T00:00:00',
      },
    }),
  )
  await consentimentoPelaRota(page, token, beneficiario.id_beneficiario)
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
      { headers: cab, data: { relato: RELATO } },
    ),
  )
  await json(
    await page.request.post(
      `${API_HML}/api/beneficiarios/${String(beneficiario.id_beneficiario)}/consentimento/revogar`,
      { headers: cab, data: { motivo: `Pedido de teste ${RODADA}.` } },
    ),
  )
  // a solicitação do titular pelo site (pedindo a eliminação) e a identidade validada pela equipe
  const pedido = await page.request.post(
    `${API_HML}/api/publico/atendimentos`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: {
        tipo: 'TITULAR_LGPD',
        subtipo: 'ELIMINACAO',
        cpf: cpfValido(RODADA % 999_999_999),
        nome_completo: BENEFICIARIA,
        email_contato: `eliminacao.${RODADA}@example.com`,
        mensagem:
          'Peço a eliminação do registro do meu atendimento social, por favor.',
        consentimento_lgpd: true,
        versao_texto_consentimento: (
          textos as Record<string, { versao: string }>
        ).ATENDIMENTO_TITULAR!.versao,
      },
    },
  )
  expect(pedido.status(), await pedido.text()).toBe(200)
  const { protocolo } = (await pedido.json()) as { protocolo: string }
  const fila = await lerJson<{
    itens: { id_atendimento: number; protocolo: string }[]
  }>(page, `/api/atendimentos/?busca=${encodeURIComponent(protocolo)}`, token)
  const id = fila.itens.find((a) => a.protocolo === protocolo)!.id_atendimento
  await json(
    await page.request.post(
      `${API_HML}/api/atendimentos/${id}/validar-identidade`,
      {
        headers: cab,
        data: {
          nota: `Conferido por telefone com a pessoa (teste ${RODADA}).`,
        },
      },
    ),
  )

  // pela tela: Beneficiários > Consentimento > Eliminar o prontuário
  await page.goto('/beneficiarios')
  const respondeu = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/beneficiarios/' &&
      new URL(r.url()).searchParams.get('busca') === BENEFICIARIA,
  )
  await campo(page, 'Buscar por nome').fill(BENEFICIARIA)
  await respondeu
  await page
    .getByRole('row')
    .filter({ hasText: BENEFICIARIA })
    .first()
    .getByRole('button', { name: `Consentimento de ${BENEFICIARIA}` })
    .click()
  const bloco = page.getByRole('region', {
    name: `Consentimento do atendimento social de ${BENEFICIARIA}`,
  })
  await bloco
    .getByRole('button', { name: 'Eliminar o prontuário (pedido do titular)' })
    .click()
  await bloco
    .getByLabel('Protocolo da solicitação do titular de dados')
    .fill(protocolo)
  await ver(page, info, 'eliminar-o-prontuario-com-o-protocolo')
  await bloco.getByRole('button', { name: 'Confirmar a eliminação' }).click()
  await expect(bloco.getByRole('status')).toContainText(
    'Prontuário eliminado: 1 relato(s)',
  )
  await ver(page, info, 'prontuario-eliminado')

  // o relato saiu; o atendimento continua contado; a Auditoria guarda
  const atendimentos = await lerJson<{ relato: string }[]>(
    page,
    `/api/beneficiarios-projeto/${String(vinculo.id_vinculo)}/atendimentos`,
    token,
  )
  expect(atendimentos).toHaveLength(1)
  expect(atendimentos[0]!.relato).not.toContain(RELATO)
  const { entradas: eliminacoes } = await lerJson<{
    entradas: { id_registro_afetado: number }[]
  }>(
    page,
    `/api/auditoria/?acao=PRONTUARIO_ELIMINADO&tabela_afetada=beneficiarios`,
    token,
  )
  expect(eliminacoes.map((e) => e.id_registro_afetado)).toContain(
    beneficiario.id_beneficiario,
  )
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})
