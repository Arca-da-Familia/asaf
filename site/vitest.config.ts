import { defineConfig } from 'vitest/config'

// Testes unitários (lib/): puros, rápidos. O DOM (jsdom) é pedido por arquivo, via
// `// @vitest-environment jsdom`. A auditoria do site montado (axe, SEO, ilha no navegador
// real) é do Playwright (e2e/) e do Lighthouse CI.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
