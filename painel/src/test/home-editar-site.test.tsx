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
  it('aparece para quem tem editar_site e abre o Directus em nova aba, com segurança', () => {
    renderHome(['editar_site'])
    const link = screen.getByRole('link', { name: /Editar o site/ })
    expect(link).toHaveAttribute('href', URL_DIRECTUS)
    expect(link).toHaveAttribute('target', '_blank')
    // Sem noopener a página aberta poderia controlar a aba do painel (window.opener).
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('avisa leitores de tela que abre em nova aba', () => {
    renderHome(['editar_site'])
    expect(
      screen.getByRole('link', { name: /abre em uma nova aba/ }),
    ).toBeInTheDocument()
  })

  it('NÃO aparece para quem não tem a permissão', () => {
    renderHome(['associados'])
    expect(screen.queryByText('Editar o site')).not.toBeInTheDocument()
  })

  it('v5.7g: gerenciar o acesso do sistema NÃO abre o atalho (a permissão é a própria: editar_site)', () => {
    renderHome(['gerenciar_acesso'])
    expect(screen.queryByText('Editar o site')).not.toBeInTheDocument()
  })

  it('v5.7g: quem só tem editar_site vê o atalho e nenhuma tela de acesso', () => {
    renderHome(['editar_site'])
    expect(
      screen.getByRole('link', { name: /Editar o site/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Níveis e permissões')).not.toBeInTheDocument()
    expect(screen.queryByText('Regras do sistema')).not.toBeInTheDocument()
  })

  it('o endereço é o definitivo do Directus (a chave do plano fica amarrada a ele)', () => {
    expect(URL_DIRECTUS).toBe('https://cms.asaf.org.br')
  })
})
