import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  agruparBlocos,
  analisarEstatuto,
  carregarEstatuto,
  normalizarTitulo,
  palavras,
  textoCorrido,
} from '../src/lib/estatuto'

const FONTE = readFileSync(
  resolve(process.cwd(), '..', 'ESTATUTO_ASAF.txt'),
  'utf-8',
)

describe('estatuto — estrutura', () => {
  const estatuto = carregarEstatuto()

  it('tem 8 capítulos e os artigos 1 a 35, em ordem', () => {
    expect(estatuto.capitulos).toHaveLength(8)
    const numeros = estatuto.capitulos.flatMap((c) =>
      c.artigos.map((a) => a.numero),
    )
    expect(numeros).toEqual(Array.from({ length: 35 }, (_, i) => i + 1))
  })

  it('títulos de capítulo legíveis (não ficam em CAIXA ALTA)', () => {
    expect(estatuto.capitulos[0]!.titulo).toBe(
      'Do nome, função, sede, fins, compromisso e duração',
    )
    expect(estatuto.capitulos[3]!.titulo).toBe('Dos associados')
    expect(estatuto.capitulos[2]!.titulo).toBe('Da Assembleia Geral')
  })

  it('rótulos na grafia jurídica: Art. 9º, mas Art. 10', () => {
    const rotulos = estatuto.capitulos.flatMap((c) =>
      c.artigos.map((a) => a.rotulo),
    )
    expect(rotulos[0]).toBe('Art. 1º')
    expect(rotulos[8]).toBe('Art. 9º')
    expect(rotulos[9]).toBe('Art. 10')
    expect(rotulos[34]).toBe('Art. 35')
  })

  it('reconhece incisos, parágrafo único e alíneas (Art. 8º)', () => {
    const art8 = estatuto.capitulos
      .flatMap((c) => c.artigos)
      .find((a) => a.numero === 8)!
    const tipos = new Set(art8.blocos.map((b) => b.tipo))
    expect(tipos.has('item')).toBe(true)
    expect(tipos.has('subitem')).toBe(true)
    const alineaD = art8.blocos.find(
      (b) => b.tipo === 'subitem' && b.marcador === 'd',
    )!
    expect(alineaD.texto).toContain('valor das mensalidades')
  })

  it('o Art. 12 traz as 6 exigências de ingresso, em itens', () => {
    const art12 = estatuto.capitulos
      .flatMap((c) => c.artigos)
      .find((a) => a.numero === 12)!
    const itens = art12.blocos.filter((b) => b.tipo === 'item')
    expect(itens.map((i) => i.marcador)).toEqual([
      'I',
      'II',
      'III',
      'IV',
      'V',
      'VI',
    ])
    expect(itens[0]!.texto).toContain('fotos')
    expect(itens[5]!.texto).toContain('03 (três) sócios')
  })

  it('a oração oficial (Art. 33) mantém a quebra de linha dos versos', () => {
    const art33 = estatuto.capitulos
      .flatMap((c) => c.artigos)
      .find((a) => a.numero === 33)!
    const verso = art33.blocos.find((b) => b.tipo === 'verso')!
    expect(verso.texto.split('\n')).toHaveLength(4)
    expect(verso.texto).toContain('O Senhor nos abençoe muitíssimo')
    expect(verso.texto).toContain('Guarda - nos de todo mal')
  })

  it('agrupa incisos consecutivos numa só lista', () => {
    const art19 = estatuto.capitulos
      .flatMap((c) => c.artigos)
      .find((a) => a.numero === 19)!
    const grupos = agruparBlocos(art19.blocos)
    expect(grupos.map((g) => g.tipo)).toEqual(['corpo', 'lista'])
    expect(grupos[1]!.blocos).toHaveLength(7) // os 7 cargos da Diretoria Executiva
  })
})

describe('estatuto — NENHUMA palavra se perde, repete ou troca de ordem', () => {
  it('as palavras da estrutura são exatamente as do arquivo-fonte', () => {
    const estatuto = carregarEstatuto()
    const daFonte = palavras(FONTE)
    const daEstrutura = palavras(textoCorrido(estatuto))
    expect(daEstrutura.length).toBe(daFonte.length)
    // Mensagem útil: aponta a primeira palavra que difere.
    const i = daFonte.findIndex((p, idx) => p !== daEstrutura[idx])
    expect(
      i,
      `primeira diferença na palavra ${i}: "${daFonte[i]}" x "${daEstrutura[i]}"`,
    ).toBe(-1)
  })

  it('funciona igual com quebra de linha CRLF e LF', () => {
    const lf = FONTE.replace(/\r\n/g, '\n')
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(textoCorrido(analisarEstatuto(crlf))).toBe(
      textoCorrido(analisarEstatuto(lf)),
    )
  })
})

describe('estatuto — falha alto se o formato mudar', () => {
  it('recusa um Estatuto com artigo faltando (melhor não publicar truncado)', () => {
    const semArt20 = FONTE.replace(/ART\. 20 - /, 'texto solto - ')
    expect(() => analisarEstatuto(semArt20)).toThrow(/artigos 1 a 35/)
  })
})

describe('normalizarTitulo', () => {
  it.each([
    ['DO NOME, FUNÇÃO, SEDE', 'Do nome, função, sede'],
    ['Dos ASSOCIADOS', 'Dos associados'],
    ['Da Assembleia Geral.', 'Da Assembleia Geral'],
  ])('%s -> %s', (entrada, saida) => {
    expect(normalizarTitulo(entrada)).toBe(saida)
  })
})
