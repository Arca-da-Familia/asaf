import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  baixarTitulo,
  criarTitulo,
  enviarComprovante,
  listarAssociados,
  listarCentrosCusto,
  listarFornecedores,
  listarPlanoContas,
  listarTitulos,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { baixarTituloSchema, tituloCriarSchema } from '@/lib/schemas'

// v2.5.9 (FASE 2.5 - Painel) - Títulos financeiros (a pagar/a receber) e baixa (backend v2.6/
// v3.0, só faltava a tela). `valor_original`/`saldo_devedor` chegam em reais (Decimal
// serializado como número JSON, nunca centavos - mesmo formato confirmado no Conselho Fiscal).
// Estorno de lançamento fica pra v2.5.10 (Razão Contábil) - fora do escopo aqui.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioNovoTitulo({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: fornecedores } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: listarFornecedores,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof tituloCriarSchema>) =>
      criarTitulo({
        tipo_titulo: v.tipo_titulo,
        id_conta_contabil: v.id_conta_contabil,
        // beneficiario_tipo é só do formulário - nunca os dois ids ao mesmo tempo pro backend.
        id_associado:
          v.beneficiario_tipo === 'associado'
            ? v.id_associado || undefined
            : undefined,
        id_fornecedor:
          v.beneficiario_tipo === 'fornecedor'
            ? v.id_fornecedor || undefined
            : undefined,
        descricao: v.descricao,
        valor_original: v.valor_original,
        data_vencimento: v.data_vencimento,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof tituloCriarSchema>>
      schema={tituloCriarSchema}
      defaultValues={{
        tipo_titulo: 'A Pagar',
        id_conta_contabil: 0,
        beneficiario_tipo: 'nenhum',
        descricao: '',
        valor_original: 0,
        data_vencimento: '',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => {
        const beneficiarioTipo = form.watch('beneficiario_tipo')
        return (
          <>
            <div>
              <select
                {...form.register('tipo_titulo')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="A Pagar">A Pagar</option>
                <option value="A Receber">A Receber</option>
              </select>
              <ErroCampo
                mensagem={form.formState.errors.tipo_titulo?.message}
              />
            </div>
            <div>
              <select
                {...form.register('id_conta_contabil')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Selecione a conta contábil…</option>
                {(contas ?? []).map((c) => (
                  <option key={c.id_conta} value={c.id_conta}>
                    {c.codigo_contabil} — {c.descricao_conta} ({c.tipo})
                  </option>
                ))}
              </select>
              <ErroCampo
                mensagem={form.formState.errors.id_conta_contabil?.message}
              />
            </div>
            <div>
              <input
                {...form.register('descricao')}
                placeholder="Descrição"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.descricao?.message} />
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                {...form.register('valor_original')}
                placeholder="Valor original"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.valor_original?.message}
              />
            </div>
            <div>
              <input
                type="date"
                {...form.register('data_vencimento')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.data_vencimento?.message}
              />
            </div>
            <div>
              <select
                {...form.register('beneficiario_tipo')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="nenhum">Sem beneficiário</option>
                <option value="associado">Associado</option>
                <option value="fornecedor">Fornecedor</option>
              </select>
            </div>
            {beneficiarioTipo === 'associado' && (
              <div className="sm:col-span-2">
                <select
                  {...form.register('id_associado')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione o associado…</option>
                  {(associados ?? []).map((a) => (
                    <option key={a.id_associado} value={a.id_associado}>
                      {a.nome_completo}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {beneficiarioTipo === 'fornecedor' && (
              <div className="sm:col-span-2">
                <select
                  {...form.register('id_fornecedor')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione o fornecedor…</option>
                  {(fornecedores ?? []).map((f) => (
                    <option key={f.id_fornecedor} value={f.id_fornecedor}>
                      {f.razao_social}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={criar.isPending}>
                {criar.isPending ? 'Salvando…' : 'Registrar título'}
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
        )
      }}
    </FormShell>
  )
}

function FormularioBaixa({
  idTitulo,
  onCancelar,
}: {
  idTitulo: number
  onCancelar: () => void
}) {
  const queryClient = useQueryClient()
  const [enviandoComprovante, setEnviandoComprovante] = useState(false)
  const [erroComprovante, setErroComprovante] = useState<string | null>(null)
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: centrosCusto } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })
  const contasAtivo = (contas ?? []).filter((c) => c.tipo === 'Ativo')

  const baixar = useMutation({
    mutationFn: (v: z.infer<typeof baixarTituloSchema>) =>
      baixarTitulo({ id_titulo: idTitulo, ...v }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof baixarTituloSchema>>
      schema={baixarTituloSchema}
      defaultValues={{
        valor_pago: 0,
        forma_pagamento: '',
        id_conta_contabil_contrapartida: 0,
        id_centro_custo: undefined,
        data_competencia: '',
        comprovante: '',
      }}
      onSubmit={(v) => baixar.mutateAsync(v)}
      className="mt-2 grid gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('valor_pago')}
              placeholder="Valor pago"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.valor_pago?.message} />
          </div>
          <div>
            <input
              {...form.register('forma_pagamento')}
              placeholder="Forma de pagamento"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.forma_pagamento?.message}
            />
          </div>
          <div>
            <select
              {...form.register('id_conta_contabil_contrapartida')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta de contrapartida (Caixa/Banco)…</option>
              {contasAtivo.map((c) => (
                <option key={c.id_conta} value={c.id_conta}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={
                form.formState.errors.id_conta_contabil_contrapartida?.message
              }
            />
          </div>
          <div>
            <select
              {...form.register('id_centro_custo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem centro de custo</option>
              {(centrosCusto ?? [])
                .filter((c) => c.ativo)
                .map((c) => (
                  <option key={c.id_centro_custo} value={c.id_centro_custo}>
                    {c.codigo} — {c.nome}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <input
              type="date"
              {...form.register('data_competencia')}
              title="Data de competência (opcional - se vazia, usa a data de hoje)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              disabled={enviandoComprovante}
              onChange={async (e) => {
                const arquivo = e.target.files?.[0]
                if (!arquivo) return
                setErroComprovante(null)
                setEnviandoComprovante(true)
                try {
                  const { comprovante } = await enviarComprovante(arquivo)
                  form.setValue('comprovante', comprovante)
                } catch (erro) {
                  setErroComprovante((erro as Error).message)
                } finally {
                  setEnviandoComprovante(false)
                }
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            {enviandoComprovante && (
              <p className="text-xs text-muted-foreground">Enviando…</p>
            )}
            {form.watch('comprovante') && (
              <p className="text-xs text-green-600">Comprovante anexado.</p>
            )}
            {erroComprovante && (
              <p className="text-xs text-destructive">{erroComprovante}</p>
            )}
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={baixar.isPending}>
              {baixar.isPending ? 'Baixando…' : 'Confirmar baixa'}
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
          {baixar.isError && (
            <p className="text-sm text-destructive sm:col-span-3">
              {(baixar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

export function TitulosPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [baixando, setBaixando] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [tipoTitulo, setTipoTitulo] = useState('')

  const { data: titulos } = useQuery({
    queryKey: ['titulos', status, tipoTitulo],
    queryFn: () =>
      listarTitulos({
        status: status || undefined,
        tipo_titulo: tipoTitulo || undefined,
      }),
  })

  return (
    <>
      <PageHeader
        titulo="Títulos"
        descricao="Títulos a pagar e a receber, e baixa com conta de contrapartida."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Títulos' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos os status</option>
              <option value="Pendente">Pendente</option>
              <option value="Pago">Pago</option>
            </select>
            <select
              value={tipoTitulo}
              onChange={(e) => setTipoTitulo(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos os tipos</option>
              <option value="A Pagar">A Pagar</option>
              <option value="A Receber">A Receber</option>
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Novo título'}
          </Button>
        </div>

        {mostrarForm && (
          <FormularioNovoTitulo onCancelar={() => setMostrarForm(false)} />
        )}

        <div className="space-y-2">
          {(titulos ?? []).map((t) => (
            <div
              key={t.id_titulo}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {t.tipo_titulo} — {t.descricao}
                </p>
                <span
                  className={
                    t.status === 'Pago'
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                  }
                >
                  {t.status}
                </span>
              </div>
              <p className="text-muted-foreground">
                {t.conta_contabil} · {t.beneficiario} · Vencimento{' '}
                {formatarData(t.data_vencimento)}
              </p>
              <p className="text-muted-foreground">
                Original {formatarReais(t.valor_original)} · Saldo{' '}
                {formatarReais(t.saldo_devedor)}
              </p>
              {t.status !== 'Pago' && (
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setBaixando((v) =>
                        v === t.id_titulo ? null : t.id_titulo,
                      )
                    }
                  >
                    {baixando === t.id_titulo ? 'Cancelar baixa' : 'Baixar'}
                  </Button>
                  {baixando === t.id_titulo && (
                    <FormularioBaixa
                      idTitulo={t.id_titulo}
                      onCancelar={() => setBaixando(null)}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          {(titulos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum título encontrado.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
