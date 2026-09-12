import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ColumnDef, PaginationState } from '@tanstack/react-table'

import { DataTable } from '@/components/data/DataTable'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  listarAcoesAuditoria,
  listarAuditoria,
  type EntradaAuditoria,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

const colunas: ColumnDef<EntradaAuditoria>[] = [
  {
    accessorKey: 'timestamp',
    header: 'Quando',
    cell: ({ getValue }) => formatarData(getValue<string>(), { comHora: true }),
  },
  {
    accessorKey: 'nome_usuario',
    header: 'Usuário',
    cell: ({ row }) =>
      row.original.nome_usuario ?? `#${row.original.id_usuario ?? '—'}`,
  },
  { accessorKey: 'acao', header: 'Ação' },
  { accessorKey: 'tabela_afetada', header: 'Tabela' },
  {
    accessorKey: 'id_registro_afetado',
    header: 'Registro',
    cell: ({ getValue }) => getValue<number | null>() ?? '—',
  },
  {
    accessorKey: 'ip_origem',
    header: 'IP',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
  },
]

// v0.2.9 — visualizador somente leitura do AuditLog. Nunca há botão de exclusão aqui: apagar
// trilha de auditoria pela interface contraria o propósito dela (LGPD/segregação de funções,
// ver FASE 7/FASE 3 do plano).
export function AuditoriaPage() {
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [tabela, setTabela] = useState('')
  const [acao, setAcao] = useState('')
  const [desde, setDesde] = useState('')
  const [ate, setAte] = useState('')
  const [paginacao, setPaginacao] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  })

  const { data: acoesDisponiveis } = useQuery({
    queryKey: ['auditoria', 'acoes'],
    queryFn: listarAcoesAuditoria,
  })

  const { data, isLoading } = useQuery({
    queryKey: [
      'auditoria',
      filtroUsuario,
      tabela,
      acao,
      desde,
      ate,
      paginacao.pageIndex,
      paginacao.pageSize,
    ],
    queryFn: () =>
      listarAuditoria({
        id_usuario: filtroUsuario ? Number(filtroUsuario) : undefined,
        tabela_afetada: tabela || undefined,
        acao: acao || undefined,
        desde: desde || undefined,
        ate: ate || undefined,
        pagina: paginacao.pageIndex + 1,
        por_pagina: paginacao.pageSize,
      }),
  })

  return (
    <>
      <PageHeader
        titulo="Auditoria"
        descricao="Quem mudou o quê, quando — somente leitura, sem exclusão possível por aqui."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="text-sm font-medium">ID do usuário</label>
          <input
            inputMode="numeric"
            value={filtroUsuario}
            onChange={(e) =>
              setFiltroUsuario(e.target.value.replace(/\D/g, ''))
            }
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Tabela</label>
          <input
            value={tabela}
            onChange={(e) => setTabela(e.target.value)}
            placeholder="ex.: usuarios"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Ação</label>
          <select
            value={acao}
            onChange={(e) => setAcao(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {(acoesDisponiveis ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Até</label>
          <input
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <DataTable
          dados={data?.entradas ?? []}
          colunas={colunas}
          filtroGlobal={false}
          manualPagination
          totalRegistros={data?.total}
          pageCount={data ? Math.ceil(data.total / data.por_pagina) : 0}
          onPaginationChange={setPaginacao}
        />
      )}
    </>
  )
}
