import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  aprovarReembolsoDespesa,
  enviarComprovante,
  listarAssociados,
  listarPlanoContas,
  listarReembolsosDespesa,
  reprovarReembolsoDespesa,
  solicitarReembolsoDespesa,
} from '@/lib/api'
import {
  reembolsoDespesaCriarSchema,
  reprovarSolicitacaoSchema,
} from '@/lib/schemas'

// v3.3 (FASE 3 - Financeiro) - reembolso de despesa de voluntário/dirigente como fluxo próprio:
// comprovante obrigatório, aprovação (segregação de funções: quem lançou nunca aprova o próprio
// reembolso), pagamento (título "A Pagar" de sempre, ver Títulos).
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

export function ReembolsoDespesaPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [reprovando, setReprovando] = useState<number | null>(null)
  const [enviandoComprovante, setEnviandoComprovante] = useState(false)
  const [erroComprovante, setErroComprovante] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: reembolsos } = useQuery({
    queryKey: ['reembolsos-despesa'],
    queryFn: () => listarReembolsosDespesa(),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const contasDespesa = (contas ?? []).filter(
    (c) => c.tipo === 'Despesa' && !c.sintetica,
  )

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['reembolsos-despesa'] })
  }

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof reembolsoDespesaCriarSchema>) =>
      solicitarReembolsoDespesa(v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
    },
  })
  const aprovar = useMutation({
    mutationFn: (id: number) => aprovarReembolsoDespesa(id),
    onSuccess: invalidar,
  })
  const reprovar = useMutation({
    mutationFn: (v: z.infer<typeof reprovarSolicitacaoSchema>) =>
      reprovarReembolsoDespesa(reprovando!, v.motivo),
    onSuccess: () => {
      invalidar()
      setReprovando(null)
    },
  })

  return (
    <>
      <PageHeader
        titulo="Reembolso de Despesa"
        descricao="Reembolso de voluntário/dirigente — comprovante obrigatório, aprovação e pagamento próprios (nunca informal)."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Reembolso de Despesa' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Reembolsos</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Solicitar reembolso'}
          </Button>
        </div>

        {mostrarForm && (
          <FormShell<z.infer<typeof reembolsoDespesaCriarSchema>>
            schema={reembolsoDespesaCriarSchema}
            defaultValues={{
              id_associado: 0,
              descricao: '',
              valor: 0,
              id_conta_contabil: 0,
              comprovante: '',
            }}
            onSubmit={(v) => criar.mutateAsync(v)}
            className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
          >
            {(form) => (
              <>
                <div>
                  <select
                    {...form.register('id_associado')}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="0">Beneficiário (associado)…</option>
                    {(associados ?? []).map((a) => (
                      <option key={a.id_associado} value={a.id_associado}>
                        {a.nome_completo}
                      </option>
                    ))}
                  </select>
                  <ErroCampo
                    mensagem={form.formState.errors.id_associado?.message}
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
                    {...form.register('descricao')}
                    placeholder="Descrição da despesa"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.descricao?.message}
                  />
                </div>
                <div>
                  <select
                    {...form.register('id_conta_contabil')}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="0">Conta contábil (Despesa)…</option>
                    {contasDespesa.map((c) => (
                      <option key={c.id_conta} value={c.id_conta}>
                        {c.codigo_contabil} — {c.descricao_conta}
                      </option>
                    ))}
                  </select>
                  <ErroCampo
                    mensagem={form.formState.errors.id_conta_contabil?.message}
                  />
                </div>
                <div>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    disabled={enviandoComprovante}
                    onChange={async (e) => {
                      const arquivo = e.target.files?.[0]
                      if (!arquivo) return
                      setErroComprovante(null)
                      setEnviandoComprovante(true)
                      try {
                        const { comprovante } = await enviarComprovante(arquivo)
                        form.setValue('comprovante', comprovante)
                      } catch (erro) {
                        setErroComprovante((erro as Error).message)
                      } finally {
                        setEnviandoComprovante(false)
                      }
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                  {enviandoComprovante && (
                    <p className="text-xs text-muted-foreground">Enviando…</p>
                  )}
                  {form.watch('comprovante') && (
                    <p className="text-xs text-green-600">
                      Comprovante anexado.
                    </p>
                  )}
                  {erroComprovante && (
                    <p className="text-xs text-destructive">
                      {erroComprovante}
                    </p>
                  )}
                  <ErroCampo
                    mensagem={form.formState.errors.comprovante?.message}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm" disabled={criar.isPending}>
                    {criar.isPending ? 'Salvando…' : 'Solicitar reembolso'}
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
        )}

        <div className="space-y-2">
          {(reembolsos ?? []).map((r) => (
            <div
              key={r.id_reembolso}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{r.descricao}</p>
                <span
                  className={
                    r.status === 'Aprovado' || r.status === 'Pago'
                      ? 'text-green-600'
                      : r.status === 'Reprovado'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  }
                >
                  {r.status}
                </span>
              </div>
              <p className="text-muted-foreground">
                Valor: {formatarReais(r.valor)}
              </p>
              {r.motivo_reprovacao && (
                <p className="text-muted-foreground">
                  Motivo: {r.motivo_reprovacao}
                </p>
              )}
              {r.status === 'Solicitado' && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Button
                    size="sm"
                    disabled={aprovar.isPending}
                    onClick={() => aprovar.mutate(r.id_reembolso)}
                  >
                    Aprovar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setReprovando((v) =>
                        v === r.id_reembolso ? null : r.id_reembolso,
                      )
                    }
                  >
                    {reprovando === r.id_reembolso ? 'Cancelar' : 'Reprovar'}
                  </Button>
                </div>
              )}
              {aprovar.isError && (
                <p className="mt-1 text-xs text-destructive">
                  {(aprovar.error as Error).message}
                </p>
              )}
              {reprovando === r.id_reembolso && (
                <FormShell<z.infer<typeof reprovarSolicitacaoSchema>>
                  schema={reprovarSolicitacaoSchema}
                  defaultValues={{ motivo: '' }}
                  onSubmit={(v) => reprovar.mutateAsync(v)}
                  className="mt-2 flex flex-wrap items-end gap-2"
                >
                  {(form) => (
                    <>
                      <div className="flex-1">
                        <input
                          {...form.register('motivo')}
                          placeholder="Motivo da reprovação"
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                        <ErroCampo
                          mensagem={form.formState.errors.motivo?.message}
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={reprovar.isPending}
                      >
                        Confirmar
                      </Button>
                    </>
                  )}
                </FormShell>
              )}
            </div>
          ))}
          {(reembolsos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum reembolso solicitado.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
