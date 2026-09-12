// Gera public/version.json antes de cada build — o painel usa esse arquivo para (1) mostrar a
// versão do build no rodapé e (2) detectar que saiu um deploy novo (v0.2.7), comparando o que
// está rodando na aba aberta contra o que o servidor está servindo agora.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))

function commitAtual() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: dir }).toString().trim()
  } catch {
    return 'dev'
  }
}

const versao = {
  commit: commitAtual(),
  buildEm: new Date().toISOString(),
}

writeFileSync(path.join(dir, '..', 'public', 'version.json'), JSON.stringify(versao, null, 2))
console.log('public/version.json gerado:', versao)
