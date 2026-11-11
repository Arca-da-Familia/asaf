import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { z } from 'zod'

import { Paginador } from '@/components/data/Paginador'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Abas } from '@/components/ui/abas'
import { Button } from '@/components/ui/button'
import {
  alternarCentroCusto,
  alternarSaldoRestrito,
  criarCentroCusto,
  listarCentrosCusto,
  listarEventos,
  listarProjetos,
  listarRemanejamentosDestinacao,
  obterSaldoRestrito,
  registrarRemanejamentoDestinacao,
  type CentroDeCusto,
} from '@/lib/api'
import { formatarDia } from '@/lib/datas'
import { usePaginaLocal } from '@/lib/pagina-local'
import {
  centroDeCustoCriarSchema,
  remanejamentoDestinacaoCriarSchema,
} from '@/lib/schemas'
import { simplificar } from '@/lib/texto'

function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// v3.1 (FASE 3 - Financeiro) - Centros de Custo: "quanto custou o projeto X" sem planilha
// paralela. Vínculo com a partida contábil é opcional (nem todo lançamento pertence a um
// centro de custo específico) - feito na baixa de título/transferência, não aqui.
function FormularioCentroCusto({
  onCancelar,
  aoCriar,
}: {
  onCancelar: () => void
  aoCriar?: (idCentroCusto: number, codigo: string, nome: string) => void
}) {
  const queryClient = useQueryClient()
  const { data: projetos } = useQuery({
    queryKey: ['projetos'],
    queryFn: listarProjetos,
  })
  const { data: eventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: listarEventos,
  })
  const criar = useMutation({
    mutationFn: (v: z.infer<typeof centroDeCustoCriarSchema>) =>
      criarCentroCusto(v),
    onSuccess: async (criado, v) => {
      await queryClient.invalidateQueries({ queryKey: ['centros-custo'] })
      aoCriar?.(criado.id_centro_custo, v.codigo, v.nome)
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof centroDeCustoCriarSchema>>
      schema={centroDeCustoCriarSchema}
      defaultValues={{ codigo: '', nome: '' }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <input
              {...form.register('codigo')}
              placeholder="Código"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.codigo?.message} />
          </div>
          <div>
            <input
              {...form.register('nome')}
              placeholder="Nome"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.nome?.message} />
          </div>
          <div>
            {/* v4.9 - vínculo opcional com projeto OU evento (o backend não impede os dois ao
                mesmo tempo, mas um centro de custo normalmente pertence a um só - por isso não há
                trava de exclusividade aqui, só a convenção de preencher um por vez). */}
            <select
              {...form.register('id_projeto', {
                setValueAs: (v) => (v === '' ? undefined : Number(v)),
              })}
              title="Vincula este centro de custo a um projeto (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem projeto vinculado</option>
              {(projetos ?? []).map((p) => (
                <option key={p.id_projeto} value={p.id_projeto}>
                  {p.nome_projeto}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              {...form.register('id_evento', {
                setValueAs: (v) => (v === '' ? undefined : Number(v)),
              })}
              title="Vincula este centro de custo a um evento (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem evento vinculado</option>
              {(eventos ?? []).map((e) => (
                <option key={e.id_evento} value={e.id_evento}>
                  {e.titulo}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelar}
            >
              Cancelar
            </Button>
          </div>
        </>
      )}
    </FormShell>
  )
}

// v3.4 - saldo restrito: doações com destinação específica (ver Doações) só podem ser gastas
// neste centro de custo - o número aqui é o que realmente bloqueia (ou não) a aprovação de uma
// compra contra ele (v3.3).
function SaldoRestrito({ idCentroCusto }: { idCentroCusto: number }) {
  const { data } = useQuery({
    queryKey: ['saldo-restrito', idCentroCusto],
    queryFn: () => obterSaldoRestrito(idCentroCusto),
  })
  if (!data) return null
  return (
    <p className="text-xs text-muted-foreground">
      Saldo restrito disponível: {formatarReais(data.saldo_disponivel)}
    </p>
  )
}

function FormularioRemanejamento({
  centros,
  onCancelar,
}: {
  centros: { id_centro_custo: number; nome: string }[]
  onCancelar: () => void
}) {
  const queryClient = useQueryClient()
  const criar = useMutation({
    mutationFn: (v: z.infer<typeof remanejamentoDestinacaoCriarSchema>) =>
      registrarRemanejamentoDestinacao(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remanejamentos-destinacao'] })
      queryClient.invalidateQueries({ queryKey: ['saldo-restrito'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof remanejamentoDestinacaoCriarSchema>>
      schema={remanejamentoDestinacaoCriarSchema}
      defaultValues={{
        id_centro_custo_origem: 0,
        id_centro_custo_destino: 0,
        valor: 0,
        motivo: '',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div>
            <select
              {...form.register('id_centro_custo_origem')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Origem (de onde sai)…</option>
              {centros.map((c) => (
                <option key={c.id_centro_custo} value={c.id_centro_custo}>
                  {c.nome}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_centro_custo_origem?.message}
            />
          </div>
          <div>
            <select
              {...form.register('id_centro_custo_destino')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Destino (pra onde vai)…</option>
              {centros.map((c) => (
                <option key={c.id_centro_custo} value={c.id_centro_custo}>
                  {c.nome}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_centro_custo_destino?.message}
            />
          </div>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('valor')}
              placeholder="Valor"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.valor?.message} />
          </div>
          <div className="sm:col-span-2">
            <input
              {...form.register('motivo')}
              placeholder="Motivo (ex.: decisão da diretoria em ata de...)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.motivo?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Registrar remanejamento'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelar}
            >
              Cancelar
            </Button>
          </div>
        </>
      )}
    </FormShell>
  )
}

const POR_PAGINA = 10

// v9.3w: o vínculo do centro pelo NOME (a tela dizia "Projeto #12", "Evento #5"); sem o nome (API anterior), o número por extenso
function vinculoDoCentro(c: CentroDeCusto): string {
  if (c.id_projeto != null)
    return ` · Projeto: ${c.nome_projeto ?? `nº ${c.id_projeto}`}`
  if (c.id_evento != null)
    return ` · Evento: ${c.titulo_evento ?? `nº ${c.id_evento}`}`
  return ''
}

export function CentrosCustoPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [mostrarRemanejamento, setMostrarRemanejamento] = useState(false)
  const queryClient = useQueryClient()
  // os dois carregam ao abrir a tela (mesmo com só uma aba aparecendo): o remanejamento precisa da lista de centros
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })
  const { data: remanejamentos } = useQuery({
    queryKey: ['remanejamentos-destinacao'],
    queryFn: listarRemanejamentosDestinacao,
  })

  // v9.3w (a tela tinha 8,9 alturas de notebook na homologação): os centros e os remanejamentos em abas (?parte=remanejamentos); os centros com
  // busca (código ou nome, sem acento) e páginas de 10; os remanejamentos (o mais recente primeiro) em páginas de 10
  const [parametros, setParametros] = useSearchParams()
  const parte =
    parametros.get('parte') === 'remanejamentos' ? 'remanejamentos' : 'centros'
  function irParaParte(chave: string) {
    setParametros(
      (atual) => {
        const novo = new URLSearchParams(atual)
        if (chave === 'remanejamentos') novo.set('parte', 'remanejamentos')
        else novo.delete('parte')
        return novo
      },
      { replace: true },
    )
  }
  const [busca, setBusca] = useState('')
  const termo = simplificar(busca.trim())
  const encontrados = termo
    ? (centros ?? []).filter(
        (c) =>
          simplificar(c.codigo).includes(termo) ||
          simplificar(c.nome).includes(termo),
      )
    : centros
  const pagina = usePaginaLocal(encontrados, POR_PAGINA, termo)
  // o centro recém-cadastrado: a lista (por código) vai à página dele
  const [mostrar, setMostrar] = useState<number | null>(null)
  if (mostrar !== null && encontrados) {
    const posicao = encontrados.findIndex((c) => c.id_centro_custo === mostrar)
    if (posicao >= 0) {
      setMostrar(null)
      pagina.setPagina(Math.floor(posicao / POR_PAGINA) + 1)
    }
  }
  const paginaRemanejamentos = usePaginaLocal(remanejamentos, POR_PAGINA)
  const nomeDoCentro = (id: number) => {
    const c = (centros ?? []).find((x) => x.id_centro_custo === id)
    return c ? `${c.codigo} — ${c.nome}` : `centro nº ${id}`
  }

  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      alternarCentroCusto(id, ativo),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['centros-custo'] }),
  })
  const alternarRestrito = useMutation({
    mutationFn: ({
      id,
      saldoRestrito,
    }: {
      id: number
      saldoRestrito: boolean
    }) => alternarSaldoRestrito(id, saldoRestrito),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['centros-custo'] }),
  })

  const parteCentros = (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Centros cadastrados</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Novo centro de custo'}
        </Button>
      </div>

      {mostrarForm && (
        <FormularioCentroCusto
          onCancelar={() => setMostrarForm(false)}
          aoCriar={(id, codigo, nome) => {
            // se a busca em curso acha o centro novo, ela fica; senão, sai (e a lista vai à página dele)
            if (
              termo &&
              !simplificar(codigo).includes(termo) &&
              !simplificar(nome).includes(termo)
            )
              setBusca('')
            setMostrar(id)
          }}
        />
      )}

      {(centros ?? []).length > POR_PAGINA && (
        <div className="mb-3 max-w-md">
          <label htmlFor="procurar-centro" className="text-sm font-medium">
            Procurar centro de custo
          </label>
          <input
            id="procurar-centro"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Código ou nome"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          {termo && (
            <p
              aria-live="polite"
              className="mt-1 text-xs text-muted-foreground"
            >
              {pagina.total}{' '}
              {pagina.total === 1 ? 'centro encontrado' : 'centros encontrados'}
              .
            </p>
          )}
        </div>
      )}

      <div className="grid items-start gap-2 lg:grid-cols-2">
        {pagina.daPagina.map((c) => (
          <div
            key={c.id_centro_custo}
            className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {c.codigo} — {c.nome}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.ativo ? 'Ativo' : 'Inativo'}
                {c.saldo_restrito && ' · destinação restrita'}
                {vinculoDoCentro(c)}
              </p>
              {c.saldo_restrito && (
                <SaldoRestrito idCentroCusto={c.id_centro_custo} />
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={alternarRestrito.isPending}
                onClick={() =>
                  alternarRestrito.mutate({
                    id: c.id_centro_custo,
                    saldoRestrito: !c.saldo_restrito,
                  })
                }
              >
                {c.saldo_restrito
                  ? 'Remover destinação restrita'
                  : 'Marcar como destinação restrita'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  alternar.mutate({ id: c.id_centro_custo, ativo: !c.ativo })
                }
              >
                {c.ativo ? 'Inativar' : 'Ativar'}
              </Button>
            </div>
          </div>
        ))}
        {(centros ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum centro de custo cadastrado.
          </p>
        )}
        {termo && pagina.total === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum centro com esse código ou nome.
          </p>
        )}
      </div>
      <Paginador
        pagina={pagina.pagina}
        porPagina={pagina.porPagina}
        total={pagina.total}
        aoMudar={pagina.setPagina}
        rotulo="Páginas dos centros de custo"
      />
    </section>
  )

  const parteRemanejamentos = (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Remanejamento de destinação</h2>
          <p className="text-sm text-muted-foreground">
            Realoca formalmente saldo restrito entre destinações — o único jeito
            de usar doação com finalidade específica em outra finalidade.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarRemanejamento((v) => !v)}
        >
          {mostrarRemanejamento ? 'Cancelar' : 'Novo remanejamento'}
        </Button>
      </div>

      {mostrarRemanejamento && (
        <FormularioRemanejamento
          centros={centros ?? []}
          onCancelar={() => setMostrarRemanejamento(false)}
        />
      )}

      <div className="grid items-start gap-2 lg:grid-cols-2">
        {paginaRemanejamentos.daPagina.map((r) => (
          <div
            key={r.id_remanejamento}
            className="rounded-md border border-border p-3 text-sm"
          >
            <p className="font-medium">
              {formatarReais(r.valor)} — de{' '}
              {nomeDoCentro(r.id_centro_custo_origem)} para{' '}
              {nomeDoCentro(r.id_centro_custo_destino)}
            </p>
            <p className="text-muted-foreground">
              {r.motivo} · {formatarDia(r.data_remanejamento)}
            </p>
          </div>
        ))}
        {(remanejamentos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum remanejamento registrado.
          </p>
        )}
      </div>
      <Paginador
        pagina={paginaRemanejamentos.pagina}
        porPagina={paginaRemanejamentos.porPagina}
        total={paginaRemanejamentos.total}
        aoMudar={paginaRemanejamentos.setPagina}
        rotulo="Páginas dos remanejamentos"
      />
    </section>
  )

  return (
    <>
      <PageHeader
        titulo="Centros de Custo"
        descricao="Agrupam lançamentos por projeto/área — vínculo opcional na baixa de título ou transferência."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Centros de Custo' },
        ]}
      />
      <Abas
        rotulo="Partes de Centros de Custo"
        atual={parte}
        aoMudar={irParaParte}
        abas={[
          {
            chave: 'centros',
            rotulo: 'Centros de custo',
            conteudo: parteCentros,
          },
          {
            chave: 'remanejamentos',
            rotulo: 'Remanejamentos de destinação',
            conteudo: parteRemanejamentos,
          },
        ]}
      />
    </>
  )
}
