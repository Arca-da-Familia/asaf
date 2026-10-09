// Build usado por Playwright e Lighthouse CI (v5.0): idêntico ao de produção, exceto que a API é a
// SIMULADA (scripts/mock-api.mjs). Desde a v5.2 as páginas de Diretoria, Projetos, Eventos e Edital
// são geradas lendo a API durante o build, então o mock é ligado aqui, só pelo tempo do build.
// Script Node, não variável de ambiente no package.json, para funcionar igual no Windows e no Linux.
import { spawn } from 'node:child_process'

import { AMBIENTE_DE_TESTE, API_DE_TESTE, comMock } from './com-mock.mjs'

export { API_DE_TESTE }

const comando = process.platform === 'win32' ? 'npx.cmd' : 'npx'
// `--vazio`: variante com a API sem nenhum dado (o estado da produção hoje), em `dist-vazio`.
const vazio = process.argv.includes('--vazio')
// `--antiga`: a API ANTES do contexto de projeto/evento (v5.5), em `dist-antiga` — prova que o site continua
// construindo (sem as seções novas) se for publicado antes de a API nova entrar no ar.
const antiga = process.argv.includes('--antiga')
// `--instituicao`: a diretoria preencheu os dados da Instituição (v5.4h), em `dist-instituicao`.
const instituicaoPreenchida = process.argv.includes('--instituicao')
const argumentos = [
  'astro',
  'build',
  ...(vazio ? ['--outDir', 'dist-vazio'] : []),
  ...(antiga ? ['--outDir', 'dist-antiga'] : []),
  ...(instituicaoPreenchida ? ['--outDir', 'dist-instituicao'] : []),
]

/**
 * ASSÍNCRONO de propósito: o mock roda NESTE processo. `spawnSync` bloquearia o laço de eventos e o
 * mock nunca responderia ao build (travava até o tempo limite).
 */
function rodarAstro() {
  return new Promise((resolver) => {
    const filho = spawn(comando, argumentos, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...AMBIENTE_DE_TESTE },
    })
    filho.on('exit', (codigo) => resolver(codigo ?? 1))
  })
}

const status = await comMock(
  { vazio, antiga, instituicaoPreenchida },
  rodarAstro,
)
process.exit(status)
