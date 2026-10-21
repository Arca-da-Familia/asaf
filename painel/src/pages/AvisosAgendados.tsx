import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import {
  MOTIVO_MAXIMO,
  MOTIVO_MINIMO,
  cancelarAgendado,
  listarAgendados,
  type SituacaoDoAgendamento,
} from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.2c - os avisos agendados: saem na PRIMEIRA rodada da rotina do sistema depois da hora marcada (de 15 em 15 minutos; o GitHub às vezes atrasa a rotina em horas), com o
// grupo calculado naquela hora. Quem tem `comunicar` cancela antes, com motivo.
const SITUACOES: SituacaoDoAgendamento[] = [
  'Agendado',
  'Publicado',
  'Cancelado',
]

export function AvisosAgendadosPage() {
  const queryClient = useQueryClient()
  const [situacao, setSituacao] = useState<SituacaoDoAgendamento>('Agendado')
  const [cancelando, setCancelando] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['avisos-agendados', situacao],
    queryFn: () => listarAgendados(situacao),
  })
  const cancelar = useMutation({
    mutationFn: (id: number) => cancelarAgendado(id, motivo.trim()),
    onSuccess: () => {
      setErro(null)
      setCancelando(null)
      setMotivo('')
      setAviso('Agendamento cancelado: o aviso não será publicado.')
      queryClient.invalidateQueries({ queryKey: ['avisos-agendados'] })
    },
    onError: (e) => {
      setAviso(null)
      setErro(e instanceof ApiError ? e.detail : 'Não foi possível cancelar.')
    },
  })
  const tamanho = motivo.trim().length
  const motivoValido = tamanho >= MOTIVO_MINIMO && tamanho <= MOTIVO_MAXIMO
  const itens = data ?? []

  return (
    <>
      <PageHeader
        titulo="Avisos agendados"
        descricao="O aviso sai na primeira rodada da rotina do sistema depois da hora marcada (ela roda de 15 em 15 minutos e às vezes atrasa), com o grupo calculado naquela hora."
      />
      <label className="mb-4 inline-block text-sm">
        <span className="mr-2 font-medium">Situação</span>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={situacao}
          onChange={(e) => setSituacao(e.target.value as SituacaoDoAgendamento)}
        >
          {SITUACOES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
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
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os agendamentos.
        </p>
      ) : itens.length === 0 ? (
        <EmptyState
          titulo={`Nenhum aviso ${situacao.toLowerCase()}`}
          descricao="Para agendar, escolha “Depois (agendar)” no Novo aviso."
        />
      ) : (
        <ul className="max-w-3xl space-y-3">
          {itens.map((a) => (
            <li
              key={a.id_agendado}
              className="rounded-xl border border-border bg-card p-4 text-sm"
            >
              <p className="font-semibold">{a.titulo}</p>
              <p className="text-muted-foreground">
                Publicar em {formatarData(a.publicar_em, { comHora: true })} ·
                para {a.publico_descricao} ({a.total_conferido} na conferência)
                {a.por_email ? ' · também por e-mail' : ''}
              </p>
              {a.situacao === 'Publicado' && a.id_aviso && (
                <Link to={`/comunicacao/${a.id_aviso}`} className="underline">
                  Ver o aviso publicado
                </Link>
              )}
              {a.situacao === 'Cancelado' && a.motivo && (
                <p>Motivo: {a.motivo}</p>
              )}
              {a.situacao === 'Agendado' &&
                (cancelando === a.id_agendado ? (
                  <div className="mt-3">
                    <label className="block">
                      <span className="mb-1 block font-medium">
                        Motivo do cancelamento
                      </span>
                      <textarea
                        className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={motivo}
                        maxLength={MOTIVO_MAXIMO}
                        onChange={(e) => setMotivo(e.target.value)}
                      />
                    </label>
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={!motivoValido || cancelar.isPending}
                        onClick={() => cancelar.mutate(a.id_agendado)}
                      >
                        Cancelar o agendamento
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCancelando(null)
                          setMotivo('')
                        }}
                      >
                        Voltar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => setCancelando(a.id_agendado)}
                  >
                    Cancelar
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
