import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usePaginaLocal } from '@/lib/pagina-local'

// v9.3b: as listas compridas que chegam inteiras à tela passam a ser mostradas em páginas.
const itens = Array.from({ length: 23 }, (_, i) => i + 1)

describe('páginas de uma lista que chegou inteira', () => {
  it('mostra só os da página e conta o total', () => {
    const { result } = renderHook(() => usePaginaLocal(itens, 10))
    expect(result.current.daPagina).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result.current.total).toBe(23)
    act(() => result.current.setPagina(3))
    expect(result.current.daPagina).toEqual([21, 22, 23])
  })

  it('a lista encolheu (filtro): a página que deixou de existir vira a última que existe', () => {
    const { result, rerender } = renderHook(
      ({ lista }) => usePaginaLocal(lista, 10),
      { initialProps: { lista: itens } },
    )
    act(() => result.current.setPagina(3))
    rerender({ lista: itens.slice(0, 12) })
    expect(result.current.pagina).toBe(2)
    expect(result.current.daPagina).toEqual([11, 12])
  })

  it('o filtro mudou: volta para a primeira página', () => {
    const { result, rerender } = renderHook(
      ({ filtro }) => usePaginaLocal(itens, 10, filtro),
      { initialProps: { filtro: 'Todas' } },
    )
    act(() => result.current.setPagina(2))
    expect(result.current.pagina).toBe(2)
    rerender({ filtro: 'Pendente' })
    expect(result.current.pagina).toBe(1)
  })

  it('sem lista ainda (carregando): nada na página e total zero', () => {
    const { result } = renderHook(() => usePaginaLocal<number>(undefined, 10))
    expect(result.current.daPagina).toEqual([])
    expect(result.current.total).toBe(0)
  })
})
