// @vitest-environment jsdom
// v7.1a - o aviso de privacidade vem do catálogo do servidor com os links marcados ([texto](/endereco/)): aqui eles viram link de verdade, sem HTML vindo de fora.
import { describe, expect, it } from 'vitest'

import textos from '../src/data/textos-de-privacidade.json'
import {
  aviso,
  desenharAviso,
  segmentos,
} from '../src/lib/texto-de-privacidade'

describe('segmentos', () => {
  it('separa o texto e os links, na ordem', () => {
    expect(
      segmentos(
        'Leia a [Política de Privacidade](/privacidade/) ou use a [solicitação](/privacidade/solicitacao-do-titular/).',
      ),
    ).toEqual([
      { texto: 'Leia a ' },
      { texto: 'Política de Privacidade', href: '/privacidade/' },
      { texto: ' ou use a ' },
      { texto: 'solicitação', href: '/privacidade/solicitacao-do-titular/' },
      { texto: '.' },
    ])
  })

  it('só endereço do próprio site vira link; o resto fica como texto, inteiro', () => {
    expect(
      segmentos('veja [aqui](https://exemplo.com/) e [ali](//outro.com/)'),
    ).toEqual([
      { texto: 'veja ' },
      { texto: '[aqui](https://exemplo.com/)' },
      { texto: ' e ' },
      { texto: '[ali](//outro.com/)' },
    ])
  })

  it('barra invertida não vira link (o navegador lê "/\\host" como "//host")', () => {
    expect(segmentos('veja [aqui](/\\exemplo.com/)')).toEqual([
      { texto: 'veja ' },
      { texto: '[aqui](/\\exemplo.com/)' },
    ])
  })

  it('texto sem link é um pedaço só', () => {
    expect(segmentos('Sem link nenhum.')).toEqual([
      { texto: 'Sem link nenhum.' },
    ])
  })
})

describe('desenharAviso', () => {
  it('um <p> por parágrafo, o link como <a>, e marcação HTML aparece como texto', () => {
    const caixa = document.createElement('div')
    desenharAviso(
      caixa,
      ['Primeiro <b>parágrafo</b>.', 'Leia a [Política](/privacidade/).'],
      'classe-do-link',
    )
    const ps = caixa.querySelectorAll('p')
    expect(ps).toHaveLength(2)
    expect(ps[0]!.textContent).toBe('Primeiro <b>parágrafo</b>.')
    expect(caixa.querySelector('b')).toBeNull()
    const a = caixa.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/privacidade/')
    expect(a.className).toBe('classe-do-link')
    expect(ps[1]!.textContent).toBe('Leia a Política.')
  })
})

describe('o arquivo gerado do catálogo', () => {
  it('tem cada aviso que os formulários usam, com versão, parágrafos e o texto da caixa', () => {
    for (const ponto of [
      'INSCRICAO_EVENTO',
      'FILIACAO',
      'ATENDIMENTO',
      'ATENDIMENTO_TITULAR',
      'ATENDIMENTO_VOLUNTARIADO',
      'DOACAO',
      'VISITANTE',
    ] as const) {
      const a = aviso(ponto)
      expect(a.versao).toMatch(/^\d+$/)
      expect(a.paragrafos.length).toBeGreaterThan(0)
      expect(a.caixa).not.toBe('')
    }
    expect(Object.keys(textos)).toHaveLength(7)
  })
})
