import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type TrilhaItem = { rotulo: string; href?: string }

type PageHeaderProps = {
  titulo: string
  descricao?: string
  trilha?: TrilhaItem[]
  acoes?: ReactNode
}

export function PageHeader({
  titulo,
  descricao,
  trilha,
  acoes,
}: PageHeaderProps) {
  return (
    <header className="mb-6">
      {trilha && trilha.length > 0 && (
        <nav
          aria-label="Trilha de navegação"
          className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          {trilha.map((item, i) => (
            <span key={item.rotulo} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-4 w-4" />}
              {item.href ? (
                <Link to={item.href} className="hover:text-foreground">
                  {item.rotulo}
                </Link>
              ) : (
                <span>{item.rotulo}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{titulo}</h1>
          {descricao && (
            <p className="mt-1 text-muted-foreground">{descricao}</p>
          )}
        </div>
        {acoes && <div className="flex items-center gap-2">{acoes}</div>}
      </div>
    </header>
  )
}
