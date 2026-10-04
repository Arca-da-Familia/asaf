import type { ReactNode } from 'react'

// Rótulo + campo: o rótulo ENVOLVE o campo, então o leitor de tela anuncia o nome certo sem precisar de id.
export function Campo({
  rotulo,
  dica,
  children,
  className = '',
}: {
  rotulo: string
  dica?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium">{rotulo}</span>
      {children}
      {dica && (
        <span className="mt-1 block text-xs text-muted-foreground">{dica}</span>
      )}
    </label>
  )
}
