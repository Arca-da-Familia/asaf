import { describe, expect, it } from 'vitest'

import {
  comFusoDaAsaf,
  formatarDia,
  formatarHora,
  paraInstante,
} from '../src/lib/datas'

describe('comFusoDaAsaf', () => {
  it('acrescenta -03:00 a data sem fuso (horário local do evento)', () => {
    expect(comFusoDaAsaf('2026-10-10T19:00:00')).toBe(
      '2026-10-10T19:00:00-03:00',
    )
  })

  it('não mexe em data que já traz fuso', () => {
    expect(comFusoDaAsaf('2026-10-10T22:00:00Z')).toBe('2026-10-10T22:00:00Z')
    expect(comFusoDaAsaf('2026-10-10T19:00:00-03:00')).toBe(
      '2026-10-10T19:00:00-03:00',
    )
    expect(comFusoDaAsaf('2026-10-10T19:00:00+02:00')).toBe(
      '2026-10-10T19:00:00+02:00',
    )
  })
})

describe('paraInstante', () => {
  it('19h em Parauapebas são 22h UTC — independe do fuso de quem vê', () => {
    expect(paraInstante('2026-10-10T19:00:00').toISOString()).toBe(
      '2026-10-10T22:00:00.000Z',
    )
  })
})

describe('formatação sempre no fuso da ASAF', () => {
  it('mostra o horário local do evento, não o do navegador', () => {
    expect(formatarHora('2026-10-10T19:00:00')).toBe('19:00')
    // 22h UTC = 19h em Belém, onde quer que o visitante esteja.
    expect(formatarHora('2026-10-10T22:00:00Z')).toBe('19:00')
  })

  it('escreve o dia por extenso em português', () => {
    const dia = formatarDia('2026-10-10T19:00:00')
    expect(dia).toContain('sábado')
    expect(dia).toContain('10 de outubro de 2026')
  })

  it('evento às 23h não vira o dia seguinte', () => {
    expect(formatarDia('2026-10-10T23:30:00')).toContain('10 de outubro')
  })
})
