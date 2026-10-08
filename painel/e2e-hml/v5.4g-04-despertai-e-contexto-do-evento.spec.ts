import { createHash } from 'node:crypto'

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
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'
import {
  APARELHO_ESCONDIDO,
  COMENTARIO_ESCONDIDO,
  jpegComLocalizacao,
  lerJpeg,
  metadadosDoJpeg,
} from './imagens'

// v5.4g - FASE 5 ao vivo, item 4: DESPERTAI E O CONTEXTO DO EVENTO (v5.4b, terceiro lote / R8), pela tela do hml-painel e conferindo a API PÚBLICA da homologação (sem login).
// O Despertai é um PROJETO Público marcado como destaque; cada edição é um EVENTO ligado ao projeto; os relatórios são DOCUMENTOS ligados ao evento ou ao projeto
// (aprovados por OUTRA pessoa); a foto do evento só entra com a autorização de imagem confirmada e a imagem é regravada sem GPS. A página do hml-site NÃO é aberta
// aqui: o site lê a API no build, então ela se confere num roteiro separado, depois de uma nova publicação. Por isso os nomes levam um prefixo fixo e reconhecível:
//   projeto em destaque ......... "Despertai de Teste (robô v5.4g) <RODADA>"
//   edições (eventos) ........... "Despertai de Teste (robô v5.4g) <RODADA> - 1ª edição" (já aconteceu, com foto e relatório) e "... - 2ª edição" (daqui a 60 dias)
//   o que NUNCA pode aparecer ... "Despertai Interno de Teste (robô v5.4g) <RODADA>" (projeto) e "... - evento interno" (evento)
//
// O que este roteiro SABE do código (lido, não suposto):
//  - Tudo o que é de projeto e evento exige a permissão `projetos` (o Presidente de teste a tem). Relatório é DOCUMENTO: o Secretário cadastra e envia para revisão, o Presidente aprova.
//  - Projeto Público passa o NOME, a DESCRIÇÃO e o PÚBLICO-ALVO pela conferência de dado pessoal (CPF, RG, e-mail e celular de pessoa); evento Público, o TÍTULO, a DESCRIÇÃO e o LOCAL;
//    a sessão, o TÍTULO (a tela só tem o título; o servidor confere também a descrição); o título da NOVA EDIÇÃO; a descrição (texto alternativo) da FOTO. Recusa = 422 em português, sem gravar.
//  - Só projeto Público pode ser destaque: a tela desliga a caixa; o servidor recusa se alguém burlar a tela (422). Mais de um projeto pode estar em destaque ao mesmo tempo (models/projetos.py).
//  - A "autorização de imagem" da foto é uma DECLARAÇÃO marcada na tela (caixa obrigatória) + o número, opcional, do termo assinado na biblioteca de Documentos (se o número não existe, 404).
//    A tela nem envia sem a caixa; o servidor também recusa (400). Quando entra, a imagem é regravada (app/services/fotos.py::tratar_imagem): sem Exif/GPS, sem comentário.
//  - Relatório ligado a evento ou projeto INTERNO continua na lista pública da Transparência (foi aprovado para isso), mas a API NÃO revela a ligação (`vinculo_*` nulos).
//  - Evento Público ligado a projeto Interno não revela o projeto; evento/projeto Interno responde 404 como se não existisse.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(480_000)

const S = String(RODADA)
const PREFIXO = 'Despertai de Teste (robô v5.4g)'
const PREFIXO_INTERNO = 'Despertai Interno de Teste (robô v5.4g)'
const NOME_PROJETO = `${PREFIXO} ${S}`
const NOME_INTERNO = `${PREFIXO_INTERNO} ${S}`
const EDICAO_1 = `${PREFIXO} ${S} - 1ª edição`
const EDICAO_2 = `${PREFIXO} ${S} - 2ª edição`
const EVENTO_INTERNO = `${PREFIXO_INTERNO} ${S} - evento interno`
const SESSAO = `Roda de leitura ${S}`
const DOC_EVENTO = `${PREFIXO} ${S} - relatório da 1ª edição`
const DOC_PROJETO = `${PREFIXO} ${S} - relatório do projeto`
const DOC_INTERNO = `${PREFIXO_INTERNO} ${S} - relatório do evento interno`

// CPF e e-mail de mentira (o CPF é válido de propósito: o verificador também pega o formatado que não fecha os dígitos, mas este é o pior caso)
const CPF_DE_MENTIRA = '111.444.777-35'
const CPF_MASCARADO = '111.***.***-35'
const EMAIL_DE_MENTIRA = 'fulana.robo@exemplo.com'

const DESCRICAO_DO_PROJETO =
  'Programa inventado pelo robô para conferir o contexto do evento (Despertai de teste), sem dado de pessoa.'
const DESCRICAO_EDITADA =
  'Descrição editada pelo robô: oficinas de leitura e roda de conversa inventadas.'
const DESCRICAO_DO_EVENTO =
  'Edição já realizada do Despertai de teste, inventada pelo robô, sem dado de pessoa.'
const ALT_1 = `Foto inventada do robô ${S}: crianças em roda de leitura`
const ALT_2 = `Segunda foto inventada do robô ${S}: mesa com livros`
const TEXTO_COM_DADO = `Relatorio da edicao. Responsavel: Fulana de Tal, CPF ${CPF_DE_MENTIRA}, e-mail ${EMAIL_DE_MENTIRA}, que coordenou as oficinas.`
const textoDoRelatorio = (quem: string) =>
  `Relatorio do robo ${S} (${quem}) do Despertai de teste. Foram realizadas oficinas de leitura e uma roda de conversa com as familias do bairro. Nao ha dado pessoal neste texto.`

// ------------------------------------------------------------------------------------------------------------------------ datas (fuso de Belém, UTC-3)
type Dia = { iso: string; br: string }

/** O dia daqui a `deslocamentoDias`, no relógio de Belém (UTC-3), que é o do navegador do robô (playwright.hml.config.ts). */
function diaEmBelem(deslocamentoDias: number): Dia {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + deslocamentoDias * 86_400_000))
  const [ano = '', mes = '', dia = ''] = iso.split('-')
  return { iso, br: `${dia}/${mes}/${ano}` }
}

/** Valor de um campo datetime-local (hora LOCAL do navegador). */
const quando = (dia: Dia, hora: string) => `${dia.iso}T${hora}`

// Datas fixadas UMA vez: uma virada de meia-noite no meio da rodada não pode mudar o que se espera ver.
const INICIO_DO_PROJETO = diaEmBelem(-210)
const FIM_DO_PROJETO = diaEmBelem(400)
const DIA_1 = diaEmBelem(-200) // 1ª edição: já aconteceu (tem foto e relatório)
const DIA_2 = diaEmBelem(60) // 2ª edição: a próxima
const DIA_INTERNO = diaEmBelem(20)

// ------------------------------------------------------------------------------------------------------------------------ o que um passo produz e os seguintes usam
let idProjeto = 0
let idInterno = 0
let idEvento1 = 0
let idEvento2 = 0
let idEventoInterno = 0
let idSessao = 0
let idFotoMantida = 0
let idFotoApagada = 0
let idDocEvento = 0
let idDocProjeto = 0
let idDocInterno = 0

function exigir(valor: number, de: string): number {
  if (!valor) {
    throw new Error(
      `falta o resultado de "${de}": o passo anterior do roteiro não passou`,
    )
  }
  return valor
}

// ------------------------------------------------------------------------------------------------------------------------ Auditoria
const TABELAS = [
  'projetos_eventos',
  'eventos',
  'sessoes_evento',
  'documentos_institucionais',
] as const
type Tabela = (typeof TABELAS)[number]
/** O total de cada tabela antes de o roteiro começar, e quantos registros o roteiro DEVE ter criado (cada passo soma o seu, na hora). */
const antes: Record<Tabela, number> = {
  projetos_eventos: 0,
  eventos: 0,
  sessoes_evento: 0,
  documentos_institucionais: 0,
}
const esperado: Record<Tabela, number> = {
  projetos_eventos: 0,
  eventos: 0,
  sessoes_evento: 0,
  documentos_institucionais: 0,
}

/** Abre a Auditoria filtrada por tabela e devolve o total de registros dela (lido da resposta da própria tela). */
async function totalNaAuditoria(page: Page, tabela: Tabela): Promise<number> {
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

/** A linha (mais recente) da Auditoria com a ação e o número do registro. */
function linhaDaAuditoria(page: Page, acao: string, registro: number): Locator {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: acao, exact: true }) })
    .filter({
      has: page.getByRole('cell', { name: String(registro), exact: true }),
    })
    .first()
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

/** Guarda o "Authorization" que o próprio painel manda à API: serve para provar a recusa do SERVIDOR quando a tela já barra. */
async function capturarToken(page: Page): Promise<() => string> {
  let token = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token = cab
  })
  return () => token
}

/** Leitura da API pública de TESTE (sem login). */
async function lerPublico<T>(
  page: Page,
  caminho: string,
  status = 200,
): Promise<T> {
  const r = await page.request.get(`${API_HML}${caminho}`)
  expect(r.status(), `GET ${caminho}`).toBe(status)
  return (await r.json()) as T
}

async function statusPublico(page: Page, caminho: string): Promise<number> {
  return (await page.request.get(`${API_HML}${caminho}`)).status()
}

type Edicao = { id_evento: number; titulo: string; atual?: boolean }
type DocumentoPublico = {
  id_documento: number
  titulo: string
  formato: string
  tipo_codigo: string
  vinculo_tipo: string | null
  vinculo_id: number | null
}
type FotoPublica = {
  id_foto: number
  id_evento?: number
  alt: string
  largura: number
  altura: number
  tamanho: number
  sha256: string
  arquivo: string
}
type ProjetoPublico = {
  id_projeto: number
  nome: string
  descricao: string | null
  publico_alvo: string | null
  destaque: boolean
}
type ProjetoPublicoCompleto = ProjetoPublico & {
  eventos: Edicao[]
  documentos: DocumentoPublico[]
  fotos: FotoPublica[]
}
type EventoPublico = {
  id_evento: number
  titulo: string
  descricao: string | null
  id_projeto: number | null
}
type EventoPublicoCompleto = EventoPublico & {
  projeto: { id_projeto: number; nome: string } | null
  edicoes: Edicao[]
  documentos: DocumentoPublico[]
  fotos: FotoPublica[]
  sessoes: Array<{ titulo: string }>
}

/** Campos de gestão que a API pública NUNCA pode devolver (quem enviou, termo de autorização, nome do arquivo guardado, responsável, centro de custo...). */
const CAMPOS_DE_GESTAO =
  /id_usuario|arquivo_nome|autorizacao_imagem|id_documento_autorizacao|id_associado_responsavel|id_centro_custo|visibilidade|publicar_no_site/

// ------------------------------------------------------------------------------------------------------------------------ a tela de Projetos
const escaparRegex = (texto: string) =>
  texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

const formularioNovoProjeto = (page: Page): Locator =>
  page.locator('form').filter({
    has: page.getByPlaceholder('Foco (ex.: Social, Educacional)'),
  })

const formularioEditarProjeto = (page: Page): Locator =>
  page.getByRole('form', { name: 'Editar projeto' })

const caixaDeDestaque = (escopo: Locator): Locator =>
  escopo.getByRole('checkbox', {
    name: /Mostrar em destaque na página inicial do site/,
  })

async function abrirProjetos(page: Page): Promise<void> {
  await page.goto('/projetos')
  await expect(
    page.getByRole('heading', { name: 'Projetos', level: 1 }),
  ).toBeVisible()
  // enquanto a lista carrega a tela já diz "Nenhum projeto cadastrado": só vale quando chega o primeiro projeto
  await expect(itensDaLista(page).first()).toBeVisible()
}

/** Abre o projeto pelo endereço `/projetos?projeto=N` (o mesmo que os outros módulos usam para apontar para ele). */
async function abrirProjeto(
  page: Page,
  id: number,
  nome: string,
): Promise<Locator> {
  await page.goto(`/projetos?projeto=${id}`)
  await expect(
    page.getByRole('heading', { name: 'Projetos', level: 1 }),
  ).toBeVisible()
  const detalhe = detalheDoProjeto(page, nome)
  await expect(detalhe).toBeVisible()
  return detalhe
}

async function abrirEdicaoDoProjeto(
  page: Page,
  detalhe: Locator,
): Promise<Locator> {
  await detalhe.getByRole('button', { name: 'Editar projeto' }).click()
  const editar = formularioEditarProjeto(page)
  await expect(editar).toBeVisible()
  return editar
}

/** Salva o formulário "Editar projeto" e devolve a resposta do servidor. */
async function salvarProjeto(page: Page, editar: Locator): Promise<Resposta> {
  const [resposta] = await Promise.all([
    esperarResposta(page, 'PUT', /^\/api\/projetos\/\d+$/),
    editar.getByRole('button', { name: 'Salvar alterações' }).click(),
  ])
  return resposta
}

type DadosDoProjeto = {
  nome: string
  descricao: string
  publicoAlvo?: string
  publica: boolean
  destaque?: boolean
}

async function preencherNovoProjeto(
  form: Locator,
  d: DadosDoProjeto,
): Promise<void> {
  await form.getByLabel('Nome do projeto', { exact: true }).fill(d.nome)
  await form.getByLabel('Foco do projeto', { exact: true }).fill('Social')
  await form
    .getByLabel('Tipo de projeto', { exact: true })
    .selectOption({ label: 'Educacional' })
  await form
    .getByLabel('Data de início', { exact: true })
    .fill(INICIO_DO_PROJETO.iso)
  await form
    .getByLabel('Data de fim prevista', { exact: true })
    .fill(FIM_DO_PROJETO.iso)
  await form
    .getByLabel('Público-alvo', { exact: true })
    .fill(d.publicoAlvo ?? 'Crianças e famílias do bairro de teste')
  await form.getByLabel('Descrição', { exact: true }).fill(d.descricao)
  await form
    .getByLabel('Quem pode ver o projeto', { exact: true })
    .selectOption(d.publica ? 'Pública' : 'Interna')
  if (d.destaque) await caixaDeDestaque(form).check()
}

// ------------------------------------------------------------------------------------------------------------------------ a tela de Eventos
const formularioDeEvento = (page: Page): Locator =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: 'Criar evento' }),
  })

const cartaoDoEvento = (page: Page, titulo: string): Locator =>
  page.locator('div[role="button"]').filter({ hasText: titulo })

const detalheDoEvento = (page: Page, titulo: string): Locator =>
  page
    .locator('div.rounded-xl')
    .filter({
      has: page.getByRole('heading', { name: titulo, level: 2, exact: true }),
    })
    .last()

const contextoDoEvento = (page: Page): Locator =>
  page.getByRole('region', { name: 'Contexto do evento' })

const contextoDoProjeto = (page: Page): Locator =>
  page.getByRole('region', { name: 'Contexto do projeto' })

/** Cada bloco do detalhe do evento (Programação, Edições...) é um <div> com um <h3>; devolve o bloco do título. */
const secaoDe = (detalhe: Locator, titulo: string): Locator =>
  detalhe
    .locator('div')
    .filter({
      has: detalhe
        .page()
        .getByRole('heading', { name: titulo, level: 3, exact: true }),
    })
    .first()

async function abrirFormularioDeEvento(page: Page): Promise<Locator> {
  const form = formularioDeEvento(page)
  if ((await form.count()) === 0) {
    await page.getByRole('button', { name: 'Novo evento', exact: true }).click()
  }
  await expect(form).toBeVisible()
  return form
}

type DadosDoEvento = {
  titulo: string
  inicio: string
  fim?: string
  publico: boolean
  descricao: string
  endereco?: string
}

/** Preenche TODOS os campos que o roteiro usa (o formulário recusado guarda o que ficou, então o que muda tem de ser dito de novo). */
async function preencherEvento(form: Locator, d: DadosDoEvento): Promise<void> {
  await form.getByLabel('Título do evento').fill(d.titulo)
  await form
    .getByLabel('Categoria do evento')
    .selectOption({ label: 'Palestra' })
  await form
    .getByLabel('Quem pode ver o evento')
    .selectOption(d.publico ? 'Pública' : 'Interna')
  await form
    .locator('label', { hasText: 'Início' })
    .locator('input')
    .fill(d.inicio)
  await form
    .locator('label', { hasText: 'Fim (opcional)' })
    .locator('input')
    .fill(d.fim ?? '')
  await form.getByLabel('Endereço avulso').fill(d.endereco ?? '')
  await form.getByLabel('Descrição').fill(d.descricao)
  const projeto = form
    .locator('label', { hasText: 'Projeto (opcional)' })
    .locator('select')
  await expect(
    projeto.locator('option', { hasText: NOME_PROJETO }),
  ).toBeAttached()
  await escolherPorTexto(projeto, NOME_PROJETO)
}

function enviarEvento(page: Page, form: Locator): Promise<Resposta> {
  return Promise.all([
    esperarResposta(page, 'POST', /^\/api\/eventos\/$/),
    form.getByRole('button', { name: 'Criar evento' }).click(),
  ]).then(([resposta]) => resposta)
}

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

// ------------------------------------------------------------------------------------------------------------------------ a tela de Documentos
const secaoPublica = (page: Page) =>
  page.getByRole('region', { name: 'Versão pública (a que pode ir ao site)' })
const resultadoDaConferencia = (page: Page) =>
  page.getByRole('region', {
    name: 'Resultado da conferência da versão pública',
  })

/** O Secretário cadastra o relatório (tipo "Relatório de evento ou de projeto") ligado a um evento ou projeto pelo número; devolve o número do documento. */
async function cadastrarRelatorio(
  page: Page,
  d: { titulo: string; vinculo: 'evento' | 'projeto'; numero: number },
): Promise<number> {
  await page.goto('/documentos/novo')
  await expect(
    page.getByRole('heading', { name: 'Novo documento', level: 1 }),
  ).toBeVisible()
  const tipo = page.getByLabel('Tipo de documento')
  await expect(tipo.locator('option[value="RELATORIO_EVENTO"]')).toBeAttached()
  await tipo.selectOption('RELATORIO_EVENTO')
  await page.getByLabel('Título').fill(d.titulo)
  await page.getByLabel(/^Pertence a/).selectOption(d.vinculo)
  await page.getByLabel(/^Número/).fill(String(d.numero))
  await expect(
    page.getByText(`Este documento pertence ao ${d.vinculo} nº ${d.numero}.`),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cadastrar documento' }).click()
  await expect(page).toHaveURL(/\/documentos\/\d+$/)
  await expect(
    page.getByRole('heading', { name: d.titulo, level: 1 }),
  ).toBeVisible()
  return Number(/\/documentos\/(\d+)$/.exec(page.url())?.[1])
}

async function colarTexto(page: Page, texto: string): Promise<void> {
  await secaoPublica(page)
    .getByLabel('Ou cole o texto da versão pública')
    .fill(texto)
  await secaoPublica(page)
    .getByRole('button', { name: 'Enviar o texto e conferir' })
    .click()
}

/** Versão pública em TEXTO limpa e envio para a revisão de outra pessoa. */
async function prepararParaRevisao(page: Page, texto: string): Promise<void> {
  await colarTexto(page, texto)
  await expect(secaoPublica(page)).toContainText(
    'Versão pública aceita (texto de',
  )
  await page.getByRole('button', { name: 'Enviar para revisão' }).click()
  await expect(
    page.getByText(
      'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).',
    ),
  ).toBeVisible()
}

async function aprovar(page: Page, id: number): Promise<void> {
  await page.goto(`/documentos/${id}`)
  await page.getByRole('button', { name: 'Aprovar a publicação' }).click()
  await page.getByRole('button', { name: 'Confirmar aprovação' }).click()
  await expect(
    page.getByText('Publicado no site de transparência.'),
  ).toBeVisible()
  esperado.documentos_institucionais += 1 // APROVADO
}

// =====================================================================================================================================
test('o Presidente cria o projeto Despertai de teste (Público, em destaque): dado pessoal no texto público é barrado sem gravar nada, e o certo entra na lista e na API pública', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  for (const tabela of TABELAS)
    antes[tabela] = await totalNaAuditoria(page, tabela)

  // os destaques que já existem (de outras rodadas e o da carga inicial): o novo NÃO pode tirar nenhum deles
  const publicosAntes = await lerPublico<ProjetoPublico[]>(
    page,
    '/api/publico/projetos',
  )
  const destaquesAntes = publicosAntes
    .filter((p) => p.destaque)
    .map((p) => p.id_projeto)

  await abrirProjetos(page)
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click()
  const form = formularioNovoProjeto(page)
  await expect(form).toBeVisible()
  // projeto Interno nunca fica em destaque: a caixa nasce desligada e só liga ao escolher Pública
  await expect(caixaDeDestaque(form)).toBeDisabled()
  await expect(
    form.getByText(/Só projeto Público pode ficar em destaque/),
  ).toBeVisible()
  const criar = form.getByRole('button', { name: 'Criar projeto', exact: true })
  const enviar = (): Promise<Resposta> =>
    Promise.all([
      esperarResposta(page, 'POST', /^\/projetos\/$/),
      criar.click(),
    ]).then(([resposta]) => resposta)

  // recusa 1: CPF e e-mail de pessoa na descrição (o texto vai ao site)
  await preencherNovoProjeto(form, {
    nome: NOME_PROJETO,
    descricao: `Fale com Fulana, CPF ${CPF_DE_MENTIRA}, ou escreva para ${EMAIL_DE_MENTIRA}.`,
    publica: true,
    destaque: true,
  })
  await expect(caixaDeDestaque(form)).toBeChecked()
  expect((await enviar()).status()).toBe(422)
  const barrouDescricao = form.getByRole('alert').filter({
    hasText: /campo 'descrição' vai ao site e parece conter dado pessoal/,
  })
  await expect(barrouDescricao).toBeVisible()
  // a mensagem diz o que achou, mas MASCARADO: o CPF inteiro não volta para a tela
  await expect(barrouDescricao).toContainText(`CPF: ${CPF_MASCARADO}`)
  await expect(barrouDescricao).not.toContainText(CPF_DE_MENTIRA)
  await expect(itemDoProjeto(page, NOME_PROJETO)).toHaveCount(0)
  await ver(page, info, 'projeto Publico com CPF na descricao: recusado')

  // recusa 2: e-mail de pessoa no público-alvo
  await form.getByLabel('Descrição', { exact: true }).fill(DESCRICAO_DO_PROJETO)
  await form
    .getByLabel('Público-alvo', { exact: true })
    .fill(`Contato: ${EMAIL_DE_MENTIRA}`)
  expect((await enviar()).status()).toBe(422)
  const barrouPublicoAlvo = form.getByRole('alert').filter({
    hasText: /campo 'público-alvo' vai ao site e parece conter dado pessoal/,
  })
  await expect(barrouPublicoAlvo).toContainText('e-mail que não é da ASAF')
  await expect(barrouPublicoAlvo).not.toContainText(EMAIL_DE_MENTIRA)
  await expect(itemDoProjeto(page, NOME_PROJETO)).toHaveCount(0)

  // o certo
  await form
    .getByLabel('Público-alvo', { exact: true })
    .fill('Crianças e famílias do bairro de teste')
  const resposta = await enviar()
  expect(resposta.status()).toBe(200)
  idProjeto = ((await resposta.json()) as { id_projeto: number }).id_projeto
  esperado.projetos_eventos += 1
  await expect(form).toHaveCount(0) // o formulário se fecha sozinho
  // as duas recusas não deixaram projeto: só UM com este nome
  const item = itemDoProjeto(page, NOME_PROJETO)
  await expect(item).toHaveCount(1)
  await expect(item).toContainText(`nº ${idProjeto}`)
  await expect(item.getByText('Público', { exact: true })).toBeVisible()
  await expect(
    item.getByText('Em destaque no site', { exact: true }),
  ).toBeVisible()
  await ver(page, info, 'Despertai de teste criado: Publico e em destaque')

  // a API pública (o que o site lê): o projeto, em destaque, com o texto certo
  const publicos = await lerPublico<ProjetoPublico[]>(
    page,
    '/api/publico/projetos',
  )
  const meu = publicos.find((p) => p.id_projeto === idProjeto)
  expect(meu?.nome).toBe(NOME_PROJETO)
  expect(meu?.destaque).toBe(true)
  expect(meu?.descricao).toBe(DESCRICAO_DO_PROJETO)
  expect(JSON.stringify(publicos)).not.toContain(CPF_DE_MENTIRA)
  expect(JSON.stringify(publicos)).not.toContain(EMAIL_DE_MENTIRA)
  // vários destaques convivem: o novo não substituiu nenhum dos anteriores
  for (const anterior of destaquesAntes) {
    expect(
      publicos.find((p) => p.id_projeto === anterior)?.destaque,
      `o projeto nº ${anterior}, que já estava em destaque, continua em destaque`,
    ).toBe(true)
  }
  const totalDestaques = publicos.filter((p) => p.destaque).length
  info.annotations.push({
    type: 'destaques',
    description: `${totalDestaques} projeto(s) em destaque ao mesmo tempo (${destaquesAntes.length} anteriores + o desta rodada): o sistema NÃO limita a um e o novo NÃO substitui o anterior`,
  })
  expect(vigia.problemas()).toEqual([])
})

test('editar o projeto: dado pessoal no texto público é barrado; destaque em projeto Interno é recusado (a tela desliga a caixa e o servidor recusa com a mensagem); vários destaques convivem; voltar a Interno tira do site', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  const id = exigir(idProjeto, 'criar o projeto Despertai')
  await entrar(page, 'presidente')

  // ---- editar o projeto Público
  const detalhe = await abrirProjeto(page, id, NOME_PROJETO)
  const editar = await abrirEdicaoDoProjeto(page, detalhe)
  await expect(editar.getByLabel('Nome do projeto')).toHaveValue(NOME_PROJETO)
  await expect(editar.getByLabel('Quem pode ver o projeto')).toHaveValue(
    'Pública',
  )
  await expect(caixaDeDestaque(editar)).toBeChecked()
  await editar
    .getByLabel('Descrição (opcional)')
    .fill(`Contato: Fulana, CPF ${CPF_DE_MENTIRA}`)
  const cpf = await salvarProjeto(page, editar)
  expect(cpf.status()).toBe(422)
  const alertaCpf = editar.getByRole('alert').filter({
    hasText: /campo 'descrição' vai ao site e parece conter dado pessoal/,
  })
  await expect(alertaCpf).toContainText(`CPF: ${CPF_MASCARADO}`)
  await expect(alertaCpf).not.toContainText(CPF_DE_MENTIRA)
  await editar.getByLabel('Descrição (opcional)').fill(DESCRICAO_EDITADA)
  await editar
    .getByLabel('Público-alvo (opcional)')
    .fill(`Escreva para ${EMAIL_DE_MENTIRA}`)
  expect((await salvarProjeto(page, editar)).status()).toBe(422)
  await expect(
    editar.getByRole('alert').filter({
      hasText: /campo 'público-alvo' vai ao site e parece conter dado pessoal/,
    }),
  ).toContainText('e-mail que não é da ASAF')
  await ver(page, info, 'editar projeto Publico com dado pessoal: recusado')

  // desistir não grava nada
  await editar.getByRole('button', { name: 'Cancelar' }).click()
  await expect(formularioEditarProjeto(page)).toHaveCount(0)
  await expect(detalhe).not.toContainText(CPF_DE_MENTIRA)
  await expect(detalhe).not.toContainText(EMAIL_DE_MENTIRA)
  expect(
    (await lerPublico<ProjetoPublico[]>(page, '/api/publico/projetos')).find(
      (p) => p.id_projeto === id,
    )?.descricao,
    'a descrição recusada não foi gravada',
  ).toBe(DESCRICAO_DO_PROJETO)

  // o certo (o NOME fica: é por ele que o roteiro do site acha o projeto)
  const editar2 = await abrirEdicaoDoProjeto(page, detalhe)
  await editar2.getByLabel('Descrição (opcional)').fill(DESCRICAO_EDITADA)
  await editar2
    .getByLabel('Público-alvo (opcional)')
    .fill('Crianças, adolescentes e famílias do bairro de teste')
  expect((await salvarProjeto(page, editar2)).status()).toBe(200)
  esperado.projetos_eventos += 1
  await expect(formularioEditarProjeto(page)).toHaveCount(0)
  const recarregado = await abrirProjeto(page, id, NOME_PROJETO)
  await expect(recarregado).toContainText(DESCRICAO_EDITADA)
  await expect(recarregado).toContainText(
    'Público-alvo: Crianças, adolescentes e famílias do bairro de teste',
  )
  await expect(
    itemDoProjeto(page, NOME_PROJETO).getByText('Em destaque no site'),
  ).toBeVisible()
  await ver(page, info, 'projeto editado, depois de recarregar')
  const publicado = (
    await lerPublico<ProjetoPublico[]>(page, '/api/publico/projetos')
  ).find((p) => p.id_projeto === id)
  expect(publicado?.descricao).toBe(DESCRICAO_EDITADA)
  expect(publicado?.destaque).toBe(true)

  // ---- projeto Interno: nunca em destaque
  await abrirProjetos(page)
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click()
  const form = formularioNovoProjeto(page)
  await preencherNovoProjeto(form, {
    nome: NOME_INTERNO,
    descricao: 'Projeto interno inventado pelo robô, só da associação.',
    publica: false,
  })
  await expect(caixaDeDestaque(form)).toBeDisabled()
  const [criado] = await Promise.all([
    esperarResposta(page, 'POST', /^\/projetos\/$/),
    form.getByRole('button', { name: 'Criar projeto', exact: true }).click(),
  ])
  expect(criado.status()).toBe(200)
  idInterno = ((await criado.json()) as { id_projeto: number }).id_projeto
  esperado.projetos_eventos += 1
  const itemInterno = itemDoProjeto(page, NOME_INTERNO)
  await expect(itemInterno.getByText('Interno', { exact: true })).toBeVisible()
  await expect(itemInterno.getByText('Em destaque no site')).toHaveCount(0)

  // a tela não deixa marcar; se alguém burlar a tela, é o SERVIDOR que recusa, com a mensagem (a edição e a criação)
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const cabecalhos = {
    Authorization: token(),
    'Content-Type': 'application/json',
  }
  const mensagemDoDestaque =
    'Só um projeto Público pode ficar em destaque no site'
  const naEdicao = await page.request.fetch(
    `${API_HML}/api/projetos/${idInterno}`,
    {
      method: 'PUT',
      headers: cabecalhos,
      data: JSON.stringify({ destaque_no_site: true }),
    },
  )
  expect(naEdicao.status()).toBe(422)
  expect(((await naEdicao.json()) as { detail: string }).detail).toContain(
    mensagemDoDestaque,
  )
  const nomeDaBurla = `${NOME_INTERNO} (destaque indevido)`
  const naCriacao = await page.request.fetch(`${API_HML}/projetos/`, {
    method: 'POST',
    headers: cabecalhos,
    data: JSON.stringify({
      nome_projeto: nomeDaBurla,
      tipo_foco: 'Social',
      necessita_alvara_bombeiros: false,
      data_inicio: `${INICIO_DO_PROJETO.iso}T00:00:00`,
      data_fim_prevista: `${FIM_DO_PROJETO.iso}T00:00:00`,
      visibilidade: 'Interna',
      destaque_no_site: true,
    }),
  })
  expect(naCriacao.status()).toBe(422)
  expect(((await naCriacao.json()) as { detail: string }).detail).toContain(
    mensagemDoDestaque,
  )
  const todos = await page.request.get(`${API_HML}/api/projetos/`, {
    headers: { Authorization: token() },
  })
  expect(
    ((await todos.json()) as Array<{ nome_projeto: string }>).some(
      (p) => p.nome_projeto === nomeDaBurla,
    ),
    'o projeto recusado não foi gravado',
  ).toBe(false)
  await abrirProjetos(page)
  await expect(
    itemDoProjeto(page, NOME_INTERNO).getByText('Em destaque no site'),
  ).toHaveCount(0)
  expect(await statusPublico(page, `/api/publico/projetos/${idInterno}`)).toBe(
    404,
  )
  await ver(page, info, 'projeto Interno: destaque recusado pelo servidor')

  // o projeto Interno só fica Público por alguns passos: se algo falhar no meio, ele volta a Interno (é o controle negativo do roteiro do site)
  let voltouAInterno = false
  try {
    // ---- vários destaques ao mesmo tempo: o Interno vira Público e em destaque pela tela; o Despertai continua em destaque
    const detalheInterno = await abrirProjeto(page, idInterno, NOME_INTERNO)
    const editarInterno = await abrirEdicaoDoProjeto(page, detalheInterno)
    await expect(caixaDeDestaque(editarInterno)).toBeDisabled()
    await editarInterno
      .getByLabel('Quem pode ver o projeto')
      .selectOption('Pública')
    await expect(caixaDeDestaque(editarInterno)).toBeEnabled()
    await caixaDeDestaque(editarInterno).check()
    expect((await salvarProjeto(page, editarInterno)).status()).toBe(200)
    esperado.projetos_eventos += 1
    const doisDestaques = await lerPublico<ProjetoPublico[]>(
      page,
      '/api/publico/projetos',
    )
    expect(doisDestaques.find((p) => p.id_projeto === id)?.destaque).toBe(true)
    expect(
      doisDestaques.find((p) => p.id_projeto === idInterno)?.destaque,
    ).toBe(true)
    await expect(
      itemDoProjeto(page, NOME_PROJETO).getByText('Em destaque no site'),
    ).toBeVisible()
    await expect(
      itemDoProjeto(page, NOME_INTERNO).getByText('Em destaque no site'),
    ).toBeVisible()
    await ver(page, info, 'dois projetos em destaque ao mesmo tempo')

    // ---- voltar a Interno: o destaque se desmarca sozinho e o projeto sai do site (o Despertai fica como estava)
    const detalheDeNovo = await abrirProjeto(page, idInterno, NOME_INTERNO)
    const editarDeNovo = await abrirEdicaoDoProjeto(page, detalheDeNovo)
    await editarDeNovo
      .getByLabel('Quem pode ver o projeto')
      .selectOption('Interna')
    await expect(caixaDeDestaque(editarDeNovo)).not.toBeChecked()
    await expect(caixaDeDestaque(editarDeNovo)).toBeDisabled()
    expect((await salvarProjeto(page, editarDeNovo)).status()).toBe(200)
    esperado.projetos_eventos += 1
    voltouAInterno = true
    const depois = await lerPublico<ProjetoPublico[]>(
      page,
      '/api/publico/projetos',
    )
    expect(depois.some((p) => p.id_projeto === idInterno)).toBe(false)
    expect(depois.find((p) => p.id_projeto === id)?.destaque).toBe(true)
    expect(
      await statusPublico(page, `/api/publico/projetos/${idInterno}`),
    ).toBe(404)
  } finally {
    if (!voltouAInterno) {
      await page.request.fetch(`${API_HML}/api/projetos/${idInterno}`, {
        method: 'PUT',
        headers: { Authorization: token(), 'Content-Type': 'application/json' },
        data: JSON.stringify({
          visibilidade: 'Interna',
          destaque_no_site: false,
        }),
      })
    }
  }
  expect(vigia.problemas()).toEqual([])
})

test('a 1ª edição entra como evento Público ligado ao projeto: dado pessoal na descrição é barrado sem gravar; o contexto mostra o projeto, o número e o atalho do relatório', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const projeto = exigir(idProjeto, 'criar o projeto Despertai')
  await entrar(page, 'presidente')
  await page.goto('/eventos')
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  const form = await abrirFormularioDeEvento(page)
  const dados: DadosDoEvento = {
    titulo: EDICAO_1,
    inicio: quando(DIA_1, '09:00'),
    fim: quando(DIA_1, '17:00'),
    endereco: 'Salão de teste, Parauapebas',
    publico: true,
    descricao: `Contato: Fulana, CPF ${CPF_DE_MENTIRA}, ou ${EMAIL_DE_MENTIRA}.`,
  }

  // recusa: evento Público com CPF e e-mail na descrição
  await preencherEvento(form, dados)
  const recusado = await enviarEvento(page, form)
  expect(recusado.status()).toBe(422)
  const alerta = form.getByRole('alert').filter({
    hasText: /campo 'descrição' vai ao site e parece conter dado pessoal/,
  })
  await expect(alerta).toContainText(`CPF: ${CPF_MASCARADO}`)
  await expect(alerta).not.toContainText(CPF_DE_MENTIRA)
  await expect(cartaoDoEvento(page, EDICAO_1)).toHaveCount(0)
  await ver(page, info, 'evento Publico com CPF na descricao: recusado')

  // o certo: a mesma edição, sem o dado pessoal
  await preencherEvento(form, { ...dados, descricao: DESCRICAO_DO_EVENTO })
  const resposta = await enviarEvento(page, form)
  expect(resposta.status()).toBe(200)
  idEvento1 = ((await resposta.json()) as { id_evento: number }).id_evento
  esperado.eventos += 1
  await expect(form).toHaveCount(0)
  // a recusa não deixou evento: só UM com este título
  const cartao = cartaoDoEvento(page, EDICAO_1)
  await expect(cartao).toHaveCount(1)
  await expect(cartao).toContainText(`nº ${idEvento1}`)
  await expect(cartao).toContainText('Pública')

  // o detalhe: o número e o projeto de origem, e o que o contexto oferece
  const detalhe = await abrirEvento(page, idEvento1, EDICAO_1)
  await expect(detalhe).toContainText(`Nº do evento: ${idEvento1}`)
  const contexto = contextoDoEvento(page)
  await expect(contexto).toContainText(`O número deste evento é ${idEvento1}.`)
  await expect(contexto).toContainText(
    `Faz parte do projeto ${NOME_PROJETO} (nº ${projeto}).`,
  )
  await expect(contexto).toContainText(
    `Este evento e o projeto são Públicos: ele aparece na página do projeto “${NOME_PROJETO}” no site.`,
  )
  await expect(contexto).toContainText(
    'Nenhum relatório ou documento ligado a este evento ainda.',
  )
  await expect(contexto).toContainText('Nenhuma foto.')
  await expect(contexto).toContainText('Número do evento')
  await ver(page, info, '1a edicao: contexto do evento')

  // o atalho "Novo relatório deste evento" abre o cadastro de documento já com o tipo e o vínculo
  const atalho = contexto.getByRole('link', {
    name: /Novo relatório deste evento/,
  })
  await expect(atalho).toHaveAttribute(
    'href',
    `/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=evento&vinculo_id=${idEvento1}`,
  )
  await atalho.click()
  await expect(
    page.getByRole('heading', { name: 'Novo documento', level: 1 }),
  ).toBeVisible()
  await expect(page.getByLabel('Tipo de documento')).toHaveValue(
    'RELATORIO_EVENTO',
  )
  await expect(page.getByLabel(/^Pertence a/)).toHaveValue('evento')
  await expect(page.getByLabel(/^Número/)).toHaveValue(String(idEvento1))
  await expect(
    page.getByText(`Este documento pertence ao evento nº ${idEvento1}.`),
  ).toBeVisible()
  await ver(page, info, 'novo relatorio ja ligado ao evento')
  expect(vigia.problemas()).toEqual([])
})

test('a nova edição segue no mesmo projeto; dado pessoal no título da nova edição e no da sessão é barrado; um evento Interno também se liga ao projeto, e o contexto do projeto lista tudo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const projeto = exigir(idProjeto, 'criar o projeto Despertai')
  const ev1 = exigir(idEvento1, 'criar a 1ª edição')
  await entrar(page, 'presidente')

  // ---- nova edição (a 2ª), a partir da 1ª
  const detalhe = await abrirEvento(page, ev1, EDICAO_1)
  const edicoes = secaoDe(detalhe, 'Edições recorrentes (ligadas entre si)')
  await edicoes.getByRole('button', { name: 'Criar nova edição' }).click()
  const formEdicao = edicoes.locator('form')
  await formEdicao
    .locator('input[type="datetime-local"]')
    .fill(quando(DIA_2, '09:00'))
  const tituloDaEdicao = formEdicao.getByPlaceholder(
    'Título da nova edição (opcional)',
  )
  const criarEdicao = formEdicao.getByRole('button', {
    name: 'Criar',
    exact: true,
  })
  await tituloDaEdicao.fill(`Edição de ${CPF_DE_MENTIRA}`)
  const [barrada] = await Promise.all([
    esperarResposta(page, 'POST', /\/api\/eventos\/\d+\/nova-edicao$/),
    criarEdicao.click(),
  ])
  expect(barrada.status()).toBe(422)
  const alertaEdicao = formEdicao.getByRole('alert').filter({
    hasText:
      /campo 'título da nova edição' vai ao site e parece conter dado pessoal/,
  })
  await expect(alertaEdicao).toContainText(`CPF: ${CPF_MASCARADO}`)
  await tituloDaEdicao.fill(EDICAO_2)
  const [novaEdicao] = await Promise.all([
    esperarResposta(page, 'POST', /\/api\/eventos\/\d+\/nova-edicao$/),
    criarEdicao.click(),
  ])
  expect(novaEdicao.status()).toBe(200)
  idEvento2 = ((await novaEdicao.json()) as { id_evento: number }).id_evento
  esperado.eventos += 1
  await expect(formEdicao).toHaveCount(0)
  const cartoesDasEdicoes = edicoes.locator('div.rounded-md.border.p-2')
  await expect(cartoesDasEdicoes.filter({ hasText: EDICAO_1 })).toContainText(
    '(esta edição)',
  )
  await expect(cartoesDasEdicoes.filter({ hasText: EDICAO_2 })).toContainText(
    DIA_2.br,
  )
  await expect(cartaoDoEvento(page, EDICAO_2)).toHaveCount(1)
  await ver(page, info, 'nova edicao criada na cadeia de edicoes')

  // a 2ª edição abre no mesmo projeto e Pública (herdou da 1ª)
  const detalhe2 = await abrirEvento(page, idEvento2, EDICAO_2)
  await expect(detalhe2).toContainText('Pública')
  await expect(contextoDoEvento(page)).toContainText(
    `Faz parte do projeto ${NOME_PROJETO} (nº ${projeto}).`,
  )
  await expect(contextoDoEvento(page)).toContainText(
    `Este evento e o projeto são Públicos`,
  )

  // ---- sessão da 1ª edição: o título vai ao site, então passa pela conferência
  const detalheUm = await abrirEvento(page, ev1, EDICAO_1)
  const programacao = secaoDe(detalheUm, 'Programação (sessões/atividades)')
  const formSessao = programacao.locator('form').filter({
    has: page.getByPlaceholder('Título da sessão'),
  })
  const adicionarSessao = async (titulo: string): Promise<Resposta> => {
    await formSessao.getByPlaceholder('Título da sessão').fill(titulo)
    const datas = formSessao.locator('input[type="datetime-local"]')
    await datas.nth(0).fill(quando(DIA_1, '10:00'))
    await datas.nth(1).fill(quando(DIA_1, '11:00'))
    const [resposta] = await Promise.all([
      esperarResposta(page, 'POST', /\/api\/eventos\/\d+\/sessoes$/),
      formSessao
        .getByRole('button', { name: 'Adicionar', exact: true })
        .click(),
    ])
    return resposta
  }
  const sessaoComCpf = await adicionarSessao(`Oficina de ${CPF_DE_MENTIRA}`)
  expect(sessaoComCpf.status()).toBe(422)
  await expect(
    formSessao.getByRole('alert').filter({
      hasText:
        /campo 'título da sessão' vai ao site e parece conter dado pessoal/,
    }),
  ).toContainText(`CPF: ${CPF_MASCARADO}`)
  await expect(programacao.locator('div.rounded-md.border.p-2')).toHaveCount(0)
  const sessaoLimpa = await adicionarSessao(SESSAO)
  expect(sessaoLimpa.status()).toBe(200)
  idSessao = ((await sessaoLimpa.json()) as { id_sessao: number }).id_sessao
  esperado.sessoes_evento += 1
  await expect(
    programacao
      .locator('div.rounded-md.border.p-2')
      .filter({ hasText: SESSAO }),
  ).toHaveCount(1)
  await ver(page, info, 'sessao da 1a edicao: CPF barrado, titulo limpo aceito')

  // ---- evento Interno ligado ao mesmo projeto: nunca vai ao site
  await page.goto('/eventos')
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  const form = await abrirFormularioDeEvento(page)
  await preencherEvento(form, {
    titulo: EVENTO_INTERNO,
    inicio: quando(DIA_INTERNO, '19:00'),
    publico: false,
    descricao: 'Reunião interna de preparação, inventada pelo robô.',
  })
  const interno = await enviarEvento(page, form)
  expect(interno.status()).toBe(200)
  idEventoInterno = ((await interno.json()) as { id_evento: number }).id_evento
  esperado.eventos += 1
  const cartaoInterno = cartaoDoEvento(page, EVENTO_INTERNO)
  await expect(cartaoInterno).toContainText('Interna')
  await abrirEvento(page, idEventoInterno, EVENTO_INTERNO)
  await expect(contextoDoEvento(page)).toContainText(
    'Este evento é Interno: ele não aparece no site, nem na página do projeto.',
  )
  await ver(page, info, 'evento Interno ligado ao projeto')

  // ---- o contexto do projeto lista as edições (e o evento Interno, marcado como Interno)
  await abrirProjeto(page, projeto, NOME_PROJETO)
  const contexto = contextoDoProjeto(page)
  await expect(contexto).toContainText(
    'Este projeto é Público e está em destaque na página inicial do site.',
  )
  for (const [titulo, id, rotulo] of [
    [EDICAO_1, ev1, 'Público'],
    [EDICAO_2, idEvento2, 'Público'],
    [EVENTO_INTERNO, idEventoInterno, 'Interno'],
  ] as const) {
    const link = contexto.getByRole('link', { name: titulo, exact: true })
    await expect(link).toHaveAttribute('href', `/eventos?evento=${id}`)
    await expect(contexto.locator('li').filter({ has: link })).toContainText(
      `nº ${id} ·`,
    )
    await expect(contexto.locator('li').filter({ has: link })).toContainText(
      rotulo,
    )
  }
  await ver(page, info, 'contexto do projeto: edicoes e evento Interno')
  expect(vigia.problemas()).toEqual([])
})

test('fotos do evento: sem a autorização de imagem a foto é recusada (pela tela e pelo servidor) e não vai ao público; com ela entra, a imagem é regravada sem GPS nem comentário e o público a recebe; apagar retira do público', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  const ev1 = exigir(idEvento1, 'criar a 1ª edição')
  let envios = 0
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      /^\/api\/eventos\/\d+\/fotos$/.test(new URL(r.url()).pathname)
    )
      envios += 1
  })
  await entrar(page, 'presidente')
  await abrirEvento(page, ev1, EDICAO_1)
  const contexto = contextoDoEvento(page)
  const arquivo = contexto.locator('input[type="file"]')
  const campoDaDescricao = contexto.getByLabel(
    'Descrição da foto (para quem não enxerga)',
  )
  const caixaDeAutorizacao = contexto.getByRole('checkbox', {
    name: /Há autorização de uso de imagem/,
  })
  const campoDoTermo = contexto.getByLabel(
    'Nº do documento do termo de autorização (opcional)',
  )
  const botaoEnviar = contexto.getByRole('button', {
    name: 'Enviar a foto',
    exact: true,
  })
  const alertas = contexto.getByRole('alert')
  const enviarFoto = (): Promise<Resposta> =>
    Promise.all([
      esperarResposta(page, 'POST', /^\/api\/eventos\/\d+\/fotos$/),
      botaoEnviar.click(),
    ]).then(([resposta]) => resposta)

  // a foto de teste TEM metadado escondido (aparelho, GPS e comentário): é isso que o servidor tem de tirar
  const original = jpegComLocalizacao()
  expect(metadadosDoJpeg(original)).toHaveLength(2)
  expect(original.includes(APARELHO_ESCONDIDO)).toBe(true)
  expect(original.includes(COMENTARIO_ESCONDIDO)).toBe(true)
  const foto = { name: 'foto-com-gps.jpg', mimeType: 'image/jpeg' }

  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const doPainel = async () => {
    const r = await page.request.get(`${API_HML}/api/eventos/${ev1}/fotos`, {
      headers: { Authorization: token() },
    })
    expect(r.status()).toBe(200)
    return (await r.json()) as Array<{
      id_foto: number
      alt: string
      autorizacao_imagem: boolean
      id_documento_autorizacao: number | null
      tamanho: number
      largura: number
      altura: number
    }>
  }

  // ---- 1. sem a autorização: a tela recusa e nem envia
  await arquivo.setInputFiles({ ...foto, buffer: original })
  await campoDaDescricao.fill(ALT_1)
  await botaoEnviar.click()
  await expect(
    alertas.filter({
      hasText:
        'Confirme a autorização de uso de imagem: sem ela a foto não é aceita.',
    }),
  ).toBeVisible()
  expect(envios, 'a tela não pode mandar a foto sem a autorização').toBe(0)
  await ver(page, info, 'foto sem autorizacao de imagem: a tela recusa')

  // ... e o SERVIDOR também recusa, se alguém burlar a tela
  const semAutorizacao = await page.request.fetch(
    `${API_HML}/api/eventos/${ev1}/fotos`,
    {
      method: 'POST',
      headers: { Authorization: token() },
      multipart: {
        arquivo: { ...foto, buffer: original },
        alt: ALT_1,
        autorizacao_imagem: 'false',
      },
    },
  )
  expect(semAutorizacao.status()).toBe(400)
  expect(
    ((await semAutorizacao.json()) as { detail: string }).detail,
  ).toContain('Sem a autorização de uso de imagem a foto não é aceita')

  // ---- 2. com a autorização, mas a descrição (texto alternativo) traz dado pessoal: barrada
  await caixaDeAutorizacao.check()
  await campoDaDescricao.fill(`Foto de Fulana, CPF ${CPF_DE_MENTIRA}, na roda`)
  const comCpf = await enviarFoto()
  expect(comCpf.status()).toBe(422)
  const alertaDoCpf = alertas.filter({
    hasText:
      /campo 'descrição da foto' vai ao site e parece conter dado pessoal/,
  })
  await expect(alertaDoCpf).toContainText(`CPF: ${CPF_MASCARADO}`)
  await expect(alertaDoCpf).not.toContainText(CPF_DE_MENTIRA)

  // ---- 3. o número do termo de autorização, se informado, tem de existir na biblioteca de Documentos
  await campoDaDescricao.fill(ALT_1)
  await campoDoTermo.fill('987654321')
  const termoInexistente = await enviarFoto()
  expect(termoInexistente.status()).toBe(404)
  await expect(
    alertas.filter({
      hasText: 'O documento nº 987654321 (termo de autorização) não existe.',
    }),
  ).toBeVisible()
  // nada disso gravou foto: nem no painel, nem para o público
  expect(await doPainel()).toEqual([])
  expect(
    (
      await lerPublico<EventoPublicoCompleto>(
        page,
        `/api/publico/eventos/${ev1}`,
      )
    ).fotos,
  ).toEqual([])
  await ver(page, info, 'foto recusada: termo de autorizacao inexistente')

  // ---- 4. com a autorização e a descrição certa: entra
  await campoDoTermo.fill('')
  const enviada = await enviarFoto()
  expect(enviada.status()).toBe(201)
  esperado.eventos += 1
  await expect(
    contexto.locator(AVISO).filter({ hasText: 'Foto enviada.' }),
  ).toBeVisible()
  const miniatura = contexto.getByRole('img', { name: ALT_1, exact: true })
  await expect(miniatura).toBeVisible()
  // a miniatura vem da área PRIVADA (o navegador busca com o token): tem de ter carregado de verdade
  await expect
    .poll(() =>
      miniatura.evaluate((el) => (el as HTMLImageElement).naturalWidth || 0),
    )
    .toBeGreaterThan(0)
  await ver(page, info, 'foto do evento enviada com autorizacao de imagem')
  const noPainel = await doPainel()
  expect(noPainel).toHaveLength(1)
  const guardada = noPainel[0]!
  idFotoMantida = guardada.id_foto
  expect(guardada.alt).toBe(ALT_1)
  expect(guardada.autorizacao_imagem).toBe(true)
  expect(guardada.id_documento_autorizacao).toBeNull()

  // ---- 5. o que o público recebe: a foto REGRAVADA, sem o metadado escondido
  const publico = await lerPublico<EventoPublicoCompleto>(
    page,
    `/api/publico/eventos/${ev1}`,
  )
  expect(publico.fotos).toHaveLength(1)
  const dela = publico.fotos[0]!
  expect(dela.id_foto).toBe(idFotoMantida)
  expect(dela.alt).toBe(ALT_1)
  expect(dela.arquivo).toBe(
    `/api/publico/eventos/${ev1}/fotos/${idFotoMantida}`,
  )
  expect(JSON.stringify(publico.fotos)).not.toMatch(CAMPOS_DE_GESTAO)
  const servida = await page.request.get(`${API_HML}${dela.arquivo}`)
  expect(servida.status()).toBe(200)
  expect(servida.headers()['content-type']).toContain('image/jpeg')
  expect(servida.headers()['x-content-type-options']).toBe('nosniff')
  const servido = await servida.body()
  expect(servido.subarray(0, 3).toString('hex')).toBe('ffd8ff') // é um JPEG
  const lida = lerJpeg(servido)
  expect(lida.largura).toBe(dela.largura)
  expect(lida.altura).toBe(dela.altura)
  expect(
    metadadosDoJpeg(servido),
    'o JPEG servido ao público não pode carregar Exif/GPS, XMP nem comentário',
  ).toEqual([])
  expect(servido.includes('Exif')).toBe(false)
  expect(servido.includes(APARELHO_ESCONDIDO)).toBe(false)
  expect(servido.includes(COMENTARIO_ESCONDIDO)).toBe(false)
  expect(
    servido.equals(original),
    'a imagem foi regravada, não guardada como veio',
  ).toBe(false)
  // o que o site confere no build: o tamanho e o SHA-256 dizem a verdade
  expect(servido.length).toBe(dela.tamanho)
  expect(createHash('sha256').update(servido).digest('hex')).toBe(dela.sha256)
  // a mesma foto abre por dentro (autenticado) e é o mesmo arquivo; sem login, não abre
  const semLogin = await page.request.get(
    `${API_HML}/api/eventos/${ev1}/fotos/${idFotoMantida}/arquivo`,
  )
  expect(semLogin.status()).toBe(401)
  const comLogin = await page.request.get(
    `${API_HML}/api/eventos/${ev1}/fotos/${idFotoMantida}/arquivo`,
    { headers: { Authorization: token() } },
  )
  expect(comLogin.status()).toBe(200)
  expect((await comLogin.body()).equals(servido)).toBe(true)
  // a foto não vale para outro evento
  expect(
    await statusPublico(
      page,
      `/api/publico/eventos/${idEvento2}/fotos/${idFotoMantida}`,
    ),
  ).toBe(404)

  // ---- 6. a retirada da autorização: apagar tira a foto do painel e do público
  await arquivo.setInputFiles({ ...foto, buffer: original })
  await campoDaDescricao.fill(ALT_2)
  await caixaDeAutorizacao.check()
  const segunda = await enviarFoto()
  expect(segunda.status()).toBe(201)
  esperado.eventos += 1
  const duas = await doPainel()
  expect(duas).toHaveLength(2)
  idFotoApagada = duas.find((f) => f.alt === ALT_2)?.id_foto ?? 0
  expect(idFotoApagada).toBeGreaterThan(0)
  expect(
    await statusPublico(
      page,
      `/api/publico/eventos/${ev1}/fotos/${idFotoApagada}`,
    ),
  ).toBe(200)
  const [apagada] = await Promise.all([
    esperarResposta(page, 'DELETE', /^\/api\/eventos\/\d+\/fotos\/\d+$/),
    contexto.getByRole('button', { name: `Apagar a foto: ${ALT_2}` }).click(),
  ])
  expect(apagada.status()).toBe(200)
  esperado.eventos += 1
  await expect(
    contexto.getByRole('button', { name: `Apagar a foto: ${ALT_2}` }),
  ).toHaveCount(0)
  await expect(
    contexto.getByRole('button', { name: `Apagar a foto: ${ALT_1}` }),
  ).toBeVisible()
  expect((await doPainel()).map((f) => f.id_foto)).toEqual([idFotoMantida])
  expect(
    await statusPublico(
      page,
      `/api/publico/eventos/${ev1}/fotos/${idFotoApagada}`,
    ),
  ).toBe(404)
  expect(
    await statusPublico(
      page,
      `/api/publico/eventos/${ev1}/fotos/${idFotoMantida}`,
    ),
  ).toBe(200)
  expect(
    (
      await lerPublico<EventoPublicoCompleto>(
        page,
        `/api/publico/eventos/${ev1}`,
      )
    ).fotos.map((f) => f.id_foto),
  ).toEqual([idFotoMantida])
  await ver(page, info, 'foto apagada: sai do painel e do publico')
  expect(vigia.problemas()).toEqual([])
})

test('o relatório do evento: o Secretário cadastra ligado ao evento (e ao projeto), o número errado é recusado, antes de aprovado NÃO aparece; o Presidente aprova e aí aparece no detalhe público do evento e na lista da Transparência com o vínculo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const projeto = exigir(idProjeto, 'criar o projeto Despertai')
  const ev1 = exigir(idEvento1, 'criar a 1ª edição')
  const ev3 = exigir(idEventoInterno, 'criar o evento Interno')
  await entrar(page, 'secretario')

  // ---- o formulário recusa o vínculo sem número e o número que não existe
  await page.goto('/documentos/novo')
  await expect(
    page.getByRole('heading', { name: 'Novo documento', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Título').fill(DOC_EVENTO)
  await page.getByLabel(/^Pertence a/).selectOption('evento')
  await page.getByRole('button', { name: 'Cadastrar documento' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Informe o número do evento ou do projeto a que o documento pertence (um número maior que zero).',
  )
  await page.getByLabel(/^Número/).fill('999999999')
  await page.getByRole('button', { name: 'Cadastrar documento' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Evento nº 999999999 não encontrado: confira o número do vínculo.',
  )
  await ver(page, info, 'relatorio ligado a evento que nao existe: recusado')

  // ---- os três relatórios: do evento Público, do projeto e do evento Interno
  idDocEvento = await cadastrarRelatorio(page, {
    titulo: DOC_EVENTO,
    vinculo: 'evento',
    numero: ev1,
  })
  const dados = page.getByRole('region', { name: 'Dados do documento' })
  await expect(dados).toContainText('Relatório de evento ou de projeto')
  await expect(dados).toContainText(`Evento nº ${ev1}`)
  // a versão pública com CPF e e-mail é recusada (mascarado, sem gravar); a limpa entra
  await colarTexto(page, TEXTO_COM_DADO)
  await expect(resultadoDaConferencia(page)).toContainText(
    'CPF na versão pública',
  )
  await expect(resultadoDaConferencia(page)).not.toContainText(CPF_DE_MENTIRA)
  await expect(secaoPublica(page)).toContainText(
    'Nenhuma versão pública aceita ainda.',
  )
  esperado.documentos_institucionais += 1 // VERSAO_PUBLICA_RECUSADA
  await prepararParaRevisao(page, textoDoRelatorio('evento'))
  esperado.documentos_institucionais += 3 // CRIADO, VERSAO_PUBLICA_ENVIADA, ENVIADO_REVISAO
  // quem enviou NÃO aprova: o botão nem aparece
  await expect(
    page.getByRole('button', { name: 'Aprovar a publicação' }),
  ).toHaveCount(0)
  await ver(
    page,
    info,
    'relatorio do evento em revisao: quem enviou nao aprova',
  )

  idDocProjeto = await cadastrarRelatorio(page, {
    titulo: DOC_PROJETO,
    vinculo: 'projeto',
    numero: projeto,
  })
  await expect(
    page.getByRole('region', { name: 'Dados do documento' }),
  ).toContainText(`Projeto nº ${projeto}`)
  await prepararParaRevisao(page, textoDoRelatorio('projeto'))
  esperado.documentos_institucionais += 3

  idDocInterno = await cadastrarRelatorio(page, {
    titulo: DOC_INTERNO,
    vinculo: 'evento',
    numero: ev3,
  })
  await prepararParaRevisao(page, textoDoRelatorio('evento interno'))
  esperado.documentos_institucionais += 3

  // ---- antes de aprovado, nada disso aparece para o público
  const titulos = [DOC_EVENTO, DOC_PROJETO, DOC_INTERNO]
  const naLista = await lerPublico<DocumentoPublico[]>(
    page,
    '/api/publico/transparencia/documentos',
  )
  for (const t of titulos) {
    expect(naLista.map((d) => d.titulo)).not.toContain(t)
  }
  for (const id of [idDocEvento, idDocProjeto, idDocInterno]) {
    expect(
      await statusPublico(page, `/api/publico/transparencia/documentos/${id}`),
      `o documento nº ${id} ainda não foi aprovado`,
    ).toBe(404)
  }
  expect(
    (
      await lerPublico<EventoPublicoCompleto>(
        page,
        `/api/publico/eventos/${ev1}`,
      )
    ).documentos,
  ).toEqual([])
  expect(
    (
      await lerPublico<ProjetoPublicoCompleto>(
        page,
        `/api/publico/projetos/${projeto}`,
      )
    ).documentos,
  ).toEqual([])

  // ---- o Presidente aprova os três (esta é a SEGUNDA pessoa)
  await sair(page)
  await entrar(page, 'presidente')
  await aprovar(page, idDocEvento)
  await ver(page, info, 'relatorio do evento aprovado pelo Presidente')
  await aprovar(page, idDocProjeto)
  await aprovar(page, idDocInterno)

  // ---- agora aparecem: o detalhe público do evento lista o relatório; a lista da Transparência mostra o vínculo
  const evento = await lerPublico<EventoPublicoCompleto>(
    page,
    `/api/publico/eventos/${ev1}`,
  )
  const relatorio = evento.documentos.find(
    (d) => d.id_documento === idDocEvento,
  )
  expect(relatorio?.titulo).toBe(DOC_EVENTO)
  expect(relatorio?.tipo_codigo).toBe('RELATORIO_EVENTO')
  expect(relatorio?.formato).toBe('TEXTO')
  expect(relatorio?.vinculo_tipo).toBe('evento')
  expect(relatorio?.vinculo_id).toBe(ev1)
  expect(evento.documentos.map((d) => d.id_documento)).not.toContain(
    idDocProjeto,
  )
  const transparencia = await lerPublico<DocumentoPublico[]>(
    page,
    '/api/publico/transparencia/documentos',
  )
  const naTransparencia = (id: number) =>
    transparencia.find((d) => d.id_documento === id)
  expect(naTransparencia(idDocEvento)).toMatchObject({
    vinculo_tipo: 'evento',
    vinculo_id: ev1,
  })
  expect(naTransparencia(idDocProjeto)).toMatchObject({
    vinculo_tipo: 'projeto',
    vinculo_id: projeto,
  })
  // o relatório ligado a evento INTERNO continua na Transparência (foi aprovado para isso), mas sem revelar o vínculo
  expect(naTransparencia(idDocInterno)?.titulo).toBe(DOC_INTERNO)
  expect(naTransparencia(idDocInterno)?.vinculo_tipo).toBeNull()
  expect(naTransparencia(idDocInterno)?.vinculo_id).toBeNull()
  const detalheDoDoc = await lerPublico<DocumentoPublico & { texto: string }>(
    page,
    `/api/publico/transparencia/documentos/${idDocEvento}`,
  )
  expect(detalheDoDoc.texto).toContain(`Relatorio do robo ${S} (evento)`)
  expect(detalheDoDoc.vinculo_id).toBe(ev1)
  // o detalhe público do PROJETO traz o relatório do projeto e o da edição Pública, nunca o do evento Interno
  const doProjeto = await lerPublico<ProjetoPublicoCompleto>(
    page,
    `/api/publico/projetos/${projeto}`,
  )
  const idsNoProjeto = doProjeto.documentos.map((d) => d.id_documento)
  expect(idsNoProjeto).toContain(idDocProjeto)
  expect(idsNoProjeto).toContain(idDocEvento)
  expect(idsNoProjeto).not.toContain(idDocInterno)
  // a 2ª edição não tem relatório: o relatório é da 1ª
  expect(
    (
      await lerPublico<EventoPublicoCompleto>(
        page,
        `/api/publico/eventos/${idEvento2}`,
      )
    ).documentos,
  ).toEqual([])

  // ---- no painel: o contexto do evento e o do projeto listam o relatório, já Aprovado
  await abrirEvento(page, ev1, EDICAO_1)
  const contextoEvento = contextoDoEvento(page)
  const linhaDoRelatorio = contextoEvento
    .locator('li')
    .filter({ hasText: DOC_EVENTO })
  await expect(linhaDoRelatorio).toContainText('Aprovado')
  await expect(
    linhaDoRelatorio.getByRole('link', { name: DOC_EVENTO }),
  ).toHaveAttribute('href', `/documentos/${idDocEvento}`)
  await ver(page, info, 'contexto do evento lista o relatorio aprovado')
  await abrirProjeto(page, projeto, NOME_PROJETO)
  await expect(
    contextoDoProjeto(page).locator('li').filter({ hasText: DOC_PROJETO }),
  ).toContainText('Aprovado')
  await abrirEvento(page, ev3, EVENTO_INTERNO)
  await expect(contextoDoEvento(page)).toContainText(DOC_INTERNO)
  await expect(contextoDoEvento(page)).toContainText(
    'Aprovado, ele também aparece na página de Transparência, mesmo que este evento seja Interno.',
  )
  expect(vigia.problemas()).toEqual([])
})

test('a API pública do Despertai (sem login): o projeto em destaque com as edições, os relatórios e a foto; o evento com o projeto, as outras edições e a programação; projeto e evento Interno não aparecem; nada de dado de gestão', async ({
  page,
}, info) => {
  const projeto = exigir(idProjeto, 'criar o projeto Despertai')
  const ev1 = exigir(idEvento1, 'criar a 1ª edição')
  const ev2 = exigir(idEvento2, 'criar a nova edição')
  const ev3 = exigir(idEventoInterno, 'criar o evento Interno')
  exigir(idFotoMantida, 'enviar a foto')

  // ---- a lista de projetos
  const lista = await lerPublico<ProjetoPublico[]>(
    page,
    '/api/publico/projetos',
  )
  const meu = lista.find((p) => p.id_projeto === projeto)
  expect(meu?.nome).toBe(NOME_PROJETO)
  expect(meu?.destaque).toBe(true)
  expect(lista.some((p) => p.id_projeto === idInterno)).toBe(false)

  // ---- o projeto: as edições (a mais recente primeiro), os relatórios e a foto; nunca o evento Interno
  const detalhe = await lerPublico<ProjetoPublicoCompleto>(
    page,
    `/api/publico/projetos/${projeto}`,
  )
  await info.attach('api-publica-do-projeto.json', {
    body: JSON.stringify(detalhe, null, 2),
    contentType: 'application/json',
  })
  expect(detalhe.destaque).toBe(true)
  expect(detalhe.descricao).toBe(DESCRICAO_EDITADA)
  expect(detalhe.eventos.map((e) => e.id_evento)).toEqual([ev2, ev1])
  expect(detalhe.eventos.map((e) => e.titulo)).toEqual([EDICAO_2, EDICAO_1])
  expect(detalhe.documentos.map((d) => d.id_documento).sort()).toEqual(
    [idDocProjeto, idDocEvento].sort(),
  )
  expect(detalhe.fotos.map((f) => f.id_foto)).toEqual([idFotoMantida])
  expect(detalhe.fotos[0]?.id_evento).toBe(ev1)
  const textoDoProjeto = JSON.stringify(detalhe)
  expect(textoDoProjeto).not.toMatch(CAMPOS_DE_GESTAO)
  expect(textoDoProjeto).not.toContain(EVENTO_INTERNO)
  expect(textoDoProjeto).not.toContain(DOC_INTERNO)
  expect(textoDoProjeto).not.toContain(CPF_DE_MENTIRA)
  expect(textoDoProjeto).not.toContain(EMAIL_DE_MENTIRA)

  // ---- a lista de eventos: as duas edições ligadas ao projeto; o Interno não
  const eventos = await lerPublico<EventoPublico[]>(
    page,
    '/api/publico/eventos',
  )
  expect(eventos.find((e) => e.id_evento === ev1)?.id_projeto).toBe(projeto)
  expect(eventos.find((e) => e.id_evento === ev2)?.id_projeto).toBe(projeto)
  expect(eventos.some((e) => e.id_evento === ev3)).toBe(false)

  // ---- a 1ª edição: o projeto, a cadeia de edições (com a atual marcada), a programação, o relatório e a foto
  const um = await lerPublico<EventoPublicoCompleto>(
    page,
    `/api/publico/eventos/${ev1}`,
  )
  await info.attach('api-publica-da-1a-edicao.json', {
    body: JSON.stringify(um, null, 2),
    contentType: 'application/json',
  })
  expect(um.titulo).toBe(EDICAO_1)
  expect(um.descricao).toBe(DESCRICAO_DO_EVENTO)
  expect(um.id_projeto).toBe(projeto)
  expect(um.projeto).toEqual({ id_projeto: projeto, nome: NOME_PROJETO })
  expect(um.edicoes.map((e) => [e.id_evento, e.atual])).toEqual([
    [ev1, true],
    [ev2, false],
  ])
  expect(um.sessoes.map((s) => s.titulo)).toEqual([SESSAO])
  expect(um.documentos.map((d) => d.id_documento)).toEqual([idDocEvento])
  expect(um.fotos.map((f) => f.id_foto)).toEqual([idFotoMantida])
  expect(JSON.stringify(um)).not.toMatch(CAMPOS_DE_GESTAO)
  expect(JSON.stringify(um)).not.toContain(EVENTO_INTERNO)

  // ---- a 2ª edição: mesmo projeto, a atual marcada nela, sem relatório nem foto (eram da 1ª)
  const dois = await lerPublico<EventoPublicoCompleto>(
    page,
    `/api/publico/eventos/${ev2}`,
  )
  expect(dois.projeto?.id_projeto).toBe(projeto)
  expect(dois.edicoes.map((e) => [e.id_evento, e.atual])).toEqual([
    [ev1, false],
    [ev2, true],
  ])
  expect(dois.documentos).toEqual([])
  expect(dois.fotos).toEqual([])

  // ---- o que é Interno nunca aparece, nem sabendo o número
  expect(await statusPublico(page, `/api/publico/eventos/${ev3}`)).toBe(404)
  expect(
    await statusPublico(page, `/api/publico/eventos/${ev3}/perguntas`),
  ).toBe(404)
  expect(await statusPublico(page, `/api/publico/projetos/${idInterno}`)).toBe(
    404,
  )
  expect(
    await statusPublico(page, `/api/publico/projetos/${projeto + 100_000_000}`),
  ).toBe(404)
})

test('Interno nunca aparece: evento Público com dado pessoal na edição é barrado; virar Interno some da API pública (evento, foto, projeto) e o relatório perde só a ligação; voltar a Público devolve tudo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  const projeto = exigir(idProjeto, 'criar o projeto Despertai')
  const ev1 = exigir(idEvento1, 'criar a 1ª edição')
  const ev2 = exigir(idEvento2, 'criar a nova edição')
  exigir(idFotoMantida, 'enviar a foto')
  await entrar(page, 'presidente')
  let restaurado = false

  try {
    const detalhe = await abrirEvento(page, ev1, EDICAO_1)
    const abrirEdicao = async (): Promise<Locator> => {
      await detalhe.getByRole('button', { name: 'Editar evento' }).click()
      const editar = page.getByRole('form', { name: 'Editar evento' })
      await expect(editar).toBeVisible()
      return editar
    }
    const salvar = async (editar: Locator): Promise<Resposta> => {
      const [resposta] = await Promise.all([
        esperarResposta(page, 'PUT', /^\/api\/eventos\/\d+$/),
        editar.getByRole('button', { name: 'Salvar alterações' }).click(),
      ])
      return resposta
    }

    // ---- editar o evento Público: CPF e e-mail na descrição são barrados e nada é gravado
    const editar = await abrirEdicao()
    await expect(editar.getByLabel('Título do evento')).toHaveValue(EDICAO_1)
    await expect(editar.getByLabel('Quem pode ver o evento')).toHaveValue(
      'Pública',
    )
    await editar
      .getByLabel('Descrição (opcional)')
      .fill(`Contato: Fulana, CPF ${CPF_DE_MENTIRA}, ${EMAIL_DE_MENTIRA}`)
    expect((await salvar(editar)).status()).toBe(422)
    const barrado = editar.getByRole('alert').filter({
      hasText: /campo 'descrição' vai ao site e parece conter dado pessoal/,
    })
    await expect(barrado).toContainText(`CPF: ${CPF_MASCARADO}`)
    await expect(barrado).not.toContainText(CPF_DE_MENTIRA)
    await ver(page, info, 'editar evento Publico com dado pessoal: recusado')
    await editar.getByRole('button', { name: 'Cancelar' }).click()
    expect(
      (
        await lerPublico<EventoPublicoCompleto>(
          page,
          `/api/publico/eventos/${ev1}`,
        )
      ).descricao,
      'a descrição recusada não foi gravada',
    ).toBe(DESCRICAO_DO_EVENTO)

    // ---- virar Interno pela tela: some do site
    const editarInterno = await abrirEdicao()
    await editarInterno
      .getByLabel('Quem pode ver o evento')
      .selectOption('Interna')
    expect((await salvar(editarInterno)).status()).toBe(200)
    esperado.eventos += 1
    await expect(contextoDoEvento(page)).toContainText(
      'Este evento é Interno: ele não aparece no site, nem na página do projeto.',
    )
    await ver(page, info, '1a edicao virou Interna')
    expect(await statusPublico(page, `/api/publico/eventos/${ev1}`)).toBe(404)
    // a foto tem a autorização de imagem, mas o evento é Interno: o público não a recebe
    expect(
      await statusPublico(
        page,
        `/api/publico/eventos/${ev1}/fotos/${idFotoMantida}`,
      ),
    ).toBe(404)
    const projetoSemEla = await lerPublico<ProjetoPublicoCompleto>(
      page,
      `/api/publico/projetos/${projeto}`,
    )
    expect(projetoSemEla.eventos.map((e) => e.id_evento)).toEqual([ev2])
    expect(projetoSemEla.fotos).toEqual([])
    expect(projetoSemEla.documentos.map((d) => d.id_documento)).toEqual([
      idDocProjeto,
    ])
    expect(
      (await lerPublico<EventoPublico[]>(page, '/api/publico/eventos')).some(
        (e) => e.id_evento === ev1,
      ),
    ).toBe(false)
    const outraEdicao = await lerPublico<EventoPublicoCompleto>(
      page,
      `/api/publico/eventos/${ev2}`,
    )
    expect(outraEdicao.edicoes.map((e) => e.id_evento)).toEqual([ev2])
    // o relatório aprovado continua na Transparência, mas sem dizer a que evento pertence
    const relatorio = (
      await lerPublico<DocumentoPublico[]>(
        page,
        '/api/publico/transparencia/documentos',
      )
    ).find((d) => d.id_documento === idDocEvento)
    expect(relatorio?.titulo).toBe(DOC_EVENTO)
    expect(relatorio?.vinculo_tipo).toBeNull()
    expect(relatorio?.vinculo_id).toBeNull()

    // ---- voltar a Público: tudo volta (o site precisa da 1ª edição Pública, com a foto e o relatório)
    const editarPublico = await abrirEdicao()
    await editarPublico
      .getByLabel('Quem pode ver o evento')
      .selectOption('Pública')
    expect((await salvar(editarPublico)).status()).toBe(200)
    esperado.eventos += 1
    restaurado = true
    await expect(contextoDoEvento(page)).toContainText(
      'Este evento e o projeto são Públicos',
    )
    const deVolta = await lerPublico<EventoPublicoCompleto>(
      page,
      `/api/publico/eventos/${ev1}`,
    )
    expect(deVolta.fotos.map((f) => f.id_foto)).toEqual([idFotoMantida])
    expect(deVolta.documentos.map((d) => d.id_documento)).toEqual([idDocEvento])
    expect(
      await statusPublico(
        page,
        `/api/publico/eventos/${ev1}/fotos/${idFotoMantida}`,
      ),
    ).toBe(200)
    expect(
      (
        await lerPublico<ProjetoPublicoCompleto>(
          page,
          `/api/publico/projetos/${projeto}`,
        )
      ).eventos.map((e) => e.id_evento),
    ).toEqual([ev2, ev1])
    await ver(page, info, '1a edicao de volta a Publica')
  } finally {
    // se algo falhou no meio, a 1ª edição não pode ficar Interna: o roteiro do site precisa dela Pública
    if (!restaurado) {
      await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
      await page.request.fetch(`${API_HML}/api/eventos/${ev1}`, {
        method: 'PUT',
        headers: {
          Authorization: token(),
          'Content-Type': 'application/json',
        },
        data: JSON.stringify({ visibilidade: 'Pública' }),
      })
    }
  }
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guarda cada ação do Despertai (projeto, evento, edição, sessão, foto, relatório) e as recusas não deixam rastro', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const projeto = exigir(idProjeto, 'criar o projeto Despertai')
  const ev1 = exigir(idEvento1, 'criar a 1ª edição')
  await entrar(page, 'presidente')

  // o total de cada tabela cresceu EXATAMENTE pelo que o roteiro fez com sucesso: as recusas (CPF, e-mail, destaque em Interno, foto sem autorização,
  // vínculo inexistente...) não deixaram nada
  for (const tabela of TABELAS) {
    const total = await totalNaAuditoria(page, tabela)
    expect(
      total - antes[tabela],
      `registros novos em ${tabela} nesta rodada`,
    ).toBe(esperado[tabela])
  }

  const conferirLinha = async (
    tabela: Tabela,
    acao: string,
    registro: number,
  ): Promise<void> => {
    await totalNaAuditoria(page, tabela)
    await expect(
      linhaDaAuditoria(page, acao, registro),
      `${tabela}: ${acao} do registro ${registro}`,
    ).toBeVisible()
  }
  await conferirLinha('projetos_eventos', 'CREATE', projeto)
  await conferirLinha('projetos_eventos', 'UPDATE', projeto)
  await conferirLinha('projetos_eventos', 'CREATE', idInterno)
  await conferirLinha('projetos_eventos', 'UPDATE', idInterno)
  await ver(page, info, 'auditoria dos projetos')
  await conferirLinha('eventos', 'CREATE', ev1)
  await conferirLinha('eventos', 'NOVA_EDICAO', idEvento2)
  await conferirLinha('eventos', 'CREATE', idEventoInterno)
  await conferirLinha('eventos', 'FOTO_ENVIADA', ev1)
  await conferirLinha('eventos', 'FOTO_APAGADA', ev1)
  await conferirLinha('eventos', 'UPDATE', ev1)
  await ver(page, info, 'auditoria dos eventos e das fotos')
  await conferirLinha('sessoes_evento', 'CREATE', idSessao)
  for (const id of [idDocEvento, idDocProjeto, idDocInterno]) {
    await conferirLinha('documentos_institucionais', 'CRIADO', id)
    await conferirLinha('documentos_institucionais', 'ENVIADO_REVISAO', id)
    await conferirLinha('documentos_institucionais', 'APROVADO', id)
  }
  await conferirLinha(
    'documentos_institucionais',
    'VERSAO_PUBLICA_RECUSADA',
    idDocEvento,
  )
  await ver(page, info, 'auditoria dos relatorios')
  expect(vigia.problemas()).toEqual([])
})
