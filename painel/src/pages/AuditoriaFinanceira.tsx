import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  aprovarEmLoteNaAuditoria,
  decidirTituloNaAuditoria,
  listarAuditoriaFinanceira,
  listarPlanoContas,
  responderQuestionamento,
  type DecisaoNaAuditoria,
  type ResultadoDoLote,
  type TituloNaAuditoria,
  urlArquivo,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

const POR_PAGINA = 25
const TAMANHO_MINIMO_DA_EXPLICACAO = 10

function mesAtual(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

const COR_DA_SITUACAO = {
  Aprovado: 'text-green-600',
  Suspenso: 'text-amber-600',
  Pendente: 'text-muted-foreground',
} as const

function rotuloDaSituacao(t: TituloNaAuditoria): string {
  if (t.situacao === 'Aprovado')
    return `Aprovado (${t.aprovacoes} de ${Math.max(t.aprovacoes, t.quorum)}) — travado`
  if (t.situacao === 'Suspenso')
    return 'Suspenso: aguardando a resposta da tesouraria'
  return `Pendente: ${t.aprovacoes} de ${t.quorum} aprovações`
}

const PEDIDO: Record<
  Exclude<DecisaoNaAuditoria, 'Aprovado'>,
  { botao: string; confirmar: string; ajuda: string }
> = {
  'Com ressalva': {
    botao: 'Com ressalva',
    confirmar: 'Confirmar ressalva',
    ajuda:
      'Escreva o que falta ou o que está duvidoso: a tesouraria vai ler e responder. O título fica suspenso até a resposta.',
  },
  Reprovado: {
    botao: 'Reprovar',
    confirmar: 'Confirmar reprovação',
    ajuda:
      'Escreva o que está errado: a tesouraria vai ler e responder. O título fica suspenso até a resposta.',
  },
  Reaberto: {
    botao: 'Reabrir auditoria',
    confirmar: 'Confirmar reabertura',
    ajuda:
      'Escreva por que reabrir. As aprovações anteriores deixam de valer (continuam no histórico) e o título volta a poder ser corrigido.',
  },
}

function CartaoDoTitulo({
  t,
  podeDecidir,
}: {
  t: TituloNaAuditoria
  podeDecidir: boolean
}) {
  const queryClient = useQueryClient()
  const [pedindo, setPedindo] = useState<Exclude<
    DecisaoNaAuditoria,
    'Aprovado'
  > | null>(null)
  const [texto, setTexto] = useState('')

  const decidir = useMutation({
    mutationFn: (corpo: { decisao: DecisaoNaAuditoria; observacao?: string }) =>
      decidirTituloNaAuditoria(t.id_titulo, corpo),
    onSuccess: () => {
      setPedindo(null)
      setTexto('')
      queryClient.invalidateQueries({ queryKey: ['auditoria-financeira'] })
    },
  })

  // quem lança (a tesouraria) responde ali mesmo às perguntas abertas do Conselho; é o que libera o título suspenso
  const [respondendo, setRespondendo] = useState<number | null>(null)
  const [resposta, setResposta] = useState('')
  const responder = useMutation({
    mutationFn: (v: { idQuestionamento: number; texto: string }) =>
      responderQuestionamento(v.idQuestionamento, { texto: v.texto }),
    onSuccess: () => {
      setRespondendo(null)
      setResposta('')
      queryClient.invalidateQueries({ queryKey: ['auditoria-financeira'] })
    },
  })
  const perguntasAbertas = podeDecidir
    ? []
    : t.decisoes.filter(
        (d) =>
          d.vigente && d.questionamento === 'Aberto' && d.id_questionamento,
      )

  const aprovado = t.situacao === 'Aprovado'
  // a discordância de quem não concorda fica sempre à vista, mesmo quando a maioria já aprovou
  const discordancias = t.decisoes.filter(
    (d) =>
      d.vigente && (d.decisao === 'Reprovado' || d.decisao === 'Com ressalva'),
  )
  // título aprovado não deixa de receber o voto de quem ainda não votou (concordando ou discordando); só a reabertura é separada
  const podeVotar = !aprovado || t.minha_decisao === null
  const podeAgir = podeDecidir && !t.sou_parte
  const id = `explicacao-${t.id_titulo}`

  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {t.tipo_titulo} — {t.descricao}
        </p>
        <span className={COR_DA_SITUACAO[t.situacao]}>
          {rotuloDaSituacao(t)}
        </span>
      </div>
      <p className="text-muted-foreground">
        {t.conta_contabil} · {t.beneficiario} · Vencimento{' '}
        {t.data_vencimento ? formatarData(t.data_vencimento) : 'sem data'} ·{' '}
        {t.status}
      </p>
      <p className="text-muted-foreground">
        Original {formatarReais(t.valor_original)} · Saldo{' '}
        {formatarReais(t.saldo_devedor)}
      </p>
      {(t.nota_fiscal || t.comprovantes.length > 0) && (
        <p className="mt-1 flex flex-wrap gap-3 text-xs">
          {t.nota_fiscal && (
            <a
              href={urlArquivo(t.nota_fiscal)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Ver nota fiscal
            </a>
          )}
          {t.comprovantes.map((c, i) => (
            <a
              key={c}
              href={urlArquivo(c)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {t.comprovantes.length > 1
                ? `Ver comprovante do pagamento ${i + 1}`
                : 'Ver comprovante do pagamento'}
            </a>
          ))}
        </p>
      )}
      {t.dias_ate_o_lancamento !== null && t.dias_ate_o_lancamento > 0 && (
        <p
          className={
            t.lancamento_tardio
              ? 'mt-1 text-xs font-medium text-amber-700'
              : 'mt-1 text-xs text-muted-foreground'
          }
        >
          {t.lancamento_tardio ? 'Lançamento tardio: ' : ''}lançada{' '}
          {t.dias_ate_o_lancamento} dia(s) depois da despesa.
        </p>
      )}

      {discordancias.length > 0 && (
        <div
          role="note"
          aria-label={`Discordância sobre ${t.descricao}`}
          className="mt-2 rounded-md border border-amber-600/40 bg-amber-100 px-3 py-2 text-xs text-amber-950"
        >
          {discordancias.map((d) => (
            <p key={d.id_auditoria}>
              <span className="font-semibold">
                Discordância de {d.conselheiro}
              </span>{' '}
              ({d.decisao}): “{d.observacao}”
            </p>
          ))}
        </div>
      )}

      {t.decisoes.length > 0 && (
        <ul
          aria-label={`Decisões do Conselho sobre ${t.descricao}`}
          className="mt-2 space-y-1 text-xs"
        >
          {t.decisoes.map((d) => (
            <li
              key={d.id_auditoria}
              className={d.vigente ? '' : 'text-muted-foreground line-through'}
            >
              <span className="font-medium">{d.conselheiro}</span>: {d.decisao}
              {d.observacao ? ` — “${d.observacao}”` : ''}
              {d.questionamento
                ? ` (pergunta ${d.questionamento === 'Aberto' ? 'aberta' : 'respondida'})`
                : ''}
              {!d.vigente && d.decisao !== 'Reaberto' ? ' (substituída)' : ''}
            </li>
          ))}
        </ul>
      )}

      {perguntasAbertas.map((d) => (
        <div key={d.id_auditoria} className="mt-2 space-y-2">
          {respondendo === d.id_questionamento ? (
            <>
              <label
                htmlFor={`resposta-${d.id_auditoria}`}
                className="block text-xs font-medium"
              >
                Resposta da tesouraria a {d.conselheiro}
              </label>
              <textarea
                id={`resposta-${d.id_auditoria}`}
                rows={3}
                value={resposta}
                onChange={(e) => setResposta(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={resposta.trim().length < 3 || responder.isPending}
                  onClick={() =>
                    responder.mutate({
                      idQuestionamento: d.id_questionamento as number,
                      texto: resposta.trim(),
                    })
                  }
                >
                  Enviar resposta
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRespondendo(null)
                    setResposta('')
                    responder.reset()
                  }}
                >
                  Cancelar resposta
                </Button>
              </div>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Responder a ${d.conselheiro}: ${t.descricao}`}
              onClick={() => setRespondendo(d.id_questionamento)}
            >
              Responder a {d.conselheiro}
            </Button>
          )}
        </div>
      ))}
      {responder.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {(responder.error as Error).message}
        </p>
      )}

      {t.sou_parte && podeDecidir && (
        <p className="mt-2 text-xs text-muted-foreground">
          Você é parte deste título e não o audita.
        </p>
      )}

      {podeAgir && !pedindo && (
        <div className="mt-2 flex flex-wrap gap-2">
          {podeVotar && (
            <>
              <Button
                size="sm"
                aria-label={`Aprovar: ${t.descricao}`}
                disabled={t.minha_decisao === 'Aprovado' || decidir.isPending}
                onClick={() => decidir.mutate({ decisao: 'Aprovado' })}
              >
                {t.minha_decisao === 'Aprovado' ? 'Você aprovou' : 'Aprovar'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Com ressalva: ${t.descricao}`}
                onClick={() => setPedindo('Com ressalva')}
              >
                Com ressalva
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Reprovar: ${t.descricao}`}
                onClick={() => setPedindo('Reprovado')}
              >
                Reprovar
              </Button>
            </>
          )}
          {aprovado && (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Reabrir auditoria: ${t.descricao}`}
              onClick={() => setPedindo('Reaberto')}
            >
              Reabrir auditoria
            </Button>
          )}
        </div>
      )}

      {podeAgir && pedindo && (
        <div className="mt-2 space-y-2">
          <label htmlFor={id} className="block text-xs font-medium">
            Explicação (obrigatória)
          </label>
          <p className="text-xs text-muted-foreground">
            {PEDIDO[pedindo].ajuda}
          </p>
          <textarea
            id={id}
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={
                texto.trim().length < TAMANHO_MINIMO_DA_EXPLICACAO ||
                decidir.isPending
              }
              onClick={() =>
                decidir.mutate({ decisao: pedindo, observacao: texto.trim() })
              }
            >
              {PEDIDO[pedindo].confirmar}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPedindo(null)
                setTexto('')
                decidir.reset()
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {decidir.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {(decidir.error as Error).message}
        </p>
      )}
    </div>
  )
}

function textoDoResultado(r: ResultadoDoLote): string {
  const pulados: string[] = []
  const { ignorados: i } = r
  if (i.suspensos) pulados.push(`${i.suspensos} suspenso(s)`)
  if (i.ja_travados)
    pulados.push(`${i.ja_travados} já aprovado(s) e travado(s)`)
  if (i.ja_aprovados_por_voce)
    pulados.push(`${i.ja_aprovados_por_voce} que você já aprovou`)
  if (i.seus) pulados.push(`${i.seus} em que você é parte`)
  if (i.com_decisao_sua_diferente)
    pulados.push(
      `${i.com_decisao_sua_diferente} com ressalva ou reprovação sua`,
    )
  return `${r.aprovados} título(s) aprovado(s) por você.${pulados.length ? ` Pulados: ${pulados.join(', ')}.` : ''}`
}

// Auditoria financeira: o Conselho Fiscal vê os títulos do mês (entradas e saídas) e decide um a um — aprovar, aprovar com ressalva ou
// reprovar —, ou aprova de uma vez os pendentes do mês (e da categoria). A maioria do Conselho aprova e o título fica travado; ressalva
// e reprovação exigem explicação, viram pergunta para a tesouraria e suspendem o título até a resposta. Quem lança só acompanha.
export function AuditoriaFinanceiraPage() {
  const queryClient = useQueryClient()
  const [filtros, setFiltros] = useSearchParams()
  const mes = filtros.get('mes') ?? mesAtual()
  const tipo = filtros.get('tipo') ?? ''
  const categoria = filtros.get('categoria') ?? ''
  const situacao = filtros.get('situacao') ?? ''
  const busca = filtros.get('busca') ?? ''
  const pagina = Math.max(1, Number(filtros.get('pagina') ?? '1') || 1)
  const [confirmandoLote, setConfirmandoLote] = useState(false)
  const [resultadoDoLote, setResultadoDoLote] = useState<string | null>(null)

  function mudar(novos: Record<string, string | null>) {
    const proximo = new URLSearchParams(filtros)
    for (const [chave, valor] of Object.entries(novos)) {
      if (valor === null || valor === '') proximo.delete(chave)
      else proximo.set(chave, valor)
    }
    if (!('pagina' in novos)) proximo.delete('pagina')
    setFiltros(proximo, { replace: true })
    setConfirmandoLote(false)
    setResultadoDoLote(null)
  }

  const [textoBusca, setTextoBusca] = useState(busca)
  useEffect(() => {
    if (textoBusca === busca) return
    const espera = setTimeout(() => mudar({ busca: textoBusca }), 400)
    return () => clearTimeout(espera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoBusca])

  const consulta = {
    mes,
    tipo_titulo: tipo || undefined,
    id_conta_contabil: categoria ? Number(categoria) : undefined,
    busca: busca || undefined,
  }
  const { data: lista, isLoading } = useQuery({
    queryKey: [
      'auditoria-financeira',
      mes,
      tipo,
      categoria,
      situacao,
      busca,
      pagina,
    ],
    queryFn: () =>
      listarAuditoriaFinanceira({
        ...consulta,
        situacao: situacao || undefined,
        pagina,
        por_pagina: POR_PAGINA,
      }),
  })
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const categorias = (contas ?? []).filter((c) =>
    tipo === 'A Receber'
      ? c.tipo === 'Receita'
      : tipo === 'A Pagar'
        ? c.tipo === 'Despesa'
        : c.tipo === 'Receita' || c.tipo === 'Despesa',
  )

  const lote = useMutation({
    mutationFn: () => aprovarEmLoteNaAuditoria(consulta),
    onSuccess: (r) => {
      setConfirmandoLote(false)
      setResultadoDoLote(textoDoResultado(r))
      queryClient.invalidateQueries({ queryKey: ['auditoria-financeira'] })
    },
  })

  const resumo = lista?.resumo
  const totalDePaginas = Math.max(
    1,
    Math.ceil((lista?.total ?? 0) / POR_PAGINA),
  )
  const escopoDoLote = [
    `de ${mes}`,
    tipo === 'A Pagar'
      ? 'só saídas'
      : tipo === 'A Receber'
        ? 'só entradas'
        : '',
    categoria
      ? `da categoria ${(contas ?? []).find((c) => String(c.id_conta) === categoria)?.descricao_conta ?? categoria}`
      : '',
    busca ? `com o texto “${busca}”` : '',
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <PageHeader
        titulo="Auditoria financeira"
        descricao="O Conselho Fiscal confere os títulos do mês: aprova, aprova com ressalva ou reprova. A maioria do Conselho aprova e o título fica travado."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Auditoria financeira' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label
              htmlFor="auditoria-mes"
              className="mb-1 block text-xs text-muted-foreground"
            >
              Mês de vencimento
            </label>
            <input
              id="auditoria-mes"
              type="month"
              value={mes}
              onChange={(e) => e.target.value && mudar({ mes: e.target.value })}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <select
            aria-label="Tipo"
            value={tipo}
            onChange={(e) => mudar({ tipo: e.target.value, categoria: null })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Entradas e saídas</option>
            <option value="A Receber">Só entradas</option>
            <option value="A Pagar">Só saídas</option>
          </select>
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
          <select
            aria-label="Situação na auditoria"
            value={situacao}
            onChange={(e) => mudar({ situacao: e.target.value })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas as situações</option>
            <option value="Pendente">Pendentes</option>
            <option value="Suspenso">Suspensos</option>
            <option value="Aprovado">Aprovados</option>
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

        {resumo && (
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {resumo.total} título(s) no mês · {resumo.Pendente} pendente(s) ·{' '}
            {resumo.Suspenso} suspenso(s) · {resumo.Aprovado} aprovado(s) ·{' '}
            {resumo.com_discordancia > 0
              ? `${resumo.com_discordancia} com discordância · `
              : ''}
            Para aprovar, {lista?.quorum} conselheiros precisam concordar.
          </p>
        )}

        {lista?.pode_decidir && resumo && resumo.Pendente > 0 && (
          <div className="mb-4 rounded-md border border-border p-3 text-sm">
            {!confirmandoLote ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setResultadoDoLote(null)
                  setConfirmandoLote(true)
                }}
              >
                Aprovar os pendentes do filtro
              </Button>
            ) : (
              <div className="space-y-2">
                <p>
                  Aprovar de uma vez os títulos pendentes {escopoDoLote}? Os
                  suspensos, os que você já aprovou e os seus não entram.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={lote.isPending}
                    onClick={() => lote.mutate()}
                  >
                    {lote.isPending
                      ? 'Aprovando…'
                      : 'Confirmar aprovação em lote'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmandoLote(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
            {lote.isError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {(lote.error as Error).message}
              </p>
            )}
          </div>
        )}
        {resultadoDoLote && (
          <p role="status" className="mb-3 text-sm text-green-600">
            {resultadoDoLote}
          </p>
        )}

        {isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        <div className="v3-space-y-2">
          {(lista?.itens ?? []).map((t) => (
            <CartaoDoTitulo
              key={t.id_titulo}
              t={t}
              podeDecidir={lista?.pode_decidir ?? false}
            />
          ))}
          {lista && lista.itens.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum título encontrado neste filtro.
            </p>
          )}
        </div>

        {totalDePaginas > 1 && (
          <nav
            aria-label="Páginas da auditoria"
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
