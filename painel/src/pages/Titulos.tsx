import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  aplicarCredito,
  baixarTitulo,
  criarTitulo,
  enviarComprovante,
  listarAssociadosParaSelecao,
  listarCentrosCusto,
  listarCreditosAssociado,
  listarFornecedores,
  listarPlanoContas,
  listarTitulos,
  obterPixTitulo,
  resumirTitulos,
  urlArquivo,
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

function FormularioNovoTitulo({
  onCancelar,
  tipoPadrao = 'A Pagar',
}: {
  onCancelar: () => void
  tipoPadrao?: 'A Pagar' | 'A Receber'
}) {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: associados } = useQuery({
    queryKey: ['associados-selecao'],
    queryFn: listarAssociadosParaSelecao,
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
        tipo_titulo: tipoPadrao,
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
          </>
        )
      }}
    </FormShell>
  )
}

function FormularioBaixa({
  idTitulo,
  saldoDevedor,
  onCancelar,
}: {
  idTitulo: number
  saldoDevedor: number
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
  const contasPassivo = (contas ?? []).filter((c) => c.tipo === 'Passivo')

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
        id_conta_contabil_adiantamento: undefined,
      }}
      onSubmit={(v) => baixar.mutateAsync(v)}
      className="mt-2 grid gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3"
    >
      {(form) => {
        const valorPago = Number(form.watch('valor_pago')) || 0
        const pagouAMais = valorPago > saldoDevedor
        return (
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
            {pagouAMais && (
              <div className="sm:col-span-3">
                <p className="mb-1 text-xs text-muted-foreground">
                  Valor pago maior que o saldo devedor (
                  {formatarReais(saldoDevedor)}) — o excedente vira crédito do
                  associado. Informe onde contabilizá-lo (Passivo):
                </p>
                <select
                  {...form.register('id_conta_contabil_adiantamento')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Conta de adiantamento de associados…</option>
                  {contasPassivo.map((c) => (
                    <option key={c.id_conta} value={c.id_conta}>
                      {c.codigo_contabil} — {c.descricao_conta}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
          </>
        )
      }}
    </FormShell>
  )
}

// v3.2 - Pix estático (BR Code): mostra QR (renderizado no cliente com `qrcode.react`, mesma
// biblioteca já usada pelo MFA) + o "copia e cola" retornado pelo backend, com botão de copiar.
// Só faz sentido para título "A Receber" pendente - "A Pagar" é a ASAF pagando alguém, não
// recebendo.
function PainelPix({ idTitulo }: { idTitulo: number }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['pix-titulo', idTitulo],
    queryFn: () => obterPixTitulo(idTitulo),
  })
  const [copiado, setCopiado] = useState(false)

  if (isLoading)
    return <p className="mt-2 text-xs text-muted-foreground">Gerando Pix…</p>
  if (isError)
    return (
      <p className="mt-2 text-xs text-destructive">
        {(error as Error).message}
      </p>
    )
  if (!data) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 p-3">
      <QRCodeSVG value={data.payload} size={120} />
      <div className="min-w-0 flex-1">
        <p className="mb-1 break-all font-mono text-xs">{data.payload}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(data.payload)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 2000)
          }}
        >
          {copiado ? 'Copiado!' : 'Copiar código Pix'}
        </Button>
      </div>
    </div>
  )
}

// v3.2 - "pagamento a maior (crédito em conta do associado)": o excedente de uma baixa vira
// `CreditoAssociado`, consumível depois em qualquer título futuro do MESMO associado. Painel
// só oferece o botão quando o título tem beneficiário associado (`id_associado`) - crédito de
// associado nunca se aplica a título de fornecedor.
function PainelCredito({
  idTitulo,
  idAssociado,
}: {
  idTitulo: number
  idAssociado: number
}) {
  const queryClient = useQueryClient()
  const { data: creditos, isLoading } = useQuery({
    queryKey: ['creditos-associado', idAssociado],
    queryFn: () => listarCreditosAssociado(idAssociado),
  })
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const contasPassivo = (contas ?? []).filter((c) => c.tipo === 'Passivo')
  const [idCredito, setIdCredito] = useState('')
  const [idConta, setIdConta] = useState('')

  const aplicar = useMutation({
    mutationFn: () =>
      aplicarCredito({
        id_credito: Number(idCredito),
        id_titulo: idTitulo,
        id_conta_contabil_adiantamento: Number(idConta),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
      queryClient.invalidateQueries({
        queryKey: ['creditos-associado', idAssociado],
      })
      setIdCredito('')
      setIdConta('')
    },
  })

  const creditosDisponiveis = (creditos ?? []).filter((c) => c.valor > 0)

  if (isLoading)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Carregando créditos do associado…
      </p>
    )
  if (creditosDisponiveis.length === 0)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Este associado não tem crédito disponível.
      </p>
    )

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/20 p-3">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Crédito
        </label>
        <select
          value={idCredito}
          onChange={(e) => setIdCredito(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Selecione…</option>
          {creditosDisponiveis.map((c) => (
            <option key={c.id_credito} value={c.id_credito}>
              {formatarReais(c.valor)} ({c.origem}, título de origem #
              {c.id_titulo_origem})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Conta de adiantamento (Passivo)
        </label>
        <select
          value={idConta}
          onChange={(e) => setIdConta(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Selecione…</option>
          {contasPassivo.map((c) => (
            <option key={c.id_conta} value={c.id_conta}>
              {c.codigo_contabil} — {c.descricao_conta}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={!idCredito || !idConta || aplicar.isPending}
        onClick={() => aplicar.mutate()}
      >
        {aplicar.isPending ? 'Aplicando…' : 'Aplicar crédito'}
      </Button>
      {aplicar.isSuccess && aplicar.data && (
        <p className="w-full text-xs text-green-600">
          Aplicado {formatarReais(aplicar.data.valor_aplicado)}. Saldo do
          título: {formatarReais(aplicar.data.saldo_devedor_titulo)}. Crédito
          restante: {formatarReais(aplicar.data.saldo_credito_restante)}.
        </p>
      )}
      {aplicar.isError && (
        <p className="w-full text-xs text-destructive">
          {(aplicar.error as Error).message}
        </p>
      )}
    </div>
  )
}

const TITULOS_POR_PAGINA = 25

function mesAtual(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

// Títulos = as entradas (a receber) e as saídas (a pagar). A tela filtra por MÊS de vencimento (começa no mês atual), por situação, por
// categoria (a conta contábil) e por texto, e é paginada. Os filtros ficam no endereço (`?mes=2026-10&status=Pendente&pagina=2`): dá para
// guardar e mandar o link. Há uma página só das entradas e uma só das saídas (`tipoFixo`).
export function TitulosPage({
  tipoFixo,
}: {
  tipoFixo?: 'A Receber' | 'A Pagar'
}) {
  const [filtros, setFiltros] = useSearchParams()
  const [mostrarForm, setMostrarForm] = useState(false)
  const [baixando, setBaixando] = useState<number | null>(null)
  const [mostrandoPix, setMostrandoPix] = useState<number | null>(null)
  const [mostrandoCredito, setMostrandoCredito] = useState<number | null>(null)

  const todoPeriodo = filtros.get('periodo') === 'todos'
  const mes = todoPeriodo ? '' : (filtros.get('mes') ?? mesAtual())
  const status = filtros.get('status') ?? ''
  const tipoTitulo = tipoFixo ?? filtros.get('tipo') ?? ''
  const categoria = filtros.get('categoria') ?? ''
  const busca = filtros.get('busca') ?? ''
  const pagina = Math.max(1, Number(filtros.get('pagina') ?? '1') || 1)

  function mudar(novos: Record<string, string | null>) {
    const proximo = new URLSearchParams(filtros)
    for (const [chave, valor] of Object.entries(novos)) {
      if (valor === null || valor === '') proximo.delete(chave)
      else proximo.set(chave, valor)
    }
    if (!('pagina' in novos)) proximo.delete('pagina')
    setFiltros(proximo, { replace: true })
  }

  // a busca por texto espera a pessoa parar de digitar antes de ir ao servidor
  const [textoBusca, setTextoBusca] = useState(busca)
  useEffect(() => {
    if (textoBusca === busca) return
    const espera = setTimeout(() => mudar({ busca: textoBusca }), 400)
    return () => clearTimeout(espera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoBusca])

  const consulta = {
    status: status || undefined,
    tipo_titulo: tipoTitulo || undefined,
    mes: mes || undefined,
    id_conta_contabil: categoria ? Number(categoria) : undefined,
    busca: busca || undefined,
  }
  const { data: titulos } = useQuery({
    queryKey: ['titulos', status, tipoTitulo, mes, categoria, busca, pagina],
    queryFn: () =>
      listarTitulos({
        ...consulta,
        pagina,
        por_pagina: TITULOS_POR_PAGINA,
      }),
  })
  const { data: resumo } = useQuery({
    queryKey: ['titulos', 'resumo', status, tipoTitulo, mes, categoria, busca],
    queryFn: () => resumirTitulos(consulta),
  })
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const categorias = (contas ?? []).filter((c) =>
    tipoFixo === 'A Receber'
      ? c.tipo === 'Receita'
      : tipoFixo === 'A Pagar'
        ? c.tipo === 'Despesa'
        : c.tipo === 'Receita' || c.tipo === 'Despesa',
  )
  const totalDePaginas = Math.max(
    1,
    Math.ceil((resumo?.total ?? 0) / TITULOS_POR_PAGINA),
  )

  const titulo =
    tipoFixo === 'A Receber'
      ? 'Entradas'
      : tipoFixo === 'A Pagar'
        ? 'Saídas'
        : 'Títulos'

  return (
    <>
      <PageHeader
        titulo={titulo}
        descricao={
          tipoFixo === 'A Receber'
            ? 'Entradas (títulos a receber): mensalidades, doações, taxas. Escolha o mês.'
            : tipoFixo === 'A Pagar'
              ? 'Saídas (títulos a pagar): despesas, compras, reembolsos. Escolha o mês.'
              : 'Títulos a pagar e a receber, e baixa com conta de contrapartida.'
        }
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: titulo },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label
                htmlFor="filtro-mes"
                className="mb-1 block text-xs text-muted-foreground"
              >
                Mês de vencimento
              </label>
              <input
                id="filtro-mes"
                type="month"
                value={mes}
                disabled={todoPeriodo}
                onChange={(e) =>
                  e.target.value &&
                  mudar({ mes: e.target.value, periodo: null })
                }
                className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                todoPeriodo
                  ? mudar({ periodo: null, mes: null })
                  : mudar({ periodo: 'todos', mes: null })
              }
            >
              {todoPeriodo ? 'Voltar ao mês atual' : 'Todo o período'}
            </Button>
            <select
              aria-label="Situação"
              value={status}
              onChange={(e) => mudar({ status: e.target.value })}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos os status</option>
              <option value="Pendente">Pendente</option>
              <option value="Pago">Pago</option>
              <option value="Renegociado">Renegociado</option>
              <option value="Cancelado">Cancelado</option>
            </select>
            {!tipoFixo && (
              <select
                aria-label="Tipo"
                value={tipoTitulo}
                onChange={(e) => mudar({ tipo: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos os tipos</option>
                <option value="A Pagar">A Pagar</option>
                <option value="A Receber">A Receber</option>
              </select>
            )}
            <select
              aria-label="Categoria"
              value={categoria}
              onChange={(e) => mudar({ categoria: e.target.value })}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todas as categorias</option>
              {categorias.map((c) => (
                <option key={c.id_conta} value={c.id_conta}>
                  {c.descricao_conta}
                </option>
              ))}
            </select>
            <input
              type="search"
              aria-label="Buscar por descrição, nome ou fornecedor"
              placeholder="Buscar por descrição, nome ou fornecedor"
              value={textoBusca}
              onChange={(e) => setTextoBusca(e.target.value)}
              className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {tipoFixo === 'A Pagar' && (
              <Button asChild size="sm">
                <Link to="/financeiro/registrar-saida">
                  Registrar saída (já paga)
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMostrarForm((v) => !v)}
            >
              {mostrarForm ? 'Cancelar' : 'Novo título'}
            </Button>
          </div>
        </div>

        {mostrarForm && (
          <FormularioNovoTitulo
            onCancelar={() => setMostrarForm(false)}
            tipoPadrao={tipoFixo ?? 'A Pagar'}
          />
        )}

        {resumo && (
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {resumo.total} título(s) · Original{' '}
            {formatarReais(resumo.soma_original)} · Saldo{' '}
            {formatarReais(resumo.soma_saldo)}
          </p>
        )}

        <div className="v3-space-y-2">
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
              {t.nota_fiscal && (
                <p className="text-xs">
                  <a
                    href={urlArquivo(t.nota_fiscal)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Ver nota fiscal
                  </a>
                </p>
              )}
              {!['Pago', 'Renegociado', 'Cancelado'].includes(t.status) && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-2">
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
                    {t.tipo_titulo === 'A Receber' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setMostrandoPix((v) =>
                            v === t.id_titulo ? null : t.id_titulo,
                          )
                        }
                      >
                        {mostrandoPix === t.id_titulo
                          ? 'Ocultar Pix'
                          : 'Ver Pix'}
                      </Button>
                    )}
                    {t.tipo_titulo === 'A Receber' && t.id_associado && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setMostrandoCredito((v) =>
                            v === t.id_titulo ? null : t.id_titulo,
                          )
                        }
                      >
                        {mostrandoCredito === t.id_titulo
                          ? 'Ocultar crédito'
                          : 'Aplicar crédito'}
                      </Button>
                    )}
                  </div>
                  {baixando === t.id_titulo && (
                    <FormularioBaixa
                      idTitulo={t.id_titulo}
                      saldoDevedor={t.saldo_devedor}
                      onCancelar={() => setBaixando(null)}
                    />
                  )}
                  {mostrandoPix === t.id_titulo && (
                    <PainelPix idTitulo={t.id_titulo} />
                  )}
                  {mostrandoCredito === t.id_titulo && t.id_associado && (
                    <PainelCredito
                      idTitulo={t.id_titulo}
                      idAssociado={t.id_associado}
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

        {totalDePaginas > 1 && (
          <nav
            aria-label="Páginas de títulos"
            className="mt-4 flex items-center justify-between gap-2 text-sm"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={pagina <= 1}
              onClick={() => mudar({ pagina: String(pagina - 1) })}
            >
              Página anterior
            </Button>
            <span className="text-muted-foreground">
              Página {pagina} de {totalDePaginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagina >= totalDePaginas}
              onClick={() => mudar({ pagina: String(pagina + 1) })}
            >
              Próxima página
            </Button>
          </nav>
        )}
      </section>
    </>
  )
}
