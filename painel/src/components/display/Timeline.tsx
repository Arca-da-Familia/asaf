import type { ReactNode } from 'react'

export type EventoTimeline = {
  titulo: string
  descricao?: string
  data?: string
  icone?: ReactNode
}

export function Timeline({ eventos }: { eventos: EventoTimeline[] }) {
  return (
    <ol className="relative space-y-6 border-l border-border pl-6">
      {eventos.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card">
            {e.icone ?? <span className="h-2 w-2 rounded-full bg-primary" />}
          </span>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-medium">{e.titulo}</h4>
              {e.data && (
                <time className="text-xs text-muted-foreground">{e.data}</time>
              )}
            </div>
            {e.descricao && (
              <p className="mt-1 text-sm text-muted-foreground">
                {e.descricao}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
