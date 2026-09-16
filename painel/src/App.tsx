import { type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'

import { ErrorBoundary } from '@/components/feedback/ErrorBoundary'
import { Shell } from '@/components/layout/Shell'
import { useAuth } from '@/lib/auth-context'
import { useMe } from '@/lib/use-me'
import { AcessoPage } from '@/pages/Acesso'
import { AssembleiaDetalhePage } from '@/pages/AssembleiaDetalhe'
import { AssembleiaNovoPage } from '@/pages/AssembleiaNova'
import { AssembleiasPage } from '@/pages/Assembleias'
import { AtaAssembleiaPage } from '@/pages/Ata'
import { AssociadoDetalhePage } from '@/pages/AssociadoDetalhe'
import { AssociadoNovoPage } from '@/pages/AssociadoNovo'
import { AssociadosGraficosPage } from '@/pages/AssociadosGraficos'
import { AssociadosPage } from '@/pages/Associados'
import { AuditoriaPage } from '@/pages/Auditoria'
import { ConcederAcessoPage } from '@/pages/ConcederAcesso'
import { DevComponents } from '@/pages/DevComponents'
import { EmConstrucao } from '@/pages/EmConstrucao'
import { Forbidden } from '@/pages/Forbidden'
import { Home } from '@/pages/Home'
import { ImportarAssociadosPage } from '@/pages/ImportarAssociados'
import { Login } from '@/pages/Login'
import { MfaSetup } from '@/pages/MfaSetup'
import { MinhasAssembleiasPage } from '@/pages/MinhasAssembleias'
import { PerfilPage } from '@/pages/Perfil'
import { PeticoesConvocacaoPage } from '@/pages/PeticoesConvocacao'
import { SessaoAssembleiaPage } from '@/pages/SessaoAssembleia'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isBootstrapping } = useAuth()
  if (isBootstrapping) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

// v0.2.2 - trava o painel inteiro numa tela guiada enquanto o MFA obrigatório do nível
// não estiver ativado. Nenhuma rota de negócio renderiza antes disso.
export function RequireMfa({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe()
  if (isLoading) return null
  if (data?.mfa_pendente) return <Navigate to="/mfa/setup" replace />
  return <>{children}</>
}

// v0.2.3 - guarda de rota por permissão: o front esconde (menu filtrado) e aqui também
// proíbe o acesso direto por URL. O backend revalida a mesma permissão (exigir_permissao).
export function RequirePermission({
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
        <Route path="/dev/componentes" element={<DevComponents />} />
        <Route path="/perfil" element={<PerfilPage />} />
        <Route
          path="/minhas-assembleias"
          element={
            <ErrorBoundary tituloModulo="Minhas assembleias">
              <MinhasAssembleiasPage />
            </ErrorBoundary>
          }
        />
        <Route path="/403" element={<Forbidden />} />
        <Route
          path="/associados"
          element={
            <RequirePermission permission="associados">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route
            index
            element={
              <ErrorBoundary tituloModulo="Associados">
                <AssociadosPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="novo"
            element={
              <ErrorBoundary tituloModulo="Novo associado">
                <AssociadoNovoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="importar"
            element={
              <ErrorBoundary tituloModulo="Importar associados">
                <ImportarAssociadosPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="graficos"
            element={
              <ErrorBoundary tituloModulo="Gráficos">
                <AssociadosGraficosPage />
              </ErrorBoundary>
            }
          />
          <Route
            path=":id"
            element={
              <ErrorBoundary tituloModulo="Detalhe do associado">
                <AssociadoDetalhePage />
              </ErrorBoundary>
            }
          />
          <Route
            path=":id/conceder-acesso"
            element={
              <ErrorBoundary tituloModulo="Conceder acesso">
                <ConcederAcessoPage />
              </ErrorBoundary>
            }
          />
        </Route>
        <Route
          path="/financeiro"
          element={
            <RequirePermission permission="financeiro">
              <ErrorBoundary tituloModulo="Financeiro">
                <EmConstrucao modulo="Financeiro" />
              </ErrorBoundary>
            </RequirePermission>
          }
        />
        <Route
          path="/governanca"
          element={
            <RequirePermission permission="governanca">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route
            index
            element={
              <ErrorBoundary tituloModulo="Governança">
                <AssembleiasPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="nova"
            element={
              <ErrorBoundary tituloModulo="Nova assembleia">
                <AssembleiaNovoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="peticoes"
            element={
              <ErrorBoundary tituloModulo="Petições de convocação">
                <PeticoesConvocacaoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path=":id"
            element={
              <ErrorBoundary tituloModulo="Detalhe da assembleia">
                <AssembleiaDetalhePage />
              </ErrorBoundary>
            }
          />
          <Route
            path=":id/sessao"
            element={
              <ErrorBoundary tituloModulo="Sessão da assembleia">
                <SessaoAssembleiaPage />
              </ErrorBoundary>
            }
          />
          <Route
            path=":id/ata"
            element={
              <ErrorBoundary tituloModulo="Ata da assembleia">
                <AtaAssembleiaPage />
              </ErrorBoundary>
            }
          />
        </Route>
        <Route
          path="/projetos"
          element={
            <RequirePermission permission="projetos">
              <ErrorBoundary tituloModulo="Projetos">
                <EmConstrucao modulo="Projetos" />
              </ErrorBoundary>
            </RequirePermission>
          }
        />
        <Route
          path="/acesso"
          element={
            <RequirePermission permission="gerenciar_acesso">
              <ErrorBoundary tituloModulo="Níveis e permissões">
                <AcessoPage />
              </ErrorBoundary>
            </RequirePermission>
          }
        />
        <Route
          path="/auditoria"
          element={
            <RequirePermission permission="auditoria">
              <ErrorBoundary tituloModulo="Auditoria">
                <AuditoriaPage />
              </ErrorBoundary>
            </RequirePermission>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
