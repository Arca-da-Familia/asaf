// v7.1a - o aviso de privacidade vem do catálogo do servidor (app/textos_de_privacidade.py), com os links escritos como [texto](/endereco/). Aqui ele vira pedaços
// de texto e de link, para o Astro desenhar no build e a página de inscrição desenhar ao abrir (montando os elementos: nunca HTML vindo de fora).
import textos from '../data/textos-de-privacidade.json'

export type Segmento = { texto: string; href?: string }
export type AvisoDoSite = {
  versao: string
  paragrafos: string[]
  caixa: string
}
export type PontoDeAviso = keyof typeof textos

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g

/** Só endereço do próprio site vira link (o catálogo só tem esses; qualquer outro fica como texto). */
// (barra invertida fica de fora: o navegador lê "/\host" como "//host")
const enderecoDoSite = (href: string) =>
  href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')

export function segmentos(paragrafo: string): Segmento[] {
  const saida: Segmento[] = []
  let desde = 0
  for (const m of paragrafo.matchAll(LINK)) {
    const [inteiro, texto, href] = m
    const inicio = m.index ?? 0
    if (inicio > desde) saida.push({ texto: paragrafo.slice(desde, inicio) })
    saida.push(
      enderecoDoSite(href!) ? { texto: texto!, href } : { texto: inteiro },
    )
    desde = inicio + inteiro.length
  }
  if (desde < paragrafo.length) saida.push({ texto: paragrafo.slice(desde) })
  return saida
}

export function aviso(ponto: PontoDeAviso): AvisoDoSite {
  return textos[ponto]
}

/** Desenha os parágrafos num elemento (a inscrição em evento recebe o aviso pela API ao abrir). */
export function desenharAviso(
  destino: HTMLElement,
  paragrafos: string[],
  classeDoLink: string,
): void {
  destino.replaceChildren(
    ...paragrafos.map((paragrafo, i) => {
      const p = document.createElement('p')
      if (i > 0) p.className = 'mt-2'
      for (const s of segmentos(paragrafo)) {
        if (s.href) {
          const a = document.createElement('a')
          a.href = s.href
          a.className = classeDoLink
          a.textContent = s.texto
          p.append(a)
        } else p.append(s.texto)
      }
      return p
    }),
  )
}
