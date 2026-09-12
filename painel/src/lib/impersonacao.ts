import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { iniciarImpersonacao, pararImpersonacao } from './api'
import { setAccessToken } from './auth'

// v0.2.9 — troca o access token em memória pelo emitido com o claim de impersonação (ou sem
// ele, ao encerrar) e força o /auth/me a ser buscado de novo — é isso que atualiza o menu, as
// guardas de permissão e o rodapé/banner para refletir o papel impersonado (ou o real, ao sair).
export function useImpersonacao() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const iniciarMutation = useMutation({
    mutationFn: (idNivel: number) => iniciarImpersonacao(idNivel),
    onSuccess: (resultado) => {
      setAccessToken(resultado.access_token)
      queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/')
    },
  })

  const pararMutation = useMutation({
    mutationFn: pararImpersonacao,
    onSuccess: (resultado) => {
      setAccessToken(resultado.access_token)
      queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/')
    },
  })

  function iniciar(idNivel: number, nomeNivel: string) {
    const confirmado = window.confirm(
      `Ver o sistema como "${nomeNivel}"? Você não vai conseguir escrever nada enquanto estiver nesse modo — só olhar o que esse nível enxerga.`,
    )
    if (confirmado) iniciarMutation.mutate(idNivel)
  }

  return {
    iniciar,
    parar: () => pararMutation.mutate(),
    pendente: iniciarMutation.isPending || pararMutation.isPending,
  }
}
