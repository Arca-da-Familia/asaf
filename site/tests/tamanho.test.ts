import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  LIMITE_FREE,
  avaliar,
  medirPasta,
} from '../scripts/verificar-tamanho.mjs'

const MB = 1024 * 1024
const medida = (megabytes: number, arquivos = 10, maiorMb = 1) => ({
  bytes: megabytes * MB,
  arquivos,
  maior: { caminho: 'dist/x.pdf', bytes: maiorMb * MB },
})

describe('avaliar - limite do plano Free (250 MB, 15.000 arquivos)', () => {
  it('abaixo de 60% está tudo bem', () => {
    expect(avaliar(medida(100)).nivel).toBe('ok')
    expect(avaliar(medida(100)).mensagens).toEqual([])
  })
  it('de 60% a 85% avisa (publica, mas diz quanto falta)', () => {
    const r = avaliar(medida(160)) // 64%
    expect(r.nivel).toBe('aviso')
    expect(r.mensagens[0]).toMatch(/160\.0 de 250 MB \(64%\)/)
  })
  it('a partir de 85% PARA a publicação, antes de o Azure recusar', () => {
    const r = avaliar(medida(215)) // 86%
    expect(r.nivel).toBe('erro')
    expect(r.mensagens[0]).toMatch(/PAROU de propósito/)
  })
  it('conta arquivos também: 13.000 de 15.000 é erro mesmo com pouco MB', () => {
    expect(avaliar(medida(5, 13_000)).nivel).toBe('erro')
    expect(avaliar(medida(5, 9_500)).nivel).toBe('aviso')
  })
  it('arquivo acima de 30 MB é erro (limite de requisição)', () => {
    const r = avaliar(medida(40, 10, 31))
    expect(r.nivel).toBe('erro')
    expect(r.mensagens.join(' ')).toMatch(/31\.0 MB/)
  })
  it('o limite é o do plano Free documentado pela Microsoft', () => {
    expect(LIMITE_FREE).toEqual({ megabytes: 250, arquivos: 15_000 })
  })
})

describe('medirPasta', () => {
  const pastas: string[] = []
  afterEach(() => {
    for (const p of pastas.splice(0))
      rmSync(p, { recursive: true, force: true })
  })

  it('soma tudo, conta os arquivos de todas as subpastas e acha o maior', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'tamanho-'))
    pastas.push(raiz)
    mkdirSync(join(raiz, 'a', 'b'), { recursive: true })
    writeFileSync(join(raiz, 'um.txt'), Buffer.alloc(100))
    writeFileSync(join(raiz, 'a', 'dois.txt'), Buffer.alloc(300))
    writeFileSync(join(raiz, 'a', 'b', 'tres.txt'), Buffer.alloc(50))
    const m = medirPasta(raiz)
    expect(m.bytes).toBe(450)
    expect(m.arquivos).toBe(3)
    expect(m.maior.bytes).toBe(300)
    expect(m.maior.caminho?.endsWith('dois.txt')).toBe(true)
  })

  it('pasta vazia: zero', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'tamanho-'))
    pastas.push(raiz)
    expect(medirPasta(raiz)).toEqual({
      bytes: 0,
      arquivos: 0,
      maior: { caminho: null, bytes: 0 },
    })
  })
})
