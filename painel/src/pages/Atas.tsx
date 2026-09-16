import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { DataTable } from '@/components/data/DataTable'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { listarAtas, type AtaListagem } from '@/lib/api'
import type { ColumnDef } from '@tanstack/react-table'

const CORES_STATUS: Record<string, string> = {
  Rascunho: 'text-amber-600',
  Assinada: 'text-green-600',
}

const colunas: ColumnDef<AtaListagem>[] = [
  {
    accessorKey: 'numero_sequencial',
    header: 'Nº',
    cell: ({ row }) => (
      <Link
        to={`/governanca/${row.original.id_assembleia}/ata`}
        className="font-medium hover:underline"
      >
        {row.original.numero_sequencial ?? '(rascunho)'}
      </Link>
    ),
  },
  {
    accessorKey: 'assembleia_tipo',
    header: 'Assembleia',
  },
  {
    accessorKey: 'assembleia_pauta',
    header: 'Ordem do dia',
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-sm text-muted-foreground">
        {row.original.assembleia_pauta}
      </span>
    ),
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
  {
    id: 'documento',
    header: 'Documento oficial',
    cell: ({ row }) =>
      row.original.arquivo_documento_assinado ? (
        <span className="text-green-600">Anexado</span>
      ) : (
        <span className="text-muted-foreground">Não anexado</span>
      ),
  },
]

// v2.5.4b (FASE 2.5 - Painel, achado do usuário 2026-09-16) - "Atas" ganhou item próprio no
// menu de Governança em vez de só ser alcançável clicando dentro de cada assembleia - é a
// listagem geral, de todas as assembleias, pro secretário achar uma ata antiga sem precisar
// lembrar de qual assembleia ela saiu.
export function AtasPage() {
  const { data: atas, isLoading } = useQuery({
    queryKey: ['atas'],
    queryFn: listarAtas,
  })

  const dados = useMemo(() => atas ?? [], [atas])

  return (
    <>
      <PageHeader
        titulo="Atas"
        descricao="Registro gerado de cada sessão, deliberações e documento oficial anexado."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : dados.length === 0 ? (
        <EmptyState
          icone={FileText}
          titulo="Nenhuma ata gerada ainda"
          descricao="A ata só existe depois que a sessão de uma assembleia é encerrada."
        />
      ) : (
        <DataTable dados={dados} colunas={colunas} />
      )}
    </>
  )
}
