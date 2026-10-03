// Conteúdo público do site (v5.2) — busca na API e "impressão digital" do que as páginas mostram.
//
// COMPARTILHADO por dois usuários, de propósito, para nunca divergirem:
//   1. o BUILD das páginas (src/lib/dados-publicos.ts): gera Diretoria, Projetos, cada Evento etc.;
//   2. a SINCRONIZAÇÃO (scripts/verificar-conteudo.mjs, rodada pelo workflow sincronizar-site): compara
//      a impressão do que a API tem HOJE com a do site publicado (/conteudo.json) e, se mudou,
//      dispara um novo deploy. É assim que um evento/projeto/dirigente novo ganha página sem ninguém
//      lembrar de reconstruir o site.
//
// É JavaScript puro (não TypeScript) para rodar no Node do CI sem compilar. Tipos: conteudo-publico.d.mts.
import { createHash } from 'node:crypto'

/** Listas que alimentam as páginas. O detalhe de cada evento é buscado em seguida. */
export const ENDPOINTS_DE_LISTA = {
  eventos: '/api/publico/eventos',
  projetos: '/api/publico/projetos',
  diretoria: '/api/publico/diretoria',
  assembleias: '/api/publico/assembleias',
}

const ESPERA_ENTRE_TENTATIVAS_MS = 3000

/** GET JSON com repetição só do que pode ser passageiro (rede, timeout, 5xx). 4xx nunca se repete. */
async function buscar(
  base,
  caminho,
  { fetchImpl, tentativas, timeoutMs, esperaMs },
) {
  let ultimoErro
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const controlador = new AbortController()
    const timer = setTimeout(() => controlador.abort(), timeoutMs)
    try {
      const resposta = await fetchImpl(`${base}${caminho}`, {
        headers: { Accept: 'application/json' },
        signal: controlador.signal,
      })
      if (resposta.ok) return await resposta.json()
      ultimoErro = new Error(`${caminho}: a API respondeu ${resposta.status}`)
      if (resposta.status < 500) throw ultimoErro
    } catch (erro) {
      ultimoErro = erro instanceof Error ? erro : new Error(String(erro))
      if (/a API respondeu 4\d\d/.test(ultimoErro.message)) throw ultimoErro
    } finally {
      clearTimeout(timer)
    }
    if (tentativa < tentativas)
      await new Promise((r) => setTimeout(r, esperaMs))
  }
  throw new Error(
    `Não consegui ler ${caminho} da API (${tentativas} tentativas): ${ultimoErro?.message}`,
  )
}

/**
 * Lê TODO o conteúdo público. A API escala a zero (partida a frio de ~20-35 s), então o tempo por
 * tentativa é generoso. Qualquer falha derruba o build: melhor não publicar do que publicar um
 * site sem a diretoria, sem projetos e sem eventos por causa de uma API acordando.
 */
export async function buscarConteudoPublico(apiUrl, opcoes = {}) {
  const config = {
    fetchImpl: opcoes.fetchImpl ?? fetch,
    tentativas: opcoes.tentativas ?? 3,
    timeoutMs: opcoes.timeoutMs ?? 60_000,
    esperaMs: opcoes.esperaMs ?? ESPERA_ENTRE_TENTATIVAS_MS,
  }
  const base = apiUrl.replace(/\/+$/, '')
  const [eventos, projetos, diretoria, assembleias] = await Promise.all(
    Object.values(ENDPOINTS_DE_LISTA).map((caminho) =>
      buscar(base, caminho, config),
    ),
  )
  const detalhesDeEventos = {}
  await Promise.all(
    eventos.map(async (evento) => {
      detalhesDeEventos[evento.id_evento] = await buscar(
        base,
        `/api/publico/eventos/${evento.id_evento}`,
        config,
      )
    }),
  )
  return { eventos, detalhesDeEventos, projetos, diretoria, assembleias }
}

/** Remove, recursivamente, os campos que mudam a cada inscrição (não justificam reconstruir o site). */
function semVolateis(valor) {
  if (Array.isArray(valor)) return valor.map(semVolateis)
  if (valor && typeof valor === 'object') {
    const limpo = {}
    for (const chave of Object.keys(valor).sort()) {
      if (chave === 'vagas_livres' || chave === 'vagas_ocupadas') continue
      limpo[chave] = semVolateis(valor[chave])
    }
    return limpo
  }
  return valor
}

/**
 * SHA-256 do conteúdo canônico (chaves em ordem, sem vagas). Duas buscas iguais dão a mesma
 * impressão; basta um título, uma data ou um nome mudar para ela mudar.
 */
export function impressaoDoConteudo(conteudo) {
  const canonico = JSON.stringify(semVolateis(conteudo))
  return createHash('sha256').update(canonico).digest('hex')
}
