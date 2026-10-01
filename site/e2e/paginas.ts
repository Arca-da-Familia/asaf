import { readFileSync } from 'node:fs'

/**
 * Caminhos de TODAS as páginas indexáveis do site, lidos do sitemap gerado no build.
 *
 * É assim de propósito: toda página nova (Quem Somos, Notícias, cada evento...) entra
 * automaticamente na auditoria de acessibilidade e SEO, sem ninguém lembrar de adicionar numa
 * lista. Lista manual envelhece; o sitemap é gerado a partir das páginas que existem.
 */
export function caminhosIndexaveis(): string[] {
  let xml: string
  try {
    xml = readFileSync('dist/sitemap-0.xml', 'utf-8')
  } catch {
    throw new Error(
      'dist/sitemap-0.xml não existe. Rode `npm run build:teste` antes do e2e.',
    )
  }
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
  return urls.map((url) => new URL(url).pathname)
}

/** Páginas que NÃO entram no sitemap mas precisam passar na acessibilidade. */
export const PAGINAS_NAO_INDEXAVEIS = ['/404.html']

/** Dimensões (largura, altura) lidas do cabeçalho de um PNG. */
export function dimensoesPng(bytes: Buffer): {
  largura: number
  altura: number
} {
  return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20) }
}
