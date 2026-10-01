// Build usado por Playwright e Lighthouse CI (v5.0): idêntico ao de produção, exceto que a ilha
// de eventos aponta para a API simulada (scripts/mock-api.mjs). Script Node, não variável de
// ambiente no package.json, para funcionar igual no Windows e no Linux do CI.
import { spawnSync } from 'node:child_process'

export const API_DE_TESTE = 'http://127.0.0.1:4322'

const comando = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const { status } = spawnSync(comando, ['astro', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PUBLIC_API_URL: API_DE_TESTE },
})
process.exit(status ?? 1)
