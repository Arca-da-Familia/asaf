import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  converterPeticaoEmAssembleia,
  criarAssembleia,
  obterPeticao,
  type AssembleiaCriarInput,
} from '@/lib/api'
import { assembleiaCriarSchema } from '@/lib/schemas'

type AssembleiaForm = z.infer<typeof assembleiaCriarSchema>

const TIPOS = ['Ordinária', 'Extraordinária', 'Solene']

// v2.5.2 (FASE 2.5 - Painel) - mesma tela serve os dois caminhos de convocação do Art. 8º/10:
// convocação direta pela diretoria, ou conversão de uma petição que já atingiu o quórum de
// adesão (`?peticao=<id>` pré-preenche a pauta e troca o endpoint de destino).
export function AssembleiaNovoPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const idPeticao = params.get('peticao') ? Number(params.get('peticao')) : null

  const { data: peticao } = useQuery({
    queryKey: ['peticao', idPeticao],
    queryFn: () => obterPeticao(idPeticao as number),
    enabled: idPeticao !== null,
  })

  const criar = useMutation({
    mutationFn: (v: AssembleiaForm) => {
      const dados: AssembleiaCriarInput = {
        ...v,
        local_fisico: v.local_fisico || undefined,
        link_remoto: v.link_remoto || undefined,
      }
      return idPeticao
        ? converterPeticaoEmAssembleia(idPeticao, dados)
        : criarAssembleia(dados)
    },
    onSuccess: (assembleia) => {
      queryClient.invalidateQueries({ queryKey: ['assembleias'] })
      queryClient.invalidateQueries({ queryKey: ['peticoes'] })
      navigate(`/governanca/${assembleia.id_assembleia}`)
    },
  })

  return (
    <>
      <PageHeader
        titulo={
          idPeticao ? 'Converter petição em assembleia' : 'Nova assembleia'
        }
        descricao="Convocação formal - tipo, ordem do dia, data e local."
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          { rotulo: idPeticao ? 'Converter petição' : 'Nova assembleia' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        {idPeticao && !peticao ? (
          <p className="text-sm text-muted-foreground">
            Carregando dados da petição…
          </p>
        ) : (
          <FormShell<AssembleiaForm>
            schema={assembleiaCriarSchema}
            defaultValues={{
              tipo: '',
              pauta: peticao?.pauta_proposta ?? '',
              data_hora_convocacao: '',
              local_fisico: '',
              link_remoto: '',
            }}
            onSubmit={(v) => criar.mutateAsync(v)}
          >
            {(form) => (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Tipo *</label>
                    <select
                      {...form.register('tipo')}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Selecione…</option>
                      {TIPOS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <ErroCampo mensagem={form.formState.errors.tipo?.message} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Data e hora da 1ª convocação *
                    </label>
                    <input
                      type="datetime-local"
                      {...form.register('data_hora_convocacao')}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <ErroCampo
                      mensagem={
                        form.formState.errors.data_hora_convocacao?.message
                      }
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Ordem do dia *</label>
                  <textarea
                    {...form.register('pauta')}
                    rows={4}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <ErroCampo mensagem={form.formState.errors.pauta?.message} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Local físico</label>
                    <input
                      {...form.register('local_fisico')}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Link remoto</label>
                    <input
                      {...form.register('link_remoto')}
                      placeholder="https://…"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button type="submit" disabled={criar.isPending}>
                    {criar.isPending
                      ? 'Enviando…'
                      : idPeticao
                        ? 'Converter em assembleia'
                        : 'Criar assembleia (rascunho)'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('/governanca')}
                  >
                    Cancelar
                  </Button>
                </div>
              </>
            )}
          </FormShell>
        )}
      </section>
    </>
  )
}
