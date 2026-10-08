import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  listarMinhasNotificacoes,
  marcarAvisoComoLido,
  marcarTodosOsAvisosComoLidos,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

// O sino do topo: os avisos do painel para a própria pessoa (hoje, o chamado da filiação para propor um candidato). A contagem de não lidos
// aparece no sino e se atualiza sozinha a cada minuto; abrir o aviso o marca como lido e leva à tela dele.
export function SinoDeAvisos() {
  const queryClient = useQueryClient()
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)

  const { data } = useQuery({
    queryKey: ['minhas-notificacoes'],
    queryFn: listarMinhasNotificacoes,
    refetchInterval: 60_000,
    retry: false,
  })
  const naoLidas = data?.nao_lidas ?? 0

  const atualizar = () =>
    queryClient.invalidateQueries({ queryKey: ['minhas-notificacoes'] })
  const lerUm = useMutation({
    mutationFn: (id: number) => marcarAvisoComoLido(id),
    onSuccess: atualizar,
  })
  const lerTodos = useMutation({
    mutationFn: () => marcarTodosOsAvisosComoLidos(),
    onSuccess: atualizar,
  })

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node))
        setAberto(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  return (
    <div className="relative" ref={raiz}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          naoLidas > 0
            ? `Notificações (${naoLidas} ${naoLidas === 1 ? 'nova' : 'novas'})`
            : 'Notificações'
        }
        aria-expanded={aberto}
        aria-controls="painel-de-avisos"
        onClick={() => setAberto((v) => !v)}
      >
        <Bell className="h-5 w-5" />
        {naoLidas > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
          >
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </Button>

      {aberto && (
        <section
          id="painel-de-avisos"
          aria-label="Avisos do painel"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-border bg-card p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Avisos</h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={naoLidas === 0 || lerTodos.isPending}
              onClick={() => lerTodos.mutate()}
            >
              Marcar todos como lidos
            </Button>
          </div>
          {(data?.avisos ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum aviso.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto">
              {(data?.avisos ?? []).map((a) => (
                <li
                  key={a.id_notificacao}
                  className="rounded-md border border-border p-2 text-sm"
                >
                  <p className={a.lida ? '' : 'font-semibold'}>
                    {a.link ? (
                      <Link
                        to={a.link}
                        className="underline"
                        onClick={() => {
                          if (!a.lida) lerUm.mutate(a.id_notificacao)
                          setAberto(false)
                        }}
                      >
                        {a.titulo}
                      </Link>
                    ) : (
                      a.titulo
                    )}
                  </p>
                  {a.texto && (
                    <p className="text-xs text-muted-foreground">{a.texto}</p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatarData(a.criado_em, { comHora: true })}
                    {a.lida ? ' · lido' : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
