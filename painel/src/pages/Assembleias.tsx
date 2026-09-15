import { useQuery } from '@tanstack/react-query'
import { Gavel, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { DataTable } from '@/components/data/DataTable'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { listarAssembleias, type Assembleia } from '@/lib/api'
import { formatarData } from '@/lib/datas'
import type { ColumnDef } from '@tanstack/react-table'

// v2.5.2 (FASE 2.5 - Painel) - primeira tela de Governança: até aqui `/governanca` era
// `<EmConstrucao>`, apesar de o backend (FASE 2, v2.2/v2.3) já ter convocação, habilitação e
// condução de sessão completos e testados. Ordem definida pelo usuário: Associados primeiro
// (v2.5.1), Governança agora, Financeiro depois.
const CORES_STATUS: Record<string, string> = {
  Rascunho: 'text-muted-foreground',
  Convocada: 'text-blue-600',
  'Em andamento': 'text-amber-600',
  Realizada: 'text-green-600',
  Cancelada: 'text-destructive',
}

const colunas: ColumnDef<Assembleia>[] = [
  {
    accessorKey: 'tipo',
    header: 'Tipo',
    cell: ({ row }) => (
      <Link
        to={`/governanca/${row.original.id_assembleia}`}
        className="font-medium hover:underline"
      >
        {row.original.tipo}
      </Link>
    ),
  },
  {
    accessorKey: 'pauta',
    header: 'Ordem do dia',
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-sm text-muted-foreground">
        {row.original.pauta}
      </span>
    ),
  },
  {
    accessorKey: 'primeira_convocacao',
    header: '1ª convocação',
    cell: ({ row }) =>
      formatarData(row.original.primeira_convocacao, { comHora: true }),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <span className={CORES_STATUS[row.original.status] ?? ''}>
        {row.original.status}
      </span>
    ),
  },
]

export function AssembleiasPage() {
  const { data: assembleias, isLoading } = useQuery({
    queryKey: ['assembleias'],
    queryFn: () => listarAssembleias(),
  })

  const dados = useMemo(() => assembleias ?? [], [assembleias])

  return (
    <>
      <PageHeader
        titulo="Assembleias"
        descricao="Convocação, condução de sessão e habilitação de associados."
        acoes={
          <>
            <Button asChild variant="outline">
              <Link to="/governanca/peticoes">Petições de convocação</Link>
            </Button>
            <Button asChild>
              <Link to="/governanca/nova">
                <Plus className="mr-2 h-4 w-4" />
                Nova assembleia
              </Link>
            </Button>
          </>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : dados.length === 0 ? (
        <EmptyState
          icone={Gavel}
          titulo="Nenhuma assembleia cadastrada ainda"
          descricao="Convoque a primeira assembleia para começar."
          acao={
            <Button asChild>
              <Link to="/governanca/nova">Nova assembleia</Link>
            </Button>
          }
        />
      ) : (
        <DataTable dados={dados} colunas={colunas} />
      )}
    </>
  )
}
