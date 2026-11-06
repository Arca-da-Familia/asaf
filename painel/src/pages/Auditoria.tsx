import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { PaginationState } from '@tanstack/react-table'

import { DataTable, type ColunaTabela } from '@/components/data/DataTable'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  listarAcoesAuditoria,
  listarAuditoria,
  listarTabelasAuditoria,
  type EntradaAuditoria,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

const colunas: ColunaTabela<EntradaAuditoria>[] = [
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
  // v9.3f (pedido do Presidente, 06/11): o nome em português, nunca o código técnico (BAIXA_TITULO, plano_de_contas); o código fica num atributo
  // (`data-acao`, `data-tabela`) para quem confere de forma automática
  {
    accessorKey: 'acao',
    header: 'O que aconteceu',
    cell: ({ row }) => (
      <span data-acao={row.original.acao}>
        {row.original.rotulo_acao ?? row.original.acao}
      </span>
    ),
  },
  {
    accessorKey: 'tabela_afetada',
    header: 'Assunto',
    cell: ({ row }) => (
      <span data-tabela={row.original.tabela_afetada}>
        {row.original.rotulo_tabela ?? row.original.tabela_afetada}
      </span>
    ),
  },
  {
    accessorKey: 'id_registro_afetado',
    header: 'Nº do registro',
    cell: ({ getValue }) => getValue<number | null>() ?? '—',
  },
  {
    accessorKey: 'ip_origem',
    header: 'Endereço de rede (IP)',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
  },
]

// v0.2.9 — visualizador somente leitura do AuditLog. Nunca há botão de exclusão aqui: apagar
// trilha de auditoria pela interface contraria o propósito dela (LGPD/segregação de funções,
// ver FASE 7/FASE 3 do plano).
export function AuditoriaPage() {
  const [filtroUsuario, setFiltroUsuario] = useState('')
  // v9.3f: o assunto e a ação podem vir no endereço (`/auditoria?tabela=eventos&acao=STATUS_ALTERADO`), para outra tela apontar direto para eles
  const [parametros, setParametros] = useSearchParams()
  const tabela = parametros.get('tabela') ?? ''
  const acao = parametros.get('acao') ?? ''
  function filtrar(chave: 'tabela' | 'acao', valor: string) {
    setParametros(
      (p) => {
        if (valor) p.set(chave, valor)
        else p.delete(chave)
        return p
      },
      { replace: true },
    )
  }
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
  const { data: assuntos } = useQuery({
    queryKey: ['auditoria', 'tabelas'],
    queryFn: listarTabelasAuditoria,
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
          <label htmlFor="auditoria-usuario" className="text-sm font-medium">
            Nº do usuário
          </label>
          <input
            id="auditoria-usuario"
            inputMode="numeric"
            value={filtroUsuario}
            onChange={(e) =>
              setFiltroUsuario(e.target.value.replace(/\D/g, ''))
            }
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="auditoria-assunto" className="text-sm font-medium">
            Assunto
          </label>
          <select
            id="auditoria-assunto"
            value={tabela}
            onChange={(e) => filtrar('tabela', e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {(assuntos ?? []).map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="auditoria-acao" className="text-sm font-medium">
            O que aconteceu
          </label>
          <select
            id="auditoria-acao"
            value={acao}
            onChange={(e) => filtrar('acao', e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Tudo</option>
            {(acoesDisponiveis ?? []).map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="auditoria-desde" className="text-sm font-medium">
            Desde
          </label>
          <input
            id="auditoria-desde"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="auditoria-ate" className="text-sm font-medium">
            Até
          </label>
          <input
            id="auditoria-ate"
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
          tamanhoDePaginaInicial={paginacao.pageSize}
        />
      )}
    </>
  )
}
