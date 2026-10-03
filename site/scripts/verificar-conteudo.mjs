// Compara o conteúdo público que a API tem AGORA com o do site PUBLICADO (v5.2).
//
// Evento novo, projeto publicado, dirigente empossado, edital emitido: tudo isso vira PÁGINA no build.
// Este script diz se o site publicado ficou para trás. É rodado pelo workflow `sincronizar-site`
// (a cada 30 min); se `mudou`, o workflow dispara o `deploy-site.yml`.
//
//   PUBLIC_API_URL  origem da API   (padrão https://api.asaf.org.br)
//   SITE_URL        origem do site  (padrão https://asaf.org.br)
//
// Saída: uma linha JSON e, no GitHub Actions, `mudou=true|false` em $GITHUB_OUTPUT.
import { appendFileSync } from 'node:fs'

import {
  buscarConteudoPublico,
  impressaoDoConteudo,
} from './lib/conteudo-publico.mjs'

const apiUrl = process.env.PUBLIC_API_URL ?? 'https://api.asaf.org.br'
const siteUrl = (process.env.SITE_URL ?? 'https://asaf.org.br').replace(
  /\/+$/,
  '',
)

// Se a API não responde, ESTE passo falha (o workflow fica vermelho e tenta de novo na próxima
// rodada) — nunca conclui "nada mudou" por não ter conseguido ler.
const atual = impressaoDoConteudo(await buscarConteudoPublico(apiUrl))

let publicada = null
try {
  const resposta = await fetch(`${siteUrl}/conteudo.json?t=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-cache' },
  })
  if (resposta.ok) publicada = (await resposta.json()).impressao ?? null
} catch {
  // Site sem o arquivo ainda (primeiro deploy da v5.2) ou fora do ar: trata como "mudou".
}

const mudou = atual !== publicada
console.log(JSON.stringify({ atual, publicada, mudou }))
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `mudou=${mudou}\n`)
}
