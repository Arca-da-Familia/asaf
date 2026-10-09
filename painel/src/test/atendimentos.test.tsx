import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { AtendimentoAberto, TermoDeVoluntario } from '@/lib/api'
import {
  avisoDoEnvioDaResposta,
  cargaHorariaSemanal,
  hojeParaCampoDeData,
  previaDaMensagem,
  recusaPorFaltaDeAutorizacao,
  textoDaDataDeNascimento,
  textoDoPrazo,
  validarTermoDeAdesao,
} from '@/lib/atendimentos'
import { moduloVisivel, modulos } from '@/lib/modulos'
import { useMe } from '@/lib/use-me'
import { AtendimentosPage } from '@/pages/Atendimentos'
import { Home } from '@/pages/Home'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  resumirAtendimentos: vi.fn(),
  listarAtendimentosDaFila: vi.fn(),
  abrirAtendimento: vi.fn(),
  assumirAtendimento: vi.fn(),
  responderAtendimento: vi.fn(),
  encerrarAtendimento: vi.fn(),
  cadastrarVoluntarioDoAtendimento: vi.fn(),
  obterTermoVigente: vi.fn(),
  registrarTermoDeVoluntario: vi.fn(),
}))
vi.mock('@/lib/use-me', () => ({ useMe: vi.fn() }))

// v5.5a - a tela da fila única de atendimento. O servidor de mentira abaixo guarda os pedidos em `base` e responde às mesmas rotas que o de verdade
// (lista com filtros e páginas, abrir, assumir, responder, encerrar): assim cada teste conta o que a pessoa vê depois de fazer cada passo.
let base: AtendimentoAberto[] = []
// o que o servidor responde sobre o e-mail da resposta: saiu (true), falhou (false), a pessoa não tem e-mail (null)
let envioDaResposta: boolean | null = true
// o termo de adesão vigente de cada pessoa do cadastro (por id_pessoa); quem não está aqui não tem termo
let termos: Record<number, TermoDeVoluntario> = {}

function pedido(
  n: number,
  sobrescrever: Partial<AtendimentoAberto> = {},
): AtendimentoAberto {
  return {
    id_atendimento: n,
    protocolo: `ASAF-2026-${String(n).padStart(5, '0')}`,
    tipo: 'CONTATO',
    tipo_rotulo: 'Contato',
    subtipo: null,
    subtipo_rotulo: null,
    assunto: 'Quero conhecer o projeto',
    mensagem: 'Gostaria de saber como participar das atividades da associação.',
    nome_completo: 'Maria de Teste',
    email_contato: 'maria@homologacao.example.com',
    telefone_whatsapp: '91988887777',
    cpf_mascarado: null,
    id_pessoa: null,
    status: 'Novo',
    prazo_dias: 10,
    prazo_em: '2026-10-19T12:00:00',
    situacao_do_prazo: 'no_prazo',
    dias_restantes: 10,
    id_responsavel: null,
    assumido_em: null,
    resposta: null,
    respondido_em: null,
    resposta_enviada_por_email: null,
    motivo_encerramento: null,
    encerrado_em: null,
    criado_em: '2026-10-09T12:00:00',
    consentimento_lgpd_versao: '1',
    data_nascimento: null,
    idade: null,
    menor_de_idade: null,
    cpf: null,
    outros_do_remetente: [],
    ...sobrescrever,
  }
}

// o pedido de voluntariado: o site pede a data de nascimento (a idade manda no termo de adesão)
function pedidoDeVoluntario(
  n: number,
  sobrescrever: Partial<AtendimentoAberto> = {},
): AtendimentoAberto {
  return pedido(n, {
    tipo: 'VOLUNTARIO',
    tipo_rotulo: 'Voluntariado',
    assunto: 'Quero ser voluntário',
    mensagem: 'Quero ajudar nas atividades de sábado.',
    nome_completo: 'Joana Voluntária',
    cpf: '52998224725',
    cpf_mascarado: '***.***.***-25',
    data_nascimento: '1990-05-10',
    idade: 36,
    menor_de_idade: false,
    ...sobrescrever,
  })
}

function alterar(
  id: number,
  mudancas: Partial<AtendimentoAberto>,
): AtendimentoAberto {
  const atual = base.find((a) => a.id_atendimento === id)
  if (!atual) throw new Error(`pedido ${id} não existe no servidor de mentira`)
  Object.assign(atual, mudancas)
  return { ...atual }
}

function prepararServidor() {
  vi.mocked(api.resumirAtendimentos).mockResolvedValue({
    novos: 4,
    em_atendimento: 2,
    abertos: 6,
    vencidos: 1,
    vencem_em_3_dias: 3,
    por_tipo: {
      CONTATO: 3,
      PEDIDO_INFORMACAO: 1,
      TITULAR_LGPD: 2,
      VOLUNTARIO: 0,
    },
  })
  vi.mocked(api.listarAtendimentosDaFila).mockImplementation(
    async (filtros = {}) => {
      const filtrados = base.filter((a) => {
        if (filtros.tipo && a.tipo !== filtros.tipo) return false
        if (filtros.vencidos && a.situacao_do_prazo !== 'vencido') return false
        if (filtros.situacao === 'abertos')
          return a.status === 'Novo' || a.status === 'Em atendimento'
        if (filtros.situacao) return a.status === filtros.situacao
        return true
      })
      const pagina = filtros.pagina ?? 1
      const porPagina = filtros.por_pagina ?? 25
      return {
        total: filtrados.length,
        pagina,
        por_pagina: porPagina,
        itens: filtrados
          .slice((pagina - 1) * porPagina, pagina * porPagina)
          .map((a) => ({ ...a })),
      }
    },
  )
  vi.mocked(api.abrirAtendimento).mockImplementation(async (id) => {
    const achado = base.find((a) => a.id_atendimento === id)
    if (!achado) throw new api.ApiError(404, 'Atendimento não encontrado.')
    return { ...achado }
  })
  vi.mocked(api.assumirAtendimento).mockImplementation(async (id) =>
    alterar(id, {
      status: 'Em atendimento',
      assumido_em: '2026-10-09T13:00:00',
      id_responsavel: 7,
    }),
  )
  vi.mocked(api.responderAtendimento).mockImplementation(async (id, resposta) =>
    alterar(id, {
      status: 'Respondido',
      resposta,
      respondido_em: '2026-10-09T14:00:00',
      resposta_enviada_por_email: envioDaResposta,
      situacao_do_prazo: 'cumprido',
    }),
  )
  vi.mocked(api.encerrarAtendimento).mockImplementation(async (id, motivo) =>
    alterar(id, {
      status: 'Encerrado',
      motivo_encerramento: motivo,
      encerrado_em: '2026-10-09T15:00:00',
      situacao_do_prazo: 'encerrado',
    }),
  )
  // v5.5b: cadastrar como voluntário liga o pedido a uma pessoa do cadastro; o termo de adesão fica guardado por pessoa
  vi.mocked(api.cadastrarVoluntarioDoAtendimento).mockImplementation(
    async (id) => alterar(id, { id_pessoa: 501 }),
  )
  vi.mocked(api.obterTermoVigente).mockImplementation(
    async (idPessoa) => termos[idPessoa] ?? { vigente: false },
  )
  vi.mocked(api.registrarTermoDeVoluntario).mockImplementation(
    async (idPessoa, dados) => {
      termos[idPessoa] = {
        vigente: true,
        id_termo: 1,
        atividade: dados.atividade,
        carga_horaria_semanal: dados.carga_horaria_semanal,
        data_fim_vigencia: `${dados.data_fim_vigencia}T00:00:00`,
        versao: 1,
      }
      return { mensagem: 'Termo de adesão registrado.', id_termo: 1, versao: 1 }
    },
  )
}

function Endereco() {
  const local = useLocation()
  return <p data-testid="endereco">{`${local.pathname}${local.search}`}</p>
}

function desenhar(entrada = '/atendimentos') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[entrada]}>
        <AtendimentosPage />
        <Endereco />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function cartao(protocolo: string) {
  return within(
    screen.getByRole('listitem', { name: `Atendimento ${protocolo}` }),
  )
}

// o cartão de um pedido, esperando a lista chegar do servidor
async function cartaoCarregado(protocolo: string) {
  return within(
    await screen.findByRole('listitem', { name: `Atendimento ${protocolo}` }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  envioDaResposta = true
  termos = {}
  base = [pedido(1)]
  prepararServidor()
})

describe('Atendimento: o resumo da fila', () => {
  it('mostra os quatro números do dia e destaca os vencidos', async () => {
    desenhar()
    expect(await screen.findByLabelText('Novos: 4')).toBeInTheDocument()
    expect(screen.getByLabelText('Em atendimento: 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Vencem em 3 dias: 3')).toBeInTheDocument()
    const vencidos = screen.getByLabelText('Vencidos: 1')
    expect(vencidos).toHaveAttribute('data-alerta', 'sim')
    expect(vencidos).toHaveClass('bg-rose-100')
    expect(screen.getByLabelText('Novos: 4')).not.toHaveAttribute('data-alerta')
    expect(
      screen.getByRole('heading', { name: 'Atendimento', level: 1 }),
    ).toBeInTheDocument()
  })

  it('sem nenhum vencido, o cartão de vencidos não fica em alerta', async () => {
    vi.mocked(api.resumirAtendimentos).mockResolvedValue({
      novos: 0,
      em_atendimento: 0,
      abertos: 0,
      vencidos: 0,
      vencem_em_3_dias: 0,
      por_tipo: {
        CONTATO: 0,
        PEDIDO_INFORMACAO: 0,
        TITULAR_LGPD: 0,
        VOLUNTARIO: 0,
      },
    })
    desenhar()
    expect(await screen.findByLabelText('Vencidos: 0')).not.toHaveAttribute(
      'data-alerta',
    )
  })
})

describe('Atendimento: a lista', () => {
  it('por padrão pede só os pedidos abertos, 25 por página, e mostra o total', async () => {
    desenhar()
    await screen.findByLabelText('Atendimento ASAF-2026-00001')
    expect(api.listarAtendimentosDaFila).toHaveBeenCalledWith({
      busca: undefined,
      tipo: undefined,
      situacao: 'abertos',
      vencidos: undefined,
      pagina: 1,
      por_pagina: 25,
    })
    expect(screen.getByLabelText('Situação')).toHaveValue('abertos')
    expect(screen.getByText('1 atendimento')).toBeInTheDocument()
  })

  it('cada cartão mostra protocolo, tipo, situação, prazo em texto claro, nome, assunto, prévia e a data', async () => {
    base = [
      pedido(1, {
        situacao_do_prazo: 'vencido',
        dias_restantes: -3,
        nome_completo: 'Ana Vencida',
      }),
      pedido(2, {
        status: 'Em atendimento',
        situacao_do_prazo: 'vence_logo',
        dias_restantes: 2,
      }),
      pedido(3, { dias_restantes: 9 }),
      pedido(4, {
        status: 'Respondido',
        situacao_do_prazo: 'cumprido',
        resposta: 'Resposta de teste.',
        respondido_em: '2026-10-10T12:00:00',
      }),
      pedido(5, {
        status: 'Respondido',
        situacao_do_prazo: 'cumprido_com_atraso',
        resposta: 'Resposta de teste.',
        respondido_em: '2026-10-30T12:00:00',
      }),
      pedido(6, { status: 'Encerrado', situacao_do_prazo: 'encerrado' }),
      pedido(7, {
        tipo: 'TITULAR_LGPD',
        tipo_rotulo: 'Solicitação de titular de dados (LGPD)',
        subtipo: 'ACESSO',
        subtipo_rotulo: 'Acessar os dados que a associação tem sobre mim',
        assunto: null,
      }),
    ]
    desenhar('/atendimentos?situacao=todas')
    await screen.findByLabelText('Atendimento ASAF-2026-00001')

    const vencido = await cartaoCarregado('ASAF-2026-00001')
    expect(vencido.getByText('ASAF-2026-00001')).toBeInTheDocument()
    expect(vencido.getByText('Contato')).toBeInTheDocument()
    expect(vencido.getByText('Ana Vencida')).toBeInTheDocument()
    expect(vencido.getByText('Quero conhecer o projeto')).toBeInTheDocument()
    expect(vencido.getByText('Novo')).toHaveClass('bg-sky-100')
    expect(vencido.getByText('Vencido há 3 dias')).toHaveClass('bg-rose-100')
    expect(
      vencido.getByText(/Gostaria de saber como participar/),
    ).toBeInTheDocument()
    expect(vencido.getByText(/Criado em 09\/10\/2026/)).toBeInTheDocument()

    expect(cartao('ASAF-2026-00002').getByText('Vence em 2 dias')).toHaveClass(
      'bg-amber-100',
    )
    expect(cartao('ASAF-2026-00002').getByText('Em atendimento')).toBeVisible()
    expect(cartao('ASAF-2026-00003').getByText('Vence em 9 dias')).toBeVisible()
    expect(
      cartao('ASAF-2026-00004').getByText('Respondido no prazo'),
    ).toHaveClass('bg-emerald-100')
    expect(
      cartao('ASAF-2026-00005').getByText('Respondido com atraso'),
    ).toHaveClass('bg-amber-100')
    // o cartão encerrado diz "Encerrado" na situação e no prazo
    expect(cartao('ASAF-2026-00006').getAllByText('Encerrado')).toHaveLength(2)
    // a solicitação de titular não tem assunto: o cartão mostra o que a pessoa pede
    expect(
      cartao('ASAF-2026-00007').getByText(
        'Acessar os dados que a associação tem sobre mim',
      ),
    ).toBeVisible()
  })

  it('mensagem comprida aparece só em prévia no cartão', async () => {
    base = [pedido(1, { mensagem: 'palavra '.repeat(80) })]
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    const previa = await dentro.findByText(/^palavra palavra/)
    expect(previa.textContent?.endsWith('…')).toBe(true)
    expect((previa.textContent ?? '').length).toBeLessThan(200)
  })

  it('sem nenhum pedido aberto e sem filtro, o vazio explica o que esperar', async () => {
    base = []
    desenhar()
    expect(
      await screen.findByText('Nenhum atendimento em aberto'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Quando alguém mandar um pedido pelo site/),
    ).toBeInTheDocument()
  })

  it('com filtro que não acha nada, diz para mudar a busca ou os filtros', async () => {
    base = []
    desenhar('/atendimentos?tipo=VOLUNTARIO')
    expect(
      await screen.findByText('Nenhum atendimento encontrado'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Mude a busca ou os filtros/)).toBeInTheDocument()
  })

  it('se a lista não carrega, avisa em vez de mostrar uma tela vazia', async () => {
    vi.mocked(api.listarAtendimentosDaFila).mockRejectedValue(
      new api.ApiError(500, 'Erro inesperado (500).'),
    )
    desenhar()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os atendimentos.',
    )
  })
})

describe('Atendimento: filtros, busca e páginas', () => {
  it('os filtros de tipo e situação oferecem as opções combinadas', async () => {
    desenhar()
    await screen.findByLabelText('Atendimento ASAF-2026-00001')
    const tipos = within(screen.getByLabelText('Tipo')).getAllByRole('option')
    expect(tipos.map((o) => o.textContent)).toEqual([
      'Todos',
      'Contato',
      'Pedido de informação sobre recursos públicos',
      'Solicitação de titular de dados (LGPD)',
      'Voluntariado',
    ])
    const situacoes = within(screen.getByLabelText('Situação')).getAllByRole(
      'option',
    )
    expect(situacoes.map((o) => o.textContent)).toEqual([
      'Abertos',
      'Novo',
      'Em atendimento',
      'Respondido',
      'Encerrado',
      'Todas',
    ])
    expect(screen.getByLabelText('Só vencidos')).not.toBeChecked()
  })

  it('escolher tipo, situação e "só vencidos" vai na consulta e fica no endereço', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByLabelText('Atendimento ASAF-2026-00001')

    await u.selectOptions(screen.getByLabelText('Tipo'), 'TITULAR_LGPD')
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({ tipo: 'TITULAR_LGPD', situacao: 'abertos' }),
      ),
    )
    await u.selectOptions(screen.getByLabelText('Situação'), 'Respondido')
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tipo: 'TITULAR_LGPD',
          situacao: 'Respondido',
        }),
      ),
    )
    await u.click(screen.getByLabelText('Só vencidos'))
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tipo: 'TITULAR_LGPD',
          situacao: 'Respondido',
          vencidos: true,
        }),
      ),
    )
    const endereco = screen.getByTestId('endereco').textContent ?? ''
    expect(endereco).toContain('tipo=TITULAR_LGPD')
    expect(endereco).toContain('situacao=Respondido')
    expect(endereco).toContain('vencidos=1')
  })

  it('"Todas" não manda situação ao servidor e "Abertos" tira a situação do endereço', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByLabelText('Atendimento ASAF-2026-00001')
    await u.selectOptions(screen.getByLabelText('Situação'), 'Todas')
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({ situacao: undefined }),
      ),
    )
    expect(screen.getByTestId('endereco')).toHaveTextContent('situacao=todas')
    await u.selectOptions(screen.getByLabelText('Situação'), 'Abertos')
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({ situacao: 'abertos' }),
      ),
    )
    expect(screen.getByTestId('endereco')).not.toHaveTextContent('situacao=')
  })

  it('abrir um endereço com filtros já aplica os filtros (dá para mandar o link de uma lista filtrada)', async () => {
    desenhar(
      '/atendimentos?tipo=PEDIDO_INFORMACAO&situacao=Encerrado&vencidos=1&busca=ASAF-2026',
    )
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenCalledWith({
        busca: 'ASAF-2026',
        tipo: 'PEDIDO_INFORMACAO',
        situacao: 'Encerrado',
        vencidos: true,
        pagina: 1,
        por_pagina: 25,
      }),
    )
    expect(screen.getByLabelText('Tipo')).toHaveValue('PEDIDO_INFORMACAO')
    expect(screen.getByLabelText('Situação')).toHaveValue('Encerrado')
    expect(screen.getByLabelText('Só vencidos')).toBeChecked()
    expect(screen.getByLabelText('Buscar atendimento')).toHaveValue('ASAF-2026')
  })

  it('a busca digitada vai ao servidor (depois de uma pausa) e volta para a primeira página', async () => {
    const u = userEvent.setup()
    base = Array.from({ length: 60 }, (_, i) => pedido(i + 1))
    desenhar()
    await screen.findByText('Página 1 de 3')
    await u.click(screen.getByRole('button', { name: 'Próxima página' }))
    await screen.findByText('Página 2 de 3')

    await u.type(screen.getByLabelText('Buscar atendimento'), 'Carla')
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({ busca: 'Carla', pagina: 1 }),
      ),
    )
    expect(screen.getByTestId('endereco')).toHaveTextContent('busca=Carla')
  })

  it('digitar na busca e escolher um filtro logo em seguida mantém os dois (achado do robô na homologação)', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findAllByRole('listitem', { name: /^Atendimento ASAF-/ })
    await u.type(screen.getByLabelText('Buscar atendimento'), 'Carla')
    // sem esperar a pausa da busca
    await u.selectOptions(screen.getByLabelText('Tipo'), 'PEDIDO_INFORMACAO')
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({ busca: 'Carla', tipo: 'PEDIDO_INFORMACAO' }),
      ),
    )
    expect(screen.getByTestId('endereco')).toHaveTextContent('busca=Carla')
    expect(screen.getByTestId('endereco')).toHaveTextContent(
      'tipo=PEDIDO_INFORMACAO',
    )
  })

  it('a lista é paginada de 25 em 25 e os botões pedem a página seguinte e a anterior', async () => {
    const u = userEvent.setup()
    base = Array.from({ length: 60 }, (_, i) => pedido(i + 1))
    desenhar()
    expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument()
    expect(screen.getByText('60 atendimentos')).toBeInTheDocument()
    expect(
      screen.getAllByRole('listitem', { name: /^Atendimento / }),
    ).toHaveLength(25)
    const paginas = within(
      screen.getByRole('navigation', { name: 'Páginas de atendimentos' }),
    )
    expect(
      paginas.getByRole('button', { name: 'Página anterior' }),
    ).toBeDisabled()

    await u.click(paginas.getByRole('button', { name: 'Próxima página' }))
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({ pagina: 2, por_pagina: 25 }),
      ),
    )
    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument()

    await u.click(paginas.getByRole('button', { name: 'Página anterior' }))
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({ pagina: 1 }),
      ),
    )
  })

  it('mudar um filtro volta para a primeira página', async () => {
    const u = userEvent.setup()
    base = Array.from({ length: 60 }, (_, i) => pedido(i + 1))
    desenhar()
    await screen.findByText('Página 1 de 3')
    await u.click(screen.getByRole('button', { name: 'Próxima página' }))
    await screen.findByText('Página 2 de 3')
    await u.selectOptions(screen.getByLabelText('Tipo'), 'CONTATO')
    await waitFor(() =>
      expect(api.listarAtendimentosDaFila).toHaveBeenLastCalledWith(
        expect.objectContaining({ tipo: 'CONTATO', pagina: 1 }),
      ),
    )
  })

  it('uma lista de uma página só não mostra os botões de página', async () => {
    desenhar()
    await screen.findByLabelText('Atendimento ASAF-2026-00001')
    expect(
      screen.queryByRole('navigation', { name: 'Páginas de atendimentos' }),
    ).toBeNull()
  })
})

describe('Atendimento: abrir um pedido', () => {
  it('Abrir mostra a mensagem inteira, os contatos, o CPF, o aviso de privacidade e os outros pedidos da mesma pessoa', async () => {
    const u = userEvent.setup()
    base = [
      pedido(1, {
        mensagem: 'Primeira linha da mensagem.\nSegunda linha da mensagem.',
        cpf: '52998224725',
        cpf_mascarado: '***.***.***-25',
        id_pessoa: 9,
        consentimento_lgpd_versao: '1',
        outros_do_remetente: [
          {
            id_atendimento: 2,
            protocolo: 'ASAF-2026-00002',
            tipo_rotulo: 'Voluntariado',
            status: 'Respondido',
            criado_em: '2026-09-20T12:00:00',
          },
        ],
      }),
    ]
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    expect(
      dentro.queryByRole('region', { name: 'Mensagem recebida' }),
    ).toBeNull()
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))

    const mensagem = await dentro.findByRole('region', {
      name: 'Mensagem recebida',
    })
    expect(mensagem).toHaveTextContent('Primeira linha da mensagem.')
    expect(mensagem).toHaveTextContent('Segunda linha da mensagem.')
    expect(api.abrirAtendimento).toHaveBeenCalledWith(1)
    expect(dentro.getByText('maria@homologacao.example.com')).toBeVisible()
    expect(dentro.getByText('91988887777')).toBeVisible()
    expect(dentro.getByText('529.982.247-25')).toBeVisible()
    expect(dentro.getByText('versão 1')).toBeVisible()
    expect(dentro.getByText(/Esta pessoa já consta no cadastro/)).toBeVisible()
    const outros = dentro.getByRole('region', {
      name: 'Outros pedidos desta pessoa',
    })
    expect(outros).toHaveTextContent('ASAF-2026-00002')
    expect(outros).toHaveTextContent('Voluntariado')
    expect(outros).toHaveTextContent('Respondido')

    // o botão vira "Fechar" e esconde o detalhe
    await u.click(dentro.getByRole('button', { name: 'Fechar' }))
    expect(
      dentro.queryByRole('region', { name: 'Mensagem recebida' }),
    ).toBeNull()
  })

  it('o CPF inteiro só aparece quando o servidor o manda; sem ele, nada de CPF nem de "outros pedidos"', async () => {
    const u = userEvent.setup()
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    await dentro.findByRole('region', { name: 'Mensagem recebida' })
    expect(dentro.queryByText('CPF')).toBeNull()
    expect(dentro.queryByText(/Outros pedidos desta pessoa/)).toBeNull()
    expect(dentro.queryByText(/já consta no cadastro/)).toBeNull()
  })

  it('pedido sem e-mail ou telefone diz "Não informado"', async () => {
    const u = userEvent.setup()
    base = [pedido(1, { email_contato: null, telefone_whatsapp: null })]
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    expect(await dentro.findAllByText('Não informado')).toHaveLength(2)
  })

  it('na solicitação de titular, mostra o direito pedido', async () => {
    const u = userEvent.setup()
    base = [
      pedido(1, {
        tipo: 'TITULAR_LGPD',
        tipo_rotulo: 'Solicitação de titular de dados (LGPD)',
        subtipo: 'CORRECAO',
        subtipo_rotulo:
          'Corrigir dados incompletos, inexatos ou desatualizados',
        assunto: null,
        cpf: '52998224725',
      }),
    ]
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    expect(await dentro.findByText('O que a pessoa pede')).toBeVisible()
    expect(dentro.getAllByText(/Corrigir dados incompletos/)).not.toHaveLength(
      0,
    )
  })
})

describe('Atendimento: assumir, responder e encerrar', () => {
  it('Assumir chama o servidor, atualiza a situação e avisa', async () => {
    const u = userEvent.setup()
    desenhar('/atendimentos?situacao=todas')
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    await u.click(await dentro.findByRole('button', { name: 'Assumir' }))
    await waitFor(() => expect(api.assumirAtendimento).toHaveBeenCalledWith(1))
    // a lista e o resumo são refeitos
    await waitFor(() =>
      expect(
        vi.mocked(api.resumirAtendimentos).mock.calls.length,
      ).toBeGreaterThan(1),
    )
    expect(
      await dentro.findByText('Assumido em', { exact: false }),
    ).toBeVisible()
    await waitFor(() =>
      expect(
        cartao('ASAF-2026-00001').getAllByText('Em atendimento'),
      ).not.toHaveLength(0),
    )
  })

  it('só Novo e Em atendimento oferecem Assumir e Responder; Encerrar some só no encerrado', async () => {
    const u = userEvent.setup()
    base = [
      pedido(1, {
        status: 'Em atendimento',
        assumido_em: '2026-10-09T13:00:00',
      }),
      pedido(2, {
        status: 'Respondido',
        resposta: 'Resposta de teste para a pessoa.',
        respondido_em: '2026-10-10T12:00:00',
        resposta_enviada_por_email: true,
        situacao_do_prazo: 'cumprido',
      }),
      pedido(3, {
        status: 'Encerrado',
        situacao_do_prazo: 'encerrado',
        motivo_encerramento: 'Pedido repetido',
        encerrado_em: '2026-10-11T12:00:00',
      }),
    ]
    desenhar('/atendimentos?situacao=todas')

    const emAtendimento = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await emAtendimento.findByRole('button', { name: 'Abrir' }))
    expect(
      await emAtendimento.findByRole('button', { name: 'Assumir' }),
    ).toBeVisible()
    expect(emAtendimento.getByLabelText('Resposta')).toBeVisible()
    expect(
      emAtendimento.getByRole('button', { name: 'Registrar resposta' }),
    ).toBeVisible()
    expect(emAtendimento.getByLabelText('Motivo do encerramento')).toBeVisible()

    const respondido = await cartaoCarregado('ASAF-2026-00002')
    await u.click(respondido.getByRole('button', { name: 'Abrir' }))
    await respondido.findByRole('region', { name: 'Resposta registrada' })
    expect(respondido.queryByRole('button', { name: 'Assumir' })).toBeNull()
    expect(respondido.queryByLabelText('Resposta')).toBeNull()
    expect(respondido.getByLabelText('Motivo do encerramento')).toBeVisible()

    const encerrado = await cartaoCarregado('ASAF-2026-00003')
    await u.click(encerrado.getByRole('button', { name: 'Abrir' }))
    expect(await encerrado.findByText(/Motivo: Pedido repetido/)).toBeVisible()
    expect(encerrado.queryByRole('button', { name: 'Assumir' })).toBeNull()
    expect(encerrado.queryByLabelText('Resposta')).toBeNull()
    expect(encerrado.queryByLabelText('Motivo do encerramento')).toBeNull()
    expect(
      encerrado.queryByRole('button', { name: 'Encerrar atendimento' }),
    ).toBeNull()
  })

  it.each([
    {
      envio: true,
      noCartao: 'A resposta foi enviada por e-mail.',
      noAviso: 'A resposta foi enviada por e-mail.',
      atencao: false,
    },
    {
      envio: false,
      noCartao:
        'Não foi possível enviar por e-mail: avise a pessoa por outro meio (e-mail/telefone acima).',
      noAviso:
        'Não foi possível enviar por e-mail: avise a pessoa por outro meio.',
      atencao: true,
    },
    {
      envio: null,
      noCartao: 'Sem e-mail cadastrado: avise a pessoa pelo telefone.',
      noAviso: 'Sem e-mail cadastrado: avise a pessoa pelo telefone.',
      atencao: false,
    },
  ])(
    'responder com envio por e-mail = $envio: o cartão mostra a resposta, quando foi e o aviso certo',
    async ({ envio, noCartao, atencao }) => {
      const u = userEvent.setup()
      envioDaResposta = envio
      desenhar('/atendimentos?situacao=todas')
      const dentro = await cartaoCarregado('ASAF-2026-00001')
      await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
      await u.type(
        await dentro.findByLabelText('Resposta'),
        'Obrigado pelo contato, vamos receber você.',
      )
      await u.click(dentro.getByRole('button', { name: 'Registrar resposta' }))
      await waitFor(() =>
        expect(api.responderAtendimento).toHaveBeenCalledWith(
          1,
          'Obrigado pelo contato, vamos receber você.',
        ),
      )
      const registrada = await dentro.findByRole('region', {
        name: 'Resposta registrada',
      })
      expect(registrada).toHaveTextContent(
        'Obrigado pelo contato, vamos receber você.',
      )
      expect(registrada).toHaveTextContent('Respondido em 09/10/2026')
      const aviso = within(registrada).getByText(noCartao)
      if (atencao) expect(aviso).toHaveClass('bg-amber-100')
      else expect(aviso).not.toHaveClass('bg-amber-100')
      // o pedido deixou de ser "aberto": a resposta e o botão de registrar somem
      expect(dentro.queryByLabelText('Resposta')).toBeNull()
      expect(
        dentro.queryByRole('button', { name: 'Registrar resposta' }),
      ).toBeNull()
      expect(dentro.getAllByText('Respondido').length).toBeGreaterThan(0)
    },
  )

  it.each([
    {
      envio: true,
      aviso:
        'Atendimento ASAF-2026-00001 respondido. A resposta foi enviada por e-mail.',
    },
    {
      envio: false,
      aviso:
        'Atendimento ASAF-2026-00001 respondido. Não foi possível enviar por e-mail: avise a pessoa por outro meio. E-mail: maria@homologacao.example.com · Telefone: 91988887777.',
    },
    {
      envio: null,
      aviso:
        'Atendimento ASAF-2026-00001 respondido. Sem e-mail cadastrado: avise a pessoa pelo telefone. Telefone: 91988887777.',
    },
  ])(
    'na lista de abertos o cartão respondido sai da lista, mas o aviso do e-mail fica no alto (envio = $envio)',
    async ({ envio, aviso }) => {
      const u = userEvent.setup()
      envioDaResposta = envio
      desenhar()
      const dentro = await cartaoCarregado('ASAF-2026-00001')
      await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
      await u.type(
        await dentro.findByLabelText('Resposta'),
        'Obrigado pelo contato, vamos receber você.',
      )
      await u.click(dentro.getByRole('button', { name: 'Registrar resposta' }))
      expect(await screen.findByRole('status')).toHaveTextContent(aviso)
      expect(
        screen.queryByRole('listitem', { name: 'Atendimento ASAF-2026-00001' }),
      ).toBeNull()
      expect(
        await screen.findByText('Nenhum atendimento em aberto'),
      ).toBeInTheDocument()

      await u.click(screen.getByRole('button', { name: 'Fechar aviso' }))
      expect(screen.queryByRole('status')).toBeNull()
    },
  )

  it('Encerrar manda o motivo, mostra o encerramento e some do campo', async () => {
    const u = userEvent.setup()
    desenhar('/atendimentos?situacao=todas')
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    await u.type(
      await dentro.findByLabelText('Motivo do encerramento'),
      'Pedido repetido',
    )
    await u.click(dentro.getByRole('button', { name: 'Encerrar atendimento' }))
    await waitFor(() =>
      expect(api.encerrarAtendimento).toHaveBeenCalledWith(
        1,
        'Pedido repetido',
      ),
    )
    expect(await dentro.findByText(/Motivo: Pedido repetido/)).toBeVisible()
    expect(dentro.queryByLabelText('Motivo do encerramento')).toBeNull()
    expect(dentro.getAllByText('Encerrado').length).toBeGreaterThan(0)
  })

  it('na lista de abertos o pedido encerrado sai da lista e o aviso confirma', async () => {
    const u = userEvent.setup()
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    await u.type(
      await dentro.findByLabelText('Motivo do encerramento'),
      'Pedido repetido',
    )
    await u.click(dentro.getByRole('button', { name: 'Encerrar atendimento' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Atendimento ASAF-2026-00001 encerrado.',
    )
  })

  it('o erro do servidor aparece em português, na tela, e o que foi digitado fica', async () => {
    const u = userEvent.setup()
    vi.mocked(api.responderAtendimento).mockRejectedValue(
      new api.ApiError(400, 'Escreva a resposta (pelo menos 10 letras).'),
    )
    vi.mocked(api.encerrarAtendimento).mockRejectedValue(
      new api.ApiError(
        400,
        'Diga por que está encerrando (pelo menos 5 letras).',
      ),
    )
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))

    await u.type(await dentro.findByLabelText('Resposta'), 'Oi')
    await u.click(dentro.getByRole('button', { name: 'Registrar resposta' }))
    expect(await dentro.findByRole('alert')).toHaveTextContent(
      'Escreva a resposta (pelo menos 10 letras).',
    )
    expect(dentro.getByLabelText('Resposta')).toHaveValue('Oi')
    expect(screen.queryByRole('status')).toBeNull()

    await u.type(dentro.getByLabelText('Motivo do encerramento'), 'x')
    await u.click(dentro.getByRole('button', { name: 'Encerrar atendimento' }))
    await waitFor(() =>
      expect(dentro.getByRole('alert')).toHaveTextContent(
        'Diga por que está encerrando (pelo menos 5 letras).',
      ),
    )
    expect(dentro.getAllByRole('alert')).toHaveLength(1)
  })

  it('pedido que outra pessoa já respondeu: o erro do servidor é mostrado', async () => {
    const u = userEvent.setup()
    vi.mocked(api.assumirAtendimento).mockRejectedValue(
      new api.ApiError(400, 'Este atendimento já está respondido.'),
    )
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    await u.click(await dentro.findByRole('button', { name: 'Assumir' }))
    expect(await dentro.findByRole('alert')).toHaveTextContent(
      'Este atendimento já está respondido.',
    )
  })

  it('se o pedido não abre, avisa', async () => {
    const u = userEvent.setup()
    vi.mocked(api.abrirAtendimento).mockRejectedValue(
      new api.ApiError(404, 'Atendimento não encontrado.'),
    )
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    expect(await dentro.findByRole('alert')).toHaveTextContent(
      'Não foi possível abrir este atendimento.',
    )
  })
})

// v5.5b - o pedido de voluntariado: cadastrar como voluntário, registrar o termo de adesão e escalar
async function abrirVoluntario(
  protocolo = 'ASAF-2026-00001',
  entrada = '/atendimentos',
) {
  const u = userEvent.setup()
  desenhar(entrada)
  const dentro = await cartaoCarregado(protocolo)
  await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
  const secao = within(
    await dentro.findByRole('region', { name: 'Voluntário' }),
  )
  return { u, dentro, secao }
}

describe('Atendimento: pedido de voluntariado', () => {
  it('mostra a data de nascimento com a idade, sem aviso de menor para quem é adulto', async () => {
    base = [pedidoDeVoluntario(1)]
    const { secao } = await abrirVoluntario()
    expect(
      secao.getByText('Data de nascimento: 10/05/1990 (36 anos)'),
    ).toBeVisible()
    expect(secao.queryByText(/Menor de 18 anos/)).toBeNull()
  })

  it('o pedido de outro tipo não tem a seção "Voluntário"', async () => {
    const u = userEvent.setup()
    base = [pedido(1)]
    desenhar()
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    await dentro.findByRole('region', { name: 'Mensagem recebida' })
    expect(dentro.queryByRole('region', { name: 'Voluntário' })).toBeNull()
    expect(dentro.queryByText(/Data de nascimento/)).toBeNull()
    expect(
      dentro.queryByRole('button', { name: 'Cadastrar como voluntário' }),
    ).toBeNull()
  })

  it('menor de 18 anos: aviso âmbar dizendo que o termo precisa da autorização de um responsável', async () => {
    base = [
      pedidoDeVoluntario(1, {
        data_nascimento: '2012-03-01',
        idade: 14,
        menor_de_idade: true,
      }),
    ]
    const { secao } = await abrirVoluntario()
    expect(
      secao.getByText('Data de nascimento: 01/03/2012 (14 anos)'),
    ).toBeVisible()
    const aviso = secao.getByText(
      'Menor de 18 anos: o termo de adesão só é aceito com a autorização de um responsável (anote a referência do documento no termo).',
    )
    expect(aviso).toBeVisible()
    expect(aviso).toHaveClass('bg-amber-100')
  })

  it('sem o pedido no cadastro: oferece "Cadastrar como voluntário", com o texto de apoio, e ainda não oferece o termo', async () => {
    base = [pedidoDeVoluntario(1)]
    const { secao } = await abrirVoluntario()
    expect(
      secao.getByRole('button', { name: 'Cadastrar como voluntário' }),
    ).toBeEnabled()
    expect(
      secao.getByText('Cria o cadastro da pessoa, sem precisar ser associada.'),
    ).toBeVisible()
    expect(secao.queryByRole('form', { name: 'Termo de adesão' })).toBeNull()
    expect(api.obterTermoVigente).not.toHaveBeenCalled()
  })

  it('Cadastrar como voluntário chama o servidor, atualiza o cartão e passa a mostrar o termo de adesão', async () => {
    base = [pedidoDeVoluntario(1)]
    const { u, dentro, secao } = await abrirVoluntario()
    await u.click(
      secao.getByRole('button', { name: 'Cadastrar como voluntário' }),
    )
    await waitFor(() =>
      expect(api.cadastrarVoluntarioDoAtendimento).toHaveBeenCalledWith(1),
    )
    // o formulário do termo aparece (a pessoa agora está no cadastro) e o botão some
    expect(
      await secao.findByRole('form', { name: 'Termo de adesão' }),
    ).toBeVisible()
    expect(api.obterTermoVigente).toHaveBeenCalledWith(501)
    expect(
      secao.queryByRole('button', { name: 'Cadastrar como voluntário' }),
    ).toBeNull()
    expect(dentro.getByText(/Esta pessoa já consta no cadastro/)).toBeVisible()
    // a lista e o resumo são refeitos
    await waitFor(() =>
      expect(
        vi.mocked(api.resumirAtendimentos).mock.calls.length,
      ).toBeGreaterThan(1),
    )
  })

  it('se o servidor recusa o cadastro, o erro aparece em português no cartão e o botão continua', async () => {
    vi.mocked(api.cadastrarVoluntarioDoAtendimento).mockRejectedValue(
      new api.ApiError(400, 'Esta pessoa já está no cadastro.'),
    )
    base = [pedidoDeVoluntario(1)]
    const { u, secao } = await abrirVoluntario()
    await u.click(
      secao.getByRole('button', { name: 'Cadastrar como voluntário' }),
    )
    expect(await secao.findByRole('alert')).toHaveTextContent(
      'Esta pessoa já está no cadastro.',
    )
    expect(
      secao.getByRole('button', { name: 'Cadastrar como voluntário' }),
    ).toBeEnabled()
  })

  it('o formulário do termo tem todos os campos; a autorização do responsável só aparece para menor de idade', async () => {
    base = [pedidoDeVoluntario(1, { id_pessoa: 501 })]
    const { secao } = await abrirVoluntario()
    const formulario = within(
      await secao.findByRole('form', { name: 'Termo de adesão' }),
    )
    for (const campo of [
      'Atividade',
      'Carga horária semanal (horas)',
      'Início da vigência',
      'Fim da vigência',
      'Local (opcional)',
      'Documento de referência (opcional)',
    ])
      expect(formulario.getByLabelText(campo)).toBeVisible()
    // o início já vem com o dia de hoje
    expect(formulario.getByLabelText('Início da vigência')).toHaveValue(
      hojeParaCampoDeData(),
    )
    expect(
      formulario.queryByLabelText('Autorização do responsável (referência)'),
    ).toBeNull()
    expect(
      formulario.getByRole('button', { name: 'Registrar termo de adesão' }),
    ).toBeEnabled()
    expect(api.obterTermoVigente).toHaveBeenCalledWith(501)
  })

  it('o termo incompleto é recusado na tela, com o que falta, sem chamar o servidor', async () => {
    base = [pedidoDeVoluntario(1, { id_pessoa: 501 })]
    const { u, secao } = await abrirVoluntario()
    await u.click(
      await secao.findByRole('button', { name: 'Registrar termo de adesão' }),
    )
    expect(await secao.findByRole('alert')).toHaveTextContent(
      'Informe a atividade do voluntário.',
    )
    await u.type(secao.getByLabelText('Atividade'), 'Apoio na cozinha')
    await u.type(secao.getByLabelText('Carga horária semanal (horas)'), '0')
    await u.click(
      secao.getByRole('button', { name: 'Registrar termo de adesão' }),
    )
    expect(await secao.findByRole('alert')).toHaveTextContent(
      'A carga horária semanal precisa ser um número maior que zero.',
    )
    await u.clear(secao.getByLabelText('Carga horária semanal (horas)'))
    await u.type(secao.getByLabelText('Carga horária semanal (horas)'), '4')
    await u.click(
      secao.getByRole('button', { name: 'Registrar termo de adesão' }),
    )
    expect(await secao.findByRole('alert')).toHaveTextContent(
      'Informe o fim da vigência.',
    )
    // o que foi digitado fica
    expect(secao.getByLabelText('Atividade')).toHaveValue('Apoio na cozinha')
    expect(api.registrarTermoDeVoluntario).not.toHaveBeenCalled()
  })

  it('registrar o termo manda os campos ao servidor e passa a mostrar o termo vigente, com o link para escalar em um projeto', async () => {
    base = [pedidoDeVoluntario(1, { id_pessoa: 501 })]
    const { u, secao } = await abrirVoluntario()
    await secao.findByRole('form', { name: 'Termo de adesão' })
    await u.type(secao.getByLabelText('Atividade'), ' Apoio na cozinha ')
    await u.type(secao.getByLabelText('Carga horária semanal (horas)'), '4,5')
    fireEvent.change(secao.getByLabelText('Início da vigência'), {
      target: { value: '2026-10-10' },
    })
    fireEvent.change(secao.getByLabelText('Fim da vigência'), {
      target: { value: '2027-10-09' },
    })
    await u.type(secao.getByLabelText('Local (opcional)'), 'Cozinha da sede')
    await u.click(
      secao.getByRole('button', { name: 'Registrar termo de adesão' }),
    )
    await waitFor(() =>
      expect(api.registrarTermoDeVoluntario).toHaveBeenCalledTimes(1),
    )
    expect(api.registrarTermoDeVoluntario).toHaveBeenCalledWith(501, {
      atividade: 'Apoio na cozinha',
      carga_horaria_semanal: 4.5,
      data_inicio: '2026-10-10',
      data_fim_vigencia: '2027-10-09',
      local: 'Cozinha da sede',
      documento_referencia: undefined,
      autorizacao_responsavel_referencia: undefined,
    })
    // depois de gravar, o termo vigente é lido de novo e mostrado no lugar do formulário
    expect(
      await secao.findByText(
        'Termo de adesão vigente até 09/10/2027 (Apoio na cozinha, 4,5 h por semana).',
      ),
    ).toBeVisible()
    expect(secao.queryByRole('form', { name: 'Termo de adesão' })).toBeNull()
    expect(secao.getByRole('status')).toHaveTextContent(
      'Termo de adesão registrado. Versão 1.',
    )
    expect(
      secao.getByRole('link', { name: 'Escalar em um projeto' }),
    ).toHaveAttribute('href', '/projetos')
  })

  it('com termo vigente já registrado, mostra o termo e o link para escalar, sem formulário', async () => {
    termos[501] = {
      vigente: true,
      id_termo: 9,
      atividade: 'Recepção',
      carga_horaria_semanal: 6,
      data_fim_vigencia: '2027-03-31T00:00:00',
      versao: 2,
    }
    base = [pedidoDeVoluntario(1, { id_pessoa: 501 })]
    const { secao } = await abrirVoluntario()
    expect(
      await secao.findByText(
        'Termo de adesão vigente até 31/03/2027 (Recepção, 6 h por semana).',
      ),
    ).toBeVisible()
    expect(secao.queryByRole('form', { name: 'Termo de adesão' })).toBeNull()
    expect(
      secao.queryByRole('button', { name: 'Registrar termo de adesão' }),
    ).toBeNull()
    expect(
      secao.getByRole('link', { name: 'Escalar em um projeto' }),
    ).toHaveAttribute('href', '/projetos')
  })

  it('sem termo vigente, não oferece o link para escalar', async () => {
    base = [pedidoDeVoluntario(1, { id_pessoa: 501 })]
    const { secao } = await abrirVoluntario()
    await secao.findByRole('form', { name: 'Termo de adesão' })
    expect(
      secao.queryByRole('link', { name: 'Escalar em um projeto' }),
    ).toBeNull()
  })

  it('menor de idade: a autorização do responsável aparece, é exigida na tela e vai junto com o termo', async () => {
    base = [
      pedidoDeVoluntario(1, {
        id_pessoa: 501,
        data_nascimento: '2012-03-01',
        idade: 14,
        menor_de_idade: true,
      }),
    ]
    const { u, secao } = await abrirVoluntario()
    await secao.findByRole('form', { name: 'Termo de adesão' })
    await u.type(secao.getByLabelText('Atividade'), 'Oficina de leitura')
    await u.type(secao.getByLabelText('Carga horária semanal (horas)'), '2')
    fireEvent.change(secao.getByLabelText('Fim da vigência'), {
      target: { value: '2099-12-31' },
    })
    await u.click(
      secao.getByRole('button', { name: 'Registrar termo de adesão' }),
    )
    expect(await secao.findByRole('alert')).toHaveTextContent(
      'Informe a referência da autorização do responsável',
    )
    expect(api.registrarTermoDeVoluntario).not.toHaveBeenCalled()

    await u.type(
      secao.getByLabelText('Autorização do responsável (referência)'),
      'Documento anexado no protocolo 12',
    )
    await u.click(
      secao.getByRole('button', { name: 'Registrar termo de adesão' }),
    )
    await waitFor(() =>
      expect(api.registrarTermoDeVoluntario).toHaveBeenCalledWith(
        501,
        expect.objectContaining({
          atividade: 'Oficina de leitura',
          autorizacao_responsavel_referencia:
            'Documento anexado no protocolo 12',
        }),
      ),
    )
    expect(
      await secao.findByText(/Termo de adesão vigente até 31\/12\/2099/),
    ).toBeVisible()
  })

  it('o erro 422 do servidor aparece em português; se ele exige a autorização do responsável, o campo aparece', async () => {
    vi.mocked(api.registrarTermoDeVoluntario).mockRejectedValue(
      new api.ApiError(
        422,
        'Voluntário menor de idade exige autorização de responsável anexada.',
      ),
    )
    // o pedido diz que é adulto, mas o cadastro da pessoa não tem a data de nascimento: o servidor pede a autorização do mesmo jeito
    base = [pedidoDeVoluntario(1, { id_pessoa: 501 })]
    const { u, secao } = await abrirVoluntario()
    await secao.findByRole('form', { name: 'Termo de adesão' })
    expect(
      secao.queryByLabelText('Autorização do responsável (referência)'),
    ).toBeNull()
    await u.type(secao.getByLabelText('Atividade'), 'Recepção')
    await u.type(secao.getByLabelText('Carga horária semanal (horas)'), '3')
    fireEvent.change(secao.getByLabelText('Fim da vigência'), {
      target: { value: '2099-12-31' },
    })
    await u.click(
      secao.getByRole('button', { name: 'Registrar termo de adesão' }),
    )
    expect(await secao.findByRole('alert')).toHaveTextContent(
      'Voluntário menor de idade exige autorização de responsável anexada.',
    )
    expect(
      await secao.findByLabelText('Autorização do responsável (referência)'),
    ).toBeVisible()
    // o que foi digitado fica, e o termo não foi gravado
    expect(secao.getByLabelText('Atividade')).toHaveValue('Recepção')
    expect(secao.queryByText(/Termo de adesão vigente/)).toBeNull()
  })

  it('outra recusa do servidor (datas) também aparece em português, no formulário', async () => {
    vi.mocked(api.registrarTermoDeVoluntario).mockRejectedValue(
      new api.ApiError(
        422,
        'Data de fim de vigência precisa ser depois da data de início.',
      ),
    )
    base = [pedidoDeVoluntario(1, { id_pessoa: 501 })]
    const { u, secao } = await abrirVoluntario()
    await secao.findByRole('form', { name: 'Termo de adesão' })
    await u.type(secao.getByLabelText('Atividade'), 'Recepção')
    await u.type(secao.getByLabelText('Carga horária semanal (horas)'), '3')
    fireEvent.change(secao.getByLabelText('Fim da vigência'), {
      target: { value: '2099-12-31' },
    })
    await u.click(
      secao.getByRole('button', { name: 'Registrar termo de adesão' }),
    )
    expect(await secao.findByRole('alert')).toHaveTextContent(
      'Data de fim de vigência precisa ser depois da data de início.',
    )
    expect(
      secao.queryByLabelText('Autorização do responsável (referência)'),
    ).toBeNull()
  })

  it('quem não pode consultar o termo (sem a permissão de associados) vê o motivo em vez de um formulário', async () => {
    vi.mocked(api.obterTermoVigente).mockRejectedValue(
      new api.ApiError(403, 'Você não tem permissão para esta ação.'),
    )
    base = [pedidoDeVoluntario(1, { id_pessoa: 501 })]
    const { secao } = await abrirVoluntario()
    expect(await secao.findByRole('alert')).toHaveTextContent(
      'Você não tem permissão para esta ação.',
    )
    expect(secao.queryByRole('form', { name: 'Termo de adesão' })).toBeNull()
  })

  it('o cartão do pedido de voluntariado passa no axe: sem cadastro, com o formulário do termo (menor de idade) e com o termo vigente', async () => {
    base = [
      pedidoDeVoluntario(1),
      pedidoDeVoluntario(2, {
        id_pessoa: 501,
        data_nascimento: '2012-03-01',
        idade: 14,
        menor_de_idade: true,
      }),
      pedidoDeVoluntario(3, { id_pessoa: 502 }),
    ]
    termos[502] = {
      vigente: true,
      id_termo: 3,
      atividade: 'Recepção',
      carga_horaria_semanal: 6,
      data_fim_vigencia: '2027-03-31T00:00:00',
      versao: 1,
    }
    const u = userEvent.setup()
    const { container } = desenhar()
    // um cartão aberto por vez: dois cartões abertos repetem os mesmos nomes de região (o mesmo já vale para "Mensagem recebida")
    const conferir = async (
      protocolo: string,
      espera: (dentro: ReturnType<typeof within>) => Promise<unknown>,
    ) => {
      const dentro = await cartaoCarregado(protocolo)
      await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
      await espera(dentro)
      expect(await axe(container)).toHaveNoViolations()
      await u.click(dentro.getByRole('button', { name: 'Fechar' }))
    }
    await conferir('ASAF-2026-00001', (d) =>
      d.findByRole('button', { name: 'Cadastrar como voluntário' }),
    )
    await conferir('ASAF-2026-00002', (d) =>
      d.findByRole('form', { name: 'Termo de adesão' }),
    )
    await conferir('ASAF-2026-00003', (d) =>
      d.findByText(/Termo de adesão vigente até 31\/03\/2027/),
    )
  })
})

describe('Atendimento: acessibilidade', () => {
  it('a lista, com um pedido aberto, não tem violação (axe)', async () => {
    const u = userEvent.setup()
    base = [
      pedido(1, { cpf: '52998224725', id_pessoa: 3 }),
      pedido(2, { status: 'Encerrado', situacao_do_prazo: 'encerrado' }),
    ]
    const { container } = desenhar('/atendimentos?situacao=todas')
    const dentro = await cartaoCarregado('ASAF-2026-00001')
    await u.click(await dentro.findByRole('button', { name: 'Abrir' }))
    await dentro.findByLabelText('Resposta')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o vazio e a lista paginada também passam no axe', async () => {
    base = Array.from({ length: 30 }, (_, i) => pedido(i + 1))
    const { container } = desenhar()
    await screen.findByText('Página 1 de 2')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Atendimento: o módulo no painel', () => {
  it('está registrado em /atendimentos com a permissão `atendimento` e um ícone só dele', () => {
    const modulo = modulos.find((m) => m.rota === '/atendimentos')
    expect(modulo).toBeDefined()
    expect(modulo?.rotulo).toBe('Atendimento')
    expect(modulo?.permissao).toBe('atendimento')
    if (!modulo) return
    expect(moduloVisivel(modulo, ['atendimento'])).toBe(true)
    expect(moduloVisivel(modulo, ['associados'])).toBe(false)
    const mesmoIcone = modulos.filter((m) => m.icone === modulo?.icone)
    expect(mesmoIcone).toHaveLength(1)
  })

  it('o Início oferece o cartão só a quem tem a permissão', () => {
    const useMeMock = vi.mocked(useMe)
    useMeMock.mockReturnValue({
      data: { nome_completo: 'Fulano', permissoes: ['atendimento'] },
    } as unknown as ReturnType<typeof useMe>)
    const { unmount } = render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Atendimento' })).toHaveAttribute(
      'href',
      '/atendimentos',
    )
    unmount()

    useMeMock.mockReturnValue({
      data: { nome_completo: 'Fulano', permissoes: ['associados'] },
    } as unknown as ReturnType<typeof useMe>)
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: 'Atendimento' })).toBeNull()
  })
})

describe('Atendimento: textos de prazo e aviso do e-mail', () => {
  const agora = new Date('2026-10-09T12:00:00Z')
  const prazoBase = {
    situacao_do_prazo: 'no_prazo' as const,
    dias_restantes: 10,
    prazo_em: '2026-10-19T15:00:00',
  }

  it('prazo em aberto', () => {
    expect(textoDoPrazo(prazoBase, agora)).toBe('Vence em 10 dias')
    expect(
      textoDoPrazo(
        { ...prazoBase, situacao_do_prazo: 'vence_logo', dias_restantes: 2 },
        agora,
      ),
    ).toBe('Vence em 2 dias')
    // 1 = menos de 24 horas: se o prazo cai no mesmo dia, é "hoje"
    expect(
      textoDoPrazo(
        {
          situacao_do_prazo: 'vence_logo',
          dias_restantes: 1,
          prazo_em: '2026-10-09T13:00:00',
        },
        agora,
      ),
    ).toBe('Vence hoje')
    expect(
      textoDoPrazo(
        {
          situacao_do_prazo: 'vence_logo',
          dias_restantes: 1,
          prazo_em: '2026-10-11T20:00:00',
        },
        agora,
      ),
    ).toBe('Vence em 1 dia')
    expect(
      textoDoPrazo(
        { ...prazoBase, situacao_do_prazo: 'vence_logo', dias_restantes: 0 },
        agora,
      ),
    ).toBe('Vence hoje')
  })

  it('prazo vencido, cumprido e encerrado', () => {
    expect(
      textoDoPrazo(
        { ...prazoBase, situacao_do_prazo: 'vencido', dias_restantes: -1 },
        agora,
      ),
    ).toBe('Vencido há 1 dia')
    expect(
      textoDoPrazo(
        { ...prazoBase, situacao_do_prazo: 'vencido', dias_restantes: -12 },
        agora,
      ),
    ).toBe('Vencido há 12 dias')
    expect(
      textoDoPrazo(
        { ...prazoBase, situacao_do_prazo: 'vencido', dias_restantes: 0 },
        agora,
      ),
    ).toBe('Vencido hoje')
    expect(
      textoDoPrazo({ ...prazoBase, situacao_do_prazo: 'cumprido' }, agora),
    ).toBe('Respondido no prazo')
    expect(
      textoDoPrazo(
        { ...prazoBase, situacao_do_prazo: 'cumprido_com_atraso' },
        agora,
      ),
    ).toBe('Respondido com atraso')
    expect(
      textoDoPrazo({ ...prazoBase, situacao_do_prazo: 'encerrado' }, agora),
    ).toBe('Encerrado')
  })

  it('o aviso sobre o e-mail da resposta tem três casos', () => {
    const contato = {
      email_contato: 'maria@homologacao.example.com',
      telefone_whatsapp: null,
    }
    expect(
      avisoDoEnvioDaResposta({ ...contato, resposta_enviada_por_email: true }),
    ).toEqual({ texto: 'A resposta foi enviada por e-mail.', atencao: false })
    expect(
      avisoDoEnvioDaResposta({ ...contato, resposta_enviada_por_email: false }),
    ).toEqual({
      texto:
        'Não foi possível enviar por e-mail: avise a pessoa por outro meio (e-mail/telefone acima).',
      atencao: true,
    })
    expect(
      avisoDoEnvioDaResposta({ ...contato, resposta_enviada_por_email: null }),
    ).toEqual({
      texto: 'Sem e-mail cadastrado: avise a pessoa pelo telefone.',
      atencao: false,
    })
  })

  it('a prévia da mensagem corta numa palavra inteira e junta as quebras de linha', () => {
    expect(previaDaMensagem('Oi,\n\ntudo bem?')).toBe('Oi, tudo bem?')
    const longa = previaDaMensagem('abcdefghij '.repeat(40), 50)
    expect(longa.endsWith('…')).toBe(true)
    expect(longa.length).toBeLessThanOrEqual(51)
    expect(longa).not.toMatch(/abcdefghi…$/)
  })
})

describe('Atendimento: o pedido de voluntariado (textos e regras)', () => {
  it('a data de nascimento sai em dia/mês/ano, com a idade no singular e no plural', () => {
    expect(
      textoDaDataDeNascimento({ data_nascimento: '1990-05-10', idade: 36 }),
    ).toBe('Data de nascimento: 10/05/1990 (36 anos)')
    expect(
      textoDaDataDeNascimento({ data_nascimento: '2025-10-01', idade: 1 }),
    ).toBe('Data de nascimento: 01/10/2025 (1 ano)')
    expect(
      textoDaDataDeNascimento({ data_nascimento: '1990-05-10', idade: null }),
    ).toBe('Data de nascimento: 10/05/1990')
    expect(
      textoDaDataDeNascimento({ data_nascimento: null, idade: null }),
    ).toBe('Data de nascimento: não informada.')
  })

  it('a carga horária aceita vírgula e só vale se for maior que zero', () => {
    expect(cargaHorariaSemanal('4')).toBe(4)
    expect(cargaHorariaSemanal(' 4,5 ')).toBe(4.5)
    expect(cargaHorariaSemanal('0')).toBeNull()
    expect(cargaHorariaSemanal('-2')).toBeNull()
    expect(cargaHorariaSemanal('abc')).toBeNull()
    expect(cargaHorariaSemanal('')).toBeNull()
  })

  it('o dia de hoje para o campo de data sai pelo relógio local (aaaa-mm-dd)', () => {
    expect(hojeParaCampoDeData(new Date(2026, 9, 9, 23, 30))).toBe('2026-10-09')
    expect(hojeParaCampoDeData(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05')
  })

  it('o termo diz a primeira coisa que falta, e a autorização só é exigida quando for o caso', () => {
    const ok = {
      atividade: 'Recepção',
      carga: '4',
      inicio: '2026-10-10',
      fim: '2027-10-10',
      autorizacao: '',
    }
    expect(validarTermoDeAdesao(ok, false)).toBeNull()
    expect(validarTermoDeAdesao({ ...ok, atividade: '  ' }, false)).toBe(
      'Informe a atividade do voluntário.',
    )
    expect(validarTermoDeAdesao({ ...ok, carga: '' }, false)).toBe(
      'Informe a carga horária semanal.',
    )
    expect(validarTermoDeAdesao({ ...ok, carga: '0' }, false)).toBe(
      'A carga horária semanal precisa ser um número maior que zero.',
    )
    expect(validarTermoDeAdesao({ ...ok, inicio: '' }, false)).toBe(
      'Informe o início da vigência.',
    )
    expect(validarTermoDeAdesao({ ...ok, fim: '' }, false)).toBe(
      'Informe o fim da vigência.',
    )
    expect(validarTermoDeAdesao({ ...ok, fim: '2026-10-10' }, false)).toBe(
      'O fim da vigência precisa ser depois do início.',
    )
    expect(validarTermoDeAdesao(ok, true)).toMatch(
      /^Informe a referência da autorização do responsável/,
    )
    expect(
      validarTermoDeAdesao({ ...ok, autorizacao: 'Protocolo 12' }, true),
    ).toBeNull()
  })

  it('reconhece a recusa do servidor por falta da autorização do responsável', () => {
    expect(
      recusaPorFaltaDeAutorizacao(
        'Voluntário menor de idade exige autorização de responsável anexada.',
      ),
    ).toBe(true)
    expect(recusaPorFaltaDeAutorizacao('Pessoa não encontrada.')).toBe(false)
  })
})
