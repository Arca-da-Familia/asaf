import type { APIRoute } from 'astro'

import { SITE_URL } from '../config/organizacao'
import { ehHomologacao } from '../lib/ambiente'

/**
 * robots.txt gerado no build (v5.0): libera tudo e aponta o sitemap do @astrojs/sitemap. No site de TESTE (homologação) é o
 * contrário: nenhum buscador deve indexar nada.
 */
export const GET: APIRoute = () =>
  new Response(
    ehHomologacao()
      ? `User-agent: *\nDisallow: /\n`
      : `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap-index.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
