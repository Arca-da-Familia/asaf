import { useEffect, useRef, useState } from 'react'
import {
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  Cog,
  Handshake,
  HeartHandshake,
  Megaphone,
  ShieldAlert,
  UserPlus,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { NavLink } from 'react-router'

import { cn } from '@/lib/utils'

// v9.5b - o que é da própria pessoa, fora dos módulos. Antes ficava na coluna da esquerda de toda tela; o Presidente decidiu (rodada 2, 13/11) que o Início não
// tem coluna à esquerda e que a coluna só aparece dentro de um módulo, com lista suspensa. Então estes atalhos ficam numa lista suspensa no botão com o nome da
// pessoa, na barra verde do alto. Cada um continua sendo tela de qualquer pessoa com acesso (o servidor não pede permissão de módulo para eles).
const ITENS: Array<{ rota: string; rotulo: string; icone: LucideIcon }> = [
  { rota: '/perfil', rotulo: 'Meu perfil', icone: UserRound },
  { rota: '/meus-avisos', rotulo: 'Meus avisos', icone: Megaphone },
  {
    rota: '/minhas-assembleias',
    rotulo: 'Minhas assembleias',
    icone: CalendarCheck,
  },
  {
    rota: '/peticoes-de-convocacao',
    rotulo: 'Petições de convocação',
    icone: Handshake,
  },
  {
    rota: '/filiacao/para-propor',
    rotulo: 'Pedidos de filiação',
    icone: UserPlus,
  },
  {
    rota: '/meu-voluntariado',
    rotulo: 'Meu voluntariado',
    icone: HeartHandshake,
  },
  {
    rota: '/meus-processos-disciplinares',
    rotulo: 'Meus processos disciplinares',
    icone: ShieldAlert,
  },
  {
    rota: '/calendario',
    rotulo: 'Calendário institucional',
    icone: CalendarDays,
  },
  { rota: '/configuracoes', rotulo: 'Configurações', icone: Cog },
]

function iniciaisDe(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const primeira = partes[0]![0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

export function MenuPessoal({ nome }: { nome: string | null | undefined }) {
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const primeiroNome = (nome ?? '').trim().split(/\s+/)[0] || 'Você'

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node))
        setAberto(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  return (
    <div className="relative" ref={raiz}>
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls="menu-pessoal"
        onClick={() => setAberto((v) => !v)}
        className="flex h-11 items-center gap-2 rounded-xl px-1.5 text-barra-foreground hover:bg-barra-2 sm:pr-2.5"
      >
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-full bg-brand-secondary text-[13px] font-extrabold text-brand-secondary-foreground"
        >
          {iniciaisDe(nome)}
        </span>
        <span className="hidden max-w-32 truncate text-sm font-bold md:inline">
          {primeiroNome}
        </span>
        <span className="sr-only">: menu pessoal</span>
        <ChevronDown className="hidden size-4 sm:block" aria-hidden="true" />
      </button>
      {aberto && (
        <nav
          id="menu-pessoal"
          aria-label="Menu pessoal"
          className="absolute top-full right-0 z-50 mt-2 w-72 max-w-[92vw] rounded-2xl border border-border bg-card p-2 text-card-foreground shadow-lg"
        >
          <ul className="flex flex-col gap-0.5">
            {ITENS.map((item) => (
              <li key={item.rota}>
                <NavLink
                  to={item.rota}
                  onClick={() => setAberto(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold',
                      isActive
                        ? 'bg-brand-secondary text-brand-secondary-foreground'
                        : 'hover:bg-accent',
                    )
                  }
                >
                  <item.icone
                    className="size-[18px] shrink-0"
                    aria-hidden="true"
                  />
                  {item.rotulo}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
