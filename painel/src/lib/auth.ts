// Armazenamento do access token EM MEMÓRIA (v0.2.1) — nunca em localStorage, que qualquer
// script XSS consegue ler. O refresh token vive em cookie HttpOnly emitido pela API: o JS
// nunca enxerga esse valor, só o navegador o envia junto nas requisições com credenciais.
let accessToken: string | null = null
let sessionExpiredHandler: (() => void) | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler
}

// Chamado pelo interceptor (api.ts) quando o refresh falha: derruba a sessão e notifica a UI
// para redirecionar ao login. O token de acesso em memória é simplesmente descartado.
export function clearSession(): void {
  accessToken = null
  sessionExpiredHandler?.()
}
