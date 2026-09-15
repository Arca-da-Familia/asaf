import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  abrirSessaoAssembleia,
  cancelarAssembleia,
  convocarAssembleia,
  encerrarSessaoAssembleia,
  listarHabilitados,
  obterAssembleia,
  obterEditalAssembleia,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

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
    </>
  )
}
