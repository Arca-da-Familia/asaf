import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  alternarCentroCusto,
  criarCentroCusto,
  listarCentrosCusto,
} from '@/lib/api'
import { centroDeCustoCriarSchema } from '@/lib/schemas'

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

export function CentrosCustoPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const queryClient = useQueryClient()
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })

  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      alternarCentroCusto(id, ativo),
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
                </p>
              </div>
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
          ))}
          {(centros ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum centro de custo cadastrado.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
