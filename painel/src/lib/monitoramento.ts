import { ApplicationInsights } from '@microsoft/applicationinsights-web'

// v0.2.7 — envia erro do front para o Application Insights já provisionado na v0.0
// (`asaf-appinsights`). A connection string de telemetria client-side não é segredo (é
// desenhada pela Microsoft para ir embutida no bundle público, como um ID de analytics) — mas
// enquanto ninguém configurar `VITE_APPINSIGHTS_CONNECTION_STRING` no workflow de deploy, este
// módulo vira um no-op: nunca quebra o painel por falta de configuração de telemetria.
const connectionString = import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING

let appInsights: ApplicationInsights | null = null

if (connectionString) {
  appInsights = new ApplicationInsights({
    config: {
      connectionString,
      enableAutoRouteTracking: true,
      disableFetchTracking: false,
    },
  })
  appInsights.loadAppInsights()
}

export function registrarErro(
  erro: unknown,
  propriedades?: Record<string, string>,
) {
  if (!appInsights) {
    console.error('[monitoramento]', erro, propriedades)
    return
  }
  const excecao = erro instanceof Error ? erro : new Error(String(erro))
  appInsights.trackException({ exception: excecao, properties: propriedades })
}

export function inicializarMonitoramentoGlobal() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (evento) => {
    registrarErro(evento.error ?? evento.message, { origem: 'window.onerror' })
  })
  window.addEventListener('unhandledrejection', (evento) => {
    registrarErro(evento.reason, { origem: 'unhandledrejection' })
  })
}
