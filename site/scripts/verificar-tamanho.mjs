// Trava de TAMANHO do site publicado (v5.4b). O Azure Static Web Apps no plano Free aceita, por ambiente, 250 MB e 15.000
// arquivos (https://learn.microsoft.com/azure/static-web-apps/quotas); estourar derruba a publicação. Como os PDFs e as
// fotos da Transparência são COPIADOS para o site no build, o site só cresce — esta trava avisa antes de o limite chegar:
//
//   - AVISO a partir de 60% (a publicação segue, mas o resumo do GitHub Actions mostra quanto falta);
//   - ERRO a partir de 85% (a publicação para: dá tempo de decidir entre limpar, passar para o plano Standard — 500 MB —
//     ou servir os PDFs de outro lugar).
//
// Uso: node scripts/verificar-tamanho.mjs [pasta=dist]   (também importável: `medirPasta`, `avaliar`)
import { appendFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LIMITE_FREE = { megabytes: 250, arquivos: 15_000 }
export const PERCENTUAL_DE_AVISO = 60
export const PERCENTUAL_DE_ERRO = 85
export const LIMITE_DE_UM_ARQUIVO_MB = 30 // "Request Size Limit" do plano

/** Soma o tamanho e conta os arquivos de uma pasta (recursivo) e acha o maior arquivo. */
export function medirPasta(pasta) {
  let bytes = 0
  let arquivos = 0
  let maior = { caminho: null, bytes: 0 }
  const percorrer = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name)
      if (entrada.isDirectory()) percorrer(caminho)
      else {
        const tamanho = statSync(caminho).size
        bytes += tamanho
        arquivos += 1
        if (tamanho > maior.bytes) maior = { caminho, bytes: tamanho }
      }
    }
  }
  percorrer(pasta)
  return { bytes, arquivos, maior }
}

/** Compara a medida com o limite. Devolve { nivel: 'ok'|'aviso'|'erro', mensagens, percentuais }. */
export function avaliar(
  medida,
  limite = LIMITE_FREE,
  { aviso = PERCENTUAL_DE_AVISO, erro = PERCENTUAL_DE_ERRO } = {},
) {
  const megabytes = medida.bytes / (1024 * 1024)
  const percentuais = {
    tamanho: (megabytes / limite.megabytes) * 100,
    arquivos: (medida.arquivos / limite.arquivos) * 100,
  }
  const mensagens = []
  let nivel = 'ok'
  const subir = (novo) => {
    if (novo === 'erro' || (novo === 'aviso' && nivel === 'ok')) nivel = novo
  }
  for (const [rotulo, valor, usado, maximo, unidade] of [
    [
      'tamanho',
      percentuais.tamanho,
      megabytes.toFixed(1),
      limite.megabytes,
      'MB',
    ],
    [
      'arquivos',
      percentuais.arquivos,
      medida.arquivos,
      limite.arquivos,
      'arquivos',
    ],
  ]) {
    if (valor >= erro) {
      subir('erro')
      mensagens.push(
        `O site tem ${usado} de ${maximo} ${unidade} (${valor.toFixed(0)}%): passou de ${erro}% do limite do plano. A publicação PAROU de propósito, antes de o Azure recusar.`,
      )
    } else if (valor >= aviso) {
      subir('aviso')
      mensagens.push(
        `O site já usa ${usado} de ${maximo} ${unidade} (${valor.toFixed(0)}%) do limite do plano. Decida logo: limpar, passar para o plano Standard (500 MB) ou servir os PDFs de outro lugar.`,
      )
    }
  }
  const maiorMb = medida.maior.bytes / (1024 * 1024)
  if (maiorMb > LIMITE_DE_UM_ARQUIVO_MB) {
    subir('erro')
    mensagens.push(
      `O arquivo ${medida.maior.caminho} tem ${maiorMb.toFixed(1)} MB: acima de ${LIMITE_DE_UM_ARQUIVO_MB} MB (limite de requisição do plano).`,
    )
  }
  return { nivel, mensagens, percentuais }
}

const executadoDireto =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (executadoDireto) {
  const pasta = process.argv[2] ?? 'dist'
  const medida = medirPasta(pasta)
  const { nivel, mensagens, percentuais } = avaliar(medida)
  const resumo =
    `Tamanho do site (${pasta}): ${(medida.bytes / (1024 * 1024)).toFixed(1)} MB de ${LIMITE_FREE.megabytes} MB ` +
    `(${percentuais.tamanho.toFixed(0)}%) e ${medida.arquivos} de ${LIMITE_FREE.arquivos} arquivos (${percentuais.arquivos.toFixed(0)}%).`
  console.log(resumo)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### Tamanho do site\n\n${resumo}\n\n${mensagens.map((m) => `- ${m}`).join('\n')}\n`,
    )
  }
  for (const mensagem of mensagens) {
    console.log(
      nivel === 'erro' ? `::error::${mensagem}` : `::warning::${mensagem}`,
    )
  }
  process.exit(nivel === 'erro' ? 1 : 0)
}
