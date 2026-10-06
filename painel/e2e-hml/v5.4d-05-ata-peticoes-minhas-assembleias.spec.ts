import fs from 'node:fs'
import path from 'node:path'

import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

import {
  atingirQuorum,
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  inventariar,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4d — FASE 2 e 2.5 ao vivo (parte 5): a ata e as deliberações, as petições de convocação, "Minhas assembleias" (autochamada com o código
// da sessão, justificativa de falta) e o detalhe da assembleia encerrada. Pela tela, com as recusas que o sistema tem que fazer e a Auditoria.
//
// O roteiro cria a SUA assembleia (nome com a rodada) e a leva até o fim; tudo o que depende dela corre em ordem (modo serial). As petições
// não dependem dela e ficam num grupo à parte.
//
// O que parece DEFEITO do sistema (e não do roteiro) é anotado em `achados` em vez de derrubar o teste na hora: assim o roteiro inteiro roda e
// o último teste de cada grupo lista tudo de uma vez. Quem tem a primeira palavra sobre o que é defeito é o dono do sistema; o roteiro só
// relata o que viu.
test.beforeAll(() => exigirHomologacao())

const PAUTA = `Ata e chamada ${RODADA}: contas do exercício e relatório da diretoria`
const TITULO_ITEM = `Aprovação das contas ${RODADA}`
const TITULO_VOTACAO = `Votação das contas ${RODADA}`
const OCORRENCIA = `Ocorrência ${RODADA}: sem intercorrências durante a votação`
const MOTIVO_SECRETARIO = `Viagem a serviço da associação (${RODADA})`
const MOTIVO_TESOUREIRO = `Consulta médica marcada antes da convocação (${RODADA})`
const MOTIVO_MANUAL = `Lançada pela mesa: aviso por telefone (${RODADA})`

// Estado que atravessa os testes do grupo da assembleia (a ordem é garantida pelo modo serial).
let base = ''
let idAssembleia = 0
let codigo = ''
let corrigido = ''
let idJustSecretario = 0
let idJustTesoureiro = 0
let idJustManual = 0
let idCredAutochamada = 0
let idCorrecao = 0
let idAta = 0
let idRetificacao = 0
let numeroAta = 0
let idDocumento = 0

// O que o roteiro viu e parece defeito do sistema (um por linha), por grupo.
const achadosAssembleia: string[] = []
const achadosPeticoes: string[] = []

const daqui30dias = () =>
  new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 16)

/** Resposta da API a uma chamada que ainda vai acontecer (criar ANTES do clique que a dispara). */
function respostaDe(page: Page, metodo: string, caminho: RegExp) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === metodo &&
      caminho.test(new URL(r.url()).pathname),
  )
}

/** Campo de formulário pelo texto do rótulo, dentro de um trecho da tela (o `campo` do apoio olha a página inteira). */
function campoEm(escopo: Locator, rotulo: string): Locator {
  return escopo.locator(
    `label:text-is("${rotulo}") + :is(input, select, textarea)`,
  )
}

/** O cartão desta assembleia em "Minhas assembleias" (a lista traz as assembleias de todas as rodadas). */
const cartaoDaAssembleia = (page: Page) =>
  page.locator('div.rounded-xl').filter({ hasText: PAUTA })

/** Espera a opção existir (as listas de associados chegam depois da tela) e escolhe pelo trecho do nome. */
async function escolherQuandoHouver(seletor: Locator, trecho: string) {
  await expect(
    seletor.locator('option', { hasText: trecho }).first(),
  ).toBeAttached()
  await escolherPorTexto(seletor, trecho)
}

/** A Auditoria mostra a ação (e, quando se sabe, o registro afetado). Filtra pela tabela e pela ação, como quem confere de verdade. */
async function naAuditoria(
  page: Page,
  tabela: string,
  acao: string,
  registro?: number,
  info?: TestInfo,
) {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria' }).first(),
  ).toBeVisible()
  await campo(page, 'Tabela').fill(tabela)
  await campo(page, 'Ação').selectOption(acao)
  let linha = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: acao, exact: true }),
  })
  if (registro !== undefined) {
    linha = linha.filter({
      has: page.getByRole('cell', { name: String(registro), exact: true }),
    })
  }
  await expect(
    linha.first(),
    `a Auditoria deveria mostrar ${tabela} / ${acao}${registro === undefined ? '' : ` / registro ${registro}`}`,
  ).toBeVisible()
  if (info) await ver(page, info, `auditoria: ${tabela} ${acao}`)
}

/**
 * Inventário da tela atual SEM derrubar o teste: o que faltar de rótulo acessível vai para a lista de achados (e o inventário fica anexado ao
 * relatório do mesmo jeito).
 */
async function inventariarSemTravar(
  page: Page,
  info: TestInfo,
  nome: string,
  achados: string[],
) {
  try {
    await inventariar(page, info, nome)
  } catch (erro) {
    const roteiro = path.basename(info.file).replace(/\.spec\.ts$/, '')
    const arquivo = path.join(
      'prints-hml',
      roteiro,
      `inventario-${nome.replace(/[^a-zA-Z0-9]+/g, '-')}.txt`,
    )
    let motivo = (erro as Error).message.split('\n')[0] ?? ''
    try {
      motivo =
        fs
          .readFileSync(arquivo, 'utf-8')
          .split('\n')
          .find((linha) => linha.startsWith('SEM RÓTULO:')) ?? motivo
    } catch {
      // sem arquivo: fica a mensagem do erro
    }
    achados.push(`acessibilidade em "${nome}": ${motivo}`)
  }
}

/** Um PDF de verdade (uma página, um texto), pequeno e todo em ASCII, para subir pela tela como documento assinado. */
function pdfDeTeste(texto: string): Buffer {
  const conteudo = `BT /F1 14 Tf 72 720 Td (${texto}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posicoes: number[] = []
  objetos.forEach((objeto, i) => {
    posicoes.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${objeto}\nendobj\n`
  })
  const inicioDaTabela = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const posicao of posicoes) {
    pdf += `${String(posicao).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioDaTabela}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

// --------------------------------------------------------------------------------------------------------------------------- assembleia
test.describe('assembleia própria: justificativas, chamada, sessão, detalhe e ata', () => {
  test.describe.configure({ mode: 'serial' })

  test('criar a assembleia deste roteiro e convocar (a lista de habilitados é congelada)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto('/governanca/nova')
    await campo(page, 'Tipo *').selectOption({ index: 1 })
    await campo(page, 'Data e hora da 1ª convocação *').fill(daqui30dias())
    await campo(page, 'Ordem do dia *').fill(PAUTA)
    await campo(page, 'Local físico').fill('Sede de teste, Parauapebas')
    await page
      .getByRole('button', { name: 'Criar assembleia (rascunho)' })
      .click()
    await expect(page).toHaveURL(/\/governanca\/\d+$/)
    base = new URL(page.url()).pathname
    idAssembleia = Number(base.split('/').pop())
    await expect(page.getByRole('button', { name: 'Convocar' })).toBeVisible()
    await ver(page, info, 'assembleia do roteiro criada como rascunho')

    await page.getByRole('button', { name: 'Convocar' }).click()
    await expect(
      page.getByRole('button', { name: 'Abrir sessão' }),
    ).toBeVisible()
    await expect(
      page.getByText(/\d+ associados habilitados a votar/),
    ).toBeVisible()
    await ver(page, info, 'assembleia convocada, habilitados congelados')
    await naAuditoria(page, 'assembleias', 'CONVOCADA', idAssembleia)
    expect(vigia.problemas()).toEqual([])
  })

  test('Minhas assembleias: o Secretário e o Tesoureiro justificam a falta (vazia e curta são recusadas)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)

    async function justificarPelaTela(
      papel: 'secretario' | 'tesoureiro',
      motivo: string,
    ): Promise<number> {
      await entrar(page, papel)
      await page.goto('/minhas-assembleias')
      const cartao = cartaoDaAssembleia(page)
      await expect(cartao).toBeVisible()
      await expect(cartao).toContainText('Convocada')
      // antes de a sessão abrir não há chamada: só a justificativa
      await expect(
        cartao.getByRole('button', { name: 'Bater presença' }),
      ).toHaveCount(0)
      await cartao.getByRole('button', { name: 'Enviar justificativa' }).click()
      if (papel === 'secretario') {
        await inventariarSemTravar(
          page,
          info,
          'minhas-assembleias-justificar',
          achadosAssembleia,
        )
      }
      const enviar = cartao
        .getByRole('button', { name: 'Enviar justificativa' })
        .last()
      // recusa 1: sem motivo
      await enviar.click()
      await expect(cartao.getByRole('alert')).toContainText(
        'Descreva o motivo da justificativa.',
      )
      await ver(page, info, `${papel}: justificativa vazia recusada`)
      // recusa 2: motivo curto demais
      await campoEm(cartao, 'Motivo').fill('abc')
      await enviar.click()
      await expect(cartao.getByRole('alert')).toContainText(
        'Descreva o motivo da justificativa.',
      )
      await campoEm(cartao, 'Motivo').fill(motivo)
      const criando = respostaDe(
        page,
        'POST',
        /\/api\/assembleias\/\d+\/justificativas$/,
      )
      await enviar.click()
      const dados = (await (await criando).json()) as {
        id_justificativa: number
        status: string
      }
      expect(dados.status).toBe('Pendente')
      await expect(cartao).toContainText('Justificativa enviada:')
      await expect(cartao).toContainText(motivo)
      await expect(cartao).toContainText('(Pendente)')
      await expect(
        cartao.getByRole('button', { name: 'Enviar justificativa' }),
      ).toHaveCount(0)
      await ver(page, info, `${papel}: justificativa enviada, aguardando`)
      return dados.id_justificativa
    }

    idJustSecretario = await justificarPelaTela('secretario', MOTIVO_SECRETARIO)
    await sair(page)
    idJustTesoureiro = await justificarPelaTela('tesoureiro', MOTIVO_TESOUREIRO)
    expect(vigia.problemas()).toEqual([])
  })

  test('a diretoria aceita uma justificativa, rejeita outra e lança uma em nome de associado (com as recusas); Auditoria', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(base)
    const bloco = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Justificativas de falta' }),
    })
    await expect(bloco).toBeVisible()
    const linha = (nome: string) =>
      bloco.locator('div.rounded-md.border').filter({ hasText: nome })
    const daniel = linha('Daniel Ribeiro Costa')
    const fabio = linha('Fábio Henrique Dias')
    await expect(daniel.getByText('Pendente', { exact: true })).toBeVisible()
    await expect(daniel).toContainText(MOTIVO_SECRETARIO)
    await expect(fabio.getByText('Pendente', { exact: true })).toBeVisible()
    await ver(page, info, 'justificativas pendentes na assembleia convocada')

    const aceitando = respostaDe(
      page,
      'POST',
      /\/api\/justificativas\/\d+\/decidir$/,
    )
    await daniel.getByRole('button', { name: 'Aceitar' }).click()
    expect((await aceitando).status()).toBe(200)
    await expect(daniel.getByText('Aceita', { exact: true })).toBeVisible()
    await expect(daniel.getByRole('button', { name: 'Aceitar' })).toHaveCount(0)
    // rejeitar exige dizer o motivo (o associado precisa saber por que): o botão só abre o campo, e sem motivo o servidor recusa
    await fabio.getByRole('button', { name: 'Rejeitar' }).click()
    await fabio.getByRole('button', { name: 'Confirmar rejeição' }).click()
    await expect(
      bloco.getByRole('alert').filter({ hasText: /motivo da rejeição/ }),
    ).toBeVisible()
    await expect(fabio.getByText('Pendente', { exact: true })).toBeVisible()
    await fabio
      .getByLabel('Motivo da rejeição')
      .fill('Sem comprovante da viagem informada.')
    await fabio.getByRole('button', { name: 'Confirmar rejeição' }).click()
    await expect(fabio.getByText('Rejeitada', { exact: true })).toBeVisible()
    await expect(fabio).toContainText('Sem comprovante da viagem informada.')
    await expect(fabio.getByRole('button', { name: 'Rejeitar' })).toHaveCount(0)
    await ver(page, info, 'uma aceita e outra rejeitada')

    // lançar em nome de associado: a recusa de campo vazio, a recusa do servidor (ninguém escolhido) e o lançamento de verdade
    await page
      .getByRole('button', { name: 'Lançar em nome de associado' })
      .click()
    await inventariarSemTravar(
      page,
      info,
      'detalhe-da-assembleia-lancar-justificativa',
      achadosAssembleia,
    )
    const seletor = bloco.locator('select').filter({
      has: page.locator('option', { hasText: 'Selecione o associado' }),
    })
    const lancar = page.getByRole('button', { name: 'Lançar (já aceita)' })
    // tudo vazio: as DUAS faltas aparecem, cada uma no seu campo
    await lancar.click()
    await expect(bloco.getByRole('alert')).toHaveCount(2)
    await expect(
      bloco
        .getByRole('alert')
        .filter({ hasText: 'Descreva o motivo da justificativa.' }),
    ).toHaveCount(1)
    await expect(
      bloco.getByRole('alert').filter({ hasText: 'Selecione um associado.' }),
    ).toHaveCount(1)
    await bloco.getByPlaceholder('Motivo').fill(MOTIVO_MANUAL)
    await lancar.click()
    await expect(bloco.getByRole('alert')).toHaveCount(1)
    await expect(bloco.getByRole('alert')).toContainText(
      'Selecione um associado.',
    )
    await ver(page, info, 'lancar sem escolher o associado: recusado')
    await escolherQuandoHouver(seletor, 'Leonardo Batista Reis')
    const lancando = respostaDe(
      page,
      'POST',
      /\/api\/assembleias\/\d+\/justificativas$/,
    )
    await lancar.click()
    const lancada = (await (await lancando).json()) as {
      id_justificativa: number
      status: string
    }
    expect(lancada.status).toBe('Aceita')
    idJustManual = lancada.id_justificativa
    const leonardo = linha('Leonardo Batista Reis')
    await expect(leonardo.getByText('Aceita', { exact: true })).toBeVisible()
    await ver(
      page,
      info,
      'justificativa lancada em nome do associado: ja aceita',
    )

    // a mesma pessoa de novo: o sistema recusa
    await page
      .getByRole('button', { name: 'Lançar em nome de associado' })
      .click()
    await escolherQuandoHouver(seletor, 'Leonardo Batista Reis')
    await bloco.getByPlaceholder('Motivo').fill(`Segunda tentativa ${RODADA}`)
    await lancar.click()
    await expect(bloco.getByRole('alert')).toContainText(
      'Já existe justificativa registrada para este associado nesta assembleia.',
    )
    await ver(page, info, 'lancar de novo para a mesma pessoa: recusado')
    // "Cancelar" também é o botão de cancelar a assembleia, no alto da tela: este é o do bloco
    await bloco.getByRole('button', { name: 'Cancelar' }).click()

    const tabela = 'justificativas_falta_assembleia'
    await naAuditoria(page, tabela, 'CREATE', idJustSecretario)
    await naAuditoria(page, tabela, 'CREATE', idJustManual)
    await naAuditoria(page, tabela, 'DECIDIDA', idJustSecretario)
    await naAuditoria(page, tabela, 'DECIDIDA', idJustTesoureiro, info)
    expect(vigia.problemas()).toEqual([])
  })

  test('sessão aberta: código de chamada e, "vendo como Associado" (somente leitura), a chamada e a justificativa são recusadas', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(base)
    await page.getByRole('button', { name: 'Abrir sessão' }).click()
    await expect(
      page.getByRole('button', { name: 'Encerrar sessão' }),
    ).toBeVisible()
    await page.goto(`${base}/sessao`)
    await expect(page.getByRole('heading', { name: /Chamada/ })).toBeVisible()
    await page
      .getByRole('button', { name: 'Mostrar código de chamada' })
      .click()
    const codigoNaTela = page.getByText(/^\d{6}$/).first()
    await expect(codigoNaTela).toBeVisible()
    codigo = (await codigoNaTela.innerText()).trim()
    expect(codigo).toMatch(/^\d{6}$/)
    await ver(page, info, 'sessao aberta com o codigo de chamada')
    await naAuditoria(page, 'assembleias', 'SESSAO_ABERTA', idAssembleia)

    // "ver como Associado": a tela de Minhas assembleias abre, mas nada se grava (o servidor recusa toda escrita nesse modo)
    await page.goto('/acesso')
    await expect(
      page.getByRole('heading', { name: 'Níveis e permissões' }),
    ).toBeVisible()
    page.once('dialog', (janela) => janela.accept())
    await page.getByRole('button', { name: /Ver como Associado/ }).click()
    const faixa = page.getByRole('status').filter({ hasText: 'Vendo como' })
    await expect(faixa).toContainText('somente leitura')
    await expect(page).toHaveURL(/\/$/)
    // sem recarregar a página: o modo "ver como" vive só na memória dela
    await page.getByRole('link', { name: 'Minhas assembleias' }).first().click()
    await expect(page).toHaveURL(/\/minhas-assembleias$/)
    const cartao = cartaoDaAssembleia(page)
    await expect(cartao).toContainText('Em andamento')
    await expect(cartao.getByText('Pendente', { exact: true })).toBeVisible()
    await ver(page, info, 'vendo como Associado: o cartao da assembleia')

    await cartao.getByRole('button', { name: 'Bater presença' }).click()
    await campoEm(cartao, 'Código da sessão').fill(codigo)
    await cartao.getByRole('button', { name: 'Confirmar presença' }).click()
    await expect(cartao.getByRole('alert')).toContainText('somente leitura')
    await ver(
      page,
      info,
      'vendo como: bater presenca com o codigo certo e recusado',
    )
    await cartao
      .getByRole('button', { name: 'Enviar justificativa' })
      .first()
      .click()
    await campoEm(cartao, 'Motivo').fill(
      'Tentativa de justificar vendo como outro nível',
    )
    await cartao
      .getByRole('button', { name: 'Enviar justificativa' })
      .last()
      .click()
    await expect(cartao.getByRole('alert')).toContainText('somente leitura')
    await ver(page, info, 'vendo como: justificar tambem e recusado')

    await faixa.getByRole('button', { name: 'Encerrar' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Vendo como' }),
    ).toHaveCount(0)
    // nada foi gravado: sem recarregar a lista continuaria igual, então confere de verdade
    await page.goto('/minhas-assembleias')
    const depois = cartaoDaAssembleia(page)
    await expect(depois.getByText('Pendente', { exact: true })).toBeVisible()
    await expect(depois).not.toContainText('Justificativa enviada:')
    expect(vigia.problemas()).toEqual([])
  })

  test('autochamada: Secretário com falta justificada e Tesoureiro (código vazio, errado, certo, e uma segunda tentativa recusada)', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)

    // Secretário: a falta dele foi aceita, e o cartão diz isso
    await entrar(page, 'secretario')
    await page.goto('/minhas-assembleias')
    const cartaoSecretario = cartaoDaAssembleia(page)
    await expect(cartaoSecretario).toContainText('Em andamento')
    await expect(
      cartaoSecretario.getByText('Falta justificada', { exact: true }),
    ).toBeVisible()
    await expect(cartaoSecretario).toContainText('(Aceita)')
    await ver(page, info, 'Secretario: falta justificada aceita pela diretoria')
    await sair(page)

    // Tesoureiro: a justificativa foi rejeitada, então a presença continua pendente e ele pode se autochamar
    await entrar(page, 'tesoureiro')
    await page.goto('/minhas-assembleias')
    const cartao = cartaoDaAssembleia(page)
    await expect(cartao).toContainText('Em andamento')
    await expect(cartao).toContainText('(Rejeitada)')
    await expect(cartao.getByText('Pendente', { exact: true })).toBeVisible()
    await cartao.getByRole('button', { name: 'Bater presença' }).click()
    await inventariarSemTravar(
      page,
      info,
      'minhas-assembleias-bater-presenca',
      achadosAssembleia,
    )
    const confirmar = cartao.getByRole('button', { name: 'Confirmar presença' })
    // recusa 1: sem código
    await confirmar.click()
    await expect(cartao.getByRole('alert')).toContainText(
      'Informe o código de chamada.',
    )
    await ver(page, info, 'autochamada sem codigo: recusada')
    // recusa 2: código errado
    const errado = codigo === '123456' ? '654321' : '123456'
    await campoEm(cartao, 'Código da sessão').fill(errado)
    await confirmar.click()
    await expect(cartao.getByRole('alert')).toContainText(
      'Código de chamada incorreto',
    )
    await ver(page, info, 'autochamada com codigo errado: recusada')
    await expect(cartao.getByText('Pendente', { exact: true })).toBeVisible()

    // uma segunda aba, aberta ANTES de a presença existir, guarda a tela "desatualizada" para a segunda tentativa
    const aba2 = await page.context().newPage()
    const vigia2 = vigiar(aba2)
    await aba2.goto('/minhas-assembleias')
    const cartao2 = cartaoDaAssembleia(aba2)
    await expect(
      cartao2.getByRole('button', { name: 'Bater presença' }),
    ).toBeVisible()
    await cartao2.getByRole('button', { name: 'Bater presença' }).click()
    await campoEm(cartao2, 'Código da sessão').fill(codigo)

    // código certo na primeira aba: a presença é registrada
    await campoEm(cartao, 'Código da sessão').fill(codigo)
    const batendo = respostaDe(
      page,
      'POST',
      /\/api\/assembleias\/\d+\/bater-presenca$/,
    )
    await confirmar.click()
    const registrada = await batendo
    expect(registrada.status()).toBe(200)
    idCredAutochamada = (
      (await registrada.json()) as { id_credenciamento: number }
    ).id_credenciamento
    await expect(cartao.getByText('Presente', { exact: true })).toBeVisible()
    await expect(
      cartao.getByRole('button', { name: 'Bater presença' }),
    ).toHaveCount(0)
    await ver(page, info, 'autochamada aceita: o Tesoureiro esta Presente')

    // segunda tentativa (pela aba desatualizada): o servidor recusa, a pessoa já está presente
    await cartao2.getByRole('button', { name: 'Confirmar presença' }).click()
    await expect(cartao2.getByRole('alert')).toContainText(
      'Associado já está credenciado e presente nesta sessão.',
    )
    await ver(aba2, info, 'segunda autochamada (aba desatualizada): recusada')
    await aba2.close()
    expect(vigia.problemas()).toEqual([])
    expect(vigia2.problemas()).toEqual([])
  })

  test('sessão: credencia a Presidente, quórum (pela mesa e pela autochamada), pauta, votação, voto, apuração e encerramento', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(`${base}/sessao`)
    await expect(page.getByRole('heading', { name: /Chamada/ })).toBeVisible()
    // o Tesoureiro, que se autochamou, já aparece na lista da mesa
    await expect(
      page.getByText('Fábio Henrique Dias de Teste · Presencial'),
    ).toBeVisible()
    await escolherQuandoHouver(campo(page, 'Associado'), 'Marta Souza')
    await page.getByRole('button', { name: 'Credenciar', exact: true }).click()
    await expect(
      page.getByText(/Marta Souza de Teste.* · Presencial/),
    ).toBeVisible()
    const minimo = await atingirQuorum(page)
    await expect(page.getByText('Atingido', { exact: true })).toBeVisible()
    await ver(page, info, `quorum atingido (${minimo} credenciados)`)

    // pauta, votação aberta, voto (e o voto repetido recusado, que também prova que o primeiro foi gravado)
    await campo(page, 'Título').first().fill(TITULO_ITEM)
    await campo(page, 'Tempo (min)').fill('10')
    await page.getByRole('button', { name: 'Adicionar item' }).click()
    await expect(page.getByText(TITULO_ITEM).first()).toBeVisible()
    await page.getByRole('button', { name: 'Abrir votação' }).click()
    await expect(page.getByText('Em votação', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Abrir votação' }).last().click()
    await campo(page, 'Título').last().fill(TITULO_VOTACAO)
    await campo(page, 'Opções (separadas por vírgula)').fill('Sim, Não')
    await page.getByRole('button', { name: 'Abrir votação' }).last().click()
    await expect(
      page.getByRole('button', { name: 'Apurar e encerrar votação' }),
    ).toBeVisible()
    await page.getByLabel('Sua opção de voto').first().selectOption('Sim')
    await page
      .getByRole('button', { name: 'Votar', exact: true })
      .first()
      .click()
    await page.getByLabel('Sua opção de voto').first().selectOption('Não')
    await page
      .getByRole('button', { name: 'Votar', exact: true })
      .first()
      .click()
    await expect(
      page.getByText('Associado já votou nesta votação.'),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Apurar e encerrar votação' })
      .click()
    await expect(page.getByText(/Hash de integridade/)).toBeVisible()
    await ver(page, info, 'votacao apurada com hash de integridade')

    await campo(page, 'Descrição').fill(OCORRENCIA)
    await page.getByRole('button', { name: 'Registrar ocorrência' }).click()
    await expect(page.getByText(OCORRENCIA)).toBeVisible()
    await page.getByRole('button', { name: 'Encerrar item' }).first().click()
    await expect(page.getByText('Encerrado', { exact: true })).toBeVisible()
    await page.goto(base)
    await page.getByRole('button', { name: 'Encerrar sessão' }).click()
    await expect(
      page.getByRole('button', { name: 'Encerrar sessão' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: 'Ata', exact: true }),
    ).toBeVisible()
    await ver(page, info, 'sessao encerrada: a assembleia esta Realizada')

    await naAuditoria(
      page,
      'credenciamentos_assembleia',
      'AUTOCHAMADA',
      idCredAutochamada,
    )
    await naAuditoria(
      page,
      'assembleias',
      'SESSAO_ENCERRADA',
      idAssembleia,
      info,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('detalhe da assembleia encerrada: habilitados, edital, justificativas, lançar depois do fim (recusado) e corrigir presença', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(base)
    await expect(
      page.getByText('Realizada', { exact: true }).first(),
    ).toBeVisible()
    for (const botao of ['Abrir sessão', 'Encerrar sessão', 'Convocar']) {
      await expect(page.getByRole('button', { name: botao })).toHaveCount(0)
    }
    await expect(
      page.getByRole('link', { name: 'Corrigir presença' }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Ata', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(/\d+ associados habilitados a votar/),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Ver edital' }).click()
    await expect(
      page.getByText('EDITAL DE CONVOCAÇÃO PARA ASSEMBLEIA GERAL ORDINÁRIA'),
    ).toBeVisible()
    await expect(page.locator('pre')).toContainText(PAUTA)
    await page.getByRole('button', { name: 'Ocultar edital' }).click()

    // as justificativas decididas continuam à vista
    const bloco = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Justificativas de falta' }),
    })
    const linha = (nome: string) =>
      bloco.locator('div.rounded-md.border').filter({ hasText: nome })
    await expect(
      linha('Daniel Ribeiro Costa').getByText('Aceita', { exact: true }),
    ).toBeVisible()
    await expect(
      linha('Fábio Henrique Dias').getByText('Rejeitada', { exact: true }),
    ).toBeVisible()
    await expect(
      linha('Leonardo Batista Reis').getByText('Aceita', { exact: true }),
    ).toBeVisible()
    await ver(page, info, 'detalhe da assembleia realizada')

    // o servidor só aceita justificativa até o encerramento da sessão: depois do fim a tela NÃO oferece "lançar" e explica por quê
    await expect(
      page.getByRole('button', { name: 'Lançar em nome de associado' }),
    ).toHaveCount(0)
    await expect(bloco).toContainText(
      'Depois do encerramento da sessão não se lança mais justificativa',
    )
    await ver(
      page,
      info,
      'sessao encerrada: a tela nao oferece lancar justificativa',
    )

    // corrigir presença: quem faltou é marcado pela mesa mesmo com a sessão encerrada
    await page.getByRole('link', { name: 'Corrigir presença' }).click()
    await expect(page).toHaveURL(/\/sessao$/)
    await expect(page.getByRole('heading', { name: /Chamada/ })).toBeVisible()
    await expect(page.getByText(/A sessão já foi encerrada/)).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Registrar saída' }),
    ).toHaveCount(0)
    const faltante = page
      .locator('div.rounded-md')
      .filter({ has: page.getByRole('button', { name: 'Marcar presença' }) })
      .first()
    corrigido = (await faltante.locator('span').first().innerText()).trim()
    expect(corrigido.length).toBeGreaterThan(3)
    const corrigindo = respostaDe(
      page,
      'POST',
      /\/api\/assembleias\/\d+\/credenciamentos\/manual$/,
    )
    await faltante.getByRole('button', { name: 'Marcar presença' }).click()
    const correcao = await corrigindo
    expect(
      correcao.status(),
      `correção manual de ${corrigido}: ${await correcao.text()} (pedido: ${correcao.request().postData()})`,
    ).toBe(200)
    idCorrecao = ((await correcao.json()) as { id_credenciamento: number })
      .id_credenciamento
    await expect(page.getByText(`${corrigido} · Presencial`)).toBeVisible()
    await ver(page, info, `presenca corrigida depois do fim: ${corrigido}`)

    // credenciar de novo quem já está presente: recusado
    await escolherQuandoHouver(campo(page, 'Associado'), 'Marta Souza')
    await page.getByRole('button', { name: 'Credenciar', exact: true }).click()
    await expect(
      page
        .getByText('Associado já está credenciado e presente nesta sessão.')
        .first(),
    ).toBeVisible()
    await ver(page, info, 'credenciar quem ja esta presente: recusado')

    await naAuditoria(
      page,
      'credenciamentos_assembleia',
      'CORRECAO_MANUAL',
      idCorrecao,
      info,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('ata: gerar do registro da sessão (presença, votação, ocorrência), segunda tela recusada, relato da secretaria', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(`${base}/ata`)
    await expect(
      page.getByText('Esta assembleia ainda não tem ata gerada.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Gerar ata' })).toBeVisible()
    await ver(page, info, 'ata ainda nao gerada')

    // uma segunda aba, aberta ANTES de a ata existir, tenta gerar a ata depois da primeira
    const aba2 = await page.context().newPage()
    const vigia2 = vigiar(aba2)
    await aba2.goto(`${base}/ata`)
    await expect(aba2.getByRole('button', { name: 'Gerar ata' })).toBeVisible()

    const gerando = respostaDe(page, 'POST', /\/api\/assembleias\/\d+\/ata$/)
    await page.getByRole('button', { name: 'Gerar ata' }).click()
    const gerada = await gerando
    expect(gerada.status()).toBe(200)
    idAta = ((await gerada.json()) as { id_ata: number }).id_ata
    await expect(
      page.getByRole('heading', { name: 'Ata (rascunho)' }),
    ).toBeVisible()
    await expect(page.getByText('Rascunho', { exact: true })).toBeVisible()

    // o corpo é gerado do que a sessão registrou
    const corpo = page.locator('pre').first()
    await expect(corpo).toContainText('ATA DE ASSEMBLEIA GERAL ORDINÁRIA')
    await expect(corpo).toContainText('PRESENÇA')
    await expect(corpo).toContainText(/Credenciados: \d+/)
    await expect(corpo).toContainText('Marta Souza de Teste (Presidente)')
    await expect(corpo).toContainText(
      'Fábio Henrique Dias de Teste (Presencial)',
    )
    await expect(corpo).toContainText(corrigido)
    await expect(corpo).toContainText('ORDEM DO DIA')
    await expect(corpo).toContainText(PAUTA)
    await expect(corpo).toContainText(`${TITULO_ITEM} - Encerrado`)
    await expect(corpo).toContainText(`Votação '${TITULO_VOTACAO}'`)
    await expect(corpo).toContainText(
      /vencedor: Sim, aprovado: Sim, hash: [0-9a-f]{64}/,
    )
    await expect(corpo).toContainText('OCORRÊNCIAS')
    await expect(corpo).toContainText(OCORRENCIA)
    await ver(page, info, 'ata gerada do registro da sessao')

    // a segunda aba (desatualizada): o servidor recusa a segunda ata, e a tela tem que dizer isso
    const gerandoDeNovo = respostaDe(
      aba2,
      'POST',
      /\/api\/assembleias\/\d+\/ata$/,
    )
    await aba2.getByRole('button', { name: 'Gerar ata' }).click()
    expect((await gerandoDeNovo).status()).toBe(400)
    await aba2.waitForTimeout(2000)
    const recusaVisivel = await aba2
      .getByText(/já tem ata/)
      .first()
      .isVisible()
    await ver(aba2, info, 'segunda geracao da ata: a recusa do servidor')
    if (!recusaVisivel) {
      achadosAssembleia.push(
        'Gerar ata de novo: o servidor recusa ("Esta assembleia já tem ata") mas a tela não mostra a recusa (o bloco some e a página fica em branco): Ata.tsx, condição `ataNaoExiste` olha gerar.error',
      )
    }
    await aba2.close()

    // relato da secretaria: o único texto livre, só no rascunho
    const relato = `Relato da secretaria ${RODADA}: sessão sem intercorrências, lista de presença conferida.`
    const campoDoRelato = campo(
      page,
      'Relato da secretaria (único texto livre)',
    )
    await campoDoRelato.fill(relato)
    const salvando = respostaDe(page, 'PUT', /\/relato-secretaria$/)
    await page.getByRole('button', { name: 'Salvar relato' }).click()
    expect((await salvando).status()).toBe(200)
    await page.goto(`${base}/ata`)
    await expect(campoDoRelato).toHaveValue(relato)
    await ver(page, info, 'relato salvo (volta igual depois de recarregar)')

    await naAuditoria(page, 'atas', 'CREATE', idAta)
    await naAuditoria(page, 'atas', 'RELATO_SECRETARIA_ATUALIZADO', idAta, info)
    expect(vigia.problemas()).toEqual([])
    expect(vigia2.problemas()).toEqual([])
  })

  test('ata: documento oficial anexado (arquivo ruim recusado), aberto de volta com status 200, protocolo e troca do anexo', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(`${base}/ata`)
    await expect(
      page.getByRole('heading', { name: 'Ata (rascunho)' }),
    ).toBeVisible()
    const anexar = page.getByRole('button', { name: 'Anexar documento' })
    const arquivo = page.locator('input[type="file"]')
    await expect(anexar).toBeDisabled()
    await ver(
      page,
      info,
      'ata sem documento: anexar fica desligado sem arquivo',
    )

    // recusa 1: formato que o sistema não aceita
    await arquivo.setInputFiles({
      name: `ata-${RODADA}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('texto solto'),
    })
    await anexar.click()
    await expect(
      page.getByText('Formato não suportado. Use PDF, JPG ou PNG.'),
    ).toBeVisible()
    // recusa 2: tem nome de PDF, mas o conteúdo não é PDF
    await arquivo.setInputFiles({
      name: `ata-falsa-${RODADA}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from('isto não é um PDF de verdade'),
    })
    await anexar.click()
    await expect(
      page.getByText(
        'O conteúdo do arquivo não confere com a extensão informada.',
      ),
    ).toBeVisible()
    await ver(page, info, 'arquivo que nao e PDF de verdade: recusado')
    await expect(
      page.getByRole('button', { name: 'Baixar documento anexado' }),
    ).toHaveCount(0)

    // o documento assinado de verdade, com protocolo do cartório
    const nome1 = `ata-assinada-${RODADA}.pdf`
    const protocolo = `PROT-${RODADA}`
    await arquivo.setInputFiles({
      name: nome1,
      mimeType: 'application/pdf',
      buffer: pdfDeTeste(`PRIMEIRO ${RODADA}`),
    })
    await page
      .getByPlaceholder('Nº de protocolo no cartório (opcional)')
      .fill(protocolo)
    await page.locator('input[type="date"]').fill('2026-03-15')
    const anexando = respostaDe(
      page,
      'POST',
      /\/api\/atas\/\d+\/documento-assinado$/,
    )
    await anexar.click()
    expect((await anexando).status()).toBe(200)
    await expect(
      page.getByRole('button', { name: 'Baixar documento anexado' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Substituir anexo' }),
    ).toBeVisible()
    const frase = page.getByText(`Protocolo ${protocolo}`)
    await expect(frase).toBeVisible()
    const textoDoProtocolo = await frase.innerText()
    if (!textoDoProtocolo.includes('em 15/03/2026')) {
      achadosAssembleia.push(
        `data do protocolo no cartório: digitada 15/03/2026, a tela mostra "${textoDoProtocolo.replace(/\s+/g, ' ')}" (Ata.tsx formata com formatarData uma data que o servidor devolve como meia-noite sem fuso; em Belém cai no dia anterior)`,
      )
    }
    await ver(page, info, 'documento assinado anexado, com protocolo')

    // abrir o original de volta: a chamada tem que responder 200 e entregar o mesmo PDF
    async function baixar(nomeEsperado: string, marca: string) {
      const abrindo = respostaDe(
        page,
        'GET',
        /\/api\/documentos\/\d+\/original$/,
      )
      const baixando = page.waitForEvent('download')
      await page
        .getByRole('button', { name: 'Baixar documento anexado' })
        .click()
      const resposta = await abrindo
      expect(resposta.status()).toBe(200)
      expect(resposta.headers()['content-type']).toContain('application/pdf')
      idDocumento = Number(
        /\/api\/documentos\/(\d+)\/original/.exec(resposta.url())?.[1],
      )
      const baixado = await baixando
      expect(baixado.suggestedFilename()).toBe(nomeEsperado)
      const conteudo = fs.readFileSync(
        (await baixado.path()) as string,
        'latin1',
      )
      expect(conteudo.startsWith('%PDF-1.4')).toBe(true)
      expect(conteudo).toContain(marca)
      return conteudo
    }
    await baixar(nome1, `PRIMEIRO ${RODADA}`)
    await ver(page, info, 'original aberto de volta (200) e igual ao enviado')

    // trocar o anexo: o botão passa a "Substituir anexo" e o novo arquivo é o que se baixa
    const nome2 = `ata-assinada-v2-${RODADA}.pdf`
    await arquivo.setInputFiles({
      name: nome2,
      mimeType: 'application/pdf',
      buffer: pdfDeTeste(`SEGUNDO ${RODADA}`),
    })
    const trocando = respostaDe(
      page,
      'POST',
      /\/api\/atas\/\d+\/documento-assinado$/,
    )
    await page.getByRole('button', { name: 'Substituir anexo' }).click()
    expect((await trocando).status()).toBe(200)
    const depoisDaTroca = await baixar(nome2, `SEGUNDO ${RODADA}`)
    expect(depoisDaTroca).not.toContain(`PRIMEIRO ${RODADA}`)
    await ver(page, info, 'anexo trocado: baixa o segundo arquivo')

    await naAuditoria(page, 'atas', 'DOCUMENTO_ASSINADO_ANEXADO', idAta)
    await naAuditoria(page, 'documentos_institucionais', 'CRIADO', idDocumento)
    await naAuditoria(
      page,
      'documentos_institucionais',
      'ORIGINAL_ENVIADO',
      idDocumento,
    )
    await naAuditoria(
      page,
      'documentos_institucionais',
      'ORIGINAL_BAIXADO',
      idDocumento,
      info,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('ata: deliberações (campo vazio, ano de exercício e parecer do Conselho Fiscal recusados), conclusão com certidão e revogação', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const TEXTO_GENERICA = `Genérica ${RODADA}: encaminhar o relatório anual aos associados`
    const TEXTO_DISSOLUCAO = `Dissolução ${RODADA}: proposta apenas para conferir a revogação`
    const TEXTO_CONTAS = `Contas ${RODADA}: aprovar a prestação de contas do exercício`
    await entrar(page, 'presidente')
    await page.goto(`${base}/ata`)
    await expect(
      page.getByRole('heading', { name: 'Deliberações' }),
    ).toBeVisible()

    const tipo = () =>
      page.locator('select').filter({
        has: page.locator('option[value="Reforma de estatuto"]'),
      })
    const registrar = () =>
      page.getByRole('button', { name: 'Registrar', exact: true })
    const linhaDe = (texto: string) =>
      page.locator('div.rounded-md.border').filter({ hasText: texto }).first()

    await page.getByRole('button', { name: 'Registrar deliberação' }).click()
    await inventariarSemTravar(
      page,
      info,
      'ata-formulario-de-deliberacao',
      achadosAssembleia,
    )
    // recusa 1: sem texto
    await registrar().click()
    await expect(page.getByRole('alert')).toContainText(
      'Descreva a deliberação.',
    )
    await ver(page, info, 'deliberacao sem texto: recusada')

    // recusa 2: aprovação de contas sem o ano de exercício (o formulário tem que dizer o que falta)
    await tipo().selectOption('Aprovação de contas')
    await page.getByPlaceholder('Texto da deliberação').fill(TEXTO_CONTAS)
    await registrar().click()
    await page.waitForTimeout(1500)
    if ((await page.getByText(/Informe o ano de exercício/).count()) === 0) {
      achadosAssembleia.push(
        'Aprovação de contas sem o ano de exercício: o formulário não registra nem diz o que falta (Ata.tsx não mostra o erro do campo ano_exercicio)',
      )
    }
    await ver(page, info, 'aprovacao de contas sem o ano de exercicio')

    // recusa 3: o ano existe, mas não há parecer do Conselho Fiscal para ele (v2.6)
    await page.getByPlaceholder('Ano de exercício').fill('1999')
    await registrar().click()
    await expect(page.getByRole('alert')).toContainText(
      'Não existe parecer do Conselho Fiscal para o exercício 1999',
    )
    await expect(
      page.locator('div.rounded-md.border').filter({ hasText: TEXTO_CONTAS }),
    ).toHaveCount(0)
    await ver(
      page,
      info,
      'aprovacao de contas sem parecer do Conselho Fiscal: recusada',
    )
    // (a aprovação de contas COM parecer não dá para provar por aqui: emitir parecer exige um membro do Conselho Fiscal, e o robô não tem esse login)
    await page.getByRole('button', { name: 'Cancelar' }).click()

    async function registrarDeliberacao(
      tipoDaDeliberacao: string,
      texto: string,
    ): Promise<number> {
      const botao = page.getByRole('button', { name: 'Registrar deliberação' })
      if ((await botao.count()) > 0) await botao.click()
      await tipo().selectOption(tipoDaDeliberacao)
      await page.getByPlaceholder('Texto da deliberação').fill(texto)
      const criando = respostaDe(
        page,
        'POST',
        /\/api\/atas\/\d+\/deliberacoes$/,
      )
      await registrar().click()
      const criada = (await (await criando).json()) as {
        id_deliberacao: number
        status_execucao: string
      }
      expect(criada.status_execucao).toBe('Pendente')
      await expect(
        linhaDe(texto).getByText('Pendente', { exact: true }),
      ).toBeVisible()
      return criada.id_deliberacao
    }

    // genérica: conclui com observação e emite a certidão
    const idGenerica = await registrarDeliberacao('Genérica', TEXTO_GENERICA)
    const generica = linhaDe(TEXTO_GENERICA)
    await ver(page, info, 'deliberacao generica registrada, pendente')
    await generica
      .getByRole('button', { name: 'Concluir', exact: true })
      .click()
    await generica
      .getByPlaceholder('Observação da conclusão')
      .fill('Cumprida na própria reunião')
    const concluindo = respostaDe(
      page,
      'POST',
      /\/api\/deliberacoes\/\d+\/concluir$/,
    )
    await generica.getByRole('button', { name: 'Concluir deliberação' }).click()
    expect((await concluindo).status()).toBe(200)
    await expect(generica.getByText('Concluída', { exact: true })).toBeVisible()
    await expect(generica).toContainText(
      'Observação: Cumprida na própria reunião',
    )
    await expect(generica).toContainText('0 certidão(ões) emitida(s)')
    const emitindo = respostaDe(
      page,
      'POST',
      /\/api\/deliberacoes\/\d+\/certidao$/,
    )
    await generica.getByRole('button', { name: 'Emitir certidão' }).click()
    const certidao = (await (await emitindo).json()) as { id_certidao: number }
    await expect(generica.locator('pre')).toContainText(
      'CERTIDÃO DE DELIBERAÇÃO Nº',
    )
    await expect(generica.locator('pre')).toContainText(
      'Status de execução: Concluída',
    )
    await expect(generica).toContainText('1 certidão(ões) emitida(s)')
    await ver(page, info, 'deliberacao concluida com certidao emitida')

    // dissolução: revoga (motivo vazio e curto são recusados); depois de revogada não oferece mais nada
    const idDissolucao = await registrarDeliberacao(
      'Dissolução',
      TEXTO_DISSOLUCAO,
    )
    const dissolucao = linhaDe(TEXTO_DISSOLUCAO)
    await dissolucao.getByRole('button', { name: 'Revogar' }).click()
    const revogar = dissolucao.getByRole('button', { name: 'Revogar' }).last()
    await revogar.click()
    await expect(dissolucao.getByRole('alert')).toContainText(
      'Descreva o motivo da revogação.',
    )
    await dissolucao.getByPlaceholder('Motivo da revogação').fill('abc')
    await revogar.click()
    await expect(dissolucao.getByRole('alert')).toContainText(
      'Descreva o motivo da revogação.',
    )
    await ver(page, info, 'revogar sem motivo (ou com motivo curto): recusado')
    await dissolucao
      .getByPlaceholder('Motivo da revogação')
      .fill('Proposta retirada pela diretoria')
    await revogar.click()
    await expect(
      dissolucao.getByText('Revogada', { exact: true }),
    ).toBeVisible()
    await expect(dissolucao).toContainText(
      'Motivo: Proposta retirada pela diretoria',
    )
    await expect(
      dissolucao.getByRole('button', { name: 'Concluir', exact: true }),
    ).toHaveCount(0)
    await ver(page, info, 'deliberacao revogada')

    await naAuditoria(page, 'deliberacoes', 'CREATE', idGenerica)
    await naAuditoria(page, 'deliberacoes', 'CONCLUIDA', idGenerica)
    await naAuditoria(
      page,
      'certidoes_deliberacao',
      'CREATE',
      certidao.id_certidao,
    )
    await naAuditoria(page, 'deliberacoes', 'REVOGADA', idDissolucao, info)
    expect(vigia.problemas()).toEqual([])
  })

  test('ata: deliberação de eleição (cria o mandato, com as recusas) e de reforma de estatuto (registra a pendência)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const TEXTO_ELEICAO = `Eleição ${RODADA}: posse de novo 2º Secretário por vacância`
    const TEXTO_REFORMA = `Reforma ${RODADA}: alterar o prazo de convocação das assembleias`
    await entrar(page, 'presidente')
    await page.goto(`${base}/ata`)
    await expect(
      page.getByRole('heading', { name: 'Deliberações' }),
    ).toBeVisible()

    const tipo = () =>
      page.locator('select').filter({
        has: page.locator('option[value="Reforma de estatuto"]'),
      })
    const linhaDe = (texto: string) =>
      page.locator('div.rounded-md.border').filter({ hasText: texto }).first()
    async function registrarDeliberacao(
      tipoDaDeliberacao: string,
      texto: string,
    ): Promise<number> {
      const botao = page.getByRole('button', { name: 'Registrar deliberação' })
      if ((await botao.count()) > 0) await botao.click()
      await tipo().selectOption(tipoDaDeliberacao)
      await page.getByPlaceholder('Texto da deliberação').fill(texto)
      const criando = respostaDe(
        page,
        'POST',
        /\/api\/atas\/\d+\/deliberacoes$/,
      )
      await page.getByRole('button', { name: 'Registrar', exact: true }).click()
      const criada = (await (await criando).json()) as {
        id_deliberacao: number
      }
      await expect(
        linhaDe(texto).getByText('Pendente', { exact: true }),
      ).toBeVisible()
      return criada.id_deliberacao
    }

    // eleição: o botão de concluir só liga com o mandato preenchido; o servidor recusa código de cargo inexistente e associado não escolhido
    await registrarDeliberacao('Eleição', TEXTO_ELEICAO)
    const eleicao = linhaDe(TEXTO_ELEICAO)
    await eleicao.getByRole('button', { name: 'Concluir', exact: true }).click()
    const concluir = eleicao.getByRole('button', {
      name: 'Concluir deliberação',
    })
    await expect(concluir).toBeDisabled()
    await inventariarSemTravar(
      page,
      info,
      'ata-concluir-eleicao-com-mandato',
      achadosAssembleia,
    )
    const eleito = eleicao.locator('select')
    await escolherQuandoHouver(eleito, 'Nelson Fonseca Prado')
    await eleicao.getByPlaceholder(/^Órgão/).fill('ORGAO_INEXISTENTE')
    await eleicao.getByPlaceholder(/^Cargo/).fill('CARGO_INEXISTENTE')
    await eleicao
      .locator('input[type="date"]')
      .fill(new Date().toISOString().slice(0, 10))
    await expect(concluir).toBeEnabled()
    await concluir.click()
    await expect(
      eleicao.getByText(
        /não existe \(ou está inativo\) no catálogo 'orgao_direcao'/,
      ),
    ).toBeVisible()
    await ver(page, info, 'eleicao com orgao inexistente: recusada')
    // órgão e cargo certos, mas ninguém escolhido como eleito
    await eleicao.getByPlaceholder(/^Órgão/).fill('DIRETORIA_EXECUTIVA')
    await eleicao.getByPlaceholder(/^Cargo/).fill('VICE_SECRETARIO')
    await eleito.selectOption('0')
    await concluir.click()
    await expect(eleicao.getByText('Associado não encontrado.')).toBeVisible()
    await ver(page, info, 'eleicao sem escolher o eleito: recusada')
    // o cargo de 2º Secretário já tem titular na diretoria de teste (a Elisa, desde a semente): dar posse a um segundo titular no mesmo
    // período tem que ser recusado ("cargo ocupado"). Se o servidor aceitar, é achado (e o mandato extra é encerrado logo abaixo).
    await escolherPorTexto(eleito, 'Nelson Fonseca Prado')
    const tentando = respostaDe(
      page,
      'POST',
      /\/api\/deliberacoes\/\d+\/concluir$/,
    )
    await concluir.click()
    const tentativa = await tentando
    let rotuloDoOrgao = 'Diretoria Executiva'
    let concluida = tentativa
    if (tentativa.status() === 409) {
      await expect(eleicao.getByText(/ocupado/)).toBeVisible()
      await ver(
        page,
        info,
        'eleicao para cargo que ja tem titular: recusada (cargo ocupado)',
      )
      // órgão sem titular para o mesmo cargo: as vagas de verdade estão todas cheias e uma posse extra não se desfaz sozinha
      await eleicao.getByPlaceholder(/^Órgão/).fill('CONSELHO_FISCAL')
      rotuloDoOrgao = 'Conselho Fiscal'
      const concluindo = respostaDe(
        page,
        'POST',
        /\/api\/deliberacoes\/\d+\/concluir$/,
      )
      await concluir.click()
      concluida = await concluindo
    } else {
      achadosAssembleia.push(
        'Eleição: o servidor deu posse a um segundo titular no cargo de 2º Secretário, que já tinha titular no mesmo período (app/routers/mandatos.py, criar_mandato não confere as vagas do cargo)',
      )
    }
    expect(concluida.status()).toBe(200)
    const idMandato = (
      (await concluida.json()) as { mandatos_criados: number[] }
    ).mandatos_criados[0] as number
    expect(idMandato).toBeGreaterThan(0)
    await expect(eleicao.getByText('Concluída', { exact: true })).toBeVisible()
    await ver(page, info, 'eleicao concluida: o mandato foi criado')

    // o mandato aparece em Mandatos; encerra em seguida para não deixar a Diretoria de teste com um titular a mais
    await page.goto('/governanca/mandatos')
    await expect(
      page.getByRole('heading', { name: 'Mandatos e órgãos' }),
    ).toBeVisible()
    const mandatos = page
      .locator('div.rounded-md.border')
      .filter({ hasText: 'Nelson Fonseca Prado' })
      .filter({ hasText: 'Vigente' })
    await expect(mandatos.first()).toBeVisible()
    await expect(mandatos.first()).toContainText(
      new RegExp(`${rotuloDoOrgao} · .*Secretário`),
    )
    await ver(page, info, 'mandato da eleicao em Mandatos')
    const antes = await mandatos.count()
    await mandatos
      .first()
      .getByRole('button', { name: 'Encerrar mandato' })
      .click()
    await page.getByRole('button', { name: 'Confirmar encerramento' }).click()
    await expect(mandatos).toHaveCount(antes - 1)

    // reforma de estatuto: concluir registra uma pendência manual (cartório e nova regra estatutária)
    await page.goto(`${base}/ata`)
    await expect(
      page.getByRole('heading', { name: 'Deliberações' }),
    ).toBeVisible()
    const idReforma = await registrarDeliberacao(
      'Reforma de estatuto',
      TEXTO_REFORMA,
    )
    const reforma = linhaDe(TEXTO_REFORMA)
    await reforma.getByRole('button', { name: 'Concluir', exact: true }).click()
    await reforma.getByRole('button', { name: 'Concluir deliberação' }).click()
    await expect(reforma.getByText('Concluída', { exact: true })).toBeVisible()
    await page.waitForTimeout(1500)
    if ((await reforma.getByText(/Pendência registrada/).count()) === 0) {
      achadosAssembleia.push(
        'Concluir reforma de estatuto: o servidor devolve a pendência (cartório e nova regra) mas a tela não a mostra, porque fecha o painel de conclusão antes (Ata.tsx, invalidar() chama setAba("nenhuma") e a mensagem fica dentro do painel)',
      )
    }
    await ver(page, info, 'reforma de estatuto concluida: a pendencia')

    await naAuditoria(page, 'mandatos', 'CREATE', idMandato)
    // (sem o número do registro: a linha encerrada acima é a primeira da lista, que pode não ser a que a eleição criou se sobrou outra de rodada antiga)
    await naAuditoria(page, 'mandatos', 'ENCERRADO')
    await naAuditoria(
      page,
      'deliberacoes',
      'PENDENCIA_REFORMA_ESTATUTO',
      idReforma,
      info,
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('ata: travar o registro (numerar) e retificar (motivo vazio recusado)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(`${base}/ata`)
    await expect(
      page.getByRole('heading', { name: 'Ata (rascunho)' }),
    ).toBeVisible()
    // sem número, a ata ainda não pode ser retificada
    await expect(
      page.getByRole('button', { name: 'Retificar (corrigir sem editar)' }),
    ).toHaveCount(0)
    const travando = respostaDe(page, 'POST', /\/api\/atas\/\d+\/assinar$/)
    await page
      .getByRole('button', { name: 'Travar registro interno (numerar)' })
      .click()
    const travada = (await (await travando).json()) as {
      numero_sequencial: number
      status: string
    }
    expect(travada.status).toBe('Assinada')
    numeroAta = travada.numero_sequencial
    await expect(
      page.getByRole('heading', { name: `Ata nº ${numeroAta}`, exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Assinada', { exact: true })).toBeVisible()
    // travada: o relato não muda mais e os botões de rascunho somem
    await expect(
      campo(page, 'Relato da secretaria (único texto livre)'),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Salvar relato' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Travar registro interno (numerar)' }),
    ).toHaveCount(0)
    await ver(page, info, `ata travada: numero ${numeroAta}`)

    await page
      .getByRole('button', { name: 'Retificar (corrigir sem editar)' })
      .click()
    await inventariarSemTravar(
      page,
      info,
      'ata-formulario-de-retificacao',
      achadosAssembleia,
    )
    const criar = page.getByRole('button', { name: 'Criar retificação' })
    await criar.click()
    await expect(page.getByRole('alert')).toContainText(
      'Descreva o motivo da retificação.',
    )
    await page.getByPlaceholder('Motivo da retificação').fill('abc')
    await criar.click()
    await expect(page.getByRole('alert')).toContainText(
      'Descreva o motivo da retificação.',
    )
    await ver(
      page,
      info,
      'retificar sem motivo (ou com motivo curto): recusado',
    )
    const motivo = `Correção do nome de um presente (${RODADA})`
    await page.getByPlaceholder('Motivo da retificação').fill(motivo)
    const retificando = respostaDe(page, 'POST', /\/api\/atas\/\d+\/retificar$/)
    await criar.click()
    const retificada = await retificando
    expect(retificada.status()).toBe(200)
    idRetificacao = ((await retificada.json()) as { id_ata: number }).id_ata
    expect(idRetificacao).not.toBe(idAta)
    await expect(
      page.getByText(`Retificação da ata #${idAta} — motivo: ${motivo}`),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Ata (rascunho)' }),
    ).toBeVisible()
    await ver(
      page,
      info,
      'retificacao criada (a ata original continua assinada)',
    )

    // recarregando, a tela mostra a MAIS RECENTE (a retificação) e as versões levam à original assinada
    await page.goto(`${base}/ata`)
    await expect(page.getByText(/Retificação da ata #/)).toBeVisible()
    const versoes = page.getByRole('navigation', { name: 'Versões da ata' })
    await expect(versoes.getByRole('link', { name: /Original/ })).toBeVisible()
    await expect(
      versoes.getByRole('link', { name: /Retificação/ }),
    ).toHaveAttribute('aria-current', 'page')
    await ver(
      page,
      info,
      'ata depois de recarregar: a retificacao e as versoes',
    )
    await versoes.getByRole('link', { name: /Original/ }).click()
    await expect(page).toHaveURL(new RegExp(`ata\\?ata=${idAta}$`))
    await expect(page.getByText(/Retificação da ata #/)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /^Ata nº/ })).toBeVisible()
    await ver(
      page,
      info,
      'a ata original assinada continua alcancavel pelas versoes',
    )

    await naAuditoria(page, 'atas', 'ASSINADA', idAta)
    await naAuditoria(page, 'atas', 'RETIFICACAO_CRIADA', idRetificacao, info)
    expect(vigia.problemas()).toEqual([])
  })

  test('lista de atas: a ata deste roteiro, assinada e com documento anexado, e a retificação em rascunho', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto('/governanca/atas')
    await expect(
      page.getByRole('heading', { name: 'Atas' }).first(),
    ).toBeVisible()
    await page.getByLabel('Filtrar').fill(String(RODADA))
    const linhas = page.getByRole('row').filter({ hasText: PAUTA })
    await expect(linhas.first()).toBeVisible()
    const original = linhas.filter({ hasText: 'Assinada' })
    await expect(original).toHaveCount(1)
    await expect(original).toContainText('Ordinária')
    await expect(original).toContainText('Anexado')
    await expect(original.getByRole('link')).toHaveText(String(numeroAta))
    await expect(original.getByRole('link')).toHaveAttribute(
      'href',
      `${base}/ata`,
    )
    const retificacao = linhas.filter({ hasText: '(rascunho)' })
    await expect(retificacao).toHaveCount(1)
    await expect(retificacao).toContainText('Rascunho')
    await expect(retificacao).toContainText('Não anexado')
    await ver(page, info, 'lista de atas: a assinada e a retificacao')
    expect(vigia.problemas()).toEqual([])
  })

  test('fechamento: nenhum achado suspeito ficou registrado neste grupo', () => {
    expect(
      achadosAssembleia,
      `O roteiro viu ${achadosAssembleia.length} coisa(s) que parece(m) defeito do sistema`,
    ).toEqual([])
  })
})

// --------------------------------------------------------------------------------------------------------------------------- petições
test.describe('petições de convocação', () => {
  test.describe.configure({ mode: 'serial' })

  test('propor (pauta vazia recusada), aderir (segunda adesão recusada), converter antes do quórum (recusado) e a adesão de outro associado', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const PAUTA_PETICAO = `Petição ${RODADA}: assembleia extraordinária para rever o calendário de eventos`
    await entrar(page, 'presidente')
    await page.goto('/governanca/peticoes')
    await expect(
      page.getByRole('heading', { name: 'Petições de convocação' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Propor petição' }).click()
    await inventariarSemTravar(
      page,
      info,
      'peticoes-formulario-de-proposta',
      achadosPeticoes,
    )
    // recusa: sem pauta
    await page.getByRole('button', { name: 'Propor petição' }).click()
    await expect(page.getByRole('alert')).toContainText(
      'Descreva a pauta proposta.',
    )
    await ver(page, info, 'peticao sem pauta: recusada')
    await campo(page, 'Pauta proposta *').fill(PAUTA_PETICAO)
    const propondo = respostaDe(page, 'POST', /\/api\/peticoes-convocacao\/$/)
    await page.getByRole('button', { name: 'Propor petição' }).click()
    const proposta = (await (await propondo).json()) as { id_peticao: number }
    const idPeticao = proposta.id_peticao
    const cartao = page
      .locator('div.rounded-xl')
      .filter({ hasText: PAUTA_PETICAO })
    await expect(cartao).toBeVisible()
    await expect(
      cartao.getByText('Coletando adesões', { exact: true }),
    ).toBeVisible()
    await expect(cartao).toContainText(
      /0 de \d+ associados ativos aderiram \(0%\)/,
    )
    await ver(page, info, 'peticao proposta: coletando adesoes')

    // aderir: conta uma adesão; aderir de novo é recusado
    await cartao.getByRole('button', { name: 'Aderir a esta petição' }).click()
    await expect(cartao).toContainText(/1 de \d+ associados ativos aderiram/)
    await cartao.getByRole('button', { name: 'Aderir a esta petição' }).click()
    await expect(
      cartao.getByText('Você já aderiu a esta petição.'),
    ).toBeVisible()
    await ver(page, info, 'segunda adesao da mesma pessoa: recusada')
    // 1/5 dos associados ativos é o mínimo (Art. 8º): com as adesões dos logins de teste o quórum não chega, e a conversão não é oferecida
    await expect(
      cartao.getByRole('link', { name: 'Converter em assembleia' }),
    ).toHaveCount(0)

    // converter antes do quórum, pela rota da tela de conversão: o servidor recusa
    await page.goto(`/governanca/nova?peticao=${idPeticao}`)
    await expect(
      page.getByRole('heading', { name: 'Converter petição em assembleia' }),
    ).toBeVisible()
    await expect(campo(page, 'Ordem do dia *')).toHaveValue(PAUTA_PETICAO)
    await campo(page, 'Tipo *').selectOption({ index: 2 })
    await campo(page, 'Data e hora da 1ª convocação *').fill(daqui30dias())
    await page.getByRole('button', { name: 'Converter em assembleia' }).click()
    await expect(page.getByRole('alert')).toContainText(
      /Petição precisa estar .Quórum atingido. antes de virar assembleia/,
    )
    await expect(page).toHaveURL(/\/governanca\/nova\?peticao=\d+$/)
    await ver(page, info, 'converter antes do quorum: recusado')

    // outro associado adere (cada login conta uma adesão)
    await sair(page)
    await entrar(page, 'secretario')
    await page.goto('/governanca/peticoes')
    const cartaoDele = page
      .locator('div.rounded-xl')
      .filter({ hasText: PAUTA_PETICAO })
    await expect(cartaoDele).toContainText(
      /1 de \d+ associados ativos aderiram/,
    )
    await cartaoDele
      .getByRole('button', { name: 'Aderir a esta petição' })
      .click()
    await expect(cartaoDele).toContainText(
      /2 de \d+ associados ativos aderiram/,
    )
    await ver(page, info, 'segundo associado aderiu: duas adesoes')
    await sair(page)

    // quem não tem a permissão de governança também propõe e adere (Art. 8º/10): pela rota do quadro social, fora de Governança
    await entrar(page, 'tesoureiro')
    await page.getByRole('link', { name: 'Petições de convocação' }).click()
    await expect(page).toHaveURL(/\/peticoes-de-convocacao$/)
    await expect(
      page.getByRole('heading', { name: 'Petições de convocação' }),
    ).toBeVisible()
    const cartaoTesoureiro = page
      .locator('div.rounded-xl')
      .filter({ hasText: PAUTA_PETICAO })
    await expect(cartaoTesoureiro).toContainText(
      /2 de \d+ associados ativos aderiram/,
    )
    await cartaoTesoureiro
      .getByRole('button', { name: 'Aderir a esta petição' })
      .click()
    await expect(cartaoTesoureiro).toContainText(
      /3 de \d+ associados ativos aderiram/,
    )
    await ver(
      page,
      info,
      'Tesoureiro (sem governanca) adere pela rota do quadro social',
    )
    // o caminho de Governança continua só da Diretoria
    await page.goto('/governanca/peticoes')
    await expect(page).toHaveURL(/\/403$/)
    await sair(page)

    await entrar(page, 'presidente')
    await naAuditoria(page, 'peticoes_convocacao', 'CREATE', idPeticao)
    await naAuditoria(page, 'adesoes_peticao', 'CREATE', idPeticao, info)
    expect(vigia.problemas()).toEqual([])
  })

  test('fechamento: nenhum achado suspeito ficou registrado neste grupo', () => {
    expect(
      achadosPeticoes,
      `O roteiro viu ${achadosPeticoes.length} coisa(s) que parece(m) defeito do sistema`,
    ).toEqual([])
  })
})
