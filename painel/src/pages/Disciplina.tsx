import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  abrirProcessoDisciplinar,
  apresentarDefesa,
  decidirProcessoDisciplinar,
  homologarEliminacao,
  listarAssociados,
  listarOpcoesCatalogo,
  listarProcessosDisciplinares,
  obterProcessoDisciplinar,
  registrarManifestacao,
  verManifestacoes,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { useMe } from '@/lib/use-me'
import {
  decisaoExecutarSchema,
  defesaApresentarSchema,
  homologarSchema,
  manifestacaoCriarSchema,
  processoDisciplinarCriarSchema,
} from '@/lib/schemas'

// v2.5.6 (FASE 2.5 - Painel) - processo disciplinar (backend v2.7, Art. 16/17). Confidencial de
// verdade: o backend devolve 404 (nunca 403) pra quem não é `governanca` nem o próprio acusado -
// por isso `ProcessoDisciplinarDetalhePage` mora numa rota GLOBAL
// (`/processos-disciplinares/:id`, ver App.tsx), fora do módulo Governança. A listagem é a MESMA
// página em duas rotas (`/governanca/disciplina` e `/meus-processos-disciplinares`) porque o
// próprio endpoint já se auto-filtra pelo chamador (`GET /api/processos-disciplinares/`) - nunca
// duplicado front-end de uma regra que o backend já resolve.
const CORES_STATUS: Record<string, string> = {
  Aberto: 'text-amber-600',
  Decidido: 'text-blue-600',
  Arquivado: 'text-muted-foreground',
  'Aguardando homologação da Assembleia': 'text-amber-600',
  Homologado: 'text-green-600',
  'Rejeitado pela Assembleia': 'text-destructive',
}

export function ProcessosDisciplinaresPage() {
  const { data: me } = useMe()
  const podeAbrir = me?.permissoes.includes('governanca') ?? false
  const [mostrarForm, setMostrarForm] = useState(false)
  const queryClient = useQueryClient()

  const { data: processos } = useQuery({
    queryKey: ['processos-disciplinares'],
    queryFn: listarProcessosDisciplinares,
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
    enabled: podeAbrir,
  })
  const { data: motivos } = useQuery({
    queryKey: ['opcoes-catalogo', 'motivo_processo_disciplinar'],
    queryFn: () => listarOpcoesCatalogo('motivo_processo_disciplinar'),
    enabled: podeAbrir,
  })
  const nomesPorId = new Map(
    (associados ?? []).map((a) => [a.id_associado, a.nome_completo]),
  )

  const abrir = useMutation({
    mutationFn: (v: z.infer<typeof processoDisciplinarCriarSchema>) =>
      abrirProcessoDisciplinar(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processos-disciplinares'] })
      setMostrarForm(false)
    },
  })

  return (
    <>
      <PageHeader
        titulo={
          podeAbrir ? 'Processos disciplinares' : 'Meus processos disciplinares'
        }
        descricao="Abertura, ampla defesa e decisão colegiada (Art. 16/17)."
        trilha={
          podeAbrir
            ? [
                { rotulo: 'Governança', href: '/governanca' },
                { rotulo: 'Disciplina' },
              ]
            : [{ rotulo: 'Meus processos disciplinares' }]
        }
        acoes={
          podeAbrir && (
            <Button onClick={() => setMostrarForm((v) => !v)}>
              {mostrarForm ? 'Cancelar' : 'Abrir processo'}
            </Button>
          )
        }
      />

      {mostrarForm && (
        <FormShell<z.infer<typeof processoDisciplinarCriarSchema>>
          schema={processoDisciplinarCriarSchema}
          defaultValues={{ id_associado: 0, motivo_codigo: '', descricao: '' }}
          onSubmit={(v) => abrir.mutateAsync(v)}
          className="mb-6 grid gap-2 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"
        >
          {(form) => (
            <>
              <div>
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
                <ErroCampo
                  mensagem={form.formState.errors.id_associado?.message}
                />
              </div>
              <div>
                <select
                  {...form.register('motivo_codigo')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione o motivo…</option>
                  {(motivos ?? []).map((o) => (
                    <option key={o.codigo} value={o.codigo}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
                <ErroCampo
                  mensagem={form.formState.errors.motivo_codigo?.message}
                />
              </div>
              <div className="sm:col-span-2">
                <textarea
                  {...form.register('descricao')}
                  placeholder="Descreva os fatos que motivam o processo"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.descricao?.message}
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={abrir.isPending}>
                  {abrir.isPending ? 'Abrindo…' : 'Abrir processo'}
                </Button>
                {abrir.isError && (
                  <p className="mt-2 text-sm text-destructive">
                    {(abrir.error as Error).message}
                  </p>
                )}
              </div>
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-2">
        {(processos ?? []).map((p) => (
          <Link
            key={p.id_processo}
            to={`/processos-disciplinares/${p.id_processo}`}
            className="block rounded-md border border-border bg-card p-3 text-sm hover:bg-muted/40"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {podeAbrir
                  ? (nomesPorId.get(p.id_associado) ??
                    `Associado #${p.id_associado}`)
                  : `Processo #${p.id_processo}`}
              </p>
              <span className={CORES_STATUS[p.status] ?? 'font-medium'}>
                {p.status}
              </span>
            </div>
            <p className="text-muted-foreground">
              Aberto em {formatarData(p.data_abertura)} · prazo de defesa até{' '}
              {formatarData(p.prazo_defesa_ate)}
            </p>
          </Link>
        ))}
        {(processos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum processo disciplinar {podeAbrir ? 'registrado' : 'seu'}{' '}
            ainda.
          </p>
        )}
      </div>
    </>
  )
}

function BlocoManifestacoes({ idProcesso }: { idProcesso: number }) {
  const { data: me } = useMe()
  const podeGerir = me?.permissoes.includes('governanca') ?? false
  const queryClient = useQueryClient()

  const { data: resultado } = useQuery({
    queryKey: ['manifestacoes', idProcesso],
    queryFn: () => verManifestacoes(idProcesso),
    enabled: podeGerir,
  })

  const manifestar = useMutation({
    mutationFn: (v: z.infer<typeof manifestacaoCriarSchema>) =>
      registrarManifestacao(idProcesso, {
        pena_proposta: v.pena_proposta || undefined,
        justificativa: v.justificativa || undefined,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['manifestacoes', idProcesso],
      }),
  })

  if (!podeGerir) return null

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-2 font-semibold">
        Manifestações da Diretoria Executiva
      </h2>
      {resultado && (
        <p className="mb-3 text-sm text-muted-foreground">
          {resultado.manifestacoes}/{resultado.quorum_minimo} manifestações
          (entre {resultado.diretores_aptos} diretores aptos) ·{' '}
          {resultado.quorum_atingido ? (
            <span className="font-medium text-green-600">Quórum atingido</span>
          ) : (
            <span className="font-medium text-amber-600">Quórum pendente</span>
          )}
          {resultado.resultado !== null && (
            <>
              {' '}
              · Pena mais votada até agora: {resultado.resultado ?? 'Arquivar'}
            </>
          )}
        </p>
      )}
      <FormShell<z.infer<typeof manifestacaoCriarSchema>>
        schema={manifestacaoCriarSchema}
        defaultValues={{ pena_proposta: '', justificativa: '' }}
        onSubmit={(v) => manifestar.mutateAsync(v)}
        className="space-y-2"
      >
        {(form) => (
          <>
            <select
              {...form.register('pena_proposta')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Propor arquivamento (sem pena)</option>
              <option value="Advertência">Advertência</option>
              <option value="Suspensão">Suspensão</option>
              <option value="Eliminação do quadro social">
                Eliminação do quadro social
              </option>
            </select>
            <input
              {...form.register('justificativa')}
              placeholder="Justificativa (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button type="submit" size="sm" disabled={manifestar.isPending}>
              {manifestar.isPending ? 'Registrando…' : 'Registrar manifestação'}
            </Button>
            {manifestar.isError && (
              <p className="text-sm text-destructive">
                {(manifestar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
    </section>
  )
}

export function ProcessoDisciplinarDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const idProcesso = Number(id)
  const { data: me } = useMe()
  const podeGerir = me?.permissoes.includes('governanca') ?? false
  const queryClient = useQueryClient()

  const { data: processo, isLoading } = useQuery({
    queryKey: ['processo-disciplinar', idProcesso],
    queryFn: () => obterProcessoDisciplinar(idProcesso),
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['processo-disciplinar', idProcesso],
    })
    queryClient.invalidateQueries({ queryKey: ['processos-disciplinares'] })
  }

  const defender = useMutation({
    mutationFn: (v: z.infer<typeof defesaApresentarSchema>) =>
      apresentarDefesa(idProcesso, v.texto),
    onSuccess: invalidar,
  })
  const decidir = useMutation({
    // Achado do Ponto de Revisão FASE 2.5 (2/3): campo numérico opcional em branco chega como 0
    // (react-hook-form + z.coerce.number() nunca deixa undefined um <input> registrado) - 0
    // nunca é válido pra `suspensao_dias` (mínimo 30), e o backend rejeitava toda decisão que
    // não fosse Suspensão por causa disso. Mesmo padrão de sanitização já usado em
    // Mandatos.tsx/BlocoPauta.
    mutationFn: (v: z.infer<typeof decisaoExecutarSchema>) =>
      decidirProcessoDisciplinar(idProcesso, {
        ...v,
        suspensao_dias: v.suspensao_dias || undefined,
      }),
    onSuccess: invalidar,
  })
  const homologar = useMutation({
    mutationFn: (v: z.infer<typeof homologarSchema>) =>
      homologarEliminacao(idProcesso, {
        aprovado: v.aprovado === 'sim',
        justificativa: v.justificativa,
      }),
    onSuccess: invalidar,
  })

  if (isLoading || !processo) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  const souOAcusado = me?.id_associado === processo.id_associado
  const aberto = processo.status === 'Aberto'
  const aguardandoHomologacao =
    processo.status === 'Aguardando homologação da Assembleia'

  return (
    <>
      <PageHeader
        titulo={`Processo disciplinar #${processo.id_processo}`}
        descricao={processo.status}
      />

      <div className="rounded-xl border border-border bg-card p-6">
        <p className="whitespace-pre-wrap text-sm">{processo.descricao}</p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between sm:block">
            <dt className="text-muted-foreground">Aberto em</dt>
            <dd>{formatarData(processo.data_abertura, { comHora: true })}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-muted-foreground">Prazo de defesa até</dt>
            <dd>
              {formatarData(processo.prazo_defesa_ate, { comHora: true })}
            </dd>
          </div>
          {processo.defesa_apresentada_em && (
            <div className="flex justify-between sm:block">
              <dt className="text-muted-foreground">Defesa apresentada em</dt>
              <dd>
                {formatarData(processo.defesa_apresentada_em, {
                  comHora: true,
                })}
              </dd>
            </div>
          )}
          {processo.pena_aplicada && (
            <div className="flex justify-between sm:block">
              <dt className="text-muted-foreground">Pena aplicada</dt>
              <dd>
                {processo.pena_aplicada}
                {processo.escalada_automatica &&
                  ' (escalada automática, Art. 17, I)'}
                {processo.suspensao_dias &&
                  ` — ${processo.suspensao_dias} dias`}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {souOAcusado && aberto && !processo.defesa_apresentada_em && (
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">Apresentar defesa</h2>
          <FormShell<z.infer<typeof defesaApresentarSchema>>
            schema={defesaApresentarSchema}
            defaultValues={{ texto: '' }}
            onSubmit={(v) => defender.mutateAsync(v)}
            className="space-y-2"
          >
            {(form) => (
              <>
                <textarea
                  {...form.register('texto')}
                  rows={4}
                  placeholder="Apresente sua defesa"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.texto?.message} />
                <Button type="submit" disabled={defender.isPending}>
                  {defender.isPending ? 'Enviando…' : 'Enviar defesa'}
                </Button>
                {defender.isError && (
                  <p className="text-sm text-destructive">
                    {(defender.error as Error).message}
                  </p>
                )}
              </>
            )}
          </FormShell>
        </section>
      )}

      {podeGerir && aberto && <BlocoManifestacoes idProcesso={idProcesso} />}

      {podeGerir && aberto && (
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">Decidir</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Só aceito depois que a defesa foi apresentada ou o prazo esgotou
            (Art. 16), e com o quórum de manifestações atingido - o backend
            recusa se algum dos dois não valer ainda.
          </p>
          <FormShell<z.infer<typeof decisaoExecutarSchema>>
            schema={decisaoExecutarSchema}
            defaultValues={{ texto_decisao: '', suspensao_dias: undefined }}
            onSubmit={(v) => decidir.mutateAsync(v)}
            className="space-y-2"
          >
            {(form) => (
              <>
                <textarea
                  {...form.register('texto_decisao')}
                  rows={3}
                  placeholder="Fundamente a decisão"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.texto_decisao?.message}
                />
                <input
                  type="number"
                  {...form.register('suspensao_dias')}
                  placeholder="Dias de suspensão (só se a pena for Suspensão - 30 a 365)"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <Button type="submit" disabled={decidir.isPending}>
                  {decidir.isPending
                    ? 'Decidindo…'
                    : 'Fechar com a pena decidida'}
                </Button>
                {decidir.isError && (
                  <p className="text-sm text-destructive">
                    {(decidir.error as Error).message}
                  </p>
                )}
              </>
            )}
          </FormShell>
        </section>
      )}

      {podeGerir && aguardandoHomologacao && (
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">
            Homologar eliminação (Art. 17, Parágrafo Único)
          </h2>
          <FormShell<z.infer<typeof homologarSchema>>
            schema={homologarSchema}
            defaultValues={{ aprovado: 'sim', justificativa: '' }}
            onSubmit={(v) => homologar.mutateAsync(v)}
            className="space-y-2"
          >
            {(form) => (
              <>
                <select
                  {...form.register('aprovado')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="sim">Aprovar eliminação</option>
                  <option value="nao">Recusar eliminação</option>
                </select>
                <input
                  {...form.register('justificativa')}
                  placeholder="Justificativa"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.justificativa?.message}
                />
                <Button type="submit" disabled={homologar.isPending}>
                  {homologar.isPending
                    ? 'Registrando…'
                    : 'Registrar homologação'}
                </Button>
                {homologar.isError && (
                  <p className="text-sm text-destructive">
                    {(homologar.error as Error).message}
                  </p>
                )}
              </>
            )}
          </FormShell>
        </section>
      )}
    </>
  )
}
