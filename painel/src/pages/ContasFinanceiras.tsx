import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  criarContaFinanceira,
  listarContasFinanceiras,
  listarOpcoesCatalogo,
  listarPlanoContas,
} from '@/lib/api'
import { contaFinanceiraCriarSchema } from '@/lib/schemas'

// v3.1 (FASE 3 - Financeiro) - Contas Financeiras: especialização de PlanoDeContas tipo Ativo
// (Caixa/Banco). Saldo é SEMPRE calculado pelo backend somando as partidas daquela conta (nunca
// um campo editável aqui) - ver app/services/contabilidade.py::saldo_conta.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioContaFinanceira({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: tipos } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_conta_financeira'],
    queryFn: () => listarOpcoesCatalogo('tipo_conta_financeira'),
  })
  // só conta Ativo e analítica (sem filha) pode virar Conta Financeira - o backend recusa o
  // resto, mas já filtramos aqui pra não deixar escolher o que vai falhar.
  const contasElegiveis = (contas ?? []).filter(
    (c) => c.tipo === 'Ativo' && !c.sintetica,
  )

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof contaFinanceiraCriarSchema>) =>
      criarContaFinanceira(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas-financeiras'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof contaFinanceiraCriarSchema>>
      schema={contaFinanceiraCriarSchema}
      defaultValues={{
        id_conta: 0,
        tipo_conta_financeira: '',
        banco: '',
        agencia: '',
        numero_conta: '',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <select
              {...form.register('id_conta')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta contábil (Ativo)…</option>
              {contasElegiveis.map((c) => (
                <option key={c.id_conta} value={c.id_conta}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.id_conta?.message} />
          </div>
          <div>
            <select
              {...form.register('tipo_conta_financeira')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecione o tipo…</option>
              {(tipos ?? []).map((t) => (
                <option key={t.id_opcao} value={t.rotulo}>
                  {t.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.tipo_conta_financeira?.message}
            />
          </div>
          <div>
            <input
              {...form.register('banco')}
              placeholder="Banco (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              {...form.register('agencia')}
              placeholder="Agência (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              {...form.register('numero_conta')}
              placeholder="Número da conta (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex gap-2 sm:col-span-3">
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

export function ContasFinanceirasPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const { data: contasFinanceiras } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })

  return (
    <>
      <PageHeader
        titulo="Contas Financeiras"
        descricao="Caixa, contas correntes e aplicações — saldo sempre calculado pela soma dos lançamentos."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Contas Financeiras' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Contas cadastradas</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Nova conta financeira'}
          </Button>
        </div>

        {mostrarForm && (
          <FormularioContaFinanceira onCancelar={() => setMostrarForm(false)} />
        )}

        <div className="space-y-2">
          {(contasFinanceiras ?? []).map((cf) => (
            <div
              key={cf.id_conta_financeira}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {cf.codigo_contabil} — {cf.descricao_conta}
                </p>
                <p className="text-xs text-muted-foreground">
                  {cf.tipo_conta_financeira}
                  {cf.banco && ` · ${cf.banco}`}
                  {cf.agencia && ` · Ag. ${cf.agencia}`}
                  {cf.numero_conta && ` · Conta ${cf.numero_conta}`}
                </p>
              </div>
              <p className="font-medium">{formatarReais(cf.saldo)}</p>
            </div>
          ))}
          {(contasFinanceiras ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta financeira cadastrada.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
