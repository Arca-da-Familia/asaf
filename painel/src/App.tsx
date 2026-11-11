import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router'

import { ErrorBoundary } from '@/components/feedback/ErrorBoundary'
import { Shell } from '@/components/layout/Shell'
import { useAuth } from '@/lib/auth-context'
import { carregarTela } from '@/lib/carregar-tela'
import { useMe } from '@/lib/use-me'
import { AssociarRotulos } from '@/components/acessibilidade/AssociarRotulos'
import { Login } from '@/pages/Login'

// v9.2a - cada tela é baixada só quando é aberta (src/lib/carregar-tela.ts); a de entrar vem junto, é a primeira que todo mundo vê
const AcessoPage = lazy(() =>
  carregarTela(() => import('@/pages/Acesso')).then((m) => ({
    default: m.AcessoPage,
  })),
)
const AlcadasAprovacaoPage = lazy(() =>
  carregarTela(() => import('@/pages/AlcadasAprovacao')).then((m) => ({
    default: m.AlcadasAprovacaoPage,
  })),
)
const ComprasPage = lazy(() =>
  carregarTela(() => import('@/pages/Compras')).then((m) => ({
    default: m.ComprasPage,
  })),
)
const ContasAPagarRecorrentesPage = lazy(() =>
  carregarTela(() => import('@/pages/ContasAPagarRecorrentes')).then((m) => ({
    default: m.ContasAPagarRecorrentesPage,
  })),
)
const DoacoesPage = lazy(() =>
  carregarTela(() => import('@/pages/Doacoes')).then((m) => ({
    default: m.DoacoesPage,
  })),
)
const OrcamentoPage = lazy(() =>
  carregarTela(() => import('@/pages/Orcamento')).then((m) => ({
    default: m.OrcamentoPage,
  })),
)
const RelatoriosPage = lazy(() =>
  carregarTela(() => import('@/pages/Relatorios')).then((m) => ({
    default: m.RelatoriosPage,
  })),
)
const DocumentosEmitidosPage = lazy(() =>
  carregarTela(() => import('@/pages/DocumentosEmitidos')).then((m) => ({
    default: m.DocumentosEmitidosPage,
  })),
)
const InstituicaoPage = lazy(() =>
  carregarTela(() => import('@/pages/Instituicao')).then((m) => ({
    default: m.InstituicaoPage,
  })),
)
const FinanceiroInicioPage = lazy(() =>
  carregarTela(() => import('@/pages/FinanceiroInicio')).then((m) => ({
    default: m.FinanceiroInicioPage,
  })),
)
const ReembolsoDespesaPage = lazy(() =>
  carregarTela(() => import('@/pages/ReembolsoDespesa')).then((m) => ({
    default: m.ReembolsoDespesaPage,
  })),
)
const AssembleiaDetalhePage = lazy(() =>
  carregarTela(() => import('@/pages/AssembleiaDetalhe')).then((m) => ({
    default: m.AssembleiaDetalhePage,
  })),
)
const AssembleiaNovoPage = lazy(() =>
  carregarTela(() => import('@/pages/AssembleiaNova')).then((m) => ({
    default: m.AssembleiaNovoPage,
  })),
)
const AssembleiasPage = lazy(() =>
  carregarTela(() => import('@/pages/Assembleias')).then((m) => ({
    default: m.AssembleiasPage,
  })),
)
const AtaAssembleiaPage = lazy(() =>
  carregarTela(() => import('@/pages/Ata')).then((m) => ({
    default: m.AtaAssembleiaPage,
  })),
)
const AtasPage = lazy(() =>
  carregarTela(() => import('@/pages/Atas')).then((m) => ({
    default: m.AtasPage,
  })),
)
const AssociadoDetalhePage = lazy(() =>
  carregarTela(() => import('@/pages/AssociadoDetalhe')).then((m) => ({
    default: m.AssociadoDetalhePage,
  })),
)
const AssociadoNovoPage = lazy(() =>
  carregarTela(() => import('@/pages/AssociadoNovo')).then((m) => ({
    default: m.AssociadoNovoPage,
  })),
)
const AssociadosGraficosPage = lazy(() =>
  carregarTela(() => import('@/pages/AssociadosGraficos')).then((m) => ({
    default: m.AssociadosGraficosPage,
  })),
)
const AssociadosPage = lazy(() =>
  carregarTela(() => import('@/pages/Associados')).then((m) => ({
    default: m.AssociadosPage,
  })),
)
const AtendimentosPage = lazy(() =>
  carregarTela(() => import('@/pages/Atendimentos')).then((m) => ({
    default: m.AtendimentosPage,
  })),
)
const AuditoriaPage = lazy(() =>
  carregarTela(() => import('@/pages/Auditoria')).then((m) => ({
    default: m.AuditoriaPage,
  })),
)
const CalendarioPage = lazy(() =>
  carregarTela(() => import('@/pages/Calendario')).then((m) => ({
    default: m.CalendarioPage,
  })),
)
const ConcederAcessoPage = lazy(() =>
  carregarTela(() => import('@/pages/ConcederAcesso')).then((m) => ({
    default: m.ConcederAcessoPage,
  })),
)
const ConfiguracoesPage = lazy(() =>
  carregarTela(() => import('@/pages/Configuracoes')).then((m) => ({
    default: m.ConfiguracoesPage,
  })),
)
const RegrasDoSistemaPage = lazy(() =>
  carregarTela(() => import('@/pages/RegrasDoSistema')).then((m) => ({
    default: m.RegrasDoSistemaPage,
  })),
)
const ConselhoFiscalPage = lazy(() =>
  carregarTela(() => import('@/pages/ConselhoFiscal')).then((m) => ({
    default: m.ConselhoFiscalPage,
  })),
)
const DevComponents = lazy(() =>
  carregarTela(() => import('@/pages/DevComponents')).then((m) => ({
    default: m.DevComponents,
  })),
)
const DocumentoDetalhePage = lazy(() =>
  carregarTela(() => import('@/pages/DocumentoDetalhe')).then((m) => ({
    default: m.DocumentoDetalhePage,
  })),
)
const DocumentoNovoPage = lazy(() =>
  carregarTela(() => import('@/pages/DocumentoNovo')).then((m) => ({
    default: m.DocumentoNovoPage,
  })),
)
const DocumentosPage = lazy(() =>
  carregarTela(() => import('@/pages/Documentos')).then((m) => ({
    default: m.DocumentosPage,
  })),
)
const ParceriaDetalhePage = lazy(() =>
  carregarTela(() => import('@/pages/ParceriaDetalhe')).then((m) => ({
    default: m.ParceriaDetalhePage,
  })),
)
const ParceriaNovaPage = lazy(() =>
  carregarTela(() => import('@/pages/ParceriaNova')).then((m) => ({
    default: m.ParceriaNovaPage,
  })),
)
const ParceriasPage = lazy(() =>
  carregarTela(() => import('@/pages/Parcerias')).then((m) => ({
    default: m.ParceriasPage,
  })),
)
const ExerciciosPage = lazy(() =>
  carregarTela(() => import('@/pages/Exercicios')).then((m) => ({
    default: m.ExerciciosPage,
  })),
)
const FornecedoresPage = lazy(() =>
  carregarTela(() => import('@/pages/Fornecedores')).then((m) => ({
    default: m.FornecedoresPage,
  })),
)
const CentrosCustoPage = lazy(() =>
  carregarTela(() => import('@/pages/CentrosCusto')).then((m) => ({
    default: m.CentrosCustoPage,
  })),
)
const ConciliacaoPage = lazy(() =>
  carregarTela(() => import('@/pages/Conciliacao')).then((m) => ({
    default: m.ConciliacaoPage,
  })),
)
const ContasFinanceirasPage = lazy(() =>
  carregarTela(() => import('@/pages/ContasFinanceiras')).then((m) => ({
    default: m.ContasFinanceirasPage,
  })),
)
const GerarCobrancasPage = lazy(() =>
  carregarTela(() => import('@/pages/GerarCobrancas')).then((m) => ({
    default: m.GerarCobrancasPage,
  })),
)
const NegociacaoDividaPage = lazy(() =>
  carregarTela(() => import('@/pages/NegociacaoDivida')).then((m) => ({
    default: m.NegociacaoDividaPage,
  })),
)
const PlanoContasPage = lazy(() =>
  carregarTela(() => import('@/pages/PlanoContas')).then((m) => ({
    default: m.PlanoContasPage,
  })),
)
const PlanosContribuicaoPage = lazy(() =>
  carregarTela(() => import('@/pages/PlanosContribuicao')).then((m) => ({
    default: m.PlanosContribuicaoPage,
  })),
)
const ProcessoDisciplinarDetalhePage = lazy(() =>
  carregarTela(() => import('@/pages/Disciplina')).then((m) => ({
    default: m.ProcessoDisciplinarDetalhePage,
  })),
)
const ProcessosDisciplinaresPage = lazy(() =>
  carregarTela(() => import('@/pages/Disciplina')).then((m) => ({
    default: m.ProcessosDisciplinaresPage,
  })),
)
const ProcessoDissolucaoDetalhePage = lazy(() =>
  carregarTela(() => import('@/pages/Dissolucao')).then((m) => ({
    default: m.ProcessoDissolucaoDetalhePage,
  })),
)
const ProcessosDissolucaoPage = lazy(() =>
  carregarTela(() => import('@/pages/Dissolucao')).then((m) => ({
    default: m.ProcessosDissolucaoPage,
  })),
)
const ProjetosPage = lazy(() =>
  carregarTela(() => import('@/pages/Projetos')).then((m) => ({
    default: m.ProjetosPage,
  })),
)
const BeneficiariosPage = lazy(() =>
  carregarTela(() => import('@/pages/Beneficiarios')).then((m) => ({
    default: m.BeneficiariosPage,
  })),
)
const EspacosPage = lazy(() =>
  carregarTela(() => import('@/pages/Espacos')).then((m) => ({
    default: m.EspacosPage,
  })),
)
const EventosPage = lazy(() =>
  carregarTela(() => import('@/pages/Eventos')).then((m) => ({
    default: m.EventosPage,
  })),
)
const Forbidden = lazy(() =>
  carregarTela(() => import('@/pages/Forbidden')).then((m) => ({
    default: m.Forbidden,
  })),
)
const Home = lazy(() =>
  carregarTela(() => import('@/pages/Home')).then((m) => ({ default: m.Home })),
)
const ImportarAssociadosPage = lazy(() =>
  carregarTela(() => import('@/pages/ImportarAssociados')).then((m) => ({
    default: m.ImportarAssociadosPage,
  })),
)
const PropostasDeFiliacaoPage = lazy(() =>
  carregarTela(() => import('@/pages/PropostasDeFiliacao')).then((m) => ({
    default: m.PropostasDeFiliacaoPage,
  })),
)
const QualidadeDaBasePage = lazy(() =>
  carregarTela(() => import('@/pages/QualidadeDaBase')).then((m) => ({
    default: m.QualidadeDaBasePage,
  })),
)
const MandatosPage = lazy(() =>
  carregarTela(() => import('@/pages/Mandatos')).then((m) => ({
    default: m.MandatosPage,
  })),
)
const FiliacaoParaProporPage = lazy(() =>
  carregarTela(() => import('@/pages/FiliacaoParaPropor')).then((m) => ({
    default: m.FiliacaoParaProporPage,
  })),
)
const MeuVoluntariadoPage = lazy(() =>
  carregarTela(() => import('@/pages/MeuVoluntariado')).then((m) => ({
    default: m.MeuVoluntariadoPage,
  })),
)
const EsqueciASenha = lazy(() =>
  carregarTela(() => import('@/pages/EsqueciASenha')).then((m) => ({
    default: m.EsqueciASenha,
  })),
)
const MfaSetup = lazy(() =>
  carregarTela(() => import('@/pages/MfaSetup')).then((m) => ({
    default: m.MfaSetup,
  })),
)
const TrocarSenhaObrigatoria = lazy(() =>
  carregarTela(() => import('@/pages/TrocarSenhaObrigatoria')).then((m) => ({
    default: m.TrocarSenhaObrigatoria,
  })),
)
const MinhasAssembleiasPage = lazy(() =>
  carregarTela(() => import('@/pages/MinhasAssembleias')).then((m) => ({
    default: m.MinhasAssembleiasPage,
  })),
)
const AvisoDetalhePage = lazy(() =>
  carregarTela(() => import('@/pages/AvisoDetalhe')).then((m) => ({
    default: m.AvisoDetalhePage,
  })),
)
const AvisoNovoPage = lazy(() =>
  carregarTela(() => import('@/pages/AvisoNovo')).then((m) => ({
    default: m.AvisoNovoPage,
  })),
)
const AvisosAgendadosPage = lazy(() =>
  carregarTela(() => import('@/pages/AvisosAgendados')).then((m) => ({
    default: m.AvisosAgendadosPage,
  })),
)
const ModelosDeAvisoPage = lazy(() =>
  carregarTela(() => import('@/pages/ModelosDeAviso')).then((m) => ({
    default: m.ModelosDeAvisoPage,
  })),
)
const ComunicacaoPage = lazy(() =>
  carregarTela(() => import('@/pages/Comunicacao')).then((m) => ({
    default: m.ComunicacaoPage,
  })),
)
const EncarregadoPage = lazy(() =>
  carregarTela(() => import('@/pages/Encarregado')).then((m) => ({
    default: m.EncarregadoPage,
  })),
)
const InventarioDeDadosPage = lazy(() =>
  carregarTela(() => import('@/pages/InventarioDeDados')).then((m) => ({
    default: m.InventarioDeDadosPage,
  })),
)
const RelatorioDeImpactoPage = lazy(() =>
  carregarTela(() => import('@/pages/RelatorioDeImpacto')).then((m) => ({
    default: m.RelatorioDeImpactoPage,
  })),
)
const AvisosDePrivacidadePage = lazy(() =>
  carregarTela(() => import('@/pages/AvisosDePrivacidade')).then((m) => ({
    default: m.AvisosDePrivacidadePage,
  })),
)
const ConsentimentosPage = lazy(() =>
  carregarTela(() => import('@/pages/Consentimentos')).then((m) => ({
    default: m.ConsentimentosPage,
  })),
)
const DadosDeUmaPessoaPage = lazy(() =>
  carregarTela(() => import('@/pages/DadosDeUmaPessoa')).then((m) => ({
    default: m.DadosDeUmaPessoaPage,
  })),
)
const RelatorioDeAtendimentoDoTitularPage = lazy(() =>
  carregarTela(() => import('@/pages/RelatorioDeAtendimentoDoTitular')).then(
    (m) => ({ default: m.RelatorioDeAtendimentoDoTitularPage }),
  ),
)
const IncidentesDeSegurancaPage = lazy(() =>
  carregarTela(() => import('@/pages/IncidentesDeSeguranca')).then((m) => ({
    default: m.IncidentesDeSegurancaPage,
  })),
)
const MeuTreinamentoDePrivacidadePage = lazy(() =>
  carregarTela(() => import('@/pages/MeuTreinamentoDePrivacidade')).then(
    (m) => ({ default: m.MeuTreinamentoDePrivacidadePage }),
  ),
)
const QuadroDeTreinamentosPage = lazy(() =>
  carregarTela(() => import('@/pages/QuadroDeTreinamentos')).then((m) => ({
    default: m.QuadroDeTreinamentosPage,
  })),
)
const RevisaoDoProgramaPage = lazy(() =>
  carregarTela(() => import('@/pages/RevisaoDoPrograma')).then((m) => ({
    default: m.RevisaoDoProgramaPage,
  })),
)
const MeuAvisoPage = lazy(() =>
  carregarTela(() => import('@/pages/MeuAviso')).then((m) => ({
    default: m.MeuAvisoPage,
  })),
)
const MeusAvisosPage = lazy(() =>
  carregarTela(() => import('@/pages/MeusAvisos')).then((m) => ({
    default: m.MeusAvisosPage,
  })),
)
const PerfilPage = lazy(() =>
  carregarTela(() => import('@/pages/Perfil')).then((m) => ({
    default: m.PerfilPage,
  })),
)
const DeliberacoesPendentesPage = lazy(() =>
  carregarTela(() => import('@/pages/DeliberacoesPendentes')).then((m) => ({
    default: m.DeliberacoesPendentesPage,
  })),
)
const PeticoesConvocacaoPage = lazy(() =>
  carregarTela(() => import('@/pages/PeticoesConvocacao')).then((m) => ({
    default: m.PeticoesConvocacaoPage,
  })),
)
const RegrasDoEstatutoPage = lazy(() =>
  carregarTela(() => import('@/pages/RegrasDoEstatuto')).then((m) => ({
    default: m.RegrasDoEstatutoPage,
  })),
)
const PortariaGate = lazy(() =>
  carregarTela(() => import('@/pages/PortariaGate')).then((m) => ({
    default: m.PortariaGate,
  })),
)
const RazaoContabilPage = lazy(() =>
  carregarTela(() => import('@/pages/RazaoContabil')).then((m) => ({
    default: m.RazaoContabilPage,
  })),
)
const SessaoAssembleiaPage = lazy(() =>
  carregarTela(() => import('@/pages/SessaoAssembleia')).then((m) => ({
    default: m.SessaoAssembleiaPage,
  })),
)
const AuditoriaFinanceiraPage = lazy(() =>
  carregarTela(() => import('@/pages/AuditoriaFinanceira')).then((m) => ({
    default: m.AuditoriaFinanceiraPage,
  })),
)
const RegistrarSaidaPage = lazy(() =>
  carregarTela(() => import('@/pages/RegistrarSaida')).then((m) => ({
    default: m.RegistrarSaidaPage,
  })),
)
const TitulosPage = lazy(() =>
  carregarTela(() => import('@/pages/Titulos')).then((m) => ({
    default: m.TitulosPage,
  })),
)

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isBootstrapping } = useAuth()
  if (isBootstrapping) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

// Achado da v6.2d - trava o painel inteiro na troca da senha provisória (a que a secretaria dá em "Conceder acesso") enquanto ela não for
// trocada, como o MFA abaixo. Vem antes do MFA: ninguém configura o segundo passo com uma senha que a secretaria conhece.
export function RequireSenhaDefinitiva({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe()
  if (isLoading) return null
  if (data?.senha_provisoria) return <Navigate to="/trocar-senha" replace />
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

// v5.7e - o Início do Financeiro é o retrato de quem OPERA (saldo, vencidos, compras): quem só audita (`financeiro_auditar`) cai direto no Conselho Fiscal, que é a janela de leitura dele.
export function InicioDoFinanceiro() {
  const { data, isLoading } = useMe()
  if (isLoading) return null
  if (!data?.permissoes.includes('financeiro')) {
    return <Navigate to="/financeiro/conselho-fiscal" replace />
  }
  return <FinanceiroInicioPage />
}

// v5.4a - Documentos: três permissões abrem o módulo (preparar, aprovar publicação, baixar originais sigilosos).
export function RequireAnyPermission({
  permissions,
  children,
}: {
  permissions: string[]
  children: ReactNode
}) {
  const { data, isLoading } = useMe()
  if (isLoading) return null
  if (!permissions.some((p) => data?.permissoes.includes(p))) {
    return <Navigate to="/403" replace state={{ permissao: permissions[0] }} />
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
    <>
      <AssociarRotulos />
      {/* v9.2a: enquanto a tela é baixada; dentro do painel, quem espera é o Shell (o menu fica na tela) */}
      <Suspense fallback={<CarregandoTela />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/esqueci-a-senha" element={<EsqueciASenha />} />
          {/* v4.8 - tela da portaria (check-in/check-out por token de evento, sem login do painel).
          Fora de RequireAuth/RequireMfa/Shell de propósito - ver PortariaGate.tsx. */}
          <Route path="/portaria/:token" element={<PortariaGate />} />
          <Route
            path="/trocar-senha"
            element={
              <RequireAuth>
                <TrocarSenhaObrigatoria />
              </RequireAuth>
            }
          />
          <Route
            path="/mfa/setup"
            element={
              <RequireAuth>
                <RequireSenhaDefinitiva>
                  <MfaSetup />
                </RequireSenhaDefinitiva>
              </RequireAuth>
            }
          />

          <Route
            element={
              <RequireAuth>
                <RequireSenhaDefinitiva>
                  <RequireMfa>
                    <Shell />
                  </RequireMfa>
                </RequireSenhaDefinitiva>
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="/dev/componentes" element={<DevComponents />} />
            <Route path="/perfil" element={<PerfilPage />} />
            <Route
              path="/treinamento-de-privacidade"
              element={<MeuTreinamentoDePrivacidadePage />}
            />
            <Route
              path="/minhas-assembleias"
              element={
                <ErrorBoundary tituloModulo="Minhas assembleias">
                  <MinhasAssembleiasPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/peticoes-de-convocacao"
              element={
                <ErrorBoundary tituloModulo="Petições de convocação">
                  <PeticoesConvocacaoPage />
                </ErrorBoundary>
              }
            />
            {/* v5.6a - o aviso do sino que o servidor manda a cada doação nova do site leva a /doacoes, mas a tela de Doações vive em /financeiro/doacoes
              (guardada pela permissão `financeiro`): sem este atalho o link caía na página inicial. */}
            <Route
              path="/doacoes"
              // v9.3o: a tela de Doações tem abas; o aviso de doação nova do site abre direto na aba do site
              element={<Navigate to="/financeiro/doacoes?aba=site" replace />}
            />
            <Route
              path="/instituicao"
              element={
                <RequirePermission permission="gerenciar_acesso">
                  <ErrorBoundary tituloModulo="Instituição">
                    <InstituicaoPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/regras"
              element={
                <RequirePermission permission="gerenciar_acesso">
                  <ErrorBoundary tituloModulo="Regras do sistema">
                    <RegrasDoSistemaPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/configuracoes/:chave?"
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
              path="/filiacao/para-propor"
              element={
                <ErrorBoundary tituloModulo="Pedidos de filiação">
                  <FiliacaoParaProporPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/meu-voluntariado"
              element={
                <ErrorBoundary tituloModulo="Meu voluntariado">
                  <MeuVoluntariadoPage />
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
                path="qualidade"
                element={
                  <ErrorBoundary tituloModulo="Qualidade da base">
                    <QualidadeDaBasePage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="propostas"
                element={
                  <ErrorBoundary tituloModulo="Propostas de filiação">
                    <PropostasDeFiliacaoPage />
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
              path="/meus-avisos"
              element={
                <ErrorBoundary tituloModulo="Meus avisos">
                  <MeusAvisosPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/meus-avisos/:id"
              element={
                <ErrorBoundary tituloModulo="Meus avisos">
                  <MeuAvisoPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/privacidade"
              element={
                <RequirePermission permission="privacidade">
                  <Outlet />
                </RequirePermission>
              }
            >
              <Route
                index
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <EncarregadoPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="inventario"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <InventarioDeDadosPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="relatorio-de-impacto"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <RelatorioDeImpactoPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="avisos"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <AvisosDePrivacidadePage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="consentimentos"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <ConsentimentosPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="titulares"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <DadosDeUmaPessoaPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="solicitacoes"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <RelatorioDeAtendimentoDoTitularPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="incidentes"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <IncidentesDeSegurancaPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="treinamentos"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <QuadroDeTreinamentosPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="revisao-anual"
                element={
                  <ErrorBoundary tituloModulo="Privacidade">
                    <RevisaoDoProgramaPage />
                  </ErrorBoundary>
                }
              />
            </Route>
            <Route
              path="/comunicacao"
              element={
                <RequirePermission permission="comunicar">
                  <Outlet />
                </RequirePermission>
              }
            >
              <Route
                index
                element={
                  <ErrorBoundary tituloModulo="Comunicação">
                    <ComunicacaoPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="novo"
                element={
                  <ErrorBoundary tituloModulo="Comunicação">
                    <AvisoNovoPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="modelos"
                element={
                  <ErrorBoundary tituloModulo="Comunicação">
                    <ModelosDeAvisoPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="agendados"
                element={
                  <ErrorBoundary tituloModulo="Comunicação">
                    <AvisosAgendadosPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path=":id"
                element={
                  <ErrorBoundary tituloModulo="Comunicação">
                    <AvisoDetalhePage />
                  </ErrorBoundary>
                }
              />
            </Route>
            <Route
              path="/atendimentos"
              element={
                <RequirePermission permission="atendimento">
                  <ErrorBoundary tituloModulo="Atendimento">
                    <AtendimentosPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/financeiro"
              element={
                <RequireAnyPermission
                  permissions={['financeiro', 'financeiro_auditar']}
                >
                  <Outlet />
                </RequireAnyPermission>
              }
            >
              <Route
                index
                element={
                  <ErrorBoundary tituloModulo="Financeiro">
                    <InicioDoFinanceiro />
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
                path="auditoria-financeira"
                element={
                  <ErrorBoundary tituloModulo="Auditoria financeira">
                    <AuditoriaFinanceiraPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="relatorios"
                element={
                  <ErrorBoundary tituloModulo="Relatórios">
                    <RelatoriosPage />
                  </ErrorBoundary>
                }
              />
              {/* v5.7e: daqui para baixo é o que OPERA o financeiro: pede a permissão geral (`financeiro`). Antes, quem só audita (Conselho Fiscal) já passou pelo guarda do módulo. */}
              <Route
                element={
                  <RequirePermission permission="financeiro">
                    <Outlet />
                  </RequirePermission>
                }
              >
                <Route
                  path="titulos"
                  element={
                    <ErrorBoundary tituloModulo="Títulos">
                      <TitulosPage />
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="entradas"
                  element={
                    <ErrorBoundary tituloModulo="Entradas">
                      <TitulosPage tipoFixo="A Receber" />
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="saidas"
                  element={
                    <ErrorBoundary tituloModulo="Saídas">
                      <TitulosPage tipoFixo="A Pagar" />
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="registrar-saida"
                  element={
                    <ErrorBoundary tituloModulo="Registrar saída">
                      <RegistrarSaidaPage />
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
                path="deliberacoes"
                element={
                  <ErrorBoundary tituloModulo="Deliberações pendentes">
                    <DeliberacoesPendentesPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="estatuto"
                element={
                  <ErrorBoundary tituloModulo="Regras do Estatuto">
                    <RegrasDoEstatutoPage />
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
                    <ProjetosPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/reserva-espaco"
              element={
                <RequirePermission permission="projetos">
                  <ErrorBoundary tituloModulo="Reserva de Espaço">
                    <EspacosPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/eventos"
              element={
                <RequirePermission permission="projetos">
                  <ErrorBoundary tituloModulo="Eventos">
                    <EventosPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/documentos-emitidos"
              element={
                <RequirePermission permission="projetos">
                  <ErrorBoundary tituloModulo="Documentos emitidos">
                    <DocumentosEmitidosPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/beneficiarios"
              element={
                <RequirePermission permission="projetos">
                  <ErrorBoundary tituloModulo="Beneficiários">
                    <BeneficiariosPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/documentos"
              element={
                <RequireAnyPermission
                  permissions={[
                    'documentos',
                    'aprovar_publicacao',
                    'documentos_originais',
                  ]}
                >
                  <ErrorBoundary tituloModulo="Documentos">
                    <DocumentosPage />
                  </ErrorBoundary>
                </RequireAnyPermission>
              }
            />
            <Route
              path="/documentos/novo"
              element={
                <RequirePermission permission="documentos">
                  <ErrorBoundary tituloModulo="Novo documento">
                    <DocumentoNovoPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/documentos/:id"
              element={
                <RequireAnyPermission
                  permissions={[
                    'documentos',
                    'aprovar_publicacao',
                    'documentos_originais',
                  ]}
                >
                  <ErrorBoundary tituloModulo="Documento">
                    <DocumentoDetalhePage />
                  </ErrorBoundary>
                </RequireAnyPermission>
              }
            />
            <Route
              path="/parcerias"
              element={
                <RequireAnyPermission
                  permissions={['parcerias', 'aprovar_publicacao']}
                >
                  <ErrorBoundary tituloModulo="Parcerias e emendas">
                    <ParceriasPage />
                  </ErrorBoundary>
                </RequireAnyPermission>
              }
            />
            <Route
              path="/parcerias/nova"
              element={
                <RequirePermission permission="parcerias">
                  <ErrorBoundary tituloModulo="Nova parceria">
                    <ParceriaNovaPage />
                  </ErrorBoundary>
                </RequirePermission>
              }
            />
            <Route
              path="/parcerias/:id"
              element={
                <RequireAnyPermission
                  permissions={['parcerias', 'aprovar_publicacao']}
                >
                  <ErrorBoundary tituloModulo="Parceria">
                    <ParceriaDetalhePage />
                  </ErrorBoundary>
                </RequireAnyPermission>
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
      </Suspense>
    </>
  )
}

/** O que aparece enquanto uma tela é baixada (v9.2a). */
export function CarregandoTela() {
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      Carregando…
    </p>
  )
}

export default App
