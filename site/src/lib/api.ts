/**
 * Cliente mínimo da API pública da ASAF (v5.0) — só leitura, só rotas `/api/publico/...`.
 *
 * Regra de ouro do site (PLANO_PROJETO.md, FASE 5): tudo que é DADO vem do FastAPI e é buscado
 * aqui, no navegador, a cada visita — assim uma inscrição ou um evento novo aparecem na hora, sem
 * rebuild. Só o que é editorial (texto, notícia, banner) é gerado no build, vindo do Directus.
 */

/** Um erro de validação do FastAPI ligado ao campo que o causou (`loc` = ["body", "email"] -> campo "email"), com a frase já em português. */
export interface ErroDeCampoDaApi {
  campo: string
  mensagem: string
}

export class ApiError extends Error {
  readonly status?: number
  /** O motivo que a API deu, em português (só nas respostas 4xx de quem envia dados): é para mostrar à pessoa. */
  readonly detalhe?: string
  /** Quando a API recusa por validação (422 com uma lista), TODOS os motivos, cada um ligado ao seu campo (v5.6a: a doação aponta o campo errado). */
  readonly erros?: ErroDeCampoDaApi[]

  constructor(
    mensagem: string,
    status?: number,
    detalhe?: string,
    erros?: ErroDeCampoDaApi[],
  ) {
    super(mensagem)
    this.name = 'ApiError'
    this.status = status
    this.detalhe = detalhe
    this.erros = erros
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
      // o motivo que a API deu (uma consulta recusada com 400/503 explica por quê); sem corpo legível, só o status
      const { detalhe, erros } = await detalheDaResposta(resposta)
      throw new ApiError(
        `A API respondeu ${resposta.status}.`,
        resposta.status,
        detalhe,
        erros,
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
      const { detalhe, erros } = await detalheDaResposta(resposta)
      throw new ApiError(
        `A API respondeu ${resposta.status}.`,
        resposta.status,
        detalhe,
        erros,
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

const SEM_PREFIXO_DO_PYDANTIC = /^Value error, /

/**
 * `detail` do FastAPI: texto (regra de negócio) ou lista (validação do formato). `detalhe` é o texto, ou a PRIMEIRA mensagem da lista; `erros` (só na lista) traz todas,
 * cada uma com o campo (o último item de `loc`, sem o "body"/"query" na frente).
 */
async function detalheDaResposta(
  resposta: Response,
): Promise<{ detalhe?: string; erros?: ErroDeCampoDaApi[] }> {
  try {
    const { detail } = (await resposta.json()) as { detail?: unknown }
    if (typeof detail === 'string') return { detalhe: detail }
    if (Array.isArray(detail)) {
      const erros: ErroDeCampoDaApi[] = []
      for (const item of detail as Array<{ loc?: unknown; msg?: unknown }>) {
        if (typeof item?.msg !== 'string') continue
        const ultimo = Array.isArray(item.loc) ? item.loc.at(-1) : undefined
        erros.push({
          campo: typeof ultimo === 'string' ? ultimo : '',
          mensagem: item.msg.replace(SEM_PREFIXO_DO_PYDANTIC, ''),
        })
      }
      if (erros.length > 0) return { detalhe: erros[0]!.mensagem, erros }
    }
  } catch {
    // corpo que não é JSON: sem detalhe
  }
  return {}
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
  /**
   * v5.5d — a situação do evento: 'Programado', 'Adiado', 'Cancelado' ou 'Realizado'. Ausente (API antiga) vale 'Programado' (ver `statusDoEvento`, em
   * situacao-do-evento.ts). `motivo_status` é texto do sistema; `data_hora_inicio_anterior` é o começo de antes da última remarcação.
   */
  status?: string
  motivo_status?: string | null
  data_hora_inicio_anterior?: string | null
}

export function buscarEventosPublicos(opcoes: OpcoesBusca) {
  return buscarJson<EventoPublico[]>('/api/publico/eventos', opcoes)
}
