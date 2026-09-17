import { type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'

import { ErrorBoundary } from '@/components/feedback/ErrorBoundary'
import { Shell } from '@/components/layout/Shell'
import { useAuth } from '@/lib/auth-context'
import { useMe } from '@/lib/use-me'
import { AcessoPage } from '@/pages/Acesso'
import { AlcadasAprovacaoPage } from '@/pages/AlcadasAprovacao'
import { ComprasPage } from '@/pages/Compras'
import { ContasAPagarRecorrentesPage } from '@/pages/ContasAPagarRecorrentes'
import { DoacoesPage } from '@/pages/Doacoes'
import { OrcamentoPage } from '@/pages/Orcamento'
import { ReembolsoDespesaPage } from '@/pages/ReembolsoDespesa'
import { AssembleiaDetalhePage } from '@/pages/AssembleiaDetalhe'
import { AssembleiaNovoPage } from '@/pages/AssembleiaNova'
import { AssembleiasPage } from '@/pages/Assembleias'
import { AtaAssembleiaPage } from '@/pages/Ata'
import { AtasPage } from '@/pages/Atas'
import { AssociadoDetalhePage } from '@/pages/AssociadoDetalhe'
import { AssociadoNovoPage } from '@/pages/AssociadoNovo'
import { AssociadosGraficosPage } from '@/pages/AssociadosGraficos'
import { AssociadosPage } from '@/pages/Associados'
import { AuditoriaPage } from '@/pages/Auditoria'
import { CalendarioPage } from '@/pages/Calendario'
import { ConcederAcessoPage } from '@/pages/ConcederAcesso'
import { ConfiguracoesPage } from '@/pages/Configuracoes'
import { ConselhoFiscalPage } from '@/pages/ConselhoFiscal'
import { DevComponents } from '@/pages/DevComponents'
import { ExerciciosPage } from '@/pages/Exercicios'
import { FornecedoresPage } from '@/pages/Fornecedores'
import { CentrosCustoPage } from '@/pages/CentrosCusto'
import { ConciliacaoPage } from '@/pages/Conciliacao'
import { ContasFinanceirasPage } from '@/pages/ContasFinanceiras'
import { GerarCobrancasPage } from '@/pages/GerarCobrancas'
import { NegociacaoDividaPage } from '@/pages/NegociacaoDivida'
import { PlanoContasPage } from '@/pages/PlanoContas'
import { PlanosContribuicaoPage } from '@/pages/PlanosContribuicao'
import {
  ProcessoDisciplinarDetalhePage,
  ProcessosDisciplinaresPage,
} from '@/pages/Disciplina'
import {
  ProcessoDissolucaoDetalhePage,
  ProcessosDissolucaoPage,
} from '@/pages/Dissolucao'
import { EmConstrucao } from '@/pages/EmConstrucao'
import { Forbidden } from '@/pages/Forbidden'
import { Home } from '@/pages/Home'
import { ImportarAssociadosPage } from '@/pages/ImportarAssociados'
import { Login } from '@/pages/Login'
import { MandatosPage } from '@/pages/Mandatos'
import { MfaSetup } from '@/pages/MfaSetup'
import { MinhasAssembleiasPage } from '@/pages/MinhasAssembleias'
import { PerfilPage } from '@/pages/Perfil'
import { PeticoesConvocacaoPage } from '@/pages/PeticoesConvocacao'
import { RazaoContabilPage } from '@/pages/RazaoContabil'
import { SessaoAssembleiaPage } from '@/pages/SessaoAssembleia'
import { TitulosPage } from '@/pages/Titulos'

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
        <Route
          path="/configuracoes"
          element={
            <ErrorBoundary tituloModulo="Configurações">
              <ConfiguracoesPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/calendario"
          element={
            <ErrorBoundary tituloModulo="Calendário institucional">
              <CalendarioPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/meus-processos-disciplinares"
          element={
            <ErrorBoundary tituloModulo="Meus processos disciplinares">
              <ProcessosDisciplinaresPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/processos-disciplinares/:id"
          element={
            <ErrorBoundary tituloModulo="Processo disciplinar">
              <ProcessoDisciplinarDetalhePage />
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
              <Outlet />
            </RequirePermission>
          }
        >
          <Route
            index
            element={
              <ErrorBoundary tituloModulo="Financeiro">
                <EmConstrucao modulo="Financeiro" />
              </ErrorBoundary>
            }
          />
          <Route
            path="conselho-fiscal"
            element={
              <ErrorBoundary tituloModulo="Conselho Fiscal">
                <ConselhoFiscalPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="titulos"
            element={
              <ErrorBoundary tituloModulo="Títulos">
                <TitulosPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="plano-contas"
            element={
              <ErrorBoundary tituloModulo="Plano de Contas">
                <PlanoContasPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="fornecedores"
            element={
              <ErrorBoundary tituloModulo="Fornecedores">
                <FornecedoresPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="exercicios"
            element={
              <ErrorBoundary tituloModulo="Exercícios">
                <ExerciciosPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="razao-contabil"
            element={
              <ErrorBoundary tituloModulo="Razão Contábil">
                <RazaoContabilPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="contas-financeiras"
            element={
              <ErrorBoundary tituloModulo="Contas Financeiras">
                <ContasFinanceirasPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="centros-custo"
            element={
              <ErrorBoundary tituloModulo="Centros de Custo">
                <CentrosCustoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="planos-contribuicao"
            element={
              <ErrorBoundary tituloModulo="Planos de Contribuição">
                <PlanosContribuicaoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="gerar-cobrancas"
            element={
              <ErrorBoundary tituloModulo="Gerar Cobranças">
                <GerarCobrancasPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="conciliacao"
            element={
              <ErrorBoundary tituloModulo="Conciliação Bancária">
                <ConciliacaoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="negociacao-divida"
            element={
              <ErrorBoundary tituloModulo="Negociação de Dívida">
                <NegociacaoDividaPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="compras"
            element={
              <ErrorBoundary tituloModulo="Compras">
                <ComprasPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="reembolso-despesa"
            element={
              <ErrorBoundary tituloModulo="Reembolso de Despesa">
                <ReembolsoDespesaPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="alcadas-aprovacao"
            element={
              <ErrorBoundary tituloModulo="Alçadas de Aprovação">
                <AlcadasAprovacaoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="contas-a-pagar-recorrentes"
            element={
              <ErrorBoundary tituloModulo="Contas a Pagar Recorrentes">
                <ContasAPagarRecorrentesPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="doacoes"
            element={
              <ErrorBoundary tituloModulo="Doações">
                <DoacoesPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="orcamento"
            element={
              <ErrorBoundary tituloModulo="Orçamento e Fluxo de Caixa">
                <OrcamentoPage />
              </ErrorBoundary>
            }
          />
        </Route>
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
            path="atas"
            element={
              <ErrorBoundary tituloModulo="Atas">
                <AtasPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="mandatos"
            element={
              <ErrorBoundary tituloModulo="Mandatos">
                <MandatosPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="disciplina"
            element={
              <ErrorBoundary tituloModulo="Disciplina">
                <ProcessosDisciplinaresPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="dissolucao"
            element={
              <ErrorBoundary tituloModulo="Dissolução">
                <ProcessosDissolucaoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="dissolucao/:id"
            element={
              <ErrorBoundary tituloModulo="Processo de dissolução">
                <ProcessoDissolucaoDetalhePage />
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
