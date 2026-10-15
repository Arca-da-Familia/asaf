// @ts-check
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

import {
  API_PADRAO,
  configComCabecalhos,
  securityTxt,
} from './scripts/lib/cabecalhos-de-seguranca.mjs'
import { ORGANIZACAO, SITE_URL } from './src/config/organizacao.ts'

/**
 * v5.7 — cabeçalhos de segurança e `security.txt`, escritos DENTRO de `dist` no fim de todo build (produção, homologação e build de teste), cada um com a SUA API na política de
 * conteúdo. O Static Web App lê `staticwebapp.config.json` da pasta publicada; `public/staticwebapp.config.json` guarda só as rotas e a página 404.
 * @returns {import('astro').AstroIntegration}
 */
const cabecalhosDeSeguranca = () => ({
  name: 'cabecalhos-de-seguranca',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      const pasta = fileURLToPath(dir)
      const caminhoDaConfig = path.join(pasta, 'staticwebapp.config.json')
      const base = JSON.parse(await readFile(caminhoDaConfig, 'utf8'))
      const api = process.env.PUBLIC_API_URL ?? API_PADRAO
      await writeFile(
        caminhoDaConfig,
        `${JSON.stringify(configComCabecalhos(base, api), null, 2)}
`,
      )
      await mkdir(path.join(pasta, '.well-known'), { recursive: true })
      await writeFile(
        path.join(pasta, '.well-known', 'security.txt'),
        securityTxt({ email: ORGANIZACAO.email, urlDoSite: SITE_URL }),
      )
    },
  },
})

/**
 * Só no teste de navegador (e2e): o `astro preview` manda os MESMOS cabeçalhos que o build escreveu em `dist/staticwebapp.config.json` (o Azure faz isso em produção), para o
 * teste rodar contra o site como ele vai ao ar, com a política de conteúdo valendo. Desligado fora do e2e (`astro dev` precisa de script e estilo dentro da página).
 * @returns {Record<string, string> | undefined}
 */
function cabecalhosPublicadosParaOPreview() {
  if (process.env.SITE_PREVIEW_COM_CABECALHOS !== '1') return undefined
  const publicada = JSON.parse(
    readFileSync('./dist/staticwebapp.config.json', 'utf8'),
  )
  return publicada.globalHeaders
}

// https://astro.build/config
export default defineConfig({
  // Tailwind 4 pelo plugin do Vite (sem PostCSS/autoprefixer nem tailwind.config.js). Tema e
  // tokens vêm de ../design/ via src/styles/global.css.
  // `assetsInlineLimit: 0`: o Astro escreveria dentro da página os scripts pequenos (as Transparências têm um de 685 bytes), e a política de conteúdo (v5.7) só deixa rodar script
  // que vem de um arquivo do próprio site. Com o limite em zero todo script vira arquivo em `/_astro/`.
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
  // Domínio canônico: base de canonical, Open Graph, sitemap e robots.txt (v5.0).
  site: 'https://asaf.org.br',
  integrations: [
    // Fora do sitemap: a página 404 e as páginas dos links do e-mail de inscrição (cancelar e confirmar) — não são conteúdo indexável (v5.5c).
    sitemap({
      filter: (pagina) =>
        !pagina.includes('/404') &&
        !pagina.includes('/cancelar-inscricao') &&
        !pagina.includes('/confirmar-inscricao'),
    }),
    cabecalhosDeSeguranca(),
  ],
  server: {
    port: 4321,
    host: '127.0.0.1',
    headers: cabecalhosPublicadosParaOPreview(),
  },
  devToolbar: { enabled: false },
})
