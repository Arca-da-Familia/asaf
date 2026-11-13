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
// v9.1b: o tema de alto contraste do site vem depois do escuro
const inicioAlto = css.indexOf("[data-contraste='alto'] {")
// v9.5a: o novo visual do painel (só no painel: <html data-superficie="painel">) vem depois do alto contraste
const inicioPainel = css.indexOf("[data-superficie='painel'] {")
const inicioPainelEscuro = css.indexOf("[data-superficie='painel'].dark {")

function lerTokens(bloco: string): Record<string, Hsl> {
  const tokens: Record<string, Hsl> = {}
  for (const m of bloco.matchAll(
    /--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g,
  )) {
    tokens[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return tokens
}

const temas = {
  claro: lerTokens(css.slice(css.indexOf(':root {'), inicioEscuro)),
  escuro: lerTokens(css.slice(inicioEscuro, inicioAlto)),
  alto: lerTokens(css.slice(inicioAlto, inicioPainel)),
  painel: lerTokens(css.slice(inicioPainel, inicioPainelEscuro)),
  'painel escuro': lerTokens(css.slice(inicioPainelEscuro)),
}

// v9.5a: os usos das cores novas do painel (barra verde, tintas das etiquetas) e as bordas dos campos (3:1, componente de interface)
const PARES_DO_PAINEL: Array<[string, string, number]> = [
  ['barra-foreground', 'barra', 4.5],
  ['barra-suave', 'barra', 4.5],
  ['barra-foreground', 'barra-2', 4.5],
  ['barra-suave', 'barra-2', 4.5],
  ['ouro-texto', 'ouro-tinta', 4.5],
  ['ouro-texto', 'card', 4.5],
  ['azul-texto', 'azul-tinta', 4.5],
  ['azul-texto', 'card', 4.5],
  ['verde-texto', 'verde-tinta', 4.5],
  ['verde-texto', 'card', 4.5],
  ['destructive', 'perigo-tinta', 4.5],
  ['foreground', 'ouro-tinta', 4.5],
  ['foreground', 'azul-tinta', 4.5],
  ['foreground', 'verde-tinta', 4.5],
  ['foreground', 'perigo-tinta', 4.5],
  ['muted-foreground', 'accent', 4.5],
  ['input', 'card', 3],
  ['input', 'background', 3],
]

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

// [texto, fundo]: cada par é um uso real do painel/site. Desde a v9.1a `muted-foreground` sobre `muted` também entra (o painel usa em etiquetas).
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
  ['muted-foreground', 'muted'], // v9.1a: etiqueta cinza sobre o cinza-claro (achado do robô no painel)
  ['destructive-foreground', 'destructive'], // botão destrutivo
  ['destructive', 'background'], // mensagem de erro (text-destructive)
  ['destructive', 'card'],
  ['brand-foreground', 'brand'],
  ['brand-secondary-foreground', 'brand-secondary'], // texto sobre o ouro
  ['brand-tertiary-foreground', 'brand-tertiary'], // texto sobre o azul claro
]

describe('contraste dos tokens de design (WCAG AA 4,5:1)', () => {
  it('o leitor de tokens achou os três temas completos', () => {
    expect(inicioAlto).toBeGreaterThan(inicioEscuro)
    expect(inicioPainel).toBeGreaterThan(inicioAlto)
    expect(inicioPainelEscuro).toBeGreaterThan(inicioPainel)
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
          // o alto contraste existe para quem enxerga pouco: exige o nível AAA (7:1), não só o AA
        ).toBeGreaterThanOrEqual(nomeTema === 'alto' ? 7 : 4.5)
      })
    }
  }

  for (const nomeTema of ['painel', 'painel escuro'] as const) {
    for (const [texto, fundo, minimo] of PARES_DO_PAINEL) {
      it(`${nomeTema}: ${texto} sobre ${fundo}`, () => {
        const tokens = temas[nomeTema]
        const c = contraste(tokens[texto]!, tokens[fundo]!)
        expect(
          c,
          `${texto} sobre ${fundo} no tema ${nomeTema}: ${c.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(minimo)
      })
    }
  }
})
