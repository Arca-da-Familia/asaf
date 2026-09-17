import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  alternarContaAPagarRecorrente,
  criarContaAPagarRecorrente,
  gerarContasAPagarRecorrentes,
  listarContasAPagarRecorrentes,
  listarFornecedores,
  listarPlanoContas,
  type PrevisaoContasAPagar,
} from '@/lib/api'
import {
  contaAPagarRecorrenteCriarSchema,
  gerarContasAPagarSchema,
} from '@/lib/schemas'

// v3.3 (FASE 3 - Financeiro) - contas a pagar recorrentes (aluguel, energia, contador): geração
// mensal idempotente, espelhando "Gerar Cobranças" pro lado "A Pagar" - alimenta previsão de
// fluxo de caixa assim que o compromisso do mês nasce, não só quando a conta chega.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

export function ContasAPagarRecorrentesPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [previa, setPrevia] = useState<PrevisaoContasAPagar | null>(null)
  const [confirmado, setConfirmado] = useState<PrevisaoContasAPagar | null>(
    null,
  )
  const queryClient = useQueryClient()

  const { data: contasRecorrentes } = useQuery({
    queryKey: ['contas-a-pagar-recorrentes'],
    queryFn: listarContasAPagarRecorrentes,
  })
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: fornecedores } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: listarFornecedores,
  })
  const contasDespesa = (contas ?? []).filter(
    (c) => c.tipo === 'Despesa' && !c.sintetica,
  )

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof contaAPagarRecorrenteCriarSchema>) =>
      criarContaAPagarRecorrente(v),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['contas-a-pagar-recorrentes'],
      })
      setMostrarForm(false)
    },
  })
  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      alternarContaAPagarRecorrente(id, ativo),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['contas-a-pagar-recorrentes'],
      }),
  })
  const gerarPrevia = useMutation({
    mutationFn: (v: z.infer<typeof gerarContasAPagarSchema>) =>
      gerarContasAPagarRecorrentes(v.competencia, false),
    onSuccess: (resultado) => {
      setPrevia(resultado)
      setConfirmado(null)
    },
  })
  const confirmar = useMutation({
    mutationFn: () => gerarContasAPagarRecorrentes(previa!.competencia, true),
    onSuccess: (resultado) => {
      setConfirmado(resultado)
      setPrevia(null)
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
    },
  })

  return (
    <>
      <PageHeader
        titulo="Contas a Pagar Recorrentes"
        descricao="Aluguel, energia, contador — geração mensal idempotente, mesma lógica de Gerar Cobranças pro lado A Pagar."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Contas a Pagar Recorrentes' },
        ]}
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Contas cadastradas</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Nova conta recorrente'}
          </Button>
        </div>

        {mostrarForm && (
          <FormShell<z.infer<typeof contaAPagarRecorrenteCriarSchema>>
            schema={contaAPagarRecorrenteCriarSchema}
            defaultValues={{
              descricao: '',
              valor: 0,
              id_conta_contabil: 0,
              dia_vencimento: 10,
            }}
            onSubmit={(v) => criar.mutateAsync(v)}
            className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
          >
            {(form) => (
              <>
                <div className="sm:col-span-2">
                  <input
                    {...form.register('descricao')}
                    placeholder="Descrição (ex.: Aluguel da sede)"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.descricao?.message}
                  />
                </div>
                <div>
                  <input
                    type="number"
                    {...form.register('dia_vencimento')}
                    placeholder="Dia de vencimento"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.dia_vencimento?.message}
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
                  <select
                    {...form.register('id_fornecedor')}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Sem fornecedor</option>
                    {(fornecedores ?? []).map((f) => (
                      <option key={f.id_fornecedor} value={f.id_fornecedor}>
                        {f.razao_social}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" size="sm" disabled={criar.isPending}>
                    {criar.isPending ? 'Salvando…' : 'Cadastrar'}
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
        )}

        <div className="space-y-2">
          {(contasRecorrentes ?? []).map((c) => (
            <div
              key={c.id_conta_recorrente}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium">{c.descricao}</p>
                <p className="text-muted-foreground">
                  {formatarReais(c.valor)} · vencimento dia {c.dia_vencimento}
                  {!c.ativo && ' · inativa'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={alternar.isPending}
                onClick={() =>
                  alternar.mutate({
                    id: c.id_conta_recorrente,
                    ativo: !c.ativo,
                  })
                }
              >
                {c.ativo ? 'Inativar' : 'Reativar'}
              </Button>
            </div>
          ))}
          {(contasRecorrentes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta recorrente cadastrada.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 font-semibold">Gerar do mês</h2>
        <FormShell<z.infer<typeof gerarContasAPagarSchema>>
          schema={gerarContasAPagarSchema}
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

        {previa && (
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <p className="mb-2 font-semibold">
              Prévia — competência {previa.competencia}
            </p>
            <ul className="mb-3 space-y-1 text-sm text-muted-foreground">
              <li>
                {previa.total_gerados} conta(s) a gerar, totalizando{' '}
                {formatarReais(previa.valor_total)}
              </li>
              <li>
                {previa.total_ja_existentes} já existente(s) para esta
                competência (não serão duplicadas)
              </li>
            </ul>
            {previa.total_gerados > 0 && (
              <Button
                size="sm"
                onClick={() => confirmar.mutate()}
                disabled={confirmar.isPending}
              >
                {confirmar.isPending
                  ? 'Gerando…'
                  : `Confirmar geração de ${previa.total_gerados} conta(s)`}
              </Button>
            )}
          </div>
        )}

        {confirmado && (
          <div className="rounded-md border border-green-600/40 bg-green-600/10 p-4 text-sm">
            <p className="font-semibold text-green-700">
              {confirmado.total_gerados} conta(s) geradas para a competência{' '}
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
