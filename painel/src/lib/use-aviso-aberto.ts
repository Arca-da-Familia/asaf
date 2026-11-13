import { useQuery, useQueryClient } from '@tanstack/react-query'

import { abrirMeuAviso } from '@/lib/comunicacao'

/** Abre o aviso (no servidor, a primeira abertura registra a leitura) e mantém o mural e a caixa de entrada em dia. */
export function useAvisoAberto(idAviso: number) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['meus-avisos', 'um', idAviso],
    queryFn: async () => {
      const aberto = await abrirMeuAviso(idAviso)
      // abrir marcou como lido: o mural e a caixa de entrada precisam ver isso
      queryClient.invalidateQueries({ queryKey: ['meus-avisos', 'mural'] })
      queryClient.invalidateQueries({ queryKey: ['meus-avisos', 'todos'] })
      return aberto
    },
    enabled: Number.isInteger(idAviso) && idAviso > 0,
    retry: false,
  })
}
