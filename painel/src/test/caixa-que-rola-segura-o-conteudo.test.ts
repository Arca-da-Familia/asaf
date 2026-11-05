import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// v9.3a (achado do robô de usabilidade no celular, e2e-hml/v9.3a-01): na tela Níveis e permissões, o texto escondido para leitor de tela (`sr-only`, que é
// `position: absolute`) dos botões "Ver como" da última coluna ESCAPAVA da caixa que rola de lado (ela não era o "bloco que contém" dele) e esticava a
// página até 3.614 px; no celular a tela inteira passava a rolar de lado e o navegador afastava o zoom. Toda caixa com rolagem (overflow-auto,
// overflow-x-auto, overflow-x-scroll) tem de ser `relative`, para segurar o que estiver posicionado dentro dela.
function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) return arquivos(caminho)
    return /\.tsx$/.test(nome) && !/\.test\.tsx$/.test(nome) ? [caminho] : []
  })
}

describe('caixa que rola segura o conteúdo posicionado dentro dela', () => {
  it('toda classe com overflow-auto / overflow-x-auto / overflow-x-scroll também tem relative', () => {
    const faltando: string[] = []
    for (const arquivo of arquivos(join(__dirname, '..'))) {
      readFileSync(arquivo, 'utf-8')
        .split('\n')
        .forEach((linha, i) => {
          if (
            /\boverflow-(auto|x-auto|x-scroll)\b/.test(linha) &&
            !/\brelative\b/.test(linha)
          )
            faltando.push(`${arquivo}:${i + 1}`)
        })
    }
    expect(faltando).toEqual([])
  })
})
