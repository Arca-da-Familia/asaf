/**
 * Cliente mínimo da API pública da ASAF (v5.0) — só leitura, só rotas `/api/publico/...`.
 *
 * Regra de ouro do site (PLANO_PROJETO.md, FASE 5): tudo que é DADO vem do FastAPI e é buscado
 * aqui, no navegador, a cada visita — assim uma inscrição ou um evento novo aparecem na hora, sem
 * rebuild. Só o que é editorial (texto, notícia, banner) é gerado no build, vindo do Directus.
 */

export class ApiError extends Error {
  readonly status?: number
  /** O motivo que a API deu, em português (só nas respostas 4xx de quem envia dados): é para mostrar à pessoa. */
  readonly detalhe?: string

  constructor(mensagem: string, status?: number, detalhe?: string) {
    super(mensagem)
    this.name = 'ApiError'
    this.status = status
    this.detalhe = detalhe
  }
}

export interface OpcoesBusca {
  baseUrl: string
  /** Tempo máximo de espera de CADA tentativa. */
  timeoutMs?: number
  /**
   * Total de tentativas (1 = sem nova tentativa). Só repete o que pode ser passageiro: falha de
   * rede, timeout e erro 5xx. Erro 4xx nunca é repetido (pedido errado continua errado).
   *
   * Existe porque a API escala a ZERO (decisão de custo congelada): depois de um período sem
   * visita, a primeira chamada pode levar vários segundos ou falhar enquanto o contêiner acorda.
   * Sem repetir, o primeiro visitante do dia veria uma mensagem de erro por algo que se resolve
   * sozinho em segundos — foi o que aconteceu no primeiro teste em produção.
   */
  tentativas?: number
  esperaEntreTentativasMs?: number
  fetchImpl?: typeof fetch
}

export async function buscarJson<T>(
  caminho: string,
  opcoes: OpcoesBusca,
): Promise<T> {
  const { tentativas = 1, esperaEntreTentativasMs = 1500 } = opcoes
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await umaTentativa<T>(caminho, opcoes)
    } catch (erro) {
      const passageiro =
        erro instanceof ApiError &&
        (erro.status === undefined || erro.status >= 500)
      if (!passageiro || tentativa >= tentativas) throw erro
      await new Promise((resolver) =>
        setTimeout(resolver, esperaEntreTentativasMs),
      )
    }
  }
}

async function umaTentativa<T>(
  caminho: string,
  { baseUrl, timeoutMs = 10_000, fetchImpl = fetch }: OpcoesBusca,
): Promise<T> {
  const controlador = new AbortController()
  const timer = setTimeout(() => controlador.abort(), timeoutMs)
  try {
    const resposta = await fetchImpl(`${baseUrl}${caminho}`, {
      headers: { Accept: 'application/json' },
      signal: controlador.signal,
      // Rotas públicas: nunca enviar cookie/credencial do navegador.
      credentials: 'omit',
    })
    if (!resposta.ok) {
      throw new ApiError(`A API respondeu ${resposta.status}.`, resposta.status)
    }
    return (await resposta.json()) as T
  } catch (erro) {
    if (erro instanceof ApiError) throw erro
    if (erro instanceof DOMException && erro.name === 'AbortError') {
      throw new ApiError('A API demorou demais para responder.')
    }
    throw new ApiError('Não foi possível falar com a API.')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Envia um JSON por POST à API pública (v5.4h: o pedido de filiação). UMA tentativa só, de propósito: repetir um envio que talvez já tenha chegado
 * criaria um pedido duplicado. A API escala a zero, então o tempo de espera é longo (acordar o contêiner leva alguns segundos).
 */
export async function enviarJson<T>(
  caminho: string,
  corpo: unknown,
  { baseUrl, timeoutMs = 35_000, fetchImpl = fetch }: OpcoesBusca,
): Promise<T> {
  const controlador = new AbortController()
  const timer = setTimeout(() => controlador.abort(), timeoutMs)
  try {
    const resposta = await fetchImpl(`${baseUrl}${caminho}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
      credentials: 'omit',
    })
    if (!resposta.ok) {
      throw new ApiError(
        `A API respondeu ${resposta.status}.`,
        resposta.status,
        await detalheDaResposta(resposta),
      )
    }
    return (await resposta.json()) as T
  } catch (erro) {
    if (erro instanceof ApiError) throw erro
    if (erro instanceof DOMException && erro.name === 'AbortError') {
      throw new ApiError('A API demorou demais para responder.')
    }
    throw new ApiError('Não foi possível falar com a API.')
  } finally {
    clearTimeout(timer)
  }
}

/** `detail` do FastAPI: texto (regra de negócio) ou lista (validação do formato); da lista sai só a primeira mensagem. */
async function detalheDaResposta(
  resposta: Response,
): Promise<string | undefined> {
  try {
    const { detail } = (await resposta.json()) as { detail?: unknown }
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      const primeira = (detail[0] as { msg?: unknown } | undefined)?.msg
      if (typeof primeira === 'string')
        return primeira.replace(/^Value error, /, '')
    }
  } catch {
    // corpo que não é JSON: sem detalhe
  }
  return undefined
}

/** Formato de `GET /api/publico/eventos` (app/routers/eventos.py::_serializar_evento_publico). */
export interface EventoPublico {
  id_evento: number
  titulo: string
  descricao: string | null
  categoria: string
  /** ISO sem fuso (horário local do evento) — ex.: "2026-10-10T19:00:00". */
  data_hora_inicio: string
  data_hora_fim: string | null
  id_espaco: number | null
  endereco_avulso: string | null
  vagas: number | null
  /** `null` = evento sem limite de vagas declarado. */
  vagas_livres: number | null
  gratuito: boolean
}

export function buscarEventosPublicos(opcoes: OpcoesBusca) {
  return buscarJson<EventoPublico[]>('/api/publico/eventos', opcoes)
}
