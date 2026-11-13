import {
  Bell,
  House,
  LayoutGrid,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Link, useLocation } from 'react-router'

import { cn } from '@/lib/utils'

// v9.5b - a barra fixa de baixo no celular (desenho aprovado pelo Presidente, rodada 3: "Barra verde e cartões"): Início, Módulos, Avisos e Meu perfil, sempre ao
// alcance do polegar. "Módulos" leva à lista de módulos do Início. Some a partir do notebook (lg), onde a barra do alto e a coluna dos módulos bastam.
type Item = {
  rota: string
  rotulo: string
  icone: LucideIcon
  ativo: (caminho: string, hash: string) => boolean
}

const ITENS: Item[] = [
  {
    rota: '/',
    rotulo: 'Início',
    icone: House,
    ativo: (c, h) => c === '/' && h !== '#modulos',
  },
  {
    rota: '/#modulos',
    rotulo: 'Módulos',
    icone: LayoutGrid,
    ativo: (c, h) => c === '/' && h === '#modulos',
  },
  {
    rota: '/meus-avisos',
    rotulo: 'Avisos',
    icone: Bell,
    ativo: (c) => c.startsWith('/meus-avisos'),
  },
  {
    rota: '/perfil',
    rotulo: 'Meu perfil',
    icone: UserRound,
    ativo: (c) => c.startsWith('/perfil'),
  },
]

export function NavegacaoDoCelular() {
  const { pathname, hash } = useLocation()
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-30 grid h-[76px] grid-cols-4 border-t border-border bg-card px-1.5 pt-1.5 pb-[max(14px,env(safe-area-inset-bottom))] lg:hidden"
    >
      {ITENS.map((item) => {
        const ativo = item.ativo(pathname, hash)
        return (
          <Link
            key={item.rotulo}
            to={item.rota}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center justify-center gap-1 text-xs',
              ativo
                ? 'font-extrabold text-verde-texto'
                : 'font-semibold text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex h-[30px] w-14 items-center justify-center rounded-full',
                ativo && 'bg-verde-tinta',
              )}
            >
              <item.icone className="size-[21px]" aria-hidden="true" />
            </span>
            {item.rotulo}
          </Link>
        )
      })}
    </nav>
  )
}
