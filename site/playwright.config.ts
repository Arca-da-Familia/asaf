import { defineConfig, devices } from '@playwright/test'

// v5.0 — auditoria do site MONTADO, num navegador de verdade, contra o build de teste
// (`npm run build:teste`): acessibilidade (axe, WCAG 2.1 AA), SEO técnico, links internos e a
// ilha de eventos em cada estado. Roda em todo PR e push (deploy-site.yml) — é o "meta de
// acessibilidade auditada no CI" que o plano pede para a v5.0 (antecipa a FASE 9).
const PORTA_SITE = 4321
const PORTA_API = 4322

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
