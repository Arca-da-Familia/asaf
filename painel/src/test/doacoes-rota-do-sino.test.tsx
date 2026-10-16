import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App'
import { ThemeProvider } from '@/lib/theme'

// v5.6a - o aviso do sino que o servidor manda a cada doação nova do site leva a "/doacoes". A tela de Doações vive em "/financeiro/doacoes": sem o
// atalho, esse link caía na página inicial e a tesouraria nunca chegava na conferência.

const sessao = vi.hoisted(() => ({
  permissoes: ['financeiro'] as string[],
}))
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isBootstrapping: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({
    data: {
      id_usuario: 1,
      nome_completo: 'Tesoureira de Teste',
      nivel: 'Diretoria',
      mfa_ativado: true,
      mfa_obrigatorio: false,
      mfa_pendente: false,
      permissoes: sessao.permissoes,
    },
    isLoading: false,
  }),
}))

function desenhar(caminho: string) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[caminho]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessao.permissoes = ['financeiro']
  // o tema do painel pergunta ao navegador se o aparelho prefere o escuro
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  // tudo o que a tela não precisa para este teste responde "vazio"
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: string) => {
      const caminho = new URL(entrada, 'http://localhost').pathname
      const corpo =
        caminho === '/api/intencoes-doacao/'
          ? { total: 0, pagina: 1, por_pagina: 25, itens: [] }
          : caminho === '/api/intencoes-doacao/resumo'
            ? {
                pendentes: 0,
                expiradas: 0,
                nao_localizadas: 0,
                confirmadas: 0,
                a_conferir: 0,
              }
            : caminho === '/api/publico/doacao'
              ? { pix_disponivel: true, campanhas: [] }
              : []
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
})

describe('Rota do aviso do sino: /doacoes', () => {
  it('leva à tela de Doações, com a conferência das doações do site', async () => {
    desenhar('/doacoes')
    expect(
      await screen.findByRole('heading', { name: 'Doações do site (Pix)' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Campanhas de arrecadação' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Nenhuma doação do site esperando conferência.'),
    ).toBeInTheDocument()
  })

  it('o endereço de sempre da tela continua funcionando', async () => {
    desenhar('/financeiro/doacoes')
    expect(
      await screen.findByRole('heading', { name: 'Doações do site (Pix)' }),
    ).toBeInTheDocument()
  })

  it('quem não tem a permissão financeiro cai em "acesso negado", não na conferência', async () => {
    sessao.permissoes = ['documentos']
    desenhar('/doacoes')
    expect(
      await screen.findByRole('heading', { name: /acesso negado/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Doações do site (Pix)' }),
    ).toBeNull()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([entrada]) =>
          String(entrada).includes('/api/intencoes-doacao'),
        ),
    ).toBe(false)
  })
})
