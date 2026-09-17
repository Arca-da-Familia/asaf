import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  aprovarSolicitacaoCompra,
  criarSolicitacaoCompra,
  listarCotacoesCompra,
  listarFornecedores,
  listarPlanoContas,
  listarSolicitacoesCompra,
  registrarCotacaoCompra,
  reprovarSolicitacaoCompra,
} from '@/lib/api'
import {
  cotacaoCompraCriarSchema,
  reprovarSolicitacaoSchema,
  solicitacaoCompraCriarSchema,
} from '@/lib/schemas'

// v3.3 (FASE 3 - Financeiro) - solicitação → cotação (acima de valor configurado, ver Planos de
// Contribuição › configurações) → aprovação por alçada (segregação de funções: quem solicita
// nunca aprova) → pagamento (título "A Pagar" de sempre, ver Títulos) → conciliação.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function PainelCotacoesEAprovacao({
  idSolicitacao,
}: {
  idSolicitacao: number
}) {
  const queryClient = useQueryClient()
  const { data: cotacoes } = useQuery({
    queryKey: ['cotacoes-compra', idSolicitacao],
    queryFn: () => listarCotacoesCompra(idSolicitacao),
  })
  const { data: fornecedores } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: listarFornecedores,
  })
  const [mostrarReprovar, setMostrarReprovar] = useState(false)

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['solicitacoes-compra'] })
    queryClient.invalidateQueries({
      queryKey: ['cotacoes-compra', idSolicitacao],
    })
  }

  const cotar = useMutation({
    mutationFn: (v: z.infer<typeof cotacaoCompraCriarSchema>) =>
      registrarCotacaoCompra(idSolicitacao, v),
    onSuccess: invalidar,
  })
  const aprovar = useMutation({
    mutationFn: () => aprovarSolicitacaoCompra(idSolicitacao),
    onSuccess: invalidar,
  })
  const reprovar = useMutation({
    mutationFn: (v: z.infer<typeof reprovarSolicitacaoSchema>) =>
      reprovarSolicitacaoCompra(idSolicitacao, v.motivo),
    onSuccess: () => {
      invalidar()
      setMostrarReprovar(false)
    },
  })

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
      <p className="mb-1 font-medium">Cotações</p>
      <div className="mb-2 space-y-1">
        {(cotacoes ?? []).map((c) => (
          <p key={c.id_cotacao} className="text-xs text-muted-foreground">
            {(fornecedores ?? []).find(
              (f) => f.id_fornecedor === c.id_fornecedor,
            )?.razao_social ?? `Fornecedor #${c.id_fornecedor}`}{' '}
            — {formatarReais(c.valor)}
          </p>
        ))}
        {(cotacoes ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhuma cotação registrada.
          </p>
        )}
      </div>

      <FormShell<z.infer<typeof cotacaoCompraCriarSchema>>
        schema={cotacaoCompraCriarSchema}
        defaultValues={{ id_fornecedor: 0, valor: 0 }}
        onSubmit={(v) => cotar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div>
              <select
                {...form.register('id_fornecedor')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Fornecedor…</option>
                {(fornecedores ?? []).map((f) => (
                  <option key={f.id_fornecedor} value={f.id_fornecedor}>
                    {f.razao_social}
                  </option>
                ))}
              </select>
              <ErroCampo
                mensagem={form.formState.errors.id_fornecedor?.message}
              />
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                {...form.register('valor')}
                placeholder="Valor"
                className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.valor?.message} />
            </div>
            <Button type="submit" size="sm" disabled={cotar.isPending}>
              {cotar.isPending ? 'Salvando…' : 'Adicionar cotação'}
            </Button>
          </>
        )}
      </FormShell>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={aprovar.isPending}
          onClick={() => aprovar.mutate()}
        >
          {aprovar.isPending ? 'Aprovando…' : 'Aprovar'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarReprovar((v) => !v)}
        >
          {mostrarReprovar ? 'Cancelar' : 'Reprovar'}
        </Button>
      </div>
      {aprovar.isError && (
        <p className="mt-1 text-xs text-destructive">
          {(aprovar.error as Error).message}
        </p>
      )}
      {aprovar.isSuccess && aprovar.data && (
        <p className="mt-1 text-xs text-green-600">{aprovar.data.mensagem}</p>
      )}

      {mostrarReprovar && (
        <FormShell<z.infer<typeof reprovarSolicitacaoSchema>>
          schema={reprovarSolicitacaoSchema}
          defaultValues={{ motivo: '' }}
          onSubmit={(v) => reprovar.mutateAsync(v)}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <div className="flex-1">
                <input
                  {...form.register('motivo')}
                  placeholder="Motivo da reprovação"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.motivo?.message} />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={reprovar.isPending}
              >
                Confirmar reprovação
              </Button>
            </>
          )}
        </FormShell>
      )}
    </div>
  )
}

export function ComprasPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [expandida, setExpandida] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const { data: solicitacoes } = useQuery({
    queryKey: ['solicitacoes-compra'],
    queryFn: () => listarSolicitacoesCompra(),
  })
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const contasDespesa = (contas ?? []).filter(
    (c) => c.tipo === 'Despesa' && !c.sintetica,
  )

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof solicitacaoCompraCriarSchema>) =>
      criarSolicitacaoCompra(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solicitacoes-compra'] })
      setMostrarForm(false)
    },
  })

  return (
    <>
      <PageHeader
        titulo="Compras"
        descricao="Solicitação → cotação → aprovação por alçada → pagamento — segregação de funções: quem solicita nunca aprova a própria compra."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Compras' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Solicitações de compra</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Nova solicitação'}
          </Button>
        </div>

        {mostrarForm && (
          <FormShell<z.infer<typeof solicitacaoCompraCriarSchema>>
            schema={solicitacaoCompraCriarSchema}
            defaultValues={{
              descricao: '',
              justificativa: '',
              valor_estimado: 0,
              id_conta_contabil: 0,
            }}
            onSubmit={(v) => criar.mutateAsync(v)}
            className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
          >
            {(form) => (
              <>
                <div className="sm:col-span-2">
                  <input
                    {...form.register('descricao')}
                    placeholder="Descrição da compra"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.descricao?.message}
                  />
                </div>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    {...form.register('valor_estimado')}
                    placeholder="Valor estimado"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.valor_estimado?.message}
                  />
                </div>
                <div>
                  <select
                    {...form.register('id_conta_contabil')}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="0">Conta contábil (Despesa)…</option>
                    {contasDespesa.map((c) => (
                      <option key={c.id_conta} value={c.id_conta}>
                        {c.codigo_contabil} — {c.descricao_conta}
                      </option>
                    ))}
                  </select>
                  <ErroCampo
                    mensagem={form.formState.errors.id_conta_contabil?.message}
                  />
                </div>
                <div className="sm:col-span-2">
                  <textarea
                    {...form.register('justificativa')}
                    placeholder="Justificativa (opcional)"
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm" disabled={criar.isPending}>
                    {criar.isPending ? 'Salvando…' : 'Criar solicitação'}
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
        )}

        <div className="space-y-2">
          {(solicitacoes ?? []).map((s) => (
            <div
              key={s.id_solicitacao}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{s.descricao}</p>
                <span
                  className={
                    s.status === 'Aprovada'
                      ? 'text-green-600'
                      : s.status === 'Reprovada'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  }
                >
                  {s.status}
                </span>
              </div>
              <p className="text-muted-foreground">
                Valor estimado: {formatarReais(s.valor_estimado)}
              </p>
              {s.motivo_reprovacao && (
                <p className="text-muted-foreground">
                  Motivo: {s.motivo_reprovacao}
                </p>
              )}
              {s.status === 'Aguardando Aprovação' && (
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setExpandida((v) =>
                        v === s.id_solicitacao ? null : s.id_solicitacao,
                      )
                    }
                  >
                    {expandida === s.id_solicitacao
                      ? 'Ocultar'
                      : 'Cotações / Aprovar'}
                  </Button>
                  {expandida === s.id_solicitacao && (
                    <PainelCotacoesEAprovacao
                      idSolicitacao={s.id_solicitacao}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          {(solicitacoes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma solicitação de compra.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
