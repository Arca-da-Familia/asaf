import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  listarPedidosParaPropor,
  proporCandidato,
  type PedidoParaPropor,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

// Pedidos de filiação para o SÓCIO decidir (Estatuto Art. 12, par. único VI: o pedido de adesão tem de ser proposto por 3 sócios). Qualquer sócio
// ativo e em dia propõe ou recusa (recusar pede o motivo); não há prazo — sem resposta o pedido fica pendente. O sócio vê só o nome e a idade
// do candidato: CPF, e-mail e telefone são da Diretoria, na conferência.
function Pedido({ pedido }: { pedido: PedidoParaPropor }) {
  const queryClient = useQueryClient()
  const [recusando, setRecusando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const decidir = useMutation({
    mutationFn: (v: { decisao: 'Propõe' | 'Recusa'; observacao?: string }) =>
      proporCandidato(pedido.id_proposta, v),
    onSuccess: () => {
      setRecusando(false)
      setMotivo('')
      queryClient.invalidateQueries({ queryKey: ['pedidos-para-propor'] })
    },
  })

  return (
    <li
      aria-label={`Pedido de ${pedido.nome_completo}`}
      className="rounded-xl border border-border bg-card p-5"
    >
      <p className="font-semibold">{pedido.nome_completo}</p>
      <p className="text-sm text-muted-foreground">
        {pedido.idade !== null ? `${pedido.idade} anos · ` : ''}pedido de{' '}
        {formatarData(pedido.criado_em)}
      </p>
      <p className="mt-1 text-sm">
        {pedido.total_propoem} de {pedido.exigidos} sócios já propuseram
        {pedido.faltam > 0
          ? ` — faltam ${pedido.faltam}.`
          : ' — o pedido já tem os sócios que o Estatuto pede.'}
      </p>
      {pedido.minha_decisao && (
        <p className="mt-2 text-sm font-medium" role="status">
          {pedido.minha_decisao === 'Propõe'
            ? 'Você propôs este candidato.'
            : `Você recusou este candidato: “${pedido.meu_motivo}”.`}
        </p>
      )}

      {!recusando && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            aria-label={`Propor ${pedido.nome_completo}`}
            disabled={pedido.minha_decisao === 'Propõe' || decidir.isPending}
            onClick={() => decidir.mutate({ decisao: 'Propõe' })}
          >
            {pedido.minha_decisao === 'Propõe' ? 'Você propôs' : 'Propor'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`Recusar ${pedido.nome_completo}`}
            disabled={pedido.minha_decisao === 'Recusa' || decidir.isPending}
            onClick={() => setRecusando(true)}
          >
            {pedido.minha_decisao === 'Recusa' ? 'Você recusou' : 'Recusar'}
          </Button>
        </div>
      )}

      {recusando && (
        <div className="mt-3 space-y-2">
          <label
            htmlFor={`motivo-${pedido.id_proposta}`}
            className="block text-xs font-medium"
          >
            Motivo da recusa (a Diretoria lê o que você escrever)
          </label>
          <textarea
            id={`motivo-${pedido.id_proposta}`}
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={motivo.trim().length < 5 || decidir.isPending}
              onClick={() =>
                decidir.mutate({ decisao: 'Recusa', observacao: motivo.trim() })
              }
            >
              Confirmar recusa
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRecusando(false)
                setMotivo('')
                decidir.reset()
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {decidir.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {(decidir.error as Error).message}
        </p>
      )}
    </li>
  )
}

export function FiliacaoParaProporPage() {
  const {
    data: pedidos,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['pedidos-para-propor'],
    queryFn: listarPedidosParaPropor,
    retry: false,
  })

  return (
    <>
      <PageHeader
        titulo="Pedidos de filiação"
        descricao="Quem quer se associar precisa ser proposto por 3 sócios (Estatuto, Art. 12). Proponha quem você conhece ou recuse, com o motivo."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Pedidos de filiação' },
        ]}
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {(error as Error).message}
        </p>
      ) : !pedidos?.length ? (
        <EmptyState
          icone={UserPlus}
          titulo="Nenhum pedido em aberto"
          descricao="Quando alguém pedir para se associar, você é avisado no sino do topo."
        />
      ) : (
        <ul className="v3-space-y-4">
          {pedidos.map((p) => (
            <Pedido key={p.id_proposta} pedido={p} />
          ))}
        </ul>
      )}
    </>
  )
}
