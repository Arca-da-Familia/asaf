import { describe, expect, it } from 'vitest'

import {
  comFusoDaAsaf,
  formatarDataCurta,
  formatarDia,
  formatarDiaDeInstanteUtc,
  formatarDiaEHora,
  formatarHora,
  formatarInstanteUtc,
  jaAconteceu,
  paraInstante,
  quandoEmPartes,
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
  it('compara instantes: a data da API sem fuso é UTC, não o horário do navegador', () => {
    expect(jaAconteceu('2026-10-10T21:59:00', agora)).toBe(true)
    expect(jaAconteceu('2026-10-10T22:01:00', agora)).toBe(false)
  })
})

describe('comFusoDaAsaf (ISO com o fuso de Parauapebas: <time datetime> e dado estruturado)', () => {
  it('a data da API é UTC: 22:00 UTC vira 19:00 com -03:00, o mesmo instante', () => {
    expect(comFusoDaAsaf('2026-10-10T22:00:00')).toBe(
      '2026-10-10T19:00:00-03:00',
    )
    expect(new Date(comFusoDaAsaf('2026-10-10T22:00:00')).toISOString()).toBe(
      '2026-10-10T22:00:00.000Z',
    )
  })

  it('passa da meia-noite UTC para o dia anterior em Belém', () => {
    expect(comFusoDaAsaf('2026-10-11T01:30:00')).toBe(
      '2026-10-10T22:30:00-03:00',
    )
  })

  it('aceita fração de segundo e mantém os segundos', () => {
    expect(comFusoDaAsaf('2026-10-10T22:00:05.123456')).toBe(
      '2026-10-10T19:00:05-03:00',
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
  it('a data da API sem fuso é UTC: 22h UTC são 19h em Parauapebas — independe do fuso de quem vê', () => {
    expect(paraInstante('2026-10-10T22:00:00').toISOString()).toBe(
      '2026-10-10T22:00:00.000Z',
    )
  })
  it('data com fuso explícito mantém o instante', () => {
    expect(paraInstante('2026-10-10T19:00:00-03:00').toISOString()).toBe(
      '2026-10-10T22:00:00.000Z',
    )
  })
})

describe('formatação sempre no fuso da ASAF', () => {
  it('mostra o horário de Belém, não o do navegador nem o UTC', () => {
    // a diretoria digita 19:00 em Belém, o painel manda 22:00Z e o site tem de mostrar 19:00 (o defeito da v5.5d: mostrava 22:00)
    expect(formatarHora('2026-10-10T22:00:00')).toBe('19:00')
    expect(formatarHora('2026-10-10T22:00:00Z')).toBe('19:00')
  })

  it('escreve o dia por extenso em português', () => {
    const dia = formatarDia('2026-10-10T22:00:00')
    expect(dia).toContain('sábado')
    expect(dia).toContain('10 de outubro de 2026')
  })

  it('evento às 23h30 em Belém (02:30 UTC do dia seguinte) não vira o dia seguinte', () => {
    expect(formatarDia('2026-10-11T02:30:00')).toContain('10 de outubro')
    expect(formatarHora('2026-10-11T02:30:00')).toBe('23:30')
  })
})

describe('formatarDiaEHora e quandoEmPartes (o "Quando" do evento, no build e ao vivo)', () => {
  it('o dia e a hora no horário de Parauapebas, numa frase só', () => {
    expect(formatarDiaEHora('2026-10-10T22:00:00')).toBe(
      'sábado, 10 de outubro de 2026, às 19:00',
    )
    expect(formatarDiaEHora('2026-10-10T22:00:00Z')).toBe(
      'sábado, 10 de outubro de 2026, às 19:00',
    )
  })

  it('evento de um dia só: o fim é só a hora; sem fim, não há "até"', () => {
    expect(
      quandoEmPartes('2026-10-10T22:00:00', '2026-10-11T00:30:00'),
    ).toEqual({
      inicio: {
        texto: 'sábado, 10 de outubro de 2026, às 19:00',
        iso: '2026-10-10T19:00:00-03:00',
      },
      fim: { texto: '21:30', iso: '2026-10-10T21:30:00-03:00' },
    })
    expect(quandoEmPartes('2026-10-10T22:00:00', null).fim).toBeNull()
  })

  it('evento que termina em outro dia: o fim leva o dia e a hora', () => {
    expect(
      quandoEmPartes('2026-10-10T22:00:00', '2026-10-11T13:00:00').fim,
    ).toEqual({
      texto: 'domingo, 11 de outubro de 2026, 10:00',
      iso: '2026-10-11T10:00:00-03:00',
    })
  })
})
