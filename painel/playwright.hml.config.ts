import { defineConfig, devices } from '@playwright/test'

// v5.4c — conferência AO VIVO na homologação (decisão do presidente, 2026-10-05). Ao contrário de playwright.config.ts (que roda o painel
// local contra uma API mockada), este abre um navegador de verdade no painel PUBLICADO de teste (hml-painel), que fala com a API e o banco
// de teste de verdade, e guarda print, vídeo e relatório de cada passo. Roda pelo fluxo `testar-homologacao.yml`; as senhas de teste vêm do
// cofre (variáveis HML_ADMIN_SENHA e HML_USUARIOS_JSON) e nunca são impressas nem guardadas nos arquivos de resultado.
const painel = process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br'

// Trava: este robô só mexe na homologação. Qualquer outro endereço (a produção, por exemplo) aborta antes de abrir o navegador.
if (new URL(painel).hostname !== 'hml-painel.asaf.org.br') {
  throw new Error(
    `RECUSADO: o robô de conferência só roda contra hml-painel.asaf.org.br, não contra ${painel}.`,
  )
}

export default defineConfig({
  testDir: './e2e-hml',
  outputDir: './prints-hml/execucao',
  // Os roteiros são histórias (cadastrar, depois conferir): em ordem, um de cada vez.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // A API de teste escala a zero: a primeira chamada pode levar mais de 30 s para acordar.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'prints-hml/relatorio', open: 'never' }],
  ],
  use: {
    baseURL: painel,
    locale: 'pt-BR',
    timezoneId: 'America/Belem',
    // Sem `trace`: o trace guarda o texto digitado, e a senha de teste não pode ir parar num arquivo.
    trace: 'off',
    video: 'on',
    screenshot: 'on',
    viewport: { width: 1366, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 900 },
      },
    },
  ],
})
