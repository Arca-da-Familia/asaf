import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  flexRender,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react'
import { useState } from 'react'

import { EmptyState } from '@/components/feedback/EmptyState'
import { Button } from '@/components/ui/button'
import { mensagens } from '@/lib/i18n/pt-BR'
import { cn } from '@/lib/utils'

// TanStack Table v9: cada recurso é declarado (e só o que se declara entra no bundle). Aqui:
// ordenação, filtro global, paginação e seleção de linhas — o mesmo conjunto do DataTable da v8.
const features = tableFeatures({
  columnFilteringFeature, // exigido pelo tipo: globalFilteringFeature e filteredRowModel dependem dele
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns,
  sortFns,
})

/** Definição de coluna do DataTable — as telas tipam suas colunas com isto, não com `ColumnDef`. */
export type ColunaTabela<T extends RowData> = ColumnDef<typeof features, T>

type DataTableProps<T extends RowData> = {
  dados: T[]
  colunas: ColunaTabela<T>[]
  selecionavel?: boolean
  filtroGlobal?: boolean
  densidade?: 'normal' | 'compacta'
  // Paginação server-side: quando manualPagination=true, o chamador busca a página no
  // backend (dados já vem paginado) e informa pageCount + onPaginationChange.
  manualPagination?: boolean
  pageCount?: number
  totalRegistros?: number
  onPaginationChange?: (paginacao: PaginationState) => void
}

// Tabela padrão (v0.2.4) — ordenação, filtro global, paginação (client ou server-side),
// seleção e densidade. O mesmo contrato vale para todos os módulos de negócio futuros.
export function DataTable<T extends RowData>({
  dados,
  colunas,
  selecionavel = false,
  filtroGlobal = true,
  densidade = 'normal',
  manualPagination = false,
  pageCount,
  totalRegistros,
  onPaginationChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [filtro, setFiltro] = useState('')
  const [selecao, setSelecao] = useState<RowSelectionState>({})
  const [paginacao, setPaginacao] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const colunaSelecao: ColunaTabela<T> = {
    id: 'selecao',
    header: ({ table }) => (
      <input
        type="checkbox"
        aria-label="Selecionar todos"
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label="Selecionar linha"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
      />
    ),
  }

  const colunasFinais = selecionavel ? [colunaSelecao, ...colunas] : colunas

  const table = useTable({
    features,
    data: dados,
    columns: colunasFinais,
    state: {
      sorting,
      globalFilter: filtro,
      rowSelection: selecao,
      pagination: paginacao,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFiltro,
    onRowSelectionChange: setSelecao,
    onPaginationChange: (updater) => {
      const nova = typeof updater === 'function' ? updater(paginacao) : updater
      setPaginacao(nova)
      onPaginationChange?.(nova)
    },
    enableRowSelection: selecionavel,
    manualPagination,
    pageCount: manualPagination ? pageCount : undefined,
  })

  return (
    <div className="v3-space-y-3">
      {filtroGlobal && (
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder={mensagens.tabela.filtroPlaceholder}
            aria-label={mensagens.tabela.filtrar}
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-muted/50">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    // Informa a leitores de tela qual coluna está ordenada e em que sentido.
                    aria-sort={
                      header.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : header.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : header.column.getCanSort()
                            ? 'none'
                            : undefined
                    }
                    className={cn(
                      'px-3 text-left font-medium',
                      densidade === 'compacta' ? 'py-1.5' : 'py-2',
                    )}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        ) : (
                          <ArrowUpDown
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ) : (
                      // Coluna que NÃO ordena (seleção, ações): sem <button>. Antes o cabeçalho
                      // era sempre um botão — a caixa "Selecionar todos" ficava DENTRO de um
                      // botão (controle dentro de controle) e coluna de cabeçalho vazio virava
                      // botão sem nome (achado do axe, 2026-10-01).
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={colunasFinais.length}>
                  <div className="p-4">
                    <EmptyState
                      titulo={mensagens.tabela.nadaEncontrado}
                      descricao={mensagens.tabela.nadaEncontradoDescricao}
                    />
                  </div>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-0 hover:bg-accent/40"
                >
                  {row.getAllCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-3',
                        densidade === 'compacta' ? 'py-1.5' : 'py-2',
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {totalRegistros ?? table.getFilteredRowModel().rows.length}{' '}
            {mensagens.tabela.registros}
          </span>
          <select
            value={table.state.pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            aria-label="Registros por página"
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n} / página
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {table.state.pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Próxima página"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
