// Estado global de conectividade (v0.2.7). O Container App da API tem scale-to-zero: a
// primeira requisição depois de um período ocioso pode demorar segundos para acordar o
// servidor — isso não é uma falha, e não deve parecer uma tela quebrada. `apiFetch`/`rawFetch`
// (lib/api.ts) chamam `iniciarRequisicao`/`finalizarRequisicao` em toda chamada; o `StatusBar`
// (components/layout/StatusBar.tsx) assina este módulo com useSyncExternalStore.
export type EstadoRede = 'ok' | 'acordando' | 'offline'

const ACORDANDO_APOS_MS = 3_000

let estado: EstadoRede = 'ok'
let requisicoesEmVoo = 0
let timerAcordando: ReturnType<typeof setTimeout> | null = null
const ouvintes = new Set<() => void>()

function notificar() {
  for (const ouvinte of ouvintes) ouvinte()
}

function definirEstado(novo: EstadoRede) {
  if (estado === novo) return
  estado = novo
  notificar()
}

export function iniciarRequisicao() {
  requisicoesEmVoo += 1
  if (timerAcordando === null) {
    timerAcordando = setTimeout(() => {
      if (requisicoesEmVoo > 0) definirEstado('acordando')
    }, ACORDANDO_APOS_MS)
  }
}

// `sucesso`: chegou uma resposta HTTP de verdade (mesmo que 4xx/5xx) — o servidor respondeu,
// então a rede está OK, ainda que a requisição em si tenha falhado por outro motivo.
export function finalizarRequisicao(sucesso: boolean) {
  requisicoesEmVoo = Math.max(0, requisicoesEmVoo - 1)
  if (requisicoesEmVoo === 0 && timerAcordando !== null) {
    clearTimeout(timerAcordando)
    timerAcordando = null
  }
  if (sucesso) {
    definirEstado('ok')
  } else if (requisicoesEmVoo === 0) {
    definirEstado('offline')
  }
}

export function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

export function obterEstado(): EstadoRede {
  return estado
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => definirEstado('offline'))
  window.addEventListener('online', () => {
    if (requisicoesEmVoo === 0) definirEstado('ok')
  })
}
