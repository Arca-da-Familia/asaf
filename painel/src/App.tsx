import { type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useAuth } from '@/lib/auth-context'
import { Home } from '@/pages/Home'
import { Login } from '@/pages/Login'

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isBootstrapping } = useAuth()
  // Enquanto a checagem inicial de sessão (cookie -> /auth/refresh) está em andamento, não
  // decide nada ainda - senão todo F5 mostraria a tela de login por um instante antes de
  // reautenticar sozinho.
  if (isBootstrapping) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function App() {
  const { isAuthenticated, isBootstrapping } = useAuth()

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {isAuthenticated && (
        <header className="border-b border-border bg-card">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <span className="text-lg font-bold tracking-tight">
              ASAF · Painel
            </span>
          </nav>
        </header>
      )}

      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Home />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default App
