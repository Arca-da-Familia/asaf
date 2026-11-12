import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// v9.4 - o painel instalável na tela inicial do celular: o manifesto tem o que os navegadores pedem (nome, endereço inicial, abrir como aplicativo,
// ícones de 192 e 512 px), os ícones existem com o tamanho declarado, a página aponta para o manifesto e o Static Web App o entrega com o tipo certo
// e sem guardar versão velha. Nada fica guardado no aparelho (não há service worker).
const raiz = process.cwd()
const ler = (arquivo: string) => readFileSync(path.resolve(raiz, arquivo))

const manifesto = JSON.parse(ler('public/manifest.webmanifest').toString()) as {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  icons: Array<{ src: string; sizes: string; type: string }>
}

/** largura e altura de um PNG (no cabeçalho IHDR, bytes 16 a 23) */
function tamanhoDoPng(arquivo: string): string {
  const b = ler(arquivo)
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
}

describe('painel instalável (v9.4)', () => {
  it('o manifesto tem nome, endereço inicial, modo aplicativo e a cor da associação', () => {
    expect(manifesto.name).toBe('ASAF · Painel')
    expect(manifesto.short_name.length).toBeLessThanOrEqual(12)
    expect(manifesto.start_url).toBe('/')
    expect(manifesto.scope).toBe('/')
    expect(manifesto.display).toBe('standalone')
    expect(manifesto.theme_color).toBe('#145238')
  })

  it('os ícones de 192 e 512 px existem com o tamanho declarado', () => {
    const tamanhos = manifesto.icons.map((i) => i.sizes)
    expect(tamanhos).toEqual(expect.arrayContaining(['192x192', '512x512']))
    for (const icone of manifesto.icons) {
      expect(icone.type).toBe('image/png')
      expect(tamanhoDoPng(`public${icone.src}`)).toBe(icone.sizes)
    }
  })

  it('a página aponta para o manifesto, com a mesma cor de tema', () => {
    const html = ler('index.html').toString()
    expect(html).toContain(
      '<link rel="manifest" href="/manifest.webmanifest" />',
    )
    expect(html).toContain('<meta name="theme-color" content="#145238" />')
  })

  it('o Static Web App entrega o manifesto com o tipo certo, sem guardar versão velha e sem trocá-lo pela página', () => {
    const config = JSON.parse(
      ler('public/staticwebapp.config.json').toString(),
    ) as {
      mimeTypes: Record<string, string>
      navigationFallback: { exclude: string[] }
      routes: Array<{ route: string; headers: Record<string, string> }>
    }
    expect(config.mimeTypes['.webmanifest']).toBe('application/manifest+json')
    expect(config.navigationFallback.exclude).toContain('/manifest.webmanifest')
    expect(
      config.routes.find((r) => r.route === '/manifest.webmanifest')?.headers[
        'cache-control'
      ],
    ).toBe('no-cache')
  })
})
