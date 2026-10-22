import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AuthProvider, useAuth } from '@/lib/auth-context'
import { criarQueryClient } from '@/lib/query-client'

// Achado da conferência da correção da senha provisória: quem sai e quem entra numa mesma aba não herda o /auth/me (nome, permissões,
// senha provisória) do anterior.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  bootstrapSession: vi.fn().mockResolvedValue(false),
}))

function Botoes() {
  const { signIn, signOut } = useAuth()
  return (
    <>
      <button onClick={signOut}>Sair</button>
      <button onClick={() => signIn('token-da-outra-pessoa')}>Entrar</button>
    </>
  )
}

describe('sair e entrar na mesma aba', () => {
  it('sair e entrar apagam o que estava guardado da pessoa anterior', async () => {
    const usuario = userEvent.setup()
    const cliente = criarQueryClient()
    render(
      <QueryClientProvider client={cliente}>
        <AuthProvider>
          <Botoes />
        </AuthProvider>
      </QueryClientProvider>,
    )
    cliente.setQueryData(['me'], { id_usuario: 1, nome_completo: 'Quem saiu' })
    await usuario.click(screen.getByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(cliente.getQueryData(['me'])).toBeUndefined())

    cliente.setQueryData(['me'], { id_usuario: 1, nome_completo: 'Quem saiu' })
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(cliente.getQueryData(['me'])).toBeUndefined())
  })
})
