import { describe, expect, it } from 'vitest'

import {
  comFusoDaAsaf,
  formatarDataCurta,
  formatarDia,
  formatarDiaDeInstanteUtc,
  formatarHora,
  formatarInstanteUtc,
  jaAconteceu,
  paraInstante,
} from '../src/lib/datas'

describe('formatarDataCurta (mandato, projeto: data sem hora)', () => {
  it('não perde um dia por causa do fuso (a armadilha do UTC-3)', () => {
    expect(formatarDataCurta('2026-02-10')).toBe('10/02/2026')
    expect(formatarDataCurta('2030-01-01')).toBe('01/01/2030')
  })
  it('aceita data com hora e usa só o dia', () => {
    expect(formatarDataCurta('2026-02-10T00:00:00')).toBe('10/02/2026')
  })
})

describe('formatarInstanteUtc (momento gravado em UTC, ex.: emissão do edital)', () => {
  it('converte UTC para o horário de Parauapebas (UTC-3)', () => {
    expect(formatarInstanteUtc('2026-10-03T14:30:00')).toBe('03/10/2026 11:30')
  })
  it('vira o dia anterior quando passa da meia-noite UTC', () => {
    expect(formatarInstanteUtc('2026-10-03T01:15:00')).toBe('02/10/2026 22:15')
  })
  it('respeita fuso explícito', () => {
    expect(formatarInstanteUtc('2026-10-03T11:30:00-03:00')).toBe(
      '03/10/2026 11:30',
    )
  })
})

describe('formatarDiaDeInstanteUtc (prazo gravado em UTC sem fuso)', () => {
  it('mostra o dia no horário de Parauapebas, por extenso', () => {
    expect(formatarDiaDeInstanteUtc('2026-10-19T14:30:00.123456')).toBe(
      '19 de outubro de 2026',
    )
  })
  it('vira o dia anterior quando passa da meia-noite UTC', () => {
    expect(formatarDiaDeInstanteUtc('2026-10-24T01:00:00')).toBe(
      '23 de outubro de 2026',
    )
  })
  it('respeita fuso explícito', () => {
    expect(formatarDiaDeInstanteUtc('2026-10-24T01:00:00Z')).toBe(
      '23 de outubro de 2026',
    )
    expect(formatarDiaDeInstanteUtc('2026-10-24T01:00:00-03:00')).toBe(
      '24 de outubro de 2026',
    )
  })
})

describe('jaAconteceu', () => {
  const agora = new Date('2026-10-10T22:00:00Z') // 19:00 em Parauapebas
  it('compara no horário LOCAL do evento, não no do navegador', () => {
    expect(jaAconteceu('2026-10-10T18:59:00', agora)).toBe(true)
    expect(jaAconteceu('2026-10-10T19:01:00', agora)).toBe(false)
  })
})

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
