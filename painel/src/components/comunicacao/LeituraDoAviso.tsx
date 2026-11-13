import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { corDaCategoria } from '@/lib/categorias-de-aviso'
import {
  COR_DA_SITUACAO,
  confirmarMeuAviso,
  podeConfirmar,
  type MeuAviso,
} from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.1 - um aviso recebido. O aviso que pede confirmação tem o botão "Li e estou ciente", que grava a data e vai para a Auditoria. O texto é mostrado como
// TEXTO (nunca HTML), com as quebras de linha. v9.5b - separado da página para servir também à leitura ao lado da lista em "Meus avisos" (desenho aprovado pelo
// Presidente: "lista e leitura lado a lado" no notebook).
export function LeituraDoAviso({
  aviso,
  idAviso,
}: {
  aviso: MeuAviso
  idAviso: number
}) {
  const queryClient = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
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

  return (
    <>
      <article className="max-w-3xl rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2.5 py-0.5 font-bold ${COR_DA_SITUACAO[aviso.situacao]}`}
          >
            {aviso.situacao}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 font-bold ${corDaCategoria(aviso.categoria_rotulo)}`}
          >
            {aviso.categoria_rotulo}
          </span>
          <span className="text-muted-foreground">
            Publicado em {formatarData(aviso.publicado_em, { comHora: true })}
            {aviso.autor ? ` por ${aviso.autor}` : ''} · no mural até{' '}
            {formatarData(aviso.valido_ate)}
          </span>
        </div>
        {aviso.situacao === 'Retirado' && (
          <p className="mb-3 rounded-xl border border-destructive/30 bg-perigo-tinta px-3 py-2 text-sm">
            Este aviso foi retirado
            {aviso.retirado_em
              ? ` em ${formatarData(aviso.retirado_em, { comHora: true })}`
              : ''}
            . Motivo: {aviso.motivo_retirada}
          </p>
        )}
        <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
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
            className="mt-2 flex items-center gap-2 font-bold text-verde-texto"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Você confirmou que leu e está ciente em{' '}
            {formatarData(aviso.confirmado_em, { comHora: true })}.
          </p>
        ) : podeConfirmar(aviso) ? (
          <div className="mt-3 rounded-2xl border border-border bg-ouro-tinta p-4">
            <p>
              Este aviso pede a sua confirmação. Ao confirmar, fica registrado
              que você leu e está ciente, com a data e a hora.
            </p>
            <Button
              className="mt-3 h-11 rounded-xl px-5 font-bold"
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
