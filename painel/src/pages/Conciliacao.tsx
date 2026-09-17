import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  fecharMes,
  importarExtratoConciliacao,
  listarContasFinanceiras,
  listarFechamentosMensais,
  type SugestaoConciliacao,
} from '@/lib/api'
import { fecharMesSchema } from '@/lib/schemas'

// v3.2 (FASE 3 - Financeiro) - conciliação bancária MANUAL a partir de extrato (OFX/CSV): a
// ASAF não tem orçamento pra API paga de PSP/banco, então a tesouraria baixa o extrato do
// próprio internet banking e sobe aqui. O sistema só SUGERE correspondência por valor+data -
// a baixa em si continua sempre em Financeiro › Títulos, confirmada por um humano.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function competenciaAtual(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

// v3.7 (FASE 3) - fechamento mensal com conciliação obrigatória: o backend recusa (400) fechar o
// mês se o saldo do sistema não bater com o saldo do extrato informado - divergência aberta
// bloqueia sempre, nunca existe "forçar fechamento mesmo assim".
function SecaoFechamentoMensal() {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })
  const { data: fechamentos } = useQuery({
    queryKey: ['fechamentos-mensais'],
    queryFn: () => listarFechamentosMensais(),
  })

  const fechar = useMutation({
    mutationFn: (v: z.infer<typeof fecharMesSchema>) => fecharMes(v),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['fechamentos-mensais'] }),
  })

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-2 font-semibold">Fechamento mensal</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Informe o saldo do extrato bancário do mês - se não bater com o saldo
        calculado pelo sistema, o fechamento é recusado.
      </p>
      <FormShell<z.infer<typeof fecharMesSchema>>
        schema={fecharMesSchema}
        defaultValues={{
          competencia: competenciaAtual(),
          id_conta_financeira: 0,
          saldo_extrato_bancario: 0,
        }}
        onSubmit={(v) => fechar.mutateAsync(v)}
        className="mb-4 grid gap-2 sm:grid-cols-4"
      >
        {(form) => (
          <>
            <div>
              <input
                {...form.register('competencia')}
                placeholder="AAAA-MM"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.competencia?.message}
              />
            </div>
            <div>
              <select
                {...form.register('id_conta_financeira')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Conta financeira…</option>
                {(contas ?? []).map((c) => (
                  <option
                    key={c.id_conta_financeira}
                    value={c.id_conta_financeira}
                  >
                    {c.codigo_contabil} — {c.descricao_conta}
                  </option>
                ))}
              </select>
              <ErroCampo
                mensagem={form.formState.errors.id_conta_financeira?.message}
              />
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                {...form.register('saldo_extrato_bancario')}
                placeholder="Saldo do extrato (R$)"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit" size="sm" disabled={fechar.isPending}>
              {fechar.isPending ? 'Fechando…' : 'Fechar mês'}
            </Button>
            {fechar.isError && (
              <p className="text-sm text-destructive sm:col-span-4">
                {(fechar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-2">
        {(fechamentos ?? []).map((f) => (
          <div
            key={f.id_fechamento}
            className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
          >
            <span>
              {f.competencia} — conta financeira #{f.id_conta_financeira}
            </span>
            <span className="text-green-600">
              conferido, divergência {formatarReais(f.divergencia)}
            </span>
          </div>
        ))}
        {(fechamentos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum mês fechado ainda.
          </p>
        )}
      </div>
    </section>
  )
}

export function ConciliacaoPage() {
  const [transacoes, setTransacoes] = useState<SugestaoConciliacao[] | null>(
    null,
  )

  const importar = useMutation({
    mutationFn: (arquivo: File) => importarExtratoConciliacao(arquivo),
    onSuccess: (resultado) => setTransacoes(resultado.transacoes),
  })

  return (
    <>
      <PageHeader
        titulo="Conciliação Bancária"
        descricao="Importe um extrato (.ofx ou .csv) e veja sugestões de correspondência com títulos em aberto — a baixa é sempre confirmada manualmente em Títulos."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Conciliação' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4">
          <input
            type="file"
            accept=".ofx,.csv,.txt"
            disabled={importar.isPending}
            onChange={(e) => {
              const arquivo = e.target.files?.[0]
              if (arquivo) importar.mutate(arquivo)
            }}
            className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          {importar.isPending && (
            <p className="mt-1 text-xs text-muted-foreground">Processando…</p>
          )}
          {importar.isError && (
            <p className="mt-1 text-sm text-destructive">
              {(importar.error as Error).message}
            </p>
          )}
        </div>

        {transacoes && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {transacoes.length} transação(ões) encontrada(s) no extrato.
            </p>
            {transacoes.map((t) => (
              <div
                key={t.identificador}
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {t.data} — {t.descricao || 'sem descrição'}
                  </p>
                  <p className="font-medium">{formatarReais(t.valor)}</p>
                </div>
                {t.sugestoes.length > 0 ? (
                  <ul className="mt-1 text-muted-foreground">
                    {t.sugestoes.map((s) => (
                      <li key={s.id_titulo}>
                        Sugestão: título #{s.id_titulo} — {s.descricao} (
                        {s.tipo_titulo}, saldo {formatarReais(s.saldo_devedor)})
                        — dê baixa em Financeiro › Títulos.
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nenhum título em aberto corresponde a este valor/data.
                  </p>
                )}
              </div>
            ))}
            {transacoes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma transação no arquivo.
              </p>
            )}
          </div>
        )}
      </section>

      <SecaoFechamentoMensal />
    </>
  )
}
