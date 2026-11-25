// v9.6b - o seletor do mês "‹ Novembro de 2026 ›", peça compartilhada das telas novas do Financeiro (o plano da v9.6: nada de lista eterna, tudo por mês).
// Quem usa guarda o mês no endereço (`?mes=AAAA-MM`), para dar para mandar o link. No celular ocupa a largura toda (o desenho escolhido).
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { nomeDoMes, somarMeses } from '@/lib/meses'
import { cn } from '@/lib/utils'

export function SeletorDoMes({
  mes,
  aoMudar,
  className,
}: {
  mes: string
  aoMudar: (mes: string) => void
  className?: string
}) {
  const botao =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground sm:h-9 sm:w-9'
  return (
    <div
      role="group"
      aria-label="Mês"
      className={cn(
        'flex items-center gap-1 rounded-xl border border-input bg-card px-1 max-sm:w-full',
        className,
      )}
    >
      <button
        type="button"
        className={botao}
        aria-label="Mês anterior"
        onClick={() => aoMudar(somarMeses(mes, -1))}
      >
        <ChevronLeft aria-hidden="true" className="h-5 w-5" />
      </button>
      <span
        aria-live="polite"
        className="min-w-0 flex-1 px-1 text-center text-sm font-bold whitespace-nowrap sm:min-w-40"
      >
        {nomeDoMes(mes)}
      </span>
      <button
        type="button"
        className={botao}
        aria-label="Próximo mês"
        onClick={() => aoMudar(somarMeses(mes, 1))}
      >
        <ChevronRight aria-hidden="true" className="h-5 w-5" />
      </button>
    </div>
  )
}
