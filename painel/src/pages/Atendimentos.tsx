import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Headset } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'

import { VoluntarioDoPedido } from '@/components/atendimentos/VoluntarioDoPedido'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  abrirAtendimento,
  assumirAtendimento,
  encerrarAtendimento,
  listarAtendimentosDaFila,
  responderAtendimento,
  resumirAtendimentos,
  type AtendimentoAberto,
  type AtendimentoCompleto,
  type AtendimentoDaFila,
} from '@/lib/api'
import { formatarCpf } from '@/lib/cpf'
import {
  avisoDoEnvioDaResposta,
  COR_DA_SITUACAO_DO_ATENDIMENTO,
  COR_DO_PRAZO,
  previaDaMensagem,
  SITUACAO_PADRAO_DA_FILA,
  SITUACOES_DA_FILA,
  textoDoPrazo,
  TIPOS_DE_ATENDIMENTO,
  TODAS_AS_SITUACOES,
} from '@/lib/atendimentos'
import { formatarData } from '@/lib/datas'

// v5.5a (FASE 5) - a fila única de atendimento: tudo que chega pelo formulário do site (contato, pedido de informação sobre recursos públicos,
// solicitação de titular de dados da LGPD) cai aqui com protocolo e prazo. Quem tem a permissão `atendimento` assume o pedido, responde (a resposta
// também sai por e-mail, quando a pessoa deixou um) e encerra com o motivo; cada passo fica na Auditoria.
// v5.5b: o pedido de voluntariado também tem o caminho "cadastrar como voluntário, registrar o termo de adesão, escalar" (VoluntarioDoPedido).
const POR_PAGINA = 25
const classeCampo =
  'h-9 rounded-md border border-input bg-background px-3 text-sm'

type AvisoDeAcao = {
  id: number
  texto: string
  atencao: boolean
}

export function AtendimentosPage() {
  const [filtros, setFiltros] = useSearchParams()
  const busca = filtros.get('busca') ?? ''
  const tipo = filtros.get('tipo') ?? ''
  const situacao = filtros.get('situacao') ?? SITUACAO_PADRAO_DA_FILA
  const soVencidos = filtros.get('vencidos') === '1'
  const [pagina, setPagina] = useState(1)
  const [aviso, setAviso] = useState<AvisoDeAcao | null>(null)

  function mudar(novos: Record<string, string>) {
    const proximo = new URLSearchParams(filtros)
    for (const [chave, valor] of Object.entries(novos)) {
      if (valor === '') proximo.delete(chave)
      else proximo.set(chave, valor)
    }
    setFiltros(proximo, { replace: true })
    setPagina(1)
  }

  // o temporizador da busca chama a versão MAIS NOVA de `mudar` (a do último desenho da tela), não a de quando a pessoa começou a digitar: sem isso, escolher
  // um filtro logo depois de digitar na busca perdia o filtro (o endereço voltava ao que era antes do filtro)
  const mudarAtual = useRef(mudar)
  useEffect(() => {
    mudarAtual.current = mudar
  })

  // a busca espera a pessoa parar de digitar antes de ir ao servidor, e volta para a primeira página
  const [textoBusca, setTextoBusca] = useState(busca)
  useEffect(() => {
    if (textoBusca.trim() === busca) return
    const espera = setTimeout(
      () => mudarAtual.current({ busca: textoBusca.trim() }),
      400,
    )
    return () => clearTimeout(espera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoBusca])

  const { data: resumo } = useQuery({
    queryKey: ['atendimentos', 'resumo'],
    queryFn: () => resumirAtendimentos(),
  })
  const { data, isLoading, isError, isPlaceholderData } = useQuery({
    queryKey: [
      'atendimentos',
      'lista',
      busca,
      tipo,
      situacao,
      soVencidos,
      pagina,
    ],
    queryFn: () =>
      listarAtendimentosDaFila({
        busca: busca || undefined,
        tipo: tipo || undefined,
        situacao: situacao === TODAS_AS_SITUACOES ? undefined : situacao,
        vencidos: soVencidos || undefined,
        pagina,
        por_pagina: POR_PAGINA,
      }),
    placeholderData: (anterior) => anterior,
  })

  const itens = data?.itens ?? []
  const total = data?.total ?? 0
  const totalDePaginas = Math.max(1, Math.ceil(total / POR_PAGINA))

  // depois de responder ou encerrar, a última página pode esvaziar: volta para a última que existe
  if (data && !isPlaceholderData && pagina > totalDePaginas)
    setPagina(totalDePaginas)

  const filtrando =
    busca !== '' ||
    tipo !== '' ||
    soVencidos ||
    (situacao !== SITUACAO_PADRAO_DA_FILA && situacao !== TODAS_AS_SITUACOES)

  // O aviso solto só aparece quando o cartão do pedido saiu da lista (ex.: respondeu e a lista mostra só os abertos): sem ele, a pessoa perderia o
  // aviso de que a resposta não saiu por e-mail. Enquanto o cartão está na tela, o próprio cartão já diz tudo.
  const avisoSolto =
    aviso && !itens.some((i) => i.id_atendimento === aviso.id) ? aviso : null

  return (
    <>
      <PageHeader
        titulo="Atendimento"
        descricao="Pedidos que chegam pelo site: contato, informação sobre recursos públicos, direitos do titular de dados e voluntariado. Cada um tem protocolo e prazo."
      />

      <ul
        aria-label="Resumo do atendimento"
        className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <CartaoDeResumo
          rotulo="Novos"
          valor={resumo?.novos}
          descricao="ainda ninguém assumiu"
        />
        <CartaoDeResumo
          rotulo="Em atendimento"
          valor={resumo?.em_atendimento}
          descricao="alguém já assumiu"
        />
        <CartaoDeResumo
          rotulo="Vencidos"
          valor={resumo?.vencidos}
          descricao="passaram do prazo"
          alerta={(resumo?.vencidos ?? 0) > 0}
        />
        <CartaoDeResumo
          rotulo="Vencem em 3 dias"
          valor={resumo?.vencem_em_3_dias}
          descricao="responda logo"
        />
      </ul>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <input
          type="search"
          aria-label="Buscar atendimento"
          placeholder="Buscar por protocolo, nome, e-mail, assunto, mensagem, CPF ou telefone"
          value={textoBusca}
          onChange={(e) => setTextoBusca(e.target.value)}
          className={`${classeCampo} w-96 max-w-full`}
        />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Tipo</span>
          <select
            aria-label="Tipo"
            value={tipo}
            onChange={(e) => mudar({ tipo: e.target.value })}
            className={classeCampo}
          >
            <option value="">Todos</option>
            {TIPOS_DE_ATENDIMENTO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            Situação
          </span>
          <select
            aria-label="Situação"
            value={situacao}
            onChange={(e) =>
              mudar({
                situacao:
                  e.target.value === SITUACAO_PADRAO_DA_FILA
                    ? ''
                    : e.target.value,
              })
            }
            className={classeCampo}
          >
            {SITUACOES_DA_FILA.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Só vencidos"
            checked={soVencidos}
            onChange={(e) => mudar({ vencidos: e.target.checked ? '1' : '' })}
            className="h-4 w-4"
          />
          Só vencidos
        </label>
        {data && (
          <span className="pb-2 text-sm text-muted-foreground">
            {total} {total === 1 ? 'atendimento' : 'atendimentos'}
          </span>
        )}
      </div>

      {avisoSolto && (
        <div
          className={`mb-4 flex flex-wrap items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
            avisoSolto.atencao
              ? 'border-amber-300 bg-amber-100 text-amber-900'
              : 'border-primary/30 bg-primary/10'
          }`}
        >
          <p role="status">{avisoSolto.texto}</p>
          <Button variant="ghost" size="sm" onClick={() => setAviso(null)}>
            Fechar aviso
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Não foi possível carregar os atendimentos. Tente de novo em instantes.
        </p>
      ) : itens.length === 0 ? (
        <EmptyState
          icone={Headset}
          titulo={
            filtrando
              ? 'Nenhum atendimento encontrado'
              : situacao === TODAS_AS_SITUACOES
                ? 'Nenhum atendimento por aqui ainda'
                : 'Nenhum atendimento em aberto'
          }
          descricao={
            filtrando
              ? 'Mude a busca ou os filtros para ver outros pedidos.'
              : 'Quando alguém mandar um pedido pelo site, ele aparece nesta lista.'
          }
        />
      ) : (
        <ul className="space-y-4">
          {itens.map((a) => (
            <Atendimento
              key={a.id_atendimento}
              item={a}
              aoConcluir={setAviso}
            />
          ))}
        </ul>
      )}

      {totalDePaginas > 1 && (
        <nav
          aria-label="Páginas de atendimentos"
          className="mt-4 flex items-center justify-between gap-2 text-sm"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            onClick={() => setPagina(pagina - 1)}
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
            onClick={() => setPagina(pagina + 1)}
          >
            Próxima página
          </Button>
        </nav>
      )}
    </>
  )
}

function CartaoDeResumo({
  rotulo,
  valor,
  descricao,
  alerta = false,
}: {
  rotulo: string
  valor: number | undefined
  descricao: string
  alerta?: boolean
}) {
  return (
    <li
      aria-label={`${rotulo}: ${valor ?? 'carregando'}`}
      data-alerta={alerta ? 'sim' : undefined}
      className={`rounded-xl border p-4 ${
        alerta
          ? 'border-rose-300 bg-rose-100 text-rose-900'
          : 'border-border bg-card'
      }`}
    >
      <p className="text-sm font-medium">{rotulo}</p>
      <p className="mt-1 text-3xl font-bold">{valor ?? '—'}</p>
      <p className={`text-xs ${alerta ? '' : 'text-muted-foreground'}`}>
        {descricao}
      </p>
    </li>
  )
}

function Atendimento({
  item,
  aoConcluir,
}: {
  item: AtendimentoDaFila
  aoConcluir: (aviso: AvisoDeAcao) => void
}) {
  const [aberto, setAberto] = useState(false)
  const titulo = item.assunto || item.subtipo_rotulo

  return (
    <li
      className="rounded-xl border border-border bg-card p-5"
      data-situacao={item.status}
      data-prazo={item.situacao_do_prazo}
      aria-label={`Atendimento ${item.protocolo}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold tracking-wide">{item.protocolo}</p>
          <p className="text-sm text-muted-foreground">{item.tipo_rotulo}</p>
          <p className="mt-1 font-semibold">{item.nome_completo}</p>
          {titulo && <p className="text-sm font-medium">{titulo}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${COR_DA_SITUACAO_DO_ATENDIMENTO[item.status] ?? ''}`}
          >
            {item.status}
          </span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${COR_DO_PRAZO[item.situacao_do_prazo] ?? ''}`}
          >
            {textoDoPrazo(item)}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm">{previaDaMensagem(item.mensagem)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Criado em {formatarData(item.criado_em, { comHora: true })}
      </p>

      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={aberto}
          aria-controls={`atendimento-${item.id_atendimento}`}
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? 'Fechar' : 'Abrir'}
        </Button>
      </div>

      {aberto && (
        <Detalhe
          id={item.id_atendimento}
          idDoPainel={`atendimento-${item.id_atendimento}`}
          aoConcluir={aoConcluir}
        />
      )}
    </li>
  )
}

function Detalhe({
  id,
  idDoPainel,
  aoConcluir,
}: {
  id: number
  idDoPainel: string
  aoConcluir: (aviso: AvisoDeAcao) => void
}) {
  const queryClient = useQueryClient()
  const [resposta, setResposta] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const {
    data: a,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['atendimentos', 'detalhe', id],
    queryFn: () => abrirAtendimento(id),
  })

  // o servidor devolve o pedido já atualizado: mostra na hora (sem perder "outros pedidos desta pessoa") e manda a lista e o resumo se refazerem
  function atualizar(r: AtendimentoCompleto, texto: string, atencao = false) {
    setErro(null)
    queryClient.setQueryData<AtendimentoAberto>(
      ['atendimentos', 'detalhe', id],
      (anterior) => (anterior ? { ...anterior, ...r } : undefined),
    )
    aoConcluir({ id, texto, atencao })
    queryClient.invalidateQueries({ queryKey: ['atendimentos'] })
  }

  function falhar(e: unknown) {
    setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
  }

  const assumir = useMutation({
    mutationFn: () => assumirAtendimento(id),
    onMutate: () => setErro(null),
    onSuccess: (r) =>
      atualizar(
        r,
        `Você assumiu o atendimento ${r.protocolo}. Ele passou para "Em atendimento".`,
      ),
    onError: falhar,
  })
  const responder = useMutation({
    mutationFn: () => responderAtendimento(id, resposta),
    onMutate: () => setErro(null),
    onSuccess: (r) => {
      const envio = avisoDoEnvioDaResposta(r, true)
      setResposta('')
      atualizar(
        r,
        `Atendimento ${r.protocolo} respondido. ${envio.texto}`,
        envio.atencao,
      )
    },
    onError: falhar,
  })
  const encerrar = useMutation({
    mutationFn: () => encerrarAtendimento(id, motivo),
    onMutate: () => setErro(null),
    onSuccess: (r) => {
      setMotivo('')
      atualizar(r, `Atendimento ${r.protocolo} encerrado.`)
    },
    onError: falhar,
  })
  const ocupado = assumir.isPending || responder.isPending || encerrar.isPending

  function enviarResposta(e: FormEvent) {
    e.preventDefault()
    responder.mutate()
  }

  function enviarEncerramento(e: FormEvent) {
    e.preventDefault()
    encerrar.mutate()
  }

  if (isLoading)
    return (
      <p id={idDoPainel} className="mt-4 text-sm text-muted-foreground">
        Carregando…
      </p>
    )
  if (isError || !a)
    return (
      <p
        id={idDoPainel}
        role="alert"
        className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        Não foi possível abrir este atendimento. Tente de novo em instantes.
      </p>
    )

  const emAberto = a.status === 'Novo' || a.status === 'Em atendimento'
  const envio = a.resposta ? avisoDoEnvioDaResposta(a) : null

  return (
    <div
      id={idDoPainel}
      className="mt-4 space-y-4 rounded-lg border border-border p-4"
    >
      <section aria-label="Mensagem recebida">
        <h2 className="text-sm font-semibold">Mensagem</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm">{a.mensagem}</p>
      </section>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {a.subtipo_rotulo && (
          <Dado rotulo="O que a pessoa pede" valor={a.subtipo_rotulo} />
        )}
        <Dado rotulo="E-mail" valor={a.email_contato ?? 'Não informado'} />
        <Dado
          rotulo="Telefone"
          valor={a.telefone_whatsapp ?? 'Não informado'}
        />
        {a.cpf && <Dado rotulo="CPF" valor={formatarCpf(a.cpf)} />}
        <Dado
          rotulo="Prazo de resposta"
          valor={`até ${formatarData(a.prazo_em)} (${a.prazo_dias} dias)`}
        />
        {a.assumido_em && (
          <Dado
            rotulo="Assumido em"
            valor={formatarData(a.assumido_em, { comHora: true })}
          />
        )}
        {a.consentimento_lgpd_versao && (
          <Dado
            rotulo="Aviso de privacidade aceito"
            valor={`versão ${a.consentimento_lgpd_versao}`}
          />
        )}
      </dl>
      {a.id_pessoa !== null && (
        <p className="text-xs text-muted-foreground">
          Esta pessoa já consta no cadastro da associação.
        </p>
      )}

      {a.tipo === 'VOLUNTARIO' && (
        <VoluntarioDoPedido
          a={a}
          aoCadastrar={(r) =>
            atualizar(
              r,
              `${r.nome_completo} foi cadastrado(a) como voluntário(a) (pedido ${r.protocolo}). Falta o termo de adesão.`,
            )
          }
        />
      )}

      {a.outros_do_remetente.length > 0 && (
        <section aria-label="Outros pedidos desta pessoa">
          <h2 className="text-sm font-semibold">Outros pedidos desta pessoa</h2>
          <ul className="mt-1 space-y-0.5 text-sm">
            {a.outros_do_remetente.map((o) => (
              <li key={o.id_atendimento}>
                <span className="font-medium">{o.protocolo}</span> —{' '}
                {o.tipo_rotulo} — {o.status} —{' '}
                {formatarData(o.criado_em, { comHora: true })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {a.resposta && a.respondido_em && (
        <section aria-label="Resposta registrada">
          <h2 className="text-sm font-semibold">Resposta registrada</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm">{a.resposta}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Respondido em {formatarData(a.respondido_em, { comHora: true })}
          </p>
          {envio && (
            <p
              data-envio-da-resposta={
                a.resposta_enviada_por_email === false ? 'falhou' : 'ok'
              }
              className={
                envio.atencao
                  ? 'mt-2 rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900'
                  : 'mt-2 text-sm'
              }
            >
              {envio.texto}
            </p>
          )}
        </section>
      )}

      {a.status === 'Encerrado' && (
        <p className="text-sm">
          Encerrado
          {a.encerrado_em
            ? ` em ${formatarData(a.encerrado_em, { comHora: true })}`
            : ''}
          {a.motivo_encerramento ? `. Motivo: ${a.motivo_encerramento}` : '.'}
        </p>
      )}

      {erro && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      {emAberto && (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={ocupado}
            onClick={() => assumir.mutate()}
          >
            Assumir
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Assumir marca que você está cuidando deste pedido.
          </p>
        </div>
      )}

      {emAberto && (
        <form
          onSubmit={enviarResposta}
          noValidate
          className="rounded-lg border border-border p-3"
        >
          <h2 className="text-sm font-semibold">Responder</h2>
          <textarea
            aria-label="Resposta"
            placeholder="Escreva a resposta para a pessoa"
            rows={4}
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            A resposta fica registrada aqui e também é enviada por e-mail, se a
            pessoa deixou um.
          </p>
          <Button type="submit" size="sm" className="mt-2" disabled={ocupado}>
            Registrar resposta
          </Button>
        </form>
      )}

      {a.status !== 'Encerrado' && (
        <form
          onSubmit={enviarEncerramento}
          noValidate
          className="rounded-lg border border-border p-3"
        >
          <h2 className="text-sm font-semibold">Encerrar</h2>
          <input
            aria-label="Motivo do encerramento"
            placeholder="Diga por que está encerrando"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={ocupado}
          >
            Encerrar atendimento
          </Button>
        </form>
      )}
    </div>
  )
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  )
}
