import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import {
  COR_DA_SITUACAO,
  abrirMeuAviso,
  confirmarMeuAviso,
  podeConfirmar,
} from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.1 - um aviso recebido. Abrir registra a leitura (no servidor, só da primeira vez). O aviso que pede confirmação tem o botão
// "Li e estou ciente", que grava a data e vai para a Auditoria. O texto é mostrado como TEXTO (nunca HTML), com as quebras de linha.
export function MeuAvisoPage() {
  const { id } = useParams()
  const idAviso = Number(id)
  const queryClient = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)

  const {
    data: aviso,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['meus-avisos', 'um', idAviso],
    queryFn: async () => {
      const aberto = await abrirMeuAviso(idAviso)
      // abrir marcou como lido: o mural e a caixa de entrada precisam ver isso
      queryClient.invalidateQueries({ queryKey: ['meus-avisos', 'mural'] })
      queryClient.invalidateQueries({ queryKey: ['meus-avisos', 'todos'] })
      return aberto
    },
    enabled: Number.isInteger(idAviso) && idAviso > 0,
    retry: false,
  })

  const confirmar = useMutation({
    mutationFn: () => confirmarMeuAviso(idAviso),
    onSuccess: (atualizado) => {
      setErro(null)
      queryClient.setQueryData(['meus-avisos', 'um', idAviso], atualizado)
      queryClient.invalidateQueries({ queryKey: ['meus-avisos', 'mural'] })
      queryClient.invalidateQueries({ queryKey: ['meus-avisos', 'todos'] })
    },
    onError: (e) =>
      setErro(e instanceof ApiError ? e.detail : 'Não foi possível confirmar.'),
  })

  const trilha = [
    { rotulo: 'Meus avisos', href: '/meus-avisos' },
    { rotulo: 'Aviso' },
  ]

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError || !aviso)
    return (
      <>
        <PageHeader titulo="Aviso" trilha={trilha} />
        <p role="alert" className="text-sm text-destructive">
          Aviso não encontrado.
        </p>
      </>
    )

  return (
    <>
      <PageHeader titulo={aviso.titulo} trilha={trilha} />
      <article className="max-w-3xl rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 ${COR_DA_SITUACAO[aviso.situacao]}`}
          >
            {aviso.situacao}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5">
            {aviso.categoria_rotulo}
          </span>
          <span className="text-muted-foreground">
            Publicado em {formatarData(aviso.publicado_em, { comHora: true })}
            {aviso.autor ? ` por ${aviso.autor}` : ''} · no mural até{' '}
            {formatarData(aviso.valido_ate)}
          </span>
        </div>
        {aviso.situacao === 'Retirado' && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            Este aviso foi retirado
            {aviso.retirado_em
              ? ` em ${formatarData(aviso.retirado_em, { comHora: true })}`
              : ''}
            . Motivo: {aviso.motivo_retirada}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {aviso.texto}
        </p>
      </article>

      <section className="mt-4 max-w-3xl text-sm" aria-label="Leitura">
        {aviso.lido_em && (
          <p className="text-muted-foreground">
            Você leu em {formatarData(aviso.lido_em, { comHora: true })}.
          </p>
        )}
        {aviso.confirmado_em ? (
          <p
            role="status"
            className="mt-2 flex items-center gap-2 font-medium text-primary"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Você confirmou que leu e está ciente em{' '}
            {formatarData(aviso.confirmado_em, { comHora: true })}.
          </p>
        ) : podeConfirmar(aviso) ? (
          <div className="mt-3 rounded-xl border border-border bg-card p-3">
            <p>
              Este aviso pede a sua confirmação. Ao confirmar, fica registrado
              que você leu e está ciente, com a data e a hora.
            </p>
            <Button
              className="mt-3"
              disabled={confirmar.isPending}
              onClick={() => confirmar.mutate()}
            >
              Li e estou ciente
            </Button>
          </div>
        ) : null}
        {erro && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {erro}
          </p>
        )}
      </section>
    </>
  )
}
