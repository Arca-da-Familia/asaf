import { Button } from '@/components/ui/button'

/**
 * v9.2c - "Página 2 de 8 · 187 itens" com Anterior e Próxima, para as listas que o servidor pagina e não usam a tabela comum (DataTable tem a sua).
 * Some quando tudo cabe numa página. Os botões dizem para onde vão (o leitor de tela lê "Página anterior"); o texto da página atual é anunciado ao mudar.
 */
export function Paginador({
  pagina,
  porPagina,
  total,
  aoMudar,
  rotulo = 'Paginação',
}: {
  /** a partir de 1 */
  pagina: number
  porPagina: number
  total: number
  aoMudar: (pagina: number) => void
  rotulo?: string
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  if (total <= porPagina) return null
  return (
    <nav
      aria-label={rotulo}
      className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"
    >
      <p aria-live="polite" className="text-muted-foreground">
        Página {pagina} de {paginas} · {total} {total === 1 ? 'item' : 'itens'}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pagina <= 1}
          onClick={() => aoMudar(pagina - 1)}
        >
          Página anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pagina >= paginas}
          onClick={() => aoMudar(pagina + 1)}
        >
          Próxima página
        </Button>
      </div>
    </nav>
  )
}
