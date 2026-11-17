import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Inbox, Info } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { CpfProtegido } from '@/components/display/CpfProtegido'
import { Button } from '@/components/ui/button'
import {
  aprovarPropostaDeFiliacao,
  ApiError,
  conferirPropostaDeFiliacao,
  listarOpcoesLegado,
  listarPropostasDeFiliacao,
  recusarPropostaDeFiliacao,
  type PropostaDeFiliacao,
} from '@/lib/api'
import { PERMISSAO_VER_CPF_COMPLETO } from '@/lib/cpf-protegido'
import { formatarData } from '@/lib/datas'
import { simplificar } from '@/lib/texto'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { LerAviso } from '@/components/privacidade/LerAviso'

// v1.2 no servidor, caixa de entrada só na v5.4c; v9.5g (desenho aprovado pelo Presidente, rodadas 4 e 5): TRÊS COLUNAS - o menu do módulo, a lista
// dos pedidos organizada por etapa (com busca, filtro e rolagem) e o pedido aberto à direita com abas (Resumo, Quem propõe, Linha do tempo) e a decisão
// embaixo. No celular, a lista; o toque abre o pedido, com "Voltar à lista". No alto, o "Como funciona" em 4 passos.

type Etapa = 'decidir' | 'conferir' | 'socios' | 'aprovada' | 'recusada'
const ETAPAS: { id: Etapa; nome: string; cor: string }[] = [
  {
    id: 'decidir',
    nome: 'Pronta para decidir',
    cor: 'bg-verde-tinta text-verde-texto',
  },
  {
    id: 'conferir',
    nome: 'Conferir os dados',
    cor: 'bg-azul-tinta text-azul-texto',
  },
  {
    id: 'socios',
    nome: 'Aguardando sócios',
    cor: 'bg-ouro-tinta text-ouro-texto',
  },
  { id: 'aprovada', nome: 'Aprovada', cor: 'bg-muted text-muted-foreground' },
  { id: 'recusada', nome: 'Recusada', cor: 'bg-muted text-muted-foreground' },
]

// a etapa vem da situação real (Pendente, Em Conferência, Aprovada, Recusada) e de quantos sócios já propuseram
function etapaDe(p: PropostaDeFiliacao): Etapa {
  if (p.status === 'Aprovada') return 'aprovada'
  if (p.status === 'Recusada') return 'recusada'
  const completos = (p.total_propoem ?? 0) >= (p.exigidos ?? 3)
  if (!completos) return 'socios'
  return p.status === 'Em Conferência' ? 'decidir' : 'conferir'
}
const etapa = (id: Etapa) => ETAPAS.find((e) => e.id === id)!

const FILTROS = [
  { id: 'abertas', nome: 'Abertas' },
  { id: 'Pendente', nome: 'Pendente' },
  { id: 'Em Conferência', nome: 'Em Conferência' },
  { id: 'Aprovada', nome: 'Aprovada' },
  { id: 'Recusada', nome: 'Recusada' },
  { id: '', nome: 'Todas' },
] as const

const campoClasse =
  'h-10 w-full rounded-lg border border-input bg-card px-3 text-sm'

function EtapaChip({ p }: { p: PropostaDeFiliacao }) {
  const e = etapa(etapaDe(p))
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap',
        e.cor,
      )}
    >
      {e.nome}
    </span>
  )
}

// a barrinha dos 3 sócios (verde quando completa)
function TresSocios({ p }: { p: PropostaDeFiliacao }) {
  const exigidos = p.exigidos ?? 3
  const propoem = p.total_propoem ?? 0
  return (
    <span className="flex items-center gap-1.5">
      <span className="grid w-14 grid-cols-3 gap-0.5" aria-hidden="true">
        {Array.from({ length: exigidos }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 rounded-full',
              i < propoem ? 'bg-primary' : 'bg-border',
            )}
          />
        ))}
      </span>
      <span
        className={cn(
          'text-xs font-extrabold whitespace-nowrap',
          propoem >= exigidos ? 'text-verde-texto' : 'text-ouro-texto',
        )}
      >
        {propoem} de {exigidos} sócios
      </span>
    </span>
  )
}

function ComoFunciona() {
  const passos = [
    'Pedido pelo site',
    'Três sócios propõem',
    'A secretaria confere os dados',
    'A Diretoria aprova ou recusa',
  ]
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-azul-tinta px-4 py-2.5 text-sm">
      <Info className="h-4 w-4 shrink-0 text-azul-texto" aria-hidden="true" />
      <span className="font-bold text-azul-texto">Como funciona:</span>
      <ol className="contents">
        {passos.map((t, i) => (
          <li key={t}>
            <strong className="text-azul-texto">{i + 1}</strong> {t}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function PropostasDeFiliacaoPage() {
  const [filtro, setFiltro] =
    useState<(typeof FILTROS)[number]['id']>('abertas')
  const [busca, setBusca] = useState('')
  const [selecionadaId, setSelecionadaId] = useState<number | null>(null)
  const status = filtro === 'abertas' || filtro === '' ? undefined : filtro
  const { data: propostas, isLoading } = useQuery({
    queryKey: ['propostas-filiacao', status ?? ''],
    queryFn: () => listarPropostasDeFiliacao(status),
  })
  const termo = simplificar(busca.trim())
  const lista = (propostas ?? []).filter(
    (p) =>
      (filtro !== 'abertas' ||
        p.status === 'Pendente' ||
        p.status === 'Em Conferência') &&
      (!termo || simplificar(p.nome_completo).includes(termo)),
  )
  const grupos = ETAPAS.map((e) => ({
    ...e,
    itens: lista.filter((p) => etapaDe(p) === e.id),
  })).filter((g) => g.itens.length)
  const ordenada = grupos.flatMap((g) => g.itens)
  // o pedido escolhido continua aberto mesmo depois de sair do filtro (aprovado ou recusado agora): o aviso do que aconteceu fica à vista
  const atual =
    ordenada.find((p) => p.id_proposta === selecionadaId) ??
    (propostas ?? []).find((p) => p.id_proposta === selecionadaId) ??
    ordenada[0]

  return (
    <>
      <PageHeader
        titulo="Propostas de filiação"
        descricao="Pedidos de quem quer virar associado: acompanhe os sócios que propõem, confira os dados e decida."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Propostas de filiação' },
        ]}
      />
      <ComoFunciona />

      <div className="grid items-start gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
        {/* a lista, por etapa */}
        <section
          aria-label="Lista dos pedidos"
          className={cn(
            'rounded-2xl border border-border bg-card shadow-card',
            selecionadaId !== null && 'hidden lg:block',
          )}
        >
          <div className="grid gap-2 border-b border-border p-3">
            <label className="sr-only" htmlFor="procurar-pedido-de-filiacao">
              Procurar pelo nome
            </label>
            <input
              id="procurar-pedido-de-filiacao"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar pelo nome"
              className={campoClasse}
            />
            <label htmlFor="filtro-situacao" className="sr-only">
              Situação da proposta
            </label>
            <select
              id="filtro-situacao"
              value={filtro}
              onChange={(e) => {
                setFiltro(e.target.value as (typeof FILTROS)[number]['id'])
                setSelecionadaId(null)
              }}
              className={campoClasse}
            >
              {FILTROS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
          ) : !lista.length ? (
            <div className="p-3">
              <EmptyState
                icone={Inbox}
                titulo="Nenhuma proposta por aqui"
                descricao="Quando alguém pedir filiação pelo site, o pedido aparece nesta lista."
              />
            </div>
          ) : (
            <div className="relative lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto">
              {grupos.map((g) => (
                <div key={g.id}>
                  <h2 className="bg-muted/60 px-4 py-1.5 text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
                    {g.nome} · {g.itens.length}
                  </h2>
                  <ul className="divide-y divide-border">
                    {g.itens.map((p) => {
                      const ativa = atual?.id_proposta === p.id_proposta
                      return (
                        <li
                          key={p.id_proposta}
                          aria-label={`Pedido de ${p.nome_completo}`}
                        >
                          <button
                            type="button"
                            aria-current={ativa ? 'true' : undefined}
                            onClick={() => setSelecionadaId(p.id_proposta)}
                            className={cn(
                              'flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-accent',
                              ativa &&
                                'bg-ouro-tinta shadow-[inset_4px_0_0_hsl(var(--brand-secondary))] hover:bg-ouro-tinta',
                            )}
                          >
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-extrabold">
                                {p.nome_completo}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {formatarData(p.criado_em)}
                              </span>
                            </span>
                            {(p.status === 'Pendente' ||
                              p.status === 'Em Conferência') && (
                              <TresSocios p={p} />
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* o pedido aberto */}
        {atual && (
          <div className={cn(selecionadaId === null && 'hidden lg:block')}>
            <Button
              variant="outline"
              className="mb-3 min-h-11 lg:hidden"
              onClick={() => setSelecionadaId(null)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Voltar à lista
            </Button>
            <Proposta key={atual.id_proposta} proposta={atual} />
          </div>
        )}
      </div>
    </>
  )
}

type Aba = 'resumo' | 'socios' | 'tempo'

function Proposta({ proposta }: { proposta: PropostaDeFiliacao }) {
  const queryClient = useQueryClient()
  const { data: eu } = useMe()
  const base = useId()
  const [aba, setAba] = useState<Aba>('resumo')
  const [modo, setModo] = useState<null | 'recusar' | 'aprovar'>(null)
  const [motivo, setMotivo] = useState('')
  const [categoria, setCategoria] = useState('Efetivo')
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cadastroParecido, setCadastroParecido] = useState(false)

  const { data: categorias } = useQuery({
    queryKey: ['opcoes-legado', 'categoria_associado'],
    queryFn: () => listarOpcoesLegado('categoria_associado'),
    enabled: modo === 'aprovar',
  })

  function atualizar() {
    queryClient.invalidateQueries({ queryKey: ['propostas-filiacao'] })
    queryClient.invalidateQueries({ queryKey: ['associados'] })
  }

  function falhar(e: unknown) {
    setAviso(null)
    setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
    if (e instanceof ApiError && e.status === 409) setCadastroParecido(true)
  }

  const conferir = useMutation({
    mutationFn: () => conferirPropostaDeFiliacao(proposta.id_proposta),
    onSuccess: (r) => {
      setErro(null)
      setAviso(r.mensagem)
      atualizar()
    },
    onError: falhar,
  })
  const recusar = useMutation({
    mutationFn: () => recusarPropostaDeFiliacao(proposta.id_proposta, motivo),
    onSuccess: (r) => {
      setErro(null)
      setAviso(r.mensagem)
      setModo(null)
      atualizar()
    },
    onError: falhar,
  })
  const aprovar = useMutation({
    mutationFn: (forcar: boolean) =>
      aprovarPropostaDeFiliacao(proposta.id_proposta, { categoria, forcar }),
    onSuccess: (r) => {
      setErro(null)
      setCadastroParecido(false)
      setAviso(`${r.mensagem} Matrícula ${r.numero_matricula}.`)
      setModo(null)
      atualizar()
    },
    onError: falhar,
  })

  const podeForcar = !!eu?.permissoes.includes('forcar_cadastro_duplicado')
  const exigidos = proposta.exigidos ?? 3
  const propoem = proposta.total_propoem ?? 0
  const sociosCompletos = propoem >= exigidos
  const aberta =
    proposta.status === 'Pendente' || proposta.status === 'Em Conferência'
  const decisoes = proposta.proponentes ?? []

  function enviarRecusa(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (motivo.trim().length < 3) {
      setErro('Informe o motivo da recusa.')
      return
    }
    recusar.mutate()
  }

  const iniciais = proposta.nome_completo
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .filter((_, i, todas) => i === 0 || i === todas.length - 1)
    .join('')

  const ABAS: { id: Aba; nome: string }[] = [
    { id: 'resumo', nome: 'Resumo' },
    { id: 'socios', nome: `Quem propõe · ${propoem}` },
    { id: 'tempo', nome: 'Linha do tempo' },
  ]

  // a linha do tempo: o pedido, cada sócio que decidiu e o que aconteceu depois (a conferência e a decisão não guardam a data própria)
  const eventos: { data: string | null; texto: string; detalhe?: string }[] = [
    {
      data: proposta.criado_em,
      texto: 'Pedido recebido pelo site',
      detalhe: proposta.consentimento_lgpd_versao
        ? `Aceitou o aviso de privacidade (versão ${proposta.consentimento_lgpd_versao}).`
        : undefined,
    },
    ...[...decisoes]
      .sort((a, b) => (a.em ?? '').localeCompare(b.em ?? ''))
      .map((d) => ({
        data: d.em,
        texto:
          d.decisao === 'Propõe'
            ? `${d.socio} propôs`
            : `${d.socio} não propôs`,
        detalhe: d.observacao ? `“${d.observacao}”` : undefined,
      })),
    ...(proposta.status !== 'Pendente' && proposta.status !== 'Recusada'
      ? [{ data: null, texto: 'Dados conferidos pela secretaria' }]
      : []),
    ...(proposta.status === 'Aprovada'
      ? [{ data: null, texto: 'Aprovada: virou associado' }]
      : proposta.status === 'Recusada'
        ? [
            {
              data: null,
              texto: 'Recusada',
              detalhe: proposta.motivo_recusa ?? undefined,
            },
          ]
        : []),
  ]

  return (
    <section
      aria-label={`Proposta de ${proposta.nome_completo}`}
      data-situacao={proposta.status}
      className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-azul-tinta text-sm font-extrabold text-azul-texto uppercase"
        >
          {iniciais}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-titulo text-xl font-extrabold">
            {proposta.nome_completo}
          </h2>
          <p className="text-sm text-muted-foreground">
            {`Recebida em ${formatarData(proposta.criado_em)}${typeof proposta.idade === 'number' ? ` · ${proposta.idade} anos` : ''}`}
          </p>
          <p className="text-sm">
            Situação: <strong>{proposta.status}</strong>
          </p>
        </div>
        <EtapaChip p={proposta} />
      </div>

      <div
        role="tablist"
        aria-label="Partes do pedido"
        className="relative mt-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            id={`${base}-aba-${a.id}`}
            aria-selected={aba === a.id}
            aria-controls={`${base}-painel-${a.id}`}
            onClick={() => setAba(a.id)}
            className={cn(
              '-mb-px min-h-11 shrink-0 border-b-[3px] px-4 text-sm whitespace-nowrap',
              aba === a.id
                ? 'border-brand-secondary font-extrabold'
                : 'border-transparent font-semibold text-muted-foreground hover:text-foreground',
            )}
          >
            {a.nome}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${base}-painel-${aba}`}
        aria-labelledby={`${base}-aba-${aba}`}
        className="pt-4"
      >
        {aba === 'resumo' && (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="text-sm">
              <h3 className="mb-2 text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
                Dados do pedido
              </h3>
              <p>
                CPF{' '}
                <CpfProtegido
                  origem="proposta"
                  id={proposta.id_proposta}
                  mascarado={proposta.cpf_mascarado}
                  podeRevelar={
                    !!eu?.permissoes.includes(PERMISSAO_VER_CPF_COMPLETO)
                  }
                />
              </p>
              {proposta.email_contato && (
                <p className="break-words">{proposta.email_contato}</p>
              )}
              {proposta.telefone_whatsapp && (
                <p>{proposta.telefone_whatsapp}</p>
              )}
              {proposta.consentimento_lgpd_em && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Aviso de privacidade aceito (versão{' '}
                  {proposta.consentimento_lgpd_versao}) em{' '}
                  {formatarData(proposta.consentimento_lgpd_em)}
                </p>
              )}
              {proposta.consentimento_lgpd_versao && (
                <LerAviso
                  ponto="FILIACAO"
                  versao={proposta.consentimento_lgpd_versao}
                />
              )}
              {proposta.autorizacao_responsavel_declarada && (
                <p
                  className="mt-2 rounded-lg bg-ouro-tinta px-3 py-2 text-sm font-medium"
                  data-aviso-de-menor
                >
                  Tem menos de 18 anos: declarou ter a autorização dos pais ou
                  responsáveis. Confira o papel (Estatuto, Art. 12) antes de
                  aprovar.
                </p>
              )}
            </div>
            <div className="text-sm">
              <h3 className="mb-2 text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
                Onde está
              </h3>
              {aberta ? (
                <>
                  <TresSocios p={proposta} />
                  <p className="mt-2">
                    Sócios que propõem: {propoem} de {exigidos}
                    {sociosCompletos ? '' : ` — faltam ${exigidos - propoem}.`}
                  </p>
                  <p className="mt-1">
                    {proposta.status === 'Em Conferência'
                      ? 'Dados conferidos pela secretaria.'
                      : 'Dados ainda não conferidos.'}
                  </p>
                </>
              ) : proposta.status === 'Recusada' ? (
                <p>
                  {proposta.motivo_recusa
                    ? `Motivo da recusa: ${proposta.motivo_recusa}`
                    : 'Recusada.'}
                </p>
              ) : (
                proposta.id_associado_efetivado && (
                  <Link
                    className="font-bold text-primary underline"
                    to={`/associados/${proposta.id_associado_efetivado}`}
                  >
                    Abrir o cadastro do associado
                  </Link>
                )
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Pedido recusado ou parado é apagado sozinho 2 anos depois da
                última movimentação. A Auditoria guarda quem decidiu, quando e o
                motivo.
              </p>
            </div>
          </div>
        )}

        {aba === 'socios' &&
          (decisoes.length ? (
            <ul
              aria-label={`Sócios sobre o pedido de ${proposta.nome_completo}`}
              className="grid gap-3 text-sm"
            >
              {decisoes.map((d) => (
                <li key={d.id_associado}>
                  <span className="font-bold">{d.socio}</span>:{' '}
                  <span
                    className={
                      d.decisao === 'Propõe'
                        ? 'font-semibold text-verde-texto'
                        : 'font-semibold'
                    }
                  >
                    {d.decisao}
                  </span>
                  {d.observacao ? ` — “${d.observacao}”` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum sócio decidiu ainda. Cada sócio apto recebe o pedido no
              sino e responde em "Pedidos de filiação", no menu pessoal.
            </p>
          ))}

        {aba === 'tempo' && (
          <ol className="relative grid gap-3 border-l-2 border-border pl-5">
            {eventos.map((e, i) => (
              <li key={i} className="text-sm">
                <span
                  aria-hidden="true"
                  className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-primary"
                />
                <p>
                  {e.data && (
                    <strong className="text-muted-foreground">
                      {formatarData(e.data)} ·{' '}
                    </strong>
                  )}
                  <strong>{e.texto}</strong>
                </p>
                {e.detalhe && (
                  <p className="text-xs text-muted-foreground">{e.detalhe}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {aviso && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-primary/30 bg-verde-tinta px-3 py-2 text-sm"
        >
          {aviso}
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-destructive/30 bg-perigo-tinta px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      {/* a decisão, sempre embaixo do pedido */}
      {aberta && (
        <div className="mt-5 rounded-xl bg-verde-tinta p-4">
          <h3 className="mb-2 font-bold">Decidir</h3>
          <div className="flex flex-wrap gap-2">
            {proposta.status === 'Pendente' && (
              <Button
                variant="outline"
                className="min-h-11"
                disabled={conferir.isPending}
                onClick={() => conferir.mutate()}
              >
                Marcar documentação conferida
              </Button>
            )}
            {proposta.status === 'Em Conferência' && (
              <Button
                className="min-h-11"
                disabled={!sociosCompletos}
                title={
                  sociosCompletos
                    ? undefined
                    : `O Estatuto pede ${exigidos} sócios propondo (até agora ${propoem}).`
                }
                onClick={() => setModo(modo === 'aprovar' ? null : 'aprovar')}
              >
                Aprovar e efetivar
              </Button>
            )}
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setModo(modo === 'recusar' ? null : 'recusar')}
            >
              Recusar proposta
            </Button>
          </div>

          {modo === 'recusar' && (
            <form onSubmit={enviarRecusa} className="mt-4" noValidate>
              <label
                htmlFor={`motivo-${proposta.id_proposta}`}
                className="text-sm font-medium"
              >
                Motivo da recusa *
              </label>
              <input
                id={`motivo-${proposta.id_proposta}`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className={cn(campoClasse, 'mt-1')}
              />
              <Button
                type="submit"
                variant="destructive"
                className="mt-3 min-h-11"
                disabled={recusar.isPending}
              >
                Confirmar recusa
              </Button>
            </form>
          )}

          {modo === 'aprovar' && (
            <div className="mt-4">
              <label
                htmlFor={`categoria-${proposta.id_proposta}`}
                className="text-sm font-medium"
              >
                Categoria *
              </label>
              <select
                id={`categoria-${proposta.id_proposta}`}
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className={cn(campoClasse, 'mt-1 max-w-xs')}
              >
                {(
                  categorias ?? [{ id_opcao: 0, valor: 'Efetivo', ativo: true }]
                ).map((c) => (
                  <option key={c.id_opcao} value={c.valor}>
                    {c.valor}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs">
                Cria o cadastro do associado, atribui a matrícula e registra a
                filiação na linha do tempo.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  className="min-h-11"
                  disabled={aprovar.isPending}
                  onClick={() => aprovar.mutate(false)}
                >
                  Efetivar associado
                </Button>
                {cadastroParecido && podeForcar && (
                  <Button
                    variant="destructive"
                    className="min-h-11"
                    disabled={aprovar.isPending}
                    onClick={() => aprovar.mutate(true)}
                  >
                    Aprovar mesmo assim (confirmo que é outra pessoa)
                  </Button>
                )}
              </div>
              {cadastroParecido && !podeForcar && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Só quem tem a permissão de forçar cadastro parecido (o
                  Presidente) pode aprovar mesmo assim.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
