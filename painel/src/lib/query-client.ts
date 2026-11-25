import { MutationCache, QueryClient } from '@tanstack/react-query'

import { CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO } from './pendencias-do-modulo'

// As opções do cliente de consultas do painel, num lugar só: a aplicação (main.tsx) e os testes que dependem do cache (ex.: a guarda da senha
// provisória lendo uma cópia de até 30 s do /auth/me) usam as mesmas.
export function criarQueryClient(): QueryClient {
  const cliente: QueryClient = new QueryClient({
    // v9.6b (achado da revisão de 23/11/2026): os números de pendência do menu do módulo e os lugares da Visão geral do Financeiro vêm de uma
    // consulta só. Qualquer ação que deu certo, em qualquer tela (aprovar em Compras, decidir um reembolso, conferir o Pix, fechar o mês...),
    // marca essa consulta como velha: se o menu está na tela, ele pede os números de novo; se não está, nada é pedido.
    mutationCache: new MutationCache({
      onSuccess: () => {
        void cliente.invalidateQueries({
          queryKey: CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO,
        })
      },
    }),
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  })
  return cliente
}
