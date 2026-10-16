import { encodeQR } from 'qr'

/**
 * O QR Code do Pix, desenhado NO NAVEGADOR a partir do código "copia e cola" (v5.6a): nenhuma imagem pedida a ninguém, nenhum serviço de terceiro.
 *
 * A biblioteca `qr` (Paul Miller, sem dependências, com tipos) só calcula a matriz de módulos; o desenho é feito aqui, com as APIs do DOM (`createElementNS`), em vez de
 * `innerHTML`: a política de conteúdo do site (`style-src 'self'`, sem script nem estilo dentro da página) bloqueia o atributo `style`, e este SVG só usa atributos de
 * apresentação (`fill`, `viewBox`...), que ela deixa passar. Preto sobre branco fixos, sem depender do tema claro/escuro: leitor de QR não lê QR "invertido".
 *
 * Correção de erro "medium" (15%), a do uso comum do Pix, e zona de silêncio de 4 módulos (o mínimo da norma ISO/IEC 18004).
 */

const ESPACO_DE_SILENCIO = 4
const NIVEL_DE_CORRECAO = 'medium'
const NS_DO_SVG = 'http://www.w3.org/2000/svg'

/** A matriz de módulos (`true` = escuro), JÁ com a zona de silêncio em volta: é o que o desenho usa e o que o teste decodifica. */
export function matrizDoQr(texto: string): boolean[][] {
  return encodeQR(texto, 'raw', {
    ecc: NIVEL_DE_CORRECAO,
    border: ESPACO_DE_SILENCIO,
  })
}

/**
 * O contorno de todos os módulos escuros num único `path`: uma faixa horizontal por sequência de módulos seguidos ("M x y h n v1 h-n z"). Poucas centenas de
 * bytes por linha e nenhum arquivo de imagem.
 */
export function caminhoDoQr(matriz: boolean[][]): string {
  const partes: string[] = []
  matriz.forEach((linha, y) => {
    let x = 0
    while (x < linha.length) {
      if (!linha[x]) {
        x++
        continue
      }
      const comeco = x
      while (x < linha.length && linha[x]) x++
      const largura = x - comeco
      partes.push(`M${comeco} ${y}h${largura}v1h-${largura}z`)
    }
  })
  return partes.join('')
}

/** O caminho de volta, para os testes: reconstrói a matriz a partir do `d` do `path` (prova que o desenho carrega exatamente os módulos que a biblioteca calculou). */
export function matrizDoCaminho(caminho: string, lado: number): boolean[][] {
  const matriz = Array.from({ length: lado }, () =>
    Array.from({ length: lado }, () => false),
  )
  for (const [, x, y, largura] of caminho.matchAll(
    /M(\d+) (\d+)h(\d+)v1h-\d+z/g,
  )) {
    for (let i = 0; i < Number(largura); i++)
      matriz[Number(y)]![Number(x) + i] = true
  }
  return matriz
}

/**
 * O `<svg>` do QR Code do `texto`. `textoAlternativo` é o que o leitor de tela lê (o código em texto fica sempre ao lado, para quem não enxerga o desenho). Lança se o texto
 * não couber num QR Code (a página então mostra só o código escrito).
 */
export function desenharQr(
  texto: string,
  textoAlternativo: string,
): SVGSVGElement {
  const matriz = matrizDoQr(texto)
  const lado = matriz.length
  const svg = document.createElementNS(NS_DO_SVG, 'svg')
  svg.setAttribute('viewBox', `0 0 ${lado} ${lado}`)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', textoAlternativo)
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.setAttribute('class', 'h-auto w-56 max-w-full')
  svg.setAttribute('data-qr-pix', '')
  const fundo = document.createElementNS(NS_DO_SVG, 'rect')
  fundo.setAttribute('width', String(lado))
  fundo.setAttribute('height', String(lado))
  fundo.setAttribute('fill', '#ffffff')
  const modulos = document.createElementNS(NS_DO_SVG, 'path')
  modulos.setAttribute('d', caminhoDoQr(matriz))
  modulos.setAttribute('fill', '#000000')
  svg.append(fundo, modulos)
  return svg
}
