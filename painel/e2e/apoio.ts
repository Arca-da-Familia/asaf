import type { Page } from '@playwright/test'

/**
 * Nenhum teste de navegador do painel fala com a API de PRODUÇÃO.
 *
 * No CI o painel é montado com `VITE_API_URL=https://api.asaf.org.br`, então tudo que o teste NÃO simula (o sino de avisos, por exemplo) ia mesmo para a produção, com
 * um token de mentira: a produção responde 401, o painel tenta renovar a sessão, desiste e DESLOGA — e o menu some no meio do teste. Dependia só de a resposta chegar
 * antes da última checagem, por isso falhava às vezes (achado em 2026-10-09: com a API respondendo rápido, falhou sempre). Aqui tudo que for para a API de produção sem
 * ter sido simulado leva um 404 de mentira; as rotas que cada teste simula depois (registradas por último, valem primeiro) continuam valendo, e o sino recebe uma lista
 * vazia.
 */
export async function isolarDaProducao(page: Page): Promise<void> {
  await page.route(
    (url) => url.hostname === 'api.asaf.org.br',
    (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Rota não simulada neste teste.' }),
      }),
  )
  await page.route('**/api/minhas-notificacoes/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nao_lidas: 0, avisos: [] }),
    }),
  )
}
