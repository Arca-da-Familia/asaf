import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  SearchX,
  type LucideIcon,
} from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Link } from 'react-router'

import { BotaoRecibo } from '@/components/doacoes/BotaoRecibo'
import { ConfirmarRecebimento } from '@/components/doacoes/ConfirmarRecebimento'
import { MarcarNaoLocalizada } from '@/components/doacoes/MarcarNaoLocalizada'
import { Campo } from '@/components/forms/Campo'
import { Button } from '@/components/ui/button'
import {
  listarIntencoesDeDoacao,
  obterSituacaoDaDoacaoNoSite,
  resumoDasIntencoesDeDoacao,
  type IntencaoDeDoacao,
  type IntencaoDeDoacaoConfirmada,
  type SituacaoDaIntencaoDeDoacao,
} from '@/lib/api'
import { classeCampo } from '@/lib/campos'
import { formatarData } from '@/lib/datas'
import {
  CLASSE_DA_SITUACAO_DA_INTENCAO,
  INTENCOES_POR_PAGINA,
  OPCOES_DE_SITUACAO,
  SITUACAO_PADRAO,
  cpfParaATela,
  reais,
} from '@/lib/doacoes-do-site'
import { LerAviso } from '@/components/privacidade/LerAviso'
import { useDebounce } from '@/lib/use-debounce'
import { useMe } from '@/lib/use-me'
import { CpfProtegido } from '@/components/display/CpfProtegido'
import { PERMISSAO_VER_CPF_COMPLETO } from '@/lib/cpf-protegido'

const ICONE_DA_SITUACAO: Record<SituacaoDaIntencaoDeDoacao, LucideIcon> = {
  PENDENTE: Clock,
  EXPIRADA: AlertTriangle,
  NAO_LOCALIZADA: SearchX,
  CONFIRMADA: CheckCircle2,
}

// O que aparece depois de uma ação da tesouraria (a linha confirmada some do filtro "A conferir", então o resultado precisa ficar aqui em cima).
type Aviso =
  | { tipo: 'confirmada'; item: IntencaoDeDoacaoConfirmada }
  | { tipo: 'nao_localizada'; item: IntencaoDeDoacao }

function SeloDaSituacao({ intencao }: { intencao: IntencaoDeDoacao }) {
  const Icone = ICONE_DA_SITUACAO[intencao.status] ?? Info
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${CLASSE_DA_SITUACAO_DA_INTENCAO[intencao.status] ?? 'bg-muted text-foreground'}`}
    >
      <Icone aria-hidden="true" className="h-3.5 w-3.5" />
      {intencao.status_rotulo}
    </span>
  )
}

// A página de doação do site só abre quando a Chave Pix está preenchida E marcada "Aparece no site" em Instituição. A conta é do servidor (a mesma da
// página pública); a tesouraria vê o resultado sem precisar da permissão de Instituição, e só quem tem essa permissão ganha o link para corrigir.
function LinhaDaPaginaDeDoacao() {
  const { data: me } = useMe()
  const situacao = useQuery({
    queryKey: ['doacao-no-site', 'situacao'],
    queryFn: obterSituacaoDaDoacaoNoSite,
  })
  const podeAbrirInstituicao =
    me?.permissoes.includes('gerenciar_acesso') ?? false

  if (situacao.isLoading) return null
  if (situacao.isError) {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        Não foi possível conferir se a página de doação do site está aberta.
      </p>
    )
  }
  if (!situacao.data) return null
  if (situacao.data.pix_disponivel) {
    return (
      <p className="flex items-start gap-2 text-sm font-medium text-green-800 dark:text-green-400">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />A
        página de doação do site está aberta.
      </p>
    )
  }
  return (
    <p className="flex items-start gap-2 text-sm font-medium text-amber-800 dark:text-amber-400">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        A página de doação do site está fechada: preencha a Chave Pix e marque
        “Aparece no site” em Instituição.{' '}
        {podeAbrirInstituicao ? (
          <Link to="/instituicao" className="underline">
            Abrir Instituição
          </Link>
        ) : (
          <span className="font-normal">Peça a quem administra o sistema.</span>
        )}
      </span>
    </p>
  )
}

function ItemDaLista({
  intencao,
  onConfirmar,
  onNaoLocalizada,
}: {
  intencao: IntencaoDeDoacao
  onConfirmar: (botao: HTMLElement) => void
  onNaoLocalizada: (botao: HTMLElement) => void
}) {
  const cpf = cpfParaATela(intencao.documento_doador)
  const { data: eu } = useMe()
  const podeVerCpf = !!eu?.permissoes.includes(PERMISSAO_VER_CPF_COMPLETO)
  const confirmada = intencao.status === 'CONFIRMADA'
  const rotuloDeQuem = `${intencao.nome_doador} (protocolo ${intencao.protocolo})`
  const termo = 'text-xs text-muted-foreground'
  return (
    <li className="rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {intencao.nome_doador}{' '}
            <span className="font-normal text-muted-foreground">
              · {intencao.protocolo}
            </span>
          </p>
          <p className="break-all text-muted-foreground">
            {intencao.email_doador}
          </p>
          {intencao.consentimento_lgpd_versao && (
            <div className="text-xs text-muted-foreground">
              Aviso de privacidade aceito: versão{' '}
              {intencao.consentimento_lgpd_versao}
              <LerAviso
                ponto="DOACAO"
                versao={intencao.consentimento_lgpd_versao}
              />
            </div>
          )}
        </div>
        <SeloDaSituacao intencao={intencao} />
      </div>

      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className={termo}>CPF</dt>
          <dd>
            {cpf ? (
              <CpfProtegido
                origem="intencao"
                id={intencao.id_intencao}
                mascarado={cpf}
                podeRevelar={podeVerCpf}
              />
            ) : (
              'não informado'
            )}
          </dd>
        </div>
        <div>
          <dt className={termo}>Valor informado</dt>
          <dd>
            {intencao.valor_informado !== null
              ? reais(intencao.valor_informado)
              : 'sem valor informado'}
          </dd>
        </div>
        <div>
          <dt className={termo}>Campanha</dt>
          <dd>{intencao.campanha_titulo ?? 'sem campanha'}</dd>
        </div>
        <div>
          <dt className={termo}>Chegou em</dt>
          <dd>{formatarData(intencao.criado_em, { comHora: true })}</dd>
        </div>
        {!confirmada && (
          <div>
            <dt className={termo}>Prazo</dt>
            <dd>{formatarData(intencao.expira_em)}</dd>
          </div>
        )}
        {confirmada && (
          <>
            <div>
              <dt className={termo}>Recibo</dt>
              <dd>nº {intencao.numero_recibo}</dd>
            </div>
            <div>
              <dt className={termo}>Valor recebido</dt>
              <dd>
                {intencao.valor_recebido !== null
                  ? reais(intencao.valor_recebido)
                  : '—'}
              </dd>
            </div>
          </>
        )}
        {intencao.resolvido_em && (
          <div>
            <dt className={termo}>
              {confirmada ? 'Confirmada em' : 'Marcada em'}
            </dt>
            <dd>{formatarData(intencao.resolvido_em, { comHora: true })}</dd>
          </div>
        )}
        {intencao.observacao && (
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className={termo}>Observação</dt>
            <dd>{intencao.observacao}</dd>
          </div>
        )}
      </dl>

      {confirmada && intencao.recibo_enviado_por_email === false && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-400">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          O e-mail do recibo não saiu: entregue o recibo por outro meio (use
          “Ver recibo”).
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-start gap-2">
        {intencao.pode_confirmar && (
          <Button
            type="button"
            size="sm"
            onClick={(e) => onConfirmar(e.currentTarget)}
          >
            Confirmar recebimento{' '}
            <span className="sr-only">de {rotuloDeQuem}</span>
          </Button>
        )}
        {intencao.pode_confirmar && intencao.status !== 'NAO_LOCALIZADA' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => onNaoLocalizada(e.currentTarget)}
          >
            Pix não localizado{' '}
            <span className="sr-only">de {rotuloDeQuem}</span>
          </Button>
        )}
        {confirmada && intencao.id_doacao !== null && (
          <BotaoRecibo idDoacao={intencao.id_doacao} paraQuem={rotuloDeQuem} />
        )}
      </div>
    </li>
  )
}

// v5.6a - "Doações do site (Pix)": quem doa pelo site paga o Pix direto na conta da associação e o sistema não sabe sozinho que o dinheiro chegou.
// A tesouraria acha o valor no extrato do banco e confirma aqui; só então nasce a doação (título, lançamento, recibo numerado) e o recibo sai por
// e-mail. A intenção sozinha nunca é dinheiro. Exige a permissão `financeiro`, a mesma da tela de Doações: sem ela, a seção nem consulta o servidor.
export function DoacoesDoSite() {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const pode = me?.permissoes.includes('financeiro') ?? false
  const idTitulo = useId()

  const [situacao, setSituacao] = useState(SITUACAO_PADRAO)
  const [textoBusca, setTextoBusca] = useState('')
  const busca = useDebounce(textoBusca.trim(), 400)
  // A página só vale para o filtro e a busca em que foi escolhida: mudar um deles volta para a primeira página, sem uma consulta a mais.
  const chaveDoFiltro = `${situacao}|${busca}`
  const [escolhida, setEscolhida] = useState({ chave: '', pagina: 1 })
  const pagina = escolhida.chave === chaveDoFiltro ? escolhida.pagina : 1

  const [confirmando, setConfirmando] = useState<IntencaoDeDoacao | null>(null)
  const [naoLocalizando, setNaoLocalizando] = useState<IntencaoDeDoacao | null>(
    null,
  )
  const [aviso, setAviso] = useState<Aviso | null>(null)

  // O foco, depois que um diálogo fecha: no resultado (se deu certo), no botão que o abriu (se foi cancelado) ou, se esse botão já saiu da lista,
  // no título da seção. Nunca se perde no corpo da página.
  const gatilho = useRef<HTMLElement | null>(null)
  const voltarAoAviso = useRef(false)
  const refDoAviso = useRef<HTMLDivElement>(null)
  const refDoTitulo = useRef<HTMLHeadingElement>(null)
  function devolverFoco(): HTMLElement | null {
    if (voltarAoAviso.current && refDoAviso.current) return refDoAviso.current
    if (gatilho.current?.isConnected) return gatilho.current
    return refDoTitulo.current
  }

  const lista = useQuery({
    queryKey: ['intencoes-doacao', 'lista', situacao, busca, pagina],
    queryFn: () =>
      listarIntencoesDeDoacao({
        situacao,
        busca: busca || undefined,
        pagina,
        por_pagina: INTENCOES_POR_PAGINA,
      }),
    enabled: pode,
  })
  const resumo = useQuery({
    queryKey: ['intencoes-doacao', 'resumo'],
    queryFn: resumoDasIntencoesDeDoacao,
    enabled: pode,
  })

  const itens = lista.data?.itens ?? []
  const total = lista.data?.total ?? 0
  const totalDePaginas = Math.max(1, Math.ceil(total / INTENCOES_POR_PAGINA))

  function irParaPagina(nova: number) {
    setEscolhida({ chave: chaveDoFiltro, pagina: nova })
  }

  // Depois de uma ação: a lista, o resumo, e as listas de doações e campanhas da própria tela (a doação confirmada nasce lá e a campanha ganha o valor).
  function conferirTudoDeNovo() {
    void queryClient.invalidateQueries({ queryKey: ['intencoes-doacao'] })
    void queryClient.invalidateQueries({ queryKey: ['doacoes'] })
    void queryClient.invalidateQueries({ queryKey: ['campanhas-arrecadacao'] })
  }

  // A doação que acabou de mudar de situação ainda aparece no filtro de agora? ("Todas" mostra tudo; "A conferir" mostra aguardando e prazo vencido.)
  function saiDoFiltro(novaSituacao: SituacaoDaIntencaoDeDoacao): boolean {
    if (situacao === '') return false
    if (situacao === 'a_conferir')
      return novaSituacao !== 'PENDENTE' && novaSituacao !== 'EXPIRADA'
    return situacao !== novaSituacao
  }

  // Se era a última da página e ela sai da lista, volta uma página em vez de ficar numa página vazia.
  function recuarSeAPaginaEsvaziou(novaSituacao: SituacaoDaIntencaoDeDoacao) {
    if (saiDoFiltro(novaSituacao) && pagina > 1 && itens.length === 1)
      irParaPagina(pagina - 1)
  }

  function abrir(
    qual: 'confirmar' | 'nao_localizada',
    intencao: IntencaoDeDoacao,
    botao: HTMLElement,
  ) {
    gatilho.current = botao
    voltarAoAviso.current = false
    setAviso(null)
    if (qual === 'confirmar') setConfirmando(intencao)
    else setNaoLocalizando(intencao)
  }

  if (!me) return null

  if (!pode) {
    return (
      <section
        aria-labelledby={idTitulo}
        className="mb-6 rounded-xl border border-border bg-card p-6"
      >
        <h2 id={idTitulo} className="font-semibold">
          Doações do site (Pix)
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Você não tem permissão para conferir as doações feitas pelo site.
        </p>
      </section>
    )
  }

  const filtrando = textoBusca.trim() !== ''
  const textoVazio = filtrando
    ? 'Nenhuma doação do site encontrada para esta busca.'
    : situacao === 'a_conferir'
      ? 'Nenhuma doação do site esperando conferência.'
      : 'Nenhuma doação do site encontrada com este filtro.'
  const contadores: {
    rotulo: string
    valor: number | undefined
    destaque?: boolean
  }[] = [
    { rotulo: 'A conferir', valor: resumo.data?.a_conferir, destaque: true },
    { rotulo: 'Aguardando conferência', valor: resumo.data?.pendentes },
    { rotulo: 'Prazo vencido', valor: resumo.data?.expiradas },
    { rotulo: 'Pix não localizado', valor: resumo.data?.nao_localizadas },
    { rotulo: 'Confirmadas', valor: resumo.data?.confirmadas },
  ]

  return (
    <section
      aria-labelledby={idTitulo}
      className="mb-6 rounded-xl border border-border bg-card p-6"
    >
      <h2
        id={idTitulo}
        ref={refDoTitulo}
        tabIndex={-1}
        className="font-semibold outline-none"
      >
        Doações do site (Pix)
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Quem doa pelo site paga o Pix direto na conta da associação, e o sistema
        não sabe sozinho que o dinheiro chegou. Procure o valor no extrato do
        banco e confirme aqui: só então a doação é registrada, e o recibo sai
        por e-mail para quem se identificou.
      </p>

      <div className="mt-3">
        <LinhaDaPaginaDeDoacao />
      </div>

      {aviso && (
        <div
          ref={refDoAviso}
          tabIndex={-1}
          role="group"
          aria-label="Resultado da última ação"
          className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {aviso.tipo === 'confirmada' ? (
            <>
              <p role="status" className="font-medium">
                Doação de {aviso.item.nome_doador} confirmada: recibo nº{' '}
                {aviso.item.numero_recibo} emitido
                {aviso.item.valor_recebido !== null &&
                  ` (${reais(aviso.item.valor_recebido)})`}
                .
                {aviso.item.recibo_enviado_por_email === true &&
                  ` O recibo foi enviado por e-mail para ${aviso.item.email_doador}.`}
              </p>
              {aviso.item.recibo_enviado_por_email === false && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-amber-800 dark:text-amber-400"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  A doação foi registrada e o recibo emitido, mas o e-mail não
                  saiu: entregue o recibo por outro meio (o endereço é{' '}
                  {aviso.item.email_doador}).
                </p>
              )}
            </>
          ) : (
            <p role="status" className="font-medium">
              Pix de {aviso.item.nome_doador} marcado como não localizado. Nada
              foi apagado: se o dinheiro chegar depois, escolha “Pix não
              localizado” no filtro e confirme o recebimento.
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAviso(null)}
          >
            Dispensar aviso
          </Button>
        </div>
      )}

      <div
        role="group"
        aria-label="Resumo das doações do site"
        className="mt-4"
      >
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {contadores.map((c) => (
            <div
              key={c.rotulo}
              className={`rounded-md border p-2 ${c.destaque ? 'border-amber-600/50 bg-amber-600/10' : 'border-border'}`}
            >
              <dt className="text-xs text-muted-foreground">{c.rotulo}</dt>
              <dd
                className={
                  c.destaque ? 'text-2xl font-semibold' : 'text-lg font-medium'
                }
              >
                {c.valor ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
        {resumo.isError && (
          <p className="mt-1 text-xs text-muted-foreground">
            Não foi possível carregar o resumo agora.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Campo rotulo="Situação" className="w-full sm:w-56">
          <select
            value={situacao}
            onChange={(e) => setSituacao(e.target.value)}
            className={classeCampo}
          >
            {OPCOES_DE_SITUACAO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          rotulo="Buscar"
          className="w-full sm:w-80"
          dica="Protocolo, nome, e-mail ou CPF."
        >
          <input
            type="search"
            value={textoBusca}
            onChange={(e) => setTextoBusca(e.target.value)}
            className={classeCampo}
          />
        </Campo>
      </div>

      <div className="mt-4">
        {lista.isLoading && (
          <p className="text-sm text-muted-foreground">
            Carregando as doações do site…
          </p>
        )}

        {lista.isError && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar as doações do site. Tente de novo.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void lista.refetch()
                void resumo.refetch()
              }}
            >
              Tentar de novo
            </Button>
          </div>
        )}

        {lista.isSuccess && (
          <>
            {total === 0 ? (
              <p className="text-sm text-muted-foreground">{textoVazio}</p>
            ) : (
              <p className="mb-2 text-xs text-muted-foreground">
                {total} doação(ões) do site
              </p>
            )}
            {total > 0 && itens.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Não há doações nesta página: use “Página anterior”.
              </p>
            )}
            {itens.length > 0 && (
              <ul className="space-y-2">
                {itens.map((i) => (
                  <ItemDaLista
                    key={i.id_intencao}
                    intencao={i}
                    onConfirmar={(botao) => abrir('confirmar', i, botao)}
                    onNaoLocalizada={(botao) =>
                      abrir('nao_localizada', i, botao)
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {(totalDePaginas > 1 || pagina > 1) && lista.isSuccess && (
          <nav
            aria-label="Páginas das doações do site"
            className="mt-4 flex items-center justify-between gap-2 text-sm"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagina <= 1}
              onClick={() => irParaPagina(pagina - 1)}
            >
              Página anterior
            </Button>
            <span className="text-muted-foreground">
              Página {pagina} de {totalDePaginas}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagina >= totalDePaginas}
              onClick={() => irParaPagina(pagina + 1)}
            >
              Próxima página
            </Button>
          </nav>
        )}
      </div>

      {confirmando && (
        <ConfirmarRecebimento
          intencao={confirmando}
          onFechar={() => setConfirmando(null)}
          devolverFoco={devolverFoco}
          onFalha={conferirTudoDeNovo}
          onConfirmada={(resultado) => {
            voltarAoAviso.current = true
            recuarSeAPaginaEsvaziou('CONFIRMADA')
            setConfirmando(null)
            setAviso({ tipo: 'confirmada', item: resultado })
            conferirTudoDeNovo()
          }}
        />
      )}
      {naoLocalizando && (
        <MarcarNaoLocalizada
          intencao={naoLocalizando}
          onFechar={() => setNaoLocalizando(null)}
          devolverFoco={devolverFoco}
          onFalha={conferirTudoDeNovo}
          onMarcada={(resultado) => {
            voltarAoAviso.current = true
            recuarSeAPaginaEsvaziou('NAO_LOCALIZADA')
            setNaoLocalizando(null)
            setAviso({ tipo: 'nao_localizada', item: resultado })
            conferirTudoDeNovo()
          }}
        />
      )}
    </section>
  )
}
