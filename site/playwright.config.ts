import { defineConfig, devices } from '@playwright/test'

// v5.0 — auditoria do site MONTADO, num navegador de verdade, contra o build de teste
// (`npm run build:teste`): acessibilidade (axe, WCAG 2.1 AA), SEO técnico, links internos e a
// ilha de eventos em cada estado. Roda em todo PR e push (deploy-site.yml) — é o "meta de
// acessibilidade auditada no CI" que o plano pede para a v5.0 (antecipa a FASE 9).
// Portas padrão 4321 (site) e 4322 (API simulada); `PORTA_DO_SITE_DE_TESTE` e `MOCK_API_PORT` trocam as duas quando outra
// cópia do projeto já ocupa as padrão (o build de teste tem que ser gerado com o mesmo `MOCK_API_PORT`).
const PORTA_SITE = Number(process.env.PORTA_DO_SITE_DE_TESTE ?? 4321)
const PORTA_API = Number(process.env.MOCK_API_PORT ?? 4322)

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORTA_SITE}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node scripts/mock-api.mjs',
      url: `http://127.0.0.1:${PORTA_API}/api/publico/eventos`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: `npm run preview -- --port ${PORTA_SITE}`,
      url: `http://127.0.0.1:${PORTA_SITE}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
