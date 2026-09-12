import { type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Shell } from '@/components/layout/Shell'
import { useAuth } from '@/lib/auth-context'
import { useMe } from '@/lib/use-me'
import { EmConstrucao } from '@/pages/EmConstrucao'
import { Forbidden } from '@/pages/Forbidden'
import { Home } from '@/pages/Home'
import { Login } from '@/pages/Login'
import { MfaSetup } from '@/pages/MfaSetup'

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isBootstrapping } = useAuth()
  if (isBootstrapping) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

// v0.2.2 - trava o painel inteiro numa tela guiada enquanto o MFA obrigatório do nível
// não estiver ativado. Nenhuma rota de negócio renderiza antes disso.
function RequireMfa({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe()
  if (isLoading) return null
  if (data?.mfa_pendente) return <Navigate to="/mfa/setup" replace />
  return <>{children}</>
}

// v0.2.3 - guarda de rota por permissão: o front esconde (menu filtrado) e aqui também
// proíbe o acesso direto por URL. O backend revalida a mesma permissão (exigir_permissao).
function RequirePermission({
  permission,
  children,
}: {
  permission: string
  children: ReactNode
}) {
  const { data, isLoading } = useMe()
  if (isLoading) return null
  if (!data?.permissoes.includes(permission)) {
    return <Navigate to="/403" replace state={{ permissao: permission }} />
  }
  return <>{children}</>
}

function App() {
  const { isBootstrapping } = useAuth()

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando…
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/mfa/setup"
        element={
          <RequireAuth>
            <MfaSetup />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <RequireMfa>
              <Shell />
            </RequireMfa>
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="/403" element={<Forbidden />} />
        <Route
          path="/associados"
          element={
            <RequirePermission permission="associados">
              <EmConstrucao modulo="Associados" />
            </RequirePermission>
          }
        />
        <Route
          path="/financeiro"
          element={
            <RequirePermission permission="financeiro">
              <EmConstrucao modulo="Financeiro" />
            </RequirePermission>
          }
        />
        <Route
          path="/governanca"
          element={
            <RequirePermission permission="governanca">
              <EmConstrucao modulo="Governança" />
            </RequirePermission>
          }
        />
        <Route
          path="/projetos"
          element={
            <RequirePermission permission="projetos">
              <EmConstrucao modulo="Projetos" />
            </RequirePermission>
          }
        />
        <Route
          path="/acesso"
          element={
            <RequirePermission permission="gerenciar_acesso">
              <EmConstrucao modulo="Níveis e permissões" />
            </RequirePermission>
          }
        />
        <Route
          path="/auditoria"
          element={
            <RequirePermission permission="auditoria">
              <EmConstrucao modulo="Auditoria" />
            </RequirePermission>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
