import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import type { AtendimentoAberto } from '@/lib/api'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  eliminarAPedido,
  obterPreviaDaEliminacao,
  type EliminacaoFeita,
} from '@/lib/privacidade'

// v7.2d (FASE 7) - a eliminação a pedido do titular, decidida pelo encarregado em dois passos (decisão G do Presidente, 2026-10-29): a prévia diz o que sai e o
// que fica (com o fundamento de cada coisa) e, depois de "conferi", elimina. O servidor confere que a prévia é a mesma (409 se algo mudou). A resposta à pessoa
// continua escrita por quem atende: o resultado e o fundamento sugeridos vão para o formulário de resposta.
export function EliminacaoAPedido({
  a,
  aoEliminar,
}: {
  a: AtendimentoAberto
  aoEliminar: (resultado: string, fundamento: string | null) => void
}) {
  const queryClient = useQueryClient()
  const [ver, setVer] = useState(false)
  const [conferi, setConferi] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feita, setFeita] = useState<EliminacaoFeita | null>(null)

  const previa = useQuery({
    queryKey: ['privacidade', 'eliminacao', a.id_atendimento],
    queryFn: () => obterPreviaDaEliminacao(a.id_atendimento),
    enabled: ver && feita === null,
    staleTime: 0,
  })
  const eliminar = useMutation({
    mutationFn: () => eliminarAPedido(a.id_atendimento, previa.data!.impressao),
    onMutate: () => setErro(null),
    onSuccess: (r) => {
      setFeita(r)
      setConferi(false)
      aoEliminar(r.resultado_sugerido, r.fundamento_sugerido)
      queryClient.invalidateQueries({ queryKey: ['atendimentos'] })
    },
    onError: (e) => {
      setErro(mensagemDoErro(e, 'Não foi possível eliminar.'))
      setConferi(false)
      void previa.refetch()
    },
  })

  return (
    <section
      aria-label="Eliminar a pedido"
      data-eliminacao={feita ? 'feita' : 'pendente'}
      className="space-y-2 rounded-lg border border-border p-3 text-sm"
    >
      <h2 className="text-sm font-semibold">Eliminar a pedido</h2>
      {feita ? (
        <div role="status" className="space-y-1" data-eliminacao-feita>
          <p className="font-medium">Eliminado. Saiu:</p>
          <ul className="list-disc pl-5">
            {feita.sai.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p>
            Agora responda à pessoa: o resultado e o fundamento sugeridos já
            estão no formulário de resposta.
          </p>
        </div>
      ) : !ver ? (
        <>
          <p className="text-muted-foreground">
            Veja antes o que sai e o que fica (e por quê). A eliminação não tem
            volta.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setVer(true)}
          >
            Ver o que sai e o que fica
          </Button>
        </>
      ) : previa.isLoading ? (
        <p className="text-muted-foreground">Preparando a prévia…</p>
      ) : previa.isError ? (
        <p role="alert" className="text-destructive">
          {mensagemDoErro(previa.error, 'Não foi possível montar a prévia.')}
        </p>
      ) : previa.data ? (
        <>
          {previa.data.vinculos.length > 0 && (
            <p data-vinculos>
              <strong>O cadastro fica enquanto durar o vínculo:</strong>{' '}
              {previa.data.vinculos.join('; ')}.
            </p>
          )}
          <div data-sai>
            <p className="font-medium">Sai:</p>
            {previa.data.sai.length === 0 ? (
              <p className="text-muted-foreground">
                Nada pode sair agora: responda à pessoa com o fundamento do que
                fica.
              </p>
            ) : (
              <ul className="list-disc pl-5">
                {previa.data.sai.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
          <div data-fica>
            <p className="font-medium">Fica:</p>
            <ul className="list-disc pl-5">
              {previa.data.fica.map((f) => (
                <li key={`${f.tabela}-${f.nome}`}>
                  {f.nome} ({f.registros}): {f.por_que}
                </li>
              ))}
            </ul>
          </div>
          {previa.data.algum_corte && (
            <p role="alert" className="text-destructive">
              Uma das partes tem mais de 500 registros: só os mais novos entram
              agora. Depois de eliminar, abra a prévia de novo.
            </p>
          )}
          <p>
            <Link
              className="text-primary underline"
              to={`/privacidade/titulares?id_atendimento=${a.id_atendimento}`}
            >
              Abrir o relatório completo desta pessoa
            </Link>
          </p>
          {erro && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
            >
              {erro}
            </p>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={conferi}
              onChange={(e) => setConferi(e.target.checked)}
            />
            Conferi o que sai e o que fica: a eliminação não tem volta
          </label>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={
              !conferi || eliminar.isPending || previa.data.sai.length === 0
            }
            onClick={() => eliminar.mutate()}
          >
            Eliminar o que pode sair
          </Button>
        </>
      ) : null}
    </section>
  )
}
