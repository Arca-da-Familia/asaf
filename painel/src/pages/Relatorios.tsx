import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { formatarData } from '@/lib/datas'
import {
  gerarPrestacaoDeContas,
  listarContasFinanceiras,
  listarPrestacoesDeContas,
  obterBalancete,
  obterExtratoContaFinanceira,
  obterPadroesSuspeitos,
  obterReceitasDespesas,
  obterReceitasDespesasPorCentroCusto,
  obterRelatorioInadimplencia,
  obterRelatorioPorProjeto,
} from '@/lib/api'

// v3.6 (FASE 3 - Financeiro) - demonstrativos financeiros (balancete, receitas x despesas por
// conta/centro de custo, inadimplência, extrato por conta financeira, por projeto) e prestação de
// contas do exercício, versionada, com o parecer do Conselho Fiscal (v2.6) já emitido anexado.
// Exportação contábil pro contador é a FASE 17, já contemplada no desenho desde a v3.0; versão
// pública em /transparencia/ é a FASE 5/12.7, ainda não existe - por ora só a gestão interna.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function primeiroDiaDoAno(): string {
  return `${new Date().getFullYear()}-01-01T00:00:00`
}

function hojeIso(): string {
  return new Date().toISOString().slice(0, 19)
}

function useFiltroPeriodo() {
  const [dataInicio, setDataInicio] = useState(primeiroDiaDoAno())
  const [dataFim, setDataFim] = useState(hojeIso())
  return { dataInicio, setDataInicio, dataFim, setDataFim }
}

function FiltroPeriodo({
  dataInicio,
  dataFim,
  onAlterarInicio,
  onAlterarFim,
}: {
  dataInicio: string
  dataFim: string
  onAlterarInicio: (v: string) => void
  onAlterarFim: (v: string) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">De</label>
        <input
          type="date"
          value={dataInicio.slice(0, 10)}
          onChange={(e) => onAlterarInicio(`${e.target.value}T00:00:00`)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Até</label>
        <input
          type="date"
          value={dataFim.slice(0, 10)}
          onChange={(e) => onAlterarFim(`${e.target.value}T23:59:59`)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
    </div>
  )
}

function SecaoBalancete() {
  const { dataInicio, setDataInicio, dataFim, setDataFim } = useFiltroPeriodo()
  const { data: balancete } = useQuery({
    queryKey: ['relatorio-balancete', dataInicio, dataFim],
    queryFn: () => obterBalancete({ dataInicio, dataFim }),
  })

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-2 font-semibold">Balancete por período</h2>
      <FiltroPeriodo
        dataInicio={dataInicio}
        dataFim={dataFim}
        onAlterarInicio={setDataInicio}
        onAlterarFim={setDataFim}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2">Conta</th>
              <th className="py-1 pr-2 text-right">Saldo anterior</th>
              <th className="py-1 pr-2 text-right">Débitos</th>
              <th className="py-1 pr-2 text-right">Créditos</th>
              <th className="py-1 text-right">Saldo atual</th>
            </tr>
          </thead>
          <tbody>
            {(balancete ?? [])
              .filter(
                (l) =>
                  l.saldo_atual !== 0 ||
                  l.debitos_periodo !== 0 ||
                  l.creditos_periodo !== 0,
              )
              .map((l) => (
                <tr key={l.id_conta} className="border-b border-border/50">
                  <td className="py-1 pr-2">
                    {l.codigo_contabil} — {l.descricao_conta}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {formatarReais(l.saldo_anterior)}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {formatarReais(l.debitos_periodo)}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {formatarReais(l.creditos_periodo)}
                  </td>
                  <td className="py-1 text-right font-medium">
                    {formatarReais(l.saldo_atual)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {(balancete ?? []).every(
          (l) =>
            l.saldo_atual === 0 &&
            l.debitos_periodo === 0 &&
            l.creditos_periodo === 0,
        ) && (
          <p className="text-sm text-muted-foreground">
            Sem movimento no período.
          </p>
        )}
      </div>
    </section>
  )
}

function SecaoReceitasDespesas() {
  const { dataInicio, setDataInicio, dataFim, setDataFim } = useFiltroPeriodo()
  const [agruparPorCentroCusto, setAgruparPorCentroCusto] = useState(false)
  const { data: porConta } = useQuery({
    queryKey: ['relatorio-receitas-despesas', dataInicio, dataFim],
    queryFn: () => obterReceitasDespesas({ dataInicio, dataFim }),
    enabled: !agruparPorCentroCusto,
  })
  const { data: porCentroCusto } = useQuery({
    queryKey: ['relatorio-receitas-despesas-centro-custo', dataInicio, dataFim],
    queryFn: () => obterReceitasDespesasPorCentroCusto({ dataInicio, dataFim }),
    enabled: agruparPorCentroCusto,
  })

  const totalReceitas = (porConta ?? [])
    .filter((l) => l.tipo === 'Receita')
    .reduce((s, l) => s + l.valor_periodo, 0)
  const totalDespesas = (porConta ?? [])
    .filter((l) => l.tipo === 'Despesa')
    .reduce((s, l) => s + l.valor_periodo, 0)

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Receitas x despesas</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAgruparPorCentroCusto((v) => !v)}
        >
          {agruparPorCentroCusto ? 'Ver por conta' : 'Ver por centro de custo'}
        </Button>
      </div>
      <FiltroPeriodo
        dataInicio={dataInicio}
        dataFim={dataFim}
        onAlterarInicio={setDataInicio}
        onAlterarFim={setDataFim}
      />
      {!agruparPorCentroCusto && (
        <>
          <div className="space-y-1">
            {(porConta ?? []).map((l) => (
              <div
                key={l.id_conta}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  [{l.tipo}] {l.codigo_contabil} — {l.descricao_conta}
                </span>
                <span
                  className={
                    l.tipo === 'Receita' ? 'text-green-600' : 'text-destructive'
                  }
                >
                  {formatarReais(l.valor_periodo)}
                </span>
              </div>
            ))}
            {(porConta ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Sem receitas/despesas no período.
              </p>
            )}
          </div>
          <p className="mt-2 border-t border-border pt-2 text-sm font-medium">
            Receitas: {formatarReais(totalReceitas)} · Despesas:{' '}
            {formatarReais(totalDespesas)} · Resultado:{' '}
            {formatarReais(totalReceitas - totalDespesas)}
          </p>
        </>
      )}
      {agruparPorCentroCusto && (
        <div className="space-y-1">
          {(porCentroCusto ?? []).map((l) => (
            <div
              key={l.id_centro_custo ?? 'sem-centro'}
              className="flex items-center justify-between text-sm"
            >
              <span>{l.nome_centro_custo}</span>
              <span
                className={
                  l.resultado >= 0 ? 'text-green-600' : 'text-destructive'
                }
              >
                {formatarReais(l.receitas)} − {formatarReais(l.despesas)} ={' '}
                {formatarReais(l.resultado)}
              </span>
            </div>
          ))}
          {(porCentroCusto ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sem movimento no período.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function SecaoInadimplencia() {
  const { data: inadimplencia } = useQuery({
    queryKey: ['relatorio-inadimplencia'],
    queryFn: obterRelatorioInadimplencia,
  })

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Inadimplência</h2>
      <div className="space-y-2">
        {(inadimplencia ?? []).map((l) => (
          <div
            key={l.id_associado}
            className="rounded-md border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">{l.nome_completo}</p>
              <span className="text-destructive">
                {formatarReais(l.total_devido)}
              </span>
            </div>
            <p className="text-muted-foreground">
              {l.quantidade_titulos_vencidos} título(s) vencido(s) · até{' '}
              {l.dias_atraso_maximo} dias de atraso
            </p>
          </div>
        ))}
        {(inadimplencia ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum associado inadimplente no momento.
          </p>
        )}
      </div>
    </section>
  )
}

function SecaoExtratoContaFinanceira() {
  const { data: contas } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })
  const [idContaFinanceira, setIdContaFinanceira] = useState<number>(0)
  const { data: extrato } = useQuery({
    queryKey: ['relatorio-extrato-conta-financeira', idContaFinanceira],
    queryFn: () => obterExtratoContaFinanceira(idContaFinanceira),
    enabled: idContaFinanceira > 0,
  })

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-2 font-semibold">Extrato por Conta Financeira</h2>
      <select
        value={idContaFinanceira}
        onChange={(e) => setIdContaFinanceira(Number(e.target.value))}
        className="mb-4 h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="0">Selecione uma conta financeira…</option>
        {(contas ?? []).map((c) => (
          <option key={c.id_conta_financeira} value={c.id_conta_financeira}>
            {c.codigo_contabil} — {c.descricao_conta}
          </option>
        ))}
      </select>
      {extrato && (
        <>
          <p className="mb-2 text-sm font-medium">
            Saldo atual: {formatarReais(extrato.saldo_atual)}
          </p>
          <div className="space-y-1">
            {extrato.movimentos.map((m, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {formatarData(m.data)} · {m.tipo_partida}
                </span>
                <span>
                  {formatarReais(m.valor)} · saldo {formatarReais(m.saldo_apos)}
                </span>
              </div>
            ))}
            {extrato.movimentos.length === 0 && (
              <p className="text-sm text-muted-foreground">Sem movimentos.</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function SecaoPorProjeto() {
  const { dataInicio, setDataInicio, dataFim, setDataFim } = useFiltroPeriodo()
  const { data: relatorio } = useQuery({
    queryKey: ['relatorio-por-projeto', dataInicio, dataFim],
    queryFn: () => obterRelatorioPorProjeto({ dataInicio, dataFim }),
  })

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-2 font-semibold">Por projeto</h2>
      <FiltroPeriodo
        dataInicio={dataInicio}
        dataFim={dataFim}
        onAlterarInicio={setDataInicio}
        onAlterarFim={setDataFim}
      />
      <div className="space-y-1">
        {(relatorio ?? []).map((l) => (
          <div
            key={l.id_projeto}
            className="flex items-center justify-between text-sm"
          >
            <span>{l.nome_projeto}</span>
            <span
              className={
                l.resultado >= 0 ? 'text-green-600' : 'text-destructive'
              }
            >
              {formatarReais(l.receitas)} − {formatarReais(l.despesas)} ={' '}
              {formatarReais(l.resultado)}
            </span>
          </div>
        ))}
        {(relatorio ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum projeto com centro de custo vinculado e movimento no período.
          </p>
        )}
      </div>
    </section>
  )
}

function SecaoPrestacaoDeContas() {
  const queryClient = useQueryClient()
  const [ano, setAno] = useState(new Date().getFullYear())
  const [aberta, setAberta] = useState<number | null>(null)
  const { data: prestacoes } = useQuery({
    queryKey: ['prestacoes-de-contas'],
    queryFn: () => listarPrestacoesDeContas(),
  })

  const gerar = useMutation({
    mutationFn: (anoExercicio: number) => gerarPrestacaoDeContas(anoExercicio),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['prestacoes-de-contas'] }),
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Prestação de contas do exercício</h2>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Ano do exercício
          </label>
          <input
            type="number"
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
            className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <Button
          size="sm"
          disabled={gerar.isPending}
          onClick={() => gerar.mutate(ano)}
        >
          {gerar.isPending ? 'Gerando…' : 'Gerar nova versão'}
        </Button>
      </div>
      {gerar.isError && (
        <p className="mb-2 text-sm text-destructive">
          {(gerar.error as Error).message}
        </p>
      )}
      <div className="space-y-2">
        {(prestacoes ?? []).map((p) => (
          <div
            key={p.id_prestacao}
            className="rounded-md border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                Exercício {p.ano_exercicio} — versão {p.versao}
                {p.id_parecer && ' · com parecer do Conselho Fiscal anexado'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setAberta((v) =>
                    v === p.id_prestacao ? null : p.id_prestacao,
                  )
                }
              >
                {aberta === p.id_prestacao ? 'Fechar' : 'Ver'}
              </Button>
            </div>
            {aberta === p.id_prestacao && (
              <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-xs">
                {p.conteudo}
              </pre>
            )}
          </div>
        ))}
        {(prestacoes ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma prestação de contas gerada ainda.
          </p>
        )}
      </div>
    </section>
  )
}

function competenciaAtualPadroesSuspeitos(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

// v3.7 (FASE 3) - relatório de exceção mensal para o Conselho Fiscal: padrões suspeitos NUNCA
// bloqueiam nada sozinhos, são achados pra revisão humana (lançamento fora do horário, valor
// perto do teto de alçada, fornecedor novo com pagamento alto, sequência de estornos, pagamento
// logo após troca de dados bancários do fornecedor).
function SecaoPadroesSuspeitos() {
  const [competencia, setCompetencia] = useState(
    competenciaAtualPadroesSuspeitos(),
  )
  const { data: achados } = useQuery({
    queryKey: ['padroes-suspeitos', competencia],
    queryFn: () => obterPadroesSuspeitos(competencia),
  })

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-2 font-semibold">
        Padrões suspeitos (Conselho Fiscal)
      </h2>
      <div className="mb-4">
        <input
          type="month"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="space-y-2">
        {(achados ?? []).map((a, i) => (
          <div key={i} className="rounded-md border border-border p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {a.tipo}
            </p>
            <p>{a.descricao}</p>
          </div>
        ))}
        {(achados ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum padrão suspeito encontrado nesta competência.
          </p>
        )}
      </div>
    </section>
  )
}

export function RelatoriosPage() {
  return (
    <>
      <PageHeader
        titulo="Relatórios"
        descricao="Balancete, receitas x despesas, inadimplência, extrato por conta financeira, por projeto e prestação de contas do exercício."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Relatórios' },
        ]}
      />
      <SecaoBalancete />
      <SecaoReceitasDespesas />
      <SecaoInadimplencia />
      <SecaoExtratoContaFinanceira />
      <SecaoPorProjeto />
      <SecaoPadroesSuspeitos />
      <SecaoPrestacaoDeContas />
    </>
  )
}
