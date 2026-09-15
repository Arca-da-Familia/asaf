import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  abrirDiscussaoItem,
  abrirVotacaoItem,
  credenciar,
  criarItemPauta,
  encerrarItemPauta,
  listarAssociados,
  listarCredenciamentos,
  listarItensPauta,
  listarOcorrencias,
  obterAssembleia,
  obterQuorum,
  registrarOcorrencia,
  registrarSaidaCredenciamento,
  type ItemPauta,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  credenciarSchema,
  itemPautaCriarSchema,
  ocorrenciaCriarSchema,
} from '@/lib/schemas'

const CORES_STATUS_ITEM: Record<string, string> = {
  Aguardando: 'text-muted-foreground',
  'Em discussão': 'text-blue-600',
  'Em votação': 'text-amber-600',
  Encerrado: 'text-green-600',
}

function BlocoCredenciamento({ idAssembleia }: { idAssembleia: number }) {
  const queryClient = useQueryClient()
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: credenciados } = useQuery({
    queryKey: ['credenciamentos', idAssembleia],
    queryFn: () => listarCredenciamentos(idAssembleia),
  })
  const { data: quorum } = useQuery({
    queryKey: ['quorum', idAssembleia],
    queryFn: () => obterQuorum(idAssembleia),
    refetchInterval: 5000,
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['credenciamentos', idAssembleia],
    })
    queryClient.invalidateQueries({ queryKey: ['quorum', idAssembleia] })
  }

  const registrar = useMutation({
    mutationFn: (v: z.infer<typeof credenciarSchema>) =>
      credenciar(idAssembleia, v),
    onSuccess: invalidar,
  })
  const saida = useMutation({
    mutationFn: (idCredenciamento: number) =>
      registrarSaidaCredenciamento(idAssembleia, idCredenciamento),
    onSuccess: invalidar,
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Credenciamento e quórum</h2>

      {quorum && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Convocação aplicável
            </p>
            <p className="mt-1 text-2xl font-bold">
              {quorum.convocacao_aplicavel}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Credenciados / mínimo exigido
            </p>
            <p className="mt-1 text-2xl font-bold">
              {quorum.credenciados_habilitados} / {quorum.minimo_exigido}
            </p>
          </div>
          <div
            className={`rounded-lg border p-4 ${
              quorum.quorum_atingido
                ? 'border-green-600/30 bg-green-600/10'
                : 'border-amber-600/30 bg-amber-600/10'
            }`}
          >
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Quórum de instalação ({quorum.quorum_regra})
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                quorum.quorum_atingido ? 'text-green-600' : 'text-amber-600'
              }`}
            >
              {quorum.quorum_atingido ? 'Atingido' : 'Não atingido'}
            </p>
          </div>
        </div>
      )}

      <FormShell<z.infer<typeof credenciarSchema>>
        schema={credenciarSchema}
        defaultValues={{ id_associado: 0, modalidade: 'Presencial' }}
        onSubmit={(v) => registrar.mutateAsync(v)}
        className="flex flex-wrap items-end gap-3"
      >
        {(form) => (
          <>
            <div className="min-w-[16rem] flex-1">
              <label className="text-sm font-medium">Associado</label>
              <select
                {...form.register('id_associado')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Selecione…</option>
                {(associados ?? []).map((a) => (
                  <option key={a.id_associado} value={a.id_associado}>
                    {a.nome_completo}
                  </option>
                ))}
              </select>
              <ErroCampo
                mensagem={form.formState.errors.id_associado?.message}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Modalidade</label>
              <select
                {...form.register('modalidade')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Presencial">Presencial</option>
                <option value="Remoto">Remoto</option>
              </select>
            </div>
            <Button type="submit" disabled={registrar.isPending}>
              {registrar.isPending ? 'Credenciando…' : 'Credenciar'}
            </Button>
          </>
        )}
      </FormShell>
      {registrar.isError && (
        <p className="mt-2 text-sm text-destructive">
          {(registrar.error as Error).message}
        </p>
      )}

      <div className="mt-4 space-y-1">
        {(credenciados ?? []).map((c) => (
          <div
            key={c.id_credenciamento}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>
              {c.nome_completo ?? `Associado #${c.id_associado}`} ·{' '}
              {c.modalidade} · entrou{' '}
              {formatarData(c.hora_entrada, { comHora: true })}
            </span>
            {c.hora_saida ? (
              <span className="text-muted-foreground">
                saiu {formatarData(c.hora_saida, { comHora: true })}
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={saida.isPending}
                onClick={() => saida.mutate(c.id_credenciamento)}
              >
                Registrar saída
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function LinhaItemPauta({
  idAssembleia,
  item,
}: {
  idAssembleia: number
  item: ItemPauta
}) {
  const queryClient = useQueryClient()
  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['itens-pauta', idAssembleia] })
  }
  const abrirDiscussao = useMutation({
    mutationFn: () => abrirDiscussaoItem(idAssembleia, item.id_item),
    onSuccess: invalidar,
  })
  const abrirVotacao = useMutation({
    mutationFn: () => abrirVotacaoItem(idAssembleia, item.id_item),
    onSuccess: invalidar,
  })
  const encerrar = useMutation({
    mutationFn: () => encerrarItemPauta(idAssembleia, item.id_item),
    onSuccess: invalidar,
  })

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{item.titulo}</p>
          {item.descricao && (
            <p className="text-sm text-muted-foreground">{item.descricao}</p>
          )}
        </div>
        <span
          className={`shrink-0 text-sm font-medium ${CORES_STATUS_ITEM[item.status] ?? ''}`}
        >
          {item.status}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        {item.status === 'Aguardando' && (
          <Button
            variant="outline"
            size="sm"
            disabled={abrirDiscussao.isPending}
            onClick={() => abrirDiscussao.mutate()}
          >
            Abrir discussão
          </Button>
        )}
        {(item.status === 'Aguardando' || item.status === 'Em discussão') && (
          <Button
            variant="outline"
            size="sm"
            disabled={abrirVotacao.isPending}
            onClick={() => abrirVotacao.mutate()}
          >
            Abrir votação
          </Button>
        )}
        {item.status !== 'Encerrado' && (
          <Button
            variant="outline"
            size="sm"
            disabled={encerrar.isPending}
            onClick={() => encerrar.mutate()}
          >
            Encerrar item
          </Button>
        )}
      </div>
    </div>
  )
}

function BlocoPauta({ idAssembleia }: { idAssembleia: number }) {
  const queryClient = useQueryClient()
  const { data: itens } = useQuery({
    queryKey: ['itens-pauta', idAssembleia],
    queryFn: () => listarItensPauta(idAssembleia),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof itemPautaCriarSchema>) =>
      criarItemPauta(idAssembleia, {
        ...v,
        tempo_fala_minutos: v.tempo_fala_minutos || undefined,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['itens-pauta', idAssembleia],
      }),
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Itens de pauta</h2>

      <FormShell<z.infer<typeof itemPautaCriarSchema>>
        schema={itemPautaCriarSchema}
        defaultValues={{ titulo: '', descricao: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        {(form) => (
          <>
            <div className="min-w-[14rem] flex-1">
              <label className="text-sm font-medium">Título</label>
              <input
                {...form.register('titulo')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.titulo?.message} />
            </div>
            <div className="w-32">
              <label className="text-sm font-medium">Tempo (min)</label>
              <input
                type="number"
                {...form.register('tempo_fala_minutos')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit" disabled={criar.isPending}>
              {criar.isPending ? 'Adicionando…' : 'Adicionar item'}
            </Button>
          </>
        )}
      </FormShell>

      <div className="space-y-2">
        {(itens ?? []).map((item) => (
          <LinhaItemPauta
            key={item.id_item}
            idAssembleia={idAssembleia}
            item={item}
          />
        ))}
      </div>
    </section>
  )
}

function BlocoOcorrencias({ idAssembleia }: { idAssembleia: number }) {
  const queryClient = useQueryClient()
  const { data: ocorrencias } = useQuery({
    queryKey: ['ocorrencias', idAssembleia],
    queryFn: () => listarOcorrencias(idAssembleia),
  })

  const registrar = useMutation({
    mutationFn: (v: z.infer<typeof ocorrenciaCriarSchema>) =>
      registrarOcorrencia(idAssembleia, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['ocorrencias', idAssembleia],
      }),
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Ocorrências</h2>

      <FormShell<z.infer<typeof ocorrenciaCriarSchema>>
        schema={ocorrenciaCriarSchema}
        defaultValues={{ descricao: '' }}
        onSubmit={(v) => registrar.mutateAsync(v)}
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        {(form) => (
          <>
            <div className="min-w-[16rem] flex-1">
              <label className="text-sm font-medium">Descrição</label>
              <input
                {...form.register('descricao')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.descricao?.message} />
            </div>
            <Button type="submit" disabled={registrar.isPending}>
              {registrar.isPending ? 'Registrando…' : 'Registrar ocorrência'}
            </Button>
          </>
        )}
      </FormShell>

      <div className="space-y-1">
        {(ocorrencias ?? []).map((o) => (
          <div
            key={o.id_ocorrencia}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="text-muted-foreground">
              {formatarData(o.criado_em, { comHora: true })} ·{' '}
            </span>
            {o.descricao}
          </div>
        ))}
      </div>
    </section>
  )
}

// v2.5.2 (FASE 2.5 - Painel) - painel da sessão em andamento (Art. 6º/9º): credenciamento com
// quórum em tempo real, pauta item a item e ocorrências. Só faz sentido com a assembleia "Em
// andamento" (o backend já recusa qualquer escrita fora disso - ver
// app/routers/sessao_assembleia.py) - se o status for outro, a tela mostra só o aviso.
export function SessaoAssembleiaPage() {
  const { id } = useParams<{ id: string }>()
  const idAssembleia = Number(id)

  const { data: assembleia, isLoading } = useQuery({
    queryKey: ['assembleia', idAssembleia],
    queryFn: () => obterAssembleia(idAssembleia),
  })

  if (isLoading || !assembleia) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  return (
    <>
      <PageHeader
        titulo={`Sessão — Assembleia ${assembleia.tipo}`}
        descricao="Credenciamento, quórum, pauta e ocorrências."
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          {
            rotulo: `Assembleia ${assembleia.tipo}`,
            href: `/governanca/${idAssembleia}`,
          },
          { rotulo: 'Sessão' },
        ]}
      />

      {assembleia.status !== 'Em andamento' ? (
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Esta assembleia está &quot;{assembleia.status}&quot; — a condução da
          sessão só vale enquanto estiver &quot;Em andamento&quot;.
        </p>
      ) : (
        <div className="space-y-6">
          <BlocoCredenciamento idAssembleia={idAssembleia} />
          <BlocoPauta idAssembleia={idAssembleia} />
          <BlocoOcorrencias idAssembleia={idAssembleia} />
        </div>
      )}
    </>
  )
}
