// Teste da SINCRONIZAÇÃO (v5.2): o workflow `sincronizar-site` compara a impressão do conteúdo da API
// com a do site publicado (/conteudo.json). Dois erros seriam silenciosos e caros:
//   1. dizer "mudou" quando NADA mudou -> o site seria reconstruído a cada 30 min, para sempre;
//   2. dizer "não mudou" quando mudou  -> evento/projeto novo nunca ganharia página.
// Aqui: mesma API do build => NÃO mudou; API com outro conteúdo => mudou; site sem o arquivo => mudou.
// Pré-requisito: `npm run build:teste` (usa dist/conteudo.json).
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

import { criarServidor } from './mock-api.mjs'

const PORTA_CHEIA = 4322
const PORTA_VAZIA = 4323
const PORTA_SITE = 4324

const escutar = (servidor, porta) =>
  new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar)
    servidor.listen(porta, '127.0.0.1', resolver)
  })

function verificar(env) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn('node', ['scripts/verificar-conteudo.mjs'], {
      env: { ...process.env, ...env },
    })
    let saida = ''
    let erro = ''
    filho.stdout.on('data', (d) => (saida += d))
    filho.stderr.on('data', (d) => (erro += d))
    filho.on('exit', (codigo) =>
      codigo === 0
        ? resolver(JSON.parse(saida.trim().split('\n').pop()))
        : rejeitar(new Error(`verificar-conteudo saiu com ${codigo}: ${erro}`)),
    )
  })
}

const publicado = readFileSync('dist/conteudo.json', 'utf-8')
const cheia = criarServidor()
const vazia = criarServidor({ vazio: true })
// "Site publicado": serve o /conteudo.json do build; qualquer outro caminho é 404.
const site = createServer((req, res) => {
  if ((req.url ?? '').startsWith('/conteudo.json')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(publicado)
  } else {
    res.writeHead(404).end()
  }
})
const semArquivo = createServer((_req, res) => res.writeHead(404).end())

const problemas = []
try {
  await Promise.all([
    escutar(cheia, PORTA_CHEIA),
    escutar(vazia, PORTA_VAZIA),
    escutar(site, PORTA_SITE),
    escutar(semArquivo, PORTA_SITE + 1),
  ])
  const base = { SITE_URL: `http://127.0.0.1:${PORTA_SITE}` }

  const igual = await verificar({
    ...base,
    PUBLIC_API_URL: `http://127.0.0.1:${PORTA_CHEIA}`,
  })
  if (igual.mudou)
    problemas.push(
      'API IGUAL à do build, mas a sincronização disse "mudou" (reconstruiria o site sem parar)',
    )

  // Repetido: o conteúdo não pode variar de uma leitura para outra (hora, ordem, sorteio...).
  const outraVez = await verificar({
    ...base,
    PUBLIC_API_URL: `http://127.0.0.1:${PORTA_CHEIA}`,
  })
  if (outraVez.atual !== igual.atual)
    problemas.push('a impressão do MESMO conteúdo variou entre duas leituras')

  const diferente = await verificar({
    ...base,
    PUBLIC_API_URL: `http://127.0.0.1:${PORTA_VAZIA}`,
  })
  if (!diferente.mudou)
    problemas.push(
      'API com OUTRO conteúdo, mas a sincronização disse "não mudou" (página nova nunca nasceria)',
    )

  const primeiroDeploy = await verificar({
    SITE_URL: `http://127.0.0.1:${PORTA_SITE + 1}`,
    PUBLIC_API_URL: `http://127.0.0.1:${PORTA_CHEIA}`,
  })
  if (!primeiroDeploy.mudou)
    problemas.push(
      'site SEM /conteudo.json (1º deploy da v5.2) devia contar como "mudou"',
    )
} finally {
  for (const s of [cheia, vazia, site, semArquivo]) s.close()
}

if (problemas.length > 0) {
  console.error('SINCRONIZAÇÃO COM PROBLEMA:')
  for (const p of problemas) console.error('  -', p)
  process.exit(1)
}
console.log(
  'OK: sincronização — igual não reconstrói; diferente e 1º deploy reconstroem.',
)
