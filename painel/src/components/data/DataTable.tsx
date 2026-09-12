import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
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

type DataTableProps<T> = {
  dados: T[]
  colunas: ColumnDef<T>[]
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
export function DataTable<T>({
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
  const [selecao, setSelecao] = useState<Record<string, boolean>>({})
  const [paginacao, setPaginacao] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const colunaSelecao: ColumnDef<T> = {
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

  const table = useReactTable({
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination,
    pageCount: manualPagination ? pageCount : undefined,
  })

  return (
    <div className="space-y-3">
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
                    className={cn(
                      'px-3 text-left font-medium',
                      densidade === 'compacta' ? 'py-1.5' : 'py-2',
                    )}
                  >
                    {header.isPlaceholder ? null : (
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
                          <ArrowUp className="h-3.5 w-3.5" />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown className="h-3.5 w-3.5" />
                        ) : header.column.getCanSort() ? (
                          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : null}
                      </button>
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
                  {row.getVisibleCells().map((cell) => (
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
            value={table.getState().pagination.pageSize}
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
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
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
