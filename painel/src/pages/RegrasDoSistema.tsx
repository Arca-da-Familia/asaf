import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  editarRegraDoSistema,
  listarConfiguracoes,
  type RegraDoSistema,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { Paginador } from '@/components/data/Paginador'
import { porPaginaNaTela } from '@/lib/celular'
import { usePaginaLocal } from '@/lib/pagina-local'

function RegraLinha({ regra }: { regra: RegraDoSistema }) {
  const queryClient = useQueryClient()
  const [valor, setValor] = useState(regra.valor)
  const [salvo, setSalvo] = useState(false)

  const salvar = useMutation({
    mutationFn: () => editarRegraDoSistema(regra.chave, valor),
    onSuccess: () => {
      setSalvo(true)
      queryClient.invalidateQueries({ queryKey: ['regras-do-sistema'] })
    },
    onError: () => setSalvo(false),
  })

  const id = `regra-${regra.chave}`
  const numerica = regra.tipo === 'numero'
  const mudou = valor !== regra.valor
  const classe =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <li
      aria-label={regra.descricao ?? regra.chave}
      data-chave={regra.chave}
      className="rounded-md border border-border p-3"
    >
      <label htmlFor={id} className="mb-2 block text-sm font-medium">
        {regra.descricao ?? regra.chave}
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <input
          id={id}
          type={numerica ? 'number' : 'text'}
          inputMode={numerica ? 'decimal' : undefined}
          value={valor}
          onChange={(e) => {
            setValor(e.target.value)
            setSalvo(false)
          }}
          className={`${classe} h-9 ${numerica ? 'w-40' : 'flex-1'}`}
        />
        <Button
          size="sm"
          disabled={!mudou || salvar.isPending}
          onClick={() => salvar.mutate()}
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
      {salvar.isError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {(salvar.error as Error).message}
        </p>
      )}
      {salvo && !salvar.isError && (
        <p
          role="status"
          className="mt-1 text-xs text-green-700 dark:text-green-400"
        >
          Salvo.
        </p>
      )}
      {regra.atualizado_em && (
        <p className="mt-1 text-xs text-muted-foreground">
          Última alteração em{' '}
          {formatarData(regra.atualizado_em, { comHora: true })}
        </p>
      )}
    </li>
  )
}

// Regras do sistema: os limites e prazos que o sistema usa (quantos dias vale um lembrete, a partir de quanto um lançamento tardio vira alerta, o horário do
// expediente...). Cada um tem um valor padrão de fábrica; a presidência ajusta aqui, e cada mudança fica na Auditoria (valor antes e depois).
export function RegrasDoSistemaPage() {
  const { data: regras, isLoading } = useQuery({
    queryKey: ['regras-do-sistema'],
    queryFn: listarConfiguracoes,
    select: (todas) => todas.filter((c) => c.categoria === 'regras'),
  })
  // v9.3b (pedido do Presidente, 05/11: telas compridas): procurar pelo nome ou pelo código, e duas colunas no computador (eram 12 alturas de tela)
  const [busca, setBusca] = useState('')
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const visiveis = (regras ?? []).filter(
    (r) =>
      !termo ||
      `${r.descricao ?? ''} ${r.chave}`
        .toLocaleLowerCase('pt-BR')
        .includes(termo),
  )
  // v9.3z2 (no celular a tela tinha 12,5 alturas): 10 por página só no celular; no computador, todas (em duas colunas)
  const pagina = usePaginaLocal(
    visiveis,
    porPaginaNaTela(Number.MAX_SAFE_INTEGER),
    termo,
  )

  return (
    <>
      <PageHeader
        titulo="Regras do sistema"
        descricao="Os limites e prazos que o sistema usa. Cada mudança vale na hora e fica na Auditoria."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Regras do sistema' },
        ]}
      />
      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {!isLoading && (regras ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma regra ajustável encontrada.
        </p>
      )}
      {(regras ?? []).length > 0 && (
        <div className="mb-4 max-w-md">
          <label htmlFor="procurar-regra" className="text-sm font-medium">
            Procurar regra
          </label>
          <input
            id="procurar-regra"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Ex.: prazo, estorno, cotação"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          {termo && (
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              {visiveis.length} de {(regras ?? []).length} regras.
            </p>
          )}
        </div>
      )}
      <ul
        className="grid items-start gap-3 lg:grid-cols-2"
        aria-label="Regras ajustáveis"
      >
        {pagina.daPagina.map((regra) => (
          <RegraLinha key={regra.chave} regra={regra} />
        ))}
      </ul>
      <Paginador
        pagina={pagina.pagina}
        porPagina={pagina.porPagina}
        total={pagina.total}
        aoMudar={pagina.setPagina}
        rotulo="Páginas das regras"
      />
    </>
  )
}
