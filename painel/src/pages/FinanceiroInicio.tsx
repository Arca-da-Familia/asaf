// v9.6b - a VISÃO GERAL do Financeiro (escolha do Presidente, rodada 7b, `fin-inicio-2`: no computador "Com a cor do lado e o botão da ação", no celular
// "Os 4 lugares mudam sozinhos", sobre a base aprovada "Saldo em destaque e botões de ação" / "Saldo verde e atalhos").
//
// O alto: o mês, "Registrar saída" e "Novo título". O saldo nas contas em destaque, conta por conta, com o que entrou e saiu no mês escolhido. Depois, 6
// LUGARES que mudam sozinhos (4 no celular), nesta ordem: 1º o que está em atraso (faixa vermelha, o único vermelho da tela), 2º o que precisa de você
// (faixa ouro) e, no que sobrar, as telas que você mais abriu nos últimos 30 dias (faixa verde). Cada lugar tem a ação ali mesmo: "Aprovar" abre uma janela
// com o resumo do pedido (valor, fornecedor, a regra da alçada e quem já assinou) e só ali se aprova, nunca num clique só; o servidor revalida a alçada. As
// pendências vêm de `GET /api/financeiro/pendencias` (só de quem opera: quem só audita nem chega aqui, vai ao Conselho Fiscal). Por fim, os próximos
// vencimentos. A grade com todas as telas saiu: o menu do módulo já tem.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { ArrowUpFromLine, Plus } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'

import { SeletorDoMes } from '@/components/data/SeletorDoMes'
import { DialogoDeFormulario } from '@/components/feedback/DialogoDeFormulario'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  aprovarSolicitacaoCompra,
  listarContasFinanceiras,
  listarTitulos,
  obterReceitasDespesasPorCentroCusto,
  type CompraParaAprovar,
  type ContaFinanceira,
} from '@/lib/api'
import { formatarData, formatarDia } from '@/lib/datas'
import {
  formatarReais,
  LUGARES_NO_CELULAR,
  montarLugares,
  plural,
  type EstadoDoLugar,
  type Lugar,
} from '@/lib/lugares-da-visao-geral'
import { useAberturas } from '@/lib/mais-usados'
import {
  limitesDoMes,
  mesDeHoje,
  mesValido,
  nomeCurtoDoMes,
  nomeDoMes,
} from '@/lib/meses'
import { itensVisiveis, modulos } from '@/lib/modulos'
import {
  CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO,
  usePendenciasDoFinanceiro,
} from '@/lib/pendencias-do-modulo'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

/** AAAA-MM-DD do dia no aparelho de quem usa. */
function diaLocal(data: Date): string {
  const doisDigitos = (n: number) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`
}

type Estado = EstadoDoLugar

// a cor da faixa, a frase do estado (no celular, embaixo do título; no computador, só para o leitor de tela, porque a legenda explica as cores)
const ESTADOS: Record<
  Estado,
  { frase: string; legenda: string; faixa: string; corDaFrase: string }
> = {
  atraso: {
    frase: 'Em atraso',
    legenda: 'Em atraso',
    faixa: 'bg-destructive',
    corDaFrase: 'text-destructive',
  },
  pend: {
    frase: 'Precisa de você',
    legenda: 'Precisa de você',
    faixa: 'bg-brand-secondary',
    corDaFrase: 'text-ouro-texto',
  },
  usado: {
    frase: 'Mais usado',
    legenda: 'Seu mais usado',
    faixa: 'bg-primary',
    corDaFrase: 'text-verde-texto',
  },
  atalho: {
    frase: 'Atalho',
    legenda: 'Atalho (até você usar mais telas)',
    faixa: 'bg-input',
    corDaFrase: 'text-muted-foreground',
  },
}

function ConteudoDoLugar({ lugar }: { lugar: Lugar }) {
  const estado = ESTADOS[lugar.estado]
  const cheio = lugar.estado === 'atraso' || lugar.estado === 'pend'
  return (
    <>
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-1 sm:w-[5px]', estado.faixa)}
      />
      <span className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg sm:h-[34px] sm:w-[34px] sm:rounded-[9px]',
            lugar.cor,
          )}
        >
          <lugar.icone className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'text-sm leading-tight font-extrabold [overflow-wrap:anywhere] sm:text-[14.5px]',
              lugar.estado === 'atraso' && 'text-destructive',
            )}
          >
            {lugar.titulo}
          </span>
          <span
            className={cn('text-xs font-bold sm:sr-only', estado.corDaFrase)}
          >
            {' '}
            {estado.frase}
          </span>
          <span className="hidden text-[12.5px] text-muted-foreground [overflow-wrap:anywhere] sm:block">
            {' '}
            {lugar.linha}
          </span>
        </span>
      </span>
      <span className="mt-auto hidden justify-end pt-1 sm:flex">
        <span
          className={cn(
            'inline-flex h-[34px] items-center rounded-md px-3 text-[13px] font-semibold',
            cheio
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-background text-foreground',
          )}
        >
          {' '}
          {lugar.acao}
        </span>
      </span>
    </>
  )
}

const classeDoLugar =
  'relative flex min-h-[88px] w-full min-w-0 flex-col gap-1.5 overflow-hidden rounded-[14px] border border-border bg-card py-2.5 pr-3 pl-3.5 text-left text-card-foreground hover:border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:py-[11px] sm:pr-3.5 sm:pl-4'

function OsLugares({
  lugares,
  aoAprovar,
  botaoAprovar,
}: {
  lugares: Lugar[]
  aoAprovar: () => void
  botaoAprovar: Ref<HTMLButtonElement>
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-3">
      {lugares.map((lugar, i) => (
        <li
          key={lugar.chave}
          data-lugar={lugar.chave}
          data-estado={lugar.estado}
          className={cn('flex', i >= LUGARES_NO_CELULAR && 'hidden sm:flex')}
        >
          {lugar.para ? (
            <Link to={lugar.para} className={classeDoLugar}>
              <ConteudoDoLugar lugar={lugar} />
            </Link>
          ) : (
            <button
              type="button"
              ref={botaoAprovar}
              onClick={aoAprovar}
              className={classeDoLugar}
            >
              <ConteudoDoLugar lugar={lugar} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function Legenda({ estados }: { estados: Estado[] }) {
  const mostrar: Estado[] = ['pend', 'atraso', 'usado']
  if (estados.includes('atalho')) mostrar.push('atalho')
  return (
    <ul
      aria-label="O que cada cor quer dizer"
      className="hidden flex-wrap gap-x-4 gap-y-1 text-[12.5px] sm:flex"
    >
      {mostrar.map((e) => (
        <li key={e} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('h-3 w-3 rounded-[3px]', ESTADOS[e].faixa)}
          />
          {ESTADOS[e].legenda}
        </li>
      ))}
    </ul>
  )
}

function nomeDaConta(c: ContaFinanceira): string {
  return c.descricao_conta ?? c.banco ?? c.tipo_conta_financeira
}

function CartaoDoSaldo({
  contas,
  carregando,
  mes,
  mesAtual,
  movimento,
}: {
  contas: ContaFinanceira[]
  carregando: boolean
  mes: string
  mesAtual: string
  movimento: { receitas: number; despesas: number } | undefined
}) {
  const id = useId()
  const ativas = contas.filter((c) => c.ativo)
  const total = ativas.reduce((soma, c) => soma + c.saldo, 0)
  const positivo = ativas.reduce((soma, c) => soma + Math.max(0, c.saldo), 0)
  const ordenadas = [...ativas].sort((a, b) => b.saldo - a.saldo)
  const mostradas = ordenadas.slice(0, 4)
  const resto = ordenadas.length - mostradas.length
  const nomeDoPeriodo =
    mes.slice(0, 4) === mesAtual.slice(0, 4)
      ? nomeCurtoDoMes(mes)
      : nomeDoMes(mes)
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2 rounded-[18px] bg-barra px-4 py-3 text-barra-foreground sm:gap-2.5 sm:px-5 sm:py-[18px]"
    >
      <h2 id={id} className="text-[13px] font-bold text-barra-suave sm:text-sm">
        Saldo nas contas<span className="hidden sm:inline"> hoje</span>
      </h2>
      <p className="font-titulo text-[26px] font-extrabold tabular-nums sm:text-[34px]">
        {carregando ? '…' : formatarReais(total)}
      </p>
      {mostradas.length > 0 && (
        <>
          <ul className="hidden flex-col gap-2.5 sm:flex">
            {mostradas.map((c) => {
              const parte =
                positivo > 0 ? (Math.max(0, c.saldo) / positivo) * 100 : 0
              return (
                <li
                  key={c.id_conta_financeira}
                  className="flex flex-col gap-1.5"
                >
                  <span className="flex justify-between gap-2 text-[13.5px]">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {nomeDaConta(c)}
                    </span>
                    <strong className="shrink-0 tabular-nums">
                      {formatarReais(c.saldo)}
                    </strong>
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-[7px] rounded-full bg-barra-2"
                  >
                    <span
                      className="block h-[7px] rounded-full bg-brand-secondary"
                      style={{ width: `${Math.round(parte)}%` }}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-[12.5px] text-barra-suave sm:hidden">
            {mostradas
              .map((c) => `${nomeDaConta(c)} ${formatarReais(c.saldo)}`)
              .join(' · ')}
          </p>
        </>
      )}
      {resto > 0 && (
        <p className="text-[13px] text-barra-suave">
          e mais {plural(resto, 'conta', 'contas')} ·{' '}
          <Link
            to="/financeiro/contas-financeiras"
            className="inline-flex min-h-6 items-center font-bold text-barra-foreground underline"
          >
            Ver todas
          </Link>
        </p>
      )}
      <p className="text-[12.5px] text-barra-suave sm:text-[13px]">
        {nomeDoPeriodo}:{' '}
        {movimento
          ? `receitas de ${formatarReais(movimento.receitas)} e despesas de ${formatarReais(movimento.despesas)}`
          : '…'}
      </p>
    </section>
  )
}

function faixaDaAlcada(c: CompraParaAprovar): string {
  return c.alcada.valor_maximo === null
    ? `a partir de ${formatarReais(c.alcada.valor_minimo)}`
    : `de ${formatarReais(c.alcada.valor_minimo)} a ${formatarReais(c.alcada.valor_maximo)}`
}

type Resultado = { ok: boolean; texto: string }

// A janela "Aprovar": o resumo de cada pedido que espera a SUA assinatura e o botão de aprovar de cada um. O servidor revalida a alçada, o cargo, quem pediu
// e as cotações; a recusa dele aparece ali mesmo. Reprovar e os detalhes continuam em Compras.
function JanelaDeAprovar({
  itens,
  total,
  aoFechar,
  devolverFoco,
}: {
  itens: CompraParaAprovar[]
  total: number
  aoFechar: () => void
  devolverFoco: () => HTMLElement | null
}) {
  const queryClient = useQueryClient()
  // o retrato do momento em que a janela abriu: o pedido aprovado continua na janela, com o resultado
  const [pedidos] = useState(itens)
  const [resultados, setResultados] = useState<Record<number, Resultado>>({})
  const [ultimo, setUltimo] = useState<number | null>(null)
  const base = useId()
  const aprovar = useMutation({
    mutationFn: (id: number) => aprovarSolicitacaoCompra(id),
    onSuccess: (resposta, id) => {
      setResultados((atual) => ({
        ...atual,
        [id]: { ok: true, texto: resposta.mensagem },
      }))
      setUltimo(id)
      void queryClient.invalidateQueries({
        queryKey: CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO,
      })
      void queryClient.invalidateQueries({ queryKey: ['solicitacoes-compra'] })
      void queryClient.invalidateQueries({ queryKey: ['titulos'] })
    },
    onError: (erro, id) => {
      setResultados((atual) => ({
        ...atual,
        [id]: {
          ok: false,
          texto:
            erro instanceof ApiError
              ? erro.detail
              : 'Não foi possível aprovar agora (sem conexão com o servidor). Tente de novo.',
        },
      }))
      setUltimo(id)
    },
  })

  // o botão some depois da resposta: o foco vai para a resposta (quem usa teclado ou leitor de tela não se perde)
  useEffect(() => {
    if (ultimo !== null)
      document.getElementById(`${base}-resultado-${ultimo}`)?.focus()
  }, [ultimo, base])

  const primeiroAprovavel = pedidos.find((c) => c.faltam_cotacoes === 0)

  return (
    <DialogoDeFormulario
      titulo={
        pedidos.length === 1 ? 'Compra para aprovar' : 'Compras para aprovar'
      }
      descricao={
        <p>
          Confira cada pedido antes de aprovar. A aprovação segue a regra da
          alçada, como na tela de Compras.
        </p>
      }
      onFechar={aoFechar}
      bloqueado={aprovar.isPending}
      devolverFoco={devolverFoco}
    >
      <ul className="flex flex-col gap-3">
        {pedidos.map((c) => {
          const resultado = resultados[c.id_solicitacao]
          return (
            <li
              key={c.id_solicitacao}
              className="rounded-lg border border-border p-3 text-sm"
            >
              <p className="font-bold [overflow-wrap:anywhere]">
                {c.descricao}
              </p>
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Valor</dt>
                <dd className="font-semibold tabular-nums">
                  {formatarReais(c.valor)}
                </dd>
                <dt className="text-muted-foreground">Fornecedor</dt>
                <dd>{c.fornecedor ?? 'Sem fornecedor'}</dd>
                <dt className="text-muted-foreground">Pedido por</dt>
                <dd>
                  {c.solicitante ?? 'Não informado'}
                  {c.data_solicitacao
                    ? ` em ${formatarData(c.data_solicitacao)}`
                    : ''}
                </dd>
                <dt className="text-muted-foreground">Regra da alçada</dt>
                <dd>
                  {faixaDaAlcada(c)} · {c.alcada.cargos} ·{' '}
                  {c.alcada.exigidas === 2
                    ? 'duas assinaturas'
                    : 'uma assinatura'}
                </dd>
                <dt className="text-muted-foreground">Já assinaram</dt>
                <dd>
                  {c.assinaturas.length
                    ? c.assinaturas
                        .map(
                          (a) =>
                            `${a.nome ?? 'Alguém'}${a.data ? ` em ${formatarData(a.data)}` : ''}`,
                        )
                        .join('; ')
                    : 'Ninguém ainda'}
                </dd>
              </dl>
              {resultado ? (
                <p
                  id={`${base}-resultado-${c.id_solicitacao}`}
                  tabIndex={-1}
                  role={resultado.ok ? 'status' : 'alert'}
                  className={cn(
                    'mt-2 font-semibold',
                    resultado.ok ? 'text-verde-texto' : 'text-destructive',
                  )}
                >
                  {resultado.texto}
                </p>
              ) : c.faltam_cotacoes > 0 ? (
                <p className="mt-2 text-ouro-texto">
                  Faltam {plural(c.faltam_cotacoes, 'cotação', 'cotações')} de
                  fornecedores diferentes antes de aprovar. Registre em Compras.
                </p>
              ) : (
                <Button
                  type="button"
                  className="mt-2 min-h-11 sm:min-h-9"
                  disabled={aprovar.isPending}
                  autoFocus={c === primeiroAprovavel}
                  onClick={() => aprovar.mutate(c.id_solicitacao)}
                >
                  {aprovar.isPending && aprovar.variables === c.id_solicitacao
                    ? 'Aprovando…'
                    : 'Aprovar este pedido'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {total > pedidos.length && (
        <p className="mt-3 text-sm text-muted-foreground">
          Mostrando {pedidos.length} de {total}. Os outros estão em Compras.
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
          <Link to="/financeiro/compras">Abrir Compras</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 sm:min-h-9"
          onClick={aoFechar}
          disabled={aprovar.isPending}
        >
          Fechar
        </Button>
      </div>
    </DialogoDeFormulario>
  )
}

export function FinanceiroInicioPage() {
  const [filtros, setFiltros] = useSearchParams()
  // calculados uma vez ao abrir a tela (a regra de pureza do React não aceita ler o relógio a cada desenho)
  const [{ hoje, mesAtual }] = useState(() => ({
    hoje: diaLocal(new Date()),
    mesAtual: mesDeHoje(),
  }))
  const mes = mesValido(filtros.get('mes')) ?? mesAtual
  const { data: eu } = useMe()
  const permissoes = eu?.permissoes ?? []
  const financeiro = modulos.find((m) => m.rota === '/financeiro')!
  const itens = itensVisiveis(financeiro, permissoes)
  const aberturas = useAberturas(eu?.id_usuario)

  const pendencias = usePendenciasDoFinanceiro(true)
  const { data: contas = [], isLoading: carregandoContas } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })
  const { data: movimento } = useQuery({
    queryKey: ['relatorios', 'receitas-despesas-por-centro-custo', mes],
    queryFn: async () => {
      const { inicio, fim } = limitesDoMes(mes)
      const linhas = await obterReceitasDespesasPorCentroCusto({
        dataInicio: inicio,
        dataFim: `${fim}T23:59:59`,
      })
      return linhas.reduce(
        (soma, l) => ({
          receitas: soma.receitas + Number(l.receitas),
          despesas: soma.despesas + Number(l.despesas),
        }),
        { receitas: 0, despesas: 0 },
      )
    },
  })
  // os próximos vencimentos daqui para a frente (o que já venceu está nos lugares em vermelho)
  const { data: proximos = [] } = useQuery({
    queryKey: ['titulos', 'proximos-vencimentos', hoje],
    queryFn: () =>
      listarTitulos({
        status: 'Pendente',
        data_de: hoje,
        pagina: 1,
        por_pagina: 5,
      }),
  })

  const [aprovando, setAprovando] = useState(false)
  const botaoAprovar = useRef<HTMLButtonElement>(null)

  const carregandoPendencias = pendencias.isLoading
  const lugares = carregandoPendencias
    ? []
    : montarLugares(pendencias.data, itens, aberturas)

  function mudarMes(novo: string) {
    const proximo = new URLSearchParams(filtros)
    if (novo === mesAtual) proximo.delete('mes')
    else proximo.set('mes', novo)
    setFiltros(proximo, { replace: true })
  }

  return (
    <>
      <PageHeader
        titulo="Visão geral"
        descricao="O retrato do dia e o que precisa de você."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Financeiro' },
          { rotulo: 'Visão geral' },
        ]}
        acoes={
          <>
            <SeletorDoMes mes={mes} aoMudar={mudarMes} />
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <Link to="/financeiro/registrar-saida">
                <ArrowUpFromLine aria-hidden="true" />
                Registrar saída
              </Link>
            </Button>
            <Button asChild className="hidden sm:inline-flex">
              <Link to="/financeiro/titulos?novo=1">
                <Plus aria-hidden="true" />
                Novo título
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-3 grid gap-2.5 sm:gap-3.5 xl:grid-cols-[330px_minmax(0,1fr)]">
        <CartaoDoSaldo
          contas={contas}
          carregando={carregandoContas}
          mes={mes}
          mesAtual={mesAtual}
          movimento={movimento}
        />
        <section aria-labelledby="lugares-da-visao-geral" className="min-w-0">
          <h2 id="lugares-da-visao-geral" className="sr-only">
            O que precisa de você e os seus atalhos
          </h2>
          {carregandoPendencias ? (
            <p role="status" className="text-sm text-muted-foreground">
              Carregando o que precisa de você…
            </p>
          ) : (
            <>
              {pendencias.isError && (
                <p role="alert" className="mb-2 text-sm text-destructive">
                  Não deu para ver as pendências agora:{' '}
                  {(pendencias.error as Error).message}
                </p>
              )}
              <OsLugares
                lugares={lugares}
                aoAprovar={() => setAprovando(true)}
                botaoAprovar={botaoAprovar}
              />
            </>
          )}
        </section>
      </div>
      {!carregandoPendencias && (
        <div className="mb-5">
          <Legenda estados={lugares.map((l) => l.estado)} />
        </div>
      )}

      <section
        aria-labelledby="proximos-vencimentos"
        className="rounded-xl border border-border bg-card px-3 py-2.5 sm:px-[18px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="proximos-vencimentos"
            className="font-titulo text-base font-bold"
          >
            Próximos vencimentos
            <span className="hidden sm:inline"> em aberto</span>
          </h2>
          <Link
            to="/financeiro/titulos"
            className="inline-flex min-h-6 items-center text-sm font-bold text-primary underline-offset-4 hover:underline"
          >
            Ver todos os títulos
          </Link>
        </div>
        {proximos.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Nada em aberto vence daqui para a frente.
          </p>
        ) : (
          <ul>
            {proximos.map((t, i) => {
              const receber = t.tipo_titulo === 'A Receber'
              const dia = formatarDia(t.data_vencimento)
              return (
                <li
                  key={t.id_titulo}
                  className={cn(
                    'flex items-center gap-3 border-t border-border py-2 first:border-t-0',
                    i >= 2 && 'hidden sm:flex',
                  )}
                >
                  <span className="shrink-0 text-[13.5px] font-extrabold tabular-nums">
                    {dia.slice(6) === hoje.slice(0, 4) ? dia.slice(0, 5) : dia}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold [overflow-wrap:anywhere]">
                      {t.descricao}
                    </span>
                    <span
                      className={cn(
                        'text-[12.5px] font-bold',
                        receber ? 'text-verde-texto' : 'text-ouro-texto',
                      )}
                    >
                      {receber ? 'A receber' : 'A pagar'}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">
                    {formatarReais(t.saldo_devedor)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {aprovando && pendencias.data && (
        <JanelaDeAprovar
          itens={pendencias.data.compras_para_aprovar.itens}
          total={pendencias.data.compras_para_aprovar.total}
          aoFechar={() => setAprovando(false)}
          devolverFoco={() => botaoAprovar.current}
        />
      )}
    </>
  )
}
