import { useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { UserPlus, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { ExportarAssociados } from '@/components/associados/ExportarAssociados'
import { DataTable, type ColunaTabela } from '@/components/data/DataTable'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  listarAssociadosDaPagina,
  resumirAssociados,
  type AssociadoListagem,
} from '@/lib/api'

// v3.0.2 (achado 2026-09-15) - até aqui, /associados só tinha a guarda de permissão (navegação
// e menu funcionando, nenhum conteúdo). Esta é a primeira tela de negócio de verdade do painel
// único: listar quem já está cadastrado e, pra quem ainda não tem login, conceder acesso sem
// sair desta tela.
const colunas: ColunaTabela<AssociadoListagem>[] = [
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
    // cabeçalho de coluna sem texto reprova no axe: o leitor de tela lê "Ações" e quem enxerga não vê nada
    header: () => <span className="sr-only">Ações</span>,
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link to={`/associados/${row.original.id_associado}`}>
          Ver / editar
        </Link>
      </Button>
    ),
  },
]

const POR_PAGINA = 25
const classeCampo =
  'h-9 rounded-md border border-input bg-background px-3 text-sm'

// A lista é paginada e filtrada no servidor (v5.4h): a busca, a situação e a categoria vão na própria consulta e ficam no endereço (dá para mandar o link
// de uma lista filtrada); a tabela mostra uma página de cada vez.
export function AssociadosPage() {
  const [filtros, setFiltros] = useSearchParams()
  const busca = filtros.get('busca') ?? ''
  const situacao = filtros.get('situacao') ?? ''
  const categoria = filtros.get('categoria') ?? ''
  const [paginacao, setPaginacao] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: POR_PAGINA,
  })

  function mudar(novos: Record<string, string>) {
    const proximo = new URLSearchParams(filtros)
    for (const [chave, valor] of Object.entries(novos)) {
      if (valor === '') proximo.delete(chave)
      else proximo.set(chave, valor)
    }
    setFiltros(proximo, { replace: true })
    setPaginacao((p) => ({ ...p, pageIndex: 0 }))
  }

  // o temporizador da busca chama a versão MAIS NOVA de `mudar` (a do último desenho da tela), não a de quando a pessoa começou a digitar: sem isso, escolher
  // um filtro logo depois de digitar na busca perdia o filtro (o endereço voltava ao que era antes do filtro)
  const mudarAtual = useRef(mudar)
  useEffect(() => {
    mudarAtual.current = mudar
  })

  // a busca por texto espera a pessoa parar de digitar antes de ir ao servidor
  const [textoBusca, setTextoBusca] = useState(busca)
  useEffect(() => {
    if (textoBusca === busca) return
    const espera = setTimeout(
      () => mudarAtual.current({ busca: textoBusca }),
      400,
    )
    return () => clearTimeout(espera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoBusca])

  const consulta = {
    busca: busca || undefined,
    situacao: situacao || undefined,
    categoria: categoria || undefined,
  }
  const { data: associados, isLoading } = useQuery({
    queryKey: [
      'associados',
      'pagina',
      busca,
      situacao,
      categoria,
      paginacao.pageIndex,
      paginacao.pageSize,
    ],
    queryFn: () =>
      listarAssociadosDaPagina({
        ...consulta,
        pagina: paginacao.pageIndex + 1,
        por_pagina: paginacao.pageSize,
      }),
    placeholderData: (anterior) => anterior,
  })
  const { data: resumo } = useQuery({
    queryKey: ['associados', 'resumo', busca, situacao, categoria],
    queryFn: () => resumirAssociados(consulta),
    placeholderData: (anterior) => anterior,
  })

  const dados = associados ?? []
  const semFiltro = !busca && !situacao && !categoria
  const total = resumo?.total ?? dados.length

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

      <ExportarAssociados />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <input
          type="search"
          aria-label="Filtrar"
          placeholder="Buscar por nome, CPF, e-mail, telefone ou matrícula"
          value={textoBusca}
          onChange={(e) => setTextoBusca(e.target.value)}
          className={`${classeCampo} w-80 max-w-full`}
        />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            Situação
          </span>
          <select
            value={situacao}
            onChange={(e) => mudar({ situacao: e.target.value })}
            className={classeCampo}
          >
            <option value="">Todas</option>
            {Object.entries(resumo?.por_situacao ?? {}).map(([nome, n]) => (
              <option key={nome} value={nome}>
                {nome} ({n})
              </option>
            ))}
            {situacao && !(situacao in (resumo?.por_situacao ?? {})) && (
              <option value={situacao}>{situacao} (0)</option>
            )}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            Categoria
          </span>
          <select
            value={categoria}
            onChange={(e) => mudar({ categoria: e.target.value })}
            className={classeCampo}
          >
            <option value="">Todas</option>
            {Object.entries(resumo?.por_categoria ?? {}).map(([nome, n]) => (
              <option key={nome} value={nome}>
                {nome} ({n})
              </option>
            ))}
            {categoria && !(categoria in (resumo?.por_categoria ?? {})) && (
              <option value={categoria}>{categoria} (0)</option>
            )}
          </select>
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : total === 0 && semFiltro ? (
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
        <DataTable
          key={`${busca}|${situacao}|${categoria}`}
          dados={dados}
          colunas={colunas}
          filtroGlobal={false}
          manualPagination
          totalRegistros={total}
          pageCount={Math.max(1, Math.ceil(total / paginacao.pageSize))}
          onPaginationChange={setPaginacao}
          tamanhoDePaginaInicial={paginacao.pageSize}
        />
      )}
    </>
  )
}
