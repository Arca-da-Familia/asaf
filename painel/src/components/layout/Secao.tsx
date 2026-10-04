import type { ReactNode } from 'react'

// Bloco da tela de detalhe: título (h2) + conteúdo, com nome acessível igual ao título.
export function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao?: string
  children: ReactNode
}) {
  return (
    <section
      aria-label={titulo}
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div>
        <h2 className="font-semibold">{titulo}</h2>
        {descricao && (
          <p className="mt-0.5 text-sm text-muted-foreground">{descricao}</p>
        )}
      </div>
      {children}
    </section>
  )
}
