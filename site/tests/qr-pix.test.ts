// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { CHAVE_PIX_DE_TESTE, gerarPayloadPix } from '../scripts/mock-api.mjs'
import {
  caminhoDoQr,
  desenharQr,
  matrizDoCaminho,
  matrizDoQr,
} from '../src/lib/qr-pix'
import { lerMatriz } from './ajuda-qr'

// v5.6a — o QR Code do Pix é desenhado no navegador a partir do código "copia e cola". O que importa: ele carrega EXATAMENTE o código (um QR de outro texto faria a pessoa
// pagar para o lugar errado). Prova: o desenho é LIDO de volta (com o leitor da própria biblioteca `qr`, só em desenvolvimento) e o texto lido é comparado ao código.

const codigo = (extra: Partial<Parameters<typeof gerarPayloadPix>[0]> = {}) =>
  gerarPayloadPix({
    chave: CHAVE_PIX_DE_TESTE,
    beneficiario: 'ASAF TESTE',
    cidade: 'PARAUAPEBAS',
    txid: 'ASAFDOACAO',
    descricao: 'Doacao ASAF',
    ...extra,
  })

const CODIGOS = [
  codigo(),
  codigo({ valor: 50, txid: 'ASAFCAMP1' }),
  codigo({ valor: 1234.5, txid: 'ASAFDOA-2026-00007' }),
  codigo({ chave: '17631942000170', beneficiario: 'ASAF', cidade: 'BELEM' }),
  codigo({ valor: 0.01 }),
]

describe('matrizDoQr', () => {
  it('é quadrada, com a zona de silêncio de 4 módulos em branco em volta', () => {
    const m = matrizDoQr(CODIGOS[0]!)
    expect(m.length).toBeGreaterThan(40)
    for (const linha of m) expect(linha).toHaveLength(m.length)
    const lado = m.length
    for (let i = 0; i < 4; i++) {
      expect(m[i]!.every((c) => !c)).toBe(true)
      expect(m[lado - 1 - i]!.every((c) => !c)).toBe(true)
      expect(m.every((linha) => !linha[i] && !linha[lado - 1 - i])).toBe(true)
    }
    // o canto do primeiro padrão de localização começa logo depois da zona de silêncio
    expect(m[4]![4]).toBe(true)
  })

  it('é a mesma a cada vez (nada aleatório) e muda quando o texto muda', () => {
    expect(matrizDoQr(CODIGOS[0]!)).toEqual(matrizDoQr(CODIGOS[0]!))
    expect(matrizDoQr(CODIGOS[0]!)).not.toEqual(matrizDoQr(CODIGOS[1]!))
  })
})

describe('o QR Code carrega EXATAMENTE o código do Pix', () => {
  for (const [i, texto] of CODIGOS.entries()) {
    it(`código ${i + 1}: ler o desenho devolve o mesmo texto`, () => {
      expect(lerMatriz(matrizDoQr(texto))).toBe(texto)
    })
  }

  it('um texto levemente diferente dá outro QR, e ler um não devolve o outro', () => {
    const a = CODIGOS[1]!
    const b = a.replace('50.00', '51.00')
    expect(lerMatriz(matrizDoQr(a))).toBe(a)
    expect(lerMatriz(matrizDoQr(b))).toBe(b)
    expect(lerMatriz(matrizDoQr(a))).not.toBe(b)
  })
})

describe('caminhoDoQr e o SVG', () => {
  it('o caminho do desenho reconstrói a matriz inteira (nenhum módulo a mais, nenhum a menos)', () => {
    for (const texto of CODIGOS) {
      const m = matrizDoQr(texto)
      expect(matrizDoCaminho(caminhoDoQr(m), m.length)).toEqual(m)
    }
  })

  it('o SVG tem texto alternativo, proporção quadrada, fundo branco e módulos pretos, e NENHUM atributo style', () => {
    const svg = desenharQr(CODIGOS[0]!, 'QR Code do Pix da ASAF.')
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('QR Code do Pix da ASAF.')
    const m = matrizDoQr(CODIGOS[0]!)
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${m.length} ${m.length}`)
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff')
    expect(svg.querySelector('path')?.getAttribute('fill')).toBe('#000000')
    // a política de conteúdo do site (style-src 'self') bloqueia estilo escrito na página
    for (const elemento of [svg, ...svg.querySelectorAll('*')])
      expect(elemento.hasAttribute('style')).toBe(false)
    expect(svg.innerHTML).not.toMatch(/<style|<script|on[a-z]+=/i)
  })

  it('LER o SVG desenhado (o `d` do path que está no DOM) devolve o código do Pix', () => {
    for (const texto of CODIGOS) {
      const svg = desenharQr(texto, 'QR')
      const lado = Number(svg.getAttribute('viewBox')!.split(' ')[2])
      const d = svg.querySelector('path')!.getAttribute('d')!
      expect(lerMatriz(matrizDoCaminho(d, lado))).toBe(texto)
    }
  })
})
