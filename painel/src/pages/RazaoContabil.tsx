import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  criarTransferencia,
  estornarLancamento,
  listarContasFinanceiras,
  listarLivroCaixa,
  urlArquivo,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { estornoCriarSchema, transferenciaCriarSchema } from '@/lib/schemas'

// v2.5.10 (FASE 2.5 - Painel) - Razão Contábil: extrato de lançamentos em partida dobrada e
// estorno com motivo (backend v3.0, só faltava a tela - fecha o módulo Financeiro). Lançamento é
// IMUTÁVEL por decisão do próprio backend (ver comentário em app/routers/financeiro.py): não
// existe editar/apagar, só estornar (motivo obrigatório) - o original nunca some da lista, só
// fica marcado "Estornado". `valor` das partidas chega em reais (mesmo formato confirmado em
// Conselho Fiscal/Títulos), nunca centavos.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioEstorno({
  idLancamento,
  onCancelar,
}: {
  idLancamento: number
  onCancelar: () => void
}) {
  const queryClient = useQueryClient()
  const estornar = useMutation({
    mutationFn: (v: z.infer<typeof estornoCriarSchema>) =>
      estornarLancamento(idLancamento, v.motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['livro-caixa'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof estornoCriarSchema>>
      schema={estornoCriarSchema}
      defaultValues={{ motivo: '' }}
      onSubmit={(v) => estornar.mutateAsync(v)}
      className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-3"
    >
      {(form) => (
        <>
          <textarea
            {...form.register('motivo')}
            placeholder="Motivo do estorno"
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <ErroCampo mensagem={form.formState.errors.motivo?.message} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={estornar.isPending}>
              {estornar.isPending ? 'Estornando…' : 'Confirmar estorno'}
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
          {estornar.isError && (
            <p className="text-sm text-destructive">
              {(estornar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

// v3.1 - transferência entre Contas Financeiras como operação própria (débito no destino,
// crédito na origem), nunca duas entradas soltas montadas na mão - ver
// app/routers/financeiro.py::criar_transferencia.
function FormularioTransferencia({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: contasFinanceiras } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })

  const transferir = useMutation({
    mutationFn: (v: z.infer<typeof transferenciaCriarSchema>) =>
      criarTransferencia(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['livro-caixa'] })
      queryClient.invalidateQueries({ queryKey: ['contas-financeiras'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof transferenciaCriarSchema>>
      schema={transferenciaCriarSchema}
      defaultValues={{
        id_conta_financeira_origem: 0,
        id_conta_financeira_destino: 0,
        valor: 0,
        historico: '',
      }}
      onSubmit={(v) => transferir.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-4"
    >
      {(form) => (
        <>
          <div>
            <select
              {...form.register('id_conta_financeira_origem')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta de origem…</option>
              {(contasFinanceiras ?? []).map((cf) => (
                <option key={cf.id_conta_financeira} value={cf.id_conta_financeira}>
                  {cf.codigo_contabil} — {cf.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_conta_financeira_origem?.message}
            />
          </div>
          <div>
            <select
              {...form.register('id_conta_financeira_destino')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta de destino…</option>
              {(contasFinanceiras ?? []).map((cf) => (
                <option key={cf.id_conta_financeira} value={cf.id_conta_financeira}>
                  {cf.codigo_contabil} — {cf.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_conta_financeira_destino?.message}
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
          <div>
            <input
              {...form.register('historico')}
              placeholder="Histórico"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.historico?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-4">
            <Button type="submit" size="sm" disabled={transferir.isPending}>
              {transferir.isPending ? 'Transferindo…' : 'Confirmar transferência'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
          {transferir.isError && (
            <p className="text-sm text-destructive sm:col-span-4">
              {(transferir.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

export function RazaoContabilPage() {
  const [estornando, setEstornando] = useState<number | null>(null)
  const [transferindo, setTransferindo] = useState(false)
  const { data } = useQuery({
    queryKey: ['livro-caixa'],
    queryFn: listarLivroCaixa,
  })

  return (
    <>
      <PageHeader
        titulo="Razão Contábil"
        descricao="Extrato de lançamentos em partida dobrada. Correção é sempre estorno motivado, nunca edição."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Razão Contábil' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Lançamentos</h2>
          <div className="flex items-center gap-3">
            {data && (
              <p className="text-sm text-muted-foreground">
                Saldo em caixa (contas Ativo):{' '}
                <span className="font-medium text-foreground">
                  {formatarReais(data.saldo_contas_ativo)}
                </span>
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTransferindo((v) => !v)}
            >
              {transferindo ? 'Cancelar' : 'Nova transferência'}
            </Button>
          </div>
        </div>

        {transferindo && (
          <FormularioTransferencia onCancelar={() => setTransferindo(false)} />
        )}

        <div className="space-y-2">
          {(data?.lancamentos ?? []).map((l) => (
            <div
              key={l.id_lancamento}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  #{l.numero_sequencial} — {l.historico}
                </p>
                {l.estornado ? (
                  <span className="text-destructive">Estornado</span>
                ) : (
                  <span className="text-muted-foreground">Normal</span>
                )}
              </div>
              <p className="text-muted-foreground">
                {l.data ? formatarData(l.data) : '—'} · {l.tipo_origem}
                {l.forma_pagamento && ` · ${l.forma_pagamento}`}
                {l.data_competencia &&
                  l.data_competencia !== l.data &&
                  ` · Competência: ${formatarData(l.data_competencia)}`}
              </p>
              <p className="text-muted-foreground">
                {l.partidas
                  .map(
                    (p) =>
                      `${p.tipo_partida} ${p.conta_contabil} ${formatarReais(p.valor)}`,
                  )
                  .join(' · ')}
              </p>
              {l.comprovante && (
                <a
                  href={urlArquivo(l.comprovante)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  Ver comprovante
                </a>
              )}
              {l.estornado && l.motivo_estorno && (
                <p className="text-xs text-muted-foreground">
                  Motivo do estorno: {l.motivo_estorno}
                  {l.id_lancamento_estorno &&
                    ` (lançamento #${l.id_lancamento_estorno})`}
                </p>
              )}
              {!l.estornado && (
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEstornando((v) =>
                        v === l.id_lancamento ? null : l.id_lancamento,
                      )
                    }
                  >
                    {estornando === l.id_lancamento
                      ? 'Cancelar estorno'
                      : 'Estornar'}
                  </Button>
                  {estornando === l.id_lancamento && (
                    <FormularioEstorno
                      idLancamento={l.id_lancamento}
                      onCancelar={() => setEstornando(null)}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          {(data?.lancamentos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum lançamento registrado ainda.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
