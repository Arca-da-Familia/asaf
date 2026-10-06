import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
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
  ApiError,
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

  const { data: processos, isLoading: carregando } = useQuery({
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
          className="mb-6 v3-space-y-2 rounded-xl border border-border bg-card p-6"
        >
          {(form) => (
            <>
              <textarea
                {...form.register('motivo')}
                rows={3}
                aria-label="Motivo da dissolução"
                placeholder="Descreva o motivo da dissolução (Art. 31)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.motivo?.message} />
              <Button type="submit" disabled={abrir.isPending}>
                {abrir.isPending ? 'Abrindo…' : 'Abrir processo'}
              </Button>
            </>
          )}
        </FormShell>
      )}

      <div className="v3-space-y-2">
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
        {carregando && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {!carregando && (processos ?? []).length === 0 && (
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

  const {
    data: processo,
    isLoading,
    error: erroDeLeitura,
  } = useQuery({
    queryKey: ['processo-dissolucao', idProcesso],
    queryFn: () => obterProcessoDissolucao(idProcesso),
    retry: (tentativas, erro) =>
      !(erro instanceof ApiError && erro.status < 500) && tentativas < 2,
  })
  // As etapas que não têm volta (cancelar, destinar o patrimônio, a baixa cadastral) só valem depois de uma confirmação explícita:
  // o formulário valida, guarda os valores e o diálogo pergunta de novo, dizendo o que vai acontecer.
  const [pendente, setPendente] = useState<
    | { etapa: 'cancelar'; valores: z.infer<typeof cancelarDissolucaoSchema> }
    | { etapa: 'destinar'; valores: z.infer<typeof destinarPatrimonioSchema> }
    | { etapa: 'baixa'; valores: z.infer<typeof baixaCadastralSchema> }
    | null
  >(null)
  const [erroDaEtapa, setErroDaEtapa] = useState<string | null>(null)

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

  async function confirmarEtapa() {
    if (!pendente) return
    setErroDaEtapa(null)
    try {
      if (pendente.etapa === 'cancelar')
        await cancelar.mutateAsync(pendente.valores)
      else if (pendente.etapa === 'destinar')
        await destinarPatrimonio.mutateAsync(pendente.valores)
      else await baixaCadastral.mutateAsync(pendente.valores)
    } catch (e) {
      setErroDaEtapa(
        e instanceof Error ? e.message : 'Não foi possível concluir a etapa.',
      )
    } finally {
      setPendente(null)
    }
  }

  if (erroDeLeitura) {
    return (
      <>
        <p role="alert" className="text-sm text-destructive">
          {(erroDeLeitura as Error).message}
        </p>
        <Link
          to="/governanca/dissolucao"
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          Voltar aos processos de dissolução
        </Link>
      </>
    )
  }
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
              onSubmit={(v) => setPendente({ etapa: 'cancelar', valores: v })}
              className="flex items-end gap-2"
            >
              {(form) => (
                <>
                  <div>
                    <input
                      {...form.register('motivo')}
                      aria-label="Motivo do cancelamento"
                      placeholder="Motivo do cancelamento"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <ErroCampo
                      mensagem={form.formState.errors.motivo?.message}
                    />
                  </div>
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

      {erroDaEtapa && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {erroDaEtapa}
        </p>
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        <p className="whitespace-pre-wrap text-sm">{processo.motivo}</p>
        {processo.motivo_cancelamento && (
          <p className="mt-2 text-sm text-destructive">
            Cancelado: {processo.motivo_cancelamento}
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
                <div>
                  <input
                    type="number"
                    {...form.register('id_deliberacao')}
                    aria-label="Nº da deliberação"
                    placeholder="Nº da deliberação"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.id_deliberacao?.message}
                  />
                </div>
                <Button type="submit" disabled={deliberar.isPending}>
                  Vincular
                </Button>
              </>
            )}
          </FormShell>
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
            className="v3-space-y-2"
          >
            {(form) => (
              <>
                <textarea
                  {...form.register('observacao')}
                  rows={3}
                  aria-label="Como o passivo foi liquidado"
                  placeholder="Descreva como o passivo foi liquidado"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.observacao?.message}
                />
                <Button type="submit" disabled={concluirLiquidacao.isPending}>
                  Registrar liquidação concluída
                </Button>
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
            onSubmit={(v) => setPendente({ etapa: 'destinar', valores: v })}
            className="v3-space-y-2"
          >
            {(form) => (
              <>
                <input
                  {...form.register('entidade_nome')}
                  aria-label="Nome da entidade destinatária"
                  placeholder="Nome da entidade destinatária"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.entidade_nome?.message}
                />
                <input
                  {...form.register('entidade_cnpj')}
                  aria-label="CNPJ da entidade (opcional)"
                  placeholder="CNPJ (opcional)"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <textarea
                  {...form.register('justificativa')}
                  rows={2}
                  aria-label="Justificativa dos critérios do Art. 31"
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
            onSubmit={(v) => setPendente({ etapa: 'baixa', valores: v })}
            className="v3-space-y-2"
          >
            {(form) => (
              <>
                <textarea
                  {...form.register('observacao')}
                  rows={2}
                  aria-label="Baixa cadastral realizada"
                  placeholder="Descreva a baixa cadastral realizada"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.observacao?.message}
                />
                <Button type="submit" disabled={baixaCadastral.isPending}>
                  Concluir roteiro (baixa cadastral)
                </Button>
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

      <ConfirmDialog
        aberto={pendente !== null}
        onAbertoChange={(aberto) => {
          if (!aberto) setPendente(null)
        }}
        titulo={
          pendente?.etapa === 'cancelar'
            ? 'Cancelar este processo de dissolução?'
            : pendente?.etapa === 'destinar'
              ? `Destinar o patrimônio a ${pendente.valores.entidade_nome}?`
              : 'Concluir a dissolução (baixa cadastral)?'
        }
        descricao={
          pendente?.etapa === 'cancelar'
            ? 'O processo fica cancelado e não pode ser reaberto: se a associação quiser dissolver depois, abre-se um processo novo. O motivo e quem cancelou ficam na Auditoria.'
            : pendente?.etapa === 'destinar'
              ? 'Isto declara que o patrimônio remanescente foi destinado à entidade informada, com os três critérios do Art. 31 confirmados, e libera a baixa cadastral. Fica na Auditoria e não se desfaz.'
              : 'Encerra o roteiro de dissolução da associação. Fica registrado na Auditoria e não se desfaz.'
        }
        rotuloConfirmar={
          pendente?.etapa === 'cancelar'
            ? 'Cancelar processo'
            : pendente?.etapa === 'destinar'
              ? 'Registrar destinação'
              : 'Concluir dissolução'
        }
        carregando={
          cancelar.isPending ||
          destinarPatrimonio.isPending ||
          baixaCadastral.isPending
        }
        onConfirmar={confirmarEtapa}
      />
    </>
  )
}
