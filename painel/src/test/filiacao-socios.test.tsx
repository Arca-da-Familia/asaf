import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SinoDeAvisos } from '@/components/layout/SinoDeAvisos'
import * as api from '@/lib/api'
import { FiliacaoParaProporPage } from '@/pages/FiliacaoParaPropor'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarMinhasNotificacoes: vi.fn(),
  marcarAvisoComoLido: vi.fn(),
  marcarTodosOsAvisosComoLidos: vi.fn(),
  listarPedidosParaPropor: vi.fn(),
  proporCandidato: vi.fn(),
}))

function desenhar(componente: React.ReactNode) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>{componente}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const aviso = (
  id: number,
  extra: Partial<api.AvisoDoPainel> = {},
): api.AvisoDoPainel => ({
  id_notificacao: id,
  tipo: 'filiacao_proposta',
  titulo: 'Novo pedido de filiação',
  texto: 'Maria quer se associar. Você propõe este candidato?',
  link: '/filiacao/para-propor',
  criado_em: '2026-10-08T12:00:00',
  lida: false,
  ...extra,
})

const pedido = (
  extra: Partial<api.PedidoParaPropor> = {},
): api.PedidoParaPropor => ({
  id_proposta: 7,
  nome_completo: 'Maria Candidata',
  idade: 34,
  criado_em: '2026-10-08T12:00:00',
  total_propoem: 1,
  exigidos: 3,
  faltam: 2,
  minha_decisao: null,
  meu_motivo: null,
  ...extra,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.marcarAvisoComoLido).mockResolvedValue(aviso(1, { lida: true }))
  vi.mocked(api.marcarTodosOsAvisosComoLidos).mockResolvedValue({ marcadas: 2 })
  vi.mocked(api.proporCandidato).mockResolvedValue({
    decisao: 'Propõe',
    total_propoem: 2,
    exigidos: 3,
    faltam: 1,
  })
})

describe('O sino do painel', () => {
  it('mostra quantos avisos faltam ler no próprio botão; sem aviso, o botão fica simples', async () => {
    vi.mocked(api.listarMinhasNotificacoes).mockResolvedValue({
      nao_lidas: 2,
      avisos: [aviso(1), aviso(2)],
    })
    desenhar(<SinoDeAvisos />)
    expect(
      await screen.findByRole('button', { name: 'Notificações (2 novas)' }),
    ).toBeInTheDocument()
  })

  it('sem nada novo o nome é só "Notificações" e o painel diz que não há aviso', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarMinhasNotificacoes).mockResolvedValue({
      nao_lidas: 0,
      avisos: [],
    })
    desenhar(<SinoDeAvisos />)
    await u.click(await screen.findByRole('button', { name: 'Notificações' }))
    expect(await screen.findByText('Nenhum aviso.')).toBeInTheDocument()
  })

  it('abre a lista, o aviso leva à tela dele e é marcado como lido; dá para marcar todos; passa no axe', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarMinhasNotificacoes).mockResolvedValue({
      nao_lidas: 2,
      avisos: [aviso(1), aviso(2, { titulo: 'Outro aviso', lida: true })],
    })
    const { container } = desenhar(<SinoDeAvisos />)
    await u.click(
      await screen.findByRole('button', { name: 'Notificações (2 novas)' }),
    )
    const painel = await screen.findByRole('region', {
      name: 'Avisos do painel',
    })
    expect(within(painel).getByText('Outro aviso')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
    await u.click(
      within(painel).getByRole('button', { name: 'Marcar todos como lidos' }),
    )
    await waitFor(() =>
      expect(api.marcarTodosOsAvisosComoLidos).toHaveBeenCalled(),
    )
    // o link do aviso não lido marca como lido
    await u.click(
      await screen.findByRole('link', { name: 'Novo pedido de filiação' }),
    )
    await waitFor(() => expect(api.marcarAvisoComoLido).toHaveBeenCalledWith(1))
  })
})

describe('Pedidos de filiação (o sócio propõe ou recusa)', () => {
  it('mostra o nome, a idade e quantos sócios já propuseram, sem dado pessoal; passa no axe', async () => {
    vi.mocked(api.listarPedidosParaPropor).mockResolvedValue([pedido()])
    const { container } = desenhar(<FiliacaoParaProporPage />)
    const cartao = within(
      await screen.findByLabelText('Pedido de Maria Candidata'),
    )
    expect(cartao.getByText(/34 anos/)).toBeInTheDocument()
    expect(
      cartao.getByText(/1 de 3 sócios já propuseram — faltam 2\./),
    ).toBeInTheDocument()
    expect(screen.queryByText(/CPF|@|telefone/i)).toBeNull()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('"Propor" registra a decisão na hora', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarPedidosParaPropor).mockResolvedValue([pedido()])
    desenhar(<FiliacaoParaProporPage />)
    await u.click(
      await screen.findByRole('button', { name: 'Propor Maria Candidata' }),
    )
    await waitFor(() =>
      expect(api.proporCandidato).toHaveBeenCalledWith(7, {
        decisao: 'Propõe',
      }),
    )
  })

  it('recusar só segue com o motivo (5 letras ou mais) e o envia', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarPedidosParaPropor).mockResolvedValue([pedido()])
    desenhar(<FiliacaoParaProporPage />)
    await u.click(
      await screen.findByRole('button', { name: 'Recusar Maria Candidata' }),
    )
    const confirmar = screen.getByRole('button', { name: 'Confirmar recusa' })
    expect(confirmar).toBeDisabled()
    const motivo = screen.getByLabelText(/Motivo da recusa/)
    await u.type(motivo, 'não')
    expect(confirmar).toBeDisabled()
    await u.type(motivo, ' conheço a família')
    await u.click(confirmar)
    await waitFor(() =>
      expect(api.proporCandidato).toHaveBeenCalledWith(7, {
        decisao: 'Recusa',
        observacao: 'não conheço a família',
      }),
    )
  })

  it('mostra o que o próprio sócio já decidiu', async () => {
    vi.mocked(api.listarPedidosParaPropor).mockResolvedValue([
      pedido({ id_proposta: 7, minha_decisao: 'Propõe' }),
      pedido({
        id_proposta: 8,
        nome_completo: 'Outro Candidato',
        minha_decisao: 'Recusa',
        meu_motivo: 'Não conheço',
      }),
    ])
    desenhar(<FiliacaoParaProporPage />)
    const propus = within(
      await screen.findByLabelText('Pedido de Maria Candidata'),
    )
    expect(propus.getByRole('status')).toHaveTextContent(
      'Você propôs este candidato.',
    )
    expect(
      propus.getByRole('button', { name: 'Propor Maria Candidata' }),
    ).toBeDisabled()
    const recusei = within(screen.getByLabelText('Pedido de Outro Candidato'))
    expect(recusei.getByRole('status')).toHaveTextContent(
      'Você recusou este candidato: “Não conheço”.',
    )
  })

  it('sem pedido aberto diz isso; quem não é sócio apto lê a recusa do servidor', async () => {
    vi.mocked(api.listarPedidosParaPropor).mockResolvedValue([])
    const { unmount } = desenhar(<FiliacaoParaProporPage />)
    expect(
      await screen.findByText('Nenhum pedido em aberto'),
    ).toBeInTheDocument()
    unmount()
    vi.mocked(api.listarPedidosParaPropor).mockRejectedValue(
      new Error('Só sócio ativo e em dia propõe um candidato.'),
    )
    desenhar(<FiliacaoParaProporPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Só sócio ativo e em dia propõe',
    )
  })
})
