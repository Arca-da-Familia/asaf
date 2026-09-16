import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  atualizarContaContabil,
  criarContaContabil,
  listarOpcoesCatalogo,
  listarPlanoContas,
  type PlanoDeContas,
} from '@/lib/api'
import { contaContabilCriarSchema } from '@/lib/schemas'

// v2.5.8 (FASE 2.5 - Painel) - Plano de Contas (backend v3.0, só faltava a tela). `tipo` usa o
// RÓTULO do catálogo `tipo_conta_contabil` como value do <select> (não o código técnico) -
// confirmado em app/services/contabilidade.py::NATUREZA_POR_TIPO, que só reconhece os rótulos
// ("Ativo", "Despesa"...). Sem DELETE no backend: só criar e editar.
function FormularioConta({
  conta,
  onSalvar,
  onCancelar,
}: {
  conta?: PlanoDeContas
  onSalvar: (v: z.infer<typeof contaContabilCriarSchema>) => Promise<unknown>
  onCancelar?: () => void
}) {
  const { data: tipos } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_conta_contabil'],
    queryFn: () => listarOpcoesCatalogo('tipo_conta_contabil'),
  })

  return (
    <FormShell<z.infer<typeof contaContabilCriarSchema>>
      schema={contaContabilCriarSchema}
      defaultValues={{
        codigo_contabil: conta?.codigo_contabil ?? '',
        descricao_conta: conta?.descricao_conta ?? '',
        tipo: conta?.tipo ?? '',
      }}
      onSubmit={onSalvar}
      className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <input
              {...form.register('codigo_contabil')}
              placeholder="Código contábil"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.codigo_contabil?.message}
            />
          </div>
          <div>
            <input
              {...form.register('descricao_conta')}
              placeholder="Descrição"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.descricao_conta?.message}
            />
          </div>
          <div>
            <select
              {...form.register('tipo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecione o tipo…</option>
              {(tipos ?? []).map((t) => (
                <option key={t.id_opcao} value={t.rotulo}>
                  {t.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.tipo?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm">
              Salvar
            </Button>
            {onCancelar && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancelar}
              >
                Cancelar
              </Button>
            )}
          </div>
        </>
      )}
    </FormShell>
  )
}

export function PlanoContasPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['plano-contas'] })
  }

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof contaContabilCriarSchema>) =>
      criarContaContabil(v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
      setErro(null)
    },
    onError: (e: Error) => setErro(e.message),
  })

  const editar = useMutation({
    mutationFn: ({
      idConta,
      dados,
    }: {
      idConta: number
      dados: z.infer<typeof contaContabilCriarSchema>
    }) => atualizarContaContabil(idConta, dados),
    onSuccess: () => {
      invalidar()
      setEditando(null)
      setErro(null)
    },
    onError: (e: Error) => setErro(e.message),
  })

  return (
    <>
      <PageHeader
        titulo="Plano de Contas"
        descricao="Contas contábeis usadas nos lançamentos do razão."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Plano de Contas' },
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
            {mostrarForm ? 'Cancelar' : 'Nova conta'}
          </Button>
        </div>

        {mostrarForm && (
          <div className="mb-4">
            <FormularioConta
              onSalvar={(v) => criar.mutateAsync(v)}
              onCancelar={() => setMostrarForm(false)}
            />
          </div>
        )}

        {erro && <p className="mb-2 text-sm text-destructive">{erro}</p>}

        <div className="space-y-2">
          {(contas ?? []).map((c) =>
            editando === c.id_conta ? (
              <FormularioConta
                key={c.id_conta}
                conta={c}
                onSalvar={(v) =>
                  editar.mutateAsync({ idConta: c.id_conta, dados: v })
                }
                onCancelar={() => setEditando(null)}
              />
            ) : (
              <div
                key={c.id_conta}
                className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {c.codigo_contabil} — {c.descricao_conta}
                  </p>
                  <p className="text-xs text-muted-foreground">{c.tipo}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditando(c.id_conta)}
                >
                  Editar
                </Button>
              </div>
            ),
          )}
          {(contas ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta cadastrada.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
