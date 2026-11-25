// v9.6b (achados da revisão de 23/11/2026): os números de pendência do menu do Financeiro
// 1. voltam a ser pedidos depois de QUALQUER ação que deu certo, em qualquer tela (aprovar em Compras, decidir um reembolso, conferir o Pix...);
// 2. nunca são pedidos por quem só audita (o servidor recusaria com 403).
import { QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { modulos } from '@/lib/modulos'
import {
  CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO,
  usePendenciasDoModulo,
} from '@/lib/pendencias-do-modulo'
import { criarQueryClient } from '@/lib/query-client'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  obterPendenciasDoFinanceiro: vi.fn(),
}))

const financeiro = modulos.find((m) => m.rota === '/financeiro')

afterEach(() => vi.clearAllMocks())

describe('números de pendência do menu do Financeiro', () => {
  it('depois de uma ação que deu certo, em qualquer tela, os números são pedidos de novo', async () => {
    const cliente = criarQueryClient()
    const buscar = vi.fn().mockResolvedValue({ contadores: {} })
    const observador = new QueryObserver(cliente, {
      queryKey: CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO,
      queryFn: buscar,
    })
    const parar = observador.subscribe(() => {})
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1))

    // uma ação de outra tela (por exemplo, aprovar em Compras), que não sabe nada do menu
    await cliente
      .getMutationCache()
      .build(cliente, { mutationFn: async () => 'aprovada' })
      .execute(undefined)
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2))
    parar()
  })

  it('uma ação que deu errado não pede os números de novo', async () => {
    const cliente = criarQueryClient()
    const buscar = vi.fn().mockResolvedValue({ contadores: {} })
    const observador = new QueryObserver(cliente, {
      queryKey: CHAVE_DAS_PENDENCIAS_DO_FINANCEIRO,
      queryFn: buscar,
    })
    const parar = observador.subscribe(() => {})
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1))

    await expect(
      cliente
        .getMutationCache()
        .build(cliente, {
          mutationFn: async () => {
            throw new Error('recusada')
          },
        })
        .execute(undefined),
    ).rejects.toThrow('recusada')
    await new Promise((r) => setTimeout(r, 50))
    expect(buscar).toHaveBeenCalledTimes(1)
    parar()
  })

  function envolver(cliente = criarQueryClient()) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
    )
  }

  it('quem só audita (financeiro_auditar) nunca chama a rota das pendências', async () => {
    const { result } = renderHook(
      () => usePendenciasDoModulo(financeiro, ['financeiro_auditar']),
      { wrapper: envolver() },
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(api.obterPendenciasDoFinanceiro).not.toHaveBeenCalled()
    expect(result.current).toEqual({})
  })

  it('quem opera (financeiro) recebe os números', async () => {
    vi.mocked(api.obterPendenciasDoFinanceiro).mockResolvedValue({
      contadores: { compras: 2 },
    } as unknown as Awaited<ReturnType<typeof api.obterPendenciasDoFinanceiro>>)
    const { result } = renderHook(
      () => usePendenciasDoModulo(financeiro, ['financeiro']),
      { wrapper: envolver() },
    )
    await waitFor(() => expect(result.current).toEqual({ compras: 2 }))
    expect(api.obterPendenciasDoFinanceiro).toHaveBeenCalledTimes(1)
  })
})
