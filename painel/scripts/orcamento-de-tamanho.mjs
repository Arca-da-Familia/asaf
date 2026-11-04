// v9.2a - ORÇAMENTO DE TAMANHO do painel, conferido depois do build (passo "Orçamento de tamanho" da publicação). O público abre o painel em celular simples e
// rede móvel instável: painel que cresce sem vigilância fica lento em poucos anos. Mede, compactado como o navegador recebe (gzip):
//   - a ENTRADA: o que a primeira tela baixa antes de aparecer (o script do index.html e os que ele pede de antemão, mais o CSS);
//   - cada PEDAÇO sozinho (uma tela, uma biblioteca de gráficos): nenhum pode passar do limite.
// Medido em 2026-11-04, com as telas sob demanda: entrada 178 KB com o CSS (antes, tudo de uma vez: mais de 520 KB); maior pedaço 147 KB. Os limites deixam folga de ~25%:
// passou, é hora de olhar o que entrou (uma biblioteca grande importada na entrada, uma tela que deixou de ser sob demanda).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

export const LIMITE_DA_ENTRADA_KB = 220
export const LIMITE_DE_UM_PEDACO_KB = 200

const kb = (bytes) => Math.round(bytes / 1024)
const compactado = (arquivo) =>
  gzipSync(readFileSync(arquivo), { level: 9 }).length

/** Os arquivos que a primeira tela baixa: os do index.html (script de entrada, modulepreload e CSS). */
export function arquivosDaEntrada(html) {
  return [
    ...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g),
  ].map((m) => m[1])
}

export function medir(pasta = 'dist') {
  const html = readFileSync(path.join(pasta, 'index.html'), 'utf-8')
  const entrada = arquivosDaEntrada(html).map((a) => ({
    arquivo: a,
    bytes: compactado(path.join(pasta, a)),
  }))
  const pedacos = readdirSync(path.join(pasta, 'assets'))
    .filter((a) => a.endsWith('.js'))
    .map((a) => ({
      arquivo: `assets/${a}`,
      bytes: compactado(path.join(pasta, 'assets', a)),
    }))
    .sort((x, y) => y.bytes - x.bytes)
  return {
    entrada,
    totalDaEntrada: entrada.reduce((s, a) => s + a.bytes, 0),
    pedacos,
  }
}

export function conferir({ entrada, totalDaEntrada, pedacos }) {
  const problemas = []
  if (entrada.length === 0)
    problemas.push(
      'o index.html não pede nenhum script: o build mudou de formato?',
    )
  if (kb(totalDaEntrada) > LIMITE_DA_ENTRADA_KB)
    problemas.push(
      `a primeira tela baixa ${kb(totalDaEntrada)} KB (limite ${LIMITE_DA_ENTRADA_KB} KB): ${entrada.map((a) => `${a.arquivo} ${kb(a.bytes)} KB`).join(', ')}`,
    )
  for (const p of pedacos)
    if (kb(p.bytes) > LIMITE_DE_UM_PEDACO_KB)
      problemas.push(
        `${p.arquivo}: ${kb(p.bytes)} KB (limite de um pedaço: ${LIMITE_DE_UM_PEDACO_KB} KB)`,
      )
  return problemas
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('orcamento-de-tamanho.mjs')
) {
  const medida = medir(process.argv[2] ?? 'dist')
  console.log(
    `Primeira tela: ${kb(medida.totalDaEntrada)} KB compactados (limite ${LIMITE_DA_ENTRADA_KB} KB), em ${medida.entrada.length} arquivos.`,
  )
  console.log(
    `Maiores pedaços: ${medida.pedacos
      .slice(0, 5)
      .map((p) => `${p.arquivo} ${kb(p.bytes)} KB`)
      .join('; ')}`,
  )
  const problemas = conferir(medida)
  if (problemas.length > 0) {
    for (const p of problemas) console.error(`::error::${p}`)
    process.exit(1)
  }
  console.log('OK: dentro do orçamento de tamanho.')
}
