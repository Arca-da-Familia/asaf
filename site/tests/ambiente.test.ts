import { describe, expect, it } from 'vitest'

import { ehHomologacao, TEXTO_DO_AMBIENTE_DE_TESTE } from '../src/lib/ambiente'

describe('ambiente de homologação (teste)', () => {
  it('só o valor "homologacao" liga o ambiente de teste: a produção (variável ausente) nunca', () => {
    expect(ehHomologacao('homologacao')).toBe(true)
    for (const outro of [undefined, '', 'producao', 'Homologacao', 'true'])
      expect(ehHomologacao(outro)).toBe(false)
  })

  it('o texto da faixa diz o que é e aponta o site de verdade', () => {
    expect(TEXTO_DO_AMBIENTE_DE_TESTE).toMatch(/AMBIENTE DE TESTE/)
    expect(TEXTO_DO_AMBIENTE_DE_TESTE).toMatch(/dados são inventados/)
    expect(TEXTO_DO_AMBIENTE_DE_TESTE).toMatch(/asaf\.org\.br/)
  })
})
