import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { bootstrapSession } from './api'
import {
  getAccessToken,
  setAccessToken,
  setSessionExpiredHandler,
} from './auth'

type AuthContextValue = {
  isAuthenticated: boolean
  // true só durante a checagem inicial de sessão (chamada a /auth/refresh via cookie no
  // primeiro carregamento) - enquanto isso, ninguém deve ser redirecionado para /login,
  // ou toda recarga de página mostraria a tela de login por uma fração de segundo antes
  // de reautenticar sozinha.
  isBootstrapping: boolean
  signIn: (accessToken: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    Boolean(getAccessToken()),
  )
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  // Quem sai e quem entra numa mesma aba não herda nada do anterior: sem isto o /auth/me (nome, permissões, senha provisória) de uma pessoa
  // ficava no cache e a seguinte via o menu da outra ou caía na troca de senha dela (achado da conferência da correção da senha provisória).
  const queryClient = useQueryClient()

  // Liga o callback global do interceptor à UI: quando o refresh falha, a sessão
  // cai e os componentes protegidos redirecionam para /login.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null)
      queryClient.clear()
      setIsAuthenticated(false)
    })
    return () => setSessionExpiredHandler(null)
  }, [queryClient])

  // Sessão só existe em memória (v0.2.1) - ao montar a aplicação (primeiro carregamento ou
  // F5), tenta renovar silenciosamente a partir do cookie HttpOnly antes de decidir se
  // mostra a tela de login. Sem isso, o cookie de 30 dias nunca teria efeito prático.
  useEffect(() => {
    let cancelado = false
    bootstrapSession()
      .then((renovado) => {
        if (!cancelado) setIsAuthenticated(renovado)
      })
      .finally(() => {
        if (!cancelado) setIsBootstrapping(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isBootstrapping,
      signIn: (accessToken) => {
        queryClient.clear()
        setAccessToken(accessToken)
        setIsAuthenticated(true)
      },
      signOut: () => {
        setAccessToken(null)
        queryClient.clear()
        setIsAuthenticated(false)
      },
    }),
    [isAuthenticated, isBootstrapping, queryClient],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
