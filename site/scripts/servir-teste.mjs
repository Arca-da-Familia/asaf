// Sobe API simulada (4322) + preview do build de teste (4321) num só processo — é o comando
// único que o Lighthouse CI precisa (`startServerCommand`). O Playwright sobe os dois por conta
// própria (playwright.config.ts).
//
// Só imprime PRONTO_PARA_TESTE quando as DUAS portas respondem de verdade. Se a 4321 já estiver
// ocupada por um preview antigo, o preview novo morre, este processo sai com erro e o
// Lighthouse falha alto — em vez de medir, em silêncio, um servidor velho com a API fora do ar.
import { spawn } from 'node:child_process'

import './mock-api.mjs'

const preview = spawn('npx', ['astro', 'preview', '--port', '4321'], {
  stdio: 'inherit',
  shell: true,
})
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    preview.kill()
    process.exit(0)
  })
}
preview.on('exit', (codigo) => process.exit(codigo || 1))

async function responde(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

for (let i = 0; i < 120; i++) {
  if (
    (await responde('http://127.0.0.1:4321/')) &&
    (await responde('http://127.0.0.1:4322/api/publico/eventos'))
  ) {
    console.log('PRONTO_PARA_TESTE')
    break
  }
  await new Promise((r) => setTimeout(r, 500))
}
