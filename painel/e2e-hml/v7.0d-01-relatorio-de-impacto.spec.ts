import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
  type Papel,
} from './apoio'

// v7.0d - O RELATÓRIO DE IMPACTO (RIPD) ANTES DO ALTO RISCO. Pelas telas:
//  1. o 1º VICE-PRESIDENTE vê Privacidade > Relatório de impacto, mas não escreve, não aprova e não suspende (a tela não oferece; o servidor recusa, 403);
//  2. a PRESIDENTE DO CARGO suspende o atendimento social (se estiver liberado), com o motivo: "Novos registros fechados"; num projeto onde ela é da equipe, a tela do prontuário
//     avisa que está fechado e não oferece o registro, e o servidor recusa gravar (409); a biometria e a pontuação aparecem como "ainda não existe";
//  3. ela escreve o rascunho (nasce da proposta do sistema), tenta aprovar sem o parecer do encarregado (recusado), escreve o parecer e aprova: "Liberado";
//     o prontuário volta a oferecer o registro e grava; o PDF abre;
//  4. a Auditoria (lida pelo Presidente) tem a suspensão, o rascunho e a aprovação DESTA rodada, feitos por ela.
// Se o robô parar no meio com o tratamento fechado, ele aprova de novo pela API ao sair (os outros robôs de beneficiários dependem dele aprovado).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(420_000)

const NOME_DO_PROJETO = `Projeto RIPD ${RODADA}`
const ROTA = `${API_HML}/api/privacidade/relatorios-de-impacto`
// o que a 2ª parte deixa para a Auditoria conferir: quem fez, a partir de quando, e se suspendeu nesta rodada
const desta = { idUsuario: 0, desde: '', suspendeu: false }

type Tratamento = {
  codigo: string
  liberado: boolean
  marcador_do_rascunho: string | null
  aprovado: { secoes: Record<string, string> } | null
  suspenso: { secoes: Record<string, string> } | null
}

/** Se a rodada parou com o atendimento social fechado, aprova de novo (texto do último relatório, parecer de teste) para não travar os outros robôs. */
async function deixarAprovado(page: Page, cab: Record<string, string>) {
  const atual = async () =>
    (
      (await (await page.request.get(ROTA, { headers: cab })).json()) as {
        tratamentos: Tratamento[]
      }
    ).tratamentos.find((t) => t.codigo === 'ATENDIMENTO_SOCIAL')!
  const t = await atual()
  if (t.liberado) return
  const base = t.aprovado?.secoes ?? t.suspenso?.secoes ?? {}
  await page.request.put(`${ROTA}/ATENDIMENTO_SOCIAL`, {
    headers: cab,
    data: {
      secoes: {
        ...base,
        parecer_do_encarregado: `De acordo (aprovado de novo ao sair do robô ${RODADA}).`,
      },
      marcador_base: t.marcador_do_rascunho,
    },
  })
  const r = await page.request.post(`${ROTA}/ATENDIMENTO_SOCIAL/aprovar`, {
    headers: cab,
  })
  expect(r.status(), 'aprovar de novo ao sair').toBe(200)
}
const CARTAO = 'Prontuário e encaminhamentos de beneficiários'

async function comoPapel(page: Page, papel: Papel): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, papel)
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

async function abrirRelatorios(page: Page): Promise<Locator> {
  await page.goto('/privacidade/relatorio-de-impacto')
  await expect(
    page.getByRole('heading', { name: 'Relatório de impacto', level: 1 }),
  ).toBeVisible()
  return page.getByRole('region', { name: CARTAO })
}

/** O quadro do prontuário do beneficiário no detalhe do projeto (o mesmo caminho do robô v5.4f-01). */
async function abrirProntuario(page: Page): Promise<Locator> {
  await page.goto('/projetos')
  const item = page
    .locator('div[role="button"][aria-pressed]')
    .filter({ hasText: new RegExp(`^\\s*${NOME_DO_PROJETO}\\s+nº\\s+\\d+`) })
  await item.click()
  const detalhe = page
    .getByRole('heading', { name: NOME_DO_PROJETO, level: 2, exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  const beneficiarios = detalhe.locator(
    'xpath=.//h3[starts-with(normalize-space(.), "Beneficiários")]/../..',
  )
  const cartao = beneficiarios.locator('div.rounded-md.border').first()
  await cartao.getByRole('button', { name: 'Prontuário', exact: true }).click()
  return cartao.locator(
    'xpath=.//p[starts-with(normalize-space(.), "Prontuário de atendimento")]/..',
  )
}

test('o 1º Vice-Presidente vê os relatórios, mas não decide', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'vice_presidente')
  const cartao = await abrirRelatorios(page)
  await expect(cartao).toBeVisible()
  await expect(page.getByRole('button', { name: /rascunho/ })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Aprovar o relatório' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Suspender os novos registros' }),
  ).toHaveCount(0)
  await ver(page, info, 'vice-so-ve-os-relatorios')
  for (const [metodo, rota, corpo] of [
    ['post', 'aprovar', undefined],
    ['post', 'suspender', { motivo: 'tentativa de quem só vê' }],
  ] as const) {
    const r = await page.request[metodo](
      `${API_HML}/api/privacidade/relatorios-de-impacto/ATENDIMENTO_SOCIAL/${rota}`,
      { headers: { Authorization: token }, data: corpo },
    )
    expect(r.status(), rota).toBe(403)
  }
  expect(vigia.problemas()).toEqual([])
})

test('a Presidente do cargo suspende, o prontuário fecha; escreve o rascunho, aprova com o parecer e o prontuário volta', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'cargo_presidente')
  const cab = { Authorization: token }
  desta.desde = new Date(Date.now() - 60_000).toISOString().slice(0, 19)
  try {
    await suspenderEAprovar(page, info, cab)
  } finally {
    await deixarAprovado(page, cab)
  }
  expect(vigia.problemas()).toEqual([])
})

async function suspenderEAprovar(
  page: Page,
  info: TestInfo,
  cab: Record<string, string>,
) {
  // o cenário: um projeto com um beneficiário, ela na equipe (pela API, como a secretaria faria pelas telas de projeto)
  const iso = (d: Date) => d.toISOString().slice(0, 19)
  const agora = new Date()
  const json = async (r: Awaited<ReturnType<Page['request']['post']>>) => {
    expect(r.status(), r.url()).toBe(200)
    return (await r.json()) as Record<string, unknown>
  }
  const projeto = await json(
    await page.request.post(`${API_HML}/projetos/`, {
      headers: cab,
      data: {
        nome_projeto: NOME_DO_PROJETO,
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
      data: { nome_completo: `Beneficiaria RIPD ${RODADA}` },
    }),
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
  desta.idUsuario = Number(eu.id_usuario)
  await json(
    await page.request.post(
      `${API_HML}/api/projetos/${String(projeto.id_projeto)}/equipe`,
      {
        headers: cab,
        data: { id_associado: eu.id_associado, papel: 'COORDENADOR' },
      },
    ),
  )

  // 2. suspender (se uma rodada anterior ou o povoamento deixou aprovado)
  let cartao = await abrirRelatorios(page)
  await expect(
    page
      .getByRole('region', {
        name: 'Biometria (presença por reconhecimento facial)',
      })
      .getByText('Ainda não existe no sistema (v20.3)'),
  ).toBeVisible()
  if (await cartao.getByText('Liberado (relatório aprovado)').isVisible()) {
    await cartao
      .getByRole('button', { name: 'Suspender os novos registros' })
      .click()
    await cartao
      .getByLabel('Motivo da suspensão')
      .fill(`Revisar os riscos (robô v7.0d ${RODADA}).`)
    await cartao.getByRole('button', { name: 'Confirmar a suspensão' }).click()
    await expect(cartao.getByText(/^Suspenso: Revisar os riscos/)).toBeVisible()
    desta.suspendeu = true
  }
  await expect(
    cartao.getByText('Novos registros fechados: sem relatório aprovado'),
  ).toBeVisible()
  await ver(page, info, 'atendimento-social-fechado')

  let prontuario = await abrirProntuario(page)
  await expect(prontuario.getByTestId('prontuario-fechado')).toBeVisible()
  await expect(
    prontuario.getByPlaceholder('Relato do atendimento'),
  ).toHaveCount(0)
  await ver(page, info, 'prontuario-avisa-que-esta-fechado')
  const recusa = await page.request.post(
    `${API_HML}/api/beneficiarios-projeto/${String(vinculo.id_vinculo)}/atendimentos`,
    { headers: cab, data: { relato: 'Tentativa com o tratamento fechado.' } },
  )
  expect(recusa.status()).toBe(409)
  expect(((await recusa.json()) as { detail: string }).detail).toContain(
    'relatório de impacto',
  )

  // 3. rascunho, recusa sem parecer, aprovação
  cartao = await abrirRelatorios(page)
  await cartao
    .getByRole('button', { name: /^(Escrever|Continuar) o rascunho$/ })
    .click()
  const form = cartao.getByRole('form')
  await expect(form.getByLabel(/^Descrição do tratamento/)).not.toHaveValue('')
  await form.getByLabel(/^Parecer do encarregado/).fill('')
  await form.getByRole('button', { name: 'Salvar o rascunho' }).click()
  // aprova o que está SALVO: o botão só aparece com o formulário fechado (depois que o servidor gravou)
  await expect(form).toHaveCount(0)
  await cartao.getByRole('button', { name: 'Aprovar o relatório' }).click()
  await expect(cartao.getByRole('alert')).toContainText(
    'Parecer do encarregado',
  )
  await ver(page, info, 'sem-parecer-recusado')
  await cartao.getByRole('button', { name: 'Continuar o rascunho' }).click()
  await cartao
    .getByRole('form')
    .getByLabel(/^Parecer do encarregado/)
    .fill(
      `De acordo: as medidas cobrem os riscos (parecer de teste ${RODADA}).`,
    )
  await cartao
    .getByRole('form')
    .getByRole('button', { name: 'Salvar o rascunho' })
    .click()
  await expect(cartao.getByRole('form')).toHaveCount(0)
  await cartao.getByRole('button', { name: 'Aprovar o relatório' }).click()
  await expect(cartao.getByText('Liberado (relatório aprovado)')).toBeVisible()
  await ver(page, info, 'atendimento-social-liberado')
  const pdf = await page.request.get(
    `${API_HML}/api/privacidade/relatorios-de-impacto/ATENDIMENTO_SOCIAL/pdf`,
    { headers: cab },
  )
  expect(pdf.status()).toBe(200)
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  prontuario = await abrirProntuario(page)
  await expect(prontuario.getByTestId('prontuario-fechado')).toHaveCount(0)
  await prontuario
    .getByPlaceholder('Relato do atendimento')
    .fill(`Atendimento de teste depois da aprovação (${RODADA}).`)
  await prontuario.getByRole('button', { name: 'Registrar' }).click()
  await expect(prontuario).toContainText(
    `Atendimento de teste depois da aprovação (${RODADA}).`,
  )
  await ver(page, info, 'prontuario-grava-de-novo')
}

test('a Auditoria guarda a suspensão, o rascunho e a aprovação, com quem fez', async ({
  page,
}, info) => {
  const token = await comoPapel(page, 'presidente')
  expect(desta.idUsuario, 'a 2ª parte rodou').toBeGreaterThan(0)
  for (const acao of [
    ...(desta.suspendeu ? ['RIPD_SUSPENSO'] : []),
    'RIPD_RASCUNHO_SALVO',
    'RIPD_APROVADO',
  ]) {
    const r = await page.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=relatorios_de_impacto&acao=${acao}&id_usuario=${desta.idUsuario}&desde=${desta.desde}&por_pagina=50`,
      { headers: { Authorization: token } },
    )
    expect(r.status()).toBe(200)
    const { entradas } = (await r.json()) as {
      entradas: Array<{ id_usuario: number | null }>
    }
    expect(
      entradas.length,
      `${acao} desta rodada na Auditoria`,
    ).toBeGreaterThan(0)
  }
  await page.goto('/auditoria')
  await ver(page, info, 'auditoria')
})
