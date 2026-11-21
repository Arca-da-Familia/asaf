import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { AjudaDaTela } from '@/components/layout/AjudaDaTela'

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
                <Link
                  to={item.href}
                  className="inline-flex min-h-7 items-center hover:text-foreground"
                >
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
          <AjudaDaTela />
        </div>
        {/* v9.6b: no celular as ações ocupam a linha toda e quebram a linha (o seletor do mês da Visão geral fica com a largura toda) */}
        {acoes && (
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            {acoes}
          </div>
        )}
      </div>
    </header>
  )
}
