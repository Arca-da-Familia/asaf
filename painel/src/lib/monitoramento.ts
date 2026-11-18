import { ApplicationInsights } from '@microsoft/applicationinsights-web'

// v0.2.7 — envia erro do front para o Application Insights já provisionado na v0.0
// (`asaf-appinsights`). A connection string de telemetria client-side não é segredo (é
// desenhada pela Microsoft para ir embutida no bundle público, como um ID de analytics) — mas
// enquanto ninguém configurar `VITE_APPINSIGHTS_CONNECTION_STRING` no workflow de deploy, este
// módulo vira um no-op: nunca quebra o painel por falta de configuração de telemetria.
// ATENÇÃO (v9.5i, conferência independente da Política 2.19): hoje a variável NÃO existe no deploy. Se for ligada, o SDK grava os cookies `ai_user` e
// `ai_session` e manda as trocas de página (inclusive `/credencial/<código>`, o endereço que abre a conferência de uma pessoa) para o Azure: a Política de
// Privacidade (site/src/pages/privacidade/index.astro, item "Cookies e dados no navegador": "um cookie técnico" e "nada disso é usado para rastrear você")
// deixa de ser verdade e tem de mudar ANTES; e o rastreamento de rota teria de esconder o código da credencial.
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
