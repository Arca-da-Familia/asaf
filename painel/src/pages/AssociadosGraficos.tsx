import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Filter,
  Printer,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  obterPainelDeGraficosDeAssociados,
  type PainelDeGraficosDeAssociados,
} from '@/lib/api'
import {
  apagarArranjoGuardado,
  arranjoPadrao,
  CATALOGO_DE_GRAFICOS,
  guardarArranjo,
  mesmoArranjo,
  useArranjoGuardado,
  type Arranjo,
  type FiltrosGuardados,
  type IdDoGrafico,
} from '@/lib/graficos-personalizados'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

// v9.5h - Gráficos do módulo Associados no desenho aprovado pelo Presidente (rodada 5, opção 1 no notebook e no celular): filtros no alto (período,
// situação, categoria, bairro), os 6 números principais e uma grade de gráficos; "Personalizar" escolhe o que aparece e em que ordem, guardado por
// pessoa. Os números vêm prontos do servidor (só contagens: nenhum nome, CPF ou contato).
// As cores dos gráficos passaram no conferidor de paleta (daltonismo, brilho e contraste) no claro (cartão branco) e no escuro (cartão #14241c):
// 1 verde, 2 ouro, 3 azul, 4 rosa, 5 roxo - nessa ordem. A cor segue a categoria (pela lista de TODAS, não pela posição no filtro).
const CORES =
  '[--serie-1:#0f8466] [--serie-2:#b67d00] [--serie-3:#2f7fb8] [--serie-4:#c2526b] [--serie-5:#8a5cc2] [--serie-outras:#94a3b8] [--serie-desligado:#cbd5e1] dark:[--serie-1:#2ba37a] dark:[--serie-2:#b8852c] dark:[--serie-3:#3b8fcf] dark:[--serie-4:#d0687f] dark:[--serie-5:#9b7ad6] dark:[--serie-outras:#64748b] dark:[--serie-desligado:#475569]'
const SERIES_DE_CATEGORIA = [
  'var(--serie-1)',
  'var(--serie-2)',
  'var(--serie-3)',
  'var(--serie-4)',
  'var(--serie-5)',
]

// a situação é um ESTADO: a cor acompanha o nome escrito (nunca a cor sozinha); vermelho só para o atraso
const COR_DA_SITUACAO: Record<string, string> = {
  'Ativo - Em Dia': 'var(--serie-1)',
  'Ativo - Inadimplente': 'hsl(var(--destructive))',
  'Em Experiência': 'var(--serie-3)',
  'Suspenso (Estatuto)': 'var(--serie-2)',
  Licenciado: 'var(--serie-outras)',
  Desligado: 'var(--serie-desligado)',
}

const PERIODOS = [
  { meses: '3', nome: 'Últimos 3 meses', curto: '3 meses' },
  { meses: '6', nome: 'Últimos 6 meses', curto: '6 meses' },
  { meses: '12', nome: 'Últimos 12 meses', curto: '12 meses' },
  { meses: '24', nome: 'Últimos 2 anos', curto: '2 anos' },
  { meses: '60', nome: 'Últimos 5 anos', curto: '5 anos' },
]
const PERIODO_PADRAO = '12'
const NOMES_DOS_MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

// "2026-11" -> "nov/26" (eixo) e "novembro de 2026" (dica e tabela)
function mesCurto(mes: string): string {
  const nome = NOMES_DOS_MESES[Number(mes.slice(5, 7)) - 1] ?? ''
  return `${nome.slice(0, 3)}/${mes.slice(2, 4)}`
}
function mesPorExtenso(mes: string): string {
  const nome = NOMES_DOS_MESES[Number(mes.slice(5, 7)) - 1] ?? ''
  return `${nome} de ${mes.slice(0, 4)}`
}
// a largura do eixo dos números acompanha o maior valor (3 algarismos não cabiam em 44 px com a margem negativa)
const larguraDoEixo = (maior: number) =>
  Math.max(32, 14 + String(Math.ceil(maior)).length * 8)
const numero = (n: number) => n.toLocaleString('pt-BR')
const porcento = (parte: number, total: number) =>
  total > 0 ? `${Math.round((parte / total) * 100)}%` : '—'

const CAMPOS_DE_FILTRO = ['meses', 'situacao', 'categoria', 'bairro'] as const

export function AssociadosGraficosPage() {
  const { data: eu } = useMe()
  const idUsuario = eu?.id_usuario
  const [filtros, setFiltros] = useSearchParams()
  const meses = filtros.get('meses') ?? PERIODO_PADRAO
  const situacao = filtros.get('situacao') ?? ''
  const categoria = filtros.get('categoria') ?? ''
  const bairro = filtros.get('bairro') ?? ''
  const filtrosAtuais: FiltrosGuardados = {
    ...(meses !== PERIODO_PADRAO ? { meses } : {}),
    ...(situacao ? { situacao } : {}),
    ...(categoria ? { categoria } : {}),
    ...(bairro ? { bairro } : {}),
  }
  const algumFiltro = Object.keys(filtrosAtuais).length > 0
  const periodo =
    PERIODOS.find((p) => p.meses === meses) ??
    PERIODOS.find((p) => p.meses === PERIODO_PADRAO)!

  const guardado = useArranjoGuardado(idUsuario)
  const [daSessao, setDaSessao] = useState<Arranjo | null>(null)
  const [rascunho, setRascunho] = useState<Arranjo | null>(null)
  const [aviso, setAviso] = useState('')
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const botaoPersonalizar = useRef<HTMLButtonElement>(null)
  const arranjo = rascunho ?? daSessao ?? guardado ?? arranjoPadrao()
  const personalizado = !mesmoArranjo(
    daSessao ?? guardado ?? arranjoPadrao(),
    arranjoPadrao(),
  )

  // quem guardou "abrir com estes filtros" e chega sem filtro no endereço abre com os filtros guardados (uma vez; depois manda o que a pessoa escolher)
  const filtrosAplicados = useRef(false)
  useEffect(() => {
    if (filtrosAplicados.current || !guardado) return
    filtrosAplicados.current = true
    const temFiltroNoEndereco = CAMPOS_DE_FILTRO.some((c) => filtros.has(c))
    if (temFiltroNoEndereco || !guardado.filtros) return
    const proximo = new URLSearchParams()
    for (const [c, v] of Object.entries(guardado.filtros))
      if (v) proximo.set(c, v)
    setFiltros(proximo, { replace: true })
  }, [guardado, filtros, setFiltros])

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: [
      'associados',
      'painel-de-graficos',
      meses,
      situacao,
      categoria,
      bairro,
    ],
    queryFn: () =>
      obterPainelDeGraficosDeAssociados({
        meses: Number(meses),
        situacao: situacao || undefined,
        categoria: categoria || undefined,
        bairro: bairro || undefined,
      }),
    // trocar o filtro mantém o painel na tela (mais claro) até chegar o novo: nada pula
    placeholderData: keepPreviousData,
  })

  function mudar(campo: (typeof CAMPOS_DE_FILTRO)[number], valor: string) {
    const proximo = new URLSearchParams(filtros)
    if (!valor || (campo === 'meses' && valor === PERIODO_PADRAO))
      proximo.delete(campo)
    else proximo.set(campo, valor)
    setFiltros(proximo, { replace: true })
  }
  function limparFiltros() {
    setFiltros(new URLSearchParams(), { replace: true })
  }

  function fecharPersonalizar(texto: string) {
    setRascunho(null)
    setAviso(texto)
    botaoPersonalizar.current?.focus()
  }

  return (
    <div className={CORES}>
      <PageHeader
        titulo="Gráficos"
        descricao="O retrato do quadro de associados. Os números mudam com os filtros."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Gráficos' },
        ]}
      />

      <div className="mb-4 flex flex-col gap-3 print:hidden">
        {/* no celular: o botão dos filtros (abre a lista) e o Personalizar ao lado; no computador, tudo numa linha só (desenho aprovado) */}
        <div className="flex flex-wrap items-stretch gap-2 sm:items-end sm:gap-3">
          <button
            type="button"
            aria-expanded={filtrosAbertos}
            aria-controls="filtros-dos-graficos"
            onClick={() => setFiltrosAbertos((a) => !a)}
            className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm font-bold sm:hidden"
          >
            <Filter className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              Filtros: {periodo.curto}
              {Object.keys(filtrosAtuais).some((c) => c !== 'meses')
                ? ' e mais'
                : ''}
            </span>
          </button>
          <div
            id="filtros-dos-graficos"
            className={cn(
              'order-last w-full flex-col gap-3 sm:order-none sm:contents',
              filtrosAbertos ? 'flex' : 'hidden',
            )}
          >
            <Filtro
              rotulo="Período"
              valor={meses}
              aoMudar={(v) => mudar('meses', v)}
              opcoes={PERIODOS.map((p) => ({ valor: p.meses, nome: p.nome }))}
            />
            <Filtro
              rotulo="Situação"
              valor={situacao}
              aoMudar={(v) => mudar('situacao', v)}
              todas="Todas"
              opcoes={(data?.filtros_disponiveis.situacoes ?? []).map((s) => ({
                valor: s,
                nome: s,
              }))}
            />
            <Filtro
              rotulo="Categoria"
              valor={categoria}
              aoMudar={(v) => mudar('categoria', v)}
              todas="Todas"
              opcoes={(data?.filtros_disponiveis.categorias ?? []).map((c) => ({
                valor: c,
                nome: c,
              }))}
            />
            <Filtro
              rotulo="Bairro"
              valor={bairro}
              aoMudar={(v) => mudar('bairro', v)}
              todas="Todos"
              opcoes={(data?.filtros_disponiveis.bairros ?? []).map((b) => ({
                valor: b,
                nome: b,
              }))}
            />
            {algumFiltro && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 sm:min-h-10"
                onClick={limparFiltros}
              >
                Limpar filtros
              </Button>
            )}
          </div>
          <span className="hidden flex-1 sm:block" />
          <Button
            ref={botaoPersonalizar}
            type="button"
            variant="outline"
            className="min-h-11 min-w-11 px-3 sm:min-h-10"
            aria-haspopup="dialog"
            onClick={() => {
              setAviso('')
              setRascunho(structuredClone(arranjo))
            }}
          >
            <SlidersHorizontal aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Personalizar</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="hidden sm:inline-flex sm:min-h-10"
            onClick={() => window.print()}
          >
            <Printer aria-hidden="true" />
            Imprimir
          </Button>
        </div>
        {personalizado && !rascunho && (
          <p className="text-sm text-muted-foreground">
            Você está vendo o seu painel personalizado
            {daSessao ? ' (só desta vez)' : ''}.{' '}
            <button
              type="button"
              className="font-semibold text-foreground underline underline-offset-2"
              onClick={() => {
                if (idUsuario) apagarArranjoGuardado(idUsuario)
                setDaSessao(null)
                setAviso('O painel padrão voltou.')
              }}
            >
              Voltar ao painel padrão
            </button>
          </p>
        )}
        <p role="status" className="text-sm font-semibold empty:hidden">
          {aviso}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : isError || !data ? (
        <EmptyState
          titulo="Não foi possível carregar os gráficos"
          descricao="Confira a conexão e tente de novo daqui a pouco."
        />
      ) : data.numeros.cadastrados === 0 ? (
        <EmptyState
          titulo="Nenhum associado com estes filtros"
          descricao={
            algumFiltro
              ? 'Mude ou limpe os filtros para ver o quadro.'
              : 'Quando houver associados cadastrados, os números aparecem aqui.'
          }
          acao={
            algumFiltro ? (
              <Button type="button" variant="outline" onClick={limparFiltros}>
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          className={cn(
            'flex flex-col gap-4 transition-opacity',
            isFetching && 'opacity-60',
          )}
          aria-busy={isFetching}
        >
          {arranjo.numeros && <Numeros dados={data} periodo={periodo.curto} />}
          <div className="grid grid-flow-dense gap-4 md:grid-cols-2 xl:grid-cols-6">
            {arranjo.graficos
              .filter((g) => g.visivel)
              .map((g) => (
                <Grafico
                  key={g.id}
                  id={g.id}
                  dados={data}
                  periodo={periodo.curto}
                  situacao={situacao}
                  categoria={categoria}
                />
              ))}
          </div>
          {!arranjo.numeros && arranjo.graficos.every((g) => !g.visivel) && (
            <EmptyState
              titulo="Nada escolhido para aparecer"
              descricao='Use "Personalizar" para escolher os números e os gráficos.'
            />
          )}
        </div>
      )}

      {rascunho && (
        <Personalizar
          rascunho={rascunho}
          mudar={setRascunho}
          filtrosAtuais={filtrosAtuais}
          descricaoDosFiltros={descreverFiltros(periodo.nome, filtrosAtuais)}
          podeGuardar={!!idUsuario}
          aoGuardar={() => {
            if (idUsuario && guardarArranjo(idUsuario, rascunho)) {
              setDaSessao(null)
              fecharPersonalizar('Painel guardado para você.')
            } else {
              setDaSessao(rascunho)
              fecharPersonalizar(
                'Este navegador não deixou guardar: o painel vale só desta vez.',
              )
            }
          }}
          aoUsarSoAgora={() => {
            setDaSessao(rascunho)
            fecharPersonalizar('Valendo só até você sair desta tela.')
          }}
          aoVoltarAoPadrao={() => {
            if (idUsuario) apagarArranjoGuardado(idUsuario)
            setDaSessao(null)
            fecharPersonalizar('O painel padrão voltou.')
          }}
          aoCancelar={() => fecharPersonalizar('')}
        />
      )}
    </div>
  )
}

function nomeDoPeriodo(meses: string | undefined): string {
  return (
    PERIODOS.find((p) => p.meses === (meses ?? PERIODO_PADRAO))?.nome ??
    'Últimos 12 meses'
  )
}

function descreverFiltros(nomeDoPeriodo: string, f: FiltrosGuardados): string {
  return [
    nomeDoPeriodo,
    f.situacao ?? 'todas as situações',
    f.categoria ?? 'todas as categorias',
    f.bairro ?? 'todos os bairros',
  ].join(' · ')
}

function Filtro({
  rotulo,
  valor,
  aoMudar,
  opcoes,
  todas,
}: {
  rotulo: string
  valor: string
  aoMudar: (valor: string) => void
  opcoes: { valor: string; nome: string }[]
  todas?: string
}) {
  const id = useId()
  // o valor escolhido continua na lista mesmo se o servidor ainda não o devolveu (endereço colado, filtro sem ninguém)
  const lista =
    valor && !opcoes.some((o) => o.valor === valor)
      ? [...opcoes, { valor, nome: valor }]
      : opcoes
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:w-44">
      <label htmlFor={id} className="text-sm font-semibold">
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="min-h-11 w-full rounded-md border border-input bg-card px-3 text-sm sm:min-h-10"
      >
        {todas !== undefined && <option value="">{todas}</option>}
        {lista.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.nome}
          </option>
        ))}
      </select>
    </div>
  )
}

// ----------------------------------------------------------------------------------------------------------------------------------------------
// os 6 números do alto
// ----------------------------------------------------------------------------------------------------------------------------------------------
function Numeros({
  dados,
  periodo,
}: {
  dados: PainelDeGraficosDeAssociados
  periodo: string
}) {
  const n = dados.numeros
  const cartoes: {
    rotulo: string
    valor: string
    detalhe: string
    verde?: boolean
  }[] = [
    {
      rotulo: 'No quadro',
      valor: numero(n.no_quadro),
      detalhe: `${numero(n.cadastrados)} cadastrados`,
    },
    {
      rotulo: 'Em dia',
      valor: n.percentual_em_dia === null ? '—' : `${n.percentual_em_dia}%`,
      detalhe:
        n.ativos > 0
          ? `${numero(n.em_dia)} de ${numero(n.ativos)} ativos`
          : 'nenhum ativo',
      verde: true,
    },
    {
      rotulo: 'Entraram',
      valor: n.entraram > 0 ? `+${numero(n.entraram)}` : '0',
      detalhe: `em ${periodo}`,
    },
    { rotulo: 'Saíram', valor: numero(n.sairam), detalhe: `em ${periodo}` },
    {
      rotulo: 'Idade média',
      valor: n.idade_media === null ? '—' : `${n.idade_media} anos`,
      detalhe:
        n.idade_minima === null
          ? 'sem data de nascimento'
          : `de ${n.idade_minima} a ${n.idade_maxima} anos`,
    },
    {
      rotulo: 'Com acesso',
      valor: numero(n.com_acesso),
      detalhe: `ao painel${n.percentual_com_acesso === null ? '' : ` · ${n.percentual_com_acesso}%`}`,
    },
  ]
  return (
    <section aria-label="Números principais">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cartoes.map((c) => (
          <li
            key={c.rotulo}
            className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-card"
          >
            <span className="text-[13px] font-bold text-muted-foreground">
              {c.rotulo}
            </span>
            <span
              className={cn(
                'font-titulo text-2xl font-extrabold',
                c.verde && 'text-verde-texto',
              )}
            >
              {c.valor}
            </span>
            <span className="text-xs text-muted-foreground">{c.detalhe}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ----------------------------------------------------------------------------------------------------------------------------------------------
// o cartão de cada gráfico: título, uma ação (ver a lista), e a troca entre o gráfico e a tabela com os mesmos números
// ----------------------------------------------------------------------------------------------------------------------------------------------
function Cartao({
  titulo,
  largo,
  subtitulo,
  acao,
  tabela,
  children,
}: {
  titulo: string
  largo: boolean
  subtitulo?: ReactNode
  acao?: ReactNode
  tabela: { colunas: string[]; linhas: (string | number)[][] }
  children: ReactNode
}) {
  const id = useId()
  const [emTabela, setEmTabela] = useState(false)
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card break-inside-avoid',
        largo ? 'xl:col-span-3' : 'xl:col-span-2',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 id={id} className="font-titulo text-base font-extrabold">
            {titulo}
          </h2>
          {subtitulo && (
            <p className="text-sm text-muted-foreground">{subtitulo}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm print:hidden">
          {acao}
          <button
            type="button"
            aria-pressed={emTabela}
            onClick={() => setEmTabela((t) => !t)}
            className="inline-flex min-h-8 items-center font-semibold text-azul-texto underline-offset-2 hover:underline"
          >
            {emTabela ? 'Ver o gráfico' : 'Ver em tabela'}
          </button>
        </div>
      </div>
      {!emTabela && children}
      {/* escondida, a tabela é só do leitor de tela: SEM largura inteira (o "w-full" ganhava do "sr-only" e cada tabela invisível esticava a página
          para o lado - achado do robô v9.3b-01 na homologação) */}
      <table className={emTabela ? 'w-full text-sm' : 'sr-only'}>
        <caption className="sr-only">{titulo}</caption>
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {tabela.colunas.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn('py-1.5 font-semibold', i > 0 && 'text-right')}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.linhas.map((linha) => (
            <tr
              key={String(linha[0])}
              className="border-b border-border last:border-0"
            >
              {linha.map((celula, i) =>
                i === 0 ? (
                  <th
                    key={i}
                    scope="row"
                    className="py-1.5 text-left font-normal"
                  >
                    {celula}
                  </th>
                ) : (
                  <td key={i} className="py-1.5 text-right tabular-nums">
                    {typeof celula === 'number' ? numero(celula) : celula}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

const linkDaAcao =
  'inline-flex min-h-8 items-center font-semibold text-azul-texto underline-offset-2 hover:underline'

function Grafico({
  id,
  dados,
  periodo,
  situacao,
  categoria,
}: {
  id: IdDoGrafico
  dados: PainelDeGraficosDeAssociados
  periodo: string
  situacao: string
  categoria: string
}) {
  const largo = CATALOGO_DE_GRAFICOS.find((g) => g.id === id)?.largo ?? false
  const titulo = CATALOGO_DE_GRAFICOS.find((g) => g.id === id)?.titulo ?? ''
  const n = dados.numeros
  // a lista de associados aceita situação e categoria no endereço: "Ver a lista" leva às pessoas daquele pedaço, com o outro filtro que estiver valendo
  const lista = (s: string, c: string) => {
    const p = new URLSearchParams()
    if (s) p.set('situacao', s)
    if (c) p.set('categoria', c)
    const texto = p.toString()
    return `/associados${texto ? `?${texto}` : ''}`
  }

  switch (id) {
    case 'mes': {
      const maiorDoMes = Math.max(
        1,
        ...dados.por_mes.map((m) => Math.max(m.entraram, m.sairam)),
      )
      return (
        <Cartao
          titulo={titulo}
          largo={largo}
          subtitulo={`${numero(n.entraram)} entraram e ${numero(n.sairam)} saíram em ${periodo}`}
          tabela={{
            colunas: ['Mês', 'Entraram', 'Saíram'],
            linhas: dados.por_mes.map((m) => [
              mesPorExtenso(m.mes),
              m.entraram,
              m.sairam,
            ]),
          }}
        >
          <Legenda
            itens={[
              { nome: 'Entraram', cor: 'var(--serie-1)' },
              { nome: 'Saíram', cor: 'var(--serie-2)' },
            ]}
          />
          {/* o desenho fica fora do leitor de tela (a tabela tem os mesmos números); sem a camada de teclado do gráfico (accessibilityLayer), nada
              dentro dele recebe foco - achado do robô de acessibilidade v9.1a-01 */}
          <div aria-hidden="true" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                accessibilityLayer={false}
                data={dados.por_mes.map((m) => ({
                  ...m,
                  rotulo: mesCurto(m.mes),
                }))}
                barGap={2}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="rotulo"
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                  minTickGap={10}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={larguraDoEixo(maiorDoMes)}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                />
                <Tooltip
                  content={<DicaDoMes />}
                  cursor={{ fill: 'hsl(var(--accent))', opacity: 0.6 }}
                />
                <Bar
                  dataKey="entraram"
                  name="Entraram"
                  fill="var(--serie-1)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="sairam"
                  name="Saíram"
                  fill="var(--serie-2)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Cartao>
      )
    }
    case 'quadro': {
      const serie = dados.quadro_por_mes
      const hoje = serie.at(-1)?.total ?? 0
      const variacao = hoje - (serie[0]?.total ?? 0)
      const minimo = Math.min(...serie.map((m) => m.total))
      const maximo = Math.max(...serie.map((m) => m.total))
      const folga = Math.max(1, Math.ceil((maximo - minimo) * 0.15))
      // o eixo começa num número redondo abaixo do menor valor e o gráfico escolhe os degraus (antes terminava em 762)
      const baseDoEixo = Math.max(0, Math.floor((minimo - folga) / 10) * 10)
      return (
        <Cartao
          titulo={titulo}
          largo={largo}
          subtitulo={
            <>
              <strong className="text-foreground">{numero(hoje)}</strong> hoje ·{' '}
              <strong className="text-foreground">
                {variacao > 0 ? '+' : ''}
                {numero(variacao)}
              </strong>{' '}
              em {periodo}
            </>
          }
          tabela={{
            colunas: ['Mês', 'No quadro no fim do mês'],
            linhas: serie.map((m) => [mesPorExtenso(m.mes), m.total]),
          }}
        >
          <div aria-hidden="true" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                accessibilityLayer={false}
                data={serie.map((m) => ({ ...m, rotulo: mesCurto(m.mes) }))}
                margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="rotulo"
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                  minTickGap={10}
                />
                <YAxis
                  allowDecimals={false}
                  domain={[baseDoEixo, 'auto']}
                  tickLine={false}
                  axisLine={false}
                  width={larguraDoEixo(maximo + folga)}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                />
                <Tooltip
                  content={<DicaDoQuadro />}
                  cursor={{
                    stroke: 'hsl(var(--muted-foreground))',
                    strokeWidth: 1,
                  }}
                />
                <Area
                  type="linear"
                  dataKey="total"
                  name="No quadro"
                  stroke="var(--serie-1)"
                  strokeWidth={2}
                  fill="var(--serie-1)"
                  fillOpacity={0.1}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{
                    r: 5,
                    stroke: 'hsl(var(--card))',
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Cartao>
      )
    }
    case 'situacao': {
      const total = dados.por_situacao.reduce((s, x) => s + x.total, 0)
      return (
        <Cartao
          titulo={titulo}
          largo={largo}
          subtitulo="Clique numa situação para ver a lista"
          tabela={{
            colunas: ['Situação', 'Associados', '%'],
            linhas: dados.por_situacao.map((s) => [
              s.nome,
              s.total,
              porcento(s.total, total),
            ]),
          }}
        >
          <BarrasDeitadas
            itens={dados.por_situacao.map((s) => ({
              nome: s.nome,
              total: s.total,
              cor: COR_DA_SITUACAO[s.nome] ?? 'var(--serie-outras)',
              link: lista(s.nome, categoria),
            }))}
            total={total}
            larguraDoNome="sm:w-44"
          />
        </Cartao>
      )
    }
    case 'categoria': {
      const total = dados.por_categoria.reduce((s, x) => s + x.total, 0)
      const todas = dados.filtros_disponiveis.categorias
      const partes = dados.por_categoria.map((c) => {
        const i = todas.indexOf(c.nome)
        return {
          ...c,
          cor:
            i >= 0 && i < SERIES_DE_CATEGORIA.length
              ? SERIES_DE_CATEGORIA[i]!
              : 'var(--serie-outras)',
        }
      })
      return (
        <Cartao
          titulo={titulo}
          largo={largo}
          subtitulo={`${numero(total)} no quadro`}
          tabela={{
            colunas: ['Categoria', 'Associados', '%'],
            linhas: partes.map((c) => [
              c.nome,
              c.total,
              porcento(c.total, total),
            ]),
          }}
        >
          <div
            role="img"
            aria-label={partes
              .map((c) => `${c.nome}: ${c.total} (${porcento(c.total, total)})`)
              .join('; ')}
            className="flex h-7 w-full gap-[2px] overflow-hidden rounded-[4px]"
          >
            {partes
              .filter((c) => c.total > 0)
              .map((c) => (
                <span
                  key={c.nome}
                  className="h-full rounded-[4px]"
                  style={{
                    width: `${(c.total / Math.max(total, 1)) * 100}%`,
                    background: c.cor,
                  }}
                />
              ))}
          </div>
          <ul className="flex flex-col">
            {partes.map((c) => (
              <li key={c.nome}>
                <Link
                  to={lista(situacao, c.nome)}
                  className="flex min-h-10 items-center gap-2 rounded-md px-1 text-sm hover:bg-accent"
                >
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-[3px]"
                    style={{ background: c.cor }}
                  />
                  <span className="min-w-0 flex-1 break-words">{c.nome}</span>
                  <strong>{numero(c.total)}</strong>
                  <span className="w-11 text-right text-muted-foreground">
                    {porcento(c.total, total)}
                  </span>
                  <span className="sr-only">: ver a lista</span>
                </Link>
              </li>
            ))}
          </ul>
        </Cartao>
      )
    }
    case 'idade':
    case 'bairro':
    case 'tempo': {
      const itens =
        id === 'idade'
          ? dados.faixas_de_idade.map((f) => ({
              nome: f.faixa,
              total: f.total,
            }))
          : id === 'bairro'
            ? dados.por_bairro
            : dados.tempo_de_associacao.map((f) => ({
                nome: f.faixa,
                total: f.total,
              }))
      const total = itens.reduce((s, x) => s + x.total, 0)
      const cor =
        id === 'idade'
          ? 'var(--serie-3)'
          : id === 'bairro'
            ? 'var(--serie-1)'
            : 'var(--serie-2)'
      return (
        <Cartao
          titulo={titulo}
          largo={largo}
          subtitulo={`De quem está no quadro (${numero(total)})`}
          tabela={{
            colunas: [id === 'bairro' ? 'Bairro' : 'Faixa', 'Associados', '%'],
            linhas: itens.map((x) => [
              x.nome,
              x.total,
              porcento(x.total, total),
            ]),
          }}
        >
          <BarrasDeitadas
            itens={itens.map((x) => ({ ...x, cor }))}
            total={total}
            larguraDoNome="sm:w-36"
          />
        </Cartao>
      )
    }
    case 'filiacao': {
      const f = dados.filiacao
      const etapas = [
        { nome: 'Pedidos recebidos', total: f.pedidos, segue: true },
        { nome: 'Com os 3 sócios', total: f.com_os_3_socios, segue: true },
        { nome: 'Aprovados', total: f.aprovados, segue: true },
        { nome: 'Recusados', total: f.recusados, segue: false },
      ]
      return (
        <Cartao
          titulo={`Filiação em ${periodo}`}
          largo={largo}
          subtitulo={`${numero(f.em_andamento)} em andamento`}
          acao={
            <Link to="/associados/propostas" className={linkDaAcao}>
              Ver as propostas
            </Link>
          }
          tabela={{
            colunas: ['Etapa', 'Pedidos'],
            linhas: [
              ...etapas.map((e) => [e.nome, e.total]),
              ['Em andamento', f.em_andamento],
            ],
          }}
        >
          <ol className="flex flex-col gap-1.5">
            {etapas.map((e) => (
              <li
                key={e.nome}
                className="flex flex-nowrap items-center gap-2 text-sm"
              >
                <span
                  className={cn(
                    'flex h-7 min-w-10 shrink-0 items-center rounded-[4px] px-2.5 font-extrabold',
                    e.segue ? 'bg-verde-tinta' : 'bg-muted',
                  )}
                  style={{
                    width: `${f.pedidos > 0 ? Math.max(14, (e.total / f.pedidos) * 72) : 14}%`,
                  }}
                >
                  {numero(e.total)}
                </span>
                <span className="min-w-0">{e.nome}</span>
              </li>
            ))}
          </ol>
        </Cartao>
      )
    }
  }
}

// barras deitadas com o nome, a barra (a maior enche o trilho) e o número com a porcentagem na ponta
function BarrasDeitadas({
  itens,
  total,
  larguraDoNome,
}: {
  itens: { nome: string; total: number; cor: string; link?: string }[]
  total: number
  larguraDoNome: string
}) {
  const maior = Math.max(1, ...itens.map((x) => x.total))
  return (
    <ul className="flex flex-col">
      {itens.map((x) => {
        const conteudo = (
          <>
            <span
              className={cn(
                'w-full min-w-0 break-words sm:shrink-0',
                larguraDoNome,
              )}
            >
              {x.nome}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span
                aria-hidden="true"
                className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${x.total > 0 ? Math.max(2, (x.total / maior) * 100) : 0}%`,
                    background: x.cor,
                  }}
                />
              </span>
              <span className="w-20 shrink-0 text-right whitespace-nowrap">
                <strong>{numero(x.total)}</strong>{' '}
                <span className="text-muted-foreground">
                  {porcento(x.total, total)}
                </span>
              </span>
            </span>
          </>
        )
        const classe =
          'flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm sm:flex-nowrap'
        return (
          <li key={x.nome} className="border-b border-border last:border-0">
            {x.link ? (
              <Link
                to={x.link}
                className={cn(classe, 'rounded-md px-1 hover:bg-accent')}
              >
                {conteudo}
                <span className="sr-only">: ver a lista</span>
              </Link>
            ) : (
              <div className={cn(classe, 'px-1')}>{conteudo}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Legenda({ itens }: { itens: { nome: string; cor: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-hidden="true">
      {itens.map((i) => (
        <li key={i.nome} className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-[3px]"
            style={{ background: i.cor }}
          />
          {i.nome}
        </li>
      ))}
    </ul>
  )
}

type DadoDaDica = {
  active?: boolean
  payload?: {
    payload: { mes: string; entraram?: number; sairam?: number; total?: number }
  }[]
}

function CaixaDaDica({
  titulo,
  linhas,
}: {
  titulo: string
  linhas: { cor: string; valor: number; nome: string }[]
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-md">
      <p className="mb-1 text-muted-foreground first-letter:uppercase">
        {titulo}
      </p>
      {linhas.map((l) => (
        <p key={l.nome} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-3 rounded-full"
            style={{ background: l.cor }}
          />
          <strong>{numero(l.valor)}</strong>
          <span className="text-muted-foreground">{l.nome}</span>
        </p>
      ))}
    </div>
  )
}

function DicaDoMes({ active, payload }: DadoDaDica) {
  const ponto = payload?.[0]?.payload
  if (!active || !ponto) return null
  return (
    <CaixaDaDica
      titulo={mesPorExtenso(ponto.mes)}
      linhas={[
        { cor: 'var(--serie-1)', valor: ponto.entraram ?? 0, nome: 'entraram' },
        { cor: 'var(--serie-2)', valor: ponto.sairam ?? 0, nome: 'saíram' },
      ]}
    />
  )
}

function DicaDoQuadro({ active, payload }: DadoDaDica) {
  const ponto = payload?.[0]?.payload
  if (!active || !ponto) return null
  return (
    <CaixaDaDica
      titulo={`Fim de ${mesPorExtenso(ponto.mes)}`}
      linhas={[
        { cor: 'var(--serie-1)', valor: ponto.total ?? 0, nome: 'no quadro' },
      ]}
    />
  )
}

// ----------------------------------------------------------------------------------------------------------------------------------------------
// Personalizar: o painel muda na hora (para a pessoa conferir) e só fica se ela guardar; "Usar só desta vez" vale até sair da tela
// ----------------------------------------------------------------------------------------------------------------------------------------------
function Personalizar({
  rascunho,
  mudar,
  filtrosAtuais,
  descricaoDosFiltros,
  podeGuardar,
  aoGuardar,
  aoUsarSoAgora,
  aoVoltarAoPadrao,
  aoCancelar,
}: {
  rascunho: Arranjo
  mudar: (a: Arranjo) => void
  filtrosAtuais: FiltrosGuardados
  descricaoDosFiltros: string
  podeGuardar: boolean
  aoGuardar: () => void
  aoUsarSoAgora: () => void
  aoVoltarAoPadrao: () => void
  aoCancelar: () => void
}) {
  const idDoTitulo = useId()
  const titulo = useRef<HTMLHeadingElement>(null)
  const janela = useRef<HTMLDivElement>(null)
  useEffect(() => {
    titulo.current?.focus()
  }, [])

  // o Tab não sai da janela; Esc fecha sem mudar nada
  function teclas(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      aoCancelar()
      return
    }
    if (e.key !== 'Tab' || !janela.current) return
    const focaveis = Array.from(
      janela.current.querySelectorAll<HTMLElement>(
        'button, input, [tabindex="0"]',
      ),
    ).filter((el) => !el.hasAttribute('disabled'))
    const primeiro = focaveis[0]
    const ultimo = focaveis.at(-1)
    if (!primeiro || !ultimo) return
    if (
      e.shiftKey &&
      (document.activeElement === primeiro ||
        document.activeElement === titulo.current)
    ) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  function mover(i: number, para: number) {
    const graficos = [...rascunho.graficos]
    const [item] = graficos.splice(i, 1)
    if (!item) return
    graficos.splice(para, 0, item)
    mudar({ ...rascunho, graficos })
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/25 print:hidden"
        onClick={aoCancelar}
      />
      <div
        ref={janela}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idDoTitulo}
        onKeyDown={teclas}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[400px] sm:rounded-none sm:rounded-l-2xl print:hidden"
      >
        <div className="flex items-start gap-2 border-b border-border px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2
              id={idDoTitulo}
              ref={titulo}
              tabIndex={-1}
              className="font-titulo text-lg font-extrabold outline-none"
            >
              Personalizar o painel
            </h2>
            <p className="text-sm text-muted-foreground">
              Marque o que aparece e mude a ordem. O painel muda na hora, para
              você conferir; o dos outros não muda.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Fechar sem mudar"
            onClick={aoCancelar}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="flex min-h-11 flex-nowrap items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[hsl(var(--primary))]"
              checked={rascunho.numeros}
              onChange={(e) =>
                mudar({ ...rascunho, numeros: e.target.checked })
              }
            />
            Os números do alto
          </label>

          <h3 className="mt-3 mb-1 text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
            Gráficos, na ordem do painel
          </h3>
          <ol className="flex flex-col">
            {rascunho.graficos.map((g, i) => {
              const info = CATALOGO_DE_GRAFICOS.find((c) => c.id === g.id)!
              return (
                <li
                  key={g.id}
                  className="flex flex-nowrap items-center gap-2 border-b border-border py-1.5 last:border-0"
                >
                  <label className="flex min-h-11 min-w-0 flex-1 flex-nowrap items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                      checked={g.visivel}
                      onChange={(e) =>
                        mudar({
                          ...rascunho,
                          graficos: rascunho.graficos.map((x) =>
                            x.id === g.id
                              ? { ...x, visivel: e.target.checked }
                              : x,
                          ),
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold">{info.titulo}</span>
                      <span className="block text-xs text-muted-foreground">
                        {info.explica}
                      </span>
                    </span>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 sm:h-9 sm:w-9"
                    aria-label={`Subir ${info.titulo}`}
                    disabled={i === 0}
                    onClick={() => mover(i, i - 1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 sm:h-9 sm:w-9"
                    aria-label={`Descer ${info.titulo}`}
                    disabled={i === rascunho.graficos.length - 1}
                    onClick={() => mover(i, i + 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </li>
              )
            })}
          </ol>

          <label className="mt-4 flex flex-nowrap items-start gap-3 rounded-lg bg-muted p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
              checked={rascunho.filtros !== undefined}
              onChange={(e) =>
                mudar({
                  ...rascunho,
                  filtros: e.target.checked ? { ...filtrosAtuais } : undefined,
                })
              }
            />
            <span>
              <span className="block font-semibold">
                Abrir sempre com os filtros de agora
              </span>
              <span className="block text-muted-foreground">
                {rascunho.filtros
                  ? descreverFiltros(
                      nomeDoPeriodo(rascunho.filtros.meses),
                      rascunho.filtros,
                    )
                  : descricaoDosFiltros}
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
          {podeGuardar && (
            <Button type="button" className="min-h-11" onClick={aoGuardar}>
              Guardar para mim
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={aoUsarSoAgora}
          >
            Usar só desta vez
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            onClick={aoVoltarAoPadrao}
          >
            Voltar ao painel padrão
          </Button>
          <p className="text-xs text-muted-foreground">
            Fica guardado só para você, neste navegador. Em outro computador ou
            celular, o painel abre no padrão até você guardar lá também.
          </p>
        </div>
      </div>
    </>
  )
}
