import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  baterPresenca,
  criarJustificativa,
  listarMinhasAssembleias,
  type MinhaAssembleia,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { baterPresencaSchema, justificativaCriarSchema } from '@/lib/schemas'

const CORES_PRESENCA: Record<string, string> = {
  Presente: 'text-green-600',
  'Falta justificada': 'text-amber-600',
  Falta: 'text-destructive',
  Pendente: 'text-muted-foreground',
}

function CardAssembleia({ assembleia }: { assembleia: MinhaAssembleia }) {
  const queryClient = useQueryClient()
  const [aba, setAba] = useState<'nenhuma' | 'presenca' | 'justificativa'>(
    'nenhuma',
  )

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['minhas-assembleias'] })
    setAba('nenhuma')
  }

  const bater = useMutation({
    mutationFn: (v: z.infer<typeof baterPresencaSchema>) =>
      baterPresenca(assembleia.id_assembleia, v),
    onSuccess: invalidar,
  })
  const justificar = useMutation({
    mutationFn: (v: z.infer<typeof justificativaCriarSchema>) =>
      criarJustificativa(assembleia.id_assembleia, v),
    onSuccess: invalidar,
  })

  const podeBaterPresenca =
    assembleia.status === 'Em andamento' &&
    assembleia.status_presenca === 'Pendente'
  const podeJustificar =
    (assembleia.status === 'Convocada' ||
      assembleia.status === 'Em andamento') &&
    !assembleia.justificativa

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            Assembleia {assembleia.tipo} — {assembleia.status}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatarData(assembleia.data_hora_convocacao, { comHora: true })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {assembleia.pauta}
          </p>
        </div>
        {assembleia.status_presenca && (
          <span
            className={`shrink-0 text-sm font-medium ${CORES_PRESENCA[assembleia.status_presenca] ?? ''}`}
          >
            {assembleia.status_presenca}
          </span>
        )}
      </div>

      {assembleia.justificativa && (
        <p className="mt-2 text-sm">
          Justificativa enviada:{' '}
          <span className="text-muted-foreground">
            {assembleia.justificativa.motivo}
          </span>{' '}
          ({assembleia.justificativa.status})
        </p>
      )}

      {(podeBaterPresenca || podeJustificar) && (
        <div className="mt-3 flex gap-2">
          {podeBaterPresenca && (
            <Button
              size="sm"
              variant={aba === 'presenca' ? 'default' : 'outline'}
              onClick={() =>
                setAba((a) => (a === 'presenca' ? 'nenhuma' : 'presenca'))
              }
            >
              Bater presença
            </Button>
          )}
          {podeJustificar && (
            <Button
              size="sm"
              variant={aba === 'justificativa' ? 'default' : 'outline'}
              onClick={() =>
                setAba((a) =>
                  a === 'justificativa' ? 'nenhuma' : 'justificativa',
                )
              }
            >
              Enviar justificativa
            </Button>
          )}
        </div>
      )}

      {aba === 'presenca' && (
        <FormShell<z.infer<typeof baterPresencaSchema>>
          schema={baterPresencaSchema}
          defaultValues={{ codigo: '', modalidade: 'Presencial' }}
          onSubmit={(v) => bater.mutateAsync(v)}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <div>
                <label className="text-sm font-medium">Código da sessão</label>
                <input
                  {...form.register('codigo')}
                  placeholder="Anunciado na sala"
                  className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.codigo?.message} />
              </div>
              <div>
                <label className="text-sm font-medium">Modalidade</label>
                <select
                  {...form.register('modalidade')}
                  className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="Presencial">Presencial</option>
                  <option value="Remoto">Remoto</option>
                </select>
              </div>
              <Button type="submit" size="sm" disabled={bater.isPending}>
                {bater.isPending ? 'Confirmando…' : 'Confirmar presença'}
              </Button>
              {bater.isError && (
                <p className="w-full text-sm text-destructive">
                  {(bater.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}

      {aba === 'justificativa' && (
        <FormShell<z.infer<typeof justificativaCriarSchema>>
          schema={justificativaCriarSchema}
          defaultValues={{ motivo: '' }}
          onSubmit={(v) => justificar.mutateAsync(v)}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <div className="min-w-[16rem] flex-1">
                <label className="text-sm font-medium">Motivo</label>
                <input
                  {...form.register('motivo')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.motivo?.message} />
              </div>
              <Button type="submit" size="sm" disabled={justificar.isPending}>
                {justificar.isPending ? 'Enviando…' : 'Enviar justificativa'}
              </Button>
              {justificar.isError && (
                <p className="w-full text-sm text-destructive">
                  {(justificar.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}
    </div>
  )
}

// v2.5.3b (FASE 2.5 - Painel, achado do usuário 2026-09-15) - "cada membro ter a sua própria
// ficha de chamada": ao contrário de Assembleias/Sessão (módulo Governança, permissão
// `governanca`), esta tela é do próprio associado sobre si mesmo - por isso vive fora do módulo,
// junto de Meu Perfil, acessível a qualquer usuário autenticado vinculado a um associado.
export function MinhasAssembleiasPage() {
  const { data: assembleias, isLoading } = useQuery({
    queryKey: ['minhas-assembleias'],
    queryFn: listarMinhasAssembleias,
  })

  const dados = assembleias ?? []

  return (
    <>
      <PageHeader
        titulo="Minhas assembleias"
        descricao="Seu histórico de presença, falta e justificativas."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : dados.length === 0 ? (
        <EmptyState
          icone={CalendarCheck}
          titulo="Nenhuma assembleia te envolveu ainda"
          descricao="Assembleias convocadas aparecem aqui assim que você entra na lista de habilitados."
        />
      ) : (
        <div className="grid gap-4">
          {dados.map((a) => (
            <CardAssembleia key={a.id_assembleia} assembleia={a} />
          ))}
        </div>
      )}
    </>
  )
}
