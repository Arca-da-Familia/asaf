import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  abrirSessaoAssembleia,
  cancelarAssembleia,
  convocarAssembleia,
  criarJustificativa,
  decidirJustificativa,
  encerrarSessaoAssembleia,
  listarAssociados,
  listarHabilitados,
  listarJustificativas,
  obterAssembleia,
  obterEditalAssembleia,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { justificativaManualSchema } from '@/lib/schemas'

const CORES_STATUS_JUSTIFICATIVA: Record<string, string> = {
  Pendente: 'text-amber-600',
  Aceita: 'text-green-600',
  Rejeitada: 'text-destructive',
}

// v2.5.3b (achado do usuário 2026-09-15) - justificativa de falta vale do edital (Convocada) até
// o fim da sessão (Realizada) - por isso mora aqui, não dentro de Sessão (que só existe com a
// assembleia "Em andamento"). Lançamento em nome de outro associado (`id_associado` presente)
// já nasce "Aceita" - é o secretário exercendo a mesma autoridade que teria pra decidir depois.
function BlocoJustificativas({ idAssembleia }: { idAssembleia: number }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)

  const { data: justificativas } = useQuery({
    queryKey: ['justificativas', idAssembleia],
    queryFn: () => listarJustificativas(idAssembleia),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const nomesPorId = new Map(
    (associados ?? []).map((a) => [a.id_associado, a.nome_completo]),
  )

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['justificativas', idAssembleia],
    })
  }

  const lancar = useMutation({
    mutationFn: (v: { motivo: string; id_associado: number }) =>
      criarJustificativa(idAssembleia, v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
    },
  })
  const decidir = useMutation({
    mutationFn: ({
      idJustificativa,
      aceitar,
    }: {
      idJustificativa: number
      aceitar: boolean
    }) => decidirJustificativa(idJustificativa, { aceitar }),
    onSuccess: invalidar,
  })

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Justificativas de falta</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Lançar em nome de associado'}
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        O próprio associado pode enviar a sua em &quot;Minhas Assembleias&quot;.
        Lançar aqui em nome de outro já registra como aceita (correção do
        secretário, ex.: app falhou).
      </p>

      {mostrarForm && (
        <FormShell<z.infer<typeof justificativaManualSchema>>
          schema={justificativaManualSchema}
          defaultValues={{ motivo: '', id_associado: 0 }}
          onSubmit={(v) => lancar.mutateAsync(v)}
          className="mb-4 space-y-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <select
                {...form.register('id_associado')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Selecione o associado…</option>
                {(associados ?? []).map((a) => (
                  <option key={a.id_associado} value={a.id_associado}>
                    {a.nome_completo}
                  </option>
                ))}
              </select>
              <input
                {...form.register('motivo')}
                placeholder="Motivo"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.motivo?.message} />
              <Button type="submit" size="sm" disabled={lancar.isPending}>
                {lancar.isPending ? 'Lançando…' : 'Lançar (já aceita)'}
              </Button>
              {lancar.isError && (
                <p className="text-sm text-destructive">
                  {(lancar.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-2">
        {(justificativas ?? []).map((j) => (
          <div
            key={j.id_justificativa}
            className="rounded-md border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {nomesPorId.get(j.id_associado) ??
                  `Associado #${j.id_associado}`}
              </p>
              <span
                className={
                  CORES_STATUS_JUSTIFICATIVA[j.status] ?? 'font-medium'
                }
              >
                {j.status}
              </span>
            </div>
            <p className="text-muted-foreground">{j.motivo}</p>
            {j.status === 'Pendente' && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={decidir.isPending}
                  onClick={() =>
                    decidir.mutate({
                      idJustificativa: j.id_justificativa,
                      aceitar: true,
                    })
                  }
                >
                  Aceitar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={decidir.isPending}
                  onClick={() =>
                    decidir.mutate({
                      idJustificativa: j.id_justificativa,
                      aceitar: false,
                    })
                  }
                >
                  Rejeitar
                </Button>
              </div>
            )}
          </div>
        ))}
        {(justificativas ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma justificativa registrada ainda.
          </p>
        )}
      </div>
    </section>
  )
}

// v2.5.2 (FASE 2.5 - Painel) - condução do ciclo de vida da assembleia (Rascunho → Convocada →
// Em andamento → Realizada/Cancelada, v2.2/v2.3). Cada transição chama exatamente o endpoint que
// já existia e já era testado - esta tela não inventa regra nova, só expõe o que o backend
// sempre fez.
export function AssembleiaDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const idAssembleia = Number(id)
  const queryClient = useQueryClient()
  const [mostrarEdital, setMostrarEdital] = useState(false)

  const { data: assembleia, isLoading } = useQuery({
    queryKey: ['assembleia', idAssembleia],
    queryFn: () => obterAssembleia(idAssembleia),
  })

  const { data: habilitados } = useQuery({
    queryKey: ['habilitados', idAssembleia],
    queryFn: () => listarHabilitados(idAssembleia, true),
    enabled: !!assembleia && assembleia.status !== 'Rascunho',
  })

  const { data: edital } = useQuery({
    queryKey: ['edital', idAssembleia],
    queryFn: () => obterEditalAssembleia(idAssembleia),
    enabled: mostrarEdital,
  })

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['assembleia', idAssembleia] })
    queryClient.invalidateQueries({ queryKey: ['assembleias'] })
  }

  const convocar = useMutation({
    mutationFn: () => convocarAssembleia(idAssembleia),
    onSuccess: invalidar,
  })
  const cancelar = useMutation({
    mutationFn: () => cancelarAssembleia(idAssembleia),
    onSuccess: invalidar,
  })
  const abrirSessao = useMutation({
    mutationFn: () => abrirSessaoAssembleia(idAssembleia),
    onSuccess: invalidar,
  })
  const encerrarSessao = useMutation({
    mutationFn: () => encerrarSessaoAssembleia(idAssembleia),
    onSuccess: invalidar,
  })

  const erro = (convocar.error ??
    cancelar.error ??
    abrirSessao.error ??
    encerrarSessao.error) as Error | undefined

  if (isLoading || !assembleia) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  return (
    <>
      <PageHeader
        titulo={`Assembleia ${assembleia.tipo}`}
        descricao={assembleia.status}
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          { rotulo: `Assembleia ${assembleia.tipo}` },
        ]}
        acoes={
          <>
            {assembleia.status === 'Rascunho' && (
              <>
                <Button
                  variant="outline"
                  disabled={cancelar.isPending}
                  onClick={() => cancelar.mutate()}
                >
                  Cancelar
                </Button>
                <Button
                  disabled={convocar.isPending}
                  onClick={() => convocar.mutate()}
                >
                  {convocar.isPending ? 'Convocando…' : 'Convocar'}
                </Button>
              </>
            )}
            {assembleia.status === 'Convocada' && (
              <>
                <Button
                  variant="outline"
                  disabled={cancelar.isPending}
                  onClick={() => cancelar.mutate()}
                >
                  Cancelar
                </Button>
                <Button
                  disabled={abrirSessao.isPending}
                  onClick={() => abrirSessao.mutate()}
                >
                  {abrirSessao.isPending ? 'Abrindo…' : 'Abrir sessão'}
                </Button>
              </>
            )}
            {assembleia.status === 'Em andamento' && (
              <>
                <Button asChild variant="outline">
                  <Link to={`/governanca/${idAssembleia}/sessao`}>
                    Conduzir sessão
                  </Link>
                </Button>
                <Button
                  disabled={encerrarSessao.isPending}
                  onClick={() => encerrarSessao.mutate()}
                >
                  {encerrarSessao.isPending ? 'Encerrando…' : 'Encerrar sessão'}
                </Button>
              </>
            )}
            {assembleia.status === 'Realizada' && (
              <Button asChild variant="outline">
                <Link to={`/governanca/${idAssembleia}/sessao`}>
                  Corrigir presença
                </Link>
              </Button>
            )}
          </>
        }
      />

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {erro.message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            1ª convocação
          </p>
          <p className="mt-1 font-medium">
            {formatarData(assembleia.primeira_convocacao, { comHora: true })}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            2ª convocação
          </p>
          <p className="mt-1 font-medium">
            {formatarData(assembleia.segunda_convocacao, { comHora: true })}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            3ª convocação
          </p>
          <p className="mt-1 font-medium">
            {formatarData(assembleia.terceira_convocacao, { comHora: true })}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">Ordem do dia</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {assembleia.pauta}
          </p>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Local físico</dt>
              <dd>{assembleia.local_fisico ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Link remoto</dt>
              <dd>{assembleia.link_remoto ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Origem</dt>
              <dd>{assembleia.origem_convocacao}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">Habilitação e edital</h2>
          {assembleia.status === 'Rascunho' ? (
            <p className="text-sm text-muted-foreground">
              A lista de habilitados e o edital só existem depois da convocação.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {habilitados?.length ?? '…'} associados habilitados a votar
                (lista congelada no momento da convocação).
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setMostrarEdital((v) => !v)}
              >
                {mostrarEdital ? 'Ocultar edital' : 'Ver edital'}
              </Button>
              {mostrarEdital && edital && (
                <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {edital.edital_texto}
                </pre>
              )}
            </>
          )}
        </section>
      </div>

      {assembleia.status !== 'Rascunho' &&
        assembleia.status !== 'Cancelada' && (
          <BlocoJustificativas idAssembleia={idAssembleia} />
        )}
    </>
  )
}
