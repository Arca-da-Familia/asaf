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
} from './apoio'

// v5.4f — FASE 4 ao vivo, parte 1: PROJETO (criar, editar, publicar no site, em destaque, situação, cronograma, equipe, indicadores, relatório
// final), BENEFICIÁRIOS (cadastro com consentimento LGPD, vínculo ao projeto, prontuário e encaminhamento, tela cruzada, exportação) e
// VOLUNTARIADO ligado ao projeto (vaga de turno, candidatura, confirmação, troca de turno, horas), pela tela do hml-painel, com a recusa que o
// sistema tem que fazer em cada passo e a Auditoria mostrando a ação.
//
// O que este roteiro SABE do código (lido em app/routers/projetos.py, beneficiarios.py, services/projetos.py e nas telas, não suposto):
//  - Tudo é da permissão `projetos` (o Presidente de teste e quem tem o cargo de Presidente a têm; Secretário, Tesoureiro e 2ª Vice não).
//    A exportação de beneficiários é outra permissão (`exportar_beneficiarios`, só o nível Presidente).
//  - NÃO existe aprovação para publicar PROJETO no site: "Pública" publica na hora (só o texto passa pela conferência de dado pessoal). A
//    aprovação por segunda pessoa existe para Documentos e Parcerias. Aqui se confere o que existe e se anota a diferença para o plano.
//  - Mais de um projeto pode estar "em destaque" ao mesmo tempo (regra escrita em app/models/projetos.py); só projeto Público vai a destaque.
//  - NÃO existe foto de projeto (as fotos são de evento) e NÃO existe tela do núcleo familiar do beneficiário nem da alocação direta de
//    voluntário (`/projetos/alocar/`): o primeiro tem só a rota (conferida aqui por GET) e o segundo nem isso.
//  - Prontuário e encaminhamento só abrem para quem está ATIVO na equipe daquele projeto (mesmo o Presidente é barrado se não estiver).
//  - Confirmar candidatura, confirmar troca de turno e aprovar horas é só do COORDENADOR ativo do projeto. Para isso o Presidente entra na
//    equipe como Coordenador. Candidatar-se e registrar horas exige termo de adesão de voluntário vigente (registrado na ficha, em Vínculos).
//
// Os blocos NÃO são `serial` de propósito: `expect.soft` marca o teste como reprovado e o modo serial pularia o que vem depois. O que provavelmente
// reprova (achado do sistema, não erro do roteiro) usa `expect.soft`. O que um passo anterior produz (projeto, beneficiário...) fica em variáveis do
// arquivo, e `exigir` diz com clareza quando o passo anterior não passou.
test.beforeAll(() => exigirHomologacao())

const NAVEGADOR = {
  baseURL: process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br',
  locale: 'pt-BR',
  timezoneId: 'America/Belem',
  viewport: { width: 1366, height: 900 },
}

const PRESIDENTE = 'Marta Souza'
const FABIO = 'Fábio Henrique Dias'
const DANIEL = 'Daniel Ribeiro Costa'
const CARLA = 'Carla Menezes Souza'

const NOME_INTERNO = `Projeto do Robô ${RODADA} Interno`
const NOME_PUBLICO = `Projeto do Robô ${RODADA} Público`
const NOME_PUBLICO_EDITADO = `Projeto do Robô ${RODADA} Público Editado`
const NOME_FIM_ANTES = `Projeto do Robô ${RODADA} Fim Antes`
const BENEFICIARIA_1 = `Beneficiária do Robô ${RODADA} Um de Teste`
const BENEFICIARIO_2 = `Beneficiário do Robô ${RODADA} Dois de Teste`
const MARCO = `Marco do robô ${RODADA}`
const TAREFA = `Tarefa do robô ${RODADA}`
const INDICADOR = `Famílias atendidas pelo robô ${RODADA}`
const FUNCAO = `Apoio do robô ${RODADA}`
const ATIVIDADE_1 = `Apoio de teste ${RODADA} primeira`
const ATIVIDADE_2 = `Apoio de teste ${RODADA} segunda`

// O que um passo produz e os seguintes usam.
const projetosDoRobo: number[] = []
let idInterno = 0
let idPublico = 0
let nomePublico = NOME_PUBLICO
let idBeneficiario1 = 0
let idBeneficiario2 = 0
let idVinculoP1 = 0
let idVinculoP2 = 0
const idAssociado = { fabio: 0, daniel: 0, carla: 0 }
let idAlocacaoFabio = 0
let idAlocacaoDaniel = 0
let idHoras1 = 0
let idHoras2 = 0

function exigir(valor: number, de: string): number {
  if (!valor) {
    throw new Error(
      `falta o resultado de "${de}": o passo anterior do roteiro não passou`,
    )
  }
  return valor
}

const escaparRegex = (texto: string) =>
  texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

// Datas do roteiro, fixadas UMA vez: uma virada de meia-noite no meio da rodada não pode mudar o que se espera ver.
const HOJE = diaEmBelem(0)
const INICIO_DO_PROJETO = diaEmBelem(1)
const FIM_DO_PROJETO = diaEmBelem(60)
const NOVO_FIM_DO_PROJETO = diaEmBelem(75)

// ------------------------------------------------------------------------------------------------------------------------ Auditoria
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

// ------------------------------------------------------------------------------------------------------------------------ apoio de rede
function esperarResposta(
  page: Page,
  metodo: string,
  caminho: RegExp,
): Promise<Resposta> {
  return page.waitForResponse(
    (r) =>
      r.request().method() === metodo &&
      caminho.test(new URL(r.url()).pathname),
  )
}

/** Guarda o "Authorization" que o próprio painel manda à API: serve para provar a recusa do SERVIDOR (e não só a do menu escondido). */
function guardarToken(page: Page): { atual: () => string | undefined } {
  let token: string | undefined
  page.on('request', (r) => {
    void r
      .allHeaders()
      .then((cabecalhos) => {
        if (cabecalhos['authorization']) token = cabecalhos['authorization']
      })
      .catch(() => undefined)
  })
  return { atual: () => token }
}

type ProjetoNoSite = { id_projeto: number; nome: string; destaque: boolean }

/** O que o site vai mostrar: a lista pública de projetos da API de teste (leitura, sem login; o site em si é o roteiro v5.4g). */
async function projetosNoSite(page: Page): Promise<ProjetoNoSite[]> {
  const resposta = await page.request.get(`${API_HML}/api/publico/projetos`)
  expect(resposta.status(), 'a lista pública de projetos tem de abrir').toBe(
    200,
  )
  return (await resposta.json()) as ProjetoNoSite[]
}

async function escolher(seletor: Locator, trecho: string): Promise<void> {
  await expect(
    seletor.locator('option', { hasText: trecho }).first(),
  ).toBeAttached()
  await escolherPorTexto(seletor, trecho)
}

// ------------------------------------------------------------------------------------------------------------------------ a tela de Projetos
const itensDaLista = (page: Page) =>
  page.locator('div[role="button"][aria-pressed]')

/** A linha do projeto na lista (o texto começa pelo nome, seguido de "nº"). */
const itemDoProjeto = (page: Page, nome: string): Locator =>
  itensDaLista(page).filter({
    hasText: new RegExp(`^\\s*${escaparRegex(nome)}\\s+nº\\s+\\d+`),
  })

/** O quadro de detalhe do projeto aberto (o título é o único <h2> com o nome dele). */
const detalheDoProjeto = (page: Page, nome: string): Locator =>
  page
    .getByRole('heading', { name: nome, level: 2, exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')

/** Seção do detalhe pelo <h3> (`subir` = quantos níveis acima do título fica o quadro da seção). */
const secaoH3 = (detalhe: Locator, titulo: string, subir = 1): Locator =>
  detalhe.locator(
    `xpath=.//h3[starts-with(normalize-space(.), "${titulo}")]${'/..'.repeat(subir)}`,
  )

/** Bloco dentro de uma seção, pelo <p> de título pequeno (Vagas de turno, Prontuário de atendimento...). */
const subBloco = (secao: Locator, inicio: string): Locator =>
  secao.locator(`xpath=.//p[starts-with(normalize-space(.), "${inicio}")]/..`)

const cartoes = (secao: Locator) => secao.locator('div.rounded-md.border')

async function abrirProjetos(page: Page): Promise<void> {
  await page.goto('/projetos')
  await expect(
    page.getByRole('heading', { name: 'Projetos', level: 1 }),
  ).toBeVisible()
  // enquanto a lista carrega a tela já diz "Nenhum projeto cadastrado": só vale quando chega o primeiro projeto
  await expect(itensDaLista(page).first()).toBeVisible()
}

/** Abre a lista e o detalhe do projeto (por um endereço novo, então o que se vê veio do servidor). */
async function abrirProjeto(page: Page, nome: string): Promise<Locator> {
  await abrirProjetos(page)
  const item = itemDoProjeto(page, nome)
  await expect(item).toBeVisible()
  await item.click()
  const detalhe = detalheDoProjeto(page, nome)
  await expect(detalhe).toBeVisible()
  return detalhe
}

const formularioNovo = (page: Page): Locator =>
  page.locator('form').filter({
    has: page.getByPlaceholder('Foco (ex.: Social, Educacional)'),
  })

type DadosDoProjeto = {
  nome: string
  foco?: string
  tipo?: string
  inicio?: string
  fim?: string
  responsavel?: string
  publicoAlvo?: string
  descricao?: string
  publica?: boolean
  destaque?: boolean
  alvara?: boolean
}

async function preencherNovoProjeto(
  form: Locator,
  d: DadosDoProjeto,
): Promise<void> {
  await form.getByLabel('Nome do projeto', { exact: true }).fill(d.nome)
  if (d.foco !== undefined) {
    await form.getByLabel('Foco do projeto', { exact: true }).fill(d.foco)
  }
  if (d.tipo) {
    await form
      .getByLabel('Tipo de projeto', { exact: true })
      .selectOption({ label: d.tipo })
  }
  if (d.inicio) {
    await form.getByLabel('Data de início', { exact: true }).fill(d.inicio)
  }
  if (d.fim) {
    await form.getByLabel('Data de fim prevista', { exact: true }).fill(d.fim)
  }
  if (d.responsavel) {
    await escolher(
      form.getByLabel('Responsável pelo projeto', { exact: true }),
      d.responsavel,
    )
  }
  if (d.publicoAlvo !== undefined) {
    await form.getByLabel('Público-alvo', { exact: true }).fill(d.publicoAlvo)
  }
  if (d.descricao !== undefined) {
    await form.getByLabel('Descrição', { exact: true }).fill(d.descricao)
  }
  if (d.alvara) {
    await form
      .getByRole('checkbox', { name: 'Necessita alvará dos bombeiros' })
      .check()
  }
  await form
    .getByLabel('Quem pode ver o projeto', { exact: true })
    .selectOption(d.publica ? 'Pública' : 'Interna')
  if (d.destaque) {
    await form
      .getByRole('checkbox', {
        name: /Mostrar em destaque na página inicial do site/,
      })
      .check()
  }
}

/** Abre o formulário de novo projeto, preenche e envia; devolve a resposta do servidor (o formulário só fecha se o projeto entrou). */
async function criarPelaTela(
  page: Page,
  d: DadosDoProjeto,
): Promise<{ resposta: Resposta; form: Locator }> {
  await abrirProjetos(page)
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click()
  const form = formularioNovo(page)
  await expect(form).toBeVisible()
  await preencherNovoProjeto(form, d)
  const [resposta] = await Promise.all([
    esperarResposta(page, 'POST', /^\/projetos\/$/),
    form.getByRole('button', { name: 'Criar projeto', exact: true }).click(),
  ])
  return { resposta, form }
}

/** O formulário "Editar projeto" aberto na página (só há um projeto aberto por vez). */
const formularioEditar = (page: Page): Locator =>
  page.getByRole('form', { name: 'Editar projeto' })

async function abrirEdicao(page: Page, detalhe: Locator): Promise<Locator> {
  await detalhe.getByRole('button', { name: 'Editar projeto' }).click()
  const editar = formularioEditar(page)
  await expect(editar).toBeVisible()
  return editar
}

const caixaDeDestaque = (escopo: Locator): Locator =>
  escopo.getByRole('checkbox', {
    name: /Mostrar em destaque na página inicial do site/,
  })

// ------------------------------------------------------------------------------------------------------------------------ o estado volta ao que era
/** Deixa o projeto Interno (e sem destaque) pelo formulário de edição. Devolve se precisou mudar. */
async function deixarInterno(page: Page, id: number): Promise<boolean> {
  await page.goto(`/projetos?projeto=${id}`)
  await page.getByRole('button', { name: 'Editar projeto' }).click()
  const editar = page.getByRole('form', { name: 'Editar projeto' })
  await expect(editar).toBeVisible()
  const visibilidade = editar.getByLabel('Quem pode ver o projeto')
  if ((await visibilidade.inputValue()) === 'Interna') {
    await editar.getByRole('button', { name: 'Cancelar' }).click()
    return false
  }
  await visibilidade.selectOption('Interna')
  const [resposta] = await Promise.all([
    esperarResposta(page, 'PUT', /^\/api\/projetos\/\d+$/),
    editar.getByRole('button', { name: 'Salvar alterações' }).click(),
  ])
  expect(resposta.ok(), 'voltar o projeto para Interno').toBe(true)
  return true
}

test.afterAll(async ({ browser }) => {
  test.setTimeout(300_000)
  exigirHomologacao()
  const ids = [...new Set(projetosDoRobo)].filter((id) => id > 0)
  if (ids.length === 0) return
  const contexto = await browser.newContext(NAVEGADOR)
  try {
    const page = await contexto.newPage()
    await entrar(page, 'presidente')
    const feito: string[] = []
    for (const id of ids) {
      try {
        if (await deixarInterno(page, id)) {
          feito.push(`projeto nº ${id} voltou a Interno`)
        }
      } catch (erro) {
        feito.push(`projeto nº ${id}: ${String(erro)}`)
      }
    }
    test.info().annotations.push({
      type: 'restauro',
      description:
        feito.length > 0
          ? feito.join('; ')
          : 'nada a restaurar: os projetos do robô já estavam Internos',
    })
  } finally {
    await contexto.close()
  }
})

// =====================================================================================================================================
// 0. QUEM ENTRA (a permissão `projetos` vem do nível ou do cargo; a exportação de beneficiários é outra)
// =====================================================================================================================================
test.describe('0. Quem entra em Projetos e Beneficiários', () => {
  test('quem não tem a permissão "projetos" é barrado, pela tela e pelo servidor (Secretário, Tesoureiro, 2ª Vice-Presidente)', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const token = guardarToken(page)
    const barrados = ['secretario', 'tesoureiro', 'vice_presidente_2'] as const
    for (const [i, papel] of barrados.entries()) {
      if (i > 0) await sair(page)
      await entrar(page, papel)
      // o nome só aparece depois que as permissões chegaram: o menu escondido não pode ser por estar carregando
      await expect(
        page.getByText(/Bem-vindo, .+ ao painel da ASAF/),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Projetos', exact: true }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('link', { name: 'Beneficiários', exact: true }),
      ).toHaveCount(0)
      for (const rota of ['/projetos', '/beneficiarios']) {
        await page.goto(rota)
        await expect(
          page.getByRole('heading', { name: 'Acesso negado' }),
        ).toBeVisible()
        await expect(
          page.getByText(/permissão necessária: projetos/),
        ).toBeVisible()
      }
      await ver(page, info, `${papel} barrado em Projetos e Beneficiarios`)

      // a recusa tem que vir do sistema, não só do menu: o mesmo pedido da tela, com a conta dele, é recusado pelo servidor
      expect(
        token.atual(),
        'o painel não mandou o token à API: sem ele não dá para provar a recusa do servidor',
      ).toBeTruthy()
      for (const rota of ['/api/projetos/', '/api/beneficiarios/']) {
        const resposta = await page.request.get(`${API_HML}${rota}`, {
          headers: { Authorization: token.atual() ?? '' },
        })
        expect(resposta.status(), `${papel} em ${rota}`).toBe(403)
        expect(await resposta.text()).toContain('projetos')
      }
    }
    expect(vigia.problemas()).toEqual([])
  })

  test('o cargo concede "projetos": a Presidente do cargo (Ana Lúcia) abre Projetos e Beneficiários, mas não a exportação (permissão própria)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const token = guardarToken(page)
    await entrar(page, 'cargo_presidente')
    await expect(page.getByText(/Bem-vindo, Ana Lúcia/)).toBeVisible()
    const modulo = page.getByRole('link', { name: 'Projetos', exact: true })
    await expect(modulo).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Beneficiários', exact: true }),
    ).toBeVisible()
    await modulo.click()
    await expect(
      page.getByRole('heading', { name: 'Projetos', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Todos os projetos' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Novo projeto', exact: true }),
    ).toBeVisible()
    await ver(page, info, 'Presidente do cargo abre Projetos')

    await page.goto('/beneficiarios')
    await expect(
      page.getByRole('heading', { name: 'Beneficiários', level: 1 }),
    ).toBeVisible()
    await expect(campo(page, 'Buscar por nome')).toBeVisible()
    await expect(page.getByText(/^Carregando/)).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Exportar (filtro atual)' }),
    ).toHaveCount(0)
    await ver(page, info, 'Presidente do cargo: Beneficiarios sem exportar')

    expect(token.atual()).toBeTruthy()
    const exportar = await page.request.get(
      `${API_HML}/api/beneficiarios/exportar`,
      { headers: { Authorization: token.atual() ?? '' } },
    )
    expect(exportar.status()).toBe(403)
    expect(await exportar.text()).toContain('exportar_beneficiarios')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// A. PROJETO: abrir, criar, editar, publicar no site, em destaque, situação
// =====================================================================================================================================
test.describe('A. Projeto', () => {
  test('o Presidente chega a Projetos pelo Início: os projetos semeados (Público em destaque e Interno), o detalhe com todas as seções e o que o contexto oferece', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const semRotulo: string[] = []
    const inventario = async (nome: string) => {
      try {
        await inventariar(page, info, nome)
      } catch (erro) {
        semRotulo.push(`${nome}: ${(erro as Error).message}`)
      }
    }
    await entrar(page, 'presidente')
    await page.getByRole('link', { name: 'Projetos', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Projetos', level: 1 }),
    ).toBeVisible()
    const principal = itemDoProjeto(page, 'Projeto Principal de Teste')
    await expect(principal).toBeVisible()
    await expect(principal.getByText('Público', { exact: true })).toBeVisible()
    await expect(
      principal.getByText('Em destaque no site', { exact: true }),
    ).toBeVisible()
    const interno = itemDoProjeto(page, 'Projeto Interno de Teste')
    await expect(interno.getByText('Interno', { exact: true })).toBeVisible()
    await expect(interno.getByText('Em destaque no site')).toHaveCount(0)
    await ver(
      page,
      info,
      'lista de projetos: um Publico em destaque e um Interno',
    )

    // o projeto também abre pelo teclado (Enter na linha)
    await interno.focus()
    await page.keyboard.press('Enter')
    await expect(
      detalheDoProjeto(page, 'Projeto Interno de Teste'),
    ).toBeVisible()
    await principal.click()
    const detalhe = detalheDoProjeto(page, 'Projeto Principal de Teste')
    await expect(detalhe).toBeVisible()
    await expect(detalhe.getByText(/Nº do projeto:/)).toBeVisible()
    for (const titulo of [
      'Contexto do projeto',
      'Cronograma',
      'Equipe',
      'Voluntariado',
      'Beneficiários',
      'Indicadores',
      'Orçamento (via centro de custo)',
      'Encerramento formal',
    ]) {
      await expect(secaoH3(detalhe, titulo), titulo).toBeVisible()
    }
    const situacao = detalhe.getByLabel('Situação do projeto')
    for (const rotulo of [
      'Planejamento',
      'Em execução',
      'Concluído',
      'Suspenso',
      'Cancelado',
    ]) {
      await expect(
        situacao.locator('option', { hasText: rotulo }),
        `situação "${rotulo}"`,
      ).toHaveCount(1)
    }
    const idPrincipal = Number(
      await detalhe
        .locator('p', { hasText: 'Nº do projeto:' })
        .locator('strong')
        .first()
        .innerText(),
    )
    expect(idPrincipal).toBeGreaterThan(0)

    // o contexto: eventos (edições) ligados, relatórios, e o atalho para a notícia (escrita no editor do site, não aqui)
    const contexto = page.getByRole('region', { name: 'Contexto do projeto' })
    await expect(
      contexto.getByText(/Este projeto é Público e está em destaque/),
    ).toBeVisible()
    await expect(
      contexto.getByRole('heading', { name: 'Eventos deste projeto' }),
    ).toBeVisible()
    const edicao = contexto.getByRole('link', {
      name: 'Encontro de Teste 2025',
      exact: true,
    })
    await expect(edicao).toBeVisible()
    await expect(edicao).toHaveAttribute('href', /\/eventos\?evento=\d+/)
    await expect(
      contexto.getByRole('heading', { name: 'Relatórios e documentos' }),
    ).toBeVisible()
    const noticia = contexto.getByRole('link', {
      name: /Escrever notícia deste projeto/,
    })
    await expect(noticia).toHaveAttribute(
      'href',
      /cms\.asaf\.org\.br\/admin\/content\/noticias/,
    )
    await expect(noticia).toHaveAttribute('target', '_blank')
    await expect(noticia).toHaveAttribute('rel', /noopener/)
    await ver(page, info, 'detalhe do projeto principal com todas as secoes')

    // inventário de campos: quem usa leitor de tela precisa saber o que preencher em cada um
    await inventario('projetos-detalhe')
    await page
      .getByRole('button', { name: 'Novo projeto', exact: true })
      .click()
    await expect(formularioNovo(page)).toBeVisible()
    await inventario('projetos-novo-projeto')
    // há dois "Cancelar" (o do alto da lista e o do formulário): o do formulário
    await formularioNovo(page)
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click()
    await expect(formularioNovo(page)).toHaveCount(0)

    // abrir o que o contexto oferece: a edição (evento) e o relatório novo, já ligado a este projeto
    await edicao.click()
    await expect(page).toHaveURL(/\/eventos\?evento=\d+/)
    await expect(
      page.getByRole('heading', { name: 'Eventos', level: 1 }),
    ).toBeVisible()
    await page.goto(`/projetos?projeto=${idPrincipal}`)
    await expect(
      detalheDoProjeto(page, 'Projeto Principal de Teste'),
    ).toBeVisible()
    await page
      .getByRole('link', { name: /Novo relatório deste projeto/ })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Novo documento', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText(`Este documento pertence ao projeto nº ${idPrincipal}.`),
    ).toBeVisible()
    await ver(page, info, 'novo relatorio ja ligado ao projeto')

    expect
      .soft(
        semRotulo,
        'campo(s) sem rótulo acessível na tela de Projetos (Projetos.tsx: cronograma, equipe, vagas, beneficiários e indicadores usam select/data sem aria-label nem label)',
      )
      .toEqual([])
    expect(vigia.problemas()).toEqual([])
  })

  test('criar projeto: o formulário recusa o que falta e o texto público com dado pessoal; o destaque só vale para Público; o certo entra na lista e na Auditoria', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    let enviados = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/projetos/') {
        enviados += 1
      }
    })
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'projetos_eventos')

    await abrirProjetos(page)
    await page
      .getByRole('button', { name: 'Novo projeto', exact: true })
      .click()
    const form = formularioNovo(page)
    await expect(form).toBeVisible()
    const criar = form.getByRole('button', {
      name: 'Criar projeto',
      exact: true,
    })

    // recusa 1: tudo vazio, recusado já na tela (nem chega ao servidor); cada falta aparece UMA vez, no próprio campo
    await criar.click()
    for (const mensagem of [
      'Informe o nome do projeto.',
      'Informe o foco do projeto.',
      'Informe a data de início.',
      'Informe a data de fim prevista.',
    ]) {
      await expect(
        form.getByRole('alert').filter({ hasText: mensagem }),
        mensagem,
      ).toHaveCount(1)
    }
    expect(enviados, 'formulário vazio não deve ir ao servidor').toBe(0)
    await ver(page, info, 'projeto vazio: recusado')

    // recusa 2: nome curto demais (mínimo de 3 letras)
    await form.getByLabel('Nome do projeto', { exact: true }).fill('ab')
    await criar.click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'Informe o nome do projeto.' }),
    ).toHaveCount(1)
    expect(enviados).toBe(0)

    // regra do destaque: só projeto Público; a caixa fica desligada para Interno e desmarca sozinha ao voltar para Interno
    const destaque = caixaDeDestaque(form)
    const visibilidade = form.getByLabel('Quem pode ver o projeto', {
      exact: true,
    })
    await expect(destaque).toBeDisabled()
    await expect(
      form.getByText(/Só projeto Público pode ficar em destaque/),
    ).toBeVisible()
    await visibilidade.selectOption('Pública')
    await expect(destaque).toBeEnabled()
    await expect(
      form.getByText(/passam por conferência de dado pessoal/),
    ).toBeVisible()
    await destaque.check()
    await visibilidade.selectOption('Interna')
    await expect(destaque).not.toBeChecked()
    await expect(destaque).toBeDisabled()
    await ver(page, info, 'destaque so vale para projeto Publico')

    // recusa 3: projeto Público com e-mail de pessoa na descrição (o texto vai ao site)
    await preencherNovoProjeto(form, {
      nome: NOME_PUBLICO,
      foco: 'Social',
      inicio: INICIO_DO_PROJETO.iso,
      fim: FIM_DO_PROJETO.iso,
      publica: true,
      descricao: 'Fale com maria.robo.teste@exemplo.com para participar.',
    })
    await criar.click()
    await expect(
      form.getByRole('alert').filter({
        hasText: /campo 'descrição' vai ao site e parece conter dado pessoal/,
      }),
    ).toBeVisible()
    await expect(itemDoProjeto(page, NOME_PUBLICO)).toHaveCount(0)
    await ver(page, info, 'projeto Publico com e-mail na descricao: recusado')

    // recusa 4: celular de pessoa no público-alvo
    await form.getByLabel('Descrição', { exact: true }).fill('Texto sem dado.')
    await form
      .getByLabel('Público-alvo', { exact: true })
      .fill('Ligar para 91988887777 (WhatsApp)')
    await criar.click()
    await expect(
      form.getByRole('alert').filter({
        hasText:
          /campo 'público-alvo' vai ao site e parece conter dado pessoal/,
      }),
    ).toBeVisible()
    expect(enviados).toBe(2)
    await ver(
      page,
      info,
      'projeto Publico com celular no publico-alvo: recusado',
    )

    // as recusas não deixaram rastro na Auditoria
    expect(await abrirAuditoria(page, 'projetos_eventos')).toBe(antes)

    // achado provável: fim antes do início. O servidor e o formulário de criar não conferem (só o de editar confere).
    const invertido = await criarPelaTela(page, {
      nome: NOME_FIM_ANTES,
      foco: 'Teste',
      inicio: diaEmBelem(30).iso,
      fim: diaEmBelem(1).iso,
    })
    const aceito = invertido.resposta.ok()
    if (aceito) {
      const { id_projeto } = (await invertido.resposta.json()) as {
        id_projeto: number
      }
      projetosDoRobo.push(id_projeto)
      test.info().annotations.push({
        type: 'achado',
        description: `projeto nº ${id_projeto} criado com o fim ANTES do início (${diaEmBelem(1).br} < ${diaEmBelem(30).br})`,
      })
    }
    expect
      .soft(
        aceito,
        'projeto com a previsão de fim ANTES do início foi aceito: o servidor (services/projetos.py::criar_projeto) e o formulário de criar não conferem, só o de editar',
      )
      .toBe(false)
    if (!aceito) {
      await expect.soft(invertido.form.getByRole('alert').first()).toBeVisible()
    }
    await ver(
      page,
      info,
      aceito
        ? 'ACHADO: projeto com fim antes do inicio foi aceito'
        : 'projeto com fim antes do inicio: recusado',
    )

    // projeto Interno completo (responsável, tipo, alvará)
    const interno = await criarPelaTela(page, {
      nome: NOME_INTERNO,
      foco: 'Social',
      tipo: 'Educacional',
      inicio: INICIO_DO_PROJETO.iso,
      fim: diaEmBelem(90).iso,
      responsavel: PRESIDENTE,
      publicoAlvo: 'Famílias do bairro de teste',
      descricao: 'Projeto interno inventado pelo robô, só da associação.',
      alvara: true,
    })
    expect(interno.resposta.status()).toBe(200)
    idInterno = ((await interno.resposta.json()) as { id_projeto: number })
      .id_projeto
    projetosDoRobo.push(idInterno)
    await expect(formularioNovo(page)).toHaveCount(0) // o formulário se fecha sozinho
    const itemInterno = itemDoProjeto(page, NOME_INTERNO)
    await expect(itemInterno).toBeVisible()
    await expect(itemInterno).toContainText(`nº ${idInterno}`)
    await expect(
      itemInterno.getByText('Interno', { exact: true }),
    ).toBeVisible()
    await expect(itemInterno.getByText('Em destaque no site')).toHaveCount(0)
    await expect(itemInterno).toContainText(/PLANEJAMENTO|Planejamento/)

    // projeto Público em destaque
    const publico = await criarPelaTela(page, {
      nome: NOME_PUBLICO,
      foco: 'Social',
      tipo: 'Assistencial',
      inicio: INICIO_DO_PROJETO.iso,
      fim: FIM_DO_PROJETO.iso,
      publicoAlvo: 'Famílias do bairro de teste',
      descricao:
        'Programa inventado pelo robô para conferir a página do projeto, sem dado de pessoa.',
      publica: true,
      destaque: true,
    })
    expect(publico.resposta.status()).toBe(200)
    idPublico = ((await publico.resposta.json()) as { id_projeto: number })
      .id_projeto
    projetosDoRobo.push(idPublico)
    const itemPublico = itemDoProjeto(page, NOME_PUBLICO)
    await expect(itemPublico).toBeVisible()
    await expect(
      itemPublico.getByText('Público', { exact: true }),
    ).toBeVisible()
    await expect(
      itemPublico.getByText('Em destaque no site', { exact: true }),
    ).toBeVisible()
    await ver(
      page,
      info,
      'projetos criados: um Interno e um Publico em destaque',
    )

    // Auditoria: os dois projetos (e nenhuma das recusas)
    expect(
      await abrirAuditoria(page, 'projetos_eventos'),
    ).toBeGreaterThanOrEqual(antes + 2)
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idInterno,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idPublico,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: projetos criados')
    expect(vigia.problemas()).toEqual([])
  })

  test('editar projeto: vem preenchido, "nada foi alterado" avisa, o que falta e o dado pessoal no texto público são recusados; o certo salva, aparece, registra e continua lá depois de recarregar', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const id = exigir(idPublico, 'criar o projeto Público')
    const inicio = INICIO_DO_PROJETO
    const fim = NOVO_FIM_DO_PROJETO
    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'projetos_eventos')
    const detalhe = await abrirProjeto(page, NOME_PUBLICO)
    const editar = await abrirEdicao(page, detalhe)
    const nome = editar.getByLabel('Nome do projeto')
    const dataInicio = editar.getByLabel('Data de início')
    const dataFim = editar.getByLabel('Data de fim prevista')
    const salvar = editar.getByRole('button', { name: 'Salvar alterações' })
    await expect(nome).toHaveValue(NOME_PUBLICO)
    await expect(editar.getByLabel('Quem pode ver o projeto')).toHaveValue(
      'Pública',
    )
    await expect(caixaDeDestaque(editar)).toBeChecked()
    await expect(dataInicio).toHaveValue(INICIO_DO_PROJETO.iso)
    await expect(dataFim).toHaveValue(FIM_DO_PROJETO.iso)
    await ver(page, info, 'formulario de editar projeto preenchido')

    // sem mudar nada
    await salvar.click()
    await expect(editar.getByText('Nada foi alterado.')).toBeVisible()

    // recusas da tela
    await nome.fill('ab')
    await salvar.click()
    await expect(
      editar
        .getByRole('alert')
        .filter({ hasText: 'Dê um nome ao projeto (pelo menos 3 letras).' }),
    ).toBeVisible()
    await nome.fill(NOME_PUBLICO)
    await dataInicio.fill('')
    await salvar.click()
    await expect(
      editar
        .getByRole('alert')
        .filter({ hasText: 'Informe a data de início.' }),
    ).toBeVisible()
    await dataInicio.fill(inicio.iso)
    await dataFim.fill('')
    await salvar.click()
    await expect(
      editar
        .getByRole('alert')
        .filter({ hasText: 'Informe a data de fim prevista.' }),
    ).toBeVisible()
    await dataFim.fill(HOJE.iso) // antes do início (que é amanhã)
    await salvar.click()
    await expect(
      editar.getByRole('alert').filter({
        hasText: 'A data de fim precisa ser depois da data de início.',
      }),
    ).toBeVisible()
    await ver(page, info, 'editar projeto: fim antes do inicio recusado')
    await dataFim.fill(fim.iso)

    // recusa do servidor: o projeto é Público, então o texto vai ao site e não pode ter dado de pessoa
    await nome.fill(`${NOME_PUBLICO} CPF 123.456.789-09`)
    await salvar.click()
    await expect(
      editar.getByRole('alert').filter({
        hasText:
          /campo 'nome do projeto' vai ao site e parece conter dado pessoal/,
      }),
    ).toBeVisible()
    await nome.fill(NOME_PUBLICO)
    await editar
      .getByLabel('Público-alvo (opcional)')
      .fill('Escreva para contato.robo@exemplo.com')
    await salvar.click()
    await expect(
      editar.getByRole('alert').filter({
        hasText:
          /campo 'público-alvo' vai ao site e parece conter dado pessoal/,
      }),
    ).toBeVisible()
    await ver(page, info, 'editar projeto Publico com dado pessoal: recusado')

    // desistir não muda nada
    await editar.getByRole('button', { name: 'Cancelar' }).click()
    await expect(formularioEditar(page)).toHaveCount(0)
    await expect(
      detalheDoProjeto(page, NOME_PUBLICO),
      'o nome com dado pessoal não pode ter sido salvo',
    ).toBeVisible()

    // o certo
    const editar2 = await abrirEdicao(page, detalhe)
    await editar2.getByLabel('Nome do projeto').fill(NOME_PUBLICO_EDITADO)
    await editar2
      .getByLabel('Tipo de projeto (opcional)')
      .selectOption({ label: 'Educacional' })
    await editar2
      .getByLabel('Público-alvo (opcional)')
      .fill('Crianças do bairro de teste')
    await editar2
      .getByLabel('Descrição (opcional)')
      .fill('Descrição editada pelo robô: oficinas semanais inventadas.')
    await editar2.getByLabel('Data de fim prevista').fill(fim.iso)
    const [resposta] = await Promise.all([
      esperarResposta(page, 'PUT', /^\/api\/projetos\/\d+$/),
      editar2.getByRole('button', { name: 'Salvar alterações' }).click(),
    ])
    expect(resposta.status()).toBe(200)
    await expect(formularioEditar(page)).toHaveCount(0) // fecha sozinho
    nomePublico = NOME_PUBLICO_EDITADO
    await expect(detalheDoProjeto(page, nomePublico)).toBeVisible()
    await expect(
      itemDoProjeto(page, nomePublico),
      'a lista tem de mostrar o nome novo',
    ).toBeVisible()
    await ver(page, info, 'projeto editado')

    // continua lá depois de recarregar (endereço novo: o que se vê veio do servidor)
    const recarregado = await abrirProjeto(page, nomePublico)
    await expect(recarregado).toContainText(
      'Descrição editada pelo robô: oficinas semanais inventadas.',
    )
    await expect(recarregado).toContainText(
      'Público-alvo: Crianças do bairro de teste',
    )
    await expect(recarregado).toContainText(`${inicio.br} — ${fim.br}`)
    await expect(itemDoProjeto(page, nomePublico)).toContainText(
      /EDUCACIONAL|Educacional/,
    )
    await ver(page, info, 'projeto editado, depois de recarregar')

    // o endereço ?projeto=N abre o projeto (é o que os outros módulos usam para apontar para ele)
    await page.goto(`/projetos?projeto=${id}`)
    await expect(detalheDoProjeto(page, nomePublico)).toBeVisible()

    // Auditoria: uma edição, e nenhuma das recusas
    expect(await abrirAuditoria(page, 'projetos_eventos')).toBe(antes + 1)
    await expect(
      linhaDaAuditoria(page, 'UPDATE', { registro: id, quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: projeto editado')
    expect(vigia.problemas()).toEqual([])
  })

  test('publicar no site e destaque: o Interno passa a Público e em destaque, vários destaques convivem, o site (API pública) acompanha; voltar a Interno tira do destaque e do site; a situação muda e fica registrada', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const id1 = exigir(idInterno, 'criar o projeto Interno')
    const id2 = exigir(idPublico, 'criar o projeto Público')
    await entrar(page, 'presidente')

    // ponto de partida, no que o site mostra
    const antes = await projetosNoSite(page)
    expect(antes.find((p) => p.nome === nomePublico)?.destaque).toBe(true)
    expect(
      antes.some((p) => p.nome === NOME_INTERNO),
      'projeto Interno nunca vai ao site',
    ).toBe(false)
    expect(
      antes.some((p) => p.nome === NOME_FIM_ANTES),
      'projeto Interno nunca vai ao site',
    ).toBe(false)

    // Interno -> Público e em destaque (sem nenhuma aprovação de segunda pessoa: publica na hora)
    const detalhe = await abrirProjeto(page, NOME_INTERNO)
    await expect(
      page.getByRole('region', { name: 'Contexto do projeto' }),
    ).toContainText('Este projeto é Interno: não aparece no site')
    const editar = await abrirEdicao(page, detalhe)
    await expect(caixaDeDestaque(editar)).toBeDisabled()
    await expect(
      editar.getByText(/Só projeto Público pode ficar em destaque/),
    ).toBeVisible()
    await editar.getByLabel('Quem pode ver o projeto').selectOption('Pública')
    await expect(caixaDeDestaque(editar)).toBeEnabled()
    await caixaDeDestaque(editar).check()
    const [publicou] = await Promise.all([
      esperarResposta(page, 'PUT', /^\/api\/projetos\/\d+$/),
      editar.getByRole('button', { name: 'Salvar alterações' }).click(),
    ])
    expect(publicou.status()).toBe(200)
    await expect(formularioEditar(page)).toHaveCount(0)
    await expect(
      itemDoProjeto(page, NOME_INTERNO).getByText('Público', { exact: true }),
    ).toBeVisible()
    await expect(
      itemDoProjeto(page, NOME_INTERNO).getByText('Em destaque no site', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Contexto do projeto' }),
    ).toContainText('Este projeto é Público e está em destaque')
    // mais de um projeto em destaque ao mesmo tempo (o outro é o que o robô criou antes; o semeado também continua)
    await expect(
      itemDoProjeto(page, nomePublico).getByText('Em destaque no site', {
        exact: true,
      }),
    ).toBeVisible()
    const emDestaque = await itensDaLista(page)
      .filter({ has: page.getByText('Em destaque no site', { exact: true }) })
      .count()
    test.info().annotations.push({
      type: 'destaques',
      description: `${emDestaque} projetos em destaque ao mesmo tempo (o sistema não limita a um)`,
    })
    expect(emDestaque).toBeGreaterThanOrEqual(2)
    await ver(page, info, 'dois projetos em destaque ao mesmo tempo')

    const noSite = await projetosNoSite(page)
    expect(noSite.find((p) => p.id_projeto === id1)?.destaque).toBe(true)
    expect(noSite.find((p) => p.id_projeto === id2)?.destaque).toBe(true)

    // Público -> Interno: o destaque se desmarca sozinho e sai do site
    const detalhe2 = await abrirProjeto(page, NOME_INTERNO)
    const editar2 = await abrirEdicao(page, detalhe2)
    await expect(caixaDeDestaque(editar2)).toBeChecked()
    await editar2.getByLabel('Quem pode ver o projeto').selectOption('Interna')
    await expect(caixaDeDestaque(editar2)).not.toBeChecked()
    await expect(caixaDeDestaque(editar2)).toBeDisabled()
    const [retirou] = await Promise.all([
      esperarResposta(page, 'PUT', /^\/api\/projetos\/\d+$/),
      editar2.getByRole('button', { name: 'Salvar alterações' }).click(),
    ])
    expect(retirou.status()).toBe(200)
    await expect(formularioEditar(page)).toHaveCount(0)
    await expect(
      itemDoProjeto(page, NOME_INTERNO).getByText('Interno', { exact: true }),
    ).toBeVisible()
    await expect(
      itemDoProjeto(page, NOME_INTERNO).getByText('Em destaque no site'),
    ).toHaveCount(0)
    await expect(
      page.getByRole('region', { name: 'Contexto do projeto' }),
    ).toContainText('Este projeto é Interno: não aparece no site')
    await ver(page, info, 'projeto voltou a Interno e saiu do destaque')
    const depois = await projetosNoSite(page)
    expect(
      depois.some((p) => p.id_projeto === id1),
      'o projeto que voltou a Interno saiu do site',
    ).toBe(false)
    expect(depois.some((p) => p.id_projeto === id2)).toBe(true)

    // situação do projeto (vem do catálogo; a tela não tem aviso de erro nem de sucesso, então se confere pela lista e depois de recarregar)
    const detalhe3 = await abrirProjeto(page, nomePublico)
    const [mudou] = await Promise.all([
      esperarResposta(page, 'PUT', /^\/api\/projetos\/\d+\/status$/),
      detalhe3
        .getByLabel('Situação do projeto')
        .selectOption({ label: 'Em execução' }),
    ])
    expect(mudou.status()).toBe(200)
    await expect(itemDoProjeto(page, nomePublico)).toContainText(
      /EM_EXECUCAO|Em execução/,
    )
    const recarregado = await abrirProjeto(page, nomePublico)
    await expect(recarregado.getByLabel('Situação do projeto')).toHaveValue(
      'EM_EXECUCAO',
    )
    await ver(page, info, 'situacao do projeto: Em execucao')

    // retirar do site o projeto Público do robô (o semeado fica como estava)
    const editar3 = await abrirEdicao(page, recarregado)
    await editar3.getByLabel('Quem pode ver o projeto').selectOption('Interna')
    const [saiu] = await Promise.all([
      esperarResposta(page, 'PUT', /^\/api\/projetos\/\d+$/),
      editar3.getByRole('button', { name: 'Salvar alterações' }).click(),
    ])
    expect(saiu.status()).toBe(200)
    await expect(formularioEditar(page)).toHaveCount(0)
    expect(
      (await projetosNoSite(page)).some((p) => p.id_projeto === id2),
      'retirado do site',
    ).toBe(false)

    // Auditoria: cada mudança tem o seu UPDATE, com quem fez
    await abrirAuditoria(page, 'projetos_eventos')
    await expect(
      linhaDaAuditoria(page, 'UPDATE', { registro: id1, quem: PRESIDENTE }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'UPDATE', { registro: id2, quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: publicacao, destaque e situacao')

    test.info().annotations.push({
      type: 'achado',
      description:
        'o plano (v5.4f) pede "publicar no site (aprovação)", mas projeto Público publica na hora, sem segunda pessoa: a aprovação existe só para Documentos e Parcerias',
    })
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// B. DETALHE DO PROJETO: cronograma, equipe e indicadores (o relatório final fica no bloco E, depois de haver o que relatar)
// =====================================================================================================================================
test.describe('B. Cronograma, equipe e indicadores', () => {
  test('cronograma: item sem título e sem prazo é recusado; marco e tarefa entram com a situação derivada (Pendente, Atrasado); concluir muda para Concluído; Auditoria', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    exigir(idPublico, 'criar o projeto Público')
    const prazoDoMarco = diaEmBelem(30)
    await entrar(page, 'presidente')
    const detalhe = await abrirProjeto(page, nomePublico)
    const crono = secaoH3(detalhe, 'Cronograma')
    await expect(crono.getByText('Nenhum item de cronograma.')).toBeVisible()
    const adicionar = crono.getByRole('button', {
      name: 'Adicionar',
      exact: true,
    })
    const titulo = crono.getByPlaceholder('Título', { exact: true })
    const prazo = crono.locator('input[type="date"]')

    // recusa: o título tem lugar para o erro; o prazo não, então vai no resumo do alto do formulário
    await adicionar.click()
    await expect(
      crono.getByRole('alert').filter({ hasText: 'Informe o título.' }),
    ).toHaveCount(1)
    await expect(
      crono.getByRole('alert').filter({ hasText: 'Corrija para continuar:' }),
    ).toContainText('Informe o prazo.')
    await ver(page, info, 'cronograma vazio: recusado')

    // marco, SEM responsável (o campo é opcional)
    await titulo.fill(MARCO)
    await prazo.fill(prazoDoMarco.iso)
    const [primeiraTentativa] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/projetos\/\d+\/cronograma$/),
      adicionar.click(),
    ])
    let criouMarco = primeiraTentativa
    expect
      .soft(
        primeiraTentativa.ok(),
        'item de cronograma SEM responsável foi recusado: o select em branco vira 0 (itemCronogramaCriarSchema usa z.coerce.number() sem tratar o vazio, como já se tratou nos projetos) e o servidor responde "Associado responsável não encontrado"',
      )
      .toBe(true)
    if (!primeiraTentativa.ok()) {
      test.info().annotations.push({
        type: 'achado',
        description: `cronograma sem responsável: HTTP ${primeiraTentativa.status()} ${await primeiraTentativa.text()}`,
      })
      // segue o roteiro escolhendo um responsável
      await escolher(crono.locator('select').nth(1), PRESIDENTE)
      ;[criouMarco] = await Promise.all([
        esperarResposta(page, 'POST', /^\/api\/projetos\/\d+\/cronograma$/),
        adicionar.click(),
      ])
    }
    expect(criouMarco.status()).toBe(200)
    const idMarco = ((await criouMarco.json()) as { id_item: number }).id_item
    const linhaDoMarco = cartoes(crono).filter({ hasText: MARCO })
    await expect(linhaDoMarco).toContainText(`[Marco] ${MARCO}`)
    await expect(
      linhaDoMarco.getByText('Pendente', { exact: true }),
    ).toBeVisible()
    // o prazo é um dia só (sem hora): tem que aparecer no dia em que foi digitado
    await expect
      .soft(
        linhaDoMarco,
        `o prazo digitado foi ${prazoDoMarco.br}: a tela mostra o dia anterior (Projetos.tsx formatarData lê a meia-noite sem fuso como instante UTC; o certo é formatarDia)`,
      )
      .toContainText(`prazo ${prazoDoMarco.br}`)

    // tarefa com prazo vencido e responsável
    await crono.locator('select').nth(0).selectOption('Tarefa')
    await titulo.fill(TAREFA)
    await prazo.fill(diaEmBelem(-5).iso)
    await escolher(crono.locator('select').nth(1), DANIEL)
    const [criouTarefa] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/projetos\/\d+\/cronograma$/),
      adicionar.click(),
    ])
    expect(criouTarefa.status()).toBe(200)
    const idTarefa = ((await criouTarefa.json()) as { id_item: number }).id_item
    const linhaDaTarefa = cartoes(crono).filter({ hasText: TAREFA })
    await expect(linhaDaTarefa).toContainText(`[Tarefa] ${TAREFA}`)
    await expect(
      linhaDaTarefa.getByText('Atrasado', { exact: true }),
      'o prazo já passou: a situação é derivada, nunca escolhida à mão',
    ).toBeVisible()
    await ver(page, info, 'cronograma: marco pendente e tarefa atrasada')

    // concluir
    const [concluiu] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/cronograma\/\d+\/concluir$/),
      linhaDaTarefa
        .getByRole('button', { name: 'Concluir', exact: true })
        .click(),
    ])
    expect(concluiu.status()).toBe(200)
    await expect(
      linhaDaTarefa.getByText('Concluído', { exact: true }),
    ).toBeVisible()
    await expect(
      linhaDaTarefa.getByRole('button', { name: 'Concluir' }),
    ).toHaveCount(0)
    await expect(
      linhaDoMarco.getByRole('button', { name: 'Concluir', exact: true }),
    ).toBeVisible()
    await ver(page, info, 'cronograma: tarefa concluida')

    await abrirAuditoria(page, 'itens_cronograma_projeto')
    await expect(
      linhaDaAuditoria(page, 'CREATE', { registro: idMarco, quem: PRESIDENTE }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idTarefa,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CONCLUSAO', {
        registro: idTarefa,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: cronograma')
    expect(vigia.problemas()).toEqual([])
  })

  test('equipe: sem escolher nada é recusado; o Presidente entra como Coordenador; repetir é recusado; outro membro entra e é encerrado; Auditoria', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    exigir(idPublico, 'criar o projeto Público')
    await entrar(page, 'presidente')
    const detalhe = await abrirProjeto(page, nomePublico)
    const equipe = secaoH3(detalhe, 'Equipe')
    await expect(equipe.getByText('Nenhum membro na equipe.')).toBeVisible()
    const associado = equipe.locator('select').nth(0)
    const papel = equipe.locator('select').nth(1)
    const adicionar = equipe.getByRole('button', {
      name: 'Adicionar',
      exact: true,
    })

    // recusa: nenhum dos dois campos tem lugar para o erro, então as duas faltas vêm no resumo do alto do formulário
    await adicionar.click()
    const resumo = equipe
      .getByRole('alert')
      .filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toContainText('Selecione o associado.')
    await expect(resumo).toContainText('Selecione o papel.')
    await ver(page, info, 'equipe vazia: recusada')

    // o Presidente entra como Coordenador (é o que o dá o poder de confirmar candidatura e aprovar horas, e de ver o prontuário)
    await escolher(associado, PRESIDENTE)
    await papel.selectOption({ label: 'Coordenador' })
    const [entrou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/projetos\/\d+\/equipe$/),
      adicionar.click(),
    ])
    expect(entrou.status()).toBe(200)
    const idMembroPresidente = ((await entrou.json()) as { id_membro: number })
      .id_membro
    const linhaDoPresidente = cartoes(equipe).filter({
      hasText: PRESIDENTE,
    })
    await expect(linhaDoPresidente).toContainText(/COORDENADOR|Coordenador/)

    // o mesmo de novo: o servidor recusa e a tela diz o porquê
    await adicionar.click()
    await expect(
      equipe.getByRole('alert').filter({
        hasText: 'Este associado já está ativo na equipe deste projeto.',
      }),
    ).toBeVisible()
    await ver(page, info, 'equipe: o mesmo associado de novo: recusado')

    // outro membro entra e é encerrado
    await escolher(associado, DANIEL)
    await papel.selectOption({ label: 'Voluntário' })
    const [segundo] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/projetos\/\d+\/equipe$/),
      adicionar.click(),
    ])
    expect(segundo.status()).toBe(200)
    const idMembroDaniel = ((await segundo.json()) as { id_membro: number })
      .id_membro
    const linhaDoDaniel = cartoes(equipe).filter({ hasText: DANIEL })
    await expect(linhaDoDaniel).toContainText(/VOLUNTARIO|Voluntário/)
    await expect(linhaDoDaniel).not.toContainText('(encerrado)')
    const [encerrou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/equipe-projeto\/\d+\/encerrar$/),
      linhaDoDaniel
        .getByRole('button', { name: 'Encerrar', exact: true })
        .click(),
    ])
    expect(encerrou.status()).toBe(200)
    await expect(linhaDoDaniel).toContainText('(encerrado)')
    await expect(
      linhaDoDaniel.getByRole('button', { name: 'Encerrar' }),
    ).toHaveCount(0)
    await expect(
      linhaDoPresidente.getByRole('button', { name: 'Encerrar', exact: true }),
    ).toBeVisible()
    await ver(page, info, 'equipe: Coordenador ativo e membro encerrado')

    await abrirAuditoria(page, 'equipe_projeto')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idMembroPresidente,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idMembroDaniel,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'ENCERRAMENTO', {
        registro: idMembroDaniel,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: equipe do projeto')
    expect(vigia.problemas()).toEqual([])
  })

  test('indicadores e metas: o que falta é recusado; o indicador com meta entra, a medição aparece no gráfico e medir o mesmo período de novo é recusado; Auditoria', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    exigir(idPublico, 'criar o projeto Público')
    await entrar(page, 'presidente')
    const detalhe = await abrirProjeto(page, nomePublico)
    const indicadores = secaoH3(detalhe, 'Indicadores', 2)
    await expect(
      indicadores.getByText('Nenhum indicador cadastrado para este projeto.'),
    ).toBeVisible()
    await indicadores.getByRole('button', { name: 'Novo indicador' }).click()
    const criar = indicadores.getByRole('button', {
      name: 'Criar',
      exact: true,
    })

    // recusa: o nome tem lugar para o erro; unidade e periodicidade vão no resumo
    await criar.click()
    await expect(
      indicadores
        .getByRole('alert')
        .filter({ hasText: 'Informe o nome do indicador.' }),
    ).toHaveCount(1)
    const resumo = indicadores
      .getByRole('alert')
      .filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toContainText('Selecione a unidade.')
    await expect(resumo).toContainText('Selecione a periodicidade.')
    await ver(page, info, 'indicador vazio: recusado')

    await indicadores.getByPlaceholder('Nome do indicador').fill(INDICADOR)
    await indicadores.locator('select').nth(0).selectOption({ label: 'Pessoa' })
    await indicadores.locator('select').nth(1).selectOption({ label: 'Mensal' })
    await indicadores.getByPlaceholder('Meta (opcional)').fill('100')
    const [criou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/indicadores\/$/),
      criar.click(),
    ])
    expect(criou.status()).toBe(200)
    const idIndicador = ((await criou.json()) as { id_indicador: number })
      .id_indicador
    const linha = cartoes(indicadores).filter({ hasText: INDICADOR })
    await expect(linha).toBeVisible() // o formulário se fecha sozinho
    await expect(linha).toContainText('meta 100')
    await ver(page, info, 'indicador com meta cadastrado')

    // medições
    await linha.getByRole('button', { name: 'Medições', exact: true }).click()
    await expect(
      linha.getByText('Nenhuma medição registrada ainda.'),
    ).toBeVisible()
    const valor = linha.getByPlaceholder('Valor', { exact: true })
    const periodo = linha.getByPlaceholder('Período (ex.: 2026-01)')
    const registrar = linha.getByRole('button', { name: 'Registrar medição' })
    await valor.fill('')
    await registrar.click()
    await expect(
      linha
        .getByRole('alert')
        .filter({ hasText: 'Informe o período desta medição.' }),
    ).toHaveCount(1)
    await ver(page, info, 'medicao sem periodo: recusada')

    await valor.fill('40')
    await periodo.fill('2026-01')
    await linha.getByPlaceholder('Fonte (opcional)').fill('Planilha de teste')
    const [mediu] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/indicadores\/\d+\/medicoes$/),
      registrar.click(),
    ])
    expect(mediu.status()).toBe(200)
    const idMedicao1 = ((await mediu.json()) as { id_medicao: number })
      .id_medicao
    await expect(linha.locator('.recharts-wrapper')).toBeVisible()
    await expect(
      linha.getByText('Nenhuma medição registrada ainda.'),
    ).toHaveCount(0)

    // o mesmo período de novo: o servidor recusa (uma medição por período)
    await registrar.click()
    await expect(
      linha.getByRole('alert').filter({
        hasText: /Já existe medição deste indicador para o período '2026-01'/,
      }),
    ).toBeVisible()
    await ver(page, info, 'medicao repetida no mesmo periodo: recusada')

    await valor.fill('70')
    await periodo.fill('2026-02')
    const [mediu2] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/indicadores\/\d+\/medicoes$/),
      registrar.click(),
    ])
    expect(mediu2.status()).toBe(200)
    const idMedicao2 = ((await mediu2.json()) as { id_medicao: number })
      .id_medicao
    await expect(linha.locator('.recharts-wrapper')).toBeVisible()
    await ver(page, info, 'indicador com duas medicoes no grafico')

    await abrirAuditoria(page, 'indicadores')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idIndicador,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await abrirAuditoria(page, 'medicoes_indicador')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idMedicao1,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idMedicao2,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: indicador e medicoes')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// C. BENEFICIÁRIOS: cadastro, vínculo, prontuário só da equipe, tela cruzada (consentimento LGPD) e exportação
// =====================================================================================================================================
test.describe('C. Beneficiários e atendimento', () => {
  test('cadastrar beneficiário pelo projeto: nome faltando é recusado; entra vinculado como Atendido, com e sem consentimento LGPD; Auditoria', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    exigir(idPublico, 'criar o projeto Público')
    await entrar(page, 'presidente')
    const antes = {
      beneficiarios: await abrirAuditoria(page, 'beneficiarios'),
      vinculos: await abrirAuditoria(page, 'beneficiarios_projeto'),
    }
    const detalhe = await abrirProjeto(page, nomePublico)
    const beneficiarios = secaoH3(detalhe, 'Beneficiários', 2)
    await expect(
      beneficiarios.getByText('Nenhum beneficiário vinculado a este projeto.'),
    ).toBeVisible()
    const novo = beneficiarios.getByRole('button', {
      name: 'Novo beneficiário',
    })
    await novo.click()
    const nome = beneficiarios.getByPlaceholder('Nome do beneficiário')
    const consentimento = beneficiarios.getByRole('checkbox', {
      name: 'Consentimento registrado',
    })
    const criar = beneficiarios.getByRole('button', {
      name: 'Criar e vincular',
    })

    // recusa: sem nome e com nome curto demais
    await criar.click()
    await expect(
      beneficiarios
        .getByRole('alert')
        .filter({ hasText: 'Informe o nome do beneficiário.' }),
    ).toHaveCount(1)
    await nome.fill('ab')
    await criar.click()
    await expect(
      beneficiarios
        .getByRole('alert')
        .filter({ hasText: 'Informe o nome do beneficiário.' }),
    ).toHaveCount(1)
    await ver(page, info, 'beneficiario sem nome: recusado')

    // 1: sem o consentimento (fica "Pendente" na tela cruzada)
    await nome.fill(BENEFICIARIA_1)
    const [criou1, vinculou1] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/beneficiarios\/$/),
      esperarResposta(page, 'POST', /^\/api\/beneficiarios-projeto\/$/),
      criar.click(),
    ])
    expect(criou1.status()).toBe(200)
    expect(vinculou1.status()).toBe(200)
    idBeneficiario1 = ((await criou1.json()) as { id_beneficiario: number })
      .id_beneficiario
    idVinculoP2 = ((await vinculou1.json()) as { id_vinculo: number })
      .id_vinculo
    const cartao1 = beneficiarios
      .locator('div.rounded-md.border')
      .filter({ hasText: new RegExp(`Beneficiário #${idBeneficiario1}\\b`) })
    await expect(cartao1).toContainText(/ATENDIDO|Atendido/)
    await expect(cartao1).not.toContainText('por família')
    await expect(novo).toBeVisible() // o formulário se fechou sozinho: o botão voltou a "Novo beneficiário"

    // 2: com o consentimento
    await novo.click()
    await nome.fill(BENEFICIARIO_2)
    await consentimento.check()
    const [criou2] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/beneficiarios\/$/),
      esperarResposta(page, 'POST', /^\/api\/beneficiarios-projeto\/$/),
      criar.click(),
    ])
    expect(criou2.status()).toBe(200)
    idBeneficiario2 = ((await criou2.json()) as { id_beneficiario: number })
      .id_beneficiario
    await expect(
      beneficiarios
        .locator('div.rounded-md.border')
        .filter({ hasText: new RegExp(`Beneficiário #${idBeneficiario2}\\b`) }),
    ).toBeVisible()
    await ver(page, info, 'dois beneficiarios cadastrados e vinculados')

    expect(await abrirAuditoria(page, 'beneficiarios')).toBeGreaterThanOrEqual(
      antes.beneficiarios + 2,
    )
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idBeneficiario1,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idBeneficiario2,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    expect(
      await abrirAuditoria(page, 'beneficiarios_projeto'),
    ).toBeGreaterThanOrEqual(antes.vinculos + 2)
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idVinculoP2,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: beneficiarios e vinculos')
    expect(vigia.problemas()).toEqual([])
  })

  test('vincular um beneficiário já cadastrado a outro projeto (com papel e "atendimento por família"); sem o prontuário, porque o Presidente não é da equipe daquele projeto', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    const id = exigir(idBeneficiario1, 'cadastrar o beneficiário')
    exigir(idInterno, 'criar o projeto Interno')
    await entrar(page, 'presidente')
    const detalhe = await abrirProjeto(page, NOME_INTERNO)
    const beneficiarios = secaoH3(detalhe, 'Beneficiários', 2)
    const beneficiario = beneficiarios.locator('select').nth(0)
    const papel = beneficiarios.locator('select').nth(1)
    const vincular = beneficiarios.getByRole('button', {
      name: 'Vincular',
      exact: true,
    })
    await expect(
      beneficiario
        .locator('option')
        .filter({ hasText: new RegExp(`^Beneficiário #${id}$`) }),
    ).toHaveCount(1)

    // recusa: nenhum dos dois campos tem lugar para o erro: vai no resumo do alto
    await vincular.click()
    const resumo = beneficiarios
      .getByRole('alert')
      .filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toContainText('Selecione o beneficiário.')
    await expect(resumo).toContainText('Selecione o papel.')
    await ver(page, info, 'vincular sem escolher: recusado')

    await beneficiario.selectOption({ label: `Beneficiário #${id}` })
    await papel.selectOption({ label: 'Aluno' })
    await beneficiarios
      .getByRole('checkbox', { name: 'Atendimento por família' })
      .check()
    const [vinculou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/beneficiarios-projeto\/$/),
      vincular.click(),
    ])
    expect(vinculou.status()).toBe(200)
    idVinculoP1 = ((await vinculou.json()) as { id_vinculo: number }).id_vinculo
    const cartao = beneficiarios
      .locator('div.rounded-md.border')
      .filter({ hasText: new RegExp(`Beneficiário #${id}\\b`) })
    await expect(cartao).toContainText(/ALUNO|Aluno/)
    await expect(cartao).toContainText('por família')
    // quem já está vinculado sai da lista de "já cadastrados"
    await expect(
      beneficiario
        .locator('option')
        .filter({ hasText: new RegExp(`^Beneficiário #${id}$`) }),
    ).toHaveCount(0)
    await ver(page, info, 'beneficiario vinculado a outro projeto por familia')

    // o Presidente não é da equipe deste projeto: o prontuário é recusado (dado sensível: só a equipe ativa do projeto)
    await cartao
      .getByRole('button', { name: 'Prontuário', exact: true })
      .click()
    await expect(
      cartao.getByText(
        /Só a equipe ativa deste projeto pode ver ou registrar o prontuário/,
      ),
    ).toBeVisible()
    await expect(cartao.getByPlaceholder('Relato do atendimento')).toHaveCount(
      0,
    )
    await ver(page, info, 'prontuario recusado: Presidente fora da equipe')

    // a recusa não deixou rastro de consulta
    await abrirAuditoria(page, 'registros_atendimento')
    await expect(
      linhaDaAuditoria(page, 'CONSULTA_PRONTUARIO', { registro: idVinculoP1 }),
    ).toHaveCount(0)
    await abrirAuditoria(page, 'beneficiarios_projeto')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idVinculoP1,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    expect(vigia.problemas()).toEqual([])
  })

  test('prontuário e encaminhamento (a equipe do projeto): o que falta é recusado; atendimento e encaminhamento entram; a leitura é auditada; quem tem "projetos" mas não é da equipe é barrado', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const id = exigir(idBeneficiario1, 'cadastrar o beneficiário')
    const vinculo = exigir(idVinculoP2, 'vincular o beneficiário ao projeto')
    const relato = `Atendimento de teste ${RODADA}: orientação inventada, sem dado de pessoa.`
    const encaminhamento = `Encaminhamento de teste ${RODADA}: pedido inventado.`
    const cartaoDe = (detalhe: Locator) =>
      secaoH3(detalhe, 'Beneficiários', 2)
        .locator('div.rounded-md.border')
        .filter({ hasText: new RegExp(`Beneficiário #${id}\\b`) })

    await entrar(page, 'presidente')
    const antes = await abrirAuditoria(page, 'registros_atendimento')
    const detalhe = await abrirProjeto(page, nomePublico)
    const cartao = cartaoDe(detalhe)
    await cartao
      .getByRole('button', { name: 'Prontuário', exact: true })
      .click()
    const atendimento = subBloco(cartao, 'Prontuário de atendimento')
    const rede = subBloco(cartao, 'Encaminhamento à rede externa')
    await expect(
      atendimento.getByText('Nenhum atendimento registrado.'),
    ).toBeVisible()
    await expect(
      rede.getByText('Nenhum encaminhamento registrado.'),
    ).toBeVisible()

    // atendimento: vazio, curto, só espaços (o servidor diz o porquê) e o certo
    const campoRelato = atendimento.getByPlaceholder('Relato do atendimento')
    const registrar = atendimento.getByRole('button', {
      name: 'Registrar',
      exact: true,
    })
    await registrar.click()
    await expect(
      atendimento
        .getByRole('alert')
        .filter({ hasText: 'Descreva o atendimento.' }),
    ).toHaveCount(1)
    await campoRelato.fill('abc')
    await registrar.click()
    await expect(
      atendimento
        .getByRole('alert')
        .filter({ hasText: 'Descreva o atendimento.' }),
    ).toHaveCount(1)
    await campoRelato.fill('      ')
    await registrar.click()
    await expect(
      atendimento
        .getByRole('alert')
        .filter({ hasText: /Descreva o atendimento \(mínimo 5 caracteres\)/ }),
    ).toBeVisible()
    await ver(page, info, 'atendimento vazio, curto e so de espacos: recusado')
    await campoRelato.fill(relato)
    const [registrou] = await Promise.all([
      esperarResposta(
        page,
        'POST',
        /^\/api\/beneficiarios-projeto\/\d+\/atendimentos$/,
      ),
      registrar.click(),
    ])
    expect(registrou.status()).toBe(200)
    const idRegistro = ((await registrou.json()) as { id_registro: number })
      .id_registro
    await expect(atendimento.getByText(relato)).toBeVisible()
    await expect(
      atendimento.getByText('Nenhum atendimento registrado.'),
    ).toHaveCount(0)

    // encaminhamento: tipo da rede e descrição
    const registrarEncaminhamento = rede.getByRole('button', {
      name: 'Registrar',
      exact: true,
    })
    await registrarEncaminhamento.click()
    await expect(
      rede.getByRole('alert').filter({ hasText: 'Descreva o encaminhamento.' }),
    ).toHaveCount(1)
    await expect(
      rede.getByRole('alert').filter({ hasText: 'Corrija para continuar:' }),
    ).toContainText('Selecione o tipo de rede.')
    await rede.locator('select').selectOption({ label: 'CRAS' })
    await rede
      .getByPlaceholder('Descrição do encaminhamento')
      .fill(encaminhamento)
    const [encaminhou] = await Promise.all([
      esperarResposta(
        page,
        'POST',
        /^\/api\/beneficiarios-projeto\/\d+\/encaminhamentos$/,
      ),
      registrarEncaminhamento.click(),
    ])
    expect(encaminhou.status()).toBe(200)
    const idEncaminhamento = (
      (await encaminhou.json()) as { id_encaminhamento: number }
    ).id_encaminhamento
    await expect(rede.getByText(encaminhamento)).toBeVisible()
    await expect(rede.getByText(/^CRAS — \d{2}\/\d{2}\/\d{4}$/)).toBeVisible()
    await ver(page, info, 'prontuario com atendimento e encaminhamento')

    // Auditoria: o atendimento, o encaminhamento e QUEM LEU o prontuário
    expect(await abrirAuditoria(page, 'registros_atendimento')).toBeGreaterThan(
      antes,
    )
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idRegistro,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CONSULTA_PRONTUARIO', {
        registro: vinculo,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: atendimento e consulta do prontuario')
    await abrirAuditoria(page, 'encaminhamentos_rede_externa')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: idEncaminhamento,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await sair(page)

    // quem tem "projetos" (pelo cargo) mas não está na equipe vê o beneficiário no projeto, não o prontuário
    await entrar(page, 'cargo_presidente')
    const detalheDela = await abrirProjeto(page, nomePublico)
    const cartaoDela = cartaoDe(detalheDela)
    await expect(cartaoDela).toBeVisible()
    await cartaoDela
      .getByRole('button', { name: 'Prontuário', exact: true })
      .click()
    await expect(
      cartaoDela.getByText(
        /Só a equipe ativa deste projeto pode ver ou registrar o prontuário/,
      ),
    ).toBeVisible()
    await expect(cartaoDela.getByText(relato)).toHaveCount(0)
    await ver(
      page,
      info,
      'prontuario recusado: tem projetos, mas nao e da equipe',
    )
    expect(vigia.problemas()).toEqual([])
  })

  test('tela de Beneficiários: busca, filtro por projeto, consentimento LGPD (registrar e retirar), edição com recusa, núcleo familiar só pela rota e exportação auditada', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const token = guardarToken(page)
    const id1 = exigir(idBeneficiario1, 'cadastrar o beneficiário')
    const id2 = exigir(idBeneficiario2, 'cadastrar o segundo beneficiário')
    const semRotulo: string[] = []
    const nascimento = '1990-03-04'
    const linhaDe = (nome: string) =>
      page.getByRole('row').filter({ hasText: nome })

    await entrar(page, 'presidente')
    await page.goto('/beneficiarios')
    await expect(
      page.getByRole('heading', { name: 'Beneficiários', level: 1 }),
    ).toBeVisible()
    await expect(page.getByText(/^Carregando/)).toHaveCount(0)
    for (const coluna of ['Nome', 'Nascimento', 'Consentimento LGPD']) {
      await expect(
        page.getByRole('columnheader', { name: coluna }),
        coluna,
      ).toBeVisible()
    }
    try {
      await inventariar(page, info, 'beneficiarios')
    } catch (erro) {
      semRotulo.push((erro as Error).message)
    }

    // busca por nome e consentimento: um Pendente, outro Registrado
    await campo(page, 'Buscar por nome').fill(String(RODADA))
    await expect(linhaDe(BENEFICIARIA_1)).toBeVisible()
    await expect(linhaDe(BENEFICIARIO_2)).toBeVisible()
    await expect(linhaDe(BENEFICIARIA_1)).toContainText('Pendente')
    await expect(linhaDe(BENEFICIARIO_2)).toContainText('Registrado')
    await ver(page, info, 'busca por nome: um pendente e um com consentimento')

    // filtro por projeto: o primeiro está nos dois projetos, o segundo só em um
    await campo(page, 'Projeto').selectOption({ label: NOME_INTERNO })
    await expect(linhaDe(BENEFICIARIA_1)).toBeVisible()
    await expect(linhaDe(BENEFICIARIO_2)).toHaveCount(0)
    await campo(page, 'Projeto').selectOption({ label: nomePublico })
    await expect(linhaDe(BENEFICIARIA_1)).toBeVisible()
    await expect(linhaDe(BENEFICIARIO_2)).toBeVisible()
    await campo(page, 'Projeto').selectOption({ label: 'Todos os projetos' })

    // busca sem resultado
    await campo(page, 'Buscar por nome').fill(`inexistente-${RODADA}`)
    await expect(page.getByText('Nenhum beneficiário encontrado')).toBeVisible()
    await campo(page, 'Buscar por nome').fill(String(RODADA))
    await expect(linhaDe(BENEFICIARIA_1)).toBeVisible()

    // edição: recusa (nome vazio e curto), depois registrar o consentimento LGPD com observação e nascimento
    await linhaDe(BENEFICIARIA_1)
      .getByRole('button', { name: 'Editar' })
      .click()
    const edicao = page.locator('div.rounded-md.border').filter({
      has: page.getByRole('heading', { name: `Editar beneficiário #${id1}` }),
    })
    await expect(edicao).toBeVisible()
    const nome = campo(page, 'Nome completo')
    const salvar = edicao.getByRole('button', { name: 'Salvar', exact: true })
    await nome.fill('')
    await salvar.click()
    await expect(
      edicao
        .getByRole('alert')
        .filter({ hasText: 'Informe o nome do beneficiário.' }),
    ).toHaveCount(1)
    await nome.fill('ab')
    await salvar.click()
    await expect(
      edicao
        .getByRole('alert')
        .filter({ hasText: 'Informe o nome do beneficiário.' }),
    ).toHaveCount(1)
    await ver(page, info, 'editar beneficiario: nome recusado')
    await nome.fill(BENEFICIARIA_1)
    await campo(page, 'Nascimento').fill(nascimento)
    await campo(page, 'Observação sobre o consentimento').fill(
      'Consentimento colhido em papel (teste do robô).',
    )
    await edicao
      .getByRole('checkbox', { name: 'Consentimento LGPD registrado' })
      .check()
    const [salvou] = await Promise.all([
      esperarResposta(page, 'PUT', /^\/api\/beneficiarios\/\d+$/),
      salvar.click(),
    ])
    expect(salvou.status()).toBe(200)
    await expect(edicao).toHaveCount(0) // fecha sozinho
    await expect(linhaDe(BENEFICIARIA_1)).toContainText('Registrado')
    // data só-dia: tem que aparecer o dia digitado
    await expect
      .soft(
        linhaDe(BENEFICIARIA_1),
        'o nascimento digitado foi 04/03/1990: a tela mostra o dia anterior (Beneficiarios.tsx formatarData lê a meia-noite sem fuso como instante UTC; o certo é formatarDia)',
      )
      .toContainText('04/03/1990')
    await ver(page, info, 'consentimento LGPD registrado')

    // ao reabrir a edição, o que foi gravado volta nos campos
    await linhaDe(BENEFICIARIA_1)
      .getByRole('button', { name: 'Editar' })
      .click()
    await expect(campo(page, 'Observação sobre o consentimento')).toHaveValue(
      'Consentimento colhido em papel (teste do robô).',
    )
    await expect(
      page.getByRole('checkbox', { name: 'Consentimento LGPD registrado' }),
    ).toBeChecked()
    await expect
      .soft(
        campo(page, 'Nascimento'),
        'o nascimento gravado volta em branco na edição: a API devolve data e hora ("1990-03-04T00:00:00") e o campo de data só aceita aaaa-mm-dd (Beneficiarios.tsx, defaultValues)',
      )
      .toHaveValue(nascimento)
    await ver(
      page,
      info,
      'editar beneficiario: o que foi gravado volta nos campos',
    )

    // retirar o consentimento (LGPD: o titular pode retirar): volta a Pendente
    await page
      .getByRole('checkbox', { name: 'Consentimento LGPD registrado' })
      .uncheck()
    const [retirou] = await Promise.all([
      esperarResposta(page, 'PUT', /^\/api\/beneficiarios\/\d+$/),
      page
        .locator('div.rounded-md.border')
        .filter({
          has: page.getByRole('heading', {
            name: `Editar beneficiário #${id1}`,
          }),
        })
        .getByRole('button', { name: 'Salvar', exact: true })
        .click(),
    ])
    expect(retirou.status()).toBe(200)
    await expect(linhaDe(BENEFICIARIA_1)).toContainText('Pendente')
    await ver(page, info, 'consentimento retirado: volta a Pendente')

    // núcleo familiar: a rota existe (v1.7) mas NENHUMA tela a chama; confere-se por GET e fica como achado
    expect(token.atual()).toBeTruthy()
    const nucleo = await page.request.get(
      `${API_HML}/api/beneficiarios/${id1}/nucleo-familiar`,
      { headers: { Authorization: token.atual() ?? '' } },
    )
    expect(nucleo.status()).toBe(200)
    expect(Array.isArray(await nucleo.json())).toBe(true)
    test.info().annotations.push({
      type: 'achado',
      description:
        'GET /api/beneficiarios/{id}/nucleo-familiar responde, mas nenhuma tela mostra o núcleo familiar (nem o "atendimento por família" abre a família); a alocação direta de voluntário (POST /projetos/alocar/) também não tem tela',
    })

    // exportação (permissão própria): só o filtro atual, e fica na Auditoria
    const antesDaExportacao = await abrirAuditoria(page, 'beneficiarios')
    await page.goto('/beneficiarios')
    await campo(page, 'Buscar por nome').fill(String(RODADA))
    await expect(linhaDe(BENEFICIARIO_2)).toBeVisible()
    await page.getByRole('button', { name: 'Exportar (filtro atual)' }).click()
    // a tabela da lista e a da exportação mostram a mesma pessoa
    await expect(linhaDe(BENEFICIARIO_2)).toHaveCount(2)
    await ver(page, info, 'exportacao do filtro atual')
    expect(await abrirAuditoria(page, 'beneficiarios')).toBeGreaterThan(
      antesDaExportacao,
    )
    await expect(
      linhaDaAuditoria(page, 'EXPORTAR', { quem: PRESIDENTE }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'UPDATE', { registro: id1, quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: consentimento e exportacao')

    // o segundo beneficiário (cadastrado já com consentimento) continua Registrado e intacto
    expect(id2).toBeGreaterThan(0)
    expect
      .soft(
        semRotulo,
        'campo(s) sem rótulo acessível na tela de Beneficiários (o filtro "Projeto" tem <label> solto, sem ligar ao select)',
      )
      .toEqual([])
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// D. VOLUNTARIADO LIGADO AO PROJETO: termo, vaga de turno, candidatura, confirmação, troca de turno, horas
// =====================================================================================================================================
test.describe('D. Voluntariado vinculado ao projeto', () => {
  /** Na ficha do associado, aba Vínculos: registra (ou renova) o termo de adesão de voluntário; devolve o número do associado. */
  async function registrarTermo(page: Page, nome: string): Promise<number> {
    await page.goto('/associados')
    await page.getByLabel('Filtrar').fill(nome)
    await page
      .getByRole('link', { name: new RegExp(nome) })
      .first()
      .click()
    await expect(
      page.getByRole('heading', { name: new RegExp(nome) }),
    ).toBeVisible()
    const id = Number(/\/associados\/(\d+)/.exec(page.url())?.[1])
    expect(Number.isInteger(id)).toBe(true)
    await page.getByRole('button', { name: 'Vínculos' }).click()
    await page
      .getByRole('button', { name: /^(Registrar|Renovar) termo de adesão$/ })
      .click()
    await page
      .getByLabel('Atividade *')
      .fill('Apoio em projetos (teste do robô)')
    await page.getByLabel('Carga horária semanal *').fill('4')
    await page.getByLabel('Fim da vigência *').fill(diaEmBelem(180).iso)
    await page
      .getByRole('button', { name: 'Confirmar termo de adesão' })
      .click()
    await expect(page.locator(AVISO)).toContainText(
      'Termo de adesão registrado',
    )
    return id
  }

  /** Descobre o número do associado pela ficha (sem mexer em nada). */
  async function numeroDoAssociado(page: Page, nome: string): Promise<number> {
    await page.goto('/associados')
    await page.getByLabel('Filtrar').fill(nome)
    await page
      .getByRole('link', { name: new RegExp(nome) })
      .first()
      .click()
    await expect(
      page.getByRole('heading', { name: new RegExp(nome) }),
    ).toBeVisible()
    const id = Number(/\/associados\/(\d+)/.exec(page.url())?.[1])
    expect(Number.isInteger(id)).toBe(true)
    return id
  }

  const secaoVoluntariado = (detalhe: Locator) =>
    secaoH3(detalhe, 'Voluntariado')

  test('o Presidente prepara: termo de adesão de Fábio e Daniel (na ficha) e a vaga de turno no projeto, com as recusas', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    exigir(idPublico, 'criar o projeto Público')
    const dia = diaEmBelem(3)
    await entrar(page, 'presidente')
    idAssociado.fabio = await registrarTermo(page, FABIO)
    idAssociado.daniel = await registrarTermo(page, DANIEL)
    // Carla fica SEM termo de propósito: serve para provar as recusas de quem não é voluntário
    idAssociado.carla = await numeroDoAssociado(page, CARLA)
    await ver(page, info, 'termo de adesao registrado na ficha')

    const detalhe = await abrirProjeto(page, nomePublico)
    const vagas = subBloco(secaoVoluntariado(detalhe), 'Vagas de turno')
    await expect(
      vagas.getByText('Nenhuma vaga de escala publicada.'),
    ).toBeVisible()
    const funcao = vagas.getByPlaceholder('Função (ex.: Apoio na cozinha)')
    const inicio = vagas.locator('input[type="datetime-local"]').nth(0)
    const fim = vagas.locator('input[type="datetime-local"]').nth(1)
    const habilidades = vagas.getByPlaceholder(
      'Habilidades (códigos separados por vírgula)',
    )
    const quantidade = vagas.getByPlaceholder('Vagas', { exact: true })
    const horas = vagas.getByPlaceholder('Horas previstas')
    const publicar = vagas.getByRole('button', { name: 'Publicar vaga' })

    // recusa 1: a função tem lugar para o erro; início e fim vão no resumo
    await publicar.click()
    await expect(
      vagas.getByRole('alert').filter({ hasText: 'Informe a função.' }),
    ).toHaveCount(1)
    const resumo = vagas
      .getByRole('alert')
      .filter({ hasText: 'Corrija para continuar:' })
    await expect(resumo).toContainText('Informe o início do turno.')
    await expect(resumo).toContainText('Informe o fim do turno.')
    await ver(page, info, 'vaga vazia: recusada')

    // recusa 2: fim antes do início (o servidor recusa; a frase aparece no alto do formulário)
    await funcao.fill(FUNCAO)
    await inicio.fill(`${dia.iso}T10:00`)
    await fim.fill(`${dia.iso}T09:00`)
    await publicar.click()
    await expect(
      vagas
        .getByRole('alert')
        .filter({ hasText: 'O fim do turno precisa ser depois do início.' }),
    ).toBeVisible()

    // recusa 3: habilidade que não existe no catálogo
    await fim.fill(`${dia.iso}T13:00`)
    await habilidades.fill('XYZ')
    await publicar.click()
    await expect(
      vagas
        .getByRole('alert')
        .filter({ hasText: /Habilidade exigida inválido: 'XYZ'/ }),
    ).toBeVisible()

    // recusa 4: zero vagas (a tela recusa; o campo não tem lugar para o erro, então vai no resumo)
    await habilidades.fill('COZINHA')
    await quantidade.fill('0')
    await publicar.click()
    await expect(
      vagas.getByRole('alert').filter({ hasText: 'Corrija para continuar:' }),
    ).toContainText('Pelo menos 1 vaga.')
    await ver(page, info, 'vaga com zero posicoes: recusada')

    // a vaga de verdade: 2 posições
    await quantidade.fill('2')
    await horas.fill('4')
    const [publicou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/projetos\/\d+\/vagas-escala$/),
      publicar.click(),
    ])
    expect(publicou.status()).toBe(200)
    const idVaga = ((await publicou.json()) as { id_vaga: number }).id_vaga
    const linha = cartoes(vagas).filter({ hasText: FUNCAO })
    await expect(linha).toContainText('2 vaga(s)')
    await expect(linha).toContainText(dia.br)
    await expect(linha).toContainText('10:00')
    await ver(page, info, 'vaga de turno publicada')

    await abrirAuditoria(page, 'vagas_escala_voluntario')
    await expect(
      linhaDaAuditoria(page, 'CREATE', { registro: idVaga, quem: PRESIDENTE }),
    ).toBeVisible()
    expect(vigia.problemas()).toEqual([])
  })

  test('quem não é voluntário (sem termo) não consegue se candidatar nem registrar horas: Carla é recusada e nada é criado', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'vice_presidente_2')
    await page.goto('/meu-voluntariado')
    await expect(
      page.getByRole('heading', { name: 'Meu voluntariado', level: 1 }),
    ).toBeVisible()
    const vagas = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Vagas abertas para candidatura',
      }),
    })
    const cartaoDaVaga = cartoes(vagas).filter({ hasText: FUNCAO })
    await expect(cartaoDaVaga).toBeVisible()
    await expect(cartaoDaVaga).toContainText('2 vaga(s) livre(s)')
    await cartaoDaVaga.getByRole('button', { name: 'Candidatar-se' }).click()
    await expect(
      vagas.getByText(
        'Voluntário sem termo de adesão vigente - não pode ser alocado em projeto.',
      ),
    ).toBeVisible()
    await expect(
      page.getByText('Você ainda não está em nenhuma escala'),
    ).toBeVisible()
    await ver(page, info, 'candidatura recusada: sem termo de adesao')

    // horas: as faltas da tela, e depois a recusa do servidor (sem termo vigente)
    const horas = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Meu histórico de horas' }),
    })
    const registrar = horas.getByRole('button', { name: 'Registrar horas' })
    await registrar.click()
    await expect(
      horas.getByRole('alert').filter({ hasText: 'Informe a data.' }),
    ).toHaveCount(1)
    await expect(
      horas
        .getByRole('alert')
        .filter({ hasText: 'Horas precisam ser maiores que zero.' }),
    ).toHaveCount(1)
    await campo(page, 'Data').fill(diaEmBelem(0).iso)
    await campo(page, 'Horas').fill('2')
    await registrar.click()
    await expect(
      horas.getByRole('alert').filter({ hasText: 'sem termo de adesão' }),
    ).toBeVisible()
    await expect(
      horas.getByText('Nenhuma hora registrada ainda.'),
    ).toBeVisible()
    await ver(page, info, 'horas recusadas: sem termo de adesao')
    expect(vigia.problemas()).toEqual([])
  })

  test('Fábio e Daniel (com termo) se candidatam: entram como Pendente, a vaga perde as posições, repetir é recusado', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const candidatar = async (papel: 'tesoureiro' | 'secretario') => {
      await entrar(page, papel)
      await page.goto('/meu-voluntariado')
      await expect(
        page.getByRole('heading', { name: 'Meu voluntariado', level: 1 }),
      ).toBeVisible()
      const vagas = page.locator('section').filter({
        has: page.getByRole('heading', {
          name: 'Vagas abertas para candidatura',
        }),
      })
      const cartaoDaVaga = cartoes(vagas).filter({ hasText: FUNCAO })
      await expect(cartaoDaVaga).toBeVisible()
      await expect(cartaoDaVaga).toContainText('Habilidades: COZINHA')
      const [candidatou] = await Promise.all([
        esperarResposta(
          page,
          'POST',
          /^\/api\/voluntariado\/vagas\/\d+\/candidatar$/,
        ),
        cartaoDaVaga.getByRole('button', { name: 'Candidatar-se' }).click(),
      ])
      expect(candidatou.status()).toBe(200)
      const { id_alocacao } = (await candidatou.json()) as {
        id_alocacao: number
      }
      const escala = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'Minha escala' }),
      })
      const cartaoDaEscala = escala
        .locator('div.rounded-xl.border')
        .filter({ hasText: FUNCAO })
      await expect(cartaoDaEscala).toContainText('PENDENTE')
      // só se pede troca de turno de uma alocação confirmada
      await expect(
        cartaoDaEscala.getByRole('button', { name: 'Pedir troca de turno' }),
      ).toHaveCount(0)
      return { id_alocacao, vagas, cartaoDaVaga }
    }

    const fabio = await candidatar('tesoureiro')
    idAlocacaoFabio = fabio.id_alocacao
    await expect(fabio.cartaoDaVaga).toContainText('1 vaga(s) livre(s)')
    // repetir: o servidor recusa e a tela mostra o motivo
    await fabio.cartaoDaVaga
      .getByRole('button', { name: 'Candidatar-se' })
      .click()
    await expect(
      fabio.vagas.getByText(
        'Você já está candidatado(a) ou confirmado(a) nesta vaga.',
      ),
    ).toBeVisible()
    await ver(page, info, 'Fabio candidatado: pendente; repetir e recusado')
    await sair(page)

    const daniel = await candidatar('secretario')
    idAlocacaoDaniel = daniel.id_alocacao
    // as duas posições estão ocupadas: a vaga some da lista de abertas
    await expect(
      daniel.vagas.getByText(FUNCAO),
      'sem posição livre a vaga não pode continuar na lista de abertas',
    ).toHaveCount(0)
    await ver(page, info, 'Daniel candidatado: a vaga fechou')
    expect(vigia.problemas()).toEqual([])
  })

  test('quem tem "projetos" mas não é o coordenador (Ana Lúcia) não confirma candidatura: o servidor recusa e nada muda (a tela precisa dizer o porquê)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    exigir(idAlocacaoDaniel, 'candidatar Daniel')
    exigir(idAssociado.daniel, 'registrar o termo do Daniel')
    await entrar(page, 'cargo_presidente')
    const detalhe = await abrirProjeto(page, nomePublico)
    const candidaturas = subBloco(
      secaoVoluntariado(detalhe),
      'Candidaturas pendentes',
    )
    const dele = cartoes(candidaturas).filter({
      hasText: new RegExp(`Associado #${idAssociado.daniel}\\b`),
    })
    await expect(dele).toBeVisible()
    const [recusa] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/alocacoes\/\d+\/confirmar$/),
      dele.getByRole('button', { name: 'Confirmar', exact: true }).click(),
    ])
    expect(recusa.status()).toBe(403)
    expect(await recusa.text()).toContain(
      'Só o coordenador ativo deste projeto',
    )
    // a recusa tem que chegar a quem clicou: hoje a tela ignora o erro (as ações de confirmar/recusar não têm aviso)
    await expect
      .soft(
        page.getByText(/Só o coordenador ativo deste projeto pode fazer isso/),
        'a recusa do servidor (403) não aparece em lugar nenhum da tela: Projetos.tsx (SecaoVoluntariado) não mostra o erro de confirmar, recusar, trocas nem horas',
      )
      .toBeVisible({ timeout: 5_000 })
    await expect(dele, 'a candidatura continua pendente').toBeVisible()
    await ver(page, info, 'Ana nao e coordenadora: confirmar recusado')
    expect(vigia.problemas()).toEqual([])
  })

  test('o Presidente (Coordenador) confirma a candidatura de Fábio e recusa a de Daniel; cada um vê o resultado na própria escala; Auditoria', async ({
    page,
  }, info) => {
    test.setTimeout(420_000)
    const vigia = vigiar(page)
    const fabio = exigir(idAlocacaoFabio, 'candidatar Fábio')
    const daniel = exigir(idAlocacaoDaniel, 'candidatar Daniel')
    await entrar(page, 'presidente')
    const detalhe = await abrirProjeto(page, nomePublico)
    const candidaturas = subBloco(
      secaoVoluntariado(detalhe),
      'Candidaturas pendentes',
    )
    const doFabio = cartoes(candidaturas).filter({
      hasText: new RegExp(`Associado #${idAssociado.fabio}\\b`),
    })
    const doDaniel = cartoes(candidaturas).filter({
      hasText: new RegExp(`Associado #${idAssociado.daniel}\\b`),
    })
    await expect(doFabio).toContainText(FUNCAO)
    await expect(doDaniel).toBeVisible()
    await ver(page, info, 'candidaturas pendentes do projeto')
    const [confirmou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/alocacoes\/\d+\/confirmar$/),
      doFabio.getByRole('button', { name: 'Confirmar', exact: true }).click(),
    ])
    expect(confirmou.status()).toBe(200)
    await expect(doFabio).toHaveCount(0)
    const [recusou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/alocacoes\/\d+\/recusar$/),
      doDaniel.getByRole('button', { name: 'Recusar', exact: true }).click(),
    ])
    expect(recusou.status()).toBe(200)
    await expect(doDaniel).toHaveCount(0)
    await expect(
      candidaturas.getByText('Nenhuma candidatura pendente.'),
    ).toBeVisible()
    await ver(page, info, 'candidaturas resolvidas pelo Coordenador')

    await abrirAuditoria(page, 'alocacoes_voluntarios')
    await expect(
      linhaDaAuditoria(page, 'CANDIDATURA', { registro: fabio, quem: FABIO }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CONFIRMACAO', {
        registro: fabio,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CANDIDATURA', {
        registro: daniel,
        quem: DANIEL,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'RECUSA', { registro: daniel, quem: PRESIDENTE }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: candidaturas, confirmacao e recusa')
    await sair(page)

    // cada um vê o resultado na própria escala
    await entrar(page, 'tesoureiro')
    await page.goto('/meu-voluntariado')
    const escalaDele = page
      .locator('div.rounded-xl.border')
      .filter({ hasText: FUNCAO })
    await expect(escalaDele).toContainText('CONFIRMADA')
    await expect(
      escalaDele.getByRole('button', { name: 'Pedir troca de turno' }),
    ).toBeVisible()
    await ver(page, info, 'Fabio: confirmado, pode pedir troca')
    await sair(page)
    await entrar(page, 'secretario')
    await page.goto('/meu-voluntariado')
    const escalaDoDaniel = page
      .locator('div.rounded-xl.border')
      .filter({ hasText: FUNCAO })
    await expect(escalaDoDaniel).toContainText('RECUSADA')
    await expect(
      escalaDoDaniel.getByRole('button', { name: 'Cancelar', exact: true }),
    ).toHaveCount(0)
    await ver(page, info, 'Daniel: candidatura recusada, sem acao possivel')
    expect(vigia.problemas()).toEqual([])
  })

  test('troca de turno: Fábio pede a troca; substituto inexistente, sem termo (Carla) e o próprio pedinte são recusados; Daniel (com termo) é aceito e o Coordenador confirma; a alocação passa a ser do Daniel', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    const fabio = exigir(idAlocacaoFabio, 'candidatar Fábio')
    const idDoFabio = exigir(idAssociado.fabio, 'registrar o termo do Fábio')
    const idDoDaniel = exigir(idAssociado.daniel, 'registrar o termo do Daniel')
    const idDaCarla = exigir(idAssociado.carla, 'achar a Carla')
    await entrar(page, 'tesoureiro')
    await page.goto('/meu-voluntariado')
    const cartao = page
      .locator('div.rounded-xl.border')
      .filter({ hasText: FUNCAO })
    await expect(cartao).toContainText('CONFIRMADA')
    await cartao.getByRole('button', { name: 'Pedir troca de turno' }).click()
    const substituto = campo(page, 'Nº do associado substituto')
    const solicitar = cartao.getByRole('button', { name: 'Solicitar troca' })
    const pedir = async (numero: string) => {
      await substituto.fill(numero)
      await solicitar.click()
    }

    // recusa 1: sem escolher
    await solicitar.click()
    await expect(
      cartao.getByRole('alert').filter({ hasText: 'Selecione o substituto.' }),
    ).toBeVisible()
    // recusa 2: associado que não existe
    await pedir('999999999')
    await expect(
      cartao
        .getByRole('alert')
        .filter({ hasText: 'Associado substituto não encontrado.' }),
    ).toBeVisible()
    // recusa 3: substituto sem termo de adesão (Carla)
    await pedir(String(idDaCarla))
    await expect(
      cartao.getByRole('alert').filter({
        hasText:
          'Voluntário sem termo de adesão vigente - não pode ser alocado em projeto.',
      }),
    ).toBeVisible()
    await ver(page, info, 'troca recusada: substituto inexistente e sem termo')

    // achado provável: o próprio pedinte como substituto. O servidor não recusa.
    const [propria] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/alocacoes\/\d+\/trocas$/),
      pedir(String(idDoFabio)),
    ])
    const trocaConsigo = propria.ok()
    expect
      .soft(
        trocaConsigo,
        'o servidor aceitou a troca de turno com a PRÓPRIA pessoa como substituto (services/projetos.py::solicitar_troca_turno não compara os dois)',
      )
      .toBe(false)
    if (trocaConsigo) {
      // a tela fecha o formulário ao aceitar: reabre para o pedido de verdade
      await cartao.getByRole('button', { name: 'Pedir troca de turno' }).click()
    }

    // o pedido de verdade: Daniel (com termo)
    const [pediu] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/alocacoes\/\d+\/trocas$/),
      pedir(String(idDoDaniel)),
    ])
    expect(pediu.status()).toBe(200)
    const idTroca = ((await pediu.json()) as { id_troca: number }).id_troca
    await expect(substituto).toHaveCount(0) // o formulário se fecha sozinho
    await ver(page, info, 'troca de turno solicitada')
    test.info().annotations.push({
      type: 'achado',
      description:
        'o voluntário que pediu a troca não vê o pedido nem o resultado em lugar nenhum de "Meu voluntariado" (só o coordenador vê a lista de trocas)',
    })
    await sair(page)

    // o Coordenador resolve: recusa a troca consigo mesmo (se entrou) e confirma a do Daniel
    await entrar(page, 'presidente')
    const detalhe = await abrirProjeto(page, nomePublico)
    const trocas = subBloco(secaoVoluntariado(detalhe), 'Trocas de turno')
    const daqueleTurno = cartoes(trocas).filter({
      hasText: new RegExp(`Alocação #${fabio}\\b`),
    })
    const paraDaniel = daqueleTurno.filter({
      hasText: new RegExp(`substituto associado #\\s*${idDoDaniel}\\b`),
    })
    await expect(paraDaniel).toContainText('SOLICITADA')
    if (trocaConsigo) {
      const consigo = daqueleTurno.filter({
        hasText: new RegExp(`substituto associado #\\s*${idDoFabio}\\b`),
      })
      const [recusouConsigo] = await Promise.all([
        esperarResposta(page, 'POST', /^\/api\/trocas-turno\/\d+\/recusar$/),
        consigo.getByRole('button', { name: 'Recusar', exact: true }).click(),
      ])
      expect(recusouConsigo.status()).toBe(200)
      await expect(consigo).toContainText('RECUSADA')
    }
    await ver(page, info, 'trocas de turno do projeto, vistas pelo Coordenador')
    const [confirmou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/trocas-turno\/\d+\/confirmar$/),
      paraDaniel
        .getByRole('button', { name: 'Confirmar', exact: true })
        .click(),
    ])
    expect(confirmou.status()).toBe(200)
    await expect(paraDaniel).toContainText('CONFIRMADA')
    await expect(
      paraDaniel.getByRole('button', { name: 'Confirmar', exact: true }),
    ).toHaveCount(0)
    await ver(page, info, 'troca de turno confirmada')

    await abrirAuditoria(page, 'trocas_turno_voluntario')
    await expect(
      linhaDaAuditoria(page, 'CREATE', { registro: idTroca, quem: FABIO }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CONFIRMACAO', {
        registro: idTroca,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: troca de turno')
    await sair(page)

    // a alocação passou a ser do Daniel (a mesma, com o mesmo turno); a do Fábio sumiu da escala dele
    await entrar(page, 'secretario')
    await page.goto('/meu-voluntariado')
    await expect(
      page
        .locator('div.rounded-xl.border')
        .filter({ hasText: FUNCAO })
        .filter({ has: page.getByText('CONFIRMADA', { exact: true }) }),
    ).toHaveCount(1)
    await ver(page, info, 'Daniel agora tem o turno confirmado')
    await sair(page)
    await entrar(page, 'tesoureiro')
    await page.goto('/meu-voluntariado')
    await expect(
      page.getByRole('heading', { name: 'Minha escala' }),
    ).toBeVisible()
    await expect(
      page.locator('div.rounded-xl.border').filter({ hasText: FUNCAO }),
    ).toHaveCount(0)
    expect(vigia.problemas()).toEqual([])
  })

  test('horas avulsas (sem alocação): o campo "Alocação (opcional)" em branco registra horas já aprovadas, como o servidor prevê (e a tela não pode dar erro)', async ({
    page,
  }, info) => {
    const vigia = vigiar(page)
    const atividade = `Horas avulsas ${RODADA}`
    await entrar(page, 'secretario')
    await page.goto('/meu-voluntariado')
    const horas = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Meu histórico de horas' }),
    })
    await campo(page, 'Data').fill(HOJE.iso)
    await campo(page, 'Horas').fill('2')
    await campo(page, 'Atividade').fill(atividade)
    await expect(campo(page, 'Alocação (opcional)')).toHaveValue('')
    const [resposta] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/voluntariado\/horas$/),
      horas.getByRole('button', { name: 'Registrar horas' }).click(),
    ])
    expect
      .soft(
        resposta.status(),
        'horas SEM alocação foram recusadas ou deram erro: o select em branco vira id_alocacao 0 (horasVoluntariadoAutoatendimentoSchema usa z.coerce.number() sem tratar o vazio) e o servidor tenta gravar uma alocação 0 que não existe (registros_horas_voluntariado.id_alocacao é chave estrangeira)',
      )
      .toBe(200)
    if (resposta.ok()) {
      const corpo = (await resposta.json()) as { status: string }
      expect
        .soft(
          corpo.status,
          'horas sem alocação não têm coordenador para aprovar: nascem aprovadas (services/voluntariado.py)',
        )
        .toBe('APROVADO')
      await expect(cartoes(horas).filter({ hasText: atividade })).toContainText(
        /APROVADO/,
      )
    } else {
      test.info().annotations.push({
        type: 'achado',
        description: `horas sem alocação: HTTP ${resposta.status()} ${await resposta.text()}`,
      })
    }
    await ver(page, info, 'horas avulsas, sem alocacao')
    expect(vigia.problemas()).toEqual([])
  })

  test('horas de voluntariado: Daniel registra duas (ficam Pendentes), o Coordenador aprova uma e recusa outra; as horas aprovadas somam; Auditoria; depois Daniel cancela o turno', async ({
    page,
  }, info) => {
    test.setTimeout(480_000)
    const vigia = vigiar(page)
    exigir(idAlocacaoFabio, 'candidatar Fábio')
    const ontem = diaEmBelem(-1)
    await entrar(page, 'secretario')
    await page.goto('/meu-voluntariado')
    const horas = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Meu histórico de horas' }),
    })
    const registrar = horas.getByRole('button', { name: 'Registrar horas' })
    const registrarHoras = async (
      quantas: string,
      atividade: string,
    ): Promise<number> => {
      await campo(page, 'Data').fill(ontem.iso)
      await campo(page, 'Horas').fill(quantas)
      await campo(page, 'Atividade').fill(atividade)
      await campo(page, 'Alocação (opcional)').selectOption({ label: FUNCAO })
      const [resposta] = await Promise.all([
        esperarResposta(page, 'POST', /^\/api\/voluntariado\/horas$/),
        registrar.click(),
      ])
      expect(resposta.status()).toBe(200)
      const corpo = (await resposta.json()) as {
        id_registro: number
        status: string
      }
      expect(corpo.status, 'horas de uma alocação esperam o Coordenador').toBe(
        'PENDENTE',
      )
      return corpo.id_registro
    }
    idHoras1 = await registrarHoras('3', ATIVIDADE_1)
    const primeira = cartoes(horas).filter({ hasText: ATIVIDADE_1 })
    await expect(primeira).toContainText('PENDENTE')
    await expect
      .soft(
        primeira,
        `a data digitada foi ${ontem.br}: a tela mostra o dia anterior (formatarData lê a meia-noite sem fuso como instante UTC; o certo é formatarDia)`,
      )
      .toContainText(ontem.br)
    idHoras2 = await registrarHoras('1.5', ATIVIDADE_2)
    await expect(cartoes(horas).filter({ hasText: ATIVIDADE_2 })).toContainText(
      'PENDENTE',
    )
    await ver(page, info, 'Daniel registrou duas horas: pendentes')
    await sair(page)

    // o Coordenador decide
    await entrar(page, 'presidente')
    const detalhe = await abrirProjeto(page, nomePublico)
    const pendentes = subBloco(
      secaoVoluntariado(detalhe),
      'Horas de voluntariado pendentes',
    )
    const linha1 = cartoes(pendentes).filter({ hasText: ATIVIDADE_1 })
    const linha2 = cartoes(pendentes).filter({ hasText: ATIVIDADE_2 })
    await expect(linha1).toContainText('3h')
    await expect(linha2).toContainText('1.5h')
    await ver(page, info, 'horas pendentes de aprovacao')
    const [aprovou] = await Promise.all([
      esperarResposta(
        page,
        'POST',
        /^\/api\/horas-voluntariado\/\d+\/aprovar$/,
      ),
      linha1.getByRole('button', { name: 'Aprovar', exact: true }).click(),
    ])
    expect(aprovou.status()).toBe(200)
    await expect(linha1).toHaveCount(0)
    const [recusou] = await Promise.all([
      esperarResposta(
        page,
        'POST',
        /^\/api\/horas-voluntariado\/\d+\/recusar$/,
      ),
      linha2.getByRole('button', { name: 'Recusar', exact: true }).click(),
    ])
    expect(recusou.status()).toBe(200)
    await expect(linha2).toHaveCount(0)
    await expect(
      pendentes.getByText('Nenhuma hora pendente de aprovação.'),
    ).toBeVisible()
    await ver(page, info, 'horas aprovadas e recusadas pelo Coordenador')

    await abrirAuditoria(page, 'registros_horas_voluntariado')
    await expect(
      linhaDaAuditoria(page, 'APROVACAO', {
        registro: idHoras1,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'RECUSA', {
        registro: idHoras2,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    // o registro das horas pelo próprio voluntário também precisa de rastro (quem lançou, quando)
    await expect
      .soft(
        linhaDaAuditoria(page, 'CREATE', { registro: idHoras1, quem: DANIEL }),
        'o lançamento das horas pelo voluntário não deixa rastro na Auditoria (app/routers/projetos.py::registrar_minhas_horas_endpoint não chama registrar_auditoria)',
      )
      .toBeVisible({ timeout: 5_000 })
    await ver(page, info, 'auditoria: horas aprovadas e recusadas')
    await sair(page)

    // Daniel vê o resultado: uma aprovada (soma na alocação), uma recusada; e cancela o turno
    await entrar(page, 'secretario')
    await page.goto('/meu-voluntariado')
    const historico = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Meu histórico de horas' }),
    })
    await expect(
      cartoes(historico).filter({ hasText: ATIVIDADE_1 }),
    ).toContainText('APROVADO')
    await expect(
      cartoes(historico).filter({ hasText: ATIVIDADE_2 }),
    ).toContainText('RECUSADO')
    const turno = page
      .locator('div.rounded-xl.border')
      .filter({ hasText: FUNCAO })
      .filter({ has: page.getByText('CONFIRMADA', { exact: true }) })
    await expect(turno).toContainText('Realizadas: 3')
    await ver(page, info, 'Daniel: horas aprovada e recusada, 3h realizadas')
    const [cancelou] = await Promise.all([
      esperarResposta(page, 'POST', /^\/api\/alocacoes\/\d+\/cancelar$/),
      turno.getByRole('button', { name: 'Cancelar', exact: true }).click(),
    ])
    expect(cancelou.status()).toBe(200)
    await expect(
      page
        .locator('div.rounded-xl.border')
        .filter({ hasText: FUNCAO })
        .filter({ has: page.getByText('CANCELADA', { exact: true }) }),
    ).toHaveCount(1)
    await ver(page, info, 'Daniel cancelou o turno')
    await sair(page)

    await entrar(page, 'presidente')
    await abrirAuditoria(page, 'alocacoes_voluntarios')
    await expect(
      linhaDaAuditoria(page, 'CANCELAMENTO', {
        registro: idAlocacaoFabio,
        quem: DANIEL,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: turno cancelado')
    expect(vigia.problemas()).toEqual([])
  })
})

// =====================================================================================================================================
// E. ENCERRAMENTO FORMAL E ORÇAMENTO DO PROJETO (depois de haver o que relatar)
// =====================================================================================================================================
test.describe('E. Relatório final e orçamento', () => {
  test('relatório final versionado: gerar duas versões, abrir e conferir o conteúdo; o orçamento diz que o projeto não tem centro de custo; Auditoria', async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    const vigia = vigiar(page)
    exigir(idPublico, 'criar o projeto Público')
    await entrar(page, 'presidente')
    const detalhe = await abrirProjeto(page, nomePublico)
    await expect(
      secaoH3(detalhe, 'Orçamento (via centro de custo)').getByText(
        'Projeto sem centro de custo vinculado.',
      ),
    ).toBeVisible()

    const relatorios = secaoH3(detalhe, 'Encerramento formal')
    const gerar = relatorios.getByRole('button', { name: 'Gerar nova versão' })
    const linha = (versao: number) =>
      cartoes(relatorios).filter({ hasText: `Versão ${versao}` })
    const gerarUma = async () => {
      const [resposta] = await Promise.all([
        esperarResposta(
          page,
          'POST',
          /^\/api\/projetos\/\d+\/relatorio-final$/,
        ),
        gerar.click(),
      ])
      expect(resposta.status()).toBe(200)
      return (await resposta.json()) as {
        id_relatorio: number
        versao: number
      }
    }
    const v1 = await gerarUma()
    await expect(linha(v1.versao)).toBeVisible()
    await linha(v1.versao)
      .getByRole('button', { name: 'Ver', exact: true })
      .click()
    const texto = linha(v1.versao).locator('pre')
    await expect(texto).toContainText(`RELATÓRIO FINAL — ${nomePublico}`)
    await expect(texto).toContainText('1. INDICADORES (resultados x metas)')
    await expect(texto).toContainText(
      new RegExp(`${escaparRegex(INDICADOR)}: meta 100`),
    )
    await expect(texto).toContainText(/realizado 70/)
    await expect(texto).toContainText(`[Pendente] Marco: ${MARCO}`)
    await expect(texto).toContainText(`[Concluído] Tarefa: ${TAREFA}`)
    await expect(texto).toContainText('3. EXECUÇÃO FINANCEIRA')
    // o projeto já tem beneficiários: o relatório não pode dizer que o motor de beneficiários não existe
    await expect
      .soft(
        texto,
        'a seção "2. PÚBLICO ATENDIDO" do relatório diz que o motor de beneficiários "ainda não existe" (services/projetos.py::_gerar_texto_relatorio_final), mas o projeto tem beneficiários vinculados: o relatório nunca traz o número de atendidos',
      )
      .not.toContainText('ainda não existe')
    await ver(page, info, 'relatorio final versao 1 aberto')
    await linha(v1.versao)
      .getByRole('button', { name: 'Fechar', exact: true })
      .click()
    await expect(texto).toHaveCount(0)

    const v2 = await gerarUma()
    expect(v2.versao).toBe(v1.versao + 1)
    await expect(linha(v2.versao)).toBeVisible()
    await expect(linha(v1.versao)).toBeVisible() // a anterior continua guardada: versionado, nunca sobrescrito
    await ver(page, info, 'relatorio final: duas versoes')

    await abrirAuditoria(page, 'relatorios_finais_projeto')
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: v1.id_relatorio,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await expect(
      linhaDaAuditoria(page, 'CREATE', {
        registro: v2.id_relatorio,
        quem: PRESIDENTE,
      }),
    ).toBeVisible()
    await ver(page, info, 'auditoria: relatorio final')

    test.info().annotations.push({
      type: 'achado',
      description:
        'o alvará dos bombeiros, o responsável, o foco e o centro de custo do projeto são pedidos ao criar, mas nenhum aparece no detalhe e nenhum se edita depois (EditarProjeto só muda nome, tipo, texto, datas, visibilidade e destaque); não há tela de foto de projeto (as fotos são de evento)',
    })
    expect(vigia.problemas()).toEqual([])
  })
})
