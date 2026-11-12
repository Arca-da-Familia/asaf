import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { OrcamentoPage } from '@/pages/Orcamento'

// v9.3z4 (no celular a tela tinha 12,3 alturas): no celular, uma parte por aba (todas carregam ao abrir); a partir do tablet, as três juntas.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarCentrosCusto: vi.fn(),
  listarContasFinanceiras: vi.fn(),
  listarDeliberacoesConcluidas: vi.fn(),
  listarOrcamentos: vi.fn(),
  listarPlanoContas: vi.fn(),
  listarReservasContingencia: vi.fn(),
  obterFluxoDeCaixa: vi.fn(),
}))

function simularCelular(celular: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((consulta: string) => ({ matches: celular, media: consulta })),
  )
}

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <OrcamentoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarCentrosCusto).mockResolvedValue([])
  vi.mocked(api.listarContasFinanceiras).mockResolvedValue([])
  vi.mocked(api.listarDeliberacoesConcluidas).mockResolvedValue([])
  vi.mocked(api.listarOrcamentos).mockResolvedValue([])
  vi.mocked(api.listarPlanoContas).mockResolvedValue([])
  vi.mocked(api.listarReservasContingencia).mockResolvedValue([])
  vi.mocked(api.obterFluxoDeCaixa).mockResolvedValue({
    meses: [],
  } as unknown as Awaited<ReturnType<typeof api.obterFluxoDeCaixa>>)
})
afterEach(() => vi.unstubAllGlobals())

describe('Orçamento: abas só no celular', () => {
  it('no celular, uma parte por aba; todas carregam ao abrir', async () => {
    const u = userEvent.setup()
    simularCelular(true)
    desenhar()
    expect(
      await screen.findByRole('tab', { name: 'Orçamento', selected: true }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Fluxo de caixa projetado' }),
    ).toBeNull()
    expect(api.obterFluxoDeCaixa).toHaveBeenCalled()
    expect(api.listarReservasContingencia).toHaveBeenCalled()
    await u.click(screen.getByRole('tab', { name: 'Fluxo de caixa' }))
    expect(
      screen.getByRole('heading', { name: 'Fluxo de caixa projetado' }),
    ).toBeVisible()
  })

  it('a partir do tablet, as três partes juntas e nenhuma aba', async () => {
    simularCelular(false)
    desenhar()
    expect(
      await screen.findByRole('heading', { name: 'Fluxo de caixa projetado' }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Reserva de contingência' }),
    ).toBeVisible()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})
