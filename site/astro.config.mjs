// @ts-check
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  // Domínio canônico: base de canonical, Open Graph, sitemap e robots.txt (v5.0).
  site: 'https://asaf.org.br',
  integrations: [
    // A página 404 não entra no sitemap (não é conteúdo indexável).
    sitemap({ filter: (pagina) => !pagina.includes('/404') }),
  ],
  server: { port: 4321, host: '127.0.0.1' },
  devToolbar: { enabled: false },
})
