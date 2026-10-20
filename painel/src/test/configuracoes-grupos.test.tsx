import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { useMe } from '@/lib/use-me'
import { ConfiguracoesPage } from '@/pages/Configuracoes'

// Ponto de Revisão FASE 6 (1/2): o catálogo da categoria do aviso (v6.1) tem o dono `comunicar`, e o grupo dele em Configurações aparece com o nome do
// módulo (Comunicação), nunca com o código cru.
vi.mock('@/lib/use-me', () => ({ useMe: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarCatalogos: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
}))

const catalogo = (chave: string, nome: string, dono: string): api.Catalogo => ({
  id_catalogo: chave.length,
  chave,
  nome_exibido: nome,
  descricao: null,
  editavel_pelo_usuario: true,
  permissao_gerenciamento: dono,
})

describe('Configurações: o grupo de cada catálogo', () => {
  it('o catálogo da categoria do aviso aparece no grupo "Comunicação" para quem tem comunicar', async () => {
    vi.mocked(useMe).mockReturnValue({
      data: { permissoes: ['comunicar'] },
    } as unknown as ReturnType<typeof useMe>)
    vi.mocked(api.listarCatalogos).mockResolvedValue([
      catalogo('categoria_aviso', 'Categoria de aviso', 'comunicar'),
      catalogo('forma_pagamento', 'Forma de pagamento', 'financeiro'),
    ])
    vi.mocked(api.listarOpcoesCatalogo).mockResolvedValue([])
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ConfiguracoesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Comunicação')).toBeVisible()
    expect(screen.queryByText('comunicar')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Categoria de aviso' }),
    ).toBeVisible()
    expect(screen.queryByText('Forma de pagamento')).toBeNull()
  })
})
