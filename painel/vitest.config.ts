import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // e2e/ é Playwright (npm run test:e2e), não Vitest — sem isto, o glob padrão de teste do
    // Vitest também pega e2e/*.spec.ts e quebra por não reconhecer test.describe do Playwright.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
