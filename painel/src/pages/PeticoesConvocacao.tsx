import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Handshake } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  aderirPeticao,
  listarPeticoes,
  proporPeticao,
  type PeticaoConvocacao,
} from '@/lib/api'
import { peticaoCriarSchema } from '@/lib/schemas'
import { z } from 'zod'

// v2.5.2 (FASE 2.5 - Painel) - petição de convocação (Art. 8º/10 do estatuto, Art. 60 do Código
// Civil): qualquer associado pode propor e aderir, sem exigir a permissão `governanca` - é
// direito do quadro social, não uma função da diretoria. Aderir/propor usam o próprio usuário
// logado (o backend resolve o associado a partir do token); não há "aderir em nome de outro".
function CardPeticao({ peticao }: { peticao: PeticaoConvocacao }) {
  const queryClient = useQueryClient()
  const aderir = useMutation({
    mutationFn: () => aderirPeticao(peticao.id_peticao),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['peticoes'] }),
  })

  const percentual = Math.min(100, Math.round(peticao.fracao_atual * 100))

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{peticao.pauta_proposta}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {peticao.adesoes} de {peticao.base_associados_ativos} associados
            ativos aderiram ({percentual}%)
          </p>
        </div>
        <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-medium">
          {peticao.status}
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary"
          style={{ width: `${percentual}%` }}
        />
      </div>

      <div className="mt-4 flex gap-2">
        {peticao.status === 'Coletando adesões' && (
          <Button
            size="sm"
            variant="outline"
            disabled={aderir.isPending}
            onClick={() => aderir.mutate()}
          >
            {aderir.isPending ? 'Aderindo…' : 'Aderir a esta petição'}
          </Button>
        )}
        {peticao.status === 'Quórum atingido' && (
          <Button asChild size="sm">
            <Link to={`/governanca/nova?peticao=${peticao.id_peticao}`}>
              Converter em assembleia
            </Link>
          </Button>
        )}
      </div>
      {aderir.isError && (
        <p className="mt-2 text-sm text-destructive">
          {(aderir.error as Error).message}
        </p>
      )}
    </div>
  )
}

export function PeticoesConvocacaoPage() {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)

  const { data: peticoes, isLoading } = useQuery({
    queryKey: ['peticoes'],
    queryFn: listarPeticoes,
  })

  const propor = useMutation({
    mutationFn: (v: z.infer<typeof peticaoCriarSchema>) =>
      proporPeticao(v.pauta_proposta),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['peticoes'] })
      setMostrarForm(false)
    },
  })

  const dados = peticoes ?? []

  return (
    <>
      <PageHeader
        titulo="Petições de convocação"
        descricao="Convocação de assembleia por 1/5 dos associados ativos (Art. 8º/10)."
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          { rotulo: 'Petições de convocação' },
        ]}
        acoes={
          <Button variant="outline" onClick={() => setMostrarForm((v) => !v)}>
            {mostrarForm ? 'Cancelar' : 'Propor petição'}
          </Button>
        }
      />

      {mostrarForm && (
        <section className="mb-6 rounded-xl border border-border bg-card p-6">
          <FormShell<z.infer<typeof peticaoCriarSchema>>
            schema={peticaoCriarSchema}
            defaultValues={{ pauta_proposta: '' }}
            onSubmit={(v) => propor.mutateAsync(v)}
          >
            {(form) => (
              <>
                <div>
                  <label className="text-sm font-medium">
                    Pauta proposta *
                  </label>
                  <textarea
                    {...form.register('pauta_proposta')}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.pauta_proposta?.message}
                  />
                </div>
                <Button type="submit" disabled={propor.isPending}>
                  {propor.isPending ? 'Enviando…' : 'Propor petição'}
                </Button>
              </>
            )}
          </FormShell>
        </section>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : dados.length === 0 ? (
        <EmptyState
          icone={Handshake}
          titulo="Nenhuma petição de convocação ainda"
          descricao="Qualquer associado pode propor uma."
        />
      ) : (
        <div className="grid gap-4">
          {dados.map((p) => (
            <CardPeticao key={p.id_peticao} peticao={p} />
          ))}
        </div>
      )}
    </>
  )
}
