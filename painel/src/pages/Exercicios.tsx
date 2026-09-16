import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { abrirExercicio, fecharExercicio, listarExercicios } from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { exercicioAbrirSchema } from '@/lib/schemas'

// v2.5.8 (FASE 2.5 - Painel) - Exercícios contábeis (backend v3.0, só faltava a tela). Sem
// PUT/DELETE no backend: só abrir (POST) e fechar (POST .../fechar) - nunca editar ou reabrir.
// Regra de negócio real (app/services/contabilidade.py::exigir_exercicio_aberto): só pode
// existir um exercício "Aberto" por vez - o backend recusa (400) uma segunda abertura, a
// mensagem de erro real é mostrada, o painel não tenta adivinhar/bloquear antes.
export function ExerciciosPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: exercicios } = useQuery({
    queryKey: ['exercicios'],
    queryFn: listarExercicios,
  })

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['exercicios'] })
  }

  const abrir = useMutation({
    mutationFn: (v: z.infer<typeof exercicioAbrirSchema>) => abrirExercicio(v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
      setErro(null)
    },
    onError: (e: Error) => setErro(e.message),
  })

  const fechar = useMutation({
    mutationFn: (idExercicio: number) => fecharExercicio(idExercicio),
    onSuccess: invalidar,
  })

  return (
    <>
      <PageHeader
        titulo="Exercícios contábeis"
        descricao="Só um exercício pode ficar aberto por vez; fechá-lo bloqueia novos lançamentos nele."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Exercícios' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Exercícios cadastrados</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Abrir exercício'}
          </Button>
        </div>

        {mostrarForm && (
          <FormShell<z.infer<typeof exercicioAbrirSchema>>
            schema={exercicioAbrirSchema}
            defaultValues={{ ano: new Date().getFullYear() }}
            onSubmit={(v) => abrir.mutateAsync(v)}
            className="mb-4 flex items-start gap-2 rounded-md border border-border p-3"
          >
            {(form) => (
              <>
                <div>
                  <input
                    type="number"
                    {...form.register('ano')}
                    className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo mensagem={form.formState.errors.ano?.message} />
                </div>
                <Button type="submit" size="sm">
                  Abrir
                </Button>
              </>
            )}
          </FormShell>
        )}

        {erro && <p className="mb-2 text-sm text-destructive">{erro}</p>}
        {fechar.isError && (
          <p className="mb-2 text-sm text-destructive">
            {(fechar.error as Error).message}
          </p>
        )}

        <div className="space-y-2">
          {(exercicios ?? []).map((e) => (
            <div
              key={e.id_exercicio}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  Exercício {e.ano}{' '}
                  <span
                    className={
                      e.status === 'Aberto'
                        ? 'text-green-600'
                        : 'text-muted-foreground'
                    }
                  >
                    ({e.status})
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Aberto em {formatarData(e.data_abertura)}
                  {e.data_fechamento &&
                    ` · Fechado em ${formatarData(e.data_fechamento)}`}
                </p>
              </div>
              {e.status === 'Aberto' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={fechar.isPending}
                  onClick={() => fechar.mutate(e.id_exercicio)}
                >
                  Fechar
                </Button>
              )}
            </div>
          ))}
          {(exercicios ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum exercício cadastrado.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
