import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { corDaCategoria, COR_DA_CONFIRMACAO } from '@/lib/categorias-de-aviso'
import { confirmacaoPendente, listarMeusAvisos } from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.1 - o mural na página Início: os avisos que estão no mural para a própria pessoa (o servidor só devolve os dela), os que pedem
// confirmação e ainda não foram confirmados primeiro. A caixa de entrada completa (inclusive vencidos e retirados) é "Meus avisos".
// v9.5b - no novo visual (aprovado pelo Presidente) o mural é um cartão na coluna direita do Início, com a categoria em cor e uma bolinha verde no que não foi lido.
export function MuralDeAvisos() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['meus-avisos', 'mural'],
    queryFn: () => listarMeusAvisos(true),
    retry: false,
  })
  const avisos = data?.avisos ?? []

  return (
    <section
      aria-labelledby="titulo-do-mural"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-do-mural" className="text-[17px] font-extrabold">
          Mural de avisos
        </h2>
        <Link
          to="/meus-avisos"
          className="inline-flex min-h-6 items-center text-sm font-bold text-azul-texto underline-offset-4 hover:underline"
        >
          Todos os meus avisos
        </Link>
      </div>
      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Carregando o mural…
        </p>
      ) : isError ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Não foi possível carregar o mural agora.
        </p>
      ) : avisos.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhum aviso no mural.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {avisos.map((a) => (
            <li
              key={a.id_aviso}
              className="flex flex-col gap-1.5 border-t border-border py-3 first:border-t-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${corDaCategoria(a.categoria_rotulo)}`}
                >
                  {a.categoria_rotulo}
                </span>
                {confirmacaoPendente(a) && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${COR_DA_CONFIRMACAO}`}
                  >
                    Pede a sua confirmação
                  </span>
                )}
              </div>
              <span className="flex items-start gap-2">
                {!a.lido_em && (
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2.5 shrink-0 rounded-full bg-verde-texto"
                  />
                )}
                <Link
                  to={`/meus-avisos/${a.id_aviso}`}
                  className={`text-sm underline-offset-4 hover:underline ${a.lido_em ? 'font-semibold' : 'font-extrabold'}`}
                >
                  {a.titulo}
                </Link>
                {!a.lido_em && <span className="sr-only">(não lido)</span>}
              </span>
              <p className="text-xs text-muted-foreground">
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
