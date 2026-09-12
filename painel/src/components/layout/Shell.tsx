import { useState } from 'react'
import {
  Bell,
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
import { Link, NavLink, Outlet } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { logout } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { mensagens } from '@/lib/i18n/pt-BR'
import { modulos } from '@/lib/modulos'
import { useTheme } from '@/lib/theme'
import { useMe } from '@/lib/use-me'
import { useVersaoBuild } from '@/lib/versao'
import { cn } from '@/lib/utils'

import { StatusBar } from './StatusBar'

// Slot reservado para a barra de impersonação (v0.2.9). Enquanto não existir sessão de
// impersonação, não renderiza nada — mas o shell já reserva o ponto exato onde a faixa de
// aviso permanente entra, para nunca permitir sessão ambígua sem aviso visível.
function ImpersonationBar() {
  return null
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

  // Menu montado 100% a partir das permissões: filtra o manifesto pelo que o usuário tem.
  const permissoes = data?.permissoes ?? []
  const modulosVisiveis = modulos.filter((m) =>
    permissoes.includes(m.permissao),
  )

  async function sair() {
    await logout()
    signOut()
  }

  return (
    <div className="min-h-screen bg-background">
      <ImpersonationBar />

      {/* Barra superior: identidade, busca global, notificações e perfil */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-card px-4">
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
          'fixed bottom-0 left-0 top-16 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'lg:w-16' : 'lg:w-64',
        )}
      >
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
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

          {modulosVisiveis.map((m) => (
            <NavLink
              key={m.rota}
              to={m.rota}
              className={navCls}
              onClick={() => setMobileOpen(false)}
            >
              <m.icone className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{m.rotulo}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Área de conteúdo */}
      <main
        className={cn(
          'flex min-h-screen flex-col pt-16 transition-[padding] duration-200',
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
