import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { DevComponents } from '@/pages/DevComponents'

// v0.3.3 - a demo de campos personalizados usa useQuery de verdade; sem stub, o teste faria uma
// chamada de rede real (não há backend no ambiente de teste). Resto do módulo (login, etc.)
// continua real - só esta função é substituída.
vi.mock('@/lib/api', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('@/lib/api')>()),
  listarDefinicoesCampo: vi.fn().mockResolvedValue([]),
}))

// Auditoria de acessibilidade (v0.2.6) com axe-core. Roda no CI via `npm run test`.
describe('Acessibilidade (axe-core)', () => {
  it('o catálogo de componentes não tem violações', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { container, findByText } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DevComponents />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await findByText('Nenhum campo personalizado cadastrado')
    await waitFor(() => {})
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
