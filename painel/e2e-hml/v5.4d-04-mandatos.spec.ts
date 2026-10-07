import {
  expect,
  test,
  type Locator,
  type Page,
  type Response as Resposta,
} from '@playwright/test'

import {
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

// v5.4d — FASE 2.5 ao vivo: MANDATOS (Diretoria Executiva, Art. 19, e Conselho Fiscal, Art. 24), pela tela do hml-painel.
// Cobre: a composição semeada; quem abre a tela; os formulários (rótulos e "Cancelar"); registrar mandato com as recusas que o sistema TEM
// de fazer (campo vazio, cargo já ocupado, Conselho Fiscal já completo, fim antes do início); o vínculo cargo -> permissão ao vivo
// (encerrar o mandato do Tesoureiro tira o financeiro dele, registrar de novo devolve; "renovar" = registrar outro para a mesma pessoa);
// o conflito de interesse (declarar, recusas, encerrar); a Auditoria de cada ação; e as datas só-data (início do mandato) no dia certo.
//
// Sem `serial` de propósito: cada roteiro se basta, e um achado numa etapa não pode esconder as outras (o robô só roda ao vivo, cada volta
// custa minutos). O que NÃO pode ficar mexido (o Tesoureiro sem cargo, mandato de teste solto, conflito ativo de teste) é devolvido pelo
// `afterAll`, que roda até depois de falha: o estado ao fim do arquivo é o do início (as mesmas pessoas nos mesmos cargos e as mesmas
// permissões; o histórico só ganha uma linha "Encerrado" do Tesoureiro).
//
// As asserções `expect.soft` marcam o que é DEFEITO PROVÁVEL do sistema (não do roteiro) sem impedir o resto do roteiro de rodar.
test.beforeAll(() => exigirHomologacao())

const MANDATOS = '/governanca/mandatos'
const DIRETORIA = 'Diretoria Executiva'
const CONSELHO = 'Conselho Fiscal'

// O que o `scripts/popular_homologacao.py` semeia: NOMES[i] ocupa CARGOS[i] (o nome vem com " de Teste" no fim), mandato de 2026-01-15 a 2030-01-15.
const DIRETORIA_SEMEADA = [
  { nome: 'Ana Lúcia Ferreira', cargo: 'Presidente' },
  { nome: 'Bruno Carvalho Lima', cargo: '1º Vice-Presidente' },
  { nome: 'Carla Menezes Souza', cargo: '2º Vice-Presidente' },
  { nome: 'Daniel Ribeiro Costa', cargo: '1º Secretário' },
  { nome: 'Elisa Barbosa Nunes', cargo: '2º Secretário' },
  { nome: 'Fábio Henrique Dias', cargo: '1º Tesoureiro' },
  { nome: 'Gisele Moraes Pinto', cargo: '2º Tesoureiro' },
]
const CONSELHEIROS = [
  'Heitor Almeida Rocha',
  'Isabela Torres Cunha',
  'João Pedro Teixeira',
]
const SECRETARIO = DIRETORIA_SEMEADA[3]!
const TESOUREIRO = DIRETORIA_SEMEADA[5]!
// Associada de teste SEM cargo e SEM login: serve para as tentativas de registro (nada do que ela receber dá permissão a ninguém de teste).
const SEM_CARGO = 'Karina Duarte Melo'

// Mensagem de "cargo cheio". O servidor ainda não tem essa recusa (ver o relatório); o texto aqui é largo de propósito.
const CARGO_CHEIO =
  /ocupad|já (existe|há|tem|está)|vigente|vaga|limite|máximo|completo|lotad/i

const NAVEGADOR = {
  baseURL: process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br',
  locale: 'pt-BR',
  timezoneId: 'America/Belem',
  viewport: { width: 1366, height: 900 },
}

type Situacao = 'Vigente' | 'Encerrado'
type DadosMandato = {
  associado?: string
  orgao: string
  cargo: string
  inicio?: string
  fim?: string
  ato?: string
}

/** O dia (e o dia daqui a 4 anos, a duração estatutária padrão) como o painel mostra, no fuso de Belém (UTC-3), não no do robô. */
function diaEmBelem(deslocamentoEmDias = 0) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() + deslocamentoEmDias * 86_400_000))
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? ''
  const [ano, mes, dia] = [valor('year'), valor('month'), valor('day')]
  return {
    iso: `${ano}-${mes}-${dia}`,
    br: `${dia}/${mes}/${ano}`,
    maisQuatroAnos: `${dia}/${mes}/${Number(ano) + 4}`,
  }
}

// ------------------------------------------------------------------------------------------------ a tela de Mandatos
const secao = (page: Page, titulo: string) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: titulo }) })
const secaoMandatos = (page: Page) => secao(page, 'Mandatos por órgão e cargo')
const secaoConflitos = (page: Page) =>
  secao(page, 'Declarações de conflito de interesse')
/** Cada mandato da lista é um <div class="rounded-md ...">; os formulários são <form>, então não entram aqui. */
const linhasDeMandato = (page: Page) =>
  secaoMandatos(page).locator('div.rounded-md')
const cartoesDeConflito = (page: Page) =>
  secaoConflitos(page).locator('div.rounded-md')

function linhaDeMandato(
  page: Page,
  d: { nome?: string; orgao?: string; cargo?: string; situacao?: Situacao },
): Locator {
  let linha = linhasDeMandato(page)
  if (d.nome) linha = linha.filter({ hasText: d.nome })
  if (d.orgao && d.cargo) {
    linha = linha.filter({ hasText: `${d.orgao} · ${d.cargo}` })
  }
  if (d.situacao) {
    linha = linha.filter({ has: page.getByText(d.situacao, { exact: true }) })
  }
  return linha
}

/** Abre a tela e espera a lista chegar com os nomes (sem nome resolvido o painel mostra "Associado #id"). */
async function abrirMandatos(page: Page): Promise<void> {
  await page.goto(MANDATOS)
  await expect(
    page.getByRole('heading', { name: 'Mandatos e órgãos' }),
  ).toBeVisible()
  await expect(linhasDeMandato(page).first()).toBeVisible()
  await expect(page.getByText(/^Associado #\d+$/)).toHaveCount(0)
}

const formularioNovoAberto = (page: Page) =>
  page.getByLabel('Órgão', { exact: true })
const enviarMandato = (page: Page) =>
  page.getByRole('button', { name: 'Registrar mandato', exact: true })

/** Abre o formulário "Registrar mandato" do zero (se sobrou um aberto da tentativa anterior, descarta: a recusa antiga não confunde a nova). */
async function abrirFormularioNovo(page: Page): Promise<void> {
  if ((await formularioNovoAberto(page).count()) > 0) {
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(formularioNovoAberto(page)).toHaveCount(0)
  }
  await page
    .getByRole('button', { name: 'Registrar mandato', exact: true })
    .click()
  await expect(formularioNovoAberto(page)).toBeVisible()
}

async function preencherMandato(page: Page, d: DadosMandato): Promise<void> {
  if (d.associado) {
    await escolherPorTexto(
      page.getByLabel('Associado', { exact: true }),
      d.associado,
    )
  }
  await page
    .getByLabel('Órgão', { exact: true })
    .selectOption({ label: d.orgao })
  await page
    .getByLabel('Cargo', { exact: true })
    .selectOption({ label: d.cargo })
  if (d.inicio) await campo(page, 'Data de início').fill(d.inicio)
  if (d.fim) await campo(page, 'Data de fim previsto (opcional)').fill(d.fim)
  if (d.ato) await campo(page, 'Ato de origem (opcional)').fill(d.ato)
}

const esperarCriacao = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/mandatos\/$/.test(new URL(r.url()).pathname),
  )

/** Registra pelo formulário e confere que o sistema aceitou; devolve o id do mandato criado. */
async function registrarPelaTela(page: Page, d: DadosMandato): Promise<number> {
  await abrirFormularioNovo(page)
  await preencherMandato(page, d)
  const [resposta] = await Promise.all([
    esperarCriacao(page),
    enviarMandato(page).click(),
  ])
  const texto = await resposta.text()
  expect(resposta.ok(), `registrar mandato foi recusado: ${texto}`).toBe(true)
  const corpo = JSON.parse(texto) as { id_mandato: number }
  await expect(formularioNovoAberto(page)).toHaveCount(0) // o formulário se fecha sozinho
  return corpo.id_mandato
}

/** Tenta registrar e devolve o que o sistema respondeu (para as recusas que TÊM de acontecer). */
async function tentarRegistrar(
  page: Page,
  d: DadosMandato,
): Promise<{ recusado: boolean; status: number; id?: number }> {
  await abrirFormularioNovo(page)
  await preencherMandato(page, d)
  const [resposta]: [Resposta, void] = await Promise.all([
    esperarCriacao(page),
    enviarMandato(page).click(),
  ])
  if (!resposta.ok()) return { recusado: true, status: resposta.status() }
  const corpo = (await resposta.json()) as { id_mandato: number }
  return { recusado: false, status: resposta.status(), id: corpo.id_mandato }
}

/** "Encerrar mandato" -> motivo + referência -> "Confirmar encerramento". `linha` tem de apontar para UMA linha vigente. Devolve o id encerrado. */
async function encerrarPelaTela(
  page: Page,
  linha: Locator,
  motivo: string,
  referencia: string,
): Promise<number> {
  await linha.getByRole('button', { name: 'Encerrar mandato' }).click()
  await linha.getByLabel('Motivo do encerramento').selectOption(motivo)
  await linha.getByPlaceholder('Referência do ato (opcional)').fill(referencia)
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/mandatos\/\d+\/encerrar$/.test(new URL(r.url()).pathname),
    ),
    linha.getByRole('button', { name: 'Confirmar encerramento' }).click(),
  ])
  expect(
    resposta.ok(),
    `encerrar o mandato foi recusado: ${await resposta.text()}`,
  ).toBe(true)
  const id = Number(
    /\/mandatos\/(\d+)\/encerrar$/.exec(new URL(resposta.url()).pathname)?.[1],
  )
  expect(Number.isInteger(id)).toBe(true)
  return id
}

/** Encerra (pela tela) todo mandato vigente da associada de teste sem cargo: o que uma tentativa aceita por engano deixou. Devolve quantos. */
async function encerrarMandatosDeTeste(page: Page): Promise<number> {
  await abrirMandatos(page)
  const dela = () =>
    linhasDeMandato(page)
      .filter({ hasText: SEM_CARGO })
      .filter({ has: page.getByText('Vigente', { exact: true }) })
  let encerrados = 0
  while (encerrados < 8 && (await dela().count()) > 0) {
    const antes = await dela().count()
    await encerrarPelaTela(
      page,
      dela().first(),
      'Renúncia',
      `limpeza do roteiro ${RODADA}`,
    )
    await expect(dela()).toHaveCount(antes - 1)
    encerrados += 1
  }
  return encerrados
}

/** Encerra (pela tela) toda declaração de conflito ativa da associada de teste. Devolve quantas. */
async function encerrarConflitosDeTeste(page: Page): Promise<number> {
  const carregou = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /\/api\/mandatos\/conflitos-interesse$/.test(new URL(r.url()).pathname),
  )
  carregou.catch(() => undefined) // se a abertura falhar antes, a espera que sobrou não vira erro solto
  await abrirMandatos(page)
  await carregou
  await page.waitForTimeout(500) // a lista de conflitos não tem estado "carregando": vazia e carregando se parecem
  const dela = () =>
    cartoesDeConflito(page)
      .filter({ hasText: SEM_CARGO })
      .filter({
        has: page.getByRole('button', { name: 'Encerrar', exact: true }),
      })
  let encerrados = 0
  while (encerrados < 8 && (await dela().count()) > 0) {
    const antes = await dela().count()
    await dela()
      .first()
      .getByRole('button', { name: 'Encerrar', exact: true })
      .click()
    await expect(dela()).toHaveCount(antes - 1)
    encerrados += 1
  }
  return encerrados
}

// ------------------------------------------------------------------------------------------------ a Auditoria
async function abrirAuditoria(page: Page, tabela: string): Promise<void> {
  await page.goto('/auditoria')
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible()
  await campo(page, 'Tabela').fill(tabela)
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
}

/** A linha da Auditoria desta ação neste registro (as colunas são Quando, Usuário, Ação, Tabela, Registro, IP). */
function linhaDaAuditoria(page: Page, acao: string, registro: number): Locator {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: acao, exact: true }) })
    .filter({
      has: page.getByRole('cell', { name: String(registro), exact: true }),
    })
}

/** Quantos registros a Auditoria tem para a tabela (o rodapé diz "N registro(s)"). */
async function totalNaAuditoria(page: Page, tabela: string): Promise<number> {
  await abrirAuditoria(page, tabela)
  const rodape = await page.getByText(/^\d+ registro\(s\)$/).innerText()
  return Number.parseInt(rodape, 10)
}

// ------------------------------------------------------------------------------------------------ o estado de teste volta ao que era
async function restaurarEstadoInicial(page: Page): Promise<string[]> {
  const feito: string[] = []
  const mandatos = await encerrarMandatosDeTeste(page)
  if (mandatos > 0) {
    feito.push(`${mandatos} mandato(s) solto(s) de teste encerrado(s)`)
  }
  await abrirMandatos(page)
  const tesoureiro = linhaDeMandato(page, {
    nome: TESOUREIRO.nome,
    orgao: DIRETORIA,
    cargo: TESOUREIRO.cargo,
    situacao: 'Vigente',
  })
  if ((await tesoureiro.count()) === 0) {
    await registrarPelaTela(page, {
      associado: TESOUREIRO.nome,
      orgao: DIRETORIA,
      cargo: TESOUREIRO.cargo,
      inicio: diaEmBelem().iso,
      ato: `Restauro do roteiro ${RODADA}: o Tesoureiro de teste estava sem cargo`,
    })
    feito.push('o Tesoureiro de teste estava sem mandato: novo registrado')
  }
  const conflitos = await encerrarConflitosDeTeste(page)
  if (conflitos > 0) {
    feito.push(`${conflitos} conflito(s) de teste encerrado(s)`)
  }
  return feito
}

test.afterAll(async ({ browser }) => {
  test.setTimeout(300_000)
  exigirHomologacao()
  const contexto = await browser.newContext(NAVEGADOR)
  try {
    const page = await contexto.newPage()
    await entrar(page, 'presidente')
    const feito = await restaurarEstadoInicial(page)
    test.info().annotations.push({
      type: 'restauro',
      description:
        feito.length > 0
          ? feito.join('; ')
          : 'nada a restaurar: o estado final é o do início',
    })
  } finally {
    await contexto.close()
  }
})

/** As 10 posses semeadas, cada uma com um só titular vigente (Art. 19: 7 cargos; Art. 24: 3 conselheiros). */
async function conferirComposicao(page: Page): Promise<void> {
  for (const t of DIRETORIA_SEMEADA) {
    await expect(
      linhaDeMandato(page, {
        nome: t.nome,
        orgao: DIRETORIA,
        cargo: t.cargo,
        situacao: 'Vigente',
      }),
      `${t.nome} tem de ocupar ${t.cargo}`,
    ).toHaveCount(1)
    await expect(
      linhasDeMandato(page).filter({ hasText: `${DIRETORIA} · ${t.cargo}` }),
      `${t.cargo} tem de ter um só titular vigente`,
    ).toHaveCount(1)
  }
  for (const nome of CONSELHEIROS) {
    await expect(
      linhaDeMandato(page, {
        nome,
        orgao: CONSELHO,
        cargo: 'Conselheiro Fiscal',
        situacao: 'Vigente',
      }),
      `${nome} tem de ser Conselheiro(a) Fiscal`,
    ).toHaveCount(1)
  }
  await expect(
    linhasDeMandato(page).filter({
      hasText: `${CONSELHO} · Conselheiro Fiscal`,
    }),
    'o Conselho Fiscal tem 3 membros (Art. 24)',
  ).toHaveCount(3)
  await expect(
    linhasDeMandato(page).filter({ hasText: `${DIRETORIA} ·` }),
    'a Diretoria Executiva tem 7 cargos (Art. 19)',
  ).toHaveCount(7)
}

// ================================================================================================ os roteiros
test('a tela lista a Diretoria Executiva (7 cargos, Art. 19) e o Conselho Fiscal (3, Art. 24) semeados, com situação e datas', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirMandatos(page)
  await expect(
    page.getByRole('heading', { name: 'Mandatos por órgão e cargo' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Declarações de conflito de interesse' }),
  ).toBeVisible()
  await expect(page.getByLabel('Só vigentes')).toBeChecked()
  await expect(enviarMandato(page)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Declarar conflito' }),
  ).toBeVisible()
  await conferirComposicao(page)
  for (const linha of await linhasDeMandato(page).all()) {
    await expect(linha).toContainText(
      /\d{2}\/\d{2}\/\d{4} até \d{2}\/\d{2}\/\d{4}/,
    )
  }
  await ver(
    page,
    info,
    'mandatos: Diretoria Executiva (7) e Conselho Fiscal (3)',
  )
  expect(vigia.problemas()).toEqual([])
})

test('data só-data: o início do mandato semeado (15/01/2026) aparece como 15/01, não como 14/01 (valor só-data lido como instante UTC)', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirMandatos(page)
  const presidente = linhaDeMandato(page, {
    nome: DIRETORIA_SEMEADA[0]!.nome,
    orgao: DIRETORIA,
    cargo: 'Presidente',
    situacao: 'Vigente',
  })
  await ver(page, info, 'datas do mandato semeado (15/01/2026 a 15/01/2030)')
  // o servidor guarda 2026-01-15T00:00:00 (sem fuso) e o painel lê isso como UTC: em Belém (UTC-3) sai 14/01/2026
  await expect(presidente).toContainText('15/01/2026 até 15/01/2030')
  expect(vigia.problemas()).toEqual([])
})

test('quem abre Mandatos: o Secretário (o cargo concede governança) abre e lê; o Tesoureiro é barrado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  await expect(
    page.getByRole('link', { name: 'Governança' }).first(),
  ).toBeVisible()
  await abrirMandatos(page)
  await expect(
    linhaDeMandato(page, {
      nome: SECRETARIO.nome,
      orgao: DIRETORIA,
      cargo: SECRETARIO.cargo,
      situacao: 'Vigente',
    }),
  ).toHaveCount(1)
  await ver(page, info, 'Secretario abre a tela de Mandatos')
  await sair(page)

  await entrar(page, 'tesoureiro')
  await expect(page.getByText(/Bem-vindo, Fábio Henrique Dias/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Governança' })).toHaveCount(0)
  // a recusa tem que vir do sistema, não só do menu escondido: digitar o endereço também não abre
  await page.goto(MANDATOS)
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  await expect(page.getByText(/permissão necessária: governanca/)).toBeVisible()
  await ver(page, info, 'Tesoureiro em Mandatos: acesso negado')
  expect(vigia.problemas()).toEqual([])
})

test('os formulários da tela abrem, todos os campos têm rótulo e "Cancelar" fecha sem efeito', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirMandatos(page)
  const semRotulo: string[] = []
  const inventario = async (nome: string) => {
    try {
      await inventariar(page, info, nome)
    } catch (erro) {
      semRotulo.push(`${nome}: ${(erro as Error).message}`)
    }
  }

  // registrar mandato
  await page
    .getByRole('button', { name: 'Registrar mandato', exact: true })
    .click()
  await expect(formularioNovoAberto(page)).toBeVisible()
  await expect(page.getByLabel('Cargo', { exact: true })).toBeVisible()
  await expect(campo(page, 'Data de início')).toBeVisible()
  await expect(campo(page, 'Data de fim previsto (opcional)')).toBeVisible()
  await expect(campo(page, 'Ato de origem (opcional)')).toBeVisible()
  await inventario('mandatos-registrar')
  await ver(page, info, 'formulario de registrar mandato aberto')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(formularioNovoAberto(page)).toHaveCount(0)
  await expect(enviarMandato(page)).toBeVisible()

  // encerrar mandato: só abre e cancela (nada é encerrado aqui)
  const presidente = linhaDeMandato(page, {
    nome: DIRETORIA_SEMEADA[0]!.nome,
    orgao: DIRETORIA,
    cargo: 'Presidente',
    situacao: 'Vigente',
  })
  await presidente.getByRole('button', { name: 'Encerrar mandato' }).click()
  await expect(presidente.getByLabel('Motivo do encerramento')).toBeVisible()
  await expect(
    presidente.getByLabel('Motivo do encerramento').locator('option'),
  ).toHaveText(['Renúncia', 'Destituição', 'Impedimento temporário'])
  await inventario('mandatos-encerrar')
  await ver(page, info, 'bloco de encerrar mandato aberto')
  await presidente.getByRole('button', { name: 'Cancelar' }).click()
  await expect(presidente.getByLabel('Motivo do encerramento')).toHaveCount(0)
  await expect(
    presidente.getByRole('button', { name: 'Encerrar mandato' }),
  ).toBeVisible()
  await expect(presidente.getByText('Vigente', { exact: true })).toBeVisible()

  // declarar conflito
  await page.getByRole('button', { name: 'Declarar conflito' }).click()
  await expect(
    page.getByLabel('Associado do conflito de interesse'),
  ).toBeVisible()
  await expect(
    page.getByPlaceholder('Descreva o conflito de interesse'),
  ).toBeVisible()
  await inventario('mandatos-conflito')
  await ver(page, info, 'formulario de declarar conflito aberto')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(
    page.getByLabel('Associado do conflito de interesse'),
  ).toHaveCount(0)

  expect(semRotulo, 'campo(s) sem rótulo acessível').toEqual([])
  expect(vigia.problemas()).toEqual([])
})

test('registrar mandato: campo vazio, associado não escolhido, cargo já ocupado, Conselho Fiscal completo e fim antes do início são recusados', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  const vigia = vigiar(page)
  const hoje = diaEmBelem()
  const criadosSemQuerer: number[] = []
  let enviadas = 0
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      /\/api\/mandatos\/$/.test(new URL(r.url()).pathname)
    ) {
      enviadas += 1
    }
  })
  await entrar(page, 'presidente')
  const antes = await totalNaAuditoria(page, 'mandatos')
  await abrirMandatos(page)
  try {
    // 1. tudo vazio: recusado já na tela (nem chega ao servidor)
    await abrirFormularioNovo(page)
    await enviarMandato(page).click()
    const alertas = page.getByRole('alert')
    await expect(alertas.filter({ hasText: /órgão/i })).toHaveCount(1)
    await expect(alertas.filter({ hasText: /cargo/i })).toHaveCount(1)
    await expect(alertas.filter({ hasText: /data de início/i })).toHaveCount(1)
    expect(enviadas, 'formulário vazio não deve ir ao servidor').toBe(0)
    await ver(page, info, 'registrar mandato com tudo vazio: recusado')

    // 2. tudo escolhido, menos o associado: o servidor recusa ("Associado não encontrado.")
    await abrirFormularioNovo(page)
    await preencherMandato(page, {
      orgao: DIRETORIA,
      cargo: 'Presidente',
      inicio: hoje.iso,
    })
    await enviarMandato(page).click()
    await expect(page.getByRole('alert')).toHaveCount(1)
    await expect(page.getByRole('alert')).toContainText(
      /Associado não encontrado|Selecione um associado/,
    )
    await ver(page, info, 'registrar mandato sem associado: recusado')

    // 3. cargo de titular único (Presidente, Art. 19) que já tem titular vigente
    const ocupado = await tentarRegistrar(page, {
      associado: SEM_CARGO,
      orgao: DIRETORIA,
      cargo: 'Presidente',
      inicio: hoje.iso,
    })
    if (ocupado.id) criadosSemQuerer.push(ocupado.id)
    expect
      .soft(
        ocupado.recusado,
        `o sistema ACEITOU um segundo Presidente vigente (HTTP ${ocupado.status}): Art. 19 prevê um só titular por cargo`,
      )
      .toBe(true)
    if (ocupado.recusado) {
      await expect.soft(page.getByRole('alert')).toHaveCount(1)
      await expect.soft(page.getByRole('alert')).toContainText(CARGO_CHEIO)
    }
    await ver(
      page,
      info,
      ocupado.recusado
        ? 'cargo ocupado (Presidente): recusado'
        : 'DEFEITO: cargo ocupado (Presidente) foi aceito',
    )

    // 4. Conselho Fiscal já tem os 3 membros do Art. 24
    const cheio = await tentarRegistrar(page, {
      associado: SEM_CARGO,
      orgao: CONSELHO,
      cargo: 'Conselheiro Fiscal',
      inicio: hoje.iso,
    })
    if (cheio.id) criadosSemQuerer.push(cheio.id)
    expect
      .soft(
        cheio.recusado,
        `o sistema ACEITOU um 4º Conselheiro Fiscal vigente (HTTP ${cheio.status}): Art. 24 prevê 3 membros`,
      )
      .toBe(true)
    if (cheio.recusado) {
      await expect.soft(page.getByRole('alert')).toHaveCount(1)
      await expect.soft(page.getByRole('alert')).toContainText(CARGO_CHEIO)
    }
    await ver(
      page,
      info,
      cheio.recusado
        ? 'Conselho Fiscal completo: recusado'
        : 'DEFEITO: 4o Conselheiro Fiscal foi aceito',
    )

    // 5. fim previsto antes do início
    const invertido = await tentarRegistrar(page, {
      associado: SEM_CARGO,
      orgao: DIRETORIA,
      cargo: 'Presidente',
      inicio: hoje.iso,
      fim: diaEmBelem(-1).iso,
    })
    if (invertido.id) criadosSemQuerer.push(invertido.id)
    expect(
      invertido.recusado,
      `fim antes do início foi aceito (HTTP ${invertido.status})`,
    ).toBe(true)
    await expect(page.getByRole('alert')).toHaveCount(1)
    await expect(page.getByRole('alert')).toContainText(
      new RegExp(
        `fim previsto deve ser depois do início|${CARGO_CHEIO.source}`,
        'i',
      ),
    )
    await ver(page, info, 'fim previsto antes do inicio: recusado')

    // 6. nenhuma das recusas deixou rastro na Auditoria (só o que foi feito de verdade é registrado)
    const depois = await totalNaAuditoria(page, 'mandatos')
    expect
      .soft(
        depois,
        'as recusas não podem criar mandato nem registro de Auditoria',
      )
      .toBe(antes)
    await ver(page, info, 'auditoria de mandatos depois das recusas')
  } finally {
    if (criadosSemQuerer.length > 0) {
      await encerrarMandatosDeTeste(page).catch((erro: unknown) =>
        test
          .info()
          .annotations.push({ type: 'limpeza', description: String(erro) }),
      )
    }
  }
  expect(vigia.problemas()).toEqual([])
})

test('cargo -> permissão ao vivo: encerrar o mandato do Tesoureiro tira o financeiro dele; registrar de novo (renovar) devolve; tudo na Auditoria', async ({
  page,
}, info) => {
  test.setTimeout(480_000)
  const vigia = vigiar(page)
  const tesoureiro = (p: Page, situacao: Situacao = 'Vigente') =>
    linhaDeMandato(p, {
      nome: TESOUREIRO.nome,
      orgao: DIRETORIA,
      cargo: TESOUREIRO.cargo,
      situacao,
    })
  const boasVindas = (p: Page) =>
    p.getByText(/Bem-vindo, Fábio Henrique Dias de Teste/)
  const moduloFinanceiro = (p: Page) =>
    p.getByRole('link', { name: 'Financeiro' })
  const moduloParcerias = (p: Page) =>
    p.getByRole('link', { name: /Parcerias e emendas/ })
  let idEncerrado = 0
  let idNovo = 0

  await test.step('1. com o cargo, o Tesoureiro vê financeiro e parcerias (e nada de governança)', async () => {
    await entrar(page, 'tesoureiro')
    await expect(boasVindas(page)).toBeVisible()
    await expect(moduloFinanceiro(page).first()).toBeVisible()
    await expect(moduloParcerias(page).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Governança' })).toHaveCount(0)
    await ver(page, info, 'Tesoureiro com o cargo: financeiro e parcerias')
    await page.goto('/financeiro')
    await expect(
      page.getByRole('heading', { name: 'Financeiro' }).first(),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro com o cargo abre o financeiro')
    await sair(page)
  })

  await test.step('2. o Presidente encerra o mandato (a outra aba, parada com o mesmo pedido aberto, leva a recusa)', async () => {
    await entrar(page, 'presidente')
    await abrirMandatos(page)
    await expect(tesoureiro(page)).toHaveCount(1)
    await ver(page, info, 'Presidente: o Tesoureiro tem mandato vigente')

    // outra aba do mesmo Presidente abre o "Encerrar mandato" e fica parada: depois dela tentar confirmar, o mandato já estará encerrado
    const outra = await page.context().newPage()
    const vigiaOutra = vigiar(outra)
    await abrirMandatos(outra)
    await tesoureiro(outra)
      .getByRole('button', { name: 'Encerrar mandato' })
      .click()
    await expect(
      tesoureiro(outra).getByLabel('Motivo do encerramento'),
    ).toBeVisible()

    idEncerrado = await encerrarPelaTela(
      page,
      tesoureiro(page),
      'Impedimento temporário',
      `Ata de teste ${RODADA}: afastamento do Tesoureiro`,
    )
    await expect(tesoureiro(page)).toHaveCount(0) // sai de "Só vigentes"
    // Art. 26: sem substituto, o sistema devolve a pendência (Assembleia Geral Extraordinária); o painel tem de mostrá-la ao usuário
    await expect
      .soft(
        page.getByText(/Art\. 26 do estatuto/),
        'a pendência do Art. 26 (vaga sem substituto) nunca chega ao usuário: o bloco some ao concluir',
      )
      .toBeVisible({ timeout: 3_000 })
    await ver(page, info, 'mandato do Tesoureiro encerrado: sai dos vigentes')

    // a outra aba (desatualizada) tenta encerrar o que já foi encerrado: o servidor recusa
    const [recusa] = await Promise.all([
      outra.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /\/api\/mandatos\/\d+\/encerrar$/.test(new URL(r.url()).pathname),
      ),
      tesoureiro(outra)
        .getByRole('button', { name: 'Confirmar encerramento' })
        .click(),
    ])
    expect(recusa.status()).toBe(400)
    await expect(tesoureiro(outra).getByRole('alert')).toContainText(
      'Mandato já não está vigente.',
    )
    await expect
      .soft(
        outra.getByText('Mandato já não está vigente.'),
        'a recusa do servidor aparece uma vez só (o FormShell já a mostra; o bloco repete com isError)',
      )
      .toHaveCount(1)
    await ver(
      outra,
      info,
      'outra aba: encerrar o que ja foi encerrado e recusado',
    )
    expect(vigiaOutra.problemas()).toEqual([])
    await outra.close()

    // Auditoria: ENCERRADO e a vacância (o Tesoureiro era o único), cada uma UMA vez (a recusa não deixou rastro)
    const hoje = diaEmBelem()
    await abrirAuditoria(page, 'mandatos')
    await expect(
      linhaDaAuditoria(page, 'ENCERRADO', idEncerrado),
      'a Auditoria tem de mostrar o encerramento, uma vez só',
    ).toHaveCount(1)
    await expect(
      linhaDaAuditoria(page, 'VACANCIA_SEM_SUBSTITUTO', idEncerrado),
    ).toHaveCount(1)
    await expect
      .soft(
        linhaDaAuditoria(page, 'ENCERRADO', idEncerrado),
        'o horário da Auditoria tem de estar no dia de hoje em Belém',
      )
      .toContainText(hoje.br)
    await ver(page, info, 'auditoria: ENCERRADO e VACANCIA_SEM_SUBSTITUTO')
    await sair(page)
  })

  await test.step('3. sem o cargo, o financeiro some do menu e a URL é negada', async () => {
    await entrar(page, 'tesoureiro')
    await expect(boasVindas(page)).toBeVisible() // o painel já recebeu as permissões
    await expect(moduloFinanceiro(page)).toHaveCount(0)
    await expect(moduloParcerias(page)).toHaveCount(0)
    await expect(
      page.getByText('Nenhum módulo disponível para o seu nível de acesso.'),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro sem o cargo: nenhum modulo')
    await page.goto('/financeiro')
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/403$/)
    await expect(
      page.getByText(/permissão necessária: financeiro/),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro sem o cargo no financeiro: acesso negado')
    await page.goto('/financeiro/titulos?periodo=todos')
    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
    ).toBeVisible()
    await sair(page)
  })

  await test.step('4. o Presidente registra o mandato de novo (renovação, início hoje): a lista, as datas, o histórico e a Auditoria', async () => {
    await entrar(page, 'presidente')
    await abrirMandatos(page)
    await expect(tesoureiro(page)).toHaveCount(0)
    const hoje = diaEmBelem()
    idNovo = await registrarPelaTela(page, {
      associado: TESOUREIRO.nome,
      orgao: DIRETORIA,
      cargo: TESOUREIRO.cargo,
      inicio: hoje.iso,
      ato: `Recondução de teste ${RODADA}`,
    })
    await expect(tesoureiro(page)).toHaveCount(1)
    // data só-data: início hoje tem de aparecer como HOJE (e o fim, 4 anos depois), nunca como ontem
    await expect
      .soft(
        tesoureiro(page).getByText(
          /\d{2}\/\d{2}\/\d{4} até \d{2}\/\d{2}\/\d{4}/,
        ),
        'início "hoje" (só-data) apareceu como outro dia: valor só-data lido como instante UTC',
      )
      .toHaveText(`${hoje.br} até ${hoje.maisQuatroAnos}`)
    await ver(page, info, 'mandato registrado de novo: vigente, inicio hoje')

    // histórico: sem "Só vigentes" aparece o mandato encerrado, com o motivo e o dia do encerramento
    await page.getByLabel('Só vigentes').uncheck()
    const encerrado = tesoureiro(page, 'Encerrado').filter({
      hasText: 'encerramento antecipado',
    })
    await expect(encerrado.first()).toBeVisible()
    await expect(encerrado.first()).toContainText(
      new RegExp(
        `até ${hoje.br} \\(encerramento antecipado\\) - Impedimento temporário`,
      ),
    )
    await expect(tesoureiro(page)).toHaveCount(1) // e o vigente continua um só
    await ver(page, info, 'historico: mandato encerrado e o novo vigente')
    await page.getByLabel('Só vigentes').check()
    await expect(
      linhasDeMandato(page).filter({
        has: page.getByText('Encerrado', { exact: true }),
      }),
    ).toHaveCount(0)

    // o estado voltou ao do início: as mesmas pessoas nos mesmos cargos
    await conferirComposicao(page)

    await abrirAuditoria(page, 'mandatos')
    await expect(
      linhaDaAuditoria(page, 'CREATE', idNovo),
      'a Auditoria tem de mostrar a posse nova',
    ).toHaveCount(1)
    await ver(page, info, 'auditoria: CREATE do mandato novo')
    await sair(page)
  })

  await test.step('5. com o cargo de volta, o Tesoureiro vê o financeiro de novo', async () => {
    await entrar(page, 'tesoureiro')
    await expect(boasVindas(page)).toBeVisible()
    await expect(moduloFinanceiro(page).first()).toBeVisible()
    await expect(moduloParcerias(page).first()).toBeVisible()
    await page.goto('/financeiro')
    await expect(
      page.getByRole('heading', { name: 'Financeiro' }).first(),
    ).toBeVisible()
    await ver(page, info, 'Tesoureiro de volta ao cargo: financeiro de novo')
  })
  expect(vigia.problemas()).toEqual([])
})

test('conflito de interesse: declarar (com as recusas), aparece com a data de hoje, encerrar; a Auditoria registra', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  const vigia = vigiar(page)
  const hoje = diaEmBelem()
  const descricao = `Conflito de teste ${RODADA}: parente é sócio de fornecedor de teste`
  let pendente = false
  await entrar(page, 'presidente')
  await abrirMandatos(page)
  try {
    await page.getByRole('button', { name: 'Declarar conflito' }).click()
    const associado = page.getByLabel('Associado do conflito de interesse')
    const texto = page.getByPlaceholder('Descreva o conflito de interesse')
    const declarar = page.getByRole('button', { name: 'Declarar', exact: true })
    await expect(associado).toBeVisible()

    // recusa 1: tudo vazio. As DUAS faltas aparecem, cada uma no seu campo, uma vez só
    await declarar.click()
    await expect(page.getByRole('alert')).toHaveCount(2)
    await expect(
      page.getByRole('alert').filter({ hasText: /Descreva o conflito/ }),
    ).toHaveCount(1)
    await expect(
      page.getByRole('alert').filter({ hasText: /Selecione um associado/ }),
    ).toHaveCount(1)
    await ver(page, info, 'conflito vazio: recusado, as duas faltas aparecem')

    // recusa 2: descrição curta demais (mínimo de 3 letras), ainda sem associado
    await texto.fill('ab')
    await declarar.click()
    await expect(page.getByRole('alert')).toHaveCount(2)
    await expect(
      page.getByRole('alert').filter({ hasText: /Descreva o conflito/ }),
    ).toHaveCount(1)

    // recusa 3: descrição boa, associado não escolhido
    await texto.fill(descricao)
    await declarar.click()
    await expect(page.getByRole('alert')).toHaveCount(1)
    await expect(page.getByRole('alert')).toContainText(
      /Associado não encontrado|Selecione um associado/,
    )
    await ver(page, info, 'conflito sem associado: recusado')

    // declarar de verdade
    await escolherPorTexto(associado, SEM_CARGO)
    const [resposta] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /\/api\/mandatos\/conflitos-interesse$/.test(
            new URL(r.url()).pathname,
          ),
      ),
      declarar.click(),
    ])
    const corpo = await resposta.text()
    expect(resposta.ok(), `declarar conflito foi recusado: ${corpo}`).toBe(true)
    const id = (JSON.parse(corpo) as { id_declaracao: number }).id_declaracao
    pendente = true
    await expect(associado).toHaveCount(0) // o formulário se fecha sozinho
    const cartao = cartoesDeConflito(page).filter({ hasText: descricao })
    await expect(cartao).toHaveCount(1)
    await expect(cartao).toContainText(`${SEM_CARGO} de Teste`)
    await expect(
      cartao,
      'a declaração mostra o dia de hoje em Belém',
    ).toContainText(`Declarado em ${hoje.br}`)
    await ver(page, info, 'conflito declarado e listado com a data de hoje')

    await abrirAuditoria(page, 'declaracoes_conflito_interesse')
    await expect(
      linhaDaAuditoria(page, 'CREATE', id),
      'a Auditoria tem de mostrar a declaração',
    ).toHaveCount(1)
    await ver(page, info, 'auditoria: declaracao de conflito criada')

    // encerrar a declaração: sai da lista de ativas
    await abrirMandatos(page)
    const [encerrou] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' &&
          /\/api\/mandatos\/conflitos-interesse\/\d+\/encerrar$/.test(
            new URL(r.url()).pathname,
          ),
      ),
      cartoesDeConflito(page)
        .filter({ hasText: descricao })
        .getByRole('button', { name: 'Encerrar', exact: true })
        .click(),
    ])
    expect(encerrou.ok()).toBe(true)
    pendente = false
    await expect(
      cartoesDeConflito(page).filter({ hasText: descricao }),
    ).toHaveCount(0)
    await ver(page, info, 'conflito encerrado: sai das declaracoes ativas')

    await abrirAuditoria(page, 'declaracoes_conflito_interesse')
    await expect(
      linhaDaAuditoria(page, 'ENCERRADA', id),
      'a Auditoria tem de mostrar o encerramento da declaração',
    ).toHaveCount(1)
    await ver(page, info, 'auditoria: declaracao de conflito encerrada')
  } finally {
    if (pendente) {
      await encerrarConflitosDeTeste(page).catch((erro: unknown) =>
        test
          .info()
          .annotations.push({ type: 'limpeza', description: String(erro) }),
      )
    }
  }
  expect(vigia.problemas()).toEqual([])
})
