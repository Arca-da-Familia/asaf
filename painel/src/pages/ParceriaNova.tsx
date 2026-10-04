import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { FormularioDaParceria } from '@/components/parcerias/FormularioDaParceria'
import { PageHeader } from '@/components/layout/PageHeader'
import { ApiError } from '@/lib/api'
import { criarParceria, opcoesDeParcerias } from '@/lib/parcerias'

// v5.4a - nova parceria ou emenda. Ao salvar, o sistema cria sozinho o centro de custo exclusivo dela
// (PARC-0001...), onde o livro-caixa vai lançar tudo que entrar e sair.
export function ParceriaNovaPage() {
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
  const { data: opcoes } = useQuery({
    queryKey: ['parcerias-opcoes'],
    queryFn: opcoesDeParcerias,
  })

  const criar = useMutation({
    mutationFn: (dados: Record<string, unknown>) => criarParceria(dados),
    onSuccess: (parceria) => {
      queryClient.invalidateQueries({ queryKey: ['parcerias'] })
      navegar(`/parcerias/${parceria.id_parceria}`)
    },
    onError: (e) =>
      setErro(e instanceof ApiError ? e.detail : 'Não foi possível cadastrar.'),
  })

  return (
    <>
      <PageHeader
        titulo="Nova parceria ou emenda"
        trilha={[
          { rotulo: 'Parcerias e emendas', href: '/parcerias' },
          { rotulo: 'Nova' },
        ]}
      />
      {erro && (
        <p
          role="alert"
          className="mb-4 max-w-3xl rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}
      <FormularioDaParceria
        opcoes={opcoes}
        rotuloDoBotao="Cadastrar parceria"
        enviando={criar.isPending}
        onSalvar={(dados) => {
          setErro(null)
          criar.mutate(dados)
        }}
        onCancelar={() => navegar('/parcerias')}
      />
    </>
  )
}
