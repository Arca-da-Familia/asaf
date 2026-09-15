import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { listarAssociados, type AssociadoListagem } from '@/lib/api'

// v2.5.1e (FASE 2.5 - Painel, achado do usuário 2026-09-15: "quero saber quantos estão
// inadimplentes, não tem um gráfico") - primeiro dashboard de um módulo. Usa o mesmo dado já
// buscado pra listagem (nenhum endpoint novo) - contagem por situação e por categoria.
const COR_SITUACAO: Record<string, string> = {
  'Ativo - Em Dia': '#16a34a', // mesmo verde (text-green-600) já usado no resto do painel p/ "em dia"
  'Ativo - Inadimplente': 'hsl(var(--destructive))',
  'Suspenso (Estatuto)': '#d97706', // mesmo âmbar (text-amber-600) já usado p/ estado de alerta
  'Em Experiência': '#2563eb',
  Licenciado: '#64748b',
  Desligado: 'hsl(var(--muted-foreground))',
}
const COR_SITUACAO_PADRAO = 'hsl(var(--muted-foreground))'

function contar(
  itens: AssociadoListagem[],
  campo: 'categoria' | 'status_arrolamento',
) {
  const contagem = new Map<string, number>()
  for (const item of itens) {
    const chave = item[campo] || '—'
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
  }
  return Array.from(contagem.entries())
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total)
}

function TooltipContagem({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: { nome: string; total: number } }[]
}) {
  const primeiro = payload?.[0]
  if (!active || !primeiro) return null
  const { nome, total } = primeiro.payload
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{nome}</p>
      <p className="text-muted-foreground">
        {total} associado{total === 1 ? '' : 's'}
      </p>
    </div>
  )
}

export function AssociadosGraficosPage() {
  const { data: associados, isLoading } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })

  const dados = useMemo(() => associados ?? [], [associados])
  const porSituacao = useMemo(
    () => contar(dados, 'status_arrolamento'),
    [dados],
  )
  const porCategoria = useMemo(() => contar(dados, 'categoria'), [dados])
  const inadimplentes = dados.filter(
    (a) => a.status_arrolamento === 'Ativo - Inadimplente',
  ).length
  const emDia = dados.filter(
    (a) => a.status_arrolamento === 'Ativo - Em Dia',
  ).length

  return (
    <>
      <PageHeader
        titulo="Gráficos"
        descricao="Visão geral do cadastro de associados."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Gráficos' },
        ]}
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : dados.length === 0 ? (
        <EmptyState titulo="Nenhum associado cadastrado ainda" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-6">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Total de associados
              </p>
              <p className="mt-1 text-3xl font-bold">{dados.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Ativos em dia
              </p>
              <p className="mt-1 text-3xl font-bold text-green-600">{emDia}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Inadimplentes
              </p>
              <p className="mt-1 text-3xl font-bold text-destructive">
                {inadimplentes}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 font-semibold">Por situação</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={porSituacao}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    type="category"
                    dataKey="nome"
                    width={140}
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    content={<TooltipContagem />}
                    cursor={{ fill: 'hsl(var(--accent))' }}
                  />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={28}>
                    {porSituacao.map((entrada) => (
                      <Cell
                        key={entrada.nome}
                        fill={COR_SITUACAO[entrada.nome] ?? COR_SITUACAO_PADRAO}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 font-semibold">Por categoria</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={porCategoria}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    type="category"
                    dataKey="nome"
                    width={140}
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    content={<TooltipContagem />}
                    cursor={{ fill: 'hsl(var(--accent))' }}
                  />
                  <Bar
                    dataKey="total"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={28}
                    fill="hsl(var(--primary))"
                  />
                </BarChart>
              </ResponsiveContainer>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
