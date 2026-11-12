import { afterEach, describe, expect, it, vi } from 'vitest'

import { ehCelular, porPaginaNaTela } from '@/lib/celular'

// v9.3z2: as listas paginadas pedem 10 por página no celular (menos de 640 px) e o tamanho de sempre a partir do tablet.
function simularTela(celular: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((consulta: string) => ({
      matches: celular && consulta === '(max-width: 639.98px)',
      media: consulta,
    })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('tamanho da página conforme a tela', () => {
  it('no celular, 10 por página (ou o que a tela pedir)', () => {
    simularTela(true)
    expect(ehCelular()).toBe(true)
    expect(porPaginaNaTela(25)).toBe(10)
    expect(porPaginaNaTela(25, 5)).toBe(5)
  })

  it('a partir do tablet, o tamanho de sempre', () => {
    simularTela(false)
    expect(ehCelular()).toBe(false)
    expect(porPaginaNaTela(25)).toBe(25)
  })

  it('sem matchMedia (navegador antigo, testes), o tamanho de sempre', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(porPaginaNaTela(25)).toBe(25)
  })
})
