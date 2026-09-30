// v4.8 (FASE 4) - módulo HTTP GENUINAMENTE STANDALONE da tela da portaria (check-in/check-out no
// evento, sem login do painel - ver painel/src/pages/PortariaGate.tsx). Proposital: NÃO importa
// nada de `./api.ts`, `./auth-context.tsx` nem `./use-me.ts` - nenhum deles faz sentido aqui,
// porque esta tela nunca tem sessão de painel (bearer/refresh/cookie), só o token de portaria
// escopado a um evento, enviado como `Authorization: Bearer <token>`. O plano da v4.8 já prevê
// esta tela sendo levada quase pronta pro site institucional (outro repositório, Astro, ainda não
// construído) - manter o acoplamento zero agora evita ter que desembaraçar isso depois. Por isso
// este arquivo reimplementa seu próprio fetch/erro em vez de reaproveitar `apiFetch`/`ApiError`
// de `./api.ts`.

// Mesma convenção de `./api.ts` (linha ~9): em produção aponta pra origem da API; em dev fica
// vazio e o Vite faz proxy (ver vite.config.ts, entrada `/portaria`).
const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

type ErroPortariaPayload = { detail?: string }

// Erro local (não é `ApiError` de `./api.ts` - mesma forma de dado {status, detail}, instância
// própria) para o chamador distinguir uma resposta HTTP completa (status > 0, recusa do servidor
// - nunca deve ser reenviada sem mudar algo) de uma falha de rede (fetch nem chegou a responder -
// ver `portaria-queue.ts::sincronizar`, que decide se o item da fila offline continua pendente
// com base nessa distinção).
export class ErroPortaria extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ErroPortaria'
    this.status = status
    this.detail = detail
  }
}

/** Status usado quando o `fetch` em si lança (sem resposta do servidor) - nunca um status HTTP
 * de verdade, só um marcador interno pra `portaria-queue.ts` saber que isto é falha de rede. */
export const STATUS_FALHA_DE_REDE = 0

async function parseDetail(res: Response): Promise<string> {
  try {
    const payload = (await res.json()) as ErroPortariaPayload
    if (payload.detail) return payload.detail
  } catch {
    // corpo sem JSON - mantém a mensagem genérica abaixo
  }
  return `Erro inesperado (${res.status}).`
}

// Cliente HTTP único desta tela: injeta Authorization: Bearer <token da portaria> (nunca o
// access token do painel) e lança ErroPortaria em qualquer resposta não-2xx. Sem refresh, sem
// retry, sem sessão - o token de portaria ou é válido ou não é (ver `/portaria/evento`, 401).
export async function chamarPortaria<T>(
  portariaToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Authorization', `Bearer ${portariaToken}`)

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  } catch {
    // Sem resposta do servidor (offline, DNS, etc.) - quem chama (a fila offline) decide se isso
    // vira um reenvio depois.
    throw new ErroPortaria(STATUS_FALHA_DE_REDE, 'Sem conexão com o servidor.')
  }

  if (!res.ok) {
    throw new ErroPortaria(res.status, await parseDetail(res))
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export type EventoPortaria = {
  id_evento: number
  titulo: string
  data_hora_inicio: string
  data_hora_fim: string | null
}

export function obterEventoPortaria(
  portariaToken: string,
): Promise<EventoPortaria> {
  return chamarPortaria<EventoPortaria>(portariaToken, '/portaria/evento')
}

export type MetodoCheckinPortaria = 'codigo' | 'carteirinha'

export type AcaoPortariaPayload = {
  chave_idempotencia: string
  metodo: MetodoCheckinPortaria
  codigo?: string
  token_carteirinha?: string
  id_sessao?: number
}

export type CheckinPortariaResultado = {
  mensagem: string
  id_registro: number
  contexto_tipo: string
  id_contexto: number
  hora_entrada: string
}

export function registrarCheckin(
  portariaToken: string,
  dados: AcaoPortariaPayload,
): Promise<CheckinPortariaResultado> {
  return chamarPortaria<CheckinPortariaResultado>(
    portariaToken,
    '/portaria/checkin',
    { method: 'POST', body: JSON.stringify(dados) },
  )
}

export type CheckoutPortariaResultado = {
  mensagem: string
  id_registro: number
  hora_saida: string
}

export function registrarCheckout(
  portariaToken: string,
  dados: AcaoPortariaPayload,
): Promise<CheckoutPortariaResultado> {
  return chamarPortaria<CheckoutPortariaResultado>(
    portariaToken,
    '/portaria/checkout',
    { method: 'POST', body: JSON.stringify(dados) },
  )
}
