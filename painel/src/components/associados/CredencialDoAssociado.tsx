import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  ApiError,
  emitirOutraCredencial,
  obterCredencialDoAssociado,
} from '@/lib/api'

// v9.5i - a credencial (carteirinha) do associado, na ficha (aba Situação): quando foi emitida, a página que o QR abre, e "Emitir outra" para quem perdeu
// o cartão - a anterior deixa de valer NA HORA (o QR dela passa a mostrar "Esta credencial não vale"). A tela das credenciais emitidas (imprimir várias)
// vem na versão seguinte.

function dataBR(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem' }).format(
    new Date(iso),
  )
}

export function CredencialDoAssociado({
  idAssociado,
  desligado,
}: {
  idAssociado: number
  desligado: boolean
}) {
  const cliente = useQueryClient()
  const [confirmando, setConfirmando] = useState(false)
  const [aviso, setAviso] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['credencial-do-associado', idAssociado],
    queryFn: () => obterCredencialDoAssociado(idAssociado),
    enabled: !desligado,
  })
  const emitir = useMutation({
    mutationFn: () => emitirOutraCredencial(idAssociado),
    onSuccess: (r) => {
      setConfirmando(false)
      setAviso(r.mensagem)
      cliente.setQueryData(['credencial-do-associado', idAssociado], r)
    },
    onError: (erro) =>
      setAviso(
        erro instanceof ApiError
          ? erro.detail
          : 'Não foi possível emitir outra credencial agora.',
      ),
  })

  return (
    <section
      aria-labelledby="titulo-credencial"
      className="mt-6 rounded-xl border border-border bg-card p-6"
    >
      <h2 id="titulo-credencial" className="font-semibold">
        Credencial (carteirinha)
      </h2>
      {desligado ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Desligado: a credencial não vale. Quem ler o QR vê &quot;Esta
          credencial não vale&quot;.
        </p>
      ) : isLoading || !data ? (
        <p className="mt-1 text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <p className="mt-1 text-sm">
            Emitida em <strong>{dataBR(data.emitida_em)}</strong>. O QR vale
            sempre e mostra a situação de agora.{' '}
            <a
              href={data.pagina}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-azul-texto underline underline-offset-2"
            >
              Abrir a página de conferência
            </a>
          </p>
          {!confirmando ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3 min-h-11 sm:min-h-9"
              onClick={() => {
                setAviso('')
                setConfirmando(true)
              }}
            >
              Emitir outra credencial
            </Button>
          ) : (
            <div className="mt-3 flex flex-col gap-2 rounded-lg bg-ouro-tinta p-3 text-sm text-ouro-texto">
              <p>
                Use quando o cartão foi perdido: o QR da credencial atual deixa
                de valer na hora e a pessoa precisa da nova (no celular ou
                impressa).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="min-h-11 sm:min-h-9"
                  disabled={emitir.isPending}
                  onClick={() => emitir.mutate()}
                >
                  Sim, emitir outra
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => setConfirmando(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <p role="status" className="mt-2 text-sm font-semibold empty:hidden">
        {aviso}
      </p>
    </section>
  )
}
