/**
 * Cliente mínimo da API pública da ASAF (v5.0) — só leitura, só rotas `/api/publico/...`.
 *
 * Regra de ouro do site (PLANO_PROJETO.md, FASE 5): tudo que é DADO vem do FastAPI e é buscado
 * aqui, no navegador, a cada visita — assim uma inscrição ou um evento novo aparecem na hora, sem
 * rebuild. Só o que é editorial (texto, notícia, banner) é gerado no build, vindo do Directus.
 */

export class ApiError extends Error {
  readonly status?: number

  constructor(mensagem: string, status?: number) {
    super(mensagem)
    this.name = 'ApiError'
    this.status = status
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
