// Gera public/version.json antes de cada build/dev — mesmo mecanismo do painel (v0.2.7): permite
// conferir em produção, sem login nenhum, QUAL commit está no ar (asaf.org.br/version.json).
// É o que fecha o item 12 do checklist de revisão (seção 4.1 do PLANO_PROJETO.md) para o site.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))

function commitAtual() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: dir })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

const versao = {
  commit: commitAtual(),
  buildEm: new Date().toISOString(),
}

writeFileSync(
  path.join(dir, '..', 'public', 'version.json'),
  JSON.stringify(versao, null, 2),
)
console.log('public/version.json gerado:', versao)
