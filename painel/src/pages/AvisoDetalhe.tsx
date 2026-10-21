import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import {
  COR_DA_SITUACAO,
  MOTIVO_MAXIMO,
  MOTIVO_MINIMO,
  detalharAviso,
  filtrarDestinatarios,
  incluirNovosNoAviso,
  reenviarEmailsDoAviso,
  resumoDoEmail,
  retirarAviso,
  textoDoEmail,
  textoDaLeitura,
  type FiltroDaLeitura,
} from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.1 - um aviso publicado e o RELATÓRIO DE LEITURA: quem recebeu, quem leu, quem confirmou e quem não tem acesso ao painel (não foi avisado).
// Daqui se inclui quem entrou no grupo depois (ninguém sai) e se retira o aviso, com motivo (quem recebeu lê o motivo).
const FILTROS: { valor: FiltroDaLeitura; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'nao_leram', rotulo: 'Não leram' },
  { valor: 'nao_confirmaram', rotulo: 'Não confirmaram' },
  { valor: 'sem_acesso', rotulo: 'Sem acesso ao painel' },
  { valor: 'email_falhou', rotulo: 'E-mail que falhou' },
]

export function AvisoDetalhePage() {
  const { id } = useParams()
  const idAviso = Number(id)
  const queryClient = useQueryClient()
  const [filtro, setFiltro] = useState<FiltroDaLeitura>('todos')
  const [motivo, setMotivo] = useState('')
  const [retirando, setRetirando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const chave = ['avisos', 'um', idAviso]
  const { data, isLoading, isError } = useQuery({
    queryKey: chave,
    queryFn: () => detalharAviso(idAviso),
    enabled: Number.isInteger(idAviso) && idAviso > 0,
  })

  function falhou(e: unknown, padrao: string) {
    setAviso(null)
    setErro(e instanceof ApiError ? e.detail : padrao)
  }

  // v6.2a - os e-mails que falharam voltam para a fila (a rotina tenta de novo na próxima rodada)
  const reenviar = useMutation({
    mutationFn: () => reenviarEmailsDoAviso(idAviso),
    onSuccess: (r) => {
      setErro(null)
      queryClient.setQueryData(chave, r.aviso)
      queryClient.invalidateQueries({ queryKey: ['avisos'] })
      setAviso(
        r.voltaram_para_a_fila === 0
          ? 'Nenhum e-mail com falha para reenviar.'
          : `${r.voltaram_para_a_fila} ${r.voltaram_para_a_fila === 1 ? 'e-mail voltou' : 'e-mails voltaram'} para a fila; a rotina do sistema tenta de novo na próxima rodada.`,
      )
    },
    onError: (e) => falhou(e, 'Não foi possível reenviar.'),
  })

  const incluir = useMutation({
    mutationFn: () => incluirNovosNoAviso(idAviso),
    onSuccess: (r) => {
      setErro(null)
      queryClient.setQueryData(chave, r.aviso)
      queryClient.invalidateQueries({ queryKey: ['avisos'] })
      setAviso(
        r.incluidos === 0
          ? 'Ninguém novo no grupo: a lista já estava completa.'
          : `${r.incluidos} ${r.incluidos === 1 ? 'pessoa incluída' : 'pessoas incluídas'}.`,
      )
    },
    onError: (e) => falhou(e, 'Não foi possível incluir.'),
  })

  const retirar = useMutation({
    mutationFn: () => retirarAviso(idAviso, motivo.trim()),
    onSuccess: (atualizado) => {
      setErro(null)
      setRetirando(false)
      setMotivo('')
      queryClient.setQueryData(chave, atualizado)
      queryClient.invalidateQueries({ queryKey: ['avisos'] })
      setAviso('Aviso retirado do mural.')
    },
    onError: (e) => falhou(e, 'Não foi possível retirar.'),
  })

  const trilha = [
    { rotulo: 'Avisos publicados', href: '/comunicacao' },
    { rotulo: 'Aviso' },
  ]
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError || !data)
    return (
      <>
        <PageHeader titulo="Aviso" trilha={trilha} />
        <p role="alert" className="text-sm text-destructive">
          Aviso não encontrado.
        </p>
      </>
    )

  const lista = filtrarDestinatarios(data.destinatarios, filtro)
  const tamanhoDoMotivo = motivo.trim().length
  const motivoValido =
    tamanhoDoMotivo >= MOTIVO_MINIMO && tamanhoDoMotivo <= MOTIVO_MAXIMO

  return (
    <>
      <PageHeader titulo={data.titulo} trilha={trilha} />
      {aviso && (
        <p
          role="status"
          className="mb-4 max-w-3xl rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
        >
          {aviso}
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="mb-4 max-w-3xl rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      <article className="max-w-3xl rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 ${COR_DA_SITUACAO[data.situacao]}`}
          >
            {data.situacao}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5">
            {data.categoria_rotulo}
          </span>
          <span className="text-muted-foreground">
            Publicado em {formatarData(data.publicado_em, { comHora: true })}
            {data.autor ? ` por ${data.autor}` : ''} · no mural até{' '}
            {formatarData(data.valido_ate)}
            {data.exige_confirmacao ? ' · pede confirmação' : ''}
          </span>
        </div>
        <p className="mb-3 text-sm">
          <span className="font-medium">Para quem:</span>{' '}
          {data.publico_descricao}
        </p>
        {data.modelo && (
          <p className="mb-3 text-sm">
            <span className="font-medium">Modelo usado:</span>{' '}
            {data.modelo.nome} (versão {data.modelo.versao})
          </p>
        )}
        {data.situacao === 'Retirado' && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            Retirado
            {data.retirado_em
              ? ` em ${formatarData(data.retirado_em, { comHora: true })}`
              : ''}
            . Motivo: {data.motivo_retirada}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {data.texto}
        </p>
      </article>

      <section className="mt-6 max-w-4xl" aria-labelledby="titulo-da-leitura">
        <h2 id="titulo-da-leitura" className="mb-2 font-semibold">
          Relatório de leitura
        </h2>
        <p className="mb-3 text-sm" role="status">
          Receberam: {data.totais.destinatarios}
          {data.totais.sem_acesso
            ? ` (${data.totais.sem_acesso} sem acesso ao painel)`
            : ''}{' '}
          · Leram: {data.totais.lidos ?? '—'}
          {data.exige_confirmacao
            ? ` · Confirmaram: ${data.totais.confirmados ?? '—'}`
            : ''}
        </p>
        {data.por_email && (
          <p className="-mt-2 mb-3 text-sm">
            E-mail: {resumoDoEmail(data.email, data.por_email)}
            <span className="block text-xs text-muted-foreground">
              “Enviado” quer dizer que saiu do e-mail da ASAF. Se a caixa de
              destino devolver depois, a devolução chega à caixa
              asaf@asaf.org.br.
            </span>
          </p>
        )}
        {data.leitura_apagada_em ? (
          <p className="text-sm text-muted-foreground">
            A lista de quem recebeu, leu e confirmou foi apagada em{' '}
            {formatarData(data.leitura_apagada_em)} pelo prazo de guarda
            (Configurações); ficam os totais acima.
          </p>
        ) : data.nomes_ocultos ? (
          <p className="text-sm text-muted-foreground">
            Este aviso foi para um grupo escolhido pela situação do associado
            (em dia, inadimplente...). Os nomes só aparecem para quem tem a
            permissão de Associados ou do Financeiro; aqui ficam os totais.
          </p>
        ) : (
          <>
            <label className="mb-3 inline-block text-sm">
              <span className="mr-2 font-medium">Mostrar</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as FiltroDaLeitura)}
              >
                {FILTROS.filter(
                  (f) => data.por_email || f.valor !== 'email_falhou',
                ).map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pessoa</th>
                    <th className="px-3 py-2 font-medium">Leitura</th>
                    <th className="px-3 py-2 font-medium">Lido em</th>
                    {data.exige_confirmacao && (
                      <th className="px-3 py-2 font-medium">Confirmado em</th>
                    )}
                    {data.por_email && (
                      <th className="px-3 py-2 font-medium">E-mail</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lista.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-muted-foreground"
                        colSpan={
                          3 +
                          (data.exige_confirmacao ? 1 : 0) +
                          (data.por_email ? 1 : 0)
                        }
                      >
                        Ninguém nesta lista.
                      </td>
                    </tr>
                  ) : (
                    lista.map((d) => (
                      <tr
                        key={d.id_destinatario}
                        className="border-t border-border"
                      >
                        <td className="px-3 py-2">{d.nome}</td>
                        <td className="px-3 py-2">{textoDaLeitura(d)}</td>
                        <td className="px-3 py-2">
                          {d.lido_em
                            ? formatarData(d.lido_em, { comHora: true })
                            : '—'}
                        </td>
                        {data.exige_confirmacao && (
                          <td className="px-3 py-2">
                            {d.confirmado_em
                              ? formatarData(d.confirmado_em, { comHora: true })
                              : '—'}
                          </td>
                        )}
                        {data.por_email && (
                          <td className="px-3 py-2">
                            {textoDoEmail(d.email)}
                            {d.email?.enviado_em
                              ? ` em ${formatarData(d.email.enviado_em, { comHora: true })}`
                              : ''}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {data.situacao === 'No mural' && (
        <section className="mt-6 max-w-3xl space-y-4" aria-label="Ações">
          <div>
            <Button
              variant="outline"
              disabled={incluir.isPending}
              onClick={() => incluir.mutate()}
            >
              Incluir quem entrou no grupo depois
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Recalcula o grupo de hoje e acrescenta só quem ainda não estava na
              lista; ninguém sai dela.
            </p>
          </div>
          {data.por_email && (data.email?.['Falhou'] ?? 0) > 0 && (
            <div>
              <Button
                variant="outline"
                disabled={reenviar.isPending}
                onClick={() => reenviar.mutate()}
              >
                Reenviar os e-mails que falharam
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">
                Antes, confira o motivo de cada falha na coluna E-mail (ex.:
                endereço errado no cadastro).
              </p>
            </div>
          )}
          {retirando ? (
            <div className="rounded-xl border border-border p-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  Motivo da retirada
                </span>
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={motivo}
                  maxLength={MOTIVO_MAXIMO}
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Quem recebeu vai ler este motivo (de {MOTIVO_MINIMO} a{' '}
                  {MOTIVO_MAXIMO} letras).
                </span>
              </label>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="destructive"
                  disabled={!motivoValido || retirar.isPending}
                  onClick={() => retirar.mutate()}
                >
                  Retirar o aviso
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRetirando(false)
                    setMotivo('')
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setRetirando(true)}>
              Retirar do mural
            </Button>
          )}
        </section>
      )}
    </>
  )
}
