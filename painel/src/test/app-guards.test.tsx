import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { RequireAuth, RequireMfa, RequirePermission } from '@/App'
import { useAuth } from '@/lib/auth-context'
import { useMe } from '@/lib/use-me'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/use-me', () => ({ useMe: vi.fn() }))

const useAuthMock = vi.mocked(useAuth)
const useMeMock = vi.mocked(useMe)

function renderComRotas(elementoProtegido: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/protegido']}>
      <Routes>
        <Route path="/login" element={<p>Tela de login</p>} />
        <Route path="/403" element={<p>Acesso negado</p>} />
        <Route path="/mfa/setup" element={<p>Configurar MFA</p>} />
        <Route path="/protegido" element={elementoProtegido} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  it('redireciona para /login quando não autenticado', () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      isBootstrapping: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    })
    renderComRotas(
      <RequireAuth>
        <p>Conteúdo protegido</p>
      </RequireAuth>,
    )
    expect(screen.getByText('Tela de login')).toBeInTheDocument()
    expect(screen.queryByText('Conteúdo protegido')).not.toBeInTheDocument()
  })

  it('renderiza os filhos quando autenticado', () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      isBootstrapping: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    })
    renderComRotas(
      <RequireAuth>
        <p>Conteúdo protegido</p>
      </RequireAuth>,
    )
    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument()
  })

  it('não renderiza nada enquanto isBootstrapping (evita flash da tela de login no F5)', () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      isBootstrapping: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
    })
    renderComRotas(
      <RequireAuth>
        <p>Conteúdo protegido</p>
      </RequireAuth>,
    )
    expect(screen.queryByText('Tela de login')).not.toBeInTheDocument()
    expect(screen.queryByText('Conteúdo protegido')).not.toBeInTheDocument()
  })
})

describe('RequireMfa', () => {
  it('redireciona para /mfa/setup quando mfa_pendente', () => {
    useMeMock.mockReturnValue({
      data: { mfa_pendente: true },
      isLoading: false,
    } as never)
    renderComRotas(
      <RequireMfa>
        <p>Conteúdo protegido</p>
      </RequireMfa>,
    )
    expect(screen.getByText('Configurar MFA')).toBeInTheDocument()
  })

  it('libera o conteúdo quando mfa não está pendente', () => {
    useMeMock.mockReturnValue({
      data: { mfa_pendente: false },
      isLoading: false,
    } as never)
    renderComRotas(
      <RequireMfa>
        <p>Conteúdo protegido</p>
      </RequireMfa>,
    )
    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument()
  })
})

describe('RequirePermission', () => {
  it('redireciona para /403 quando falta a permissão', () => {
    useMeMock.mockReturnValue({
      data: { permissoes: ['associados'] },
      isLoading: false,
    } as never)
    renderComRotas(
      <RequirePermission permission="financeiro">
        <p>Módulo financeiro</p>
      </RequirePermission>,
    )
    expect(screen.getByText('Acesso negado')).toBeInTheDocument()
    expect(screen.queryByText('Módulo financeiro')).not.toBeInTheDocument()
  })

  it('libera o conteúdo quando o usuário tem a permissão', () => {
    useMeMock.mockReturnValue({
      data: { permissoes: ['financeiro'] },
      isLoading: false,
    } as never)
    renderComRotas(
      <RequirePermission permission="financeiro">
        <p>Módulo financeiro</p>
      </RequirePermission>,
    )
    expect(screen.getByText('Módulo financeiro')).toBeInTheDocument()
  })
})
