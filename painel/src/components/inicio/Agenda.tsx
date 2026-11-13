import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { listarEventosCalendario } from '@/lib/api'
import { comoUtc } from '@/lib/datas'

// a data e hora vêm do servidor em UTC sem o fuso escrito (a mesma convenção de formatarData): mostrar no fuso de quem usa
function paraData(valor: string): Date {
  return valor.includes('T')
    ? new Date(comoUtc(valor))
    : new Date(`${valor}T00:00:00`)
}

const MESES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

// v9.5b - a agenda do Início (desenho aprovado pelo Presidente, rodada 2): os 3 próximos compromissos do calendário institucional, que qualquer pessoa com acesso
// vê (o servidor não pede permissão para ler o calendário).
export function Agenda() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['eventos-calendario'],
    queryFn: listarEventosCalendario,
    retry: false,
  })
  // calculado uma vez ao abrir a tela (a regra de pureza do React não aceita ler o relógio a cada desenho)
  const [agora] = useState(() => new Date())
  const inicioDeHoje = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate(),
  )
  const proximos = (data ?? [])
    .filter((e) => paraData(e.data_fim ?? e.data_inicio) >= inicioDeHoje)
    .sort(
      (a, b) =>
        paraData(a.data_inicio).getTime() - paraData(b.data_inicio).getTime(),
    )
    .slice(0, 3)

  return (
    <section
      aria-labelledby="titulo-da-agenda"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="titulo-da-agenda" className="text-[17px] font-extrabold">
          Agenda
        </h2>
        <Link
          to="/calendario"
          className="text-sm font-bold text-azul-texto underline-offset-4 hover:underline"
        >
          Ver o calendário
        </Link>
      </div>
      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Carregando a agenda…
        </p>
      ) : isError ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Não foi possível carregar a agenda agora.
        </p>
      ) : proximos.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhum compromisso marcado.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {proximos.map((e) => {
            const d = paraData(e.data_inicio)
            return (
              <li key={e.id_evento} className="flex items-center gap-3">
                <span className="flex h-[52px] w-12 shrink-0 flex-col items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
                  <span className="text-lg leading-none font-extrabold">
                    {String(d.getDate()).padStart(2, '0')}
                  </span>
                  <span className="text-[11px] font-extrabold uppercase">
                    {MESES[d.getMonth()]}
                  </span>
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-bold">{e.titulo}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.categoria}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
