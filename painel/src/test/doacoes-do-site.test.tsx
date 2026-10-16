import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DoacoesDoSite } from '@/components/doacoes/DoacoesDoSite'
import type {
  CentroDeCusto,
  Doacao,
  IntencaoDeDoacao,
  PlanoDeContas,
  SituacaoDaIntencaoDeDoacao,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  confirmarDoacaoDoSiteSchema,
  doacaoDoSiteNaoLocalizadaSchema,
} from '@/lib/schemas'
import { DoacoesPage } from '@/pages/Doacoes'

import { renderizar } from './fabricas-despertai'

// v5.6a - seção "Doações do site (Pix)" da tela de Doações. Os testes falam com um servidor de mentira que segue o contrato real do servidor
// (rotas, filtros, paginação, as recusas e o que a confirmação faz com a doação): assim o que SAI do painel (rota, método, corpo JSON) é conferido
// de verdade, não só a chamada a uma função simulada.

const permissoes = vi.hoisted(() => ({
  atuais: ['financeiro'] as string[] | null,
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({
    data:
      permissoes.atuais === null
        ? undefined
        : { permissoes: permissoes.atuais },
    isLoading: permissoes.atuais === null,
  }),
}))

const ROTULOS: Record<SituacaoDaIntencaoDeDoacao, string> = {
  PENDENTE: 'Aguardando conferência',
  EXPIRADA: 'Prazo vencido sem confirmação',
  NAO_LOCALIZADA: 'Pix não localizado',
  CONFIRMADA: 'Confirmada',
}

function intencao(
  sobrescrever: Partial<IntencaoDeDoacao> = {},
): IntencaoDeDoacao {
  const status = sobrescrever.status ?? 'PENDENTE'
  return {
    id_intencao: 1,
    protocolo: 'DOA-2026-00001',
    nome_doador: 'Maria Souza',
    email_doador: 'maria@exemplo.org',
    documento_doador: '12345678909',
    valor_informado: 50,
    id_campanha: null,
    campanha_titulo: null,
    id_centro_custo_sugerido: null,
    status,
    status_rotulo: ROTULOS[status],
    criado_em: '2026-10-14T15:30:00',
    expira_em: '2026-10-29T15:30:00',
    resolvido_em: null,
    id_doacao: null,
    numero_recibo: null,
    valor_recebido: null,
    observacao: null,
    recibo_enviado_por_email: null,
    pode_confirmar: status !== 'CONFIRMADA',
    ...sobrescrever,
  }
}

function intencoesDeExemplo(): IntencaoDeDoacao[] {
  return [
    intencao(),
    intencao({
      id_intencao: 2,
      protocolo: 'DOA-2026-00002',
      nome_doador: 'João Pereira',
      email_doador: 'joao@exemplo.org',
      documento_doador: null,
      valor_informado: null,
      id_campanha: 3,
      campanha_titulo: 'Cestas de Natal',
      id_centro_custo_sugerido: 7,
      criado_em: '2026-10-15T09:00:00',
      expira_em: '2026-10-30T09:00:00',
    }),
    intencao({
      id_intencao: 3,
      protocolo: 'DOA-2026-00003',
      nome_doador: 'Ana Lima',
      email_doador: 'ana@exemplo.org',
      documento_doador: '98765432100',
      valor_informado: 120.5,
      status: 'EXPIRADA',
      criado_em: '2026-09-20T10:00:00',
      expira_em: '2026-10-05T10:00:00',
    }),
    intencao({
      id_intencao: 4,
      protocolo: 'DOA-2026-00004',
      nome_doador: 'Pedro Alves',
      email_doador: 'pedro@exemplo.org',
      documento_doador: null,
      valor_informado: 30,
      status: 'NAO_LOCALIZADA',
      observacao: 'Procurado no extrato dos últimos 10 dias.',
      resolvido_em: '2026-10-12T11:00:00',
      criado_em: '2026-10-01T08:00:00',
      expira_em: '2026-10-16T08:00:00',
    }),
    intencao({
      id_intencao: 5,
      protocolo: 'DOA-2026-00005',
      nome_doador: 'Lúcia Martins',
      email_doador: 'lucia@exemplo.org',
      documento_doador: '11144477735',
      valor_informado: 80,
      status: 'CONFIRMADA',
      id_doacao: 9,
      numero_recibo: 9,
      valor_recebido: 75.5, // chegou menos do que o doador tinha informado (80)
      recibo_enviado_por_email: true,
      resolvido_em: '2026-10-10T14:00:00',
      criado_em: '2026-10-09T08:00:00',
      expira_em: '2026-10-24T08:00:00',
    }),
  ]
}

const conta = (
  id: number,
  codigo: string,
  descricao: string,
  tipo: string,
  sintetica = false,
): PlanoDeContas => ({
  id_conta: id,
  codigo_contabil: codigo,
  descricao_conta: descricao,
  tipo,
  codigo_contabil_pai: null,
  sintetica,
})

const CONTAS: PlanoDeContas[] = [
  conta(1, '1.1.01', 'Caixa', 'Ativo'),
  conta(2, '1.1.02', 'Banco do Brasil', 'Ativo'),
  conta(3, '1.1', 'Ativo circulante', 'Ativo', true),
  conta(4, '4.1.01', 'Doações recebidas', 'Receita'),
  conta(5, '4.1.02', 'Mensalidades', 'Receita'),
  conta(6, '4.1', 'Receitas', 'Receita', true),
  conta(7, '5.1.01', 'Despesas gerais', 'Despesa'),
]

const centro = (id: number, nome: string): CentroDeCusto => ({
  id_centro_custo: id,
  codigo: `CC-${id}`,
  nome,
  id_projeto: null,
  id_evento: null,
  ativo: true,
  saldo_restrito: true,
})

// ----------------------------------------------------------------------------------------------- servidor de mentira
type Chamada = {
  metodo: string
  caminho: string
  corpo: Record<string, unknown> | null
}

type Recusa = { status: number; corpo: unknown }

const servidor = {
  intencoes: [] as IntencaoDeDoacao[],
  doacoes: [] as Doacao[],
  contas: CONTAS,
  centros: [centro(7, 'Projeto Despertai'), centro(8, 'Manutenção da sede')],
  pixDisponivel: true,
  falharPix: false,
  falharLista: false,
  falharResumo: false,
  falharContas: false,
  falharRecibo: false,
  recusarConfirmacao: null as Recusa | null,
  recusarNaoLocalizada: null as Recusa | null,
  emailDoReciboFalha: false,
  proximoRecibo: 12,
  // segura a resposta de uma rota (para ver o estado "enviando" e o duplo clique)
  segurarListaAte: null as Promise<void> | null,
  segurarConfirmacaoAte: null as Promise<void> | null,
  destinacaoUsada: null as number | null | undefined,
}
let chamadas: Chamada[] = []

function json(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const ORDEM: Record<SituacaoDaIntencaoDeDoacao, number> = {
  PENDENTE: 0,
  EXPIRADA: 1,
  NAO_LOCALIZADA: 2,
  CONFIRMADA: 3,
}

function resumoDoServidor() {
  const por = (s: SituacaoDaIntencaoDeDoacao) =>
    servidor.intencoes.filter((i) => i.status === s).length
  return {
    pendentes: por('PENDENTE'),
    expiradas: por('EXPIRADA'),
    nao_localizadas: por('NAO_LOCALIZADA'),
    confirmadas: por('CONFIRMADA'),
    a_conferir: por('PENDENTE') + por('EXPIRADA'),
  }
}

function listaDoServidor(params: URLSearchParams) {
  const situacao = params.get('situacao')
  const busca = (params.get('busca') ?? '').trim()
  const pagina = Number(params.get('pagina') ?? '1')
  const porPagina = Number(params.get('por_pagina') ?? '25')
  let itens = [...servidor.intencoes]
  if (situacao === 'a_conferir')
    itens = itens.filter(
      (i) => i.status === 'PENDENTE' || i.status === 'EXPIRADA',
    )
  else if (situacao) {
    if (!(situacao in ROTULOS))
      return json(400, { detail: 'Situação desconhecida.' })
    itens = itens.filter((i) => i.status === situacao)
  }
  if (busca) {
    const texto = busca.toLowerCase()
    const digitos = busca.replace(/\D/g, '')
    const soNumeros = /^[\d\s.\-/]+$/.test(busca)
    itens = itens.filter(
      (i) =>
        i.protocolo.toLowerCase().includes(texto) ||
        i.nome_doador.toLowerCase().includes(texto) ||
        i.email_doador.toLowerCase().includes(texto) ||
        (soNumeros &&
          digitos !== '' &&
          (i.documento_doador ?? '').includes(digitos)),
    )
  }
  itens.sort(
    (a, b) =>
      ORDEM[a.status] - ORDEM[b.status] ||
      b.criado_em.localeCompare(a.criado_em) ||
      b.id_intencao - a.id_intencao,
  )
  return json(200, {
    total: itens.length,
    pagina,
    por_pagina: porPagina,
    itens: itens.slice((pagina - 1) * porPagina, pagina * porPagina),
  })
}

async function confirmar(id: number, corpo: Record<string, unknown>) {
  if (servidor.segurarConfirmacaoAte) await servidor.segurarConfirmacaoAte
  const item = servidor.intencoes.find((i) => i.id_intencao === id)
  if (!item) return json(404, { detail: 'Doação a conferir não encontrada.' })
  if (servidor.recusarConfirmacao)
    return json(
      servidor.recusarConfirmacao.status,
      servidor.recusarConfirmacao.corpo,
    )
  if (item.status === 'CONFIRMADA')
    return json(400, { detail: 'Esta doação já foi confirmada.' })
  const valor = Number(corpo.valor_recebido)
  if (!(valor > 0))
    return json(422, {
      detail: [
        {
          loc: ['body', 'valor_recebido'],
          msg: 'Value error, O valor da doação precisa ser maior que zero.',
          type: 'value_error',
        },
      ],
    })
  const receita = servidor.contas.find(
    (c) => c.id_conta === corpo.id_conta_contabil,
  )
  const caixa = servidor.contas.find(
    (c) => c.id_conta === corpo.id_conta_contabil_caixa,
  )
  if (receita?.tipo !== 'Receita')
    return json(400, {
      detail: 'A conta de receita precisa ser do tipo Receita.',
    })
  if (caixa?.tipo !== 'Ativo')
    return json(400, {
      detail: 'A conta de caixa ou banco precisa ser do tipo Ativo.',
    })

  // a destinação informada vale; sem ela, vale a do centro de custo da campanha
  servidor.destinacaoUsada =
    (corpo.id_centro_custo_destinacao as number | undefined) ??
    item.id_centro_custo_sugerido
  const recibo = servidor.proximoRecibo
  servidor.proximoRecibo += 1
  Object.assign(item, {
    status: 'CONFIRMADA',
    status_rotulo: ROTULOS.CONFIRMADA,
    pode_confirmar: false,
    id_doacao: 100 + recibo,
    numero_recibo: recibo,
    valor_recebido: valor,
    resolvido_em: '2026-10-15T18:00:00',
    recibo_enviado_por_email: !servidor.emailDoReciboFalha,
  })
  servidor.doacoes.push({
    id_doacao: 100 + recibo,
    anonima: false,
    nome_doador: item.nome_doador,
    documento_doador: item.documento_doador,
    id_associado: null,
    tipo_doacao: 'Monetaria',
    recorrente: false,
    valor,
    descricao_bem: null,
    id_campanha: item.id_campanha,
    id_centro_custo_destinacao: servidor.destinacaoUsada ?? null,
    numero_recibo: recibo,
    id_titulo: null,
    data_doacao: '2026-10-15',
  })
  // a resposta é a intenção serializada MAIS a mensagem (o id da doação, o recibo e o e-mail já vêm na própria intenção)
  return json(200, { ...item, mensagem: 'Doação confirmada e recibo emitido.' })
}

function naoLocalizada(id: number, corpo: Record<string, unknown>) {
  const item = servidor.intencoes.find((i) => i.id_intencao === id)
  if (!item) return json(404, { detail: 'Doação a conferir não encontrada.' })
  if (servidor.recusarNaoLocalizada)
    return json(
      servidor.recusarNaoLocalizada.status,
      servidor.recusarNaoLocalizada.corpo,
    )
  if (item.status === 'CONFIRMADA')
    return json(400, { detail: 'Esta doação já foi confirmada.' })
  Object.assign(item, {
    status: 'NAO_LOCALIZADA',
    status_rotulo: ROTULOS.NAO_LOCALIZADA,
    observacao:
      String(corpo.observacao ?? '')
        .trim()
        .slice(0, 300) || null,
    resolvido_em: '2026-10-15T18:00:00',
  })
  return json(200, item)
}

async function responder(entrada: string, init: RequestInit = {}) {
  const url = new URL(entrada, 'http://localhost')
  const metodo = (init.method ?? 'GET').toUpperCase()
  const corpo =
    typeof init.body === 'string'
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : null
  chamadas.push({ metodo, caminho: url.pathname + url.search, corpo })
  const caminho = url.pathname

  if (caminho === '/api/intencoes-doacao/resumo' && metodo === 'GET')
    return servidor.falharResumo
      ? json(500, { detail: 'Falha no servidor.' })
      : json(200, resumoDoServidor())
  if (caminho === '/api/intencoes-doacao/' && metodo === 'GET') {
    if (servidor.segurarListaAte) await servidor.segurarListaAte
    return servidor.falharLista
      ? json(500, { detail: 'Falha no servidor.' })
      : listaDoServidor(url.searchParams)
  }
  const acao =
    /^\/api\/intencoes-doacao\/(\d+)\/(confirmar|nao-localizada)$/.exec(caminho)
  if (acao && metodo === 'POST') {
    const id = Number(acao[1])
    return acao[2] === 'confirmar'
      ? confirmar(id, corpo ?? {})
      : naoLocalizada(id, corpo ?? {})
  }
  if (caminho === '/api/plano-contas/' && metodo === 'GET')
    return servidor.falharContas
      ? json(500, { detail: 'Falha no servidor.' })
      : json(200, servidor.contas)
  if (caminho === '/api/centros-custo/' && metodo === 'GET')
    return json(200, servidor.centros)
  if (caminho === '/api/publico/doacao' && metodo === 'GET')
    return servidor.falharPix
      ? json(500, { detail: 'Falha no servidor.' })
      : json(200, {
          pix_disponivel: servidor.pixDisponivel,
          campanhas: [],
        })
  if (caminho === '/api/doacoes/' && metodo === 'GET')
    return json(200, servidor.doacoes)
  if (caminho === '/api/campanhas-arrecadacao/' && metodo === 'GET')
    return json(200, [])
  const recibo = /^\/api\/doacoes\/(\d+)\/recibo$/.exec(caminho)
  if (recibo && metodo === 'GET')
    return servidor.falharRecibo
      ? json(404, { detail: 'Recibo não encontrado.' })
      : json(200, { texto: `RECIBO Nº ${recibo[1]} DA ASAF` })
  return json(404, { detail: 'Rota fora do contrato do teste.' })
}

const consultasDaLista = () =>
  chamadas.filter(
    (c) =>
      c.metodo === 'GET' && c.caminho.startsWith('/api/intencoes-doacao/?'),
  )
const parametrosDe = (c: Chamada | undefined) =>
  Object.fromEntries(new URL(c!.caminho, 'http://x').searchParams)
const ultimaConsultaDaLista = () => parametrosDe(consultasDaLista().at(-1))
const consultasDoResumo = () =>
  chamadas.filter((c) => c.caminho === '/api/intencoes-doacao/resumo')
const confirmacoes = () =>
  chamadas.filter(
    (c) => c.metodo === 'POST' && c.caminho.endsWith('/confirmar'),
  )
const marcacoes = () =>
  chamadas.filter(
    (c) => c.metodo === 'POST' && c.caminho.endsWith('/nao-localizada'),
  )
const escritas = () => chamadas.filter((c) => c.metodo !== 'GET')

beforeEach(() => {
  vi.clearAllMocks()
  permissoes.atuais = ['financeiro']
  servidor.intencoes = intencoesDeExemplo()
  servidor.doacoes = []
  servidor.contas = CONTAS
  servidor.pixDisponivel = true
  servidor.falharPix = false
  servidor.falharLista = false
  servidor.falharResumo = false
  servidor.falharContas = false
  servidor.falharRecibo = false
  servidor.recusarConfirmacao = null
  servidor.recusarNaoLocalizada = null
  servidor.emailDoReciboFalha = false
  servidor.proximoRecibo = 12
  servidor.segurarListaAte = null
  servidor.segurarConfirmacaoAte = null
  servidor.destinacaoUsada = undefined
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((entrada: string, init?: RequestInit) => responder(entrada, init)),
  )
})

// ----------------------------------------------------------------------------------------------- ajudantes
function abrir() {
  return renderizar(<DoacoesDoSite />)
}

async function esperarALista() {
  await screen.findAllByRole('listitem')
}

const linhaDe = (protocolo: string) => {
  const li = screen
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(protocolo))
  if (!li) throw new Error(`Sem linha para ${protocolo}`)
  return li
}

const resumoNaTela = () =>
  within(screen.getByRole('group', { name: 'Resumo das doações do site' }))

async function abrirConfirmacao(
  usuario: ReturnType<typeof userEvent.setup>,
  protocolo = 'DOA-2026-00001',
) {
  await usuario.click(
    within(linhaDe(protocolo)).getByRole('button', {
      name: /^Confirmar recebimento de /,
    }),
  )
  const dialogo = await screen.findByRole('alertdialog')
  await within(dialogo).findByLabelText('Valor recebido (R$)')
  return dialogo
}

async function abrirNaoLocalizada(
  usuario: ReturnType<typeof userEvent.setup>,
  protocolo = 'DOA-2026-00001',
) {
  await usuario.click(
    within(linhaDe(protocolo)).getByRole('button', {
      name: /^Pix não localizado de /,
    }),
  )
  return screen.findByRole('alertdialog')
}

const campoValor = (d: HTMLElement) =>
  within(d).getByLabelText('Valor recebido (R$)')
const selectReceita = (d: HTMLElement) =>
  within(d).getByLabelText('Conta de receita')
const selectCaixa = (d: HTMLElement) =>
  within(d).getByLabelText('Conta de caixa ou banco que recebeu')
const selectDestinacao = (d: HTMLElement) =>
  within(d).getByLabelText('Destinação (centro de custo)')

async function preencherContas(
  usuario: ReturnType<typeof userEvent.setup>,
  d: HTMLElement,
) {
  await usuario.selectOptions(selectReceita(d), '4.1.01 — Doações recebidas')
  await usuario.selectOptions(selectCaixa(d), '1.1.02 — Banco do Brasil')
}

const botaoConfirmar = (d: HTMLElement) =>
  within(d).getByRole('button', { name: 'Confirmar recebimento' })

// ----------------------------------------------------------------------------------------------- o que a tela mostra
describe('Doações do site: o que a tela mostra', () => {
  it('abre em "A conferir", primeira página, 25 por vez, e mostra a orientação para a tesouraria', async () => {
    abrir()
    await esperarALista()
    expect(
      screen.getByRole('heading', { name: 'Doações do site (Pix)' }),
    ).toBeInTheDocument()
    const orientacao = screen.getByText(/paga o Pix direto na conta/)
    expect(orientacao).toHaveTextContent(/o sistema não sabe sozinho/)
    expect(orientacao).toHaveTextContent(/extrato do banco/)
    expect(orientacao).toHaveTextContent(/o recibo sai por e-mail/)

    expect(consultasDaLista()).toHaveLength(1)
    expect(ultimaConsultaDaLista()).toEqual({
      situacao: 'a_conferir',
      pagina: '1',
      por_pagina: '25',
    })
    expect(screen.getByRole('combobox', { name: 'Situação' })).toHaveValue(
      'a_conferir',
    )
    // só o que espera uma decisão: aguardando e prazo vencido
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByText('Pedro Alves')).toBeNull()
    expect(screen.queryByText('Lúcia Martins')).toBeNull()
    expect(screen.getByText('3 doação(ões) do site')).toBeInTheDocument()
  })

  it('o filtro tem as seis opções, na ordem, com "A conferir" escolhida', async () => {
    abrir()
    await esperarALista()
    const opcoes = within(
      screen.getByRole('combobox', { name: 'Situação' }),
    ).getAllByRole('option')
    expect(opcoes.map((o) => o.textContent)).toEqual([
      'A conferir',
      'Aguardando conferência',
      'Prazo vencido',
      'Pix não localizado',
      'Confirmadas',
      'Todas',
    ])
    expect(opcoes.map((o) => (o as HTMLOptionElement).value)).toEqual([
      'a_conferir',
      'PENDENTE',
      'EXPIRADA',
      'NAO_LOCALIZADA',
      'CONFIRMADA',
      '',
    ])
  })

  it('o resumo mostra os cinco contadores, com "A conferir" em destaque (aguardando + prazo vencido)', async () => {
    abrir()
    await esperarALista()
    const resumo = resumoNaTela()
    await waitFor(() =>
      expect(resumo.getByText('A conferir').nextSibling).toHaveTextContent('3'),
    )
    expect(
      resumo.getByText('Aguardando conferência').nextSibling,
    ).toHaveTextContent('2')
    expect(resumo.getByText('Prazo vencido').nextSibling).toHaveTextContent('1')
    expect(
      resumo.getByText('Pix não localizado').nextSibling,
    ).toHaveTextContent('1')
    expect(resumo.getByText('Confirmadas').nextSibling).toHaveTextContent('1')
    expect(consultasDoResumo()).toHaveLength(1)
  })

  it('cada linha mostra protocolo, nome, e-mail, CPF inteiro formatado, valor, campanha, quando chegou, prazo e a situação em texto', async () => {
    abrir()
    await esperarALista()
    const maria = within(linhaDe('DOA-2026-00001'))
    expect(maria.getByText('Maria Souza')).toBeInTheDocument()
    expect(maria.getByText('· DOA-2026-00001')).toBeInTheDocument()
    expect(maria.getByText('maria@exemplo.org')).toBeInTheDocument()
    expect(maria.getByText('123.456.789-09')).toBeInTheDocument()
    expect(maria.getByText(/R\$\s*50,00/)).toBeInTheDocument()
    expect(maria.getByText('sem campanha')).toBeInTheDocument()
    expect(
      maria.getByText(formatarData('2026-10-14T15:30:00', { comHora: true })),
    ).toBeInTheDocument()
    expect(
      maria.getByText(formatarData('2026-10-29T15:30:00')),
    ).toBeInTheDocument()
    expect(maria.getByText('Aguardando conferência')).toBeInTheDocument()

    const joao = within(linhaDe('DOA-2026-00002'))
    expect(joao.getByText('não informado')).toBeInTheDocument() // sem CPF
    expect(joao.getByText('sem valor informado')).toBeInTheDocument()
    expect(joao.getByText('Cestas de Natal')).toBeInTheDocument()

    const ana = within(linhaDe('DOA-2026-00003'))
    expect(ana.getByText('Prazo vencido sem confirmação')).toBeInTheDocument()
    expect(ana.getByText(/R\$\s*120,50/)).toBeInTheDocument()
    expect(ana.getByText('987.654.321-00')).toBeInTheDocument()
  })

  it('o que chegou por último e ainda está aguardando vem primeiro, como o servidor manda', async () => {
    abrir()
    await esperarALista()
    const protocolos = screen
      .getAllByRole('listitem')
      .map((li) => /DOA-2026-\d{5}/.exec(li.textContent ?? '')![0])
    expect(protocolos).toEqual([
      'DOA-2026-00002',
      'DOA-2026-00001',
      'DOA-2026-00003',
    ])
  })

  it('doação confirmada mostra o nº do recibo, o valor recebido e a observação, e não oferece confirmar de novo', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    await usuario.selectOptions(
      screen.getByRole('combobox', { name: 'Situação' }),
      'Confirmadas',
    )
    await screen.findByText('Lúcia Martins', { selector: 'p' })
    const lucia = within(linhaDe('DOA-2026-00005'))
    expect(lucia.getByText('Confirmada')).toBeInTheDocument()
    expect(lucia.getByText('nº 9')).toBeInTheDocument()
    // o que vale é o valor RECEBIDO; o informado pelo doador continua à vista, mas não é confundido com ele
    expect(lucia.getByText('Valor recebido').nextSibling).toHaveTextContent(
      /R\$\s*75,50/,
    )
    expect(lucia.getByText('Valor informado').nextSibling).toHaveTextContent(
      /R\$\s*80,00/,
    )
    expect(
      lucia.getByText(formatarData('2026-10-10T14:00:00', { comHora: true })),
    ).toBeInTheDocument()
    expect(lucia.queryByText('Prazo')).toBeNull()
    expect(
      lucia.queryByRole('button', { name: /Confirmar recebimento/ }),
    ).toBeNull()
    expect(
      lucia.queryByRole('button', { name: /Pix não localizado/ }),
    ).toBeNull()
    expect(lucia.queryByText(/o e-mail do recibo não saiu/i)).toBeNull()
  })

  it('"Pix não localizado" mostra a observação e só oferece confirmar (não marcar de novo)', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    await usuario.selectOptions(
      screen.getByRole('combobox', { name: 'Situação' }),
      'Pix não localizado',
    )
    await screen.findByText('Pedro Alves', { selector: 'p' })
    const pedro = within(linhaDe('DOA-2026-00004'))
    expect(
      pedro.getByText('Procurado no extrato dos últimos 10 dias.'),
    ).toBeInTheDocument()
    expect(
      pedro.getByText('Pix não localizado', { selector: 'span' }),
    ).toBeInTheDocument()
    expect(
      pedro.getByRole('button', {
        name: /^Confirmar recebimento de Pedro Alves/,
      }),
    ).toBeInTheDocument()
    expect(
      pedro.queryByRole('button', { name: /^Pix não localizado/ }),
    ).toBeNull()
  })

  it('o prazo vencido ainda pode ser confirmado ou marcado (o dinheiro pode chegar atrasado)', async () => {
    abrir()
    await esperarALista()
    const ana = within(linhaDe('DOA-2026-00003'))
    expect(
      ana.getByRole('button', { name: /^Confirmar recebimento de Ana Lima/ }),
    ).toBeInTheDocument()
    expect(
      ana.getByRole('button', { name: /^Pix não localizado de Ana Lima/ }),
    ).toBeInTheDocument()
  })

  it('quando o servidor diz que não pode confirmar, não há botão de ação', async () => {
    servidor.intencoes = [intencao({ pode_confirmar: false })]
    abrir()
    await esperarALista()
    expect(
      screen.queryByRole('button', { name: /Confirmar recebimento/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Pix não localizado/ }),
    ).toBeNull()
  })

  it('os botões têm nome próprio por doação: duas doações da mesma pessoa se distinguem pelo protocolo', async () => {
    servidor.intencoes = [
      intencao(),
      intencao({
        id_intencao: 6,
        protocolo: 'DOA-2026-00006',
        criado_em: '2026-10-15T10:00:00',
      }),
    ]
    abrir()
    await esperarALista()
    const nomes = screen
      .getAllByRole('button', { name: /^Confirmar recebimento/ })
      .map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(new Set(nomes).size).toBe(2)
    expect(
      screen.getByRole('button', {
        name: 'Confirmar recebimento de Maria Souza (protocolo DOA-2026-00006)',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Confirmar recebimento de Maria Souza (protocolo DOA-2026-00001)',
      }),
    ).toBeInTheDocument()
  })

  it('passa no axe (lista cheia, com todas as situações)', async () => {
    const usuario = userEvent.setup()
    const { container } = abrir()
    await esperarALista()
    await usuario.selectOptions(
      screen.getByRole('combobox', { name: 'Situação' }),
      'Todas',
    )
    await screen.findByText('Lúcia Martins', { selector: 'p' })
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(await axe(container)).toHaveNoViolations()
  })
})

// ----------------------------------------------------------------------------------------------- filtro, busca e paginação
describe('Doações do site: filtro, busca e paginação', () => {
  it('cada opção do filtro manda a situação certa ao servidor, voltando à página 1; "Todas" manda sem situação', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const filtro = screen.getByRole('combobox', { name: 'Situação' })
    for (const [rotulo, situacao] of [
      ['Aguardando conferência', 'PENDENTE'],
      ['Prazo vencido', 'EXPIRADA'],
      ['Pix não localizado', 'NAO_LOCALIZADA'],
      ['Confirmadas', 'CONFIRMADA'],
    ] as const) {
      await usuario.selectOptions(filtro, rotulo)
      await waitFor(() =>
        expect(ultimaConsultaDaLista()).toEqual({
          situacao,
          pagina: '1',
          por_pagina: '25',
        }),
      )
    }
    await usuario.selectOptions(filtro, 'Todas')
    await waitFor(() =>
      expect(ultimaConsultaDaLista()).toEqual({
        pagina: '1',
        por_pagina: '25',
      }),
    )
    expect(ultimaConsultaDaLista()).not.toHaveProperty('situacao')
    await usuario.selectOptions(filtro, 'A conferir')
    await waitFor(() =>
      expect(ultimaConsultaDaLista()).toHaveProperty('situacao', 'a_conferir'),
    )
  })

  it('a busca vai ao servidor depois de uma pausa, sem espaços nas pontas, e vale também com o CPF como a pessoa digita', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    expect(consultasDaLista()).toHaveLength(1)
    const busca = screen.getByRole('searchbox', { name: /^Buscar/ })
    await usuario.type(busca, '  maria  ')
    await waitFor(() =>
      expect(ultimaConsultaDaLista()).toEqual({
        situacao: 'a_conferir',
        busca: 'maria',
        pagina: '1',
        por_pagina: '25',
      }),
    )
    // digitou rápido: uma consulta só (a pausa espera a pessoa parar), não uma por tecla
    expect(consultasDaLista()).toHaveLength(2)
    await waitFor(() => expect(screen.queryByText('João Pereira')).toBeNull())
    expect(
      screen.getByText('Maria Souza', { selector: 'p' }),
    ).toBeInTheDocument()

    await usuario.clear(busca)
    await usuario.type(busca, '123.456.789-09')
    await waitFor(() =>
      expect(ultimaConsultaDaLista()).toHaveProperty('busca', '123.456.789-09'),
    )
    expect(
      await screen.findByText('Maria Souza', { selector: 'p' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Ana Lima')).toBeNull()

    await usuario.clear(busca)
    await waitFor(() =>
      expect(ultimaConsultaDaLista()).not.toHaveProperty('busca'),
    )
    expect(
      await screen.findByText('João Pereira', { selector: 'p' }),
    ).toBeInTheDocument()
  })

  it('a busca sem resultado diz isso (e não "esperando conferência")', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    await usuario.type(
      screen.getByRole('searchbox', { name: /^Buscar/ }),
      'zzz',
    )
    expect(
      await screen.findByText(
        'Nenhuma doação do site encontrada para esta busca.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/esperando conferência/)).toBeNull()
  })

  describe('com mais de 25', () => {
    beforeEach(() => {
      servidor.intencoes = Array.from({ length: 60 }, (_, n) =>
        intencao({
          id_intencao: n + 1,
          protocolo: `DOA-2026-${String(n + 1).padStart(5, '0')}`,
          nome_doador: `Doador ${String(n + 1).padStart(2, '0')}`,
          criado_em: `2026-10-${String(1 + Math.floor(n / 24)).padStart(2, '0')}T${String(n % 24).padStart(2, '0')}:00:00`,
        }),
      )
    })

    it('mostra "Página 1 de 3", pede a página seguinte e a anterior, e desliga os botões nas pontas', async () => {
      const usuario = userEvent.setup()
      abrir()
      await screen.findByText('Página 1 de 3')
      expect(screen.getAllByRole('listitem')).toHaveLength(25)
      expect(screen.getByText('60 doação(ões) do site')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Página anterior' }),
      ).toBeDisabled()

      await usuario.click(
        screen.getByRole('button', { name: 'Próxima página' }),
      )
      await screen.findByText('Página 2 de 3')
      expect(ultimaConsultaDaLista()).toEqual({
        situacao: 'a_conferir',
        pagina: '2',
        por_pagina: '25',
      })
      await usuario.click(
        screen.getByRole('button', { name: 'Próxima página' }),
      )
      await screen.findByText('Página 3 de 3')
      expect(screen.getAllByRole('listitem')).toHaveLength(10)
      expect(
        screen.getByRole('button', { name: 'Próxima página' }),
      ).toBeDisabled()

      await usuario.click(
        screen.getByRole('button', { name: 'Página anterior' }),
      )
      await screen.findByText('Página 2 de 3')
      expect(ultimaConsultaDaLista()).toHaveProperty('pagina', '2')
    })

    it('mudar o filtro ou a busca na página 2 volta para a página 1, sem pedir a página 2 do filtro novo', async () => {
      const usuario = userEvent.setup()
      abrir()
      await screen.findByText('Página 1 de 3')
      await usuario.click(
        screen.getByRole('button', { name: 'Próxima página' }),
      )
      await screen.findByText('Página 2 de 3')

      await usuario.selectOptions(
        screen.getByRole('combobox', { name: 'Situação' }),
        'Aguardando conferência',
      )
      await screen.findByText('Página 1 de 3')
      expect(
        consultasDaLista()
          .map(parametrosDe)
          .filter((p) => p.situacao === 'PENDENTE' && p.pagina !== '1'),
      ).toHaveLength(0)

      await usuario.click(
        screen.getByRole('button', { name: 'Próxima página' }),
      )
      await screen.findByText('Página 2 de 3')
      await usuario.type(
        screen.getByRole('searchbox', { name: /^Buscar/ }),
        'Doador',
      )
      await waitFor(() =>
        expect(ultimaConsultaDaLista()).toHaveProperty('busca', 'Doador'),
      )
      expect(ultimaConsultaDaLista()).toHaveProperty('pagina', '1')
      expect(
        consultasDaLista()
          .map(parametrosDe)
          .filter((p) => p.busca === 'Doador' && p.pagina !== '1'),
      ).toHaveLength(0)
    })

    it('confirmar o único item da última página volta uma página, em vez de deixar uma página vazia', async () => {
      const usuario = userEvent.setup()
      servidor.intencoes = servidor.intencoes.slice(0, 26)
      abrir()
      await screen.findByText('Página 1 de 2')
      await usuario.click(
        screen.getByRole('button', { name: 'Próxima página' }),
      )
      await screen.findByText('Página 2 de 2')
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      const unico = screen.getAllByRole('listitem')[0]!
      const protocolo = /DOA-2026-\d{5}/.exec(unico.textContent ?? '')![0]

      const dialogo = await abrirConfirmacao(usuario, protocolo)
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      await screen.findByText(/confirmada: recibo nº 12 emitido/)
      await waitFor(() =>
        expect(ultimaConsultaDaLista()).toEqual({
          situacao: 'a_conferir',
          pagina: '1',
          por_pagina: '25',
        }),
      )
      expect(await screen.findAllByRole('listitem')).toHaveLength(25)
      expect(screen.queryByText(/Nenhuma doação/)).toBeNull()
    })

    it('marcar como "Pix não localizado" o único item da última página também volta uma página', async () => {
      const usuario = userEvent.setup()
      servidor.intencoes = servidor.intencoes.slice(0, 26)
      abrir()
      await screen.findByText('Página 1 de 2')
      await usuario.click(
        screen.getByRole('button', { name: 'Próxima página' }),
      )
      await screen.findByText('Página 2 de 2')
      const protocolo = /DOA-2026-\d{5}/.exec(
        screen.getAllByRole('listitem')[0]!.textContent ?? '',
      )![0]

      const dialogo = await abrirNaoLocalizada(usuario, protocolo)
      await usuario.click(
        within(dialogo).getByRole('button', {
          name: 'Marcar como não localizado',
        }),
      )
      await screen.findByText(/marcado como não localizado/)
      await waitFor(() =>
        expect(ultimaConsultaDaLista()).toEqual({
          situacao: 'a_conferir',
          pagina: '1',
          por_pagina: '25',
        }),
      )
      expect(await screen.findAllByRole('listitem')).toHaveLength(25)
    })

    it('em "Todas" a doação confirmada continua na lista, então a página não recua', async () => {
      const usuario = userEvent.setup()
      servidor.intencoes = servidor.intencoes.slice(0, 26)
      abrir()
      await screen.findByText('Página 1 de 2')
      await usuario.selectOptions(
        screen.getByRole('combobox', { name: 'Situação' }),
        'Todas',
      )
      await waitFor(() =>
        expect(ultimaConsultaDaLista()).not.toHaveProperty('situacao'),
      )
      await usuario.click(
        await screen.findByRole('button', { name: 'Próxima página' }),
      )
      await screen.findByText('Página 2 de 2')
      const protocolo = /DOA-2026-\d{5}/.exec(
        screen.getAllByRole('listitem')[0]!.textContent ?? '',
      )![0]

      const dialogo = await abrirConfirmacao(usuario, protocolo)
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      await screen.findByText(/confirmada: recibo nº 12 emitido/)
      await waitFor(() =>
        expect(
          within(linhaDe(protocolo)).getByText('Confirmada'),
        ).toBeVisible(),
      )
      expect(ultimaConsultaDaLista()).toHaveProperty('pagina', '2')
      expect(screen.getByText('Página 2 de 2')).toBeInTheDocument()
    })

    it('se a página ficou vazia por outro motivo (outra pessoa já resolveu), avisa e deixa voltar', async () => {
      const usuario = userEvent.setup()
      servidor.intencoes = servidor.intencoes.slice(0, 26)
      abrir()
      await screen.findByText('Página 1 de 2')
      await usuario.click(
        screen.getByRole('button', { name: 'Próxima página' }),
      )
      await screen.findByText('Página 2 de 2')
      const protocolo = /DOA-2026-\d{5}/.exec(
        screen.getAllByRole('listitem')[0]!.textContent ?? '',
      )![0]
      const dialogo = await abrirConfirmacao(usuario, protocolo)
      await preencherContas(usuario, dialogo)
      // enquanto o diálogo estava aberto, a doação sumiu da fila (resolvida em outra aba)
      servidor.intencoes = servidor.intencoes.filter(
        (i) => i.protocolo !== protocolo,
      )
      await usuario.click(botaoConfirmar(dialogo))
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Doação a conferir não encontrada.',
      )
      await usuario.click(
        within(dialogo).getByRole('button', { name: 'Cancelar' }),
      )
      expect(
        await screen.findByText(
          'Não há doações nesta página: use “Página anterior”.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByText('Página 2 de 1')).toBeInTheDocument()
      expect(screen.queryByText(/Nenhuma doação do site/)).toBeNull()
      await usuario.click(
        screen.getByRole('button', { name: 'Página anterior' }),
      )
      expect(await screen.findAllByRole('listitem')).toHaveLength(25)
    })
  })

  it('lista vazia no filtro padrão: "Nenhuma doação do site esperando conferência."', async () => {
    servidor.intencoes = [
      intencao({ status: 'CONFIRMADA', numero_recibo: 3, id_doacao: 3 }),
    ]
    abrir()
    expect(
      await screen.findByText('Nenhuma doação do site esperando conferência.'),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.queryByRole('navigation', { name: /Páginas/ })).toBeNull()
  })

  it('lista vazia em outro filtro tem a mensagem do filtro', async () => {
    const usuario = userEvent.setup()
    servidor.intencoes = [intencao()]
    abrir()
    await esperarALista()
    await usuario.selectOptions(
      screen.getByRole('combobox', { name: 'Situação' }),
      'Confirmadas',
    )
    expect(
      await screen.findByText(
        'Nenhuma doação do site encontrada com este filtro.',
      ),
    ).toBeInTheDocument()
  })

  it('enquanto carrega, diz que está carregando', async () => {
    let liberar: () => void = () => undefined
    servidor.segurarListaAte = new Promise<void>((resolve) => {
      liberar = resolve
    })
    abrir()
    expect(
      await screen.findByText('Carregando as doações do site…'),
    ).toBeInTheDocument()
    liberar()
    await esperarALista()
    expect(screen.queryByText('Carregando as doações do site…')).toBeNull()
  })

  it('se a lista não carrega, mostra o erro e "Tentar de novo" busca de novo (lista e resumo)', async () => {
    const usuario = userEvent.setup()
    servidor.falharLista = true
    abrir()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as doações do site. Tente de novo.',
    )
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    const resumosAntes = consultasDoResumo().length
    servidor.falharLista = false
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await esperarALista()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(consultasDoResumo().length).toBeGreaterThan(resumosAntes)
  })

  it('se só o resumo falha, a lista aparece e o aviso é discreto (sem alerta)', async () => {
    servidor.falharResumo = true
    abrir()
    await esperarALista()
    expect(
      await screen.findByText('Não foi possível carregar o resumo agora.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      resumoNaTela().getByText('A conferir').nextSibling,
    ).toHaveTextContent('—')
  })
})

// ----------------------------------------------------------------------------------------------- a página de doação do site
describe('Doações do site: a página de doação do site está aberta?', () => {
  it('aberta: diz que está aberta, sem link nem aviso', async () => {
    abrir()
    expect(
      await screen.findByText('A página de doação do site está aberta.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/está fechada/)).toBeNull()
    expect(screen.queryByRole('link', { name: /Instituição/ })).toBeNull()
  })

  it('fechada, para quem administra: explica o que preencher e leva para Instituição', async () => {
    permissoes.atuais = ['financeiro', 'gerenciar_acesso']
    servidor.pixDisponivel = false
    abrir()
    expect(
      await screen.findByText(/A página de doação do site está fechada/),
    ).toHaveTextContent(
      'está fechada: preencha a Chave Pix e marque “Aparece no site” em Instituição.',
    )
    expect(
      screen.getByRole('link', { name: 'Abrir Instituição' }),
    ).toHaveAttribute('href', '/instituicao')
    expect(
      screen.queryByText('A página de doação do site está aberta.'),
    ).toBeNull()
  })

  it('fechada, para a tesouraria sem acesso a Instituição: vê o aviso, sem link, e o painel não pede nada de Instituição', async () => {
    servidor.pixDisponivel = false
    abrir()
    expect(
      await screen.findByText(/A página de doação do site está fechada/),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Peça a quem administra o sistema.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Instituição/ })).toBeNull()
    expect(chamadas.some((c) => c.caminho.startsWith('/api/instituicao'))).toBe(
      false,
    )
  })

  it('se não der para conferir, diz isso com discrição e o resto da seção funciona', async () => {
    servidor.falharPix = true
    abrir()
    await esperarALista()
    expect(
      await screen.findByText(
        'Não foi possível conferir se a página de doação do site está aberta.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ----------------------------------------------------------------------------------------------- permissão
describe('Doações do site: permissão', () => {
  it('sem a permissão financeiro, a seção diz que não pode e nem consulta o servidor', async () => {
    permissoes.atuais = ['documentos']
    abrir()
    expect(
      await screen.findByText(
        'Você não tem permissão para conferir as doações feitas pelo site.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('combobox')).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(chamadas).toHaveLength(0)
  })

  it('enquanto ainda não se sabe quem é o usuário, não mostra nada e não consulta o servidor', async () => {
    permissoes.atuais = null
    const { container } = abrir()
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
    expect(chamadas).toHaveLength(0)
  })
})

// ----------------------------------------------------------------------------------------------- confirmar recebimento
describe('Confirmar recebimento', () => {
  it('abre o diálogo com a explicação, os dados da doação, o valor informado já preenchido e o foco no valor; passa no axe', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirConfirmacao(usuario)
    expect(dialogo).toHaveAccessibleName('Confirmar o Pix de Maria Souza')
    expect(dialogo).toHaveAccessibleDescription(
      /Confirme só depois de achar este Pix no extrato do banco da associação\. Ao confirmar, o sistema registra a doação, emite o recibo numerado e envia o recibo por e-mail para maria@exemplo\.org\. Não dá para desfazer\./,
    )
    expect(within(dialogo).getByText('DOA-2026-00001')).toBeInTheDocument()
    expect(within(dialogo).getByText('123.456.789-09')).toBeInTheDocument()
    expect(within(dialogo).getByText(/R\$\s*50,00/)).toBeInTheDocument()

    const valor = campoValor(dialogo)
    expect(valor).toHaveValue('50,00')
    expect(valor).toHaveFocus()
    expect(valor).toHaveAccessibleDescription(
      /É o valor que vale: o que entrou no extrato, mesmo que seja diferente do informado\./,
    )
    expect(selectReceita(dialogo)).toHaveValue('')
    expect(selectCaixa(dialogo)).toHaveValue('')
    expect(escritas()).toHaveLength(0)
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('sem valor informado, o campo do valor começa vazio', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirConfirmacao(usuario, 'DOA-2026-00002')
    expect(campoValor(dialogo)).toHaveValue('')
    expect(within(dialogo).getByText('sem valor informado')).toBeInTheDocument()
    expect(within(dialogo).getByText('Cestas de Natal')).toBeInTheDocument()
    expect(within(dialogo).getByText('não informado')).toBeInTheDocument()
  })

  it('as contas oferecidas são as do formulário de doações: receita só de Receita, caixa só de Ativo, nenhuma conta sintética', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirConfirmacao(usuario)
    expect(
      within(selectReceita(dialogo))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Escolha a conta de receita…',
      '4.1.01 — Doações recebidas',
      '4.1.02 — Mensalidades',
    ])
    expect(
      within(selectCaixa(dialogo))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Escolha a conta de caixa ou banco…',
      '1.1.01 — Caixa',
      '1.1.02 — Banco do Brasil',
    ])
    expect(
      within(selectDestinacao(dialogo))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Sem destinação específica',
      'Projeto Despertai',
      'Manutenção da sede',
    ])
  })

  it('envia o valor, a conta de receita e a de caixa certos (e nada de destinação quando não há); o recibo emitido aparece em destaque e a lista e o resumo se atualizam', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirConfirmacao(usuario)
    await usuario.selectOptions(selectReceita(dialogo), '4.1.02 — Mensalidades')
    await usuario.selectOptions(selectCaixa(dialogo), '1.1.01 — Caixa')
    const listasAntes = consultasDaLista().length
    const resumosAntes = consultasDoResumo().length
    await usuario.click(botaoConfirmar(dialogo))

    await waitFor(() => expect(confirmacoes()).toHaveLength(1))
    expect(confirmacoes()[0]).toEqual({
      metodo: 'POST',
      caminho: '/api/intencoes-doacao/1/confirmar',
      corpo: {
        valor_recebido: 50,
        id_conta_contabil: 5,
        id_conta_contabil_caixa: 1,
      },
    })

    // o resultado fica à vista (a linha sai do filtro "A conferir"), com o foco nele
    const resultado = await screen.findByRole('group', {
      name: 'Resultado da última ação',
    })
    expect(within(resultado).getByRole('status')).toHaveTextContent(
      /Doação de Maria Souza confirmada: recibo nº 12 emitido \(R\$\s*50,00\)\. O recibo foi enviado por e-mail para maria@exemplo\.org\./,
    )
    expect(within(resultado).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(resultado).toHaveFocus())
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // lista e resumo foram buscados de novo
    await waitFor(() =>
      expect(consultasDaLista().length).toBeGreaterThan(listasAntes),
    )
    await waitFor(() =>
      expect(consultasDoResumo().length).toBeGreaterThan(resumosAntes),
    )
    await waitFor(() =>
      expect(screen.queryByText('Maria Souza', { selector: 'p' })).toBeNull(),
    )
    await waitFor(() =>
      expect(
        resumoNaTela().getByText('A conferir').nextSibling,
      ).toHaveTextContent('2'),
    )
    expect(
      resumoNaTela().getByText('Confirmadas').nextSibling,
    ).toHaveTextContent('2')
  })

  it('o valor recebido pode ser diferente do informado e aceita a escrita brasileira ("1.200,50")', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirConfirmacao(usuario)
    await usuario.clear(campoValor(dialogo))
    await usuario.type(campoValor(dialogo), '1.200,50')
    await preencherContas(usuario, dialogo)
    await usuario.click(botaoConfirmar(dialogo))
    await waitFor(() => expect(confirmacoes()).toHaveLength(1))
    expect(confirmacoes()[0]!.corpo).toMatchObject({ valor_recebido: 1200.5 })
    expect(await screen.findByRole('status')).toHaveTextContent(
      /recibo nº 12 emitido \(R\$\s*1\.200,50\)/,
    )
  })

  it('a doação sem valor informado é confirmada com o valor digitado', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirConfirmacao(usuario, 'DOA-2026-00002')
    await usuario.type(campoValor(dialogo), '35')
    await preencherContas(usuario, dialogo)
    await usuario.click(botaoConfirmar(dialogo))
    await waitFor(() => expect(confirmacoes()).toHaveLength(1))
    expect(confirmacoes()[0]!.caminho).toBe('/api/intencoes-doacao/2/confirmar')
    expect(confirmacoes()[0]!.corpo).toMatchObject({ valor_recebido: 35 })
  })

  describe('a destinação', () => {
    it('com campanha que tem destinação, já vem escolhida e a explicação diz que é a da campanha; é enviada', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario, 'DOA-2026-00002')
      const destinacao = selectDestinacao(dialogo)
      expect(destinacao).toHaveValue('7')
      expect(
        within(destinacao).getByRole('option', { name: 'Projeto Despertai' }),
      ).toHaveProperty('selected', true)
      expect(destinacao).toHaveAccessibleDescription(
        /A destinação da campanha “Cestas de Natal” já vem escolhida\. Para mandar a doação a outro fim, escolha outro centro de custo\./,
      )
      expect(within(destinacao).getAllByRole('option')[0]).toHaveTextContent(
        'Usar a destinação da campanha',
      )

      await usuario.type(campoValor(dialogo), '40')
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      await waitFor(() => expect(confirmacoes()).toHaveLength(1))
      expect(confirmacoes()[0]!.corpo).toEqual({
        valor_recebido: 40,
        id_conta_contabil: 4,
        id_conta_contabil_caixa: 2,
        id_centro_custo_destinacao: 7,
      })
      expect(servidor.destinacaoUsada).toBe(7)
    })

    it('dá para escolher outra destinação (a escolhida é a enviada)', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario, 'DOA-2026-00002')
      await usuario.selectOptions(
        selectDestinacao(dialogo),
        'Manutenção da sede',
      )
      await usuario.type(campoValor(dialogo), '40')
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      await waitFor(() => expect(confirmacoes()).toHaveLength(1))
      expect(confirmacoes()[0]!.corpo).toMatchObject({
        id_centro_custo_destinacao: 8,
      })
      expect(servidor.destinacaoUsada).toBe(8)
    })

    it('"Usar a destinação da campanha" não manda o campo (o servidor usa a da campanha)', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario, 'DOA-2026-00002')
      await usuario.selectOptions(
        selectDestinacao(dialogo),
        'Usar a destinação da campanha',
      )
      await usuario.type(campoValor(dialogo), '40')
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      await waitFor(() => expect(confirmacoes()).toHaveLength(1))
      expect(confirmacoes()[0]!.corpo).not.toHaveProperty(
        'id_centro_custo_destinacao',
      )
      expect(servidor.destinacaoUsada).toBe(7)
    })

    it('sem campanha, a destinação é opcional e começa em branco', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      expect(selectDestinacao(dialogo)).toHaveValue('')
      expect(selectDestinacao(dialogo)).toHaveAccessibleDescription(
        /^Opcional\./,
      )
      await usuario.selectOptions(
        selectDestinacao(dialogo),
        'Projeto Despertai',
      )
      await usuario.selectOptions(
        selectDestinacao(dialogo),
        'Sem destinação específica',
      )
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      await waitFor(() => expect(confirmacoes()).toHaveLength(1))
      expect(confirmacoes()[0]!.corpo).not.toHaveProperty(
        'id_centro_custo_destinacao',
      )
    })
  })

  describe('o e-mail do recibo', () => {
    it('se o e-mail não saiu, o aviso fica visível e diz para entregar o recibo por outro meio, e a linha confirmada guarda o aviso com "Ver recibo"', async () => {
      const usuario = userEvent.setup()
      servidor.emailDoReciboFalha = true
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))

      const resultado = await screen.findByRole('group', {
        name: 'Resultado da última ação',
      })
      expect(within(resultado).getByRole('status')).toHaveTextContent(
        /Doação de Maria Souza confirmada: recibo nº 12 emitido/,
      )
      expect(within(resultado).getByRole('status')).not.toHaveTextContent(
        /foi enviado por e-mail/,
      )
      expect(within(resultado).getByRole('alert')).toHaveTextContent(
        'A doação foi registrada e o recibo emitido, mas o e-mail não saiu: entregue o recibo por outro meio (o endereço é maria@exemplo.org).',
      )

      // depois, na lista das confirmadas, o aviso continua e dá para abrir o recibo
      await usuario.selectOptions(
        screen.getByRole('combobox', { name: 'Situação' }),
        'Confirmadas',
      )
      await waitFor(() =>
        expect(screen.getAllByRole('listitem')).toHaveLength(2),
      )
      const maria = within(linhaDe('DOA-2026-00001'))
      expect(maria.getByText(/O e-mail do recibo não saiu/)).toBeInTheDocument()
      await usuario.click(
        maria.getByRole('button', { name: /^Ver recibo de Maria Souza/ }),
      )
      expect(
        await maria.findByText('RECIBO Nº 112 DA ASAF'),
      ).toBeInTheDocument()
    })

    it('o "Ver recibo" de uma doação confirmada abre o texto do recibo daquela doação; se não abrir, o motivo aparece junto do botão', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      await usuario.selectOptions(
        screen.getByRole('combobox', { name: 'Situação' }),
        'Confirmadas',
      )
      await screen.findByText('Lúcia Martins', { selector: 'p' })
      const lucia = within(linhaDe('DOA-2026-00005'))
      await usuario.click(
        lucia.getByRole('button', { name: /^Ver recibo de Lúcia Martins/ }),
      )
      expect(await lucia.findByText('RECIBO Nº 9 DA ASAF')).toBeInTheDocument()
      expect(chamadas.some((c) => c.caminho === '/api/doacoes/9/recibo')).toBe(
        true,
      )

      servidor.falharRecibo = true
      await usuario.click(
        lucia.getByRole('button', { name: /^Ver recibo de Lúcia Martins/ }),
      )
      expect(await lucia.findByRole('alert')).toHaveTextContent(
        'Recibo não encontrado.',
      )
    })

    it('se o e-mail saiu, não há aviso de falha', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      await screen.findByRole('status')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByText(/o e-mail não saiu/)).toBeNull()
    })
  })

  describe('quando o servidor recusa', () => {
    it('o motivo aparece como veio, em alerta dentro do diálogo; o que foi preenchido fica; nada muda na lista', async () => {
      const usuario = userEvent.setup()
      servidor.recusarConfirmacao = {
        status: 400,
        corpo: { detail: 'Esta doação já foi confirmada.' },
      }
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Esta doação já foi confirmada.',
      )
      expect(screen.getByRole('alertdialog')).toBe(dialogo)
      expect(selectReceita(dialogo)).toHaveValue('4')
      expect(selectCaixa(dialogo)).toHaveValue('2')
      expect(campoValor(dialogo)).toHaveValue('50,00')
      expect(
        screen.queryByRole('group', { name: 'Resultado da última ação' }),
      ).toBeNull()
      expect(confirmacoes()).toHaveLength(1)

      await usuario.click(
        within(dialogo).getByRole('button', { name: 'Cancelar' }),
      )
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      expect(
        screen.getByText('Maria Souza', { selector: 'p' }),
      ).toBeInTheDocument()
    })

    it('a recusa faz o painel conferir a lista de novo (outra aba pode ter confirmado)', async () => {
      const usuario = userEvent.setup()
      servidor.recusarConfirmacao = {
        status: 400,
        corpo: { detail: 'Esta doação já foi confirmada.' },
      }
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await preencherContas(usuario, dialogo)
      const antes = consultasDaLista().length
      await usuario.click(botaoConfirmar(dialogo))
      await within(dialogo).findByRole('alert')
      await waitFor(() =>
        expect(consultasDaLista().length).toBeGreaterThan(antes),
      )
    })

    it('o valor recusado pelo servidor (422) aparece embaixo do campo, sem o jargão "Value error"', async () => {
      const usuario = userEvent.setup()
      servidor.recusarConfirmacao = {
        status: 422,
        corpo: {
          detail: [
            {
              loc: ['body', 'valor_recebido'],
              msg: 'Value error, Esse valor é alto demais para o Pix pelo site: fale com a secretaria.',
              type: 'value_error',
            },
          ],
        },
      }
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Esse valor é alto demais para o Pix pelo site: fale com a secretaria.',
      )
      expect(within(dialogo).queryByText(/Value error/)).toBeNull()
    })

    it('falha de rede também aparece, em português', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await preencherContas(usuario, dialogo)
      servidor.recusarConfirmacao = {
        status: 500,
        corpo: { detail: 'Erro interno ao registrar a doação.' },
      }
      await usuario.click(botaoConfirmar(dialogo))
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Erro interno ao registrar a doação.',
      )
    })
  })

  describe('o que o painel recusa antes de enviar', () => {
    it('sem escolher as contas NÃO envia nada e diz o que falta, em cada campo', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await usuario.click(botaoConfirmar(dialogo))
      expect(
        await within(dialogo).findByText('Escolha a conta de receita.'),
      ).toBeInTheDocument()
      expect(
        within(dialogo).getByText(
          'Escolha a conta de caixa ou banco onde o Pix caiu.',
        ),
      ).toBeInTheDocument()
      expect(selectReceita(dialogo)).toBeInvalid()
      expect(selectCaixa(dialogo)).toBeInvalid()
      expect(escritas()).toHaveLength(0)
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    it('escolhendo só a conta de receita, ainda falta a de caixa', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await usuario.selectOptions(
        selectReceita(dialogo),
        '4.1.01 — Doações recebidas',
      )
      await usuario.click(botaoConfirmar(dialogo))
      expect(
        await within(dialogo).findByText(
          'Escolha a conta de caixa ou banco onde o Pix caiu.',
        ),
      ).toBeInTheDocument()
      expect(
        within(dialogo).queryByText('Escolha a conta de receita.'),
      ).toBeNull()
      expect(escritas()).toHaveLength(0)
    })

    it.each([
      ['vazio', ''],
      ['zero', '0'],
      ['zero com vírgula', '0,00'],
      ['letras', 'abc'],
      ['duas vírgulas', '1,2,3'],
      ['negativo', '-5'],
    ])('valor %s NÃO é enviado', async (_nome, digitado) => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await usuario.clear(campoValor(dialogo))
      if (digitado) await usuario.type(campoValor(dialogo), digitado)
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      expect(
        await within(dialogo).findByText(
          'Informe o valor que chegou no extrato, maior que zero (ex.: 50,00).',
        ),
      ).toBeInTheDocument()
      expect(campoValor(dialogo)).toBeInvalid()
      expect(escritas()).toHaveLength(0)
    })
  })

  describe('abrir, cancelar e enviar', () => {
    it('"Cancelar" fecha sem enviar nada e devolve o foco ao botão que abriu', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await usuario.click(
        within(dialogo).getByRole('button', { name: 'Cancelar' }),
      )
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(escritas()).toHaveLength(0)
      const botao = within(linhaDe('DOA-2026-00001')).getByRole('button', {
        name: /^Confirmar recebimento de Maria Souza/,
      })
      await waitFor(() => expect(botao).toHaveFocus())
    })

    it('Esc também fecha sem enviar', async () => {
      const usuario = userEvent.setup()
      abrir()
      await esperarALista()
      await abrirConfirmacao(usuario)
      await usuario.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(escritas()).toHaveLength(0)
    })

    it('enquanto envia, mostra "Confirmando…", desliga os botões, não fecha com Esc e um segundo clique não manda de novo', async () => {
      const usuario = userEvent.setup()
      let liberar: () => void = () => undefined
      servidor.segurarConfirmacaoAte = new Promise<void>((resolve) => {
        liberar = resolve
      })
      abrir()
      await esperarALista()
      const dialogo = await abrirConfirmacao(usuario)
      await preencherContas(usuario, dialogo)
      await usuario.click(botaoConfirmar(dialogo))
      const enviando = await within(dialogo).findByRole('button', {
        name: 'Confirmando…',
      })
      expect(enviando).toBeDisabled()
      expect(
        within(dialogo).getByRole('button', { name: 'Cancelar' }),
      ).toBeDisabled()
      await usuario.click(enviando)
      await usuario.keyboard('{Escape}')
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      liberar()
      await screen.findByRole('group', { name: 'Resultado da última ação' })
      expect(confirmacoes()).toHaveLength(1)
    })

    it('se as contas não carregam, avisa, deixa tentar de novo e só depois mostra o formulário', async () => {
      const usuario = userEvent.setup()
      servidor.falharContas = true
      abrir()
      await esperarALista()
      await usuario.click(
        within(linhaDe('DOA-2026-00001')).getByRole('button', {
          name: /^Confirmar recebimento de /,
        }),
      )
      const dialogo = await screen.findByRole('alertdialog')
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Não foi possível carregar as contas. Tente de novo.',
      )
      expect(within(dialogo).queryByLabelText('Valor recebido (R$)')).toBeNull()
      expect(
        within(dialogo).queryByRole('button', {
          name: 'Confirmar recebimento',
        }),
      ).toBeNull()
      servidor.falharContas = false
      await usuario.click(
        within(dialogo).getByRole('button', { name: 'Tentar de novo' }),
      )
      expect(
        await within(dialogo).findByLabelText('Valor recebido (R$)'),
      ).toHaveValue('50,00')
      expect(within(dialogo).queryByRole('alert')).toBeNull()
    })
  })
})

// ----------------------------------------------------------------------------------------------- pix não localizado
describe('Pix não localizado', () => {
  it('abre o diálogo explicando que nada é apagado, com o foco na observação; passa no axe', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario)
    expect(dialogo).toHaveAccessibleName('Pix de Maria Souza não localizado')
    expect(dialogo).toHaveAccessibleDescription(
      /Nada é apagado: se o dinheiro chegar depois, ainda dá para confirmar o recebimento\./,
    )
    const observacao = within(dialogo).getByLabelText('Observação (opcional)')
    expect(observacao).toHaveFocus()
    expect(observacao).toHaveAttribute('maxlength', '300')
    expect(observacao).toHaveAccessibleDescription(/Até 300 letras\./)
    expect(escritas()).toHaveLength(0)
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('com observação: envia o texto (sem espaços nas pontas); o aviso diz que ainda dá para confirmar; a linha sai de "A conferir"', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario)
    await usuario.type(
      within(dialogo).getByLabelText('Observação (opcional)'),
      '  Procurei de 10 a 15/10, nenhum Pix.  ',
    )
    await usuario.click(
      within(dialogo).getByRole('button', {
        name: 'Marcar como não localizado',
      }),
    )
    await waitFor(() => expect(marcacoes()).toHaveLength(1))
    expect(marcacoes()[0]).toEqual({
      metodo: 'POST',
      caminho: '/api/intencoes-doacao/1/nao-localizada',
      corpo: { observacao: 'Procurei de 10 a 15/10, nenhum Pix.' },
    })
    const resultado = await screen.findByRole('group', {
      name: 'Resultado da última ação',
    })
    expect(within(resultado).getByRole('status')).toHaveTextContent(
      'Pix de Maria Souza marcado como não localizado. Nada foi apagado: se o dinheiro chegar depois, escolha “Pix não localizado” no filtro e confirme o recebimento.',
    )
    await waitFor(() => expect(resultado).toHaveFocus())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() =>
      expect(screen.queryByText('Maria Souza', { selector: 'p' })).toBeNull(),
    )
    await waitFor(() =>
      expect(
        resumoNaTela().getByText('A conferir').nextSibling,
      ).toHaveTextContent('2'),
    )
    expect(
      resumoNaTela().getByText('Pix não localizado').nextSibling,
    ).toHaveTextContent('2')

    // a observação ficou e a doação continua podendo ser confirmada
    await usuario.selectOptions(
      screen.getByRole('combobox', { name: 'Situação' }),
      'Pix não localizado',
    )
    const maria = await screen.findByText('Procurei de 10 a 15/10, nenhum Pix.')
    expect(maria).toBeInTheDocument()
    expect(
      within(linhaDe('DOA-2026-00001')).getByRole('button', {
        name: /^Confirmar recebimento de Maria Souza/,
      }),
    ).toBeInTheDocument()
  })

  it('vale para a doação em que se clicou, não para a primeira da lista', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario, 'DOA-2026-00002')
    expect(dialogo).toHaveAccessibleName('Pix de João Pereira não localizado')
    await usuario.click(
      within(dialogo).getByRole('button', {
        name: 'Marcar como não localizado',
      }),
    )
    await waitFor(() => expect(marcacoes()).toHaveLength(1))
    expect(marcacoes()[0]!.caminho).toBe(
      '/api/intencoes-doacao/2/nao-localizada',
    )
    expect(servidor.intencoes.find((i) => i.id_intencao === 2)!.status).toBe(
      'NAO_LOCALIZADA',
    )
    expect(servidor.intencoes.find((i) => i.id_intencao === 1)!.status).toBe(
      'PENDENTE',
    )
  })

  it('sem observação: o corpo vai sem o campo', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario)
    await usuario.click(
      within(dialogo).getByRole('button', {
        name: 'Marcar como não localizado',
      }),
    )
    await waitFor(() => expect(marcacoes()).toHaveLength(1))
    expect(marcacoes()[0]!.corpo).toEqual({})
    await screen.findByRole('status')
  })

  it('observação só de espaços conta como sem observação', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario)
    await usuario.type(
      within(dialogo).getByLabelText('Observação (opcional)'),
      '    ',
    )
    await usuario.click(
      within(dialogo).getByRole('button', {
        name: 'Marcar como não localizado',
      }),
    )
    await waitFor(() => expect(marcacoes()).toHaveLength(1))
    expect(marcacoes()[0]!.corpo).toEqual({})
  })

  it('"Cancelar" fecha sem enviar e devolve o foco ao botão', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario)
    await usuario.click(
      within(dialogo).getByRole('button', { name: 'Cancelar' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(escritas()).toHaveLength(0)
    await waitFor(() =>
      expect(
        within(linhaDe('DOA-2026-00001')).getByRole('button', {
          name: /^Pix não localizado de Maria Souza/,
        }),
      ).toHaveFocus(),
    )
  })

  it('a recusa do servidor aparece como veio, dentro do diálogo, e a lista não muda', async () => {
    const usuario = userEvent.setup()
    servidor.recusarNaoLocalizada = {
      status: 400,
      corpo: { detail: 'Esta doação já foi confirmada.' },
    }
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario)
    await usuario.type(
      within(dialogo).getByLabelText('Observação (opcional)'),
      'nada',
    )
    await usuario.click(
      within(dialogo).getByRole('button', {
        name: 'Marcar como não localizado',
      }),
    )
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'Esta doação já foi confirmada.',
    )
    expect(within(dialogo).getByLabelText('Observação (opcional)')).toHaveValue(
      'nada',
    )
    expect(
      screen.queryByRole('group', { name: 'Resultado da última ação' }),
    ).toBeNull()
    await usuario.click(
      within(dialogo).getByRole('button', { name: 'Cancelar' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('o aviso do resultado pode ser dispensado', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario)
    await usuario.click(
      within(dialogo).getByRole('button', {
        name: 'Marcar como não localizado',
      }),
    )
    await screen.findByRole('status')
    await usuario.click(screen.getByRole('button', { name: 'Dispensar aviso' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(
      screen.queryByRole('group', { name: 'Resultado da última ação' }),
    ).toBeNull()
  })

  it('abrir outra ação some com o aviso da anterior', async () => {
    const usuario = userEvent.setup()
    abrir()
    await esperarALista()
    const dialogo = await abrirNaoLocalizada(usuario)
    await usuario.click(
      within(dialogo).getByRole('button', {
        name: 'Marcar como não localizado',
      }),
    )
    await screen.findByRole('status')
    await abrirConfirmacao(usuario, 'DOA-2026-00002')
    expect(
      screen.queryByRole('group', {
        name: 'Resultado da última ação',
        hidden: true,
      }),
    ).toBeNull()
  })
})

// ----------------------------------------------------------------------------------------------- a tela de Doações inteira
describe('Tela de Doações: a seção do site no meio do que já existia', () => {
  it('a seção vem primeiro e a doação confirmada aparece em "Doações registradas" sem recarregar (e as campanhas são conferidas de novo)', async () => {
    const usuario = userEvent.setup()
    renderizar(<DoacoesPage />)
    await esperarALista()
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      'Doações do site (Pix)',
      'Campanhas de arrecadação',
      'Doações registradas',
    ])
    expect(screen.getByText('Nenhuma doação registrada.')).toBeInTheDocument()
    const doacoesAntes = chamadas.filter(
      (c) => c.caminho === '/api/doacoes/',
    ).length
    const campanhasAntes = chamadas.filter(
      (c) => c.caminho === '/api/campanhas-arrecadacao/',
    ).length

    const dialogo = await abrirConfirmacao(usuario)
    await preencherContas(usuario, dialogo)
    await usuario.click(botaoConfirmar(dialogo))

    await screen.findByRole('group', { name: 'Resultado da última ação' })
    expect(
      await screen.findByText(/Maria Souza — R\$\s*50,00/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma doação registrada.')).toBeNull()
    expect(
      chamadas.filter((c) => c.caminho === '/api/doacoes/').length,
    ).toBeGreaterThan(doacoesAntes)
    expect(
      chamadas.filter((c) => c.caminho === '/api/campanhas-arrecadacao/')
        .length,
    ).toBeGreaterThan(campanhasAntes)
  })

  it('os botões "Ver recibo" das doações já registradas seguem com o nome de sempre', async () => {
    servidor.doacoes = [
      {
        id_doacao: 3,
        anonima: false,
        nome_doador: 'Carlos',
        documento_doador: null,
        id_associado: null,
        tipo_doacao: 'Monetaria',
        recorrente: false,
        valor: 10,
        descricao_bem: null,
        id_campanha: null,
        id_centro_custo_destinacao: null,
        numero_recibo: 3,
        id_titulo: null,
        data_doacao: '2026-10-01',
      },
    ]
    const usuario = userEvent.setup()
    renderizar(<DoacoesPage />)
    await esperarALista()
    const botao = await screen.findByRole('button', { name: 'Ver recibo' })
    await usuario.click(botao)
    expect(await screen.findByText('RECIBO Nº 3 DA ASAF')).toBeInTheDocument()
  })
})

// ----------------------------------------------------------------------------------------------- as regras dos formulários
describe('Regras do formulário de confirmação', () => {
  it('valor e contas: o que passa e o que não passa', () => {
    const base = {
      valor_recebido: '50,00',
      id_conta_contabil: '4',
      id_conta_contabil_caixa: '1',
      id_centro_custo_destinacao: '',
    }
    expect(confirmarDoacaoDoSiteSchema.safeParse(base).success).toBe(true)
    for (const valor of ['1.200,50', '50', 'R$ 35,5']) {
      expect(
        confirmarDoacaoDoSiteSchema.safeParse({
          ...base,
          valor_recebido: valor,
        }).success,
      ).toBe(true)
    }
    for (const valor of ['', '0', '0,00', 'abc', '-5', '1,2,3']) {
      expect(
        confirmarDoacaoDoSiteSchema.safeParse({
          ...base,
          valor_recebido: valor,
        }).success,
      ).toBe(false)
    }
    expect(
      confirmarDoacaoDoSiteSchema.safeParse({ ...base, id_conta_contabil: '' })
        .success,
    ).toBe(false)
    expect(
      confirmarDoacaoDoSiteSchema.safeParse({
        ...base,
        id_conta_contabil_caixa: '',
      }).success,
    ).toBe(false)
  })

  it('observação: até 300 letras', () => {
    expect(
      doacaoDoSiteNaoLocalizadaSchema.safeParse({ observacao: 'a'.repeat(300) })
        .success,
    ).toBe(true)
    expect(
      doacaoDoSiteNaoLocalizadaSchema.safeParse({ observacao: 'a'.repeat(301) })
        .success,
    ).toBe(false)
    expect(
      doacaoDoSiteNaoLocalizadaSchema.safeParse({ observacao: '' }).success,
    ).toBe(true)
  })
})
