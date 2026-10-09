import { describe, expect, it } from 'vitest'

import type { MembroDaDiretoria } from '../scripts/lib/conteudo-publico.mjs'
import {
  CARGOS_DA_DIRETORIA,
  MEMBROS_DO_CONSELHO,
  montarComposicao,
  presidenteDaDiretoria,
} from '../src/lib/diretoria'

const membro = (
  orgao_codigo: string,
  cargo_codigo: string,
  nome: string,
): MembroDaDiretoria => ({
  orgao_codigo,
  orgao: orgao_codigo,
  cargo_codigo,
  cargo: cargo_codigo,
  nome,
  data_inicio: '2026-02-10',
  data_fim_previsto: '2030-02-10',
})

describe('montarComposicao', () => {
  it('sem nenhum ocupante, mostra os 7 cargos do Art. 19 e os 3 lugares do Conselho, todos sem ocupante', () => {
    const c = montarComposicao([])
    expect(c.temOcupantes).toBe(false)
    expect(c.diretoria.map((x) => x.assento.rotulo)).toEqual([
      'Presidente',
      '1º Vice-Presidente',
      '2º Vice-Presidente',
      '1º Secretário',
      '2º Secretário',
      '1º Tesoureiro',
      '2º Tesoureiro',
    ])
    expect(c.diretoria.every((x) => x.ocupantes.length === 0)).toBe(true)
    expect(c.conselho).toHaveLength(MEMBROS_DO_CONSELHO)
    expect(c.lugaresDoConselhoSemOcupante).toBe(3)
    expect(c.outros).toEqual([])
  })

  it('o ocupante vai para o cargo certo pelo CÓDIGO, e o resto continua sem ocupante', () => {
    const maria = membro('DIRETORIA_EXECUTIVA', 'PRESIDENTE', 'Maria')
    const joao = membro('DIRETORIA_EXECUTIVA', 'SECRETARIO', 'João')
    const c = montarComposicao([maria, joao])
    expect(c.temOcupantes).toBe(true)
    expect(c.diretoria[0]!.ocupantes).toEqual([maria])
    expect(c.diretoria[3]!.ocupantes).toEqual([joao])
    expect(c.diretoria.filter((x) => x.ocupantes.length === 0)).toHaveLength(5)
  })

  it('o mesmo código em outro órgão não vai para a Diretoria (cargo + órgão)', () => {
    const intruso = membro('CONSELHO_FISCAL', 'PRESIDENTE', 'Fulano')
    const c = montarComposicao([intruso])
    expect(c.diretoria[0]!.ocupantes).toEqual([])
    expect(c.outros).toEqual([intruso])
  })

  it('conselheiros: um cartão por pessoa e os lugares que faltam para os três', () => {
    const a = membro('CONSELHO_FISCAL', 'CONSELHO_FISCAL', 'Ana')
    const b = membro('CONSELHO_FISCAL', 'CONSELHO_FISCAL', 'Bia')
    const c = montarComposicao([a, b])
    expect(c.conselho.map((x) => x.ocupantes.length)).toEqual([1, 1, 0])
    expect(c.lugaresDoConselhoSemOcupante).toBe(1)
  })

  it('mais de três conselheiros: nenhum some, e não sobra lugar vazio', () => {
    const quatro = ['A', 'B', 'C', 'D'].map((n) =>
      membro('CONSELHO_FISCAL', 'CONSELHO_FISCAL', n),
    )
    const c = montarComposicao(quatro)
    expect(c.conselho).toHaveLength(4)
    expect(c.lugaresDoConselhoSemOcupante).toBe(0)
  })

  it('cargo fora do Estatuto (ou código antigo) não some: vai para "outros"', () => {
    const antigo = membro('DIRETORIA_EXECUTIVA', 'DIRETOR_SOCIAL', 'Beto')
    const c = montarComposicao([antigo])
    expect(c.outros).toEqual([antigo])
    expect(c.temOcupantes).toBe(true)
  })

  it('dois ocupantes no mesmo cargo aparecem os dois (o sistema não esconde a inconsistência)', () => {
    const x = membro('DIRETORIA_EXECUTIVA', 'PRESIDENTE', 'X')
    const y = membro('DIRETORIA_EXECUTIVA', 'PRESIDENTE', 'Y')
    expect(montarComposicao([x, y]).diretoria[0]!.ocupantes).toEqual([x, y])
  })

  it('os cargos citam o artigo do Estatuto', () => {
    expect(
      CARGOS_DA_DIRETORIA.every((c) => c.artigo.startsWith('Art. 19')),
    ).toBe(true)
  })
})

describe('presidenteDaDiretoria (o encarregado de dados da Política de Privacidade)', () => {
  it('sem mandato registrado não há nome (a Política manda olhar a página Diretoria)', () => {
    expect(presidenteDaDiretoria([])).toBeNull()
  })

  it('é o ocupante do cargo PRESIDENTE da Diretoria Executiva, e só ele', () => {
    const lista = [
      membro('DIRETORIA_EXECUTIVA', 'VICE_PRESIDENTE', 'Vice'),
      membro('CONSELHO_FISCAL', 'PRESIDENTE', 'Presidente de outro órgão'),
      membro('DIRETORIA_EXECUTIVA', 'PRESIDENTE', 'Fulano de Tal'),
    ]
    expect(presidenteDaDiretoria(lista)).toBe('Fulano de Tal')
  })

  it('nome em branco não conta', () => {
    expect(
      presidenteDaDiretoria([
        membro('DIRETORIA_EXECUTIVA', 'PRESIDENTE', '  '),
      ]),
    ).toBeNull()
  })
})
