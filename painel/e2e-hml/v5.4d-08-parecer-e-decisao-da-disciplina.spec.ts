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

// v5.4d — o que só dá para provar com GENTE COM CARGO: o parecer do Conselho Fiscal (quem é conselheiro pelo mandato) e a decisão e a homologação
// de um processo disciplinar (quórum de maioria da Diretoria). Usa os usuários de teste com cargo da homologação (conselheiro, cargo_presidente,
// vice_presidente, vice_presidente_2, secretario). Os roteiros 05 e 06 rodam antes (a ata e o título de que este precisa).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const ANO = new Date().getFullYear()
const ACUSADO = 'Fábio Henrique Dias'
const MOTIVO = 'Desídia no desempenho das atividades associativas'
const DEFESA =
  'Defesa de teste do robô: os fatos narrados não correspondem ao que aconteceu, e peço a análise da Diretoria.'

async function totalNaAuditoria(page: Page, tabela: string): Promise<number> {
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

// =====================================================================================================================================
// A. CONSELHO FISCAL: parecer de quem é conselheiro pelo cargo, fila de perguntas respondida pela tesouraria, e a aprovação de contas liberada
// =====================================================================================================================================
test.describe('A. Conselho Fiscal com poder real', () => {
  test.describe.configure({ mode: 'serial' })
  let tituloPerguntado = ''
  const pergunta = `Pergunta do conselheiro ${RODADA}: por que este valor está acima do orçado?`
  const resposta = `Resposta da tesouraria ${RODADA}: reajuste contratual anual.`

  test('o conselheiro (pelo cargo) emite o parecer: campos faltando e ano impossível são recusados, o válido entra na lista e na Auditoria', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'conselheiro')
    const antes = await totalNaAuditoria(page, 'pareceres_prestacao_contas')
    await page.goto('/financeiro/conselho-fiscal')
    await expect(
      page.getByRole('heading', { name: 'Conselho Fiscal', level: 1 }),
    ).toBeVisible()
    const secao = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Pareceres sobre prestação de contas',
      }),
    })
    await secao.getByRole('button', { name: 'Emitir parecer' }).click()
    const emitir = secao.getByRole('button', {
      name: 'Emitir parecer',
      exact: true,
    })

    // recusa 1: sem texto
    await emitir.click()
    await expect(secao.getByRole('alert')).toContainText('Descreva o parecer.')
    // recusa 2: ano impossível (a ASAF existe desde 2013)
    await secao
      .getByLabel('Texto do parecer')
      .fill(
        `Parecer de teste do robô ${RODADA}: contas conferidas, com uma ressalva sobre os comprovantes.`,
      )
    await secao.getByLabel('Ano do exercício').fill('2012')
    await emitir.click()
    await expect(secao.getByRole('alert')).toContainText('Ano inválido')
    await ver(page, info, 'parecer com ano impossivel: recusado')

    // o parecer de verdade
    await secao.getByLabel('Ano do exercício').fill(String(ANO))
    await secao
      .getByLabel('Tipo de parecer')
      .selectOption({ label: 'Com ressalva' })
    await emitir.click()
    const card = secao
      .locator('div.rounded-md.border')
      .filter({ hasText: `Exercício ${ANO}` })
      .filter({ hasText: String(RODADA) })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('Com ressalva')
    await ver(
      page,
      info,
      'parecer emitido pelo conselheiro (cargo no Conselho Fiscal)',
    )

    expect(await totalNaAuditoria(page, 'pareceres_prestacao_contas')).toBe(
      antes + 1,
    )
    await expect(
      page
        .getByRole('row')
        .filter({
          has: page.getByRole('cell', { name: 'CREATE', exact: true }),
        })
        .filter({ hasText: 'Heitor' })
        .first(),
    ).toBeVisible()
    await ver(page, info, 'auditoria: parecer do conselheiro')
    expect(vigia.problemas()).toEqual([])
  })

  test('o conselheiro pergunta sobre um lançamento; a tesouraria responde e o questionamento passa a Respondido', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'conselheiro')
    await page.goto('/financeiro/conselho-fiscal')
    const titulos = page.locator('section').filter({
      has: page.getByRole('heading', { name: /Títulos financeiros/ }),
    })
    const cartaoDoTitulo = titulos
      .locator('div.rounded-md.border')
      .filter({
        has: page.getByRole('button', { name: 'Ver questionamentos' }),
      })
      .first()
    await expect(cartaoDoTitulo).toBeVisible()
    tituloPerguntado = (
      await cartaoDoTitulo.locator('p.font-medium').first().innerText()
    ).trim()
    await cartaoDoTitulo
      .getByRole('button', { name: 'Ver questionamentos' })
      .click()
    const cartaoAberto = titulos
      .locator('div.rounded-md.border')
      .filter({ hasText: tituloPerguntado })
      .first()
    await cartaoAberto.getByRole('button', { name: 'Questionar' }).click()
    // pergunta vazia é recusada
    await cartaoAberto
      .getByRole('button', { name: 'Enviar questionamento' })
      .click()
    await expect(cartaoAberto.getByRole('alert')).toBeVisible()
    await cartaoAberto.getByLabel('Pergunta sobre o lançamento').fill(pergunta)
    await cartaoAberto
      .getByRole('button', { name: 'Enviar questionamento' })
      .click()
    const questionamento = cartaoAberto
      .locator('div.rounded-md')
      .filter({ hasText: pergunta })
      .first()
    await expect(questionamento).toBeVisible()
    await expect(questionamento).toContainText('Aberto')
    await ver(page, info, 'questionamento aberto pelo conselheiro')
    await sair(page)

    // a tesouraria responde
    await entrar(page, 'tesoureiro')
    await page.goto('/financeiro/conselho-fiscal')
    const titulosDela = page.locator('section').filter({
      has: page.getByRole('heading', { name: /Títulos financeiros/ }),
    })
    const cartaoDela = titulosDela
      .locator('div.rounded-md.border')
      .filter({ hasText: tituloPerguntado })
      .first()
    await cartaoDela
      .getByRole('button', { name: 'Ver questionamentos' })
      .click()
    const pergunta2 = cartaoDela
      .locator('div.rounded-md')
      .filter({ hasText: pergunta })
      .first()
    await expect(pergunta2).toBeVisible()
    await pergunta2
      .getByRole('button', { name: 'Responder (tesouraria)' })
      .click()
    await pergunta2
      .getByRole('button', { name: 'Responder', exact: true })
      .click()
    await expect(pergunta2.getByRole('alert')).toBeVisible() // resposta vazia recusada
    await pergunta2.getByLabel('Resposta ao questionamento').fill(resposta)
    await pergunta2
      .getByRole('button', { name: 'Responder', exact: true })
      .click()
    await expect(pergunta2).toContainText(resposta)
    await expect(pergunta2).toContainText('Respondido')
    await ver(page, info, 'tesouraria respondeu: questionamento Respondido')
    expect(vigia.problemas()).toEqual([])
  })

  test('com o parecer do ano emitido, a deliberação de "aprovação de contas" daquele ano é aceita (sem parecer era recusada)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto('/governanca/atas')
    const linha = page
      .getByRole('row')
      .filter({ has: page.getByRole('link') })
      .first()
    await expect(
      linha,
      'precisa haver uma ata (o roteiro v5.4d-05 cria uma)',
    ).toBeVisible()
    await linha.getByRole('link').click()
    await expect(
      page.getByRole('heading', { name: /^Ata/ }).first(),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Registrar deliberação' }).click()
    await page
      .getByLabel('Tipo da deliberação')
      .selectOption({ label: 'Aprovação de contas' })
    await page.getByLabel('Ano de exercício').fill(String(ANO))
    const texto = `Aprovação das contas de ${ANO} (teste do robô ${RODADA}), com o parecer do Conselho Fiscal.`
    await page.getByLabel('Texto da deliberação').fill(texto)
    await page.getByRole('button', { name: 'Registrar', exact: true }).click()
    const card = page
      .locator('div.rounded-md.border')
      .filter({ hasText: texto })
    await expect(card).toBeVisible()
    await expect(card).toContainText(`Exercício ${ANO}`)
    await expect(card).toContainText('Pendente')
    await ver(page, info, 'aprovacao de contas aceita: ha parecer do ano')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// B. DISCIPLINA: a decisão por maioria da Diretoria (quatro diretores com login) e a homologação da eliminação pela assembleia
// =====================================================================================================================================
test.describe('B. Disciplina: decisão e homologação', () => {
  test.describe.configure({ mode: 'serial' })
  let processoAdvertencia = 0
  let processoEliminacao = 0
  let quorum = 0

  async function abrirProcesso(page: Page, id: number): Promise<void> {
    await page.goto(`/processos-disciplinares/${id}`)
    await expect(
      page.getByRole('heading', { name: `Processo disciplinar #${id}` }),
    ).toBeVisible()
  }
  const secaoManifestacoes = (page: Page): Locator =>
    page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Manifestações da Diretoria Executiva',
      }),
    })

  async function manifestar(
    page: Page,
    id: number,
    pena: string,
  ): Promise<void> {
    await abrirProcesso(page, id)
    const secao = secaoManifestacoes(page)
    await expect(secao).toBeVisible()
    await secao.getByLabel('Pena proposta').selectOption({ label: pena })
    await secao
      .getByLabel('Justificativa da manifestação (opcional)')
      .fill(`Voto de teste do robô ${RODADA}`)
    const registrando = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/manifestacoes$/.test(new URL(r.url()).pathname),
    )
    await secao.getByRole('button', { name: 'Registrar manifestação' }).click()
    expect((await registrando).status()).toBe(200)
  }

  test('a Presidente abre dois processos contra o Tesoureiro (um para advertência, outro para eliminação) e ele apresenta a defesa nos dois', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto('/governanca/disciplina')
    async function abrir(fatos: string): Promise<number> {
      await page.getByRole('button', { name: 'Abrir processo' }).click()
      const associado = page.locator('select[aria-label="Associado"]')
      await escolherPorTexto(associado, ACUSADO)
      await page
        .locator('select[aria-label="Motivo"]')
        .selectOption({ label: MOTIVO })
      await page
        .getByPlaceholder('Descreva os fatos que motivam o processo')
        .fill(fatos)
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
    processoAdvertencia = await abrir(
      `Fatos de teste ${RODADA} (A): atrasos repetidos nas reuniões de diretoria.`,
    )
    processoEliminacao = await abrir(
      `Fatos de teste ${RODADA} (B): conduta incompatível relatada em ata de teste.`,
    )
    await ver(page, info, 'dois processos abertos contra o Tesoureiro')
    await sair(page)

    // o acusado se defende nos dois
    await entrar(page, 'tesoureiro')
    for (const id of [processoAdvertencia, processoEliminacao]) {
      await abrirProcesso(page, id)
      await page.getByLabel('Sua defesa').fill(DEFESA)
      await page.getByRole('button', { name: 'Enviar defesa' }).click()
      await expect(page.getByLabel('Sua defesa')).toHaveCount(0)
      await expect(page.getByText('Defesa apresentada em')).toBeVisible()
    }
    await ver(page, info, 'defesa apresentada nos dois processos')
    expect(vigia.problemas()).toEqual([])
  })

  test('os diretores se manifestam; com UM voto a menos que o quórum a decisão é recusada; com o quórum, é aceita', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const diretores = [
      'cargo_presidente',
      'vice_presidente',
      'vice_presidente_2',
      'secretario',
    ] as const

    // descobre o quórum que o sistema pede (metade mais um dos diretores aptos, sem o acusado)
    await entrar(page, 'presidente')
    await abrirProcesso(page, processoAdvertencia)
    const resumo = await page
      .getByText(/\d+\/\d+ manifestações \(entre \d+ diretores aptos\)/)
      .innerText()
    quorum = Number(/\d+\/(\d+) manifestações/.exec(resumo)![1])
    expect(
      quorum,
      `o quórum é ${quorum}; só há quatro diretores de teste com login`,
    ).toBeLessThanOrEqual(diretores.length)
    await ver(page, info, `quorum pedido: ${quorum}`)
    await sair(page)

    // todos menos o último votam; então a decisão tem de ser recusada
    for (const papel of diretores.slice(0, quorum - 1)) {
      await entrar(page, papel)
      await manifestar(page, processoAdvertencia, 'Advertência')
      await manifestar(page, processoEliminacao, 'Eliminação do quadro social')
      await sair(page)
    }
    await entrar(page, 'presidente')
    await abrirProcesso(page, processoAdvertencia)
    const decidir = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Decidir', exact: true }),
    })
    await expect(page.getByText('Quórum pendente')).toBeVisible()
    await decidir
      .getByLabel('Fundamentação da decisão')
      .fill('Decisão de teste do robô: tentativa antes do quórum.')
    await decidir
      .getByRole('button', { name: 'Fechar com a pena decidida' })
      .click()
    await expect(decidir.getByRole('alert')).toContainText(
      /Quórum de decisão não atingido/,
    )
    await ver(page, info, 'decidir com um voto a menos que o quorum: recusado')
    await sair(page)

    // o último diretor vota: o quórum fecha
    await entrar(page, diretores[quorum - 1]!)
    await manifestar(page, processoAdvertencia, 'Advertência')
    await manifestar(page, processoEliminacao, 'Eliminação do quadro social')
    await sair(page)
    expect(vigia.problemas()).toEqual([])
  })

  test('com o quórum, a Presidente fecha o processo na pena mais votada (advertência) e a Auditoria registra a decisão', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    const antes = await totalNaAuditoria(page, 'processos_disciplinares')
    await abrirProcesso(page, processoAdvertencia)
    await expect(page.getByText('Quórum atingido')).toBeVisible()
    const decidir = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Decidir', exact: true }),
    })
    await decidir
      .getByLabel('Fundamentação da decisão')
      .fill(
        `Decisão de teste do robô ${RODADA}: advertência pela maioria da Diretoria.`,
      )
    await decidir
      .getByRole('button', { name: 'Fechar com a pena decidida' })
      .click()
    await expect(page.getByText('Pena aplicada')).toBeVisible()
    await expect(
      page.getByText('Advertência', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Decidir', exact: true }),
    ).toHaveCount(0)
    await ver(page, info, 'processo decidido: advertencia')
    expect(await totalNaAuditoria(page, 'processos_disciplinares')).toBe(
      antes + 1,
    )
    await expect(
      page
        .getByRole('row')
        .filter({
          has: page.getByRole('cell', { name: 'DECIDIDO', exact: true }),
        })
        .filter({ hasText: String(processoAdvertencia) })
        .first(),
    ).toBeVisible()
    expect(vigia.problemas()).toEqual([])
  })

  test('eliminação: decidida, fica aguardando a homologação da assembleia; a assembleia recusa e NADA irreversível acontece', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await abrirProcesso(page, processoEliminacao)
    const decidir = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Decidir', exact: true }),
    })
    await decidir
      .getByLabel('Fundamentação da decisão')
      .fill(
        `Decisão de teste do robô ${RODADA}: eliminação, sujeita à assembleia.`,
      )
    await decidir
      .getByRole('button', { name: 'Fechar com a pena decidida' })
      .click()
    // eliminação nunca é automática: espera a homologação
    await expect(
      page.getByText('Aguardando homologação da Assembleia').first(),
    ).toBeVisible()
    const homologar = page.locator('section').filter({
      has: page.getByRole('heading', { name: /Homologar eliminação/ }),
    })
    await expect(homologar).toBeVisible()
    await ver(page, info, 'eliminacao decidida: aguarda a homologacao')

    // a justificativa é obrigatória
    await homologar
      .getByLabel('Decisão da assembleia')
      .selectOption({ label: 'Recusar eliminação' })
    await homologar
      .getByRole('button', { name: 'Registrar homologação' })
      .click()
    await expect(homologar.getByRole('alert')).toBeVisible()
    await homologar
      .getByLabel('Justificativa da homologação')
      .fill(`A assembleia de teste (${RODADA}) recusou a eliminação.`)
    await homologar
      .getByRole('button', { name: 'Registrar homologação' })
      .click()
    await expect(
      page.getByText('Rejeitado pela Assembleia').first(),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /Homologar eliminação/ }),
    ).toHaveCount(0)
    await ver(page, info, 'assembleia recusou a eliminacao')

    // o acusado continua associado: ainda entra e vê o menu do cargo
    await sair(page)
    await entrar(page, 'tesoureiro')
    await expect(
      page.getByRole('link', { name: 'Financeiro' }).first(),
    ).toBeVisible()
    await ver(page, info, 'o Tesoureiro continua associado (nada irreversivel)')
    expect(vigia.problemas()).toEqual([])
  })
})
