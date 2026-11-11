import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { Paginador } from '@/components/data/Paginador'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  criarContaFinanceira,
  listarContasFinanceiras,
  listarOpcoesCatalogo,
  listarPlanoContas,
} from '@/lib/api'
import { usePaginaLocal } from '@/lib/pagina-local'
import { contaFinanceiraCriarSchema } from '@/lib/schemas'
import { simplificar } from '@/lib/texto'

// v3.1 (FASE 3 - Financeiro) - Contas Financeiras: especialização de PlanoDeContas tipo Ativo
// (Caixa/Banco). Saldo é SEMPRE calculado pelo backend somando as partidas daquela conta (nunca
// um campo editável aqui) - ver app/services/contabilidade.py::saldo_conta.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioContaFinanceira({
  onCancelar,
  aoCriar,
}: {
  onCancelar: () => void
  aoCriar?: (idContaFinanceira: number) => void
}) {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: tipos } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_conta_financeira'],
    queryFn: () => listarOpcoesCatalogo('tipo_conta_financeira'),
  })
  // só conta Ativo e analítica (sem filha) pode virar Conta Financeira - o backend recusa o
  // resto, mas já filtramos aqui pra não deixar escolher o que vai falhar.
  const contasElegiveis = (contas ?? []).filter(
    (c) => c.tipo === 'Ativo' && !c.sintetica,
  )

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof contaFinanceiraCriarSchema>) =>
      criarContaFinanceira(v),
    onSuccess: async (criada) => {
      await queryClient.invalidateQueries({ queryKey: ['contas-financeiras'] })
      aoCriar?.(criada.id_conta_financeira)
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof contaFinanceiraCriarSchema>>
      schema={contaFinanceiraCriarSchema}
      defaultValues={{
        id_conta: 0,
        tipo_conta_financeira: '',
        banco: '',
        agencia: '',
        numero_conta: '',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <select
              {...form.register('id_conta')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta contábil (Ativo)…</option>
              {contasElegiveis.map((c) => (
                <option key={c.id_conta} value={c.id_conta}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.id_conta?.message} />
          </div>
          <div>
            <select
              {...form.register('tipo_conta_financeira')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecione o tipo…</option>
              {(tipos ?? []).map((t) => (
                <option key={t.id_opcao} value={t.rotulo}>
                  {t.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.tipo_conta_financeira?.message}
            />
          </div>
          <div>
            <input
              {...form.register('banco')}
              placeholder="Banco (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              {...form.register('agencia')}
              placeholder="Agência (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              {...form.register('numero_conta')}
              placeholder="Número da conta (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar'}
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
        </>
      )}
    </FormShell>
  )
}

const POR_PAGINA = 10

export function ContasFinanceirasPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const { data: contasFinanceiras } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })

  // v9.3x (a tela tinha 7,9 alturas de notebook na homologação: uma conta embaixo da outra): por código contábil, em duas colunas no notebook,
  // com busca (código ou nome, sem acento) e páginas de 10; a conta recém-cadastrada aparece (a lista vai à página dela)
  const [busca, setBusca] = useState('')
  const termo = simplificar(busca.trim())
  const ordenadas = [...(contasFinanceiras ?? [])].sort((a, b) =>
    (a.codigo_contabil ?? '').localeCompare(b.codigo_contabil ?? '', 'pt-BR', {
      numeric: true,
    }),
  )
  const encontradas = termo
    ? ordenadas.filter(
        (cf) =>
          simplificar(cf.codigo_contabil ?? '').includes(termo) ||
          simplificar(cf.descricao_conta ?? '').includes(termo),
      )
    : ordenadas
  const pagina = usePaginaLocal(
    contasFinanceiras ? encontradas : undefined,
    POR_PAGINA,
    termo,
  )
  const [mostrar, setMostrar] = useState<number | null>(null)
  if (mostrar !== null && contasFinanceiras) {
    const posicao = encontradas.findIndex(
      (cf) => cf.id_conta_financeira === mostrar,
    )
    if (posicao >= 0) {
      setMostrar(null)
      pagina.setPagina(Math.floor(posicao / POR_PAGINA) + 1)
    } else if (termo) {
      // a busca em curso não acha a conta nova: sai, e a lista vai à página dela
      setBusca('')
    }
  }

  return (
    <>
      <PageHeader
        titulo="Contas Financeiras"
        descricao="Caixa, contas correntes e aplicações — saldo sempre calculado pela soma dos lançamentos."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Contas Financeiras' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Contas cadastradas</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Nova conta financeira'}
          </Button>
        </div>

        {mostrarForm && (
          <FormularioContaFinanceira
            onCancelar={() => setMostrarForm(false)}
            aoCriar={setMostrar}
          />
        )}

        {(contasFinanceiras ?? []).length > POR_PAGINA && (
          <div className="mb-3 max-w-md">
            <label htmlFor="procurar-conta" className="text-sm font-medium">
              Procurar conta financeira
            </label>
            <input
              id="procurar-conta"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Código ou nome"
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            {termo && (
              <p
                aria-live="polite"
                className="mt-1 text-xs text-muted-foreground"
              >
                {pagina.total}{' '}
                {pagina.total === 1 ? 'conta encontrada' : 'contas encontradas'}
                .
              </p>
            )}
          </div>
        )}

        <div className="grid items-start gap-2 lg:grid-cols-2">
          {pagina.daPagina.map((cf) => (
            <div
              key={cf.id_conta_financeira}
              className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {cf.codigo_contabil} — {cf.descricao_conta}
                </p>
                <p className="text-xs text-muted-foreground">
                  {cf.tipo_conta_financeira}
                  {cf.banco && ` · ${cf.banco}`}
                  {cf.agencia && ` · Ag. ${cf.agencia}`}
                  {cf.numero_conta && ` · Conta ${cf.numero_conta}`}
                </p>
              </div>
              <p className="font-medium">{formatarReais(cf.saldo)}</p>
            </div>
          ))}
          {(contasFinanceiras ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta financeira cadastrada.
            </p>
          )}
          {termo && pagina.total === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta com esse código ou nome.
            </p>
          )}
        </div>
        <Paginador
          pagina={pagina.pagina}
          porPagina={pagina.porPagina}
          total={pagina.total}
          aoMudar={pagina.setPagina}
          rotulo="Páginas das contas financeiras"
        />
      </section>
    </>
  )
}
