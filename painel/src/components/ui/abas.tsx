import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * v9.3c (pedido do Presidente, 05/11: telas compridas viram "submenus"/telas progressivas): abas acessíveis — a fileira de botões com
 * role="tablist", cada aba com aria-selected e o painel com role="tabpanel" ligado a ela. Setas ← → (e Home/End) andam entre as abas, como o leitor de
 * tela espera. Só o painel da aba escolhida é montado (menos coisa carregando de uma vez). Quem guarda a aba escolhida é quem usa (ex.: no endereço).
 */
export interface Aba {
  chave: string
  rotulo: string
  conteudo: ReactNode
}

export function Abas({
  abas,
  atual,
  aoMudar,
  rotulo,
}: {
  abas: readonly Aba[]
  atual: string
  aoMudar: (chave: string) => void
  /** nome da fileira para o leitor de tela */
  rotulo: string
}) {
  const id = useId()
  const fileira = useRef<HTMLDivElement>(null)
  const escolhida = abas.find((a) => a.chave === atual) ?? abas[0]
  if (!escolhida) return null

  function teclado(e: KeyboardEvent<HTMLButtonElement>, indice: number) {
    let destino: number | null = null
    if (e.key === 'ArrowRight') destino = (indice + 1) % abas.length
    else if (e.key === 'ArrowLeft')
      destino = (indice - 1 + abas.length) % abas.length
    else if (e.key === 'Home') destino = 0
    else if (e.key === 'End') destino = abas.length - 1
    if (destino === null) return
    e.preventDefault()
    const alvo = abas[destino]
    if (!alvo) return
    aoMudar(alvo.chave)
    fileira.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [destino]?.focus()
  }

  return (
    <div>
      <div
        ref={fileira}
        role="tablist"
        aria-label={rotulo}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {abas.map((a, i) => {
          const ativa = a.chave === escolhida.chave
          return (
            <button
              key={a.chave}
              type="button"
              role="tab"
              id={`${id}-aba-${a.chave}`}
              aria-selected={ativa}
              aria-controls={`${id}-painel-${a.chave}`}
              tabIndex={ativa ? 0 : -1}
              onClick={() => aoMudar(a.chave)}
              onKeyDown={(e) => teclado(e, i)}
              className={cn(
                '-mb-px min-h-9 rounded-t-md border border-transparent px-3 py-1.5 text-sm font-medium',
                ativa
                  ? 'border-border border-b-card bg-card text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {a.rotulo}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`${id}-painel-${escolhida.chave}`}
        aria-labelledby={`${id}-aba-${escolhida.chave}`}
        tabIndex={0}
        className="flex flex-col gap-6 pt-4"
      >
        {escolhida.conteudo}
      </div>
    </div>
  )
}
