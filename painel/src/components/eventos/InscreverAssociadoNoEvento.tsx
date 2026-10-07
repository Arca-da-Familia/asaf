import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  inscreverAssociadoNoEvento,
  listarAssociadosParaSelecao,
} from '@/lib/api'

// A secretaria inscreve um associado no evento (sem o associado precisar entrar no painel). Passa pelo mesmo controle de vagas da inscrição
// do próprio associado: acima do limite a pessoa vai para a lista de espera, nunca fica uma vaga a mais. Quem inscreveu fica na Auditoria.
export function InscreverAssociadoNoEvento({ idEvento }: { idEvento: number }) {
  const queryClient = useQueryClient()
  const { data: pessoas } = useQuery({
    queryKey: ['associados-para-selecao'],
    queryFn: listarAssociadosParaSelecao,
  })
  const [idAssociado, setIdAssociado] = useState('')
  const [resultado, setResultado] = useState<string | null>(null)

  const inscrever = useMutation({
    mutationFn: (v: { id: number; nome: string }) =>
      inscreverAssociadoNoEvento(idEvento, { id_associado: v.id }),
    onSuccess: (r, v) => {
      setResultado(`Inscrição registrada: ${v.nome} — situação ${r.status}.`)
      setIdAssociado('')
      queryClient.invalidateQueries({
        queryKey: ['inscricoes', 'Evento', idEvento],
      })
    },
    onError: () => setResultado(null),
  })

  const escolhida = (pessoas ?? []).find(
    (p) => String(p.id_associado) === idAssociado,
  )

  return (
    // sem `p-2` de propósito: a lista de inscritos é contada pelos cartões `rounded-md border p-2` e este quadro não é um inscrito
    <div className="mb-3 rounded-md border border-border px-2 py-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label
            htmlFor={`inscrever-associado-${idEvento}`}
            className="mb-1 block text-xs text-muted-foreground"
          >
            Inscrever um associado
          </label>
          <select
            id={`inscrever-associado-${idEvento}`}
            value={idAssociado}
            onChange={(e) => {
              setIdAssociado(e.target.value)
              setResultado(null)
              inscrever.reset()
            }}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Escolha o associado</option>
            {(pessoas ?? []).map((p) => (
              <option key={p.id_associado} value={p.id_associado}>
                {p.nome_completo}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          disabled={!escolhida || inscrever.isPending}
          onClick={() =>
            escolhida &&
            inscrever.mutate({
              id: escolhida.id_associado,
              nome: escolhida.nome_completo,
            })
          }
        >
          {inscrever.isPending ? 'Inscrevendo…' : 'Inscrever'}
        </Button>
      </div>
      {inscrever.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {(inscrever.error as Error).message}
        </p>
      )}
      {resultado && (
        <p role="status" className="mt-2 text-xs text-green-600">
          {resultado}
        </p>
      )}
    </div>
  )
}
