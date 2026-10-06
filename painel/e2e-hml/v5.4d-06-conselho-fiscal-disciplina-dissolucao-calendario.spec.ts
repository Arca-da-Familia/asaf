import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4d — FASE 2.5 ao vivo, parte 6: Conselho Fiscal, Disciplina, Dissolução e Calendário institucional, pela tela, com a recusa que o sistema
// tem que fazer em cada passo e a Auditoria mostrando a ação.
//
// O que este roteiro SABE do ambiente de teste (lido em scripts/popular_homologacao.py e no servidor, não suposto):
//  - Os três logins são o Presidente (nível "Presidente", SEM mandato), o Secretário (Daniel, cargo SECRETARIO: governança) e o Tesoureiro
//    (Fábio, cargo TESOUREIRO: financeiro). Os 3 membros do Conselho Fiscal e os outros 4 diretores NÃO têm login.
//  - Parecer e questionamento exigem um usuário cujo NÍVEL tenha `is_conselho_fiscal` (app/routers/conselho_fiscal.py). Nenhuma das três
//    contas tem esse nível, então aqui esses dois passos só podem ser conferidos como RECUSA. O caminho de sucesso fica sem cobertura.
//  - Decidir um processo disciplinar exige maioria (metade + 1) dos diretores aptos; só o Secretário tem login E governança entre eles, então o
//    quórum nunca é atingido pela tela: decisão e homologação só são conferidas como recusa / ausência da etapa.
//  - A tela de Dissolução não tem modo "simulação" nem janela de confirmação: aqui só se abre, tenta vincular uma deliberação que não existe e
//    se cancela o processo que o próprio robô abriu (as etapas 2 a 4 só aparecem depois de uma deliberação de dissolução concluída).
//  - O Calendário não tem como cancelar nem remover um evento agendado.
//
// Cada bloco é uma história em ordem (`serial`); o que provavelmente reprova (achado, não erro do roteiro) usa `expect.soft` e fica no último
// teste do bloco, para não pular o que vem depois.
test.beforeAll(() => exigirHomologacao())

const PRESIDENTE = 'Marta Souza'
const SECRETARIO = 'Daniel Ribeiro Costa de Teste'
const TESOUREIRO = 'Fábio Henrique Dias de Teste'
const OUTRO_ASSOCIADO = 'Olívia Campos Vieira de Teste'
const MOTIVO = 'Desídia no desempenho das atividades associativas'

/** Dia (AAAA-MM-DD e dd/mm/aaaa) daqui a `deslocamentoDias`, no relógio de Belém (UTC-3), que é o do navegador do robô. */
function diaEmBelem(deslocamentoDias: number): { iso: string; br: string } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + deslocamentoDias * 86_400_000))
  const [ano, mes, dia] = iso.split('-')
  return { iso, br: `${dia}/${mes}/${ano}` }
}

/** Abre a Auditoria filtrada por tabela e devolve o total de registros dela (lido da resposta da própria tela). */
async function abrirAuditoria(page: Page, tabela: string): Promise<number> {
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
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

/** A linha (mais recente) da Auditoria com a ação, e, se pedido, o registro e quem fez. */
function linhaDaAuditoria(
  page: Page,
  acao: string,
  filtros: { registro?: number; quem?: string } = {},
): Locator {
  let linha = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: acao, exact: true }),
  })
  if (filtros.registro !== undefined) {
    linha = linha.filter({
      has: page.getByRole('cell', {
        name: String(filtros.registro),
        exact: true,
      }),
    })
  }
  if (filtros.quem) linha = linha.filter({ hasText: filtros.quem })
  return linha.first()
}

/** Espera a tela do Conselho Fiscal ter feito as duas leituras auditadas (títulos e razão). */
function leiturasDoConselho(page: Page): Promise<unknown> {
  return Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/api/conselho-fiscal/financeiro/titulos') && r.ok(),
    ),
    page.waitForResponse(
      (r) =>
        r.url().includes('/api/conselho-fiscal/financeiro/caixa') && r.ok(),
    ),
  ])
}

// =====================================================================================================================================
// A. CONSELHO FISCAL (/financeiro/conselho-fiscal — dentro do Financeiro, não da Governança)
// =====================================================================================================================================
test.describe('A. Conselho Fiscal', () => {
  test.describe.configure({ mode: 'serial' })

  const descricaoTitulo = `Despesa de teste do robô ${RODADA}`
  let idTitulo = 0

  test('a leitura do financeiro pelo Conselho Fiscal é auditada: cada consulta aparece na Auditoria, com quem viu', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    const titulosAntes = await abrirAuditoria(page, 'titulos_financeiros')
    const razaoAntes = await abrirAuditoria(page, 'lancamentos_contabeis')

    const leituras = leiturasDoConselho(page)
    await page.goto('/financeiro/conselho-fiscal')
    await leituras
    await expect(
      page.getByRole('heading', { name: 'Conselho Fiscal', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Títulos financeiros (leitura irrestrita)',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Razão contábil (leitura irrestrita)',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Pareceres sobre prestação de contas',
      }),
    ).toBeVisible()
    await expect(
      page.getByText(/Toda consulta aqui é registrada em auditoria/),
    ).toBeVisible()
    // o razão semeado na homologação (emenda de teste) tem que estar à vista do conselho
    await expect
      .soft(
        page
          .getByRole('cell', { name: 'Repasse da 1ª parcela (teste)' })
          .first(),
        'o Conselho Fiscal lê o razão inteiro: o lançamento de teste da emenda deveria aparecer',
      )
      .toBeVisible()
    await ver(page, info, 'conselho fiscal: leitura do financeiro e do razao')

    // a consulta dos títulos e a do razão deixaram rastro, com o nome de quem consultou
    expect(await abrirAuditoria(page, 'titulos_financeiros')).toBeGreaterThan(
      titulosAntes,
    )
    await expect(
      linhaDaAuditoria(page, 'CONSULTA_CONSELHO_FISCAL', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: consulta dos titulos pelo conselho')
    expect(await abrirAuditoria(page, 'lancamentos_contabeis')).toBeGreaterThan(
      razaoAntes,
    )
    await expect(
      linhaDaAuditoria(page, 'CONSULTA_CONSELHO_FISCAL', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: consulta do razao pelo conselho')
    expect(vigia.problemas()).toEqual([])
  })

  test('quem não tem a permissão do financeiro é barrado (Secretário); a consulta da tesouraria também fica registrada', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'secretario')
    await page.goto('/financeiro/conselho-fiscal')
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Títulos financeiros (leitura irrestrita)',
      }),
    ).toHaveCount(0)
    await ver(page, info, 'Secretario barrado no Conselho Fiscal')
    await sair(page)

    await entrar(page, 'tesoureiro')
    const leituras = leiturasDoConselho(page)
    await page.goto('/financeiro/conselho-fiscal')
    await leituras
    await expect(
      page.getByRole('heading', { name: 'Conselho Fiscal', level: 1 }),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro abre o Conselho Fiscal (leitura)')
    await sair(page)

    await entrar(page, 'presidente')
    await abrirAuditoria(page, 'titulos_financeiros')
    await expect(
      linhaDaAuditoria(page, 'CONSULTA_CONSELHO_FISCAL', { quem: TESOUREIRO }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: a consulta do Tesoureiro tambem fica')
    expect(vigia.problemas()).toEqual([])
  })

  test('para haver o que questionar: a tesouraria lança um título (conta do tipo errado e campos vazios são recusados)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'tesoureiro')
    await page.goto('/financeiro/titulos')
    await expect(
      page.getByRole('heading', { name: 'Títulos', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Novo título' }).click()
    await expect(page.getByPlaceholder('Valor original')).toBeVisible()
    const formulario = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Registrar título' }),
    })

    // recusa 1: nada preenchido
    await formulario.getByRole('button', { name: 'Registrar título' }).click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Selecione a conta contábil.' }),
    ).toBeVisible()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Informe a descrição.' }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Informe um valor maior que zero.' }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Informe a data de vencimento.' }),
    ).toBeVisible()
    await ver(page, info, 'titulo vazio: recusado')

    // recusa 2: "A Pagar" numa conta de Ativo (o servidor exige conta de Despesa)
    const contas = formulario.locator('select').nth(1)
    await expect(
      contas.locator('option', { hasText: '(Ativo)' }).first(),
    ).toBeAttached()
    await expect(
      contas.locator('option', { hasText: '(Despesa)' }).first(),
    ).toBeAttached()
    await escolherPorTexto(contas, '(Ativo)')
    await formulario
      .getByPlaceholder('Descrição', { exact: true })
      .fill(descricaoTitulo)
    await formulario.getByPlaceholder('Valor original').fill('123.45')
    await formulario.locator('input[type="date"]').fill(diaEmBelem(20).iso)
    await formulario.getByRole('button', { name: 'Registrar título' }).click()
    await expect(
      formulario
        .getByRole('alert')
        .filter({ hasText: /precisa ser uma conta/ }),
    ).toBeVisible()
    await ver(page, info, 'titulo A Pagar em conta de Ativo: recusado')

    // certo: conta de Despesa
    await escolherPorTexto(contas, '(Despesa)')
    const criado = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/titulos/',
    )
    await formulario.getByRole('button', { name: 'Registrar título' }).click()
    const resposta = await criado
    expect(resposta.status()).toBe(200)
    idTitulo = ((await resposta.json()) as { id_titulo: number }).id_titulo
    await expect(page.getByText(descricaoTitulo)).toBeVisible()
    await ver(page, info, 'titulo lancado pela tesouraria')
    expect(vigia.problemas()).toEqual([])
  })

  test('fila de questionamentos: sem ser do Conselho Fiscal ninguém abre pergunta (o Presidente é recusado), pergunta vazia é recusada e nada entra na fila', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    // a Auditoria registrou o título que a tesouraria lançou
    await abrirAuditoria(page, 'titulos_financeiros')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idTitulo,
        quem: TESOUREIRO,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: titulo lancado pela tesouraria')
    const perguntasAntes = await abrirAuditoria(
      page,
      'questionamentos_lancamento',
    )

    await page.goto('/financeiro/conselho-fiscal')
    const cartao = page
      .locator('div.rounded-md.border')
      .filter({ hasText: descricaoTitulo })
    await expect(cartao).toBeVisible()
    await cartao.getByRole('button', { name: 'Ver questionamentos' }).click()
    await expect(cartao.getByText('Questionamentos (0)')).toBeVisible()
    await cartao
      .getByRole('button', { name: 'Questionar', exact: true })
      .click()

    // recusa 1: pergunta vazia
    await cartao.getByRole('button', { name: 'Enviar questionamento' }).click()
    await expect(cartao.getByRole('alert')).toContainText(
      'Descreva o questionamento.',
    )
    await ver(page, info, 'questionamento vazio: recusado')

    // recusa 2: o servidor só aceita pergunta de quem é do Conselho Fiscal (segregação: quem fiscaliza não é quem lança)
    await cartao
      .getByPlaceholder('O que você quer questionar sobre este lançamento?')
      .fill(`Por que esta despesa de teste ${RODADA} não tem comprovante?`)
    await cartao.getByRole('button', { name: 'Enviar questionamento' }).click()
    await expect(cartao.getByRole('alert')).toContainText(
      'Só um membro do Conselho Fiscal pode fazer isso.',
    )
    await expect(cartao.getByText('Questionamentos (0)')).toBeVisible()
    await ver(
      page,
      info,
      'questionamento recusado: Presidente nao e do conselho',
    )

    // a recusa não deixou nada na fila nem na Auditoria
    expect(await abrirAuditoria(page, 'questionamentos_lancamento')).toBe(
      perguntasAntes,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('"ver como" Conselho Fiscal: a tela abre para quem tem esse nível, mas o modo somente leitura recusa o parecer', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto('/acesso')
    await expect(
      page.getByRole('heading', { name: 'Níveis e permissões' }),
    ).toBeVisible()
    page.once('dialog', (janela) => janela.accept())
    await page.getByRole('button', { name: /Ver como Conselho Fiscal/ }).click()
    const faixa = page.getByRole('status').filter({ hasText: 'Vendo como' })
    await expect(faixa).toContainText('Conselho Fiscal')
    await expect(faixa).toContainText('somente leitura')

    // sem recarregar (o modo "ver como" vive só na memória da página): pelo menu
    await page.getByRole('link', { name: 'Financeiro' }).first().click()
    await page.getByRole('link', { name: 'Conselho Fiscal' }).first().click()
    await expect(
      page.getByRole('heading', { name: 'Conselho Fiscal', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Emitir parecer' }).click()
    await expect(page.getByPlaceholder('Texto do parecer')).toBeVisible()
    await page
      .getByPlaceholder('Texto do parecer')
      .fill(`Parecer de teste do robô ${RODADA}, só para ver a recusa.`)
    await page.getByRole('button', { name: 'Emitir parecer' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'somente leitura' }),
    ).toBeVisible()
    await ver(page, info, 'vendo como Conselho Fiscal: parecer recusado')
    await faixa.getByRole('button', { name: 'Encerrar' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Vendo como' }),
    ).toHaveCount(0)
    expect(vigia.problemas()).toEqual([])
  })

  test('parecer: campos faltando são recusados e o Presidente (que não é do Conselho Fiscal) não consegue emitir; nada é gravado', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const parecer = `Parecer de teste do robô ${RODADA}: contas conferidas, sem ressalvas.`
    await entrar(page, 'presidente')
    const pareceresAntes = await abrirAuditoria(
      page,
      'pareceres_prestacao_contas',
    )
    await page.goto('/financeiro/conselho-fiscal')
    await expect(
      page.getByRole('heading', {
        name: 'Pareceres sobre prestação de contas',
      }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Emitir parecer' }).click()
    await expect(page.getByPlaceholder('Texto do parecer')).toBeVisible()
    const tipos = page.getByLabel('Tipo de parecer')
    await expect(tipos.locator('option')).toHaveText([
      'Favorável',
      'Com ressalva',
      'Contrário',
    ])

    // recusa 1: texto vazio
    await page.getByRole('button', { name: 'Emitir parecer' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Descreva o parecer.' }),
    ).toBeVisible()
    await ver(page, info, 'parecer sem texto: recusado')

    // recusa 2 (achado provável): ano antes de 2013. A tela só liga a mensagem do campo "texto"; o erro do ano fica sem aparecer.
    await page.getByLabel('Ano do exercício').fill('2012')
    await page.getByPlaceholder('Texto do parecer').fill(parecer)
    await page.getByRole('button', { name: 'Emitir parecer' }).click()
    await expect
      .soft(
        page.getByRole('alert').filter({ hasText: /Ano inválido/ }),
        'a recusa do ano (antes de 2013) tem que aparecer na tela: hoje o formulário não mostra o erro do campo ano',
      )
      .toBeVisible({ timeout: 5_000 })
    await ver(page, info, 'parecer com ano antes de 2013')

    // recusa 3 (achado provável): ano depois de 2100 passa na tela e o servidor recusa com 422; a mensagem também precisa aparecer
    await page.getByLabel('Ano do exercício').fill('2101')
    const recusado = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes('/api/conselho-fiscal/pareceres'),
    )
    await page.getByRole('button', { name: 'Emitir parecer' }).click()
    expect((await recusado).status()).toBe(422)
    await expect
      .soft(
        page
          .getByRole('alert')
          .filter({ hasText: /Ano de exercício inválido/ }),
        'a recusa do servidor para o ano (depois de 2100) tem que aparecer na tela',
      )
      .toBeVisible({ timeout: 5_000 })
    await ver(page, info, 'parecer com ano depois de 2100')

    // recusa 4: tudo certo na tela, mas o Presidente não é do Conselho Fiscal (403)
    await page
      .getByLabel('Ano do exercício')
      .fill(String(new Date().getFullYear()))
    await tipos.selectOption('Com ressalva')
    await page.getByRole('button', { name: 'Emitir parecer' }).click()
    await expect(
      page.getByRole('alert').filter({
        hasText: 'Só um membro do Conselho Fiscal pode fazer isso.',
      }),
    ).toBeVisible()
    await expect(page.locator('p').filter({ hasText: parecer })).toHaveCount(0)
    await ver(page, info, 'parecer recusado: Presidente nao e do conselho')

    // nada foi gravado: a Auditoria dos pareceres não cresceu
    expect(await abrirAuditoria(page, 'pareceres_prestacao_contas')).toBe(
      pareceresAntes,
    )
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// B. DISCIPLINA (/governanca/disciplina; o acusado entra por /meus-processos-disciplinares; o detalhe é /processos-disciplinares/:id)
// =====================================================================================================================================
test.describe('B. Disciplina', () => {
  test.describe.configure({ mode: 'serial' })

  const fatos = `Fatos do processo de teste ${RODADA} (inventados pelo robô): faltas seguidas às reuniões.`
  const fatosOutro = `Fatos do OUTRO processo de teste ${RODADA} (inventados pelo robô): este não pode ser lido por quem não é parte.`
  let processo = 0
  let outroProcesso = 0
  let antes = { processos: 0, manifestacoes: 0 }

  /** Com o formulário "Abrir processo" aberto: escolhe o associado e o motivo, escreve os fatos, envia e devolve o número do processo. */
  async function enviarProcessoContra(
    page: Page,
    nome: string,
    texto: string,
  ): Promise<number> {
    const associado = page.locator('select[aria-label="Associado"]')
    await expect(associado.locator('option', { hasText: nome })).toHaveCount(1)
    await escolherPorTexto(associado, nome)
    await page
      .locator('select[aria-label="Motivo"]')
      .selectOption({ label: MOTIVO })
    await page
      .getByPlaceholder('Descreva os fatos que motivam o processo')
      .fill(texto)
    const criado = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/processos-disciplinares/',
    )
    await page.getByRole('button', { name: 'Abrir processo' }).click()
    const resposta = await criado
    expect(resposta.status()).toBe(200)
    return ((await resposta.json()) as { id_processo: number }).id_processo
  }

  const secaoDecidir = (page: Page) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Decidir', exact: true }),
    })
  const secaoManifestacoes = (page: Page) =>
    page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Manifestações da Diretoria Executiva',
      }),
    })

  test('abrir o processo: dados faltando são recusados; aberto, tem prazo de defesa; decidir ou se manifestar antes da defesa é recusado', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    antes = {
      processos: await abrirAuditoria(page, 'processos_disciplinares'),
      manifestacoes: await abrirAuditoria(
        page,
        'manifestacoes_diretoria_disciplinar',
      ),
    }
    await page.goto('/governanca/disciplina')
    await expect(
      page.getByRole('heading', {
        name: 'Processos disciplinares',
        exact: true,
      }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Abrir processo' }).click()
    await expect(
      page.getByPlaceholder('Descreva os fatos que motivam o processo'),
    ).toBeVisible()

    // recusa 1: nada preenchido (motivo e fatos)
    await page.getByRole('button', { name: 'Abrir processo' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Selecione o motivo.' }),
    ).toBeVisible()
    await expect(
      page.getByRole('alert').filter({
        hasText: 'Descreva os fatos que motivam o processo.',
      }),
    ).toBeVisible()
    await ver(page, info, 'processo disciplinar vazio: recusado')

    // recusa 2: motivo e fatos, mas sem escolher o associado (o servidor recusa)
    await page
      .locator('select[aria-label="Motivo"]')
      .selectOption({ label: MOTIVO })
    await page
      .getByPlaceholder('Descreva os fatos que motivam o processo')
      .fill(fatos)
    await page.getByRole('button', { name: 'Abrir processo' }).click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /associado/i })
        .first(),
    ).toBeVisible()
    await ver(page, info, 'processo disciplinar sem associado: recusado')

    // certo: contra o Tesoureiro de teste (que tem login e pode se defender); um segundo, contra quem não tem login
    processo = await enviarProcessoContra(page, TESOUREIRO, fatos)
    const link = page.locator(`a[href="/processos-disciplinares/${processo}"]`)
    await expect(link).toContainText(TESOUREIRO)
    await expect(link).toContainText('Aberto')
    await expect(link).toContainText('prazo de defesa até')
    await ver(page, info, 'processo aberto: na lista, com prazo de defesa')
    await page.getByRole('button', { name: 'Abrir processo' }).click()
    await expect(
      page.getByPlaceholder('Descreva os fatos que motivam o processo'),
    ).toBeVisible()
    outroProcesso = await enviarProcessoContra(
      page,
      OUTRO_ASSOCIADO,
      fatosOutro,
    )

    // o detalhe, vendo como quem julga
    await link.click()
    await expect(
      page.getByRole('heading', { name: `Processo disciplinar #${processo}` }),
    ).toBeVisible()
    await expect(page.getByText(fatos)).toBeVisible()
    await expect(page.getByText('Prazo de defesa até')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Decidir', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(/manifestações \(entre \d+ diretores aptos\)/),
    ).toBeVisible()
    await expect(page.getByText('Quórum pendente')).toBeVisible()
    await expect
      .soft(
        page.getByText(/entre 6 diretores aptos/),
        'o acusado (diretor) não conta entre os aptos: 7 da Diretoria - 1 = 6',
      )
      .toBeVisible()
    // fora de ordem: não é o acusado (sem "apresentar defesa") e ninguém homologa o que não foi decidido
    await expect(
      page.getByRole('heading', { name: 'Apresentar defesa' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: /Homologar eliminação/ }),
    ).toHaveCount(0)
    await ver(page, info, 'processo aberto visto por quem julga')

    // recusa 3: decidir antes da defesa (primeiro vazio, depois com texto)
    const decidir = secaoDecidir(page)
    await decidir
      .getByRole('button', { name: 'Fechar com a pena decidida' })
      .click()
    await expect(decidir.getByRole('alert')).toContainText(
      'Fundamente a decisão.',
    )
    await decidir
      .getByPlaceholder('Fundamente a decisão')
      .fill('Decisão de teste do robô: tentativa antes de a defesa chegar.')
    await decidir
      .getByRole('button', { name: 'Fechar com a pena decidida' })
      .click()
    await expect(decidir.getByRole('alert')).toContainText(
      'Ainda dentro do prazo de defesa',
    )
    await ver(page, info, 'decidir antes da defesa: recusado (Art. 16)')

    // recusa 4: manifestar-se antes da defesa
    const manifestacoes = secaoManifestacoes(page)
    await manifestacoes
      .getByRole('button', { name: 'Registrar manifestação' })
      .click()
    await expect(manifestacoes.getByRole('alert')).toContainText(
      'Ainda dentro do prazo de defesa',
    )
    await ver(page, info, 'manifestacao antes da defesa: recusada')
    expect(vigia.problemas()).toEqual([])
  })

  test('o acusado entra pela própria conta: vê só o processo dele, a defesa curta demais é recusada, apresenta a defesa, e não vê as etapas de quem julga', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'tesoureiro')
    await page.goto('/meus-processos-disciplinares')
    await expect(
      page.getByRole('heading', { name: 'Meus processos disciplinares' }),
    ).toBeVisible()
    const meu = page.locator(`a[href="/processos-disciplinares/${processo}"]`)
    await expect(meu).toContainText(`Processo #${processo}`)
    // com as permissões já carregadas (o menu mostra o Financeiro), a conta não oferece abrir processo nem mostra o dos outros
    await expect(
      page.getByRole('link', { name: 'Financeiro' }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Abrir processo' }),
    ).toHaveCount(0)
    await expect(
      page.locator(`a[href="/processos-disciplinares/${outroProcesso}"]`),
    ).toHaveCount(0)
    await ver(page, info, 'o acusado ve so o processo dele')

    await meu.click()
    await expect(
      page.getByRole('heading', { name: `Processo disciplinar #${processo}` }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Apresentar defesa' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Decidir', exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('heading', {
        name: 'Manifestações da Diretoria Executiva',
      }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: /Homologar eliminação/ }),
    ).toHaveCount(0)
    await ver(
      page,
      info,
      'o acusado ve so a defesa, nao as etapas de quem julga',
    )

    // recusa: defesa vazia e defesa curta demais
    const defesa = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Apresentar defesa' }),
    })
    await defesa.getByRole('button', { name: 'Enviar defesa' }).click()
    await expect(defesa.getByRole('alert')).toContainText('Apresente a defesa.')
    await defesa.getByPlaceholder('Apresente sua defesa').fill('abc')
    await defesa.getByRole('button', { name: 'Enviar defesa' }).click()
    await expect(defesa.getByRole('alert')).toContainText('Apresente a defesa.')
    await expect(page.getByText('Defesa apresentada em')).toHaveCount(0)
    await ver(page, info, 'defesa vazia ou curta demais: recusada')

    await defesa
      .getByPlaceholder('Apresente sua defesa')
      .fill(`Defesa de teste do robô ${RODADA}: as faltas foram justificadas.`)
    await defesa.getByRole('button', { name: 'Enviar defesa' }).click()
    await expect(page.getByText('Defesa apresentada em')).toBeVisible()
    // não há como apresentar a defesa de novo: a etapa some
    await expect(
      page.getByRole('heading', { name: 'Apresentar defesa' }),
    ).toHaveCount(0)
    await ver(page, info, 'defesa apresentada')

    // quem não tem governança não abre as telas de quem julga
    await page.goto('/governanca/disciplina')
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro barrado em Governanca: Disciplina')
    await page.goto('/governanca/dissolucao')
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro barrado em Governanca: Dissolucao')
    expect(vigia.problemas()).toEqual([])
  })

  test('manifestação do diretor (Secretário): vale uma vez, repetir é recusado, e decidir sem o quórum da maioria é recusado', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'secretario')
    await page.goto(`/processos-disciplinares/${processo}`)
    await expect(
      page.getByRole('heading', { name: `Processo disciplinar #${processo}` }),
    ).toBeVisible()
    await expect(page.getByText('Defesa apresentada em')).toBeVisible()
    // quem julga não é o acusado: não vê "apresentar defesa"
    await expect(
      page.getByRole('heading', { name: 'Apresentar defesa' }),
    ).toHaveCount(0)

    const manifestacoes = secaoManifestacoes(page)
    await expect(
      page.getByText(/^0\/\d+ manifestações \(entre \d+ diretores aptos\)/),
    ).toBeVisible()
    await manifestacoes.locator('select').selectOption('Advertência')
    await manifestacoes
      .getByPlaceholder('Justificativa (opcional)')
      .fill('Manifestação de teste do robô: advertência basta.')
    await manifestacoes
      .getByRole('button', { name: 'Registrar manifestação' })
      .click()
    await expect(
      page.getByText(/^1\/\d+ manifestações \(entre \d+ diretores aptos\)/),
    ).toBeVisible()
    await expect(
      page.getByText(/Pena mais votada até agora: Advertência/),
    ).toBeVisible()
    await expect
      .soft(
        page.getByText(/^1\/4 manifestações \(entre 6 diretores aptos\)/),
        'quórum esperado: metade + 1 de 6 diretores aptos = 4',
      )
      .toBeVisible()
    await ver(page, info, 'manifestacao registrada: apuracao 1 do quorum')

    // recusa: manifestar-se de novo
    await manifestacoes
      .getByRole('button', { name: 'Registrar manifestação' })
      .click()
    await expect(manifestacoes.getByRole('alert')).toContainText(
      'Você já se manifestou neste processo.',
    )
    await ver(page, info, 'segunda manifestacao do mesmo diretor: recusada')

    // recusa: decidir sem o quórum (a defesa já foi apresentada, mas só um diretor se manifestou)
    const decidir = secaoDecidir(page)
    await decidir
      .getByPlaceholder('Fundamente a decisão')
      .fill(
        'Decisão de teste do robô: não pode valer sem a maioria da Diretoria.',
      )
    await decidir
      .getByRole('button', { name: 'Fechar com a pena decidida' })
      .click()
    await expect(decidir.getByRole('alert')).toContainText(
      /Quórum de decisão não atingido: 1\/\d+ manifestações necessárias entre os \d+ diretores aptos/,
    )
    await ver(page, info, 'decisao sem quorum: recusada')
    await expect(
      page.getByText('Aberto', { exact: true }).first(),
    ).toBeVisible()
    expect(vigia.problemas()).toEqual([])
  })

  test('quem julga mas não é diretor (Presidente de teste) não se manifesta; o processo continua Aberto, sem homologação, e a Auditoria mostra cada passo', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(`/processos-disciplinares/${processo}`)
    await expect(
      page.getByRole('heading', { name: `Processo disciplinar #${processo}` }),
    ).toBeVisible()
    await expect(page.getByText('Defesa apresentada em')).toBeVisible()

    const manifestacoes = secaoManifestacoes(page)
    await manifestacoes
      .getByRole('button', { name: 'Registrar manifestação' })
      .click()
    await expect(manifestacoes.getByRole('alert')).toContainText(
      /Só um membro da Diretoria Executiva com mandato vigente/,
    )
    const decidir = secaoDecidir(page)
    await decidir
      .getByPlaceholder('Fundamente a decisão')
      .fill('Decisão de teste do robô: o Presidente não decide sozinho.')
    await decidir
      .getByRole('button', { name: 'Fechar com a pena decidida' })
      .click()
    await expect(decidir.getByRole('alert')).toContainText(
      /Quórum de decisão não atingido: 1\/\d+ manifestações necessárias/,
    )
    await expect(
      page.getByRole('heading', { name: /Homologar eliminação/ }),
    ).toHaveCount(0)
    await ver(
      page,
      info,
      'Presidente nao e diretor: manifestacao e decisao recusadas',
    )

    // Auditoria: abertura (dois processos), defesa (do acusado) e manifestação (do Secretário); a decisão recusada não deixou rastro
    expect(
      await abrirAuditoria(page, 'processos_disciplinares'),
    ).toBeGreaterThanOrEqual(antes.processos + 3)
    await expect(
      linhaDaAuditoria(page, 'ABERTO', {
        registro: processo,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'ABERTO', {
        registro: outroProcesso,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'DEFESA_APRESENTADA', {
        registro: processo,
        quem: TESOUREIRO,
      }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('row')
        .filter({
          has: page.getByRole('cell', { name: 'DECIDIDO', exact: true }),
        })
        .filter({
          has: page.getByRole('cell', { name: String(processo), exact: true }),
        }),
    ).toHaveCount(0)
    await ver(page, info, 'auditoria: abertura e defesa do processo')
    expect(
      await abrirAuditoria(page, 'manifestacoes_diretoria_disciplinar'),
    ).toBeGreaterThanOrEqual(antes.manifestacoes + 1)
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: processo,
        quem: SECRETARIO,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: manifestacao do Secretario')
    expect(vigia.problemas()).toEqual([])
  })

  test('confidencialidade: quem não é parte nem tem governança não abre o processo de outra pessoa (o servidor responde 404)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'tesoureiro')
    const resposta = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname ===
          `/api/processos-disciplinares/${outroProcesso}`,
    )
    await page.goto(`/processos-disciplinares/${outroProcesso}`)
    expect((await resposta).status()).toBe(404)
    await expect(page.getByText(fatosOutro)).toHaveCount(0)
    // a recusa não pode deixar a tela eternamente em "Carregando…" (o usuário não sabe o que houve)
    await expect
      .soft(
        page.getByText(/^Carregando/),
        'o 404 do processo alheio deixa a tela em "Carregando…" para sempre: devia dizer que não foi encontrado',
      )
      .toHaveCount(0, { timeout: 20_000 })
    await info.attach('processo alheio: tela depois do 404', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// C. DISSOLUÇÃO (/governanca/dissolucao): só o que é seguro de fazer (abrir, tentar vincular o que não existe, cancelar o próprio processo)
// =====================================================================================================================================
test.describe('C. Dissolução (somente o que não conclui nada)', () => {
  test.describe.configure({ mode: 'serial' })

  const motivo = `Processo de dissolução de teste ${RODADA} (inventado pelo robô, nada foi concluído).`
  let processo = 0
  let auditoriaAntes = 0

  test('abrir o processo: motivo curto é recusado; aberto, só a etapa 1 aparece (as outras não) e vincular uma deliberação que não existe é recusado', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    auditoriaAntes = await abrirAuditoria(page, 'processos_dissolucao')
    await page.goto('/governanca/dissolucao')
    await expect(
      page.getByRole('heading', { name: 'Processos de dissolução' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Abrir processo' }).click()

    // recusa: motivo curto demais
    await page
      .getByPlaceholder('Descreva o motivo da dissolução (Art. 31)')
      .fill('curto')
    await page.getByRole('button', { name: 'Abrir processo' }).click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /Descreva o motivo \(Art\. 31/ }),
    ).toBeVisible()
    await ver(page, info, 'dissolucao com motivo curto: recusada')

    // certo
    await page
      .getByPlaceholder('Descreva o motivo da dissolução (Art. 31)')
      .fill(motivo)
    const criado = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/processos-dissolucao/',
    )
    await page.getByRole('button', { name: 'Abrir processo' }).click()
    const resposta = await criado
    expect(resposta.status()).toBe(200)
    processo = ((await resposta.json()) as { id_processo_dissolucao: number })
      .id_processo_dissolucao
    const link = page.locator(`a[href="/governanca/dissolucao/${processo}"]`)
    await expect(link).toContainText('Aberto')
    await expect(link).toContainText(motivo)
    await ver(page, info, 'processo de dissolucao aberto')

    await link.click()
    await expect(
      page.getByRole('heading', { name: `Dissolução #${processo}` }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /^1\. Vincular deliberação/ }),
    ).toBeVisible()
    // fora de ordem: liquidação, destinação, baixa e conclusão só existem nas etapas seguintes
    for (const etapa of [
      /^2\. Concluir liquidação/,
      /^3\. Destinar patrimônio/,
      /^4\. Registrar baixa cadastral/,
      /^Roteiro de dissolução concluído/,
    ]) {
      await expect(page.getByRole('heading', { name: etapa })).toHaveCount(0)
    }
    await ver(page, info, 'dissolucao aberta: so a etapa 1')

    // recusa: vincular uma deliberação que não existe
    await page.getByPlaceholder('Nº da deliberação').fill('999999')
    await page.getByRole('button', { name: 'Vincular' }).click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Deliberação não encontrada.' }),
    ).toBeVisible()
    await expect(
      page.getByText('Aberto', { exact: true }).first(),
    ).toBeVisible()
    await ver(page, info, 'vincular deliberacao inexistente: recusado')
    expect(vigia.problemas()).toEqual([])
  })

  test('cancelar o processo que o robô abriu: o motivo é pedido, o processo vira Cancelado, não há como cancelar de novo e a Auditoria mostra abertura e cancelamento', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(`/governanca/dissolucao/${processo}`)
    await expect(
      page.getByRole('heading', { name: `Dissolução #${processo}` }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Cancelar processo' }),
    ).toBeVisible()

    // recusa (achado provável): motivo vazio. O formulário de cancelar não liga a mensagem do campo, então a recusa fica muda.
    await page.getByRole('button', { name: 'Cancelar processo' }).click()
    await expect
      .soft(
        page
          .getByRole('alert')
          .filter({ hasText: 'Descreva o motivo do cancelamento.' }),
        'cancelar sem motivo tem que mostrar o porquê da recusa: hoje o formulário não mostra o erro do campo',
      )
      .toBeVisible({ timeout: 5_000 })
    await expect(
      page.getByText('Aberto', { exact: true }).first(),
    ).toBeVisible()
    await ver(page, info, 'cancelar sem motivo: recusado')

    await page
      .getByPlaceholder('Motivo do cancelamento')
      .fill('Cancelado pelo robô: era só o roteiro de conferência.')
    await page.getByRole('button', { name: 'Cancelar processo' }).click()
    await expect(
      page.getByText(
        'Cancelado: Cancelado pelo robô: era só o roteiro de conferência.',
      ),
    ).toBeVisible()
    await expect(page.getByText('Cancelado', { exact: true })).toBeVisible()
    // terminado: não há mais como cancelar nem etapa nenhuma a cumprir
    await expect(
      page.getByRole('button', { name: 'Cancelar processo' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: /^1\. Vincular deliberação/ }),
    ).toHaveCount(0)
    await ver(page, info, 'dissolucao cancelada')

    expect(
      await abrirAuditoria(page, 'processos_dissolucao'),
    ).toBeGreaterThanOrEqual(auditoriaAntes + 2)
    await expect(
      linhaDaAuditoria(page, 'ABERTO', {
        registro: processo,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CANCELADO', {
        registro: processo,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: abertura e cancelamento da dissolucao')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// D. CALENDÁRIO INSTITUCIONAL (/calendario): fuso de Belém (UTC-3); o dia mostrado tem que ser o dia em que o evento acontece
// =====================================================================================================================================
test.describe('D. Calendário institucional', () => {
  test.describe.configure({ mode: 'serial' })

  const meioDia = `Reunião de teste do robô ${RODADA} (meio-dia)`
  const dia = diaEmBelem(10)
  const cartaoDe = (page: Page, titulo: string) =>
    page.locator('div.rounded-md').filter({ hasText: titulo })

  test('agendar: campos faltando são recusados; o evento do meio-dia aparece no dia certo e a Auditoria registra', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'eventos_calendario')
    await page.goto('/calendario')
    await expect(
      page.getByRole('heading', { name: 'Calendário institucional', level: 1 }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Agendar evento' }).click()
    await expect(page.getByPlaceholder('Título do evento')).toBeVisible()

    // recusa: nada preenchido
    await page.getByRole('button', { name: 'Agendar evento' }).click()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Informe o título do evento.' }),
    ).toBeVisible()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Selecione a categoria.' }),
    ).toBeVisible()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Informe a data de início.' }),
    ).toBeVisible()
    await ver(page, info, 'evento vazio: recusado')

    // certo: 12h no relógio de Belém
    await page.getByPlaceholder('Título do evento').fill(meioDia)
    await page
      .locator('select[aria-label="Categoria"]')
      .selectOption({ label: 'Reunião de Diretoria' })
    await campo(page, 'Início').fill(`${dia.iso}T12:00`)
    await page
      .getByPlaceholder('Descrição (opcional)')
      .fill('Evento de teste do robô.')
    await page.getByRole('button', { name: 'Agendar evento' }).click()
    const cartao = cartaoDe(page, meioDia)
    await expect(cartao).toBeVisible()
    await expect(cartao).toContainText(`Evento institucional · ${dia.br}`)
    await ver(page, info, 'evento do meio-dia na lista, no dia certo')

    expect(await abrirAuditoria(page, 'eventos_calendario')).toBeGreaterThan(
      antes,
    )
    await expect(
      linhaDaAuditoria(page, 'CREATE', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: evento agendado')
    expect(vigia.problemas()).toEqual([])
  })

  test('quem não tem governança (Tesoureiro) vê o evento no mesmo dia, mas não vê o botão de agendar', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'tesoureiro')
    await page.goto('/calendario')
    await expect(
      page.getByRole('heading', { name: 'Calendário institucional', level: 1 }),
    ).toBeVisible()
    const cartao = cartaoDe(page, meioDia)
    await expect(cartao).toBeVisible()
    await expect(cartao).toContainText(`Evento institucional · ${dia.br}`)
    await expect(
      page.getByRole('link', { name: 'Financeiro' }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Agendar evento' }),
    ).toHaveCount(0)
    await ver(page, info, 'Tesoureiro ve o evento, sem o botao de agendar')
    expect(vigia.problemas()).toEqual([])
  })

  test('achados prováveis: evento às 22h30 de Belém aparece no dia seguinte (a data é tirada do UTC), e fim antes do início é aceito', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const noite = `Reunião de teste do robô ${RODADA} (noite)`
    const invertido = `Reunião de teste do robô ${RODADA} (fim antes do início)`
    const diaDaNoite = diaEmBelem(11)
    const diaInvertido = diaEmBelem(12)
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'eventos_calendario')
    await page.goto('/calendario')
    await page.getByRole('button', { name: 'Agendar evento' }).click()
    await expect(page.getByPlaceholder('Título do evento')).toBeVisible()

    // 22h30 em Belém é 01h30 do dia seguinte em UTC: o evento tem que continuar no dia em que acontece
    await page.getByPlaceholder('Título do evento').fill(noite)
    await page
      .locator('select[aria-label="Categoria"]')
      .selectOption({ label: 'Reunião do Conselho Fiscal' })
    await campo(page, 'Início').fill(`${diaDaNoite.iso}T22:30`)
    await page.getByRole('button', { name: 'Agendar evento' }).click()
    const cartaoDaNoite = cartaoDe(page, noite)
    await expect(cartaoDaNoite).toBeVisible()
    await info.attach('dia mostrado para o evento das 22h30', {
      body: `esperado ${diaDaNoite.br}; a tela mostrou: ${(await cartaoDaNoite.innerText()).replace(/\s+/g, ' ')}`,
      contentType: 'text/plain',
    })
    await expect
      .soft(
        cartaoDaNoite,
        `evento às 22h30 (Belém) do dia ${diaDaNoite.br} tem que aparecer nesse dia, não no seguinte (app/services/calendario.py tira .date() do UTC)`,
      )
      .toContainText(`Evento institucional · ${diaDaNoite.br}`)
    await ver(page, info, 'evento das 22h30 de Belem na lista')

    // fim antes do início tem que ser recusado
    await page.getByRole('button', { name: 'Agendar evento' }).click()
    await expect(page.getByPlaceholder('Título do evento')).toBeVisible()
    await page.getByPlaceholder('Título do evento').fill(invertido)
    await page
      .locator('select[aria-label="Categoria"]')
      .selectOption({ label: 'Outro' })
    await campo(page, 'Início').fill(`${diaInvertido.iso}T10:00`)
    await campo(page, 'Fim (opcional)').fill(`${diaInvertido.iso}T09:00`)
    await page.getByRole('button', { name: 'Agendar evento' }).click()
    await expect
      .soft(
        page.getByRole('alert').first(),
        'evento com fim antes do início deveria ser recusado: hoje o servidor e a tela aceitam',
      )
      .toBeVisible({ timeout: 5_000 })
    await ver(page, info, 'evento com fim antes do inicio')

    expect(await abrirAuditoria(page, 'eventos_calendario')).toBeGreaterThan(
      antes,
    )
    expect(vigia.problemas()).toEqual([])
  })
})
