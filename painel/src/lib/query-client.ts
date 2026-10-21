import { QueryClient } from '@tanstack/react-query'

// As opções do cliente de consultas do painel, num lugar só: a aplicação (main.tsx) e os testes que dependem do cache (ex.: a guarda da senha
// provisória lendo uma cópia de até 30 s do /auth/me) usam as mesmas.
export function criarQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}
