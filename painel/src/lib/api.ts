import { clearSession, getAccessToken, setAccessToken } from './auth'

// Em produção, aponte para a origem da API (mesmo site do painel para o cookie SameSite=Strict
// funcionar — ex.: https://api.asaf.org.br). Em dev, deixe vazio: o Vite faz proxy de /auth.
const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

type ErrorPayload = {
  detail?: string | { loc: (string | number)[]; msg: string; type: string }[]
}

export type ErroCampo422 = { campo: string; mensagem: string }

export class ApiError extends Error {
  status: number
  detail: string
  retryAfter?: number
  errosCampos: ErroCampo422[]

  constructor(
    status: number,
    detail: string,
    errosCampos: ErroCampo422[] = [],
    retryAfter?: number,
  ) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.errosCampos = errosCampos
    this.retryAfter = retryAfter
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = `Erro inesperado (${res.status}).`
  const retryAfter = res.headers.get('retry-after')
  const errosCampos: ErroCampo422[] = []
  try {
    const payload = (await res.json()) as ErrorPayload
    if (Array.isArray(payload.detail)) {
      // Erro 422 do FastAPI: detail é uma lista de { loc, msg, type }. Extrai o campo
      // (loc sem o prefixo "body") para o FormShell mapear de volta no react-hook-form.
      errosCampos.push(
        ...payload.detail.map((d) => ({
          campo: d.loc.filter((p) => p !== 'body').join('.'),
          mensagem: d.msg,
        })),
      )
      detail = errosCampos[0]?.mensagem ?? 'Dados inválidos.'
    } else if (payload.detail) {
      detail = payload.detail
    }
  } catch {
    // corpo sem JSON — mantém a mensagem genérica
  }
  return new ApiError(
    res.status,
    detail,
    errosCampos,
    retryAfter ? Number(retryAfter) : undefined,
  )
}

// ---------------------------------------------------------------------------
// Refresh com fila de espera: nunca dois refresh concorrentes. Enquanto um está
// em voo, as demais requisições 401 aguardam o MESMO Promise.
// ---------------------------------------------------------------------------
let refreshInFlight: Promise<boolean> | null = null

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // envia o cookie HttpOnly do refresh
    })
    if (!res.ok) return false
    const data = (await res.json()) as { access_token?: string }
    if (data.access_token) setAccessToken(data.access_token)
    return true
  } catch {
    return false
  }
}

function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

// Chamado uma vez, ao carregar a aplicação (ver AuthProvider): o access token só existe em
// memória e por isso não sobrevive a um F5/fechar-e-abrir aba - sem isto, toda recarga de
// página derrubaria a sessão mesmo com o cookie de refresh (30 dias) ainda válido, o que
// tornaria esse cookie inútil na prática. Reaproveita a mesma fila de espera do interceptor.
export function bootstrapSession(): Promise<boolean> {
  return refreshAccessToken()
}

// ---------------------------------------------------------------------------
// Cliente HTTP único. Injeta Authorization: Bearer, detecta 401, tenta o refresh
// UMA vez e refaz a requisição original. Se o refresh falhar, derruba a sessão.
// ---------------------------------------------------------------------------
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  alreadyRetried = false,
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')

  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 401) {
    if (!alreadyRetried) {
      const renewed = await refreshAccessToken()
      if (renewed) {
        return apiFetch<T>(path, init, true)
      }
    }
    clearSession()
    throw new ApiError(401, 'Sessão expirada. Faça login novamente.')
  }

  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Endpoints de autenticação — NÃO passam pelo interceptor (401 aqui é credencial
// errada ou refresh ausente, não sessão expirada que deva tentar renovar).
// ---------------------------------------------------------------------------
export type LoginPayload = { cpf: string; senha: string }
export type LoginMfaPayload = {
  cpf: string
  login_temp_token: string
  codigo_totp?: string
  codigo_recuperacao?: string
}

export type TokenPayload = {
  access_token: string
  refresh_token?: string | null
  token_type: string
  expires_in_minutos: number
  requer_mfa: boolean
  login_temp_token?: string | null
}

async function rawFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function login(payload: LoginPayload): Promise<TokenPayload> {
  return rawFetch<TokenPayload>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loginMfa(payload: LoginMfaPayload): Promise<TokenPayload> {
  return rawFetch<TokenPayload>('/auth/login/mfa', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function logout(): Promise<void> {
  try {
    // O cookie HttpOnly é enviado automaticamente (credentials: include) e a API o revoga.
    await rawFetch('/auth/logout', { method: 'POST', body: '{}' })
  } finally {
    setAccessToken(null)
  }
}

export type Me = {
  id_usuario: number
  id_associado?: number | null
  nome_completo?: string | null
  email?: string | null
  nivel?: string | null
  mfa_ativado: boolean
  mfa_obrigatorio: boolean
  mfa_pendente: boolean
  permissoes: string[]
}

export function me(): Promise<Me> {
  return apiFetch<Me>('/auth/me')
}

export type MfaAtivarResult = { otpauth_uri: string }

export function mfaAtivar(): Promise<MfaAtivarResult> {
  return apiFetch<MfaAtivarResult>('/auth/mfa/ativar', { method: 'POST' })
}

export type MfaConfirmarResult = {
  mensagem: string
  codigos_recuperacao: string[]
}

export function mfaConfirmar(codigoTotp: string): Promise<MfaConfirmarResult> {
  return apiFetch<MfaConfirmarResult>('/auth/mfa/confirmar', {
    method: 'POST',
    body: JSON.stringify({ codigo_totp: codigoTotp }),
  })
}
