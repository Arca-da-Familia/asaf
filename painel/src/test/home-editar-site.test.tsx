import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { Home } from '@/pages/Home'
import { URL_DIRECTUS } from '@/lib/modulos'
import { useMe } from '@/lib/use-me'

vi.mock('@/lib/use-me', () => ({ useMe: vi.fn() }))
const useMeMock = vi.mocked(useMe)

function renderHome(permissoes: string[]) {
  useMeMock.mockReturnValue({
    data: { nome_completo: 'Fulano', permissoes },
  } as unknown as ReturnType<typeof useMe>)
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )
}

// v5.1 — atalho para o Directus (CMS do site) na tela inicial.
describe('cartão "Editar o site" (atalho para o Directus)', () => {
  it('aparece para quem tem gerenciar_acesso e abre o Directus em nova aba, com segurança', () => {
    renderHome(['gerenciar_acesso'])
    const link = screen.getByRole('link', { name: /Editar o site/ })
    expect(link).toHaveAttribute('href', URL_DIRECTUS)
    expect(link).toHaveAttribute('target', '_blank')
    // Sem noopener a página aberta poderia controlar a aba do painel (window.opener).
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('avisa leitores de tela que abre em nova aba', () => {
    renderHome(['gerenciar_acesso'])
    expect(
      screen.getByRole('link', { name: /abre em uma nova aba/ }),
    ).toBeInTheDocument()
  })

  it('NÃO aparece para quem não tem a permissão', () => {
    renderHome(['associados'])
    expect(screen.queryByText('Editar o site')).not.toBeInTheDocument()
  })

  it('o endereço é o definitivo do Directus (a chave do plano fica amarrada a ele)', () => {
    expect(URL_DIRECTUS).toBe('https://cms.asaf.org.br')
  })
})
