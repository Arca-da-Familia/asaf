import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Guarda do contraste (WCAG AA, 4,5:1 para texto) da identidade visual — lê a FONTE ÚNICA
// (`design/tokens.css`), a mesma que o site e o painel consomem, e calcula cada par texto/fundo
// nos dois temas. Existe porque o axe do painel roda em jsdom, que NÃO calcula contraste: o
// botão destrutivo (3,6:1) passou despercebido desde o começo (achado do agente do Lote 2,
// 2026-10-01). Trocou uma cor em tokens.css para um par que não passa = este teste reprova.

type Hsl = [number, number, number]

// O Vitest roda com a pasta do projeto (painel/) como diretório atual; `design/` fica ao lado.
const css = readFileSync(
  path.resolve(process.cwd(), '../design/tokens.css'),
  'utf-8',
)
const inicioEscuro = css.indexOf('.dark {')

function lerTokens(bloco: string): Record<string, Hsl> {
  const tokens: Record<string, Hsl> = {}
  for (const m of bloco.matchAll(
    /--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g,
  )) {
    tokens[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return tokens
}

const temas = {
  claro: lerTokens(css.slice(css.indexOf(':root {'), inicioEscuro)),
  escuro: lerTokens(css.slice(inicioEscuro)),
}

function rgb([h, s, l]: Hsl): [number, number, number] {
  const sat = s / 100
  const luz = l / 100
  const a = sat * Math.min(luz, 1 - luz)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return luz - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
  }
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

function luminancia(cor: Hsl): number {
  const [r, g, b] = rgb(cor).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: Hsl, b: Hsl): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro! + 0.05) / (escuro! + 0.05)
}

// [texto, fundo]: cada par é um uso real do painel/site. `muted-foreground` sobre `muted` NÃO
// entra (já documentado em design/README.md como proibido para texto pequeno).
const PARES: Array<[string, string]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'], // botão e hero
  ['primary', 'background'], // link / texto verde
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['muted-foreground', 'background'], // texto auxiliar
  ['muted-foreground', 'card'],
  ['destructive-foreground', 'destructive'], // botão destrutivo
  ['destructive', 'background'], // mensagem de erro (text-destructive)
  ['destructive', 'card'],
  ['brand-foreground', 'brand'],
  ['brand-secondary-foreground', 'brand-secondary'], // texto sobre o ouro
  ['brand-tertiary-foreground', 'brand-tertiary'], // texto sobre o azul claro
]

describe('contraste dos tokens de design (WCAG AA 4,5:1)', () => {
  it('o leitor de tokens achou os dois temas completos', () => {
    for (const tema of Object.values(temas)) {
      expect(Object.keys(tema).length).toBeGreaterThanOrEqual(25)
      expect(tema.primary).toBeDefined()
      expect(tema.destructive).toBeDefined()
    }
  })

  it('o calculador confere com valores conhecidos (teste do teste)', () => {
    // Preto sobre branco = 21:1; o verde da marca sobre branco foi medido em 9,16:1.
    expect(contraste([0, 0, 0], [0, 0, 100])).toBeCloseTo(21, 0)
    expect(contraste([154.8, 60.8, 20], [0, 0, 100])).toBeCloseTo(9.16, 1)
  })

  for (const [nomeTema, tokens] of Object.entries(temas)) {
    for (const [texto, fundo] of PARES) {
      it(`${nomeTema}: ${texto} sobre ${fundo}`, () => {
        const c = contraste(tokens[texto]!, tokens[fundo]!)
        expect(
          c,
          `${texto} sobre ${fundo} no tema ${nomeTema}: ${c.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
