import type { APIRoute } from 'astro'

import { SITE_URL } from '../config/organizacao'

/** robots.txt gerado no build (v5.0): libera tudo e aponta o sitemap do @astrojs/sitemap. */
export const GET: APIRoute = () =>
  new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap-index.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
