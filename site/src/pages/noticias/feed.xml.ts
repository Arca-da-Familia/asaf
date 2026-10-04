import type { APIRoute } from 'astro'

import { ORGANIZACAO, SITE_URL } from '../../config/organizacao'
import { caminhoDaNoticia, conteudoPublico } from '../../lib/dados-publicos'

/** Escapa o texto para dentro de XML (o dado vem do Directus: título com "&" ou "<" não pode quebrar o feed). */
const xml = (texto: string) =>
  texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Feed RSS 2.0 das notícias (`/noticias/feed.xml`). Quem acompanha a ASAF por leitor de feed recebe cada
 * notícia sem precisar voltar ao site. Vazio (sem notícias) continua sendo um feed válido.
 */
export const GET: APIRoute = async () => {
  const { noticias } = await conteudoPublico()
  const itens = noticias
    .slice(0, 30)
    .map((n) => {
      const link = `${SITE_URL}${caminhoDaNoticia(n.slug)}`
      return `    <item>
      <title>${xml(n.titulo)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(n.publicadaEm).toUTCString()}</pubDate>
      <description>${xml(n.resumo)}</description>
    </item>`
    })
    .join('\n')
  const ultima = noticias[0]
    ? `\n    <lastBuildDate>${new Date(noticias[0].publicadaEm).toUTCString()}</lastBuildDate>`
    : ''
  const corpo = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Notícias da ${xml(ORGANIZACAO.sigla)}</title>
    <link>${SITE_URL}/noticias/</link>
    <description>${xml(`Notícias da ${ORGANIZACAO.nome}.`)}</description>
    <language>pt-BR</language>${ultima}
    <atom:link href="${SITE_URL}/noticias/feed.xml" rel="self" type="application/rss+xml" />
${itens}
  </channel>
</rss>
`
  return new Response(corpo, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
