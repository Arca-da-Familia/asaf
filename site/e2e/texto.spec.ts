import { expect, test } from '@playwright/test'

import { caminhosIndexaveis } from './paginas'

// Achado da v5.2 (revisão visual): o Astro/Prettier juntava palavras num link quando o texto
// terminava em uma linha e o <a> começava na seguinte ("Acesse aárea do associado"). Nenhum teste
// de acessibilidade ou SEO enxerga isso — por isso este: em TODA página, o texto vizinho de um
// link inline precisa ter espaço ou pontuação na fronteira.
for (const caminho of caminhosIndexaveis()) {
  test(`nenhuma palavra colada em link — ${caminho}`, async ({ page }) => {
    await page.goto(caminho)
    const colados = await page.locator('main a').evaluateAll((links) => {
      const problemas: string[] = []
      for (const a of links) {
        const antes = a.previousSibling
        if (antes?.nodeType === Node.TEXT_NODE) {
          const t = antes.textContent ?? ''
          if (/[\p{L}\p{N}]$/u.test(t))
            problemas.push(
              `antes: "…${t.slice(-20)}" + "${a.textContent?.trim()}"`,
            )
        }
        const depois = a.nextSibling
        if (depois?.nodeType === Node.TEXT_NODE) {
          const t = depois.textContent ?? ''
          if (/^[\p{L}\p{N}]/u.test(t))
            problemas.push(
              `depois: "${a.textContent?.trim()}" + "${t.slice(0, 20)}…"`,
            )
        }
      }
      return problemas
    })
    expect(colados, colados.join('\n')).toEqual([])
  })
}
