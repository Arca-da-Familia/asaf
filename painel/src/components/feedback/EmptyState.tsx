import { Inbox, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type EmptyStateProps = {
  icone?: LucideIcon
  titulo: string
  descricao?: string
  acao?: ReactNode
}

export function EmptyState({
  icone: Icone = Inbox,
  titulo,
  descricao,
  acao,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icone className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 font-semibold">{titulo}</h3>
      {descricao && (
        <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      )}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  )
}
