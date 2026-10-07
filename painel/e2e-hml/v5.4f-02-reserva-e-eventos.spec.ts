import {
  expect,
  test,
  type Locator,
  type Page,
  type Response as Resposta,
} from '@playwright/test'

import {
  API_HML,
  AVISO,
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  inventariar,
  RODADA,
  sair,
  ver,
  vigiar,
  type Papel,
} from './apoio'

// v5.4f — FASE 4 ao vivo, parte 2: RESERVA DE ESPAÇO (/reserva-espaco) e a primeira metade de EVENTO (/eventos), pela tela do hml-painel, com a
// recusa que o sistema tem de fazer em cada passo e a Auditoria mostrando a ação.
//
// O que este roteiro SABE do código (lido em Espacos.tsx, Eventos.tsx e nos serviços do servidor, não suposto):
//  - As duas telas e a API exigem a permissão `projetos`: o Presidente de teste (nível Presidente) e quem tem o cargo de Presidente a têm; o
//    Secretário, o Tesoureiro, o 1º Vice e o Conselheiro Fiscal NÃO (database.py: permissões por cargo).
//  - Conflito de horário, bloqueio e "mover reserva" usam UM motor só (app/services/agenda.py): intervalos que só se encostam não colidem.
//  - Cobrança de reserva: só com valor > 0 E conta de receita E (espaço não isento OU associado fora de "Em Dia"); a isenção justificada de
//    100% zera. Cancelar fora do prazo gera a taxa de cancelamento tardio; o reembolso só nasce se a cobrança original já foi PAGA.
//  - NÃO existe tela do painel que inscreva alguém num evento (a lista "Inscritos" só lista e muda o status). A inscrição de verdade é pelo site
//    (outro roteiro, que o robô não alcança) ou pelo autoatendimento da API. Aqui, para ter o que conferir na tela de inscritos, cada pessoa de
//    teste se inscreve pela API com a PRÓPRIA sessão (`/api/eventos/{id}/inscricao`, a mesma chamada do autoatendimento), e tudo o que importa
//    (vagas, contadores, lista de espera, mudança de status, Auditoria) é conferido e feito na tela do Presidente.
//  - A lista de espera só ANDA no cancelamento pelo link do e-mail (app/services/vagas.py::cancelar_e_promover_por_token) e na expiração do prazo.
//    "Alterar status" da tela chama PUT /api/inscricoes/{id}/status, que só troca o texto do status (app/services/inscricao.py::alterar_status):
//    por isso a verificação "cancelou na tela -> a vaga volta e o primeiro da fila avança" usa `expect.soft` e é, provavelmente, um achado.
//
// Cada roteiro se basta (cria os próprios espaços e eventos, com RODADA no nome) e o banco de teste acumula dados entre rodadas. As asserções
// `expect.soft` marcam o que é DEFEITO PROVÁVEL do sistema (não do roteiro) sem impedir o resto do roteiro de rodar.
test.beforeAll(() => exigirHomologacao())

const PRESIDENTE = 'Marta Souza'
// Associados de teste com situação "Ativo - Em Dia" que não têm cargo nem são usados nos outros roteiros como parte de um processo.
const SOLICITANTE = 'Marina Azevedo Lopes'
const OUTRO_SOLICITANTE = 'Leonardo Batista Reis'

const ERRO_CONFLITO =
  /Conflito de agenda: já existe compromisso para 'Espaco' #\d+ nesse horário/
const ERRO_FIM_ANTES_DO_INICIO =
  /Data\/hora de fim precisa ser depois da de início\./

// ------------------------------------------------------------------------------------------------ datas (fuso de Belém, UTC-3)
const SEMANA = [
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
  'Domingo',
]

type Dia = { iso: string; br: string; semana: string }

/** O dia daqui a `deslocamentoDias`, no relógio de Belém (UTC-3), que é o do navegador do robô (playwright.hml.config.ts). */
function diaEmBelem(deslocamentoDias: number): Dia {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + deslocamentoDias * 86_400_000))
  const [ano = '', mes = '', dia = ''] = iso.split('-')
  const diaDaSemana = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return {
    iso,
    br: `${dia}/${mes}/${ano}`,
    semana: SEMANA[(diaDaSemana + 6) % 7] ?? '',
  }
}

/** Valor de um campo datetime-local (hora LOCAL do navegador). */
const quando = (dia: Dia, hora: string) => `${dia.iso}T${hora}`

/** O texto que o painel mostra para um instante (dd/mm/aaaa HH:MM; o separador pode ser espaço ou vírgula). */
const mostrado = (dia: Dia, hora: string) =>
  new RegExp(`${dia.br}[,\\s]+${hora}`)

/** O mesmo instante em UTC (`AAAA-MM-DDTHH:MM`), que é como o servidor o guarda e a disponibilidade pública o devolve. */
const emUtc = (dia: Dia, hora: string) =>
  new Date(`${dia.iso}T${hora}:00-03:00`).toISOString().slice(0, 16)

// ------------------------------------------------------------------------------------------------ Auditoria
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

/** Conta, na própria página, quantos pedidos POST foram ao servidor para um caminho (a recusa na tela não pode chegar lá). */
function contarEnvios(page: Page, caminho: RegExp): () => number {
  let total = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && caminho.test(new URL(r.url()).pathname)) {
      total += 1
    }
  })
  return () => total
}

/**
 * Chama a API como a pessoa que está LOGADA nesta página (o token do painel só vive em memória: renova pelo mesmo cookie que o painel usa).
 * Serve para o que o painel não tem tela (inscrever-se em evento) e para provar que a API também recusa quem não tem a permissão.
 */
async function chamarApi(
  page: Page,
  metodo: 'GET' | 'POST',
  caminho: string,
  corpo?: unknown,
): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async (dados) => {
      const renovada = await fetch(`${dados.api}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      const token = ((await renovada.json()) as { access_token?: string })
        .access_token
      if (!token) throw new Error('não foi possível renovar a sessão')
      const resposta = await fetch(`${dados.api}${dados.caminho}`, {
        method: dados.metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(dados.corpo === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
        },
        body:
          dados.corpo === undefined ? undefined : JSON.stringify(dados.corpo),
      })
      let json: unknown
      try {
        json = await resposta.json()
      } catch {
        json = null
      }
      return { status: resposta.status, json }
    },
    { api: API_HML, metodo, caminho, corpo },
  )
}

// =====================================================================================================================================
// A tela de Reserva de Espaço
// =====================================================================================================================================
const ESPACOS = '/reserva-espaco'

async function abrirEspacos(page: Page): Promise<void> {
  await page.goto(ESPACOS)
  await expect(
    page.getByRole('heading', { name: 'Reserva de Espaço', level: 1 }),
  ).toBeVisible()
}

type DadosEspaco = {
  nome: string
  tipo?: string
  capacidade?: string
  valor?: string
  conta?: boolean
  prazo?: string
  taxa?: string
  faltas?: string
  reembolso?: string
  aprovacao?: boolean
  isento?: boolean
}

const formularioDeEspaco = (page: Page) =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: 'Cadastrar espaço' }),
  })

async function abrirFormularioDeEspaco(page: Page): Promise<Locator> {
  const form = formularioDeEspaco(page)
  if ((await form.count()) === 0) {
    await page.getByRole('button', { name: 'Novo espaço', exact: true }).click()
  }
  await expect(form).toBeVisible()
  return form
}

/**
 * Preenche o formulário "Novo espaço". Por padrão preenche TAMBÉM alguns opcionais (capacidade, faltas, conta de receita), para o espaço do
 * roteiro ser parecido com um de verdade (o roteiro A3 cobre o espaço só com nome e tipo).
 */
async function preencherEspaco(form: Locator, d: DadosEspaco): Promise<void> {
  await form.getByPlaceholder('Nome do espaço').fill(d.nome)
  await form
    .locator('select')
    .first()
    .selectOption({ label: d.tipo ?? 'Salão' })
  await form.getByPlaceholder('Capacidade').fill(d.capacidade ?? '40')
  if (d.valor) {
    await form.getByPlaceholder('Valor da reserva (R$, opcional)').fill(d.valor)
  }
  if (d.conta !== false) {
    const conta = form.locator('select').nth(1)
    await expect(conta.locator('option').nth(1)).toBeAttached()
    await conta.selectOption({ index: 1 })
  }
  if (d.prazo) {
    await form.getByPlaceholder('Prazo de cancelamento (horas)').fill(d.prazo)
  }
  if (d.taxa) {
    await form.getByPlaceholder('Taxa de cancelamento tardio (R$)').fill(d.taxa)
  }
  await form
    .getByPlaceholder('Bloquear após N faltas (opcional)')
    .fill(d.faltas ?? '3')
  if (d.reembolso) {
    await form.getByPlaceholder('% de reembolso (opcional)').fill(d.reembolso)
  }
  await form
    .getByLabel('Exige aprovação manual (senão, instantânea)')
    .setChecked(d.aprovacao ?? false)
  await form
    .getByLabel('Isento para associado adimplente')
    .setChecked(d.isento ?? true)
}

function enviarEspaco(page: Page, form: Locator): Promise<Resposta> {
  return Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/espacos/',
    ),
    form.getByRole('button', { name: 'Cadastrar espaço' }).click(),
  ]).then(([resposta]) => resposta)
}

const cartaoDoEspaco = (page: Page, nome: string) =>
  page.locator('div.cursor-pointer').filter({
    has: page.getByText(nome, { exact: true }),
  })

const detalheDoEspaco = (page: Page, nome: string) =>
  page
    .locator('div.rounded-xl')
    .filter({
      has: page.getByRole('heading', { name: nome, level: 2, exact: true }),
    })
    .last()

/** Cadastra pelo formulário e confere que o espaço entrou na lista; devolve o número dele. */
async function cadastrarEspaco(
  page: Page,
  d: DadosEspaco,
): Promise<{ id: number; nome: string }> {
  const form = await abrirFormularioDeEspaco(page)
  await preencherEspaco(form, d)
  const resposta = await enviarEspaco(page, form)
  const texto = await resposta.text()
  expect(
    resposta.ok(),
    `cadastrar o espaço "${d.nome}" foi recusado (HTTP ${resposta.status()}): ${texto}`,
  ).toBe(true)
  const { id_espaco } = JSON.parse(texto) as { id_espaco: number }
  await expect(form).toHaveCount(0) // o formulário se fecha sozinho
  await expect(cartaoDoEspaco(page, d.nome)).toBeVisible()
  return { id: id_espaco, nome: d.nome }
}

/** Abre os detalhes do espaço (clicando no cartão dele, se ainda não estiver aberto). */
async function abrirEspaco(page: Page, nome: string): Promise<Locator> {
  const detalhe = detalheDoEspaco(page, nome)
  if ((await detalhe.count()) === 0) await cartaoDoEspaco(page, nome).click()
  await expect(detalhe).toBeVisible()
  return detalhe
}

/** Cada bloco do detalhe (Bloqueios, Reservas, Isenções...) é um <div> com um <h3>; devolve o bloco do título. */
const secaoDe = (detalhe: Locator, titulo: string) =>
  detalhe
    .locator('div')
    .filter({
      has: detalhe
        .page()
        .getByRole('heading', { name: titulo, level: 3, exact: true }),
    })
    .first()

// ------------------------------------------------------------------------------------------------ reservas
type DadosReserva = {
  solicitante?: string
  inicio?: string
  fim?: string
  finalidade?: string
}

const formReserva = (secao: Locator) =>
  secao.locator('form').filter({
    has: secao.page().getByRole('button', { name: 'Reservar', exact: true }),
  })

/** Cada reserva da lista é um <div class="rounded-md border p-2">; os formulários são <form> e a tabela da exportação não tem `p-2`. */
const cartaoDeReserva = (secao: Locator, finalidade: string | RegExp) =>
  secao.locator('div.rounded-md.border.p-2').filter({ hasText: finalidade })

async function abrirFormReserva(secao: Locator): Promise<Locator> {
  const form = formReserva(secao)
  if ((await form.count()) === 0) {
    await secao
      .getByRole('button', { name: 'Nova reserva', exact: true })
      .click()
  }
  await expect(form).toBeVisible()
  return form
}

async function preencherReserva(form: Locator, d: DadosReserva): Promise<void> {
  if (d.solicitante) {
    const seletor = form.locator('select')
    await expect(
      seletor.locator('option', { hasText: d.solicitante }),
    ).toBeAttached()
    await escolherPorTexto(seletor, d.solicitante)
  }
  const datas = form.locator('input[type="datetime-local"]')
  if (d.inicio !== undefined) await datas.nth(0).fill(d.inicio)
  if (d.fim !== undefined) await datas.nth(1).fill(d.fim)
  if (d.finalidade !== undefined) {
    await form.getByPlaceholder('Finalidade').fill(d.finalidade)
  }
}

/** Preenche e envia o "Nova reserva" e devolve a resposta do servidor (para as recusas que TÊM de acontecer). */
async function tentarReservar(
  page: Page,
  secao: Locator,
  d: DadosReserva,
): Promise<Resposta> {
  const form = await abrirFormReserva(secao)
  await preencherReserva(form, d)
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/reservas-espaco/',
    ),
    form.getByRole('button', { name: 'Reservar', exact: true }).click(),
  ])
  return resposta
}

/** Reserva de verdade (solicitante padrão: SOLICITANTE) e confere que o cartão apareceu; devolve o número da reserva. */
async function reservar(
  page: Page,
  secao: Locator,
  d: { inicio: string; fim: string; finalidade: string; solicitante?: string },
): Promise<number> {
  const resposta = await tentarReservar(page, secao, {
    solicitante: SOLICITANTE,
    ...d,
  })
  const texto = await resposta.text()
  expect(
    resposta.ok(),
    `reservar "${d.finalidade}" foi recusado (HTTP ${resposta.status()}): ${texto}`,
  ).toBe(true)
  const { id_reserva } = JSON.parse(texto) as { id_reserva: number }
  await expect(formReserva(secao)).toHaveCount(0) // o formulário se fecha sozinho
  await expect(cartaoDeReserva(secao, d.finalidade)).toBeVisible()
  return id_reserva
}

/** Tenta reservar o que o sistema TEM de recusar: confere o código, a mensagem do servidor no alto do formulário e que nenhum cartão nasceu. */
async function reservaRecusada(
  page: Page,
  secao: Locator,
  d: { inicio: string; fim: string; finalidade: string; solicitante?: string },
  mensagem: RegExp,
  status = 400,
): Promise<void> {
  const resposta = await tentarReservar(page, secao, {
    solicitante: SOLICITANTE,
    ...d,
  })
  expect(
    resposta.status(),
    `"${d.finalidade}" devia ser recusada; o servidor respondeu ${resposta.status()}: ${await resposta.text()}`,
  ).toBe(status)
  await expect(
    formReserva(secao).getByRole('alert').filter({ hasText: mensagem }),
  ).toBeVisible()
  await expect(cartaoDeReserva(secao, d.finalidade)).toHaveCount(0)
}

// ------------------------------------------------------------------------------------------------ bloqueios
const formBloqueio = (secao: Locator) =>
  secao.locator('form').filter({
    has: secao.page().getByRole('button', { name: 'Bloquear', exact: true }),
  })

async function abrirFormBloqueio(secao: Locator): Promise<Locator> {
  const form = formBloqueio(secao)
  if ((await form.count()) === 0) {
    await secao
      .getByRole('button', { name: 'Novo bloqueio', exact: true })
      .click()
  }
  await expect(form).toBeVisible()
  return form
}

async function tentarBloquear(
  page: Page,
  secao: Locator,
  idEspaco: number,
  d: { inicio?: string; fim?: string; motivo?: string },
): Promise<Resposta> {
  const form = await abrirFormBloqueio(secao)
  const datas = form.locator('input[type="datetime-local"]')
  if (d.inicio !== undefined) await datas.nth(0).fill(d.inicio)
  if (d.fim !== undefined) await datas.nth(1).fill(d.fim)
  if (d.motivo !== undefined) {
    await form.locator('select').selectOption({ label: d.motivo })
  }
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/espacos/${idEspaco}/bloqueios`,
    ),
    form.getByRole('button', { name: 'Bloquear', exact: true }).click(),
  ])
  return resposta
}

async function bloquear(
  page: Page,
  secao: Locator,
  idEspaco: number,
  d: { inicio: string; fim: string; motivo: string },
): Promise<number> {
  const resposta = await tentarBloquear(page, secao, idEspaco, d)
  const texto = await resposta.text()
  expect(
    resposta.ok(),
    `bloquear foi recusado (HTTP ${resposta.status()}): ${texto}`,
  ).toBe(true)
  const { id_bloqueio } = JSON.parse(texto) as { id_bloqueio: number }
  await expect(formBloqueio(secao)).toHaveCount(0)
  return id_bloqueio
}

/** A disponibilidade do espaço como o site a lê (leitura pública, sem login, nunca diz quem reservou): os horários ocupados, em UTC. */
async function disponibilidadePublica(
  page: Page,
  idEspaco: number,
): Promise<{ data_hora_inicio: string; data_hora_fim: string }[]> {
  const resposta = await page.request.get(
    `${API_HML}/api/espacos/${idEspaco}/disponibilidade`,
  )
  expect(resposta.status()).toBe(200)
  return (await resposta.json()) as {
    data_hora_inicio: string
    data_hora_fim: string
  }[]
}

const temIntervalo = (
  lista: { data_hora_inicio: string }[],
  dia: Dia,
  hora: string,
) => lista.some((i) => i.data_hora_inicio.startsWith(emUtc(dia, hora)))

// =====================================================================================================================================
// A. RESERVA DE ESPAÇO
// =====================================================================================================================================
test.describe('A. Reserva de espaço', () => {
  test('o módulo abre pelo Início, a tela oferece o que promete e todo campo dos formulários tem rótulo', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page
      .getByRole('link', { name: 'Reserva de Espaço', exact: true })
      .first()
      .click()
    await expect(page).toHaveURL(/\/reserva-espaco$/)
    await expect(
      page.getByRole('heading', { name: 'Reserva de Espaço', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Espaços', level: 2, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Mapa de calor de ocupação',
        level: 2,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Novo espaço', exact: true }),
    ).toBeVisible()
    await ver(page, info, 'reserva de espaco: tela aberta pelo Inicio')

    const semRotulo: string[] = []
    const inventario = async (nome: string) => {
      try {
        await inventariar(page, info, nome)
      } catch (erro) {
        semRotulo.push(`${nome}: ${(erro as Error).message}`)
      }
    }

    // o formulário "Novo espaço"
    await abrirFormularioDeEspaco(page)
    await inventario('espacos-novo-espaco')
    await ver(page, info, 'formulario de novo espaco aberto')
    await formularioDeEspaco(page)
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click()
    await expect(formularioDeEspaco(page)).toHaveCount(0)

    // um espaço só para abrir o que o detalhe oferece
    const { nome } = await cadastrarEspaco(page, {
      nome: `Salão do inventário ${RODADA}`,
    })
    const detalhe = await abrirEspaco(page, nome)
    const bloqueios = secaoDe(detalhe, 'Bloqueios')
    const reservas = secaoDe(detalhe, 'Reservas')
    await expect(bloqueios).toContainText('Nenhum bloqueio registrado.')
    await expect(reservas).toContainText('Nenhuma reserva para este espaço.')
    await expect(
      secaoDe(detalhe, 'Isenções justificadas de taxa de reserva'),
    ).toContainText('Nenhuma isenção concedida.')
    await expect(detalhe).toContainText('Confirmação instantânea')
    await expect(detalhe).toContainText('gratuito')

    await reservas
      .getByRole('button', { name: 'Nova reserva', exact: true })
      .click()
    await inventario('espacos-nova-reserva')
    await reservas
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click()
    await expect(formReserva(reservas)).toHaveCount(0)

    await reservas
      .getByRole('button', { name: 'Reserva recorrente', exact: true })
      .click()
    await expect(
      reservas.getByRole('button', { name: 'Criar série', exact: true }),
    ).toBeVisible()
    await inventario('espacos-reserva-recorrente')
    await reservas
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click()

    await bloqueios
      .getByRole('button', { name: 'Novo bloqueio', exact: true })
      .click()
    await inventario('espacos-novo-bloqueio')
    await ver(page, info, 'formulario de novo bloqueio aberto')
    await bloqueios
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click()
    await expect(formBloqueio(bloqueios)).toHaveCount(0)

    await inventario('espacos-detalhe')
    await ver(page, info, 'detalhe do espaco: bloqueios, reservas e isencoes')
    expect
      .soft(semRotulo, 'campo(s) sem rótulo acessível nos formulários')
      .toEqual([])
    expect(vigia.problemas()).toEqual([])
  })

  test('cadastrar espaço: nome vazio, curto ou só espaços, tipo não escolhido, prazo negativo e percentual fora de 0 a 100 são recusados', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const enviados = contarEnvios(page, /^\/api\/espacos\/$/)
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'espacos')
    await abrirEspacos(page)
    const form = await abrirFormularioDeEspaco(page)
    const cadastrar = form.getByRole('button', { name: 'Cadastrar espaço' })
    const alertas = form.getByRole('alert')

    // 1. tudo vazio: as duas faltas aparecem, cada uma no seu campo, e nada vai ao servidor
    await cadastrar.click()
    await expect(
      alertas.filter({ hasText: 'Informe o nome do espaço.' }),
    ).toHaveCount(1)
    await expect(
      alertas.filter({ hasText: 'Selecione o tipo de espaço.' }),
    ).toHaveCount(1)
    expect(enviados(), 'formulário vazio não deve ir ao servidor').toBe(0)
    await ver(page, info, 'espaco vazio: recusado')

    // 2. nome de uma letra
    await form.getByPlaceholder('Nome do espaço').fill('x')
    await cadastrar.click()
    await expect(
      alertas.filter({ hasText: 'Informe o nome do espaço.' }),
    ).toHaveCount(1)
    expect(enviados()).toBe(0)

    // 3. prazo de cancelamento negativo (nome e tipo certos): a recusa vem num resumo no alto, e tem de estar em português
    await form
      .getByPlaceholder('Nome do espaço')
      .fill(`Espaço recusado ${RODADA}`)
    await form.locator('select').first().selectOption({ label: 'Salão' })
    await form.getByPlaceholder('Prazo de cancelamento (horas)').fill('-5')
    await cadastrar.click()
    const resumo = alertas.filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toBeVisible()
    const textoDoResumo = (await resumo.innerText()).replace(/\s+/g, ' ')
    info.annotations.push({
      type: 'prazo negativo',
      description: `a tela disse: ${textoDoResumo}`,
    })
    expect
      .soft(
        textoDoResumo,
        'a recusa do prazo negativo aparece em inglês (mensagem padrão do Zod, sem texto próprio no schema)',
      )
      .not.toMatch(/Too small|expected|Invalid/i)
    expect(enviados()).toBe(0)
    await ver(page, info, 'prazo de cancelamento negativo: recusado')

    // 4. percentual de reembolso acima de 100
    await form.getByPlaceholder('Prazo de cancelamento (horas)').fill('24')
    await form.getByPlaceholder('% de reembolso (opcional)').fill('150')
    await cadastrar.click()
    await expect(
      alertas.filter({ hasText: 'Informe um percentual entre 0 e 100.' }),
    ).toHaveCount(1)
    expect(enviados()).toBe(0)
    await ver(page, info, 'percentual de reembolso acima de 100: recusado')

    // 5. nome só de espaços: passa na tela (tem 2 caracteres) e o SERVIDOR recusa, apontando o campo
    await form.getByPlaceholder('% de reembolso (opcional)').fill('')
    await form.getByPlaceholder('Nome do espaço').fill('  ')
    const conta = form.locator('select').nth(1)
    await expect(conta.locator('option').nth(1)).toBeAttached()
    await conta.selectOption({ index: 1 })
    await form.getByPlaceholder('Bloquear após N faltas (opcional)').fill('3')
    const resposta = await enviarEspaco(page, form)
    expect(resposta.status()).toBe(422)
    await expect(
      alertas.filter({ hasText: 'Informe o nome do espaço.' }),
    ).toHaveCount(1)
    expect(enviados()).toBe(1)
    await ver(page, info, 'nome so de espacos: recusado pelo servidor')

    // nenhuma das recusas deixou espaço nem rastro na Auditoria
    expect(await abrirAuditoria(page, 'espacos')).toBe(antes)
    await ver(page, info, 'auditoria dos espacos: nada novo depois das recusas')

    // 6. achado provável: o mesmo nome de espaço cadastrado duas vezes (só depois de medir a Auditoria, porque cria espaço)
    const repetido = `Espaço repetido ${RODADA}`
    await abrirEspacos(page)
    const formRepetido = await abrirFormularioDeEspaco(page)
    await preencherEspaco(formRepetido, { nome: repetido })
    const primeiro = await enviarEspaco(page, formRepetido)
    expect(primeiro.ok()).toBe(true)
    await expect(formRepetido).toHaveCount(0)
    const formDeNovo = await abrirFormularioDeEspaco(page)
    await preencherEspaco(formDeNovo, { nome: repetido })
    const segundo = await enviarEspaco(page, formDeNovo)
    expect
      .soft(
        segundo.ok(),
        'o sistema ACEITOU um segundo espaço com o mesmo nome (a lista fica com dois cartões iguais, sem como distinguir)',
      )
      .toBe(false)
    await ver(page, info, 'espaco com nome repetido: aceito ou recusado')
    expect(vigia.problemas()).toEqual([])
  })

  test('espaço só com nome e tipo é aceito e dá para reservar nele; o mesmo vale quando os campos opcionais foram preenchidos e depois apagados', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const dia = diaEmBelem(3)
    await entrar(page, 'presidente')
    await abrirEspacos(page)

    // 1. só nome e tipo: os opcionais nunca foram tocados
    const nomeMinimo = `Espaço mínimo ${RODADA}`
    const form = await abrirFormularioDeEspaco(page)
    await form.getByPlaceholder('Nome do espaço').fill(nomeMinimo)
    await form.locator('select').first().selectOption({ label: 'Sala' })
    const minimo = await enviarEspaco(page, form)
    expect(
      minimo.status(),
      `espaço só com nome e tipo foi recusado: ${await minimo.text()}`,
    ).toBe(200)
    await expect(form).toHaveCount(0)
    await expect(cartaoDoEspaco(page, nomeMinimo)).toBeVisible()
    const detalhe = await abrirEspaco(page, nomeMinimo)
    const reserva = await tentarReservar(page, secaoDe(detalhe, 'Reservas'), {
      solicitante: SOLICITANTE,
      inicio: quando(dia, '10:00'),
      fim: quando(dia, '11:00'),
      finalidade: `Reserva no espaço mínimo ${RODADA}`,
    })
    expect(
      reserva.status(),
      `reservar no espaço mínimo foi recusado: ${await reserva.text()}`,
    ).toBe(200)
    await ver(page, info, 'espaco so com nome e tipo: aceito, e reserva aceita')

    // 2. quem digita um valor e depois apaga (ou escolhe a conta e volta para "Conta de receita…") tem de ficar como quem nunca preencheu
    const nomeCorrigido = `Espaço corrigido ${RODADA}`
    const formCorrigido = await abrirFormularioDeEspaco(page)
    await formCorrigido.getByPlaceholder('Nome do espaço').fill(nomeCorrigido)
    await formCorrigido
      .locator('select')
      .first()
      .selectOption({ label: 'Sala' })
    for (const rotulo of [
      'Capacidade',
      'Valor da reserva (R$, opcional)',
      'Taxa de cancelamento tardio (R$)',
      'Bloquear após N faltas (opcional)',
    ]) {
      const entrada = formCorrigido.getByPlaceholder(rotulo)
      await entrada.fill('5')
      await entrada.fill('')
    }
    const conta = formCorrigido.locator('select').nth(1)
    await expect(conta.locator('option').nth(1)).toBeAttached()
    await conta.selectOption({ index: 1 })
    await conta.selectOption('')
    const resposta = await enviarEspaco(page, formCorrigido).catch(() => null)
    const status = resposta?.status() ?? 0
    const corpo = resposta ? await resposta.text() : '(sem resposta legível)'
    info.annotations.push({
      type: 'espaco com opcionais apagados',
      description: `enviado: ${JSON.stringify(resposta?.request().postDataJSON() ?? null)} | HTTP ${status}: ${corpo.slice(0, 300)}`,
    })
    expect(
      status,
      `espaço com os opcionais preenchidos e apagados foi recusado: ${corpo.slice(0, 200)}`,
    ).toBe(200)
    await ver(page, info, `espaco com opcionais apagados: HTTP ${status}`)
    await expect(cartaoDoEspaco(page, nomeCorrigido)).toBeVisible()
    const detalheCorrigido = await abrirEspaco(page, nomeCorrigido)
    const outra = await tentarReservar(
      page,
      secaoDe(detalheCorrigido, 'Reservas'),
      {
        solicitante: SOLICITANTE,
        inicio: quando(dia, '10:00'),
        fim: quando(dia, '11:00'),
        finalidade: `Reserva no espaço corrigido ${RODADA}`,
      },
    )
    expect(
      outra.status(),
      `reservar no espaço cujos opcionais foram apagados foi recusado: ${(await outra.text()).slice(0, 200)}`,
    ).toBe(200)
    await ver(page, info, 'reserva no espaco corrigido: aceita')
    expect(vigia.problemas()).toEqual([])
  })

  test('tarifa: o espaço pago gera cobrança, a isenção justificada zera a do beneficiado, e cancelar dentro do prazo não cobra taxa', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const nome = `Salão pago ${RODADA} (tarifa)`
    const dia = diaEmBelem(10)
    await entrar(page, 'presidente')
    await abrirEspacos(page)
    const { id: idEspaco } = await cadastrarEspaco(page, {
      nome,
      capacidade: '80',
      valor: '150',
      prazo: '72',
      taxa: '30',
      reembolso: '50',
      isento: false,
    })
    const detalhe = await abrirEspaco(page, nome)
    await expect(detalhe).toContainText(/R\$\s*150,00/)
    await expect(detalhe).toContainText('Confirmação instantânea')
    await ver(page, info, 'espaco pago cadastrado: tarifa de R$ 150,00')
    const reservas = secaoDe(detalhe, 'Reservas')

    // a reserva de quem NÃO é isento gera a cobrança, e o número do título aparece no cartão
    const finalidade = `Cobrança de teste ${RODADA}`
    const idReserva = await reservar(page, reservas, {
      inicio: quando(dia, '10:00'),
      fim: quando(dia, '12:00'),
      finalidade,
    })
    const cartao = cartaoDeReserva(reservas, finalidade)
    await expect(cartao.getByText('CONFIRMADA', { exact: true })).toBeVisible()
    await expect(cartao).toContainText(/Cobrança gerada \(título #\d+\)/)
    const idTitulo = Number(/título #(\d+)/.exec(await cartao.innerText())?.[1])
    expect(Number.isInteger(idTitulo)).toBe(true)
    await ver(page, info, 'reserva no espaco pago: confirmada com cobranca')

    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idReserva,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: reserva do espaco pago')
    await abrirAuditoria(page, 'espacos')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idEspaco,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: espaco cadastrado')

    // o título existe no Financeiro, com o valor da tarifa
    await page.goto('/financeiro/titulos?periodo=todos')
    await expect(
      page.getByRole('heading', { name: 'Títulos', level: 1 }),
    ).toBeVisible()
    const tituloDaReserva = page
      .locator('div.rounded-md.border')
      .filter({ hasText: `Reserva de espaço '${nome}'` })
    await expect(tituloDaReserva).toHaveCount(1)
    await expect(tituloDaReserva).toContainText('A Receber')
    await expect(tituloDaReserva).toContainText('Pendente')
    await expect(tituloDaReserva).toContainText(/Original\s+R\$\s*150,00/)
    await expect(tituloDaReserva).toContainText(/Saldo\s+R\$\s*150,00/)
    expect
      .soft(
        tituloDaReserva,
        'a descrição da cobrança mostra o horário da reserva em UTC (13:00) sem avisar: a reserva é às 10:00 de Belém (app/services/reservas.py::_gerar_cobranca_se_devido usa strftime no valor UTC)',
      )
      .toContainText(mostrado(dia, '10:00'), { timeout: 5_000 })
    await ver(page, info, 'financeiro: cobranca da reserva (R$ 150,00)')

    // isenção justificada: recusas e depois concessão de 100% a OUTRO associado
    await abrirEspacos(page)
    const detalhe2 = await abrirEspaco(page, nome)
    const secaoIsencoes = secaoDe(
      detalhe2,
      'Isenções justificadas de taxa de reserva',
    )
    const formIsencao = secaoIsencoes.locator('form')
    const alertasIsencao = formIsencao.getByRole('alert')
    await formIsencao.getByRole('button', { name: 'Conceder isenção' }).click()
    await expect(
      alertasIsencao.filter({ hasText: 'Selecione o motivo.' }),
    ).toBeVisible()
    await ver(page, info, 'isencao sem motivo: recusada')
    const motivo = formIsencao.locator('select').nth(1)
    await expect(
      motivo.locator('option', { hasText: 'Voluntário da equipe do evento' }),
    ).toBeAttached()
    await motivo.selectOption({ label: 'Voluntário da equipe do evento' })
    await formIsencao.getByRole('button', { name: 'Conceder isenção' }).click()
    await expect(
      alertasIsencao.filter({ hasText: /Selecione um associado ou informe/ }),
    ).toBeVisible()
    const percentual = formIsencao.getByPlaceholder('% isento')
    await percentual.fill('0')
    await formIsencao.getByRole('button', { name: 'Conceder isenção' }).click()
    await expect(
      alertasIsencao.filter({ hasText: 'Informe um percentual maior que 0.' }),
    ).toBeVisible()
    await percentual.fill('150')
    await formIsencao.getByRole('button', { name: 'Conceder isenção' }).click()
    await expect(
      alertasIsencao.filter({
        hasText: 'Informe um percentual entre 0 e 100.',
      }),
    ).toBeVisible()
    await ver(page, info, 'isencao com percentual fora de 0 a 100: recusada')
    await expect(
      secaoIsencoes.locator('div.rounded-md.border.p-2'),
    ).toHaveCount(0)

    await percentual.fill('100')
    const associado = formIsencao.locator('select').first()
    await expect(
      associado.locator('option', { hasText: OUTRO_SOLICITANTE }),
    ).toBeAttached()
    await escolherPorTexto(associado, OUTRO_SOLICITANTE)
    const [concedida] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname === `/api/espacos/${idEspaco}/isencoes`,
      ),
      formIsencao.getByRole('button', { name: 'Conceder isenção' }).click(),
    ])
    expect(concedida.status()).toBe(200)
    const { id_isencao } = (await concedida.json()) as { id_isencao: number }
    const cartaoIsencao = secaoIsencoes.locator('div.rounded-md.border.p-2')
    await expect(cartaoIsencao).toHaveCount(1)
    await expect(cartaoIsencao).toContainText(/100(\.0+)?% isento/)
    await expect(cartaoIsencao).toContainText('VOLUNTARIO_DA_EQUIPE')
    await ver(page, info, 'isencao de 100% concedida')

    await abrirAuditoria(page, 'isencoes_taxa_contexto')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: id_isencao,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: isencao concedida')

    // quem tem a isenção reserva no mesmo espaço sem cobrança
    await abrirEspacos(page)
    const detalhe3 = await abrirEspaco(page, nome)
    const reservas3 = secaoDe(detalhe3, 'Reservas')
    const diaIsento = diaEmBelem(11)
    const finalidadeIsenta = `Reserva isenta ${RODADA}`
    await reservar(page, reservas3, {
      solicitante: OUTRO_SOLICITANTE,
      inicio: quando(diaIsento, '10:00'),
      fim: quando(diaIsento, '12:00'),
      finalidade: finalidadeIsenta,
    })
    const cartaoIsento = cartaoDeReserva(reservas3, finalidadeIsenta)
    await expect(
      cartaoIsento.getByText('CONFIRMADA', { exact: true }),
    ).toBeVisible()
    await expect(cartaoIsento).not.toContainText('Cobrança gerada')
    await ver(page, info, 'reserva de quem tem isencao: sem cobranca')

    // cancelar DENTRO do prazo (10 dias à frente, prazo de 72 h): sem taxa e sem reembolso
    const cartaoCobrado = cartaoDeReserva(reservas3, finalidade)
    const [cancelada] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname ===
            `/api/reservas-espaco/${idReserva}/cancelar`,
      ),
      cartaoCobrado
        .getByRole('button', { name: 'Cancelar', exact: true })
        .click(),
    ])
    expect(cancelada.status()).toBe(200)
    expect(((await cancelada.json()) as { reembolso: unknown }).reembolso).toBe(
      null,
    )
    await expect(
      cartaoCobrado.getByText('CANCELADA', { exact: true }),
    ).toBeVisible()
    await expect(cartaoCobrado).not.toContainText('Reembolso gerado')
    for (const botao of ['Cancelar', 'Editar', 'Não compareceu', 'Checklist']) {
      await expect(
        cartaoCobrado.getByRole('button', { name: botao, exact: true }),
      ).toHaveCount(0)
    }
    await ver(page, info, 'reserva cancelada dentro do prazo')

    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'CANCELAMENTO', {
        registro: idReserva,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: cancelamento')

    // Financeiro: dentro do prazo não nasce taxa; e a cobrança da reserva cancelada não pode continuar pendente
    // (conferido ANTES de reservar o mesmo horário de novo, que geraria uma segunda cobrança com o mesmo dia)
    await page.goto('/financeiro/titulos?periodo=todos')
    await expect(
      page.getByRole('heading', { name: 'Títulos', level: 1 }),
    ).toBeVisible()
    await expect(
      page.locator('div.rounded-md.border').filter({
        hasText: `Taxa de cancelamento tardio - reserva de '${nome}'`,
      }),
    ).toHaveCount(0)
    const cobrancaCancelada = page
      .locator('div.rounded-md.border')
      .filter({ hasText: `Reserva de espaço '${nome}'` })
      .filter({ hasText: `em ${dia.br}` })
      .first()
    await expect(cobrancaCancelada).toBeVisible()
    await expect
      .soft(
        cobrancaCancelada.getByText('Pendente', { exact: true }),
        `a cobrança #${idTitulo} da reserva CANCELADA continua Pendente (e a pessoa fica devendo): cancelar_reserva não anula o título ainda não pago`,
      )
      .toHaveCount(0, { timeout: 5_000 })
    await ver(page, info, 'financeiro: a cobranca da reserva cancelada')

    // o horário voltou a ficar livre
    await abrirEspacos(page)
    const detalhe4 = await abrirEspaco(page, nome)
    await reservar(page, secaoDe(detalhe4, 'Reservas'), {
      inicio: quando(dia, '10:00'),
      fim: quando(dia, '12:00'),
      finalidade: `Mesmo horário depois de cancelar ${RODADA}`,
    })
    await ver(page, info, 'mesmo horario reservado de novo depois de cancelar')
    expect(vigia.problemas()).toEqual([])
  })

  test('cancelar fora do prazo: a taxa de cancelamento tardio e o reembolso da cobrança já paga (o aviso aparece na tela), e uma segunda aba parada não consegue cancelar de novo', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    const nome = `Salão pago ${RODADA} (cancelamento)`
    const dia = diaEmBelem(2)
    const finalidade = `Reserva paga e cancelada ${RODADA}`
    await entrar(page, 'presidente')
    await abrirEspacos(page)
    await cadastrarEspaco(page, {
      nome,
      valor: '150',
      prazo: '72',
      taxa: '30',
      reembolso: '50',
      isento: false,
    })
    const detalhe = await abrirEspaco(page, nome)
    const reservas = secaoDe(detalhe, 'Reservas')
    const idReserva = await reservar(page, reservas, {
      inicio: quando(dia, '12:00'),
      fim: quando(dia, '13:00'),
      finalidade,
    })
    const cartao = cartaoDeReserva(reservas, finalidade)
    await expect(cartao).toContainText(/Cobrança gerada \(título #\d+\)/)
    const idTitulo = Number(/título #(\d+)/.exec(await cartao.innerText())?.[1])
    expect(Number.isInteger(idTitulo)).toBe(true)

    // paga a cobrança pela tela de Títulos (sem pagamento não há o que reembolsar)
    await page.goto('/financeiro/titulos?periodo=todos')
    await expect(
      page.getByRole('heading', { name: 'Títulos', level: 1 }),
    ).toBeVisible()
    const titulo = page
      .locator('div.rounded-md.border')
      .filter({ hasText: `Reserva de espaço '${nome}'` })
    await expect(titulo).toHaveCount(1)
    await titulo.getByRole('button', { name: 'Baixar', exact: true }).click()
    const baixa = titulo.locator('form')
    await baixa.getByPlaceholder('Valor pago').fill('150')
    await baixa.getByPlaceholder('Forma de pagamento').fill('Pix')
    const contrapartida = baixa.locator('select').first()
    await expect(contrapartida.locator('option').nth(1)).toBeAttached()
    await contrapartida.selectOption({ index: 1 })
    await baixa.getByRole('button', { name: 'Confirmar baixa' }).click()
    await expect(titulo.getByText('Pago', { exact: true })).toBeVisible()
    await ver(page, info, 'cobranca da reserva paga')

    // uma segunda aba, aberta ANTES do cancelamento, fica com o botão "Cancelar" parado na tela
    await abrirEspacos(page)
    const outra = await page.context().newPage()
    const vigiaOutra = vigiar(outra)
    await abrirEspacos(outra)
    const detalheOutra = await abrirEspaco(outra, nome)
    const cartaoOutra = cartaoDeReserva(
      secaoDe(detalheOutra, 'Reservas'),
      finalidade,
    )
    await expect(
      cartaoOutra.getByRole('button', { name: 'Cancelar', exact: true }),
    ).toBeVisible()

    // cancelar a 2 dias da data, com prazo de 72 h: é tardio
    const detalhe2 = await abrirEspaco(page, nome)
    const cartao2 = cartaoDeReserva(secaoDe(detalhe2, 'Reservas'), finalidade)
    const [cancelada] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname ===
            `/api/reservas-espaco/${idReserva}/cancelar`,
      ),
      cartao2.getByRole('button', { name: 'Cancelar', exact: true }).click(),
    ])
    expect(cancelada.status()).toBe(200)
    const corpo = (await cancelada.json()) as {
      reembolso: { id_titulo: number; valor: number } | null
    }
    expect(corpo.reembolso, 'cobrança paga + fora do prazo + 50%').not.toBe(
      null,
    )
    expect(corpo.reembolso?.valor).toBe(75)
    await expect(cartao2.getByText('CANCELADA', { exact: true })).toBeVisible()
    await expect(cartao2).toContainText(/Reembolso gerado:\s*R\$\s*75,00/)
    await expect(cartao2).toContainText(/título a pagar #\d+/)
    await expect
      .soft(
        cartao2,
        'cancelar fora do prazo gerou uma TAXA de R$ 30,00 e a tela não conta isso a quem cancelou (só o reembolso é mostrado)',
      )
      .toContainText(/taxa/i, { timeout: 5_000 })
    await ver(page, info, 'reserva cancelada fora do prazo: reembolso na tela')

    // a segunda aba (desatualizada) tenta cancelar o que já foi cancelado: o servidor recusa
    const [recusa] = await Promise.all([
      outra.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname ===
            `/api/reservas-espaco/${idReserva}/cancelar`,
      ),
      cartaoOutra
        .getByRole('button', { name: 'Cancelar', exact: true })
        .click(),
    ])
    expect(recusa.status()).toBe(400)
    expect(((await recusa.json()) as { detail: string }).detail).toMatch(
      /não pode ser cancelada/,
    )
    await expect
      .soft(
        outra.getByText(/não pode ser cancelada/),
        'a recusa do servidor ao cancelar de novo não aparece em lugar nenhum da tela: o botão Cancelar não mostra o erro da própria ação',
      )
      .toBeVisible({ timeout: 5_000 })
    await ver(outra, info, 'segunda aba: cancelar de novo foi recusado')
    expect(vigiaOutra.problemas()).toEqual([])
    await outra.close()

    // o link do aviso leva ao Financeiro, onde estão a taxa e o reembolso
    // o aviso da taxa e o do reembolso têm, cada um, o seu atalho para os títulos: qualquer um serve
    await cartao2
      .getByRole('link', { name: 'Financeiro > Títulos' })
      .first()
      .click()
    await expect(page).toHaveURL(/\/financeiro\/titulos$/)
    await expect(
      page.getByRole('heading', { name: 'Títulos', level: 1 }),
    ).toBeVisible()
    const reembolso = page
      .locator('div.rounded-md.border')
      .filter({ hasText: `título original #${idTitulo}` })
    await expect(reembolso).toHaveCount(1)
    await expect(reembolso).toContainText('A Pagar')
    await expect(reembolso).toContainText(/Reembolso \(50(\.0+)?%\)/)
    await expect(reembolso).toContainText(/Original\s+R\$\s*75,00/)
    const taxa = page.locator('div.rounded-md.border').filter({
      hasText: `Taxa de cancelamento tardio - reserva de '${nome}'`,
    })
    await expect(taxa).toHaveCount(1)
    await expect(taxa).toContainText('A Receber')
    await expect(taxa).toContainText('Pendente')
    await expect(taxa).toContainText(/Original\s+R\$\s*30,00/)
    await ver(
      page,
      info,
      'financeiro: taxa de R$ 30,00 e reembolso de R$ 75,00',
    )

    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'CANCELAMENTO', {
        registro: idReserva,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: cancelamento com reembolso')
    expect(vigia.problemas()).toEqual([])
  })

  test('reservar: campos vazios, finalidade curta, fim antes do início e CONFLITO DE HORÁRIO (todas as sobreposições) são recusados; horários que só se encostam e outro espaço são aceitos', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    const enviados = contarEnvios(page, /^\/api\/reservas-espaco\/$/)
    const nome = `Quadra de conflito ${RODADA}`
    const vizinho = `Sala vizinha ${RODADA}`
    const dia = diaEmBelem(5)
    let criadas = 0
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'reservas_espaco')
    await abrirEspacos(page)
    await cadastrarEspaco(page, { nome })
    await cadastrarEspaco(page, { nome: vizinho, tipo: 'Sala' })
    const detalhe = await abrirEspaco(page, nome)
    const secao = secaoDe(detalhe, 'Reservas')

    // 1. tudo vazio: a finalidade aparece no campo e o resto no resumo; nada vai ao servidor
    const form = await abrirFormReserva(secao)
    await form.getByRole('button', { name: 'Reservar', exact: true }).click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'Descreva a finalidade.' }),
    ).toHaveCount(1)
    const resumo = form
      .getByRole('alert')
      .filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toContainText('Selecione o solicitante.')
    await expect(resumo).toContainText('Informe o início.')
    await expect(resumo).toContainText('Informe o fim.')
    expect(enviados(), 'formulário vazio não deve ir ao servidor').toBe(0)
    await ver(page, info, 'reserva vazia: recusada')

    // 2. finalidade de duas letras: recusada na tela
    await preencherReserva(form, {
      solicitante: SOLICITANTE,
      inicio: quando(dia, '14:00'),
      fim: quando(dia, '16:00'),
      finalidade: 'ab',
    })
    await form.getByRole('button', { name: 'Reservar', exact: true }).click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'Descreva a finalidade.' }),
    ).toHaveCount(1)
    expect(enviados()).toBe(0)

    // 3. finalidade só de espaços: passa na tela e o SERVIDOR recusa, apontando o campo
    await form.getByPlaceholder('Finalidade').fill('   ')
    const [recusadaPeloServidor] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname === '/api/reservas-espaco/',
      ),
      form.getByRole('button', { name: 'Reservar', exact: true }).click(),
    ])
    expect(recusadaPeloServidor.status()).toBe(422)
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Descreva a finalidade da reserva.' }),
    ).toBeVisible()
    await ver(page, info, 'finalidade so de espacos: recusada pelo servidor')

    // 4. fim antes do início, e fim igual ao início
    await reservaRecusada(
      page,
      secao,
      {
        inicio: quando(dia, '16:00'),
        fim: quando(dia, '14:00'),
        finalidade: `Fim antes do início ${RODADA}`,
      },
      ERRO_FIM_ANTES_DO_INICIO,
    )
    await ver(page, info, 'reserva com fim antes do inicio: recusada')
    await reservaRecusada(
      page,
      secao,
      {
        inicio: quando(dia, '14:00'),
        fim: quando(dia, '14:00'),
        finalidade: `Fim igual ao início ${RODADA}`,
      },
      ERRO_FIM_ANTES_DO_INICIO,
    )

    // 5. a reserva de verdade (14h às 16h) e o conflito em cada forma de sobreposição
    const finalidadeBase = `Reunião do robô ${RODADA} (base)`
    const idBase = await reservar(page, secao, {
      inicio: quando(dia, '14:00'),
      fim: quando(dia, '16:00'),
      finalidade: finalidadeBase,
    })
    criadas += 1
    await expect(
      cartaoDeReserva(secao, finalidadeBase).getByText('CONFIRMADA', {
        exact: true,
      }),
    ).toBeVisible()
    await ver(page, info, 'reserva base das 14h as 16h confirmada')

    const sobreposicoes: [string, string, string][] = [
      ['15:00', '17:00', 'começa dentro e termina depois'],
      ['13:00', '15:00', 'começa antes e termina dentro'],
      ['13:00', '17:00', 'envolve a reserva'],
      ['14:30', '15:30', 'fica dentro da reserva'],
      ['14:00', '16:00', 'idêntica'],
    ]
    for (const [i, [inicio, fim, jeito]] of sobreposicoes.entries()) {
      await reservaRecusada(
        page,
        secao,
        {
          inicio: quando(dia, inicio),
          fim: quando(dia, fim),
          finalidade: `Conflito ${i + 1} (${jeito}) ${RODADA}`,
        },
        ERRO_CONFLITO,
      )
      if (i === 0) {
        await ver(
          page,
          info,
          'conflito de horario recusado (mensagem do servidor)',
        )
      }
    }
    await expect(cartaoDeReserva(secao, /Conflito \d \(/)).toHaveCount(0)

    // 6. horários que só se ENCOSTAM não colidem: logo depois (16h as 18h) e logo antes (12h as 14h)
    const finalidadeDepois = `Logo depois ${RODADA}`
    await reservar(page, secao, {
      inicio: quando(dia, '16:00'),
      fim: quando(dia, '18:00'),
      finalidade: finalidadeDepois,
    })
    criadas += 1
    const finalidadeAntes = `Logo antes ${RODADA}`
    await reservar(page, secao, {
      inicio: quando(dia, '12:00'),
      fim: quando(dia, '14:00'),
      finalidade: finalidadeAntes,
    })
    criadas += 1
    await ver(
      page,
      info,
      'tres reservas lado a lado: 12h-14h, 14h-16h, 16h-18h',
    )

    // 7. o mesmo horário em OUTRO espaço é aceito (o conflito é por espaço)
    const detalheVizinho = await abrirEspaco(page, vizinho)
    const secaoVizinho = secaoDe(detalheVizinho, 'Reservas')
    await reservar(page, secaoVizinho, {
      inicio: quando(dia, '14:00'),
      fim: quando(dia, '16:00'),
      finalidade: `Mesmo horário em outro espaço ${RODADA}`,
    })
    criadas += 1

    // 8. Auditoria: só as reservas feitas de verdade deixaram rastro; nenhuma recusa
    expect(await abrirAuditoria(page, 'reservas_espaco')).toBe(antes + criadas)
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idBase,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: so as reservas aceitas deixaram rastro')

    // 9. achado provável: reserva no passado também é aceita (só depois de medir a Auditoria, porque cria uma reserva)
    await abrirEspacos(page)
    const detalhe2 = await abrirEspaco(page, nome)
    const secao2 = secaoDe(detalhe2, 'Reservas')
    const passado = diaEmBelem(-3)
    const respostaDoPassado = await tentarReservar(page, secao2, {
      solicitante: SOLICITANTE,
      inicio: quando(passado, '10:00'),
      fim: quando(passado, '11:00'),
      finalidade: `Reserva no passado ${RODADA}`,
    })
    expect
      .soft(
        respostaDoPassado.ok(),
        'o sistema ACEITOU uma reserva para um horário que já passou (nada impede reservar o passado)',
      )
      .toBe(false)
    await ver(page, info, 'reserva no passado: aceita ou recusada')
    expect(vigia.problemas()).toEqual([])
  })

  test('bloqueio do espaço: campos vazios, fim antes do início e bloqueio em cima de reserva são recusados; o horário bloqueado recusa reserva e o bloqueio aparece na disponibilidade', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const nome = `Quadra com bloqueio ${RODADA}`
    const dia = diaEmBelem(5)
    const diaDoBloqueio = diaEmBelem(6)
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'bloqueios_espaco')
    await abrirEspacos(page)
    const { id: idEspaco } = await cadastrarEspaco(page, { nome })
    const detalhe = await abrirEspaco(page, nome)
    const reservas = secaoDe(detalhe, 'Reservas')
    const bloqueios = secaoDe(detalhe, 'Bloqueios')
    const idReserva = await reservar(page, reservas, {
      inicio: quando(dia, '14:00'),
      fim: quando(dia, '16:00'),
      finalidade: `Reserva sob o bloqueio ${RODADA}`,
    })

    // 1. vazio: as três faltas aparecem no resumo e nada vai ao servidor
    const enviados = contarEnvios(page, /\/bloqueios$/)
    const form = await abrirFormBloqueio(bloqueios)
    await form.getByRole('button', { name: 'Bloquear', exact: true }).click()
    const resumo = form
      .getByRole('alert')
      .filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toContainText('Informe o início do bloqueio.')
    await expect(resumo).toContainText('Informe o fim do bloqueio.')
    await expect(resumo).toContainText('Selecione o motivo.')
    expect(enviados(), 'bloqueio vazio não deve ir ao servidor').toBe(0)
    await ver(page, info, 'bloqueio vazio: recusado')

    // 2. fim antes do início
    const invertido = await tentarBloquear(page, bloqueios, idEspaco, {
      inicio: quando(diaDoBloqueio, '18:00'),
      fim: quando(diaDoBloqueio, '08:00'),
      motivo: 'Manutenção',
    })
    expect(invertido.status()).toBe(400)
    await expect(
      form.getByRole('alert').filter({ hasText: ERRO_FIM_ANTES_DO_INICIO }),
    ).toBeVisible()
    await ver(page, info, 'bloqueio com fim antes do inicio: recusado')

    // 3. bloquear em cima de uma reserva que já existe
    const emCimaDeReserva = await tentarBloquear(page, bloqueios, idEspaco, {
      inicio: quando(dia, '13:00'),
      fim: quando(dia, '15:00'),
      motivo: 'Manutenção',
    })
    expect(emCimaDeReserva.status()).toBe(400)
    await expect(
      form.getByRole('alert').filter({ hasText: ERRO_CONFLITO }),
    ).toBeVisible()
    await ver(page, info, 'bloqueio em cima de reserva: recusado')

    // 4. o bloqueio de verdade: o dia seguinte inteiro, para manutenção
    const idBloqueio = await bloquear(page, bloqueios, idEspaco, {
      inicio: quando(diaDoBloqueio, '08:00'),
      fim: quando(diaDoBloqueio, '18:00'),
      motivo: 'Manutenção',
    })
    await expect(
      bloqueios.locator('div.rounded-md.border.p-2').filter({
        hasText: new RegExp(
          `${diaDoBloqueio.br}[,\\s]+08:00\\s+—\\s+${diaDoBloqueio.br}[,\\s]+18:00\\s+·\\s+(MANUTENCAO|Manutenção)`,
        ),
      }),
    ).toHaveCount(1)
    await ver(page, info, 'bloqueio de manutencao registrado')

    // 5. o horário bloqueado recusa reserva (o bloqueio entra na mesma agenda das reservas)
    await reservaRecusada(
      page,
      reservas,
      {
        inicio: quando(diaDoBloqueio, '10:00'),
        fim: quando(diaDoBloqueio, '11:00'),
        finalidade: `Reserva dentro do bloqueio ${RODADA}`,
      },
      ERRO_CONFLITO,
    )
    await ver(page, info, 'reserva em horario bloqueado: recusada')

    // 6. um segundo bloqueio por cima do primeiro também é recusado
    const sobreposto = await tentarBloquear(page, bloqueios, idEspaco, {
      inicio: quando(diaDoBloqueio, '12:00'),
      fim: quando(diaDoBloqueio, '13:00'),
      motivo: 'Feriado',
    })
    expect(sobreposto.status()).toBe(400)
    await expect(
      formBloqueio(bloqueios)
        .getByRole('alert')
        .filter({ hasText: ERRO_CONFLITO }),
    ).toBeVisible()

    // 7. logo depois do bloqueio (18h às 19h) o espaço está livre
    await reservar(page, reservas, {
      inicio: quando(diaDoBloqueio, '18:00'),
      fim: quando(diaDoBloqueio, '19:00'),
      finalidade: `Logo depois do bloqueio ${RODADA}`,
    })

    // 8. nada de recusa deixou rastro; o bloqueio e a reserva de antes deixaram
    expect(await abrirAuditoria(page, 'bloqueios_espaco')).toBe(antes + 1)
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idBloqueio,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: bloqueio registrado')
    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idReserva,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()

    // 9. a disponibilidade pública (a que o site lê) mostra o bloqueio e a reserva, e nada de quem reservou
    const ocupado = await disponibilidadePublica(page, idEspaco)
    expect(temIntervalo(ocupado, diaDoBloqueio, '08:00')).toBe(true)
    expect(temIntervalo(ocupado, dia, '14:00')).toBe(true)
    for (const intervalo of ocupado) {
      expect(Object.keys(intervalo).sort()).toEqual([
        'data_hora_fim',
        'data_hora_inicio',
      ])
    }
    info.annotations.push({
      type: 'disponibilidade publica',
      description: JSON.stringify(ocupado),
    })
    expect(vigia.problemas()).toEqual([])
  })

  test('editar e mover a reserva: finalidade curta, conflito e fim antes do início são recusados; ao mover, o horário antigo fica livre e o novo ocupado (a agenda acompanha)', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const nome = `Quadra de mudança ${RODADA}`
    const dia = diaEmBelem(5)
    const diaNovo = diaEmBelem(7)
    const finalidadeBase = `Reserva fixa ${RODADA}`
    const finalidade = `Reserva a mover ${RODADA}`
    await entrar(page, 'presidente')
    await abrirEspacos(page)
    const { id: idEspaco } = await cadastrarEspaco(page, { nome })
    const detalhe = await abrirEspaco(page, nome)
    const secao = secaoDe(detalhe, 'Reservas')
    await reservar(page, secao, {
      inicio: quando(dia, '14:00'),
      fim: quando(dia, '16:00'),
      finalidade: finalidadeBase,
    })
    const idMover = await reservar(page, secao, {
      inicio: quando(dia, '16:00'),
      fim: quando(dia, '18:00'),
      finalidade,
    })
    const cartao = cartaoDeReserva(secao, finalidade)
    await cartao.getByRole('button', { name: 'Editar', exact: true }).click()
    const edicao = cartao.locator('form')
    await expect(edicao).toBeVisible()
    const datas = edicao.locator('input[type="datetime-local"]')
    const campoFinalidade = edicao.getByPlaceholder('Finalidade')
    const salvar = edicao.getByRole('button', { name: 'Salvar', exact: true })

    // o formulário já vem com o que está cadastrado, na hora LOCAL de quem vê
    await expect(datas.nth(0)).toHaveValue(quando(dia, '16:00'))
    await expect(datas.nth(1)).toHaveValue(quando(dia, '18:00'))
    await expect(campoFinalidade).toHaveValue(finalidade)
    await ver(page, info, 'edicao da reserva aberta com os valores atuais')

    // 1. finalidade curta demais
    await campoFinalidade.fill('ab')
    await salvar.click()
    await expect(
      edicao.getByRole('alert').filter({ hasText: 'Descreva a finalidade.' }),
    ).toHaveCount(1)
    await campoFinalidade.fill(finalidade)

    // 2. mover para cima da outra reserva: conflito
    await datas.nth(0).fill(quando(dia, '15:00'))
    await datas.nth(1).fill(quando(dia, '17:00'))
    const [conflito] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' &&
          new URL(r.url()).pathname === `/api/reservas-espaco/${idMover}`,
      ),
      salvar.click(),
    ])
    expect(conflito.status()).toBe(400)
    await expect(
      edicao.getByRole('alert').filter({ hasText: ERRO_CONFLITO }),
    ).toBeVisible()
    await expect
      .soft(
        cartao.getByText(ERRO_CONFLITO),
        'a mensagem de conflito aparece duas vezes no cartão (o formulário a mostra e o bloco da própria edição repete)',
      )
      .toHaveCount(1)
    await ver(page, info, 'mover reserva para cima de outra: conflito recusado')

    // 3. fim antes do início
    await datas.nth(0).fill(quando(dia, '17:00'))
    await datas.nth(1).fill(quando(dia, '16:00'))
    await salvar.click()
    await expect(
      edicao.getByRole('alert').filter({ hasText: ERRO_FIM_ANTES_DO_INICIO }),
    ).toBeVisible()

    // 4. mover para um horário livre, 2 dias depois (09h às 11h)
    await datas.nth(0).fill(quando(diaNovo, '09:00'))
    await datas.nth(1).fill(quando(diaNovo, '11:00'))
    const [movida] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' &&
          new URL(r.url()).pathname === `/api/reservas-espaco/${idMover}`,
      ),
      salvar.click(),
    ])
    expect(movida.status()).toBe(200)
    await expect(edicao).toHaveCount(0) // o formulário se fecha sozinho
    await expect(cartao).toContainText(mostrado(diaNovo, '09:00'))
    await expect(cartao).not.toContainText(mostrado(dia, '16:00'))
    await expect(cartao.getByText('CONFIRMADA', { exact: true })).toBeVisible()
    await ver(page, info, 'reserva movida para o novo horario')

    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'UPDATE', {
        registro: idMover,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: reserva editada')

    // 5. a agenda acompanhou: a disponibilidade pública tem o horário novo e NÃO tem o antigo
    const ocupado = await disponibilidadePublica(page, idEspaco)
    expect(temIntervalo(ocupado, diaNovo, '09:00')).toBe(true)
    expect(temIntervalo(ocupado, dia, '14:00')).toBe(true)
    expect(
      temIntervalo(ocupado, dia, '16:00'),
      'o horário antigo (16h) continua ocupado na agenda: o compromisso não acompanhou a reserva',
    ).toBe(false)
    info.annotations.push({
      type: 'disponibilidade depois de mover',
      description: JSON.stringify(ocupado),
    })

    // 6. na tela: o horário antigo aceita reserva nova e o novo recusa
    await abrirEspacos(page)
    const detalhe2 = await abrirEspaco(page, nome)
    const secao2 = secaoDe(detalhe2, 'Reservas')
    await reservar(page, secao2, {
      inicio: quando(dia, '16:00'),
      fim: quando(dia, '18:00'),
      finalidade: `Ocupa o horário antigo ${RODADA}`,
    })
    await reservaRecusada(
      page,
      secao2,
      {
        inicio: quando(diaNovo, '09:00'),
        fim: quando(diaNovo, '11:00'),
        finalidade: `Tenta o horário novo ${RODADA}`,
      },
      ERRO_CONFLITO,
    )
    await ver(page, info, 'horario antigo livre e horario novo ocupado')
    expect(vigia.problemas()).toEqual([])
  })

  test('espaço com aprovação: a solicitação segura o horário, aprovar confirma sem cobrar quem é isento, recusar libera o horário e "não compareceu" antes da hora é recusado', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const nome = `Sala com aprovação ${RODADA}`
    const dia = diaEmBelem(8)
    const diaDois = diaEmBelem(9)
    await entrar(page, 'presidente')
    await abrirEspacos(page)
    await cadastrarEspaco(page, {
      nome,
      tipo: 'Sala',
      valor: '80',
      aprovacao: true,
      isento: true,
    })
    const detalhe = await abrirEspaco(page, nome)
    await expect(detalhe).toContainText('Exige aprovação manual')
    const secao = secaoDe(detalhe, 'Reservas')

    // a solicitação nasce SOLICITADA, com Aprovar e Recusar (e sem Cancelar nem Checklist)
    const finalidadeUm = `Solicitação um ${RODADA}`
    const idUm = await reservar(page, secao, {
      inicio: quando(dia, '14:00'),
      fim: quando(dia, '16:00'),
      finalidade: finalidadeUm,
    })
    const cartaoUm = cartaoDeReserva(secao, finalidadeUm)
    await expect(
      cartaoUm.getByText('SOLICITADA', { exact: true }),
    ).toBeVisible()
    await expect(
      cartaoUm.getByRole('button', { name: 'Aprovar', exact: true }),
    ).toBeVisible()
    await expect(
      cartaoUm.getByRole('button', { name: 'Recusar', exact: true }),
    ).toBeVisible()
    await expect(
      cartaoUm.getByRole('button', { name: 'Checklist', exact: true }),
    ).toHaveCount(0)
    await ver(page, info, 'solicitacao de reserva: aguardando aprovacao')

    // a solicitação já segura o horário: outra pessoa pedindo o mesmo horário é recusada
    await reservaRecusada(
      page,
      secao,
      {
        solicitante: OUTRO_SOLICITANTE,
        inicio: quando(dia, '14:30'),
        fim: quando(dia, '15:30'),
        finalidade: `Pedido no mesmo horário ${RODADA}`,
      },
      ERRO_CONFLITO,
    )

    // aprovar: vira CONFIRMADA; associado em dia num espaço isento não paga
    await cartaoUm.getByRole('button', { name: 'Aprovar', exact: true }).click()
    await expect(
      cartaoUm.getByText('CONFIRMADA', { exact: true }),
    ).toBeVisible()
    await expect(cartaoUm).not.toContainText('Cobrança gerada')
    await ver(page, info, 'solicitacao aprovada: confirmada, sem cobranca')
    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', {
        registro: idUm,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: aprovacao')

    // "não compareceu" ANTES da hora da reserva: o servidor recusa e a reserva continua CONFIRMADA
    await abrirEspacos(page)
    const detalhe2 = await abrirEspaco(page, nome)
    const secao2 = secaoDe(detalhe2, 'Reservas')
    const cartaoUm2 = cartaoDeReserva(secao2, finalidadeUm)
    const [semFalta] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname ===
            `/api/reservas-espaco/${idUm}/nao-compareceu`,
      ),
      cartaoUm2
        .getByRole('button', { name: 'Não compareceu', exact: true })
        .click(),
    ])
    expect(semFalta.status()).toBe(400)
    expect(((await semFalta.json()) as { detail: string }).detail).toMatch(
      /antes do horário da reserva/,
    )
    await expect(
      cartaoUm2.getByText('CONFIRMADA', { exact: true }),
    ).toBeVisible()
    await expect
      .soft(
        secao2.getByText(/antes do horário da reserva/),
        'a recusa de "Não compareceu" antes da hora não aparece na tela: o botão não mostra o erro da própria ação',
      )
      .toBeVisible({ timeout: 5_000 })
    await ver(page, info, 'nao compareceu antes da hora: recusado')

    // recusar: vira RECUSADA, libera o horário e deixa rastro
    const finalidadeDois = `Solicitação dois ${RODADA}`
    const idDois = await reservar(page, secao2, {
      inicio: quando(diaDois, '14:00'),
      fim: quando(diaDois, '16:00'),
      finalidade: finalidadeDois,
    })
    const cartaoDois = cartaoDeReserva(secao2, finalidadeDois)
    await cartaoDois
      .getByRole('button', { name: 'Recusar', exact: true })
      .click()
    await expect(
      cartaoDois.getByText('RECUSADA', { exact: true }),
    ).toBeVisible()
    for (const botao of ['Aprovar', 'Recusar', 'Cancelar', 'Editar']) {
      await expect(
        cartaoDois.getByRole('button', { name: botao, exact: true }),
      ).toHaveCount(0)
    }
    await ver(page, info, 'solicitacao recusada')
    await reservar(page, secao2, {
      solicitante: OUTRO_SOLICITANTE,
      inicio: quando(diaDois, '14:00'),
      fim: quando(diaDois, '16:00'),
      finalidade: `Depois da recusa ${RODADA}`,
    })
    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'RECUSA', {
        registro: idDois,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: recusa')
    expect(vigia.problemas()).toEqual([])
  })

  test('checklist de retirada e devolução, filtro por situação e exportação da lista de reservas (cada um deixa rastro)', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const nome = `Salão do checklist ${RODADA}`
    const dia = diaEmBelem(12)
    const finalidade = `Evento com checklist ${RODADA}`
    const finalidadeCancelada = `Reserva a cancelar ${RODADA}`
    await entrar(page, 'presidente')
    await abrirEspacos(page)
    await cadastrarEspaco(page, { nome })
    const detalhe = await abrirEspaco(page, nome)
    const secao = secaoDe(detalhe, 'Reservas')
    await reservar(page, secao, {
      inicio: quando(dia, '09:00'),
      fim: quando(dia, '11:00'),
      finalidade,
    })
    await reservar(page, secao, {
      inicio: quando(dia, '13:00'),
      fim: quando(dia, '15:00'),
      finalidade: finalidadeCancelada,
    })
    const cartao = cartaoDeReserva(secao, finalidade)
    const cartaoCancelada = cartaoDeReserva(secao, finalidadeCancelada)
    await cartaoCancelada
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click()
    await expect(
      cartaoCancelada.getByText('CANCELADA', { exact: true }),
    ).toBeVisible()

    // checklist: retirada (condição obrigatória) e depois devolução (avaria exige descrição)
    await cartao.getByRole('button', { name: 'Checklist', exact: true }).click()
    const retirada = cartao.getByPlaceholder('Condição na retirada')
    await expect(retirada).toBeVisible()
    await cartao
      .getByRole('button', { name: 'Registrar retirada', exact: true })
      .click()
    await expect(
      cartao
        .getByRole('alert')
        .filter({ hasText: 'Descreva a condição na retirada.' }),
    ).toBeVisible()
    await ver(page, info, 'retirada sem condicao: recusada')
    await retirada.fill('Chaves entregues e salão limpo (condição de teste)')
    await cartao
      .getByRole('button', { name: 'Registrar retirada', exact: true })
      .click()
    const devolucao = cartao.getByPlaceholder('Condição na devolução')
    await expect(devolucao).toBeVisible()
    await expect(retirada).toHaveCount(0)
    await ver(page, info, 'retirada registrada: aparece a devolucao')

    await devolucao.fill('Salão devolvido com uma cadeira quebrada')
    await cartao.getByLabel('Houve avaria').check()
    const [semDescricao] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /\/api\/reservas-espaco\/\d+\/devolucao$/.test(
            new URL(r.url()).pathname,
          ),
      ),
      cartao
        .getByRole('button', { name: 'Registrar devolução', exact: true })
        .click(),
    ])
    expect(semDescricao.status()).toBe(400)
    await expect(
      cartao.getByRole('alert').filter({ hasText: 'Descreva a avaria.' }),
    ).toBeVisible()
    await ver(page, info, 'devolucao com avaria sem descricao: recusada')
    await cartao
      .getByPlaceholder('Descrição da avaria')
      .fill('Uma cadeira com o pé quebrado')
    await cartao
      .getByRole('button', { name: 'Registrar devolução', exact: true })
      .click()
    await expect(cartao).toContainText(/Devolvido em/)
    await expect(cartao).toContainText('avaria: Uma cadeira com o pé quebrado')
    await expect(cartao.getByText('CONCLUIDA', { exact: true })).toBeVisible()
    for (const botao of ['Cancelar', 'Editar', 'Checklist']) {
      await expect(
        cartao.getByRole('button', { name: botao, exact: true }),
      ).toHaveCount(0)
    }
    await ver(page, info, 'devolucao registrada: reserva concluida com avaria')

    await abrirAuditoria(page, 'checklists_devolucao_espaco')
    await expect(
      linhaDaAuditoria(page, 'RETIRADA', { quem: PRESIDENTE }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'DEVOLUCAO', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: retirada e devolucao')

    // filtro por situação: só as canceladas
    await abrirEspacos(page)
    const detalhe2 = await abrirEspaco(page, nome)
    const secao2 = secaoDe(detalhe2, 'Reservas')
    await secao2
      .locator('label:text-is("Status") + select')
      .selectOption('CANCELADA')
    await expect(cartaoDeReserva(secao2, finalidadeCancelada)).toBeVisible()
    await expect(cartaoDeReserva(secao2, finalidade)).toHaveCount(0)
    await ver(page, info, 'filtro de reservas: so as canceladas')
    await secao2.locator('label:text-is("Status") + select').selectOption('')
    await expect(cartaoDeReserva(secao2, finalidade)).toBeVisible()

    // exportação (permissão própria, sempre auditada)
    await secao2.getByRole('button', { name: 'Exportar', exact: true }).click()
    const tabela = secao2.locator('table')
    await expect(tabela).toBeVisible()
    await expect(tabela).toContainText(finalidade)
    await expect(tabela).toContainText('CONCLUIDA')
    await expect(tabela).toContainText('CANCELADA')
    await ver(page, info, 'exportacao das reservas do espaco')
    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'EXPORTAR', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: exportacao')
    expect(vigia.problemas()).toEqual([])
  })

  test('reserva recorrente: cada semana é tratada sozinha (a semana bloqueada falha e as outras entram), e menos de 2 semanas é recusado', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const enviados = contarEnvios(page, /\/recorrente$/)
    const nome = `Quadra da série ${RODADA}`
    const semanaUm = diaEmBelem(20)
    const semanaDois = diaEmBelem(27)
    const semanaTres = diaEmBelem(34)
    const finalidade = `Treino semanal ${RODADA}`
    await entrar(page, 'presidente')
    await abrirEspacos(page)
    const { id: idEspaco } = await cadastrarEspaco(page, { nome })
    const detalhe = await abrirEspaco(page, nome)
    const reservas = secaoDe(detalhe, 'Reservas')
    const bloqueios = secaoDe(detalhe, 'Bloqueios')

    // a segunda semana está bloqueada
    await bloquear(page, bloqueios, idEspaco, {
      inicio: quando(semanaDois, '09:00'),
      fim: quando(semanaDois, '10:00'),
      motivo: 'Feriado',
    })

    await reservas
      .getByRole('button', { name: 'Reserva recorrente', exact: true })
      .click()
    const form = reservas.locator('form').filter({
      has: page.getByRole('button', { name: 'Criar série', exact: true }),
    })
    await expect(form).toBeVisible()

    // vazio: o resumo traz tudo, inclusive a finalidade (este formulário não mostra erro no campo)
    await form.getByRole('button', { name: 'Criar série', exact: true }).click()
    const resumo = form
      .getByRole('alert')
      .filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toContainText('Selecione o solicitante.')
    await expect(resumo).toContainText('Descreva a finalidade.')
    expect(enviados()).toBe(0)

    // uma semana só não é série
    const seletor = form.locator('select')
    await expect(
      seletor.locator('option', { hasText: SOLICITANTE }),
    ).toBeAttached()
    await escolherPorTexto(seletor, SOLICITANTE)
    const datas = form.locator('input[type="datetime-local"]')
    await datas.nth(0).fill(quando(semanaUm, '09:00'))
    await datas.nth(1).fill(quando(semanaUm, '10:00'))
    await form.getByPlaceholder('Finalidade').fill(finalidade)
    await form.getByPlaceholder('Semanas').fill('1')
    await form.getByRole('button', { name: 'Criar série', exact: true }).click()
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Informe pelo menos 2 semanas.' }),
    ).toBeVisible()
    expect(enviados()).toBe(0)
    await ver(page, info, 'serie com uma semana: recusada')

    // a série de 3 semanas: a 2ª bate no bloqueio
    await form.getByPlaceholder('Semanas').fill('3')
    const [serie] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname === '/api/reservas-espaco/recorrente',
      ),
      form.getByRole('button', { name: 'Criar série', exact: true }).click(),
    ])
    expect(serie.status()).toBe(200)
    await expect(form).toHaveCount(0)
    await expect(
      reservas.getByText(
        new RegExp(`^Semana 1 \\(${semanaUm.br}[,\\s]+09:00\\): reservada`),
      ),
    ).toBeVisible()
    await expect(
      reservas.getByText(
        new RegExp(
          `^Semana 2 \\(${semanaDois.br}[,\\s]+09:00\\): Conflito de agenda`,
        ),
      ),
    ).toBeVisible()
    await expect(
      reservas.getByText(
        new RegExp(`^Semana 3 \\(${semanaTres.br}[,\\s]+09:00\\): reservada`),
      ),
    ).toBeVisible()
    await expect(cartaoDeReserva(reservas, finalidade)).toHaveCount(2)
    await ver(
      page,
      info,
      'serie semanal: duas semanas reservadas e uma barrada',
    )

    await abrirAuditoria(page, 'reservas_espaco')
    await expect(
      linhaDaAuditoria(page, 'CREATE_RECORRENTE', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: serie recorrente')
    expect(vigia.problemas()).toEqual([])
  })

  test('mapa de calor: a reserva confirmada aparece no dia da semana e na HORA em que acontece (hora local)', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const nome = `Quadra do mapa ${RODADA}`
    const dia = diaEmBelem(5)
    await entrar(page, 'presidente')
    await abrirEspacos(page)
    await cadastrarEspaco(page, { nome })
    const detalhe = await abrirEspaco(page, nome)
    await reservar(page, secaoDe(detalhe, 'Reservas'), {
      inicio: quando(dia, '14:00'),
      fim: quando(dia, '16:00'),
      finalidade: `Reserva do mapa ${RODADA}`,
    })

    const mapa = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Mapa de calor de ocupação' }),
    })
    await mapa.locator('label:text-is("Até") + input').fill(diaEmBelem(30).iso)
    await mapa
      .locator('label:text-is("Espaço") + select')
      .selectOption({ label: nome })
    const celulas = mapa.getByRole('gridcell')
    const ocupadas = async () =>
      (
        await celulas.evaluateAll((els) =>
          els.map((e) => e.getAttribute('aria-label') ?? ''),
        )
      ).filter((rotulo) => !/: 0 reserva/.test(rotulo))
    await expect.poll(ocupadas).not.toEqual([])
    const rotulos = await ocupadas()
    info.annotations.push({
      type: 'celulas ocupadas',
      description: rotulos.join(' | '),
    })
    const total = rotulos.reduce(
      (soma, rotulo) => soma + Number(/: (\d+) reserva/.exec(rotulo)?.[1] ?? 0),
      0,
    )
    expect(total, 'uma única reserva confirmada neste espaço').toBe(1)
    await expect(mapa.getByText('Mais (1)')).toBeVisible()
    expect
      .soft(
        rotulos,
        `a reserva é ${dia.semana} às 14h de Belém, mas o mapa a coloca em outra célula (o servidor agrupa pela hora UTC guardada: 17h): app/services/ocupacao_espacos.py usa .weekday()/.hour sem converter para a hora local`,
      )
      .toContain(`${dia.semana} 14h: 1 reserva(s)`)
    await ver(page, info, 'mapa de calor de ocupacao do espaco')
    expect(vigia.problemas()).toEqual([])
  })

  test('quem não tem a permissão de projetos (Secretário) é barrado nas duas telas e na API; quem a recebe pelo cargo (Presidente do cargo) entra', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    await entrar(page, 'secretario')
    // as permissões do cargo chegaram quando o Início oferece a Governança (os módulos só aparecem no Início e dentro de cada módulo)
    await expect(
      page.getByRole('link', { name: 'Governança' }).first(),
    ).toBeVisible()
    for (const modulo of ['Reserva de Espaço', 'Eventos', 'Projetos']) {
      await expect(
        page.getByRole('link', { name: modulo, exact: true }),
      ).toHaveCount(0)
    }
    await ver(
      page,
      info,
      'Secretario: o Inicio nao oferece reserva nem eventos',
    )

    // digitar o endereço também não abre
    for (const [rota, titulo] of [
      [ESPACOS, 'Secretario barrado em Reserva de Espaco'],
      ['/eventos', 'Secretario barrado em Eventos'],
    ] as const) {
      await page.goto(rota)
      await expect(
        page.getByRole('heading', { name: 'Acesso negado' }),
      ).toBeVisible()
      await expect(
        page.getByText(/permissão necessária: projetos/),
      ).toBeVisible()
      await ver(page, info, titulo)
    }

    // e a API também recusa (não é só o menu escondido)
    for (const rota of [
      '/api/espacos/',
      '/api/reservas-espaco/',
      '/api/eventos/',
    ]) {
      const resposta = await chamarApi(page, 'GET', rota)
      expect(resposta.status, `GET ${rota} como Secretário`).toBe(403)
    }
    const tentativa = await chamarApi(page, 'POST', '/api/espacos/', {
      nome: `Tentativa do Secretário ${RODADA}`,
      tipo: 'SALA',
      exige_aprovacao: false,
      isento_para_associado_adimplente: true,
      prazo_cancelamento_horas: 24,
    })
    expect(tentativa.status, 'POST /api/espacos/ como Secretário').toBe(403)
    await sair(page)

    // o Presidente do CARGO (sem o nível Presidente) recebe `projetos` pelo mandato
    await entrar(page, 'cargo_presidente')
    await expect(
      page
        .getByRole('link', { name: 'Reserva de Espaço', exact: true })
        .first(),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Eventos', exact: true }).first(),
    ).toBeVisible()
    await page
      .getByRole('link', { name: 'Reserva de Espaço', exact: true })
      .first()
      .click()
    await expect(
      page.getByRole('heading', { name: 'Reserva de Espaço', level: 1 }),
    ).toBeVisible()
    await ver(page, info, 'Presidente do cargo abre Reserva de Espaco')
    await page.goto('/eventos')
    await expect(
      page.getByRole('heading', { name: 'Eventos', level: 1 }),
    ).toBeVisible()
    await ver(page, info, 'Presidente do cargo abre Eventos')
    const leitura = await chamarApi(page, 'GET', '/api/espacos/')
    expect(leitura.status).toBe(200)
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// A tela de Eventos
// =====================================================================================================================================
type DadosEvento = {
  titulo?: string
  categoria?: string
  inicio?: string
  fim?: string
  vagas?: string
  projeto?: string
  endereco?: string
}

const formularioDeEvento = (page: Page) =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: 'Criar evento' }),
  })

async function abrirFormularioDeEvento(page: Page): Promise<Locator> {
  const form = formularioDeEvento(page)
  if ((await form.count()) === 0) {
    await page.getByRole('button', { name: 'Novo evento', exact: true }).click()
  }
  await expect(form).toBeVisible()
  return form
}

/** Preenche TODOS os campos que o roteiro usa (o que não vem em `d` é limpo: o formulário recusado guarda o que ficou). */
async function preencherEvento(form: Locator, d: DadosEvento): Promise<void> {
  await form.getByLabel('Título do evento').fill(d.titulo ?? '')
  await form
    .getByLabel('Categoria do evento')
    .selectOption(d.categoria ? { label: d.categoria } : { value: '' })
  await form
    .locator('label', { hasText: 'Início' })
    .locator('input')
    .fill(d.inicio ?? '')
  await form
    .locator('label', { hasText: 'Fim (opcional)' })
    .locator('input')
    .fill(d.fim ?? '')
  await form.getByLabel('Vagas').fill(d.vagas ?? '')
  await form.getByLabel('Endereço avulso').fill(d.endereco ?? '')
  const projeto = form
    .locator('label', { hasText: 'Projeto (opcional)' })
    .locator('select')
  if (d.projeto) {
    await expect(
      projeto.locator('option', { hasText: d.projeto }),
    ).toBeAttached()
    await escolherPorTexto(projeto, d.projeto)
  } else {
    await projeto.selectOption('')
  }
}

function enviarEvento(page: Page, form: Locator): Promise<Resposta> {
  return Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/eventos/',
    ),
    form.getByRole('button', { name: 'Criar evento' }).click(),
  ]).then(([resposta]) => resposta)
}

/** Cria o evento pelo formulário (Interno, gratuito) e devolve o número dele. */
async function criarEventoPelaTela(
  page: Page,
  d: DadosEvento & { titulo: string; categoria?: string; inicio: string },
): Promise<number> {
  await page.goto('/eventos')
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  const form = await abrirFormularioDeEvento(page)
  await preencherEvento(form, { categoria: 'Palestra', ...d })
  const resposta = await enviarEvento(page, form)
  const texto = await resposta.text()
  expect(
    resposta.ok(),
    `criar o evento "${d.titulo}" foi recusado (HTTP ${resposta.status()}): ${texto}`,
  ).toBe(true)
  const { id_evento } = JSON.parse(texto) as { id_evento: number }
  await expect(form).toHaveCount(0) // o formulário se fecha sozinho
  await expect(
    page.locator('div[role="button"]').filter({ hasText: d.titulo }),
  ).toBeVisible()
  return id_evento
}

const detalheDoEvento = (page: Page, titulo: string) =>
  page
    .locator('div.rounded-xl')
    .filter({
      has: page.getByRole('heading', { name: titulo, level: 2, exact: true }),
    })
    .last()

/** Abre o evento pelo endereço `/eventos?evento=N` (o mesmo que os outros módulos usam para apontar para ele). */
async function abrirEvento(
  page: Page,
  id: number,
  titulo: string,
): Promise<Locator> {
  await page.goto(`/eventos?evento=${id}`)
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  const detalhe = detalheDoEvento(page, titulo)
  await expect(detalhe).toBeVisible()
  return detalhe
}

// =====================================================================================================================================
// B. EVENTO (primeira metade): criar ligado a um projeto, programação em sessões, vagas e lista de espera
// =====================================================================================================================================
test.describe('B. Evento', () => {
  test('um projeto e um evento ligado a ele: campos vazios, fim antes do início, vagas fracionadas e negativas são recusados; o evento mostra o projeto de origem', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const enviados = contarEnvios(page, /^\/api\/eventos\/$/)
    const projeto = `Projeto do robô ${RODADA} (eventos)`
    const titulo = `Evento do robô ${RODADA} (projeto)`
    const dia = diaEmBelem(30)
    await entrar(page, 'presidente')
    // a Auditoria dos eventos antes de qualquer coisa deste roteiro
    const antes = await abrirAuditoria(page, 'eventos')

    // o projeto, criado pela tela de Projetos
    await page.goto('/projetos')
    await expect(
      page.getByRole('heading', { name: 'Projetos', level: 1 }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Novo projeto', exact: true })
      .click()
    const formProjeto = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Criar projeto' }),
    })
    await expect(formProjeto).toBeVisible()
    await formProjeto.getByLabel('Nome do projeto').fill(projeto)
    await formProjeto.getByLabel('Foco do projeto').fill('Social')
    await formProjeto.getByLabel('Data de início').fill(diaEmBelem(0).iso)
    await formProjeto
      .getByLabel('Data de fim prevista')
      .fill(diaEmBelem(60).iso)
    const [projetoCriado] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname === '/projetos/',
      ),
      formProjeto.getByRole('button', { name: 'Criar projeto' }).click(),
    ])
    expect(projetoCriado.status()).toBe(200)
    const { id_projeto } = (await projetoCriado.json()) as {
      id_projeto: number
    }
    await expect(
      page.locator('div[role="button"]').filter({ hasText: projeto }),
    ).toBeVisible()
    await ver(page, info, 'projeto de teste criado')

    // o formulário de evento: rótulos
    await page.goto('/eventos')
    await expect(
      page.getByRole('heading', { name: 'Eventos', level: 1 }),
    ).toBeVisible()
    const form = await abrirFormularioDeEvento(page)
    const semRotulo: string[] = []
    try {
      await inventariar(page, info, 'eventos-novo-evento')
    } catch (erro) {
      semRotulo.push((erro as Error).message)
    }
    const alertas = form.getByRole('alert')
    const criar = form.getByRole('button', { name: 'Criar evento' })

    // 1. tudo vazio: as três faltas aparecem no campo, e nada vai ao servidor
    await criar.click()
    await expect(alertas.filter({ hasText: 'Informe o título.' })).toHaveCount(
      1,
    )
    await expect(
      alertas.filter({ hasText: 'Selecione a categoria.' }),
    ).toHaveCount(1)
    await expect(
      alertas.filter({ hasText: 'Informe o início do evento.' }),
    ).toHaveCount(1)
    expect(enviados(), 'evento vazio não deve ir ao servidor').toBe(0)
    await ver(page, info, 'evento vazio: recusado')

    // 2. título de duas letras
    await preencherEvento(form, {
      titulo: 'ab',
      categoria: 'Palestra',
      inicio: quando(dia, '09:00'),
    })
    await criar.click()
    await expect(alertas.filter({ hasText: 'Informe o título.' })).toHaveCount(
      1,
    )
    expect(enviados()).toBe(0)

    // 3. fim antes do início: o servidor recusa e a frase aparece no alto do formulário
    await preencherEvento(form, {
      titulo,
      categoria: 'Palestra',
      inicio: quando(dia, '10:00'),
      fim: quando(dia, '09:00'),
    })
    const fimAntes = await enviarEvento(page, form)
    expect(fimAntes.status()).toBe(422)
    await expect(
      alertas.filter({
        hasText: 'O fim do evento precisa ser depois do início.',
      }),
    ).toBeVisible()
    await ver(page, info, 'evento com fim antes do inicio: recusado')

    // 4. vagas fracionadas: recusadas na tela
    await preencherEvento(form, {
      titulo,
      categoria: 'Palestra',
      inicio: quando(dia, '09:00'),
      vagas: '1.5',
    })
    const enviadosAntes = enviados()
    await criar.click()
    await expect(
      alertas.filter({ hasText: 'Corrija para continuar:' }),
    ).toBeVisible()
    expect(enviados()).toBe(enviadosAntes)
    await ver(page, info, 'evento com vagas fracionadas: recusado')

    // 5. achado provável: vagas negativas (o campo diz min=1, a edição do evento recusa, mas a criação aceita)
    await preencherEvento(form, {
      titulo: `Evento de vagas negativas ${RODADA}`,
      categoria: 'Palestra',
      inicio: quando(dia, '09:00'),
      vagas: '-3',
    })
    const negativas = await enviarEvento(page, form)
    expect
      .soft(
        negativas.ok(),
        'o sistema ACEITOU um evento com -3 vagas (o formulário diz mínimo 1 e a edição do evento recusa; a criação não confere)',
      )
      .toBe(false)
    await ver(page, info, 'evento com vagas negativas: aceito ou recusado')

    // 6. o evento de verdade, ligado ao projeto
    const formDeNovo = await abrirFormularioDeEvento(page)
    await preencherEvento(formDeNovo, {
      titulo,
      categoria: 'Palestra',
      inicio: quando(dia, '09:00'),
      fim: quando(dia, '17:00'),
      vagas: '2',
      endereco: 'Salão de teste, Parauapebas',
      projeto,
    })
    const resposta = await enviarEvento(page, formDeNovo)
    const texto = await resposta.text()
    expect(
      resposta.ok(),
      `criar o evento foi recusado (HTTP ${resposta.status()}): ${texto}`,
    ).toBe(true)
    const { id_evento } = JSON.parse(texto) as { id_evento: number }
    await expect(formDeNovo).toHaveCount(0)
    const cartao = page
      .locator('div[role="button"]')
      .filter({ hasText: titulo })
    await expect(cartao).toContainText(`nº ${id_evento}`)
    await expect(cartao).toContainText('Interna')
    await ver(page, info, 'evento criado na lista')

    // 7. abrir o evento: número, datas, vagas e o projeto de origem
    const detalhe = await abrirEvento(page, id_evento, titulo)
    await expect(detalhe).toContainText(`Nº do evento: ${id_evento}`)
    await expect(detalhe).toContainText(mostrado(dia, '09:00'))
    await expect(detalhe).toContainText(
      /0\/2 vaga\(s\) ocupada\(s\) \(2 livre\(s\)\)/,
    )
    await expect(detalhe).toContainText('Interna')
    await expect(detalhe).toContainText('Gratuito')
    await expect(detalhe).toContainText(/Faz parte do projeto/)
    await expect(detalhe).toContainText(projeto)
    await expect(detalhe).toContainText(`(nº ${id_projeto})`)
    await ver(page, info, 'evento aberto: vagas e projeto de origem')

    // 8. Auditoria: a criação (e nenhuma das recusas)
    await abrirAuditoria(page, 'eventos')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: id_evento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    const depois = await abrirAuditoria(page, 'eventos')
    expect(
      depois,
      'só o evento de verdade (e o de vagas negativas, se o sistema o aceitou) deixaram rastro',
    ).toBeLessThanOrEqual(antes + 2)
    expect(depois).toBeGreaterThanOrEqual(antes + 1)
    await ver(page, info, 'auditoria: evento criado')

    // 9. trocar o projeto do evento (desligar e ligar de novo): o aviso, o texto de "Contexto do evento" e a Auditoria
    const detalheProjeto = await abrirEvento(page, id_evento, titulo)
    const trocar = detalheProjeto
      .locator('label', { hasText: 'Trocar o projeto deste evento' })
      .locator('select')
    const salvarProjeto = detalheProjeto.getByRole('button', {
      name: 'Salvar projeto',
      exact: true,
    })
    await expect(salvarProjeto, 'nada mudou ainda').toBeDisabled()
    await trocar.selectOption({ label: 'Sem projeto' })
    await salvarProjeto.click()
    await expect(detalheProjeto.locator(AVISO)).toContainText(
      'Projeto do evento atualizado.',
    )
    await expect(detalheProjeto).toContainText(
      'Este evento não está ligado a nenhum projeto.',
    )
    await ver(page, info, 'evento desligado do projeto')
    await trocar.selectOption({ label: `${projeto} (nº ${id_projeto})` })
    await salvarProjeto.click()
    await expect(detalheProjeto).toContainText(/Faz parte do projeto/)
    await expect(detalheProjeto).toContainText(`(nº ${id_projeto})`)
    await ver(page, info, 'evento ligado de novo ao projeto')
    await abrirAuditoria(page, 'eventos')
    await expect(
      linhaDaAuditoria(page, 'UPDATE', {
        registro: id_evento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: projeto do evento trocado')
    expect
      .soft(semRotulo, 'campo(s) sem rótulo acessível no formulário de evento')
      .toEqual([])
    expect(vigia.problemas()).toEqual([])
  })

  test('programação em sessões: título vazio, início faltando, fim antes do início são recusados; as sessões entram na ordem do horário e deixam rastro', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const titulo = `Evento de programação ${RODADA}`
    const dia = diaEmBelem(31)
    await entrar(page, 'presidente')
    const idEvento = await criarEventoPelaTela(page, {
      titulo,
      inicio: quando(dia, '08:00'),
      fim: quando(dia, '18:00'),
    })
    const detalhe = await abrirEvento(page, idEvento, titulo)
    const secao = secaoDe(detalhe, 'Programação (sessões/atividades)')
    await expect(secao).toContainText(
      'Nenhuma sessão cadastrada — evento simples, sem programação.',
    )
    const form = secao.locator('form').filter({
      has: page.getByPlaceholder('Título da sessão'),
    })
    const enviados = contarEnvios(page, /\/sessoes$/)

    const semRotulo: string[] = []
    try {
      await inventariar(page, info, 'eventos-detalhe')
    } catch (erro) {
      semRotulo.push((erro as Error).message)
    }

    const adicionar = (dados: {
      titulo: string
      inicio: string
      fim?: string
    }): Promise<Resposta> =>
      Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            new URL(r.url()).pathname === `/api/eventos/${idEvento}/sessoes`,
        ),
        (async () => {
          await form.getByPlaceholder('Título da sessão').fill(dados.titulo)
          const datas = form.locator('input[type="datetime-local"]')
          await datas.nth(0).fill(dados.inicio)
          await datas.nth(1).fill(dados.fim ?? '')
          await form
            .getByRole('button', { name: 'Adicionar', exact: true })
            .click()
        })(),
      ]).then(([resposta]) => resposta)

    // 1. vazio: o título aparece no campo e o início no resumo; nada vai ao servidor
    await form.getByRole('button', { name: 'Adicionar', exact: true }).click()
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'Informe o título da sessão.' }),
    ).toHaveCount(1)
    await expect(
      form.getByRole('alert').filter({ hasText: 'Corrija para continuar:' }),
    ).toContainText('Informe o início da sessão.')
    expect(enviados(), 'sessão vazia não deve ir ao servidor').toBe(0)
    await ver(page, info, 'sessao vazia: recusada')

    // 2. fim antes do início
    const invertida = await adicionar({
      titulo: `Sessão invertida ${RODADA}`,
      inicio: quando(dia, '10:00'),
      fim: quando(dia, '09:00'),
    })
    expect(invertida.status()).toBe(422)
    await expect(
      form.getByRole('alert').filter({
        hasText: 'O fim da sessão precisa ser depois do início.',
      }),
    ).toBeVisible()
    await ver(page, info, 'sessao com fim antes do inicio: recusada')

    // 3. as sessões de verdade, fora de ordem de cadastro (a lista sai pelo horário)
    const sessoes = [
      { titulo: `Encerramento ${RODADA}`, inicio: '16:00', fim: '17:00' },
      { titulo: `Abertura ${RODADA}`, inicio: '09:00', fim: '10:30' },
      { titulo: `Palestra central ${RODADA}`, inicio: '10:45', fim: '12:00' },
    ]
    const ids: number[] = []
    for (const s of sessoes) {
      const resposta = await adicionar({
        titulo: s.titulo,
        inicio: quando(dia, s.inicio),
        fim: quando(dia, s.fim),
      })
      const texto = await resposta.text()
      expect(
        resposta.ok(),
        `cadastrar a sessão "${s.titulo}" foi recusado (HTTP ${resposta.status()}): ${texto}`,
      ).toBe(true)
      ids.push((JSON.parse(texto) as { id_sessao: number }).id_sessao)
      await expect(
        secao.locator('div.rounded-md.border.p-2').filter({
          hasText: s.titulo,
        }),
      ).toContainText(mostrado(dia, s.inicio))
    }
    await expect(form.getByPlaceholder('Título da sessão')).toBeVisible()
    await expect
      .soft(
        form.getByPlaceholder('Título da sessão'),
        'depois de adicionar a sessão o formulário continua preenchido (não limpa): dá para adicionar a mesma sessão duas vezes sem querer',
      )
      .toHaveValue('', { timeout: 5_000 })
    const lista = await secao.innerText()
    const posicoes = sessoes.map((s) => lista.indexOf(s.titulo))
    expect(posicoes.every((p) => p >= 0)).toBe(true)
    const [posEncerramento = 0, posAbertura = 0, posCentral = 0] = posicoes
    expect(
      posAbertura < posCentral && posCentral < posEncerramento,
      'a programação tem de sair na ordem do horário: abertura, palestra, encerramento',
    ).toBe(true)
    await ver(page, info, 'programacao com tres sessoes, na ordem do horario')

    // 4. achado provável: uma sessão fora do período do evento
    const antesDoEvento = diaEmBelem(29)
    const fora = await adicionar({
      titulo: `Sessão fora do período ${RODADA}`,
      inicio: quando(antesDoEvento, '09:00'),
      fim: quando(antesDoEvento, '10:00'),
    })
    expect
      .soft(
        fora.ok(),
        'o sistema ACEITOU uma sessão 2 dias ANTES do início do evento (a programação não precisa caber no período do evento)',
      )
      .toBe(false)
    await ver(
      page,
      info,
      'sessao fora do periodo do evento: aceita ou recusada',
    )

    // 5. Auditoria de cada sessão
    await abrirAuditoria(page, 'sessoes_evento')
    for (const id of ids) {
      await expect(
        linhaDaAuditoria(page, 'CREATE', { registro: id, quem: PRESIDENTE }),
      ).toBeVisible()
    }
    await ver(page, info, 'auditoria: as tres sessoes')
    expect
      .soft(semRotulo, 'campo(s) sem rótulo acessível na tela do evento')
      .toEqual([])
    expect(vigia.problemas()).toEqual([])
  })

  test('vagas e lista de espera: as vagas acabam, o seguinte vai para a espera (contadores certos), quem já está inscrito não duplica, o limite não cai abaixo das vagas ocupadas, e cancelar na tela faz a lista andar', async ({
    page,
  }, info) => {
    test.setTimeout(900_000)
    const vigia = vigiar(page)
    const titulo = `Evento de vagas ${RODADA}`
    const dia = diaEmBelem(32)
    const inscritos = [
      {
        papel: 'secretario',
        nome: 'Daniel Ribeiro Costa',
        esperado: 'Pré-inscrito',
      },
      {
        papel: 'tesoureiro',
        nome: 'Fábio Henrique Dias',
        esperado: 'Pré-inscrito',
      },
      {
        papel: 'vice_presidente',
        nome: 'Bruno Carvalho Lima',
        esperado: 'Lista de Espera',
      },
      {
        papel: 'conselheiro',
        nome: 'Heitor Almeida Rocha',
        esperado: 'Lista de Espera',
      },
    ] as const satisfies readonly {
      papel: Papel
      nome: string
      esperado: string
    }[]

    // o evento tem 2 vagas
    await entrar(page, 'presidente')
    const idEvento = await criarEventoPelaTela(page, {
      titulo,
      inicio: quando(dia, '09:00'),
      fim: quando(dia, '17:00'),
      vagas: '2',
    })
    await sair(page)

    // cada pessoa se inscreve com a PRÓPRIA sessão (não há tela do painel para inscrever alguém)
    const ids: number[] = []
    for (const pessoa of inscritos) {
      await entrar(page, pessoa.papel)
      const resposta = await chamarApi(
        page,
        'POST',
        `/api/eventos/${idEvento}/inscricao`,
      )
      expect(
        resposta.status,
        `${pessoa.papel} se inscrevendo: ${JSON.stringify(resposta.json)}`,
      ).toBe(200)
      const corpo = resposta.json as { id_inscricao: number; status: string }
      expect(corpo.status, `situação de ${pessoa.nome} ao se inscrever`).toBe(
        pessoa.esperado,
      )
      ids.push(corpo.id_inscricao)
      if (pessoa.papel === 'secretario') {
        // a mesma pessoa de novo: recusada, não duplica
        const repetida = await chamarApi(
          page,
          'POST',
          `/api/eventos/${idEvento}/inscricao`,
        )
        expect(repetida.status).toBe(400)
        expect((repetida.json as { detail: string }).detail).toMatch(
          /já está inscrita/,
        )
      }
      await sair(page)
    }

    // a tela do Presidente: contador de vagas e a lista com a situação de cada um
    await entrar(page, 'presidente')
    const detalhe = await abrirEvento(page, idEvento, titulo)
    await expect(detalhe).toContainText(
      /2\/2 vaga\(s\) ocupada\(s\) \(0 livre\(s\)\)/,
    )
    const secao = secaoDe(
      detalhe,
      'Inscritos no evento (autoatendimento pelo painel)',
    )
    const linha = (nome: string) =>
      secao.locator('div.rounded-md.border.p-2').filter({ hasText: nome })
    const situacao = (nome: string) =>
      linha(nome).locator('span.text-muted-foreground').first()
    for (const pessoa of inscritos) {
      await expect(linha(pessoa.nome)).toHaveCount(1)
      await expect(situacao(pessoa.nome)).toHaveText(pessoa.esperado)
    }
    await expect(secao.locator('div.rounded-md.border.p-2')).toHaveCount(4)
    await ver(
      page,
      info,
      'inscritos: duas vagas ocupadas e dois na lista de espera',
    )

    // busca por nome e filtro por situação
    await secao.getByPlaceholder('Buscar por nome…').fill('Daniel')
    await expect(secao.locator('div.rounded-md.border.p-2')).toHaveCount(1)
    await expect(linha('Daniel Ribeiro Costa')).toBeVisible()
    await secao.getByPlaceholder('Buscar por nome…').fill('')
    await secao.locator('select').first().selectOption('Lista de Espera')
    await expect(secao.locator('div.rounded-md.border.p-2')).toHaveCount(2)
    await expect(linha('Bruno Carvalho Lima')).toBeVisible()
    await expect(linha('Heitor Almeida Rocha')).toBeVisible()
    await ver(page, info, 'inscritos filtrados: so a lista de espera')
    await secao.locator('select').first().selectOption('')
    await expect(secao.locator('div.rounded-md.border.p-2')).toHaveCount(4)

    // exportação (permissão própria, sempre auditada)
    await secao.getByRole('button', { name: 'Exportar', exact: true }).click()
    await expect(secao.locator('table')).toContainText('Daniel Ribeiro Costa')
    await expect(secao.locator('table')).toContainText('Lista de Espera')
    await ver(page, info, 'exportacao dos inscritos')

    // Auditoria: uma inscrição por pessoa (e a repetida recusada não deixou rastro)
    await abrirAuditoria(page, 'inscricoes')
    for (const [i, pessoa] of inscritos.entries()) {
      await expect(
        linhaDaAuditoria(page, 'INSCRICAO', {
          registro: ids[i]!,
          quem: pessoa.nome,
        }),
      ).toBeVisible()
    }
    await expect(
      linhaDaAuditoria(page, 'EXPORTAR', { quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: as inscricoes e a exportacao')

    // editar o evento: o limite de vagas não pode ficar abaixo das vagas já ocupadas
    const detalheEdicao = await abrirEvento(page, idEvento, titulo)
    await detalheEdicao
      .getByRole('button', { name: 'Editar evento', exact: true })
      .click()
    const edicao = page.getByRole('form', { name: 'Editar evento' })
    await expect(edicao).toBeVisible()
    await edicao.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(edicao.getByRole('status')).toContainText('Nada foi alterado.')
    await edicao.getByLabel('Vagas (opcional)').fill('1')
    const [limite] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' &&
          new URL(r.url()).pathname === `/api/eventos/${idEvento}`,
      ),
      edicao.getByRole('button', { name: 'Salvar alterações' }).click(),
    ])
    expect(limite.status()).toBe(422)
    await expect(edicao.getByRole('alert')).toContainText(
      'O evento já tem 2 vagas ocupadas: o limite não pode ser menor que isso.',
    )
    await ver(page, info, 'limite de vagas abaixo das ocupadas: recusado')
    await edicao.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(edicao).toHaveCount(0)

    // cancelar um inscrito pela tela
    const detalheCancelar = await abrirEvento(page, idEvento, titulo)
    const secaoCancelar = secaoDe(
      detalheCancelar,
      'Inscritos no evento (autoatendimento pelo painel)',
    )
    const linhaDeDaniel = secaoCancelar
      .locator('div.rounded-md.border.p-2')
      .filter({ hasText: 'Daniel Ribeiro Costa' })
    const idDaniel = ids[0]!
    const [cancelado] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' &&
          new URL(r.url()).pathname === `/api/inscricoes/${idDaniel}/status`,
      ),
      linhaDeDaniel.locator('select').selectOption('Cancelado'),
    ])
    expect(cancelado.status()).toBe(200)
    await expect(
      linhaDeDaniel.locator('span.text-muted-foreground').first(),
    ).toHaveText('Cancelado')
    await expect(
      linhaDeDaniel.locator('select option:not([value=""])'),
    ).toHaveText(['Pré-inscrito'])
    await ver(page, info, 'Daniel cancelado pela tela')
    await abrirAuditoria(page, 'inscricoes')
    await expect(
      linhaDaAuditoria(page, 'UPDATE', {
        registro: idDaniel,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: cancelamento da inscricao')

    // a vaga que abriu tem de voltar ao contador e o primeiro da fila (Bruno) tem de avançar; o segundo (Heitor) continua esperando
    const detalheDepois = await abrirEvento(page, idEvento, titulo)
    const secaoDepois = secaoDe(
      detalheDepois,
      'Inscritos no evento (autoatendimento pelo painel)',
    )
    const situacaoDepois = (nome: string) =>
      secaoDepois
        .locator('div.rounded-md.border.p-2')
        .filter({ hasText: nome })
        .locator('span.text-muted-foreground')
        .first()
    await expect(situacaoDepois('Daniel Ribeiro Costa')).toHaveText('Cancelado')
    // a vaga de Daniel passou para o primeiro da fila (Bruno): o contador segue em 2/2, agora com Bruno dentro e Daniel fora
    await expect(detalheDepois).toContainText(
      /2\/2 vaga\(s\) ocupada\(s\) \(0 livre\(s\)\)/,
      { timeout: 8_000 },
    )
    await expect
      .soft(
        situacaoDepois('Bruno Carvalho Lima'),
        'a lista de espera NÃO andou quando o inscrito foi cancelado pela tela: o primeiro da fila continua em Lista de Espera (a promoção só existe no cancelamento pelo link do e-mail e na expiração do prazo: app/services/vagas.py)',
      )
      .toHaveText('Pré-inscrito', { timeout: 8_000 })
    await expect(situacaoDepois('Heitor Almeida Rocha')).toHaveText(
      'Lista de Espera',
    )
    await ver(page, info, 'depois do cancelamento: contador e lista de espera')
    expect(vigia.problemas()).toEqual([])
  })
})
