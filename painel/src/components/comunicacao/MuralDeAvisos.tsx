import { useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { Link } from 'react-router'

import { confirmacaoPendente, listarMeusAvisos } from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.1 - o mural na página Início: os avisos que estão no mural para a própria pessoa (o servidor só devolve os dela), os que pedem
// confirmação e ainda não foram confirmados primeiro. A caixa de entrada completa (inclusive vencidos e retirados) é "Meus avisos".
export function MuralDeAvisos() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['meus-avisos', 'mural'],
    queryFn: () => listarMeusAvisos(true),
    retry: false,
  })
  const avisos = data?.avisos ?? []

  return (
    <section className="mt-6" aria-labelledby="titulo-do-mural">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-do-mural" className="font-semibold">
          Mural de avisos
        </h2>
        <Link to="/meus-avisos" className="text-sm underline">
          Todos os meus avisos
        </Link>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando o mural…</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          Não foi possível carregar o mural agora.
        </p>
      ) : avisos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum aviso no mural.</p>
      ) : (
        <ul className="space-y-2">
          {avisos.map((a) => (
            <li
              key={a.id_aviso}
              className="rounded-xl border border-border bg-card p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Megaphone
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <Link
                  to={`/meus-avisos/${a.id_aviso}`}
                  className={`underline ${a.lido_em ? '' : 'font-semibold'}`}
                >
                  {a.titulo}
                </Link>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {a.categoria_rotulo}
                </span>
                {confirmacaoPendente(a) && (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    Pede a sua confirmação
                  </span>
                )}
                {!a.lido_em && <span className="sr-only">(não lido)</span>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {a.autor ? `${a.autor} · ` : ''}publicado em{' '}
                {formatarData(a.publicado_em)} · no mural até{' '}
                {formatarData(a.valido_ate)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
