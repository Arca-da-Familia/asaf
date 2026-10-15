import { describe, expect, it } from 'vitest'

import type { MembroDaDiretoria } from '../scripts/lib/conteudo-publico.mjs'
import {
  CARGOS_DA_DIRETORIA,
  CARGO_EM_DESTAQUE,
  MEMBROS_DO_CONSELHO,
  iniciaisDoNome,
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
  foto: null,
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

describe('o Presidente em destaque e a ordem dos cargos (v5.7c)', () => {
  it('o Presidente é o primeiro cargo da Diretoria e o ÚNICO em destaque; Conselho e vagas nunca', () => {
    const c = montarComposicao([
      membro('DIRETORIA_EXECUTIVA', 'SECRETARIO', 'João'),
      membro('CONSELHO_FISCAL', 'CONSELHO_FISCAL', 'Ana'),
      membro('DIRETORIA_EXECUTIVA', 'PRESIDENTE', 'Maria'),
    ])
    expect(CARGOS_DA_DIRETORIA[0]!.codigo).toBe(CARGO_EM_DESTAQUE)
    expect(c.diretoria[0]!.assento.codigo).toBe('PRESIDENTE')
    expect(c.diretoria.map((x) => x.destaque)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(c.conselho.every((x) => !x.destaque)).toBe(true)
  })

  it('a ordem não depende da ordem em que a API lista as pessoas: o Presidente continua primeiro', () => {
    const maria = membro('DIRETORIA_EXECUTIVA', 'PRESIDENTE', 'Maria')
    const joao = membro('DIRETORIA_EXECUTIVA', 'SECRETARIO', 'João')
    for (const lista of [
      [maria, joao],
      [joao, maria],
    ]) {
      const c = montarComposicao(lista)
      expect(c.diretoria[0]!.ocupantes).toEqual([maria])
      expect(c.diretoria[3]!.ocupantes).toEqual([joao])
    }
  })

  it('o membro chega ao cartão com a foto que a API trouxe (ou sem ela)', () => {
    const foto = {
      id_foto: 21,
      alt: 'Foto de Maria, Presidente',
      sha256: 'a'.repeat(64),
      largura: 300,
      altura: 400,
      arquivo: '/api/publico/diretoria/fotos/21',
    }
    const maria = {
      ...membro('DIRETORIA_EXECUTIVA', 'PRESIDENTE', 'Maria'),
      foto,
    }
    const joao = membro('DIRETORIA_EXECUTIVA', 'SECRETARIO', 'João')
    const c = montarComposicao([maria, joao])
    expect(c.diretoria[0]!.ocupantes[0]!.foto).toEqual(foto)
    expect(c.diretoria[3]!.ocupantes[0]!.foto).toBeNull()
  })
})

describe('iniciaisDoNome (o círculo de quem não tem foto)', () => {
  it('a primeira letra do primeiro nome e a do último sobrenome', () => {
    expect(iniciaisDoNome('João de Teste Souza')).toBe('JS')
    expect(iniciaisDoNome('Ana Lima')).toBe('AL')
    expect(iniciaisDoNome('Maria Aparecida Costa e Silva')).toBe('MS')
  })

  it('ignora as palavras de ligação (de, da, do, das, dos, e), em qualquer caixa', () => {
    expect(iniciaisDoNome('Maria de Teste da Silva')).toBe('MS')
    expect(iniciaisDoNome('José dos Santos')).toBe('JS')
    expect(iniciaisDoNome('Luiz DAS Neves')).toBe('LN')
    expect(iniciaisDoNome('Pedro do Carmo e Souza')).toBe('PS')
    // a palavra de ligação na ponta (nome cortado ou sobrenome só de ligação) nunca vira inicial
    expect(iniciaisDoNome('Maria da')).toBe('M')
    expect(iniciaisDoNome('de Souza')).toBe('S')
  })

  it('um nome só vale uma letra', () => {
    expect(iniciaisDoNome('Madonna')).toBe('M')
    expect(iniciaisDoNome('  Madonna  ')).toBe('M')
  })

  it('sai em maiúscula e mantém o acento', () => {
    expect(iniciaisDoNome('ágata álvares')).toBe('ÁÁ')
    expect(iniciaisDoNome('élio ônix')).toBe('ÉÔ')
  })

  it('espaços a mais e palavra sem letra não atrapalham', () => {
    expect(iniciaisDoNome('  Maria    de   Teste  Silva ')).toBe('MS')
    expect(iniciaisDoNome('Maria 2º Silva')).toBe('MS')
    expect(iniciaisDoNome('Maria - Silva')).toBe('MS')
  })

  it('nome vazio, em branco ou só de palavras de ligação devolve texto vazio (o círculo fica sem letra, sem quebrar)', () => {
    expect(iniciaisDoNome('')).toBe('')
    expect(iniciaisDoNome('   ')).toBe('')
    expect(iniciaisDoNome('de da do')).toBe('')
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
