import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  ApiError,
  mudarContribuicaoDoAssociado,
  obterContribuicaoDoAssociado,
  type OpcaoDeContribuicao,
} from '@/lib/api'

// v9.6a - a forma de pagamento da contribuição, na ficha (aba Situação): decisão do Presidente (21/11/2026) - a associação tem os planos mensal e
// semestral; cada associado escolhe o seu e a secretaria marca aqui. O semestral é cobrado em janeiro e julho; quem passa a semestral no meio do
// semestre paga o resto dele. Vale a partir da próxima cobrança, e nenhum mês é cobrado duas vezes.

function reais(valor: number | null): string {
  if (valor == null) return 'sem valor vigente'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function descricaoDaOpcao(o: OpcaoDeContribuicao): string {
  return `${reais(o.valor)} ${o.quando_cobra}, vencimento dia ${o.dia_vencimento}`
}

export function ContribuicaoDoAssociado({
  idAssociado,
}: {
  idAssociado: number
}) {
  const cliente = useQueryClient()
  const [escolha, setEscolha] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['contribuicao-do-associado', idAssociado],
    queryFn: () => obterContribuicaoDoAssociado(idAssociado),
  })
  const salvar = useMutation({
    mutationFn: (periodicidade: string) =>
      mudarContribuicaoDoAssociado(idAssociado, periodicidade),
    onSuccess: async (r) => {
      setAviso(r.mensagem)
      setEscolha(null)
      await cliente.invalidateQueries({
        queryKey: ['contribuicao-do-associado', idAssociado],
      })
    },
    onError: (erro) =>
      setAviso(
        erro instanceof ApiError
          ? erro.detail
          : 'Não foi possível mudar a forma de pagamento agora.',
      ),
  })

  const marcada = escolha ?? data?.periodicidade ?? ''
  const mudou =
    !!data && marcada.toLowerCase() !== data.periodicidade.toLowerCase()

  return (
    <section
      aria-labelledby="titulo-contribuicao"
      className="mt-6 rounded-xl border border-border bg-card p-6"
    >
      <h2 id="titulo-contribuicao" className="font-semibold">
        Contribuição
      </h2>
      {isLoading || !data ? (
        <p className="mt-1 text-sm text-muted-foreground">Carregando…</p>
      ) : data.opcoes.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          A categoria {data.categoria ?? '(sem categoria)'} não tem plano de
          contribuição ativo: a pessoa não é cobrada.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (mudou) salvar.mutate(marcada)
          }}
        >
          {!data.tem_plano && (
            <p className="mt-2 rounded-lg bg-ouro-tinta p-3 text-sm text-ouro-texto">
              A forma marcada ({data.periodicidade.toLowerCase()}) não tem plano
              ativo na categoria {data.categoria}: a pessoa não está sendo
              cobrada. Escolha uma das formas abaixo.
            </p>
          )}
          <fieldset className="mt-2">
            <legend className="text-sm text-muted-foreground">
              Forma de pagamento (categoria {data.categoria})
            </legend>
            <div className="mt-2 flex flex-col gap-2">
              {data.opcoes.map((o) => {
                const id = `contribuicao-${o.periodicidade.toLowerCase()}`
                return (
                  <label
                    key={o.periodicidade}
                    htmlFor={id}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-brand-secondary has-[:checked]:bg-muted/40 sm:min-h-9"
                  >
                    <input
                      id={id}
                      type="radio"
                      name="forma-de-pagamento"
                      value={o.periodicidade}
                      checked={
                        marcada.toLowerCase() === o.periodicidade.toLowerCase()
                      }
                      onChange={() => {
                        setAviso('')
                        setEscolha(o.periodicidade)
                      }}
                      className="mt-0.5 size-4"
                    />
                    <span>
                      <strong>{o.periodicidade}</strong>
                      <span className="block text-muted-foreground">
                        {descricaoDaOpcao(o)}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <p className="mt-2 text-xs text-muted-foreground">
            Vale a partir da próxima cobrança. Quem passa a semestral no meio do
            semestre paga o resto dele; nenhum mês é cobrado duas vezes.
          </p>
          <Button
            type="submit"
            className="mt-3 min-h-11 sm:min-h-9"
            disabled={!mudou || salvar.isPending}
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar forma de pagamento'}
          </Button>
        </form>
      )}
      <p role="status" className="mt-2 text-sm font-semibold empty:hidden">
        {aviso}
      </p>
    </section>
  )
}
