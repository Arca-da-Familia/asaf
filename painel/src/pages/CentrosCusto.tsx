import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  alternarCentroCusto,
  alternarSaldoRestrito,
  criarCentroCusto,
  listarCentrosCusto,
  listarRemanejamentosDestinacao,
  obterSaldoRestrito,
  registrarRemanejamentoDestinacao,
} from '@/lib/api'
import {
  centroDeCustoCriarSchema,
  remanejamentoDestinacaoCriarSchema,
} from '@/lib/schemas'

function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// v3.1 (FASE 3 - Financeiro) - Centros de Custo: "quanto custou o projeto X" sem planilha
// paralela. Vínculo com a partida contábil é opcional (nem todo lançamento pertence a um
// centro de custo específico) - feito na baixa de título/transferência, não aqui.
function FormularioCentroCusto({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const criar = useMutation({
    mutationFn: (v: z.infer<typeof centroDeCustoCriarSchema>) =>
      criarCentroCusto(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['centros-custo'] })
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
          {criar.isError && (
            <p className="text-sm text-destructive sm:col-span-3">
              {(criar.error as Error).message}
            </p>
          )}
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
          {criar.isError && (
            <p className="text-sm text-destructive sm:col-span-2">
              {(criar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

export function CentrosCustoPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [mostrarRemanejamento, setMostrarRemanejamento] = useState(false)
  const queryClient = useQueryClient()
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })
  const { data: remanejamentos } = useQuery({
    queryKey: ['remanejamentos-destinacao'],
    queryFn: listarRemanejamentosDestinacao,
  })

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
          <FormularioCentroCusto onCancelar={() => setMostrarForm(false)} />
        )}

        <div className="space-y-2">
          {(centros ?? []).map((c) => (
            <div
              key={c.id_centro_custo}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {c.codigo} — {c.nome}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.ativo ? 'Ativo' : 'Inativo'}
                  {c.saldo_restrito && ' · destinação restrita'}
                </p>
                {c.saldo_restrito && (
                  <SaldoRestrito idCentroCusto={c.id_centro_custo} />
                )}
              </div>
              <div className="flex gap-2">
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
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Remanejamento de destinação</h2>
            <p className="text-sm text-muted-foreground">
              Realoca formalmente saldo restrito entre destinações — o único
              jeito de usar doação com finalidade específica em outra
              finalidade.
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

        <div className="space-y-2">
          {(remanejamentos ?? []).map((r) => (
            <div
              key={r.id_remanejamento}
              className="rounded-md border border-border p-3 text-sm"
            >
              <p className="font-medium">
                {formatarReais(r.valor)} — Centro #{r.id_centro_custo_origem} →
                Centro #{r.id_centro_custo_destino}
              </p>
              <p className="text-muted-foreground">
                {r.motivo} · {r.data_remanejamento}
              </p>
            </div>
          ))}
          {(remanejamentos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum remanejamento registrado.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
