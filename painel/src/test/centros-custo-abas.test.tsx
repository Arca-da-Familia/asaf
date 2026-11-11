import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { CentroDeCusto } from '@/lib/api'
import { CentrosCustoPage } from '@/pages/CentrosCusto'

// v9.3w (a tela tinha 8,9 alturas de notebook na homologação e dizia "Projeto #12", "Centro #3"): centros e remanejamentos em abas (?parte=), os
// centros com busca e páginas de 10, o vínculo e os centros do remanejamento pelo nome, a data como se lê no Brasil.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarCentrosCusto: vi.fn(),
  listarRemanejamentosDestinacao: vi.fn(),
  listarProjetos: vi.fn(),
  listarEventos: vi.fn(),
  criarCentroCusto: vi.fn(),
  obterSaldoRestrito: vi.fn(),
}))

function centro(
  id: number,
  codigo: string,
  nome: string,
  extra: Partial<CentroDeCusto> = {},
): CentroDeCusto {
  return {
    id_centro_custo: id,
    codigo,
    nome,
    id_projeto: null,
    id_evento: null,
    ativo: true,
    saldo_restrito: false,
    ...extra,
  }
}

let centros: CentroDeCusto[] = []

function Endereco() {
  const local = useLocation()
  return <p data-testid="endereco">{local.search}</p>
}

function desenhar(endereco = '/financeiro/centros-custo') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[endereco]}>
        <CentrosCustoPage />
        <Endereco />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const nomesNaTela = () =>
  [...document.querySelectorAll('p.font-medium')].map((p) => p.textContent)

beforeEach(() => {
  vi.resetAllMocks()
  centros = [
    centro(1, 'CC-01', 'Administração'),
    centro(2, 'CC-02', 'Despertai', {
      id_projeto: 12,
      nome_projeto: 'Projeto Despertai',
    }),
    centro(3, 'CC-03', 'Bazar', {
      id_evento: 5,
      titulo_evento: 'Bazar de Natal',
    }),
    centro(4, 'CC-04', 'Sem nome vindo da API antiga', { id_projeto: 7 }),
  ]
  vi.mocked(api.listarCentrosCusto).mockImplementation(() =>
    Promise.resolve([...centros]),
  )
  vi.mocked(api.listarRemanejamentosDestinacao).mockResolvedValue([
    {
      id_remanejamento: 1,
      id_centro_custo_origem: 2,
      id_centro_custo_destino: 3,
      valor: 150,
      motivo: 'Decisão da Diretoria',
      data_remanejamento: '2026-11-10',
    },
  ])
  vi.mocked(api.listarProjetos).mockResolvedValue([])
  vi.mocked(api.listarEventos).mockResolvedValue([])
})

describe('Centros de custo: abas, busca, páginas e nomes', () => {
  it('o vínculo aparece pelo nome do projeto ou do evento (e por extenso se a API não manda o nome)', async () => {
    desenhar()
    expect(
      await screen.findByText(/Ativo · Projeto: Projeto Despertai/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Ativo · Evento: Bazar de Natal/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Ativo · Projeto: nº 7/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/#\d/)
  })

  it('os remanejamentos ficam na outra aba, com os centros pelo nome e a data como se lê no Brasil', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByText(/Projeto Despertai/)
    expect(screen.queryByText(/Decisão da Diretoria/)).toBeNull()
    await u.click(
      screen.getByRole('tab', { name: 'Remanejamentos de destinação' }),
    )
    expect(screen.getByTestId('endereco')).toHaveTextContent(
      'parte=remanejamentos',
    )
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'P' &&
          /R\$\s150,00 — de CC-02 — Despertai para CC-03 — Bazar/.test(
            el.textContent ?? '',
          ),
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Decisão da Diretoria · 10/11/2026'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Novo remanejamento' }),
    ).toBeInTheDocument()
  })

  it('com mais de 10 centros: busca pelo código ou nome (sem acento) e páginas de 10', async () => {
    const u = userEvent.setup()
    centros = Array.from({ length: 13 }, (_, i) =>
      centro(
        i + 1,
        `CC-${String(i + 1).padStart(2, '0')}`,
        i === 11 ? 'Ação Social' : `Centro ${i + 1}`,
      ),
    )
    desenhar()
    await screen.findByText('CC-01 — Centro 1')
    expect(nomesNaTela()).toHaveLength(10)
    const paginas = within(
      screen.getByRole('navigation', { name: 'Páginas dos centros de custo' }),
    )
    await u.click(paginas.getByRole('button', { name: 'Próxima página' }))
    expect(nomesNaTela()).toEqual([
      'CC-11 — Centro 11',
      'CC-12 — Ação Social',
      'CC-13 — Centro 13',
    ])
    await u.type(screen.getByLabelText('Procurar centro de custo'), 'acao')
    expect(nomesNaTela()).toEqual(['CC-12 — Ação Social'])
    expect(screen.getByText('1 centro encontrado.')).toBeInTheDocument()
  })

  it('o centro recém-cadastrado aparece: a lista vai à página dele', async () => {
    const u = userEvent.setup()
    centros = Array.from({ length: 12 }, (_, i) =>
      centro(i + 1, `CC-${String(i + 1).padStart(2, '0')}`, `Centro ${i + 1}`),
    )
    vi.mocked(api.criarCentroCusto).mockImplementation((dados) => {
      centros = [...centros, centro(99, dados.codigo, dados.nome)]
      return Promise.resolve({ mensagem: 'ok', id_centro_custo: 99 })
    })
    desenhar()
    await screen.findByText('CC-01 — Centro 1')
    await u.click(screen.getByRole('button', { name: 'Novo centro de custo' }))
    await u.type(screen.getByPlaceholderText('Código'), 'CC-99')
    await u.type(screen.getByPlaceholderText('Nome'), 'Centro novo')
    await u.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(await screen.findByText('CC-99 — Centro novo')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/^Página 2 de 2/)).toBeInTheDocument(),
    )
  })

  it('as abas passam no axe', async () => {
    const { container } = desenhar()
    await screen.findByText(/Projeto Despertai/)
    expect(await axe(container)).toHaveNoViolations()
  })
})
