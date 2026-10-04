import { Secao } from '@/components/layout/Secao'
import { formatarData } from '@/lib/datas'

export type EventoDaTrilha = {
  acao: string
  rotulo: string
  quando: string
  quem: string | null
  detalhes: Record<string, unknown>
}

// Histórico "quem fez o quê e quando", vindo da auditoria. O servidor só manda os campos que podem ser vistos.
export function Trilha({ eventos }: { eventos: EventoDaTrilha[] | undefined }) {
  return (
    <Secao titulo="Histórico (quem fez o quê)">
      {!eventos || eventos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem registros.</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {eventos.map((e, i) => (
            <li key={`${e.acao}-${e.quando}-${i}`}>
              <span className="text-muted-foreground">
                {formatarData(e.quando, { comHora: true })}
              </span>{' '}
              — <strong>{e.rotulo}</strong>
              {e.quem ? ` por ${e.quem}` : ''}
              {typeof e.detalhes.motivo === 'string'
                ? `: ${e.detalhes.motivo}`
                : ''}
            </li>
          ))}
        </ol>
      )}
    </Secao>
  )
}
