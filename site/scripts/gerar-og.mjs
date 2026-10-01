// Gera public/og-padrao.png (1200x630) — imagem que aparece quando um link do site é
// compartilhado no WhatsApp, Facebook, LinkedIn etc. Esses serviços NÃO aceitam SVG, só imagem
// raster, por isso o PNG existe. É renderizado de um HTML pelo Chromium do Playwright e o
// resultado é VERSIONADO: o build não depende de fonte instalada na máquina de CI.
//
// Provisório de propósito: usa a identidade dos tokens (azul institucional) e o texto do
// Estatuto, mas não há logotipo oficial no repositório ainda. Quando existir, trocar aqui e
// rodar `npm run og`.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const dir = path.dirname(fileURLToPath(import.meta.url))
const saida = path.join(dir, '..', 'public', 'og-padrao.png')

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: #2563eb; color: #f8fafc;
         font-family: system-ui, 'Segoe UI', Roboto, Arial, sans-serif;
         display: flex; flex-direction: column; justify-content: center; padding: 0 96px; }
  .marca { width: 96px; height: 96px; border-radius: 20px; background: #f8fafc; color: #2563eb;
           display: flex; align-items: center; justify-content: center;
           font-size: 64px; font-weight: 800; margin-bottom: 40px; }
  h1 { font-size: 84px; line-height: 1.05; font-weight: 800; letter-spacing: -1px; }
  .lema { font-size: 40px; font-style: italic; margin-top: 28px; }
  .rodape { position: absolute; left: 96px; bottom: 56px; font-size: 30px; font-weight: 600; }
</style></head><body>
  <div class="marca">A</div>
  <h1>Associação<br>Arca da Família</h1>
  <p class="lema">“Eu e minha família na Arca”</p>
  <p class="rodape">asaf.org.br</p>
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
