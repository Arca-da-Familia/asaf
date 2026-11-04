import { describe, expect, it } from 'vitest'

import {
  arquivosDaEntrada,
  conferir,
  LIMITE_DA_ENTRADA_KB,
  LIMITE_DE_UM_PEDACO_KB,
} from '../../scripts/orcamento-de-tamanho.mjs'

// v9.2a - o orçamento de tamanho (scripts/orcamento-de-tamanho.mjs) que a publicação confere depois do build: prova que ele REPROVA quando a primeira tela ou um
// pedaço passa do limite (o build real é conferido no passo "Orçamento de tamanho" do deploy-painel.yml).
const KB = 1024

describe('orçamento de tamanho do painel (v9.2a)', () => {
  it('lê do index.html o script de entrada, os que ele pede de antemão e o CSS', () => {
    const html = `<script type="module" crossorigin src="/assets/index-A.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/hooks-B.js">
      <link rel="stylesheet" crossorigin href="/assets/index-C.css">
      <link rel="icon" href="/favicon.png">`
    expect(arquivosDaEntrada(html)).toEqual([
      'assets/index-A.js',
      'assets/hooks-B.js',
      'assets/index-C.css',
    ])
  })

  it('dentro do limite passa', () => {
    const entrada = [{ arquivo: 'assets/index.js', bytes: 150 * KB }]
    expect(
      conferir({
        entrada,
        totalDaEntrada: 150 * KB,
        pedacos: [{ arquivo: 'assets/Eventos.js', bytes: 20 * KB }],
      }),
    ).toEqual([])
  })

  it('a primeira tela grande demais reprova', () => {
    const total = (LIMITE_DA_ENTRADA_KB + 30) * KB
    const problemas = conferir({
      entrada: [{ arquivo: 'assets/index.js', bytes: total }],
      totalDaEntrada: total,
      pedacos: [],
    })
    expect(problemas).toHaveLength(1)
    expect(problemas[0]).toContain('a primeira tela baixa')
  })

  it('um pedaço grande demais reprova, mesmo fora da primeira tela', () => {
    const problemas = conferir({
      entrada: [{ arquivo: 'assets/index.js', bytes: 100 * KB }],
      totalDaEntrada: 100 * KB,
      pedacos: [
        {
          arquivo: 'assets/graficos.js',
          bytes: (LIMITE_DE_UM_PEDACO_KB + 1) * KB,
        },
      ],
    })
    expect(problemas).toEqual([expect.stringContaining('assets/graficos.js')])
  })

  it('sem script nenhum no index.html, reprova (o build mudou de formato)', () => {
    expect(conferir({ entrada: [], totalDaEntrada: 0, pedacos: [] })).toEqual([
      expect.stringContaining('não pede nenhum script'),
    ])
  })
})
