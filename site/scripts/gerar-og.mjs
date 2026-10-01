// Gera public/og-padrao.png (1200x630) — imagem que aparece quando um link do site é
// compartilhado no WhatsApp, Facebook, LinkedIn etc. Esses serviços NÃO aceitam SVG, só imagem
// raster, por isso o PNG existe. É renderizado de um HTML pelo Chromium do Playwright e o
// resultado é VERSIONADO: o build não depende de fonte instalada na máquina de CI.
//
// Usa a logo institucional (design/logo/asaf-logo-600.png, gerada por `npm run logos`) e a
// paleta da marca (verde #145238, ouro #E3C435). Mudou a logo ou a paleta: `npm run logos` e
// depois `npm run og`.
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const dir = path.dirname(fileURLToPath(import.meta.url))
const saida = path.join(dir, '..', 'public', 'og-padrao.png')
const logo = readFileSync(
  path.join(dir, '..', '..', 'design', 'logo', 'asaf-logo-600.png'),
).toString('base64')

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: #145238; color: #f8fafc;
         font-family: system-ui, 'Segoe UI', Roboto, Arial, sans-serif;
         display: flex; align-items: center; justify-content: space-between;
         padding: 0 88px 0 96px; position: relative; }
  .faixa { position: absolute; left: 0; right: 0; bottom: 0; height: 18px; background: #e3c435; }
  .texto { max-width: 600px; }
  .sigla { font-size: 30px; font-weight: 700; letter-spacing: 6px; }
  h1 { font-size: 68px; line-height: 1.05; font-weight: 800; letter-spacing: -1px; margin-top: 14px; }
  .barra { width: 96px; height: 8px; border-radius: 4px; background: #e3c435; margin-top: 26px; }
  .lema { font-size: 38px; font-style: italic; margin-top: 26px; }
  .site { font-size: 30px; font-weight: 600; margin-top: 44px; color: #e3c435; }
  img { width: 420px; height: auto; }
</style></head><body>
  <div class="texto">
    <p class="sigla">ASAF</p>
    <h1>Associação<br>Arca da Família</h1>
    <div class="barra"></div>
    <p class="lema">“Eu e minha família na Arca”</p>
    <p class="site">asaf.org.br</p>
  </div>
  <img src="data:image/png;base64,${logo}" alt="">
  <div class="faixa"></div>
</body></html>`

mkdirSync(path.dirname(saida), { recursive: true })
const navegador = await chromium.launch()
const pagina = await navegador.newPage({
  viewport: { width: 1200, height: 630 },
})
await pagina.setContent(html)
await pagina.screenshot({ path: saida, type: 'png' })
await navegador.close()
console.log('gerado:', saida)
