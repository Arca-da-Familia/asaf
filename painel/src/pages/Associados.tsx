import { useQuery } from '@tanstack/react-query'
import { UserPlus, Users } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { DataTable } from '@/components/data/DataTable'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { listarAssociados, type AssociadoListagem } from '@/lib/api'
import type { ColumnDef } from '@tanstack/react-table'

// v3.0.2 (achado 2026-09-15) - até aqui, /associados só tinha a guarda de permissão (navegação
// e menu funcionando, nenhum conteúdo). Esta é a primeira tela de negócio de verdade do painel
// único: listar quem já está cadastrado e, pra quem ainda não tem login, conceder acesso sem
// sair desta tela.
const colunas: ColumnDef<AssociadoListagem>[] = [
  {
    accessorKey: 'nome_completo',
    header: 'Nome',
    cell: ({ row }) => (
      <Link
        to={`/associados/${row.original.id_associado}`}
        className="font-medium hover:underline"
      >
        {row.original.nome_completo}
      </Link>
    ),
  },
  { accessorKey: 'cpf', header: 'CPF' },
  { accessorKey: 'categoria', header: 'Categoria' },
  { accessorKey: 'status_arrolamento', header: 'Situação' },
  {
    id: 'acesso',
    header: 'Acesso ao painel',
    cell: ({ row }) =>
      row.original.tem_acesso ? (
        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
          Concedido
        </span>
      ) : (
        <Button asChild variant="outline" size="sm">
          <Link to={`/associados/${row.original.id_associado}/conceder-acesso`}>
            Conceder acesso
          </Link>
        </Button>
      ),
  },
  {
    id: 'detalhe',
    header: '',
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link to={`/associados/${row.original.id_associado}`}>
          Ver / editar
        </Link>
      </Button>
    ),
  },
]

export function AssociadosPage() {
  const { data: associados, isLoading } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })

  const dados = useMemo(() => associados ?? [], [associados])

  return (
    <>
      <PageHeader
        titulo="Associados"
        descricao="Cadastro, situação e acesso ao painel."
        acoes={
          <>
            <Button asChild variant="outline">
              <Link to="/associados/importar">Importar em lote</Link>
            </Button>
            <Button asChild>
              <Link to="/associados/novo">
                <UserPlus className="mr-2 h-4 w-4" />
                Novo associado
              </Link>
            </Button>
          </>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : dados.length === 0 ? (
        <EmptyState
          icone={Users}
          titulo="Nenhum associado cadastrado ainda"
          descricao="Cadastre o primeiro associado para começar."
          acao={
            <Button asChild>
              <Link to="/associados/novo">Novo associado</Link>
            </Button>
          }
        />
      ) : (
        <DataTable dados={dados} colunas={colunas} />
      )}
    </>
  )
}
