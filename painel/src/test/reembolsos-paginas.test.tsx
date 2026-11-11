import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { ReembolsoDespesa } from '@/lib/api'
import { ReembolsoDespesaPage } from '@/pages/ReembolsoDespesa'

// v9.3y (a tela tinha 8 alturas de notebook na homologação): os reembolsos em páginas de 10, o mais recente primeiro.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarReembolsosDespesa: vi.fn(),
  listarAssociadosParaSelecao: vi.fn(),
  listarPlanoContas: vi.fn(),
}))

function reembolso(id: number): ReembolsoDespesa {
  return {
    id_reembolso: id,
    id_associado: 1,
    descricao: `Despesa ${id}`,
    valor: 10 * id,
    comprovante: `comprovantes/${id}.jpg`,
    status: 'Solicitado',
    id_usuario_solicitante: 2,
    id_usuario_aprovador: null,
    motivo_reprovacao: null,
    id_titulo_gerado: null,
    data_solicitacao: '2026-11-10T12:00:00',
  }
}

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <ReembolsoDespesaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  // como a API devolve: o mais recente primeiro
  vi.mocked(api.listarReembolsosDespesa).mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => reembolso(12 - i)),
  )
  vi.mocked(api.listarAssociadosParaSelecao).mockResolvedValue([])
  vi.mocked(api.listarPlanoContas).mockResolvedValue([])
})

describe('Reembolsos: páginas de 10, o mais recente primeiro', () => {
  it('mostra os 10 mais recentes e os outros na página seguinte', async () => {
    const u = userEvent.setup()
    desenhar()
    expect(await screen.findByText('Despesa 12')).toBeInTheDocument()
    expect(screen.getByText('Despesa 3')).toBeInTheDocument()
    expect(screen.queryByText('Despesa 2')).toBeNull()
    const paginas = within(
      screen.getByRole('navigation', { name: 'Páginas dos reembolsos' }),
    )
    await u.click(paginas.getByRole('button', { name: 'Próxima página' }))
    expect(screen.getByText('Despesa 2')).toBeInTheDocument()
    expect(screen.getByText('Despesa 1')).toBeInTheDocument()
    expect(screen.queryByText('Despesa 12')).toBeNull()
  })

  it('passa no axe', async () => {
    const { container } = desenhar()
    await screen.findByText('Despesa 12')
    expect(await axe(container)).toHaveNoViolations()
  })
})
