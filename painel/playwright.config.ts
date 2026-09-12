import { defineConfig, devices } from '@playwright/test'

// v0.2.8 — fluxos que não podem quebrar: login, login com MFA, refresh expirado, 403 por falta
// de permissão. Roda contra a API mockada via page.route (não contra um backend real) porque
// esses testes validam o COMPORTAMENTO DO PAINEL diante de cada resposta da API, não o backend
// em si — isso já é coberto por outra suíte, no repositório do backend.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
