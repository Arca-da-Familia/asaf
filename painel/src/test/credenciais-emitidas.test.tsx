import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CredencialDoAssociado } from '@/components/associados/CredencialDoAssociado'
import * as api from '@/lib/api'
import { ApiError, type LinhaDeCredencial } from '@/lib/api'
import { CredenciaisEmitidasPage } from '@/pages/CredenciaisEmitidas'
import { ImprimirCredenciaisPage } from '@/pages/ImprimirCredenciais'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarCredenciais: vi.fn(),
  resumirCredenciais: vi.fn(),
  obterFolhaDeImpressao: vi.fn(),
  registrarImpressao: vi.fn(),
  obterModeloEmUso: vi.fn(),
  emitirOutraCredencial: vi.fn(),
  obterCredencialDoAssociado: vi.fn(),
}))

function desenhar(no: React.ReactNode, endereco = '/') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[endereco]}>{no}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function linha(
  sobrescrever: Partial<LinhaDeCredencial> = {},
): LinhaDeCredencial {
  return {
    id_associado: 1,
    nome_completo: 'Ana de Teste',
    matricula: 12,
    situacao: 'Ativo - Em Dia',
    credencial: null,
    emitida_de_novo: false,
    faltando: [],
    ...sobrescrever,
  }
}

const abrir = vi.fn()

// v9.5k: o desenho em uso (um pedaço do pronto "Faixa no alto")
const DESENHO = {
  fundo: '#ffffff',
  partes: [
    {
      id: 'faixa',
      tipo: 'faixa',
      x: 0,
      y: 0,
      largura: 85.6,
      altura: 10,
      cor: '#14532d',
    },
    { id: 'foto', tipo: 'foto', x: 3, y: 17, largura: 20, altura: 26 },
    {
      id: 'nome',
      tipo: 'nome',
      x: 25.5,
      y: 17,
      largura: 33.5,
      altura: 10.5,
      tamanho: 9,
      negrito: true,
      cor: '#0b1611',
    },
    {
      id: 'matricula',
      tipo: 'matricula',
      x: 25.5,
      y: 28,
      largura: 33.5,
      altura: 3.8,
      tamanho: 7.5,
      cor: '#0b1611',
    },
    { id: 'qr', tipo: 'qr', x: 61, y: 17, largura: 22, altura: 22 },
  ],
} as const

beforeEach(() => {
  vi.resetAllMocks()
  window.open = abrir as unknown as typeof window.open
  vi.mocked(api.obterModeloEmUso).mockResolvedValue({
    id_modelo: null,
    nome: 'Faixa no alto',
    pronto: 'faixa-no-alto',
    desenho: structuredClone(DESENHO) as unknown as api.ModeloEmUso['desenho'],
  })
  vi.mocked(api.resumirCredenciais).mockResolvedValue({
    todas: 3,
    falta_imprimir: 2,
    impressas: 1,
    emitidas_de_novo: 1,
  })
  vi.mocked(api.listarCredenciais).mockResolvedValue({
    total: 3,
    itens: [
      linha(),
      linha({
        id_associado: 2,
        nome_completo: 'Bruno de Teste',
        credencial: {
          emitida_em: '2026-11-01T12:00:00',
          impressa_em: '2026-11-10T12:00:00',
        },
      }),
      linha({
        id_associado: 3,
        nome_completo: 'Carla de Teste',
        emitida_de_novo: true,
        faltando: ['foto'],
      }),
    ],
  })
})

describe('Credenciais emitidas (v9.5j)', () => {
  it('a tabela com os filtros e a contagem, como está cada credencial e o que falta', async () => {
    const u = userEvent.setup()
    const { container } = desenhar(<CredenciaisEmitidasPage />)
    const tabela = await screen.findByRole('table', {
      name: 'Credenciais dos associados',
    })
    expect(within(tabela).getAllByText('Falta imprimir')).toHaveLength(2)
    expect(
      within(tabela).getByText('Impressa em 10/11/2026'),
    ).toBeInTheDocument()
    expect(within(tabela).getByText('Emitida de novo')).toBeInTheDocument()
    expect(within(tabela).getByText('Falta foto')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Falta imprimir · 2' }),
    ).toHaveAttribute('aria-pressed', 'false')
    await u.click(screen.getByRole('button', { name: 'Impressas · 1' }))
    await waitFor(() =>
      expect(api.listarCredenciais).toHaveBeenLastCalledWith(
        'impressas',
        '',
        1,
        25,
      ),
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('marcar várias e "Imprimir as marcadas" abre a folha numa segunda aba', async () => {
    const u = userEvent.setup()
    desenhar(<CredenciaisEmitidasPage />)
    const tabela = await screen.findByRole('table', {
      name: 'Credenciais dos associados',
    })
    await u.click(
      within(tabela).getByRole('checkbox', { name: 'Marcar Ana de Teste' }),
    )
    await u.click(
      within(tabela).getByRole('checkbox', { name: 'Marcar Carla de Teste' }),
    )
    expect(screen.getByText('2 marcadas')).toBeInTheDocument()
    await u.click(
      screen.getByRole('button', { name: 'Imprimir as marcadas (folha A4)' }),
    )
    expect(abrir).toHaveBeenCalledWith(
      '/associados/credenciais/imprimir?ids=1,3',
      '_blank',
      'noopener',
    )
    await u.click(
      within(tabela).getByRole('checkbox', {
        name: 'Marcar todos desta página',
      }),
    )
    expect(screen.getByText('3 marcadas')).toBeInTheDocument()
  })

  it('"Emitir outra" pede confirmação na própria linha', async () => {
    const u = userEvent.setup()
    vi.mocked(api.emitirOutraCredencial).mockResolvedValue({
      mensagem: 'Credencial nova emitida. A anterior deixou de valer.',
      codigo: 'x',
      pagina: '/credencial/x',
      emitida_em: null,
    })
    desenhar(<CredenciaisEmitidasPage />)
    const tabela = await screen.findByRole('table', {
      name: 'Credenciais dos associados',
    })
    const daAna = within(tabela).getByRole('row', { name: /Ana de Teste/ })
    await u.click(within(daAna).getByRole('button', { name: 'Emitir outra' }))
    expect(api.emitirOutraCredencial).not.toHaveBeenCalled()
    expect(
      within(daAna).getByText('A atual deixa de valer na hora.'),
    ).toBeInTheDocument()
    await u.click(
      within(daAna).getAllByRole('button', { name: 'Emitir outra' })[0]!,
    )
    await waitFor(() =>
      expect(api.emitirOutraCredencial).toHaveBeenCalledWith(1),
    )
    expect(await within(daAna).findByRole('status')).toHaveTextContent(
      'A anterior deixou de valer.',
    )
  })
})

describe('A folha de impressão, na segunda aba (v9.5j)', () => {
  function abrirFolha(ids = '1,3') {
    return desenhar(
      <Routes>
        <Route
          path="/associados/credenciais/imprimir"
          element={<ImprimirCredenciaisPage />}
        />
      </Routes>,
      `/associados/credenciais/imprimir?ids=${ids}`,
    )
  }
  const cartao = {
    nome_completo: 'Ana de Teste',
    matricula: 12,
    categoria: 'Efetivo',
    associado_desde: '2019-03-01',
    foto: '/uploads/fotos/a.jpg',
    pagina: '/credencial/AbCdEfGhIjKlMnOpQrStUv',
    impressa_em: null,
  }

  it('cartão com dado faltando só se imprime com justificativa; Imprimir registra e abre a impressão do navegador', async () => {
    const u = userEvent.setup()
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {})
    vi.mocked(api.obterFolhaDeImpressao).mockResolvedValue([
      { ...cartao, id_associado: 1, faltando: [] },
      {
        ...cartao,
        id_associado: 3,
        nome_completo: 'Carla de Teste',
        foto: null,
        faltando: ['foto'],
      },
    ])
    vi.mocked(api.registrarImpressao).mockResolvedValue({
      mensagem: 'Registrado: 2 credenciais impressas.',
      impressas: 2,
    })
    const { container } = abrirFolha()
    expect(
      await screen.findByRole('region', { name: 'Folha 1 de 1' }),
    ).toBeInTheDocument()
    expect(api.obterFolhaDeImpressao).toHaveBeenCalledWith([1, 3])
    expect(
      screen.getByLabelText('Credencial de Ana de Teste'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('Credencial de Ana de Teste')).getByText(
        'Matrícula nº 12',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Falta dado em 1 cartão/)).toBeInTheDocument()
    const botao = screen.getByRole('button', { name: 'Imprimir' })
    expect(botao).toBeDisabled()
    await u.type(screen.getByLabelText(/Carla de Teste: falta foto/), 'curta')
    expect(botao).toBeDisabled()
    await u.type(
      screen.getByLabelText(/Carla de Teste: falta foto/),
      ' - ela traz a foto depois',
    )
    expect(botao).toBeEnabled()
    await u.click(botao)
    await waitFor(() =>
      expect(api.registrarImpressao).toHaveBeenCalledWith([1, 3], {
        3: 'curta - ela traz a foto depois',
      }),
    )
    expect(imprimir).toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'a credencial é a mesma',
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('a recusa do servidor aparece; sem ninguém escolhido, explica', async () => {
    vi.mocked(api.obterFolhaDeImpressao).mockRejectedValue(
      new ApiError(409, 'Desligado não tem credencial valendo: Fulano.'),
    )
    const { unmount } = abrirFolha('9')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Desligado não tem credencial valendo',
    )
    unmount()
    abrirFolha('')
    expect(screen.getByText(/Nenhuma credencial escolhida/)).toBeInTheDocument()
    expect(api.obterFolhaDeImpressao).toHaveBeenCalledTimes(1)
  })
})

describe('Na ficha (v9.5j)', () => {
  it('"Imprimir esta credencial" abre a folha só dela', async () => {
    const u = userEvent.setup()
    vi.mocked(api.obterCredencialDoAssociado).mockResolvedValue({
      codigo: 'x',
      pagina: '/credencial/x',
      emitida_em: '2026-11-01T12:00:00',
    })
    desenhar(<CredencialDoAssociado idAssociado={7} desligado={false} />)
    await u.click(
      await screen.findByRole('button', { name: 'Imprimir esta credencial' }),
    )
    expect(abrir).toHaveBeenCalledWith(
      '/associados/credenciais/imprimir?ids=7',
      '_blank',
      'noopener',
    )
  })
})
