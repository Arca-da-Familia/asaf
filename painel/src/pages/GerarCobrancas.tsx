import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { gerarCobrancas, type PrevisaoCobranca } from '@/lib/api'
import { gerarCobrancasSchema } from '@/lib/schemas'

// v3.2 (FASE 3 - Financeiro) - Geração de cobrança em lote SEMPRE com prévia obrigatória antes
// de efetivar (quantas, para quem, total) - "Confirmar" é um clique separado, nunca a mesma
// ação. Rodar a geração duas vezes na mesma competência nunca duplica (idempotência garantida
// no banco - ver app/models/financeiro.py::TituloFinanceiro.uq_titulo_cobranca_por_competencia).
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

export function GerarCobrancasPage() {
  const [previa, setPrevia] = useState<PrevisaoCobranca | null>(null)
  const [confirmado, setConfirmado] = useState<PrevisaoCobranca | null>(null)
  const queryClient = useQueryClient()

  const gerarPrevia = useMutation({
    mutationFn: (v: z.infer<typeof gerarCobrancasSchema>) =>
      gerarCobrancas(v.competencia, false),
    onSuccess: (resultado) => {
      setPrevia(resultado)
      setConfirmado(null)
    },
  })

  const confirmar = useMutation({
    mutationFn: () => gerarCobrancas(previa!.competencia, true),
    onSuccess: (resultado) => {
      setConfirmado(resultado)
      setPrevia(null)
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
    },
  })

  return (
    <>
      <PageHeader
        titulo="Gerar Cobranças"
        descricao="Geração em lote das mensalidades de uma competência, com prévia obrigatória antes de efetivar."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Gerar Cobranças' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <FormShell<z.infer<typeof gerarCobrancasSchema>>
          schema={gerarCobrancasSchema}
          defaultValues={{ competencia: '' }}
          onSubmit={(v) => gerarPrevia.mutateAsync(v)}
          className="mb-4 flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Competência (AAAA-MM)
                </label>
                <input
                  {...form.register('competencia')}
                  placeholder="2026-10"
                  className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.competencia?.message}
                />
              </div>
              <Button type="submit" size="sm" disabled={gerarPrevia.isPending}>
                {gerarPrevia.isPending ? 'Calculando…' : 'Ver prévia'}
              </Button>
            </>
          )}
        </FormShell>
        {gerarPrevia.isError && (
          <p className="text-sm text-destructive">
            {(gerarPrevia.error as Error).message}
          </p>
        )}

        {previa && (
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <p className="mb-2 font-semibold">
              Prévia — competência {previa.competencia}
            </p>
            <ul className="mb-3 space-y-1 text-sm text-muted-foreground">
              <li>
                {previa.total_gerados} cobrança(s) a gerar, totalizando{' '}
                {formatarReais(previa.valor_total)}
              </li>
              <li>
                {previa.total_ja_existentes} já existente(s) para esta
                competência (não serão duplicadas)
              </li>
              <li>
                {previa.total_dependentes_pulados} dependente(s) de família não
                cobrado(s) separadamente
              </li>
              <li>
                {previa.total_isentos_totais} isento(s) a 100% (nenhuma cobrança
                gerada)
              </li>
            </ul>
            {previa.detalhes.length > 0 && (
              <div className="mb-3 max-h-64 space-y-1 overflow-y-auto text-sm">
                {previa.detalhes.map((d, i) => (
                  <div
                    key={i}
                    className="flex justify-between border-b border-border py-1"
                  >
                    <span>
                      {d.nome} — {d.descricao_plano}
                    </span>
                    <span>{formatarReais(d.valor)}</span>
                  </div>
                ))}
              </div>
            )}
            {previa.total_gerados > 0 && (
              <Button
                size="sm"
                onClick={() => confirmar.mutate()}
                disabled={confirmar.isPending}
              >
                {confirmar.isPending
                  ? 'Gerando…'
                  : `Confirmar geração de ${previa.total_gerados} cobrança(s)`}
              </Button>
            )}
            {confirmar.isError && (
              <p className="mt-2 text-sm text-destructive">
                {(confirmar.error as Error).message}
              </p>
            )}
          </div>
        )}

        {confirmado && (
          <div className="rounded-md border border-green-600/40 bg-green-600/10 p-4 text-sm">
            <p className="font-semibold text-green-700">
              {confirmado.total_gerados} cobrança(s) geradas para a competência{' '}
              {confirmado.competencia}.
            </p>
            <p className="text-muted-foreground">
              Valor total: {formatarReais(confirmado.valor_total)} — veja em
              Financeiro › Títulos.
            </p>
          </div>
        )}
      </section>
    </>
  )
}
