import type { LucideIcon } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import { cn } from '@/lib/utils'

export type ItemModulo = {
  rota: string
  rotulo: string
  icone: LucideIcon
  fim?: boolean // NavLink "end" - só a rota exata fica ativa, não qualquer sub-rota
}

function navCls({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  )
}

// v2.5.1c (FASE 2.5 - Painel, achado do usuário 2026-09-15) - um módulo aberto precisa da
// própria barra de funções (Listar, Novo, Gráficos, Configurações…), não só abas soltas numa
// página só. Genérico de propósito: todo módulo de negócio futuro (Financeiro, Governança…)
// usa este mesmo shell, só troca `titulo`/`itens` - a estrutura nunca se repete por módulo.
export function ModuleShell({
  titulo,
  itens,
}: {
  titulo: string
  itens: ItemModulo[]
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-56">
        <Link
          to="/"
          className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Início
        </Link>
        <h2 className="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
        </h2>
        <nav className="flex flex-row gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {itens.map((item) => (
            <NavLink
              key={item.rota}
              to={item.rota}
              end={item.fim}
              className={navCls}
            >
              <item.icone className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{item.rotulo}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
