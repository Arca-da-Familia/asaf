import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  criarOrcamento,
  criarReservaContingencia,
  listarCentrosCusto,
  listarContasFinanceiras,
  listarDeliberacoesConcluidas,
  listarOrcamentos,
  listarPlanoContas,
  listarReservasContingencia,
  obterFluxoDeCaixa,
} from '@/lib/api'
import { orcamentoCriarSchema, reservaContingenciaCriarSchema } from '@/lib/schemas'

// v3.5 (FASE 3 - Financeiro) - orçamento anual (realizado x previsto calculado contra o razão
// contábil, nunca guardado em coluna própria - ver app/services/orcamento.py::realizado_do_orcamento),
// fluxo de caixa projetado (cobranças a receber + contas a pagar + recorrentes ainda não geradas,
// horizonte configurável via HORIZONTE_FLUXO_CAIXA_MESES) e reserva de contingência (uma Conta
// Financeira marcada, com regra de uso registrada por escrito).
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioOrcamento({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })
  const { data: deliberacoes } = useQuery({
    queryKey: ['deliberacoes-concluidas'],
    queryFn: listarDeliberacoesConcluidas,
  })
  const contasAnaliticas = (contas ?? []).filter((c) => !c.sintetica)

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof orcamentoCriarSchema>) => criarOrcamento(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orcamentos'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof orcamentoCriarSchema>>
      schema={orcamentoCriarSchema}
      defaultValues={{
        ano: new Date().getFullYear(),
        id_conta_contabil: 0,
        valor_previsto: 0,
        id_deliberacao: 0,
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div>
            <input
              type="number"
              {...form.register('ano')}
              placeholder="Ano"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.ano?.message} />
          </div>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('valor_previsto')}
              placeholder="Valor previsto (R$)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.valor_previsto?.message} />
          </div>
          <div>
            <select
              {...form.register('id_conta_contabil')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta contábil…</option>
              {contasAnaliticas.map((c) => (
                <option key={c.id_conta} value={c.id_conta}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.id_conta_contabil?.message} />
          </div>
          <div>
            <select
              {...form.register('id_centro_custo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem centro de custo específico</option>
              {(centros ?? []).map((c) => (
                <option key={c.id_centro_custo} value={c.id_centro_custo}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <select
              {...form.register('id_deliberacao')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Deliberação de assembleia que aprovou este orçamento…</option>
              {(deliberacoes ?? []).map((d) => (
                <option key={d.id_deliberacao} value={d.id_deliberacao}>
                  #{d.id_deliberacao} — {d.texto.slice(0, 80)}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.id_deliberacao?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar orçamento'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancelar}>
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

function SecaoOrcamentos() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const anoAtual = new Date().getFullYear()
  const { data: orcamentos } = useQuery({
    queryKey: ['orcamentos', anoAtual],
    queryFn: () => listarOrcamentos(anoAtual),
  })
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Orçamento {anoAtual}</h2>
        <Button variant="outline" size="sm" onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? 'Cancelar' : 'Novo orçamento'}
        </Button>
      </div>
      {mostrarForm && <FormularioOrcamento onCancelar={() => setMostrarForm(false)} />}
      <div className="space-y-2">
        {(orcamentos ?? []).map((o) => {
          const conta = (contas ?? []).find((c) => c.id_conta === o.id_conta_contabil)
          const centro = (centros ?? []).find((c) => c.id_centro_custo === o.id_centro_custo)
          const percentual = o.percentual_realizado ?? 0
          return (
            <div key={o.id_orcamento} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {conta ? `${conta.codigo_contabil} — ${conta.descricao_conta}` : `Conta #${o.id_conta_contabil}`}
                  {centro && ` · ${centro.nome}`}
                </p>
                <span className={o.estourado ? 'text-destructive' : 'text-green-600'}>
                  {o.estourado ? 'Estourado' : 'Dentro do previsto'}
                </span>
              </div>
              <p className="text-muted-foreground">
                {formatarReais(o.realizado)} de {formatarReais(o.valor_previsto)} previstos ({percentual.toFixed(0)}%)
              </p>
              <div className="mt-1 h-2 w-full rounded-full bg-muted">
                <div
                  className={`h-2 rounded-full ${o.estourado ? 'bg-destructive' : 'bg-primary'}`}
                  style={{ width: `${Math.min(100, percentual)}%` }}
                />
              </div>
            </div>
          )
        })}
        {(orcamentos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum orçamento cadastrado para {anoAtual}.</p>
        )}
      </div>
    </section>
  )
}

function SecaoFluxoDeCaixa() {
  const { data: fluxo } = useQuery({
    queryKey: ['fluxo-de-caixa'],
    queryFn: () => obterFluxoDeCaixa(),
  })

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Fluxo de caixa projetado</h2>
      <div className="space-y-2">
        {(fluxo?.meses ?? []).map((m) => (
          <div key={m.competencia} className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{m.competencia}</p>
            <p className="text-muted-foreground">
              Saldo inicial: {formatarReais(m.saldo_inicial)} · Entradas: {formatarReais(m.entradas_previstas)} ·
              {' '}Saídas: {formatarReais(m.saidas_previstas)}
              {m.recorrentes_projetadas > 0 && ` (inclui ${formatarReais(m.recorrentes_projetadas)} de recorrentes ainda não lançadas)`}
            </p>
            <p className={`font-medium ${m.saldo_final < 0 ? 'text-destructive' : 'text-green-600'}`}>
              Saldo projetado: {formatarReais(m.saldo_final)}
            </p>
          </div>
        ))}
        {(fluxo?.meses ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Sem projeção disponível.</p>
        )}
      </div>
    </section>
  )
}

function FormularioReservaContingencia({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: contasFinanceiras } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })
  const { data: deliberacoes } = useQuery({
    queryKey: ['deliberacoes-concluidas'],
    queryFn: listarDeliberacoesConcluidas,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof reservaContingenciaCriarSchema>) =>
      criarReservaContingencia(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservas-contingencia'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof reservaContingenciaCriarSchema>>
      schema={reservaContingenciaCriarSchema}
      defaultValues={{ id_conta_financeira: 0, regra_uso: '' }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div>
            <select
              {...form.register('id_conta_financeira')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta financeira…</option>
              {(contasFinanceiras ?? []).map((c) => (
                <option key={c.id_conta_financeira} value={c.id_conta_financeira}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.id_conta_financeira?.message} />
          </div>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('valor_minimo')}
              placeholder="Valor mínimo a manter (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <select
              {...form.register('id_deliberacao')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem deliberação vinculada</option>
              {(deliberacoes ?? []).map((d) => (
                <option key={d.id_deliberacao} value={d.id_deliberacao}>
                  #{d.id_deliberacao} — {d.texto.slice(0, 80)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <textarea
              {...form.register('regra_uso')}
              placeholder="Regra de uso — quando esta reserva pode ser movimentada"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.regra_uso?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar reserva'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancelar}>
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

function SecaoReservaContingencia() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const { data: reservas } = useQuery({
    queryKey: ['reservas-contingencia'],
    queryFn: listarReservasContingencia,
  })
  const { data: contasFinanceiras } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Reserva de contingência</h2>
        <Button variant="outline" size="sm" onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? 'Cancelar' : 'Nova reserva'}
        </Button>
      </div>
      {mostrarForm && <FormularioReservaContingencia onCancelar={() => setMostrarForm(false)} />}
      <div className="space-y-2">
        {(reservas ?? []).map((r) => {
          const contaFinanceira = (contasFinanceiras ?? []).find((c) => c.id_conta_financeira === r.id_conta_financeira)
          const abaixoDoMinimo = r.valor_minimo != null && r.saldo_atual < r.valor_minimo
          return (
            <div key={r.id_reserva} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {contaFinanceira ? `${contaFinanceira.codigo_contabil} — ${contaFinanceira.descricao_conta}` : `Conta financeira #${r.id_conta_financeira}`}
                </p>
                <span className={abaixoDoMinimo ? 'text-destructive' : 'text-green-600'}>
                  {formatarReais(r.saldo_atual)}
                </span>
              </div>
              {r.valor_minimo != null && (
                <p className={abaixoDoMinimo ? 'text-destructive' : 'text-muted-foreground'}>
                  Mínimo definido: {formatarReais(r.valor_minimo)}
                  {abaixoDoMinimo && ' — saldo abaixo do mínimo'}
                </p>
              )}
              <p className="text-muted-foreground">{r.regra_uso}</p>
            </div>
          )
        })}
        {(reservas ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma reserva de contingência cadastrada.</p>
        )}
      </div>
    </section>
  )
}

export function OrcamentoPage() {
  return (
    <>
      <PageHeader
        titulo="Orçamento e Fluxo de Caixa"
        descricao="Orçamento anual aprovado em assembleia (realizado x previsto), fluxo de caixa projetado e reserva de contingência."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Orçamento e Fluxo de Caixa' },
        ]}
      />
      <SecaoOrcamentos />
      <SecaoFluxoDeCaixa />
      <SecaoReservaContingencia />
    </>
  )
}
