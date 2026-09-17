import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  alternarAlcadaAprovacao,
  criarAlcadaAprovacao,
  criarDelegacaoAprovacao,
  listarAlcadasAprovacao,
  listarAssociados,
  listarDelegacoesAprovacao,
} from '@/lib/api'
import {
  alcadaAprovacaoCriarSchema,
  delegacaoAprovacaoCriarSchema,
} from '@/lib/schemas'

// v3.3 (FASE 3 - Financeiro) - alçada de aprovação (faixa de valor -> cargo(s) autorizados, com
// ou sem dupla assinatura) e delegação temporária rastreável (ex.: tesoureiro de férias delega
// ao vice, sem precisar de um usuário "fantasma" - quem realmente aprova continua registrado).
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioAlcada({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const criar = useMutation({
    mutationFn: (v: z.infer<typeof alcadaAprovacaoCriarSchema>) =>
      criarAlcadaAprovacao({
        valor_minimo: v.valor_minimo,
        valor_maximo: v.valor_maximo ? Number(v.valor_maximo) : null,
        cargos_autorizados: v.cargos_autorizados
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        exige_dupla_assinatura: v.exige_dupla_assinatura,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alcadas-aprovacao'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof alcadaAprovacaoCriarSchema>>
      schema={alcadaAprovacaoCriarSchema}
      defaultValues={{
        valor_minimo: 0,
        valor_maximo: '',
        cargos_autorizados: '',
        exige_dupla_assinatura: false,
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('valor_minimo')}
              placeholder="Valor mínimo"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.valor_minimo?.message} />
          </div>
          <div>
            <input
              {...form.register('valor_maximo')}
              placeholder="Valor máximo (vazio = sem teto)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              {...form.register('cargos_autorizados')}
              placeholder="Cargos (ex.: TESOUREIRO,PRESIDENTE)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.cargos_autorizados?.message}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              {...form.register('exige_dupla_assinatura')}
            />
            Exige dupla assinatura (duas aprovações distintas)
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar alçada'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelar}
            >
              Cancelar
            </Button>
          </div>
          {criar.isError && (
            <p className="text-sm text-destructive sm:col-span-3">
              {(criar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

function FormularioDelegacao({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof delegacaoAprovacaoCriarSchema>) =>
      criarDelegacaoAprovacao(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegacoes-aprovacao'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof delegacaoAprovacaoCriarSchema>>
      schema={delegacaoAprovacaoCriarSchema}
      defaultValues={{
        id_associado_delegante: 0,
        id_associado_delegado: 0,
        data_fim: '',
        motivo: '',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div>
            <select
              {...form.register('id_associado_delegante')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Quem delega…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_associado_delegante?.message}
            />
          </div>
          <div>
            <select
              {...form.register('id_associado_delegado')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Delegado (quem vai aprovar)…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_associado_delegado?.message}
            />
          </div>
          <div>
            <input
              type="date"
              {...form.register('data_fim')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.data_fim?.message} />
          </div>
          <div>
            <input
              {...form.register('motivo')}
              placeholder="Motivo (ex.: férias)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.motivo?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Registrar delegação'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelar}
            >
              Cancelar
            </Button>
          </div>
          {criar.isError && (
            <p className="text-sm text-destructive sm:col-span-2">
              {(criar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

export function AlcadasAprovacaoPage() {
  const [mostrarAlcada, setMostrarAlcada] = useState(false)
  const [mostrarDelegacao, setMostrarDelegacao] = useState(false)
  const queryClient = useQueryClient()

  const { data: alcadas } = useQuery({
    queryKey: ['alcadas-aprovacao'],
    queryFn: listarAlcadasAprovacao,
  })
  const { data: delegacoes } = useQuery({
    queryKey: ['delegacoes-aprovacao'],
    queryFn: listarDelegacoesAprovacao,
  })

  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      alternarAlcadaAprovacao(id, ativo),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['alcadas-aprovacao'] }),
  })

  return (
    <>
      <PageHeader
        titulo="Alçadas de Aprovação"
        descricao="Faixas de valor, cargo exigido e dupla assinatura para aprovar compras — e delegação temporária rastreável."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Alçadas de Aprovação' },
        ]}
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Alçadas cadastradas</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarAlcada((v) => !v)}
          >
            {mostrarAlcada ? 'Cancelar' : 'Nova alçada'}
          </Button>
        </div>
        {mostrarAlcada && (
          <FormularioAlcada onCancelar={() => setMostrarAlcada(false)} />
        )}
        <div className="space-y-2">
          {(alcadas ?? []).map((a) => (
            <div
              key={a.id_alcada}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {formatarReais(a.valor_minimo)} até{' '}
                  {a.valor_maximo != null
                    ? formatarReais(a.valor_maximo)
                    : 'sem teto'}
                </p>
                <span
                  className={
                    a.ativo ? 'text-green-600' : 'text-muted-foreground'
                  }
                >
                  {a.ativo ? 'Ativa' : 'Inativa'}
                </span>
              </div>
              <p className="text-muted-foreground">
                Cargos: {a.cargos_autorizados.join(', ')}
                {a.exige_dupla_assinatura && ' · exige dupla assinatura'}
              </p>
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={alternar.isPending}
                  onClick={() =>
                    alternar.mutate({ id: a.id_alcada, ativo: !a.ativo })
                  }
                >
                  {a.ativo ? 'Inativar' : 'Reativar'}
                </Button>
              </div>
            </div>
          ))}
          {(alcadas ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma alçada cadastrada.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Delegações temporárias</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarDelegacao((v) => !v)}
          >
            {mostrarDelegacao ? 'Cancelar' : 'Nova delegação'}
          </Button>
        </div>
        {mostrarDelegacao && (
          <FormularioDelegacao onCancelar={() => setMostrarDelegacao(false)} />
        )}
        <div className="space-y-2">
          {(delegacoes ?? []).map((d) => (
            <div
              key={d.id_delegacao}
              className="rounded-md border border-border p-3 text-sm"
            >
              <p className="font-medium">
                Associado #{d.id_associado_delegante} → Associado #
                {d.id_associado_delegado}
              </p>
              <p className="text-muted-foreground">
                {d.motivo} · até {d.data_fim}
              </p>
            </div>
          ))}
          {(delegacoes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma delegação registrada.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
