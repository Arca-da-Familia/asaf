import { useState } from 'react'
import {
  ArrowLeft,
  Bell,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  House,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
  UserRound,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { logout } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useImpersonacao } from '@/lib/impersonacao'
import { mensagens } from '@/lib/i18n/pt-BR'
import { modulos } from '@/lib/modulos'
import { useTheme } from '@/lib/theme'
import { useMe } from '@/lib/use-me'
import { useVersaoBuild } from '@/lib/versao'
import { cn } from '@/lib/utils'

import { StatusBar } from './StatusBar'

// Altura total da faixa fixa do topo: 64px (barra normal) + 40px a mais quando o aviso
// permanente do modo "ver como" está visível — aside/main usam o mesmo valor para nunca ficar
// nem escondidos atrás do header nem com um vão em branco.
const ALTURA_TOPO_NORMAL = 'h-16'
const ALTURA_TOPO_IMPERSONANDO = 'h-[6.5rem]' // 104px = 64px + 40px

// Faixa de aviso permanente do modo "ver como" (v0.2.9) — nunca permite sessão ambígua sem
// aviso visível. Só existe botão de ENCERRAR aqui: nenhuma escrita é possível nesse modo (o
// backend bloqueia de qualquer forma, isto é só a sinalização visual).
function ImpersonationBar({
  impersonando,
}: {
  impersonando: NonNullable<ReturnType<typeof useMe>['data']>['impersonando']
}) {
  const { parar, pendente } = useImpersonacao()
  if (!impersonando) return null

  return (
    <div
      role="status"
      className="flex h-10 items-center justify-center gap-3 bg-amber-500 px-4 text-sm font-medium text-amber-950"
    >
      <span>
        Vendo como <strong>{impersonando.nome_nivel}</strong> — modo somente
        leitura. Seu nível real: {impersonando.nivel_real}.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-950/30 bg-transparent text-amber-950 hover:bg-amber-950/10"
        onClick={() => parar()}
        disabled={pendente}
      >
        Encerrar
      </Button>
    </div>
  )
}

function navCls({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  )
}

export function Shell() {
  const { signOut } = useAuth()
  const { data } = useMe()
  const { ehEscuro, alternar } = useTheme()
  const { commitAtual, novaVersaoDisponivel, recarregar } = useVersaoBuild()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // v2.5.1d (achado do usuário 2026-09-15) - uma barra lateral só, nunca duas: dentro de um
  // módulo com `itens` próprios (ex.: Associados), a MESMA barra troca pro menu do módulo, em
  // vez de abrir uma segunda coluna de navegação ao lado do conteúdo (péssimo no celular).
  const moduloAtivo = modulos.find(
    (m) =>
      m.itens &&
      (location.pathname === m.rota ||
        location.pathname.startsWith(`${m.rota}/`)),
  )

  const emImpersonacao = !!data?.impersonando
  const alturaTopo = emImpersonacao
    ? ALTURA_TOPO_IMPERSONANDO
    : ALTURA_TOPO_NORMAL

  async function sair() {
    await logout()
    signOut()
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Barra superior: aviso de impersonação (se houver) + identidade, busca, perfil */}
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-30 flex flex-col border-b border-border bg-card transition-[height] duration-200',
          alturaTopo,
        )}
      >
        <ImpersonationBar impersonando={data?.impersonando} />
        <div className="flex h-16 flex-1 items-center gap-2 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </Button>

          <Link to="/" className="text-lg font-bold tracking-tight">
            {mensagens.app.nome}
          </Link>

          {/* Busca global — placeholder nesta versão (a busca funcional entra em versão futura). */}
          <div className="relative ml-auto hidden md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Busca global…"
              aria-label="Busca global"
              disabled
              className="h-9 w-56 rounded-md border border-input bg-muted/40 pl-8 pr-3 text-sm disabled:cursor-not-allowed"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="ml-auto md:ml-0"
            onClick={alternar}
            aria-label={ehEscuro ? 'Ativar modo claro' : 'Ativar modo escuro'}
          >
            {ehEscuro ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>

          <Button variant="ghost" size="icon" aria-label="Notificações">
            <Bell className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:block">
              {data?.nome_completo ?? data?.email ?? 'Usuário'}
            </span>
            <Button variant="outline" size="sm" onClick={sair}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Navegação lateral colapsável (vira gaveta abaixo de 1024px) */}
      <aside
        className={cn(
          'fixed bottom-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:translate-x-0',
          emImpersonacao ? 'top-[6.5rem]' : 'top-16',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'lg:w-16' : 'lg:w-64',
        )}
      >
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {moduloAtivo ? (
            <>
              <Link
                to="/"
                onClick={() => setMobileOpen(false)}
                className="mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <ArrowLeft className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{mensagens.navegacao.inicio}</span>}
              </Link>
              {!collapsed && (
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {moduloAtivo.rotulo}
                </p>
              )}
              {moduloAtivo.itens?.map((item) => (
                <NavLink
                  key={item.rota}
                  to={item.rota}
                  end={item.fim}
                  className={navCls}
                  onClick={() => setMobileOpen(false)}
                >
                  <item.icone className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{item.rotulo}</span>}
                </NavLink>
              ))}
            </>
          ) : (
            <>
              <NavLink
                to="/"
                end
                className={navCls}
                onClick={() => setMobileOpen(false)}
              >
                <House className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{mensagens.navegacao.inicio}</span>}
              </NavLink>

              <NavLink
                to="/perfil"
                className={navCls}
                onClick={() => setMobileOpen(false)}
              >
                <UserRound className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{mensagens.navegacao.meuPerfil}</span>}
              </NavLink>

              {/* v2.5.3b (achado do usuário 2026-09-15) - "cada membro tem a sua ficha de
                  chamada": fica junto de Meu Perfil (sobre o próprio associado), não dentro do
                  módulo Governança (que é sobre conduzir a assembleia de todo mundo). */}
              <NavLink
                to="/minhas-assembleias"
                className={navCls}
                onClick={() => setMobileOpen(false)}
              >
                <CalendarCheck className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Minhas assembleias</span>}
              </NavLink>
            </>
          )}
        </nav>
      </aside>

      {/* Área de conteúdo */}
      <main
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200',
          emImpersonacao ? 'pt-[6.5rem]' : 'pt-16',
          collapsed ? 'lg:pl-16' : 'lg:pl-64',
        )}
      >
        <StatusBar
          novaVersaoDisponivel={novaVersaoDisponivel}
          recarregar={recarregar}
        />
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <Outlet />
        </div>
        <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
          {mensagens.app.nome}
          {commitAtual ? ` · build ${commitAtual}` : null}
        </footer>
      </main>
    </div>
  )
}
