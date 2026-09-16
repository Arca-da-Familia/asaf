import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  abrirProcessoDissolucao,
  baixaCadastralDissolucao,
  cancelarProcessoDissolucao,
  concluirLiquidacaoDissolucao,
  deliberarDissolucao,
  destinarPatrimonioDissolucao,
  listarProcessosDissolucao,
  obterProcessoDissolucao,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  baixaCadastralSchema,
  cancelarDissolucaoSchema,
  deliberarDissolucaoSchema,
  destinarPatrimonioSchema,
  liquidacaoConcluirSchema,
  processoDissolucaoCriarSchema,
} from '@/lib/schemas'

// v2.5.6 (FASE 2.5 - Painel) - roteiro de dissolução (backend v2.8, Art. 31). "Espera-se nunca
// usar" - tela rara, mas precisa existir de verdade (item 10 do checklist de revisão não aceita
// "a rota existe, ninguém nunca vai clicar mesmo"). Cinco etapas sequenciais, cada uma só
// habilitada a partir do status exato que o backend exige - a tela nunca antecipa uma ação que
// o backend recusaria, só mostra a próxima etapa válida.
const CORES_STATUS: Record<string, string> = {
  Aberto: 'text-amber-600',
  Deliberada: 'text-blue-600',
  'Liquidação concluída': 'text-blue-600',
  'Patrimônio destinado': 'text-blue-600',
  'Baixa cadastral concluída': 'text-green-600',
  Cancelado: 'text-destructive',
}

export function ProcessosDissolucaoPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const queryClient = useQueryClient()

  const { data: processos } = useQuery({
    queryKey: ['processos-dissolucao'],
    queryFn: listarProcessosDissolucao,
  })

  const abrir = useMutation({
    mutationFn: (v: z.infer<typeof processoDissolucaoCriarSchema>) =>
      abrirProcessoDissolucao(v.motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processos-dissolucao'] })
      setMostrarForm(false)
    },
  })

  return (
    <>
      <PageHeader
        titulo="Processos de dissolução"
        descricao="Roteiro do Art. 31 - deliberação, liquidação, destinação do patrimônio e baixa cadastral."
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          { rotulo: 'Dissolução' },
        ]}
        acoes={
          <Button onClick={() => setMostrarForm((v) => !v)}>
            {mostrarForm ? 'Cancelar' : 'Abrir processo'}
          </Button>
        }
      />

      {mostrarForm && (
        <FormShell<z.infer<typeof processoDissolucaoCriarSchema>>
          schema={processoDissolucaoCriarSchema}
          defaultValues={{ motivo: '' }}
          onSubmit={(v) => abrir.mutateAsync(v)}
          className="mb-6 space-y-2 rounded-xl border border-border bg-card p-6"
        >
          {(form) => (
            <>
              <textarea
                {...form.register('motivo')}
                rows={3}
                placeholder="Descreva o motivo da dissolução (Art. 31)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.motivo?.message} />
              <Button type="submit" disabled={abrir.isPending}>
                {abrir.isPending ? 'Abrindo…' : 'Abrir processo'}
              </Button>
              {abrir.isError && (
                <p className="text-sm text-destructive">
                  {(abrir.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-2">
        {(processos ?? []).map((p) => (
          <Link
            key={p.id_processo_dissolucao}
            to={`/governanca/dissolucao/${p.id_processo_dissolucao}`}
            className="block rounded-md border border-border bg-card p-3 text-sm hover:bg-muted/40"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                Processo #{p.id_processo_dissolucao}
              </p>
              <span className={CORES_STATUS[p.status] ?? 'font-medium'}>
                {p.status}
              </span>
            </div>
            <p className="text-muted-foreground">{p.motivo}</p>
          </Link>
        ))}
        {(processos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum processo de dissolução registrado - o esperado, Art. 31 é
            excepcional.
          </p>
        )}
      </div>
    </>
  )
}

export function ProcessoDissolucaoDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const idProcesso = Number(id)
  const queryClient = useQueryClient()

  const { data: processo, isLoading } = useQuery({
    queryKey: ['processo-dissolucao', idProcesso],
    queryFn: () => obterProcessoDissolucao(idProcesso),
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['processo-dissolucao', idProcesso],
    })
    queryClient.invalidateQueries({ queryKey: ['processos-dissolucao'] })
  }

  const deliberar = useMutation({
    mutationFn: (v: z.infer<typeof deliberarDissolucaoSchema>) =>
      deliberarDissolucao(idProcesso, v.id_deliberacao),
    onSuccess: invalidar,
  })
  const concluirLiquidacao = useMutation({
    mutationFn: (v: z.infer<typeof liquidacaoConcluirSchema>) =>
      concluirLiquidacaoDissolucao(idProcesso, v.observacao),
    onSuccess: invalidar,
  })
  const destinarPatrimonio = useMutation({
    mutationFn: (v: z.infer<typeof destinarPatrimonioSchema>) =>
      destinarPatrimonioDissolucao(idProcesso, {
        ...v,
        entidade_cnpj: v.entidade_cnpj || undefined,
      }),
    onSuccess: invalidar,
  })
  const baixaCadastral = useMutation({
    mutationFn: (v: z.infer<typeof baixaCadastralSchema>) =>
      baixaCadastralDissolucao(idProcesso, v.observacao),
    onSuccess: invalidar,
  })
  const cancelar = useMutation({
    mutationFn: (v: z.infer<typeof cancelarDissolucaoSchema>) =>
      cancelarProcessoDissolucao(idProcesso, v.motivo),
    onSuccess: invalidar,
  })

  if (isLoading || !processo) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  const podeCancelar =
    processo.status !== 'Baixa cadastral concluída' &&
    processo.status !== 'Cancelado'

  return (
    <>
      <PageHeader
        titulo={`Dissolução #${processo.id_processo_dissolucao}`}
        descricao={processo.status}
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          { rotulo: 'Dissolução', href: '/governanca/dissolucao' },
          { rotulo: `#${processo.id_processo_dissolucao}` },
        ]}
        acoes={
          podeCancelar && (
            <FormShell<z.infer<typeof cancelarDissolucaoSchema>>
              schema={cancelarDissolucaoSchema}
              defaultValues={{ motivo: '' }}
              onSubmit={(v) => cancelar.mutateAsync(v)}
              className="flex items-end gap-2"
            >
              {(form) => (
                <>
                  <input
                    {...form.register('motivo')}
                    placeholder="Motivo do cancelamento"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={cancelar.isPending}
                  >
                    Cancelar processo
                  </Button>
                </>
              )}
            </FormShell>
          )
        }
      />

      <div className="rounded-xl border border-border bg-card p-6">
        <p className="whitespace-pre-wrap text-sm">{processo.motivo}</p>
        {processo.motivo_cancelamento && (
          <p className="mt-2 text-sm text-destructive">
            Cancelado: {processo.motivo_cancelamento}
          </p>
        )}
        {cancelar.isError && (
          <p className="mt-2 text-sm text-destructive">
            {(cancelar.error as Error).message}
          </p>
        )}
      </div>

      {processo.status === 'Aberto' && (
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">
            1. Vincular deliberação de dissolução
          </h2>
          <p className="mb-2 text-xs text-muted-foreground">
            A deliberação precisa já existir, ser do tipo &quot;Dissolução&quot;
            (quórum de 2/3, Art. 31) e estar concluída pela Assembleia (ver a
            Ata correspondente).
          </p>
          <FormShell<z.infer<typeof deliberarDissolucaoSchema>>
            schema={deliberarDissolucaoSchema}
            defaultValues={{ id_deliberacao: 0 }}
            onSubmit={(v) => deliberar.mutateAsync(v)}
            className="flex items-end gap-2"
          >
            {(form) => (
              <>
                <input
                  type="number"
                  {...form.register('id_deliberacao')}
                  placeholder="Nº da deliberação"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
                <Button type="submit" disabled={deliberar.isPending}>
                  Vincular
                </Button>
              </>
            )}
          </FormShell>
          {deliberar.isError && (
            <p className="mt-2 text-sm text-destructive">
              {(deliberar.error as Error).message}
            </p>
          )}
        </section>
      )}

      {processo.status === 'Deliberada' && (
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">
            2. Concluir liquidação do passivo
          </h2>
          <FormShell<z.infer<typeof liquidacaoConcluirSchema>>
            schema={liquidacaoConcluirSchema}
            defaultValues={{ observacao: '' }}
            onSubmit={(v) => concluirLiquidacao.mutateAsync(v)}
            className="space-y-2"
          >
            {(form) => (
              <>
                <textarea
                  {...form.register('observacao')}
                  rows={3}
                  placeholder="Descreva como o passivo foi liquidado"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.observacao?.message}
                />
                <Button type="submit" disabled={concluirLiquidacao.isPending}>
                  Registrar liquidação concluída
                </Button>
                {concluirLiquidacao.isError && (
                  <p className="text-sm text-destructive">
                    {(concluirLiquidacao.error as Error).message}
                  </p>
                )}
              </>
            )}
          </FormShell>
        </section>
      )}

      {processo.status === 'Liquidação concluída' && (
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">
            3. Destinar patrimônio remanescente (Art. 31, Parágrafo Único)
          </h2>
          <FormShell<z.infer<typeof destinarPatrimonioSchema>>
            schema={destinarPatrimonioSchema}
            defaultValues={{
              entidade_nome: '',
              entidade_cnpj: '',
              justificativa: '',
              confirma_sede_parauapebas: false,
              confirma_anos_minimos: false,
              confirma_credenciada: false,
            }}
            onSubmit={(v) => destinarPatrimonio.mutateAsync(v)}
            className="space-y-2"
          >
            {(form) => (
              <>
                <input
                  {...form.register('entidade_nome')}
                  placeholder="Nome da entidade destinatária"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.entidade_nome?.message}
                />
                <input
                  {...form.register('entidade_cnpj')}
                  placeholder="CNPJ (opcional)"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <textarea
                  {...form.register('justificativa')}
                  rows={2}
                  placeholder="Justifique por que atende aos critérios do Art. 31, Parágrafo Único"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.justificativa?.message}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...form.register('confirma_sede_parauapebas')}
                  />
                  Confirma sede/atividade preponderante em Parauapebas/PA
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...form.register('confirma_anos_minimos')}
                  />
                  Confirma anos mínimos de existência da entidade
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...form.register('confirma_credenciada')}
                  />
                  Confirma credenciamento pelos órgãos competentes
                </label>
                <Button type="submit" disabled={destinarPatrimonio.isPending}>
                  Registrar destinação
                </Button>
                {destinarPatrimonio.isError && (
                  <p className="text-sm text-destructive">
                    {(destinarPatrimonio.error as Error).message}
                  </p>
                )}
              </>
            )}
          </FormShell>
        </section>
      )}

      {processo.status === 'Patrimônio destinado' && (
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">4. Registrar baixa cadastral</h2>
          <p className="mb-2 text-sm text-muted-foreground">
            Patrimônio destinado a {processo.entidade_destinataria_nome}
            {processo.entidade_destinataria_cnpj &&
              ` (CNPJ ${processo.entidade_destinataria_cnpj})`}
            .
          </p>
          <FormShell<z.infer<typeof baixaCadastralSchema>>
            schema={baixaCadastralSchema}
            defaultValues={{ observacao: '' }}
            onSubmit={(v) => baixaCadastral.mutateAsync(v)}
            className="space-y-2"
          >
            {(form) => (
              <>
                <textarea
                  {...form.register('observacao')}
                  rows={2}
                  placeholder="Descreva a baixa cadastral realizada"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.observacao?.message}
                />
                <Button type="submit" disabled={baixaCadastral.isPending}>
                  Concluir roteiro (baixa cadastral)
                </Button>
                {baixaCadastral.isError && (
                  <p className="text-sm text-destructive">
                    {(baixaCadastral.error as Error).message}
                  </p>
                )}
              </>
            )}
          </FormShell>
        </section>
      )}

      {processo.status === 'Baixa cadastral concluída' && (
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold text-green-600">
            Roteiro de dissolução concluído
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Baixa cadastral registrada em{' '}
            {formatarData(processo.baixa_cadastral_em ?? '', { comHora: true })}
            .
          </p>
        </section>
      )}
    </>
  )
}
