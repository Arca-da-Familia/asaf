import { expect, test, type Page } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao } from './apoio'

// v7.3b - OS CABEÇALHOS DE SEGURANÇA DO PAINEL E DA API, na homologação:
//  1. o painel manda a política de conteúdo (só ele mesmo e a API de teste; o script do tema pelo resumo), quadro proibido, a câmera só para ele;
//  2. a API manda nosniff, quadro proibido, HSTS e, no JSON, a política fechada;
//  3. o Presidente percorre TODAS as telas do menu e nenhuma é bloqueada pela política (o navegador avisa cada bloqueio pelo evento
//     `securitypolicyviolation`, que o robô escuta), e a tela de cada uma aparece.
test.beforeAll(() => exigirHomologacao())
test.setTimeout(600_000)

const TELAS = [
  '/',
  '/acesso',
  '/associados',
  '/associados/graficos',
  '/associados/importar',
  '/associados/novo',
  '/associados/propostas',
  '/associados/qualidade',
  '/atendimentos',
  '/auditoria',
  '/beneficiarios',
  '/comunicacao',
  '/comunicacao/agendados',
  '/comunicacao/modelos',
  '/comunicacao/novo',
  '/documentos',
  '/documentos-emitidos',
  '/documentos/novo',
  '/eventos',
  '/financeiro',
  '/financeiro/alcadas-aprovacao',
  '/financeiro/auditoria-financeira',
  '/financeiro/centros-custo',
  '/financeiro/compras',
  '/financeiro/conciliacao',
  '/financeiro/conselho-fiscal',
  '/financeiro/contas-a-pagar-recorrentes',
  '/financeiro/contas-financeiras',
  '/financeiro/doacoes',
  '/financeiro/entradas',
  '/financeiro/exercicios',
  '/financeiro/fornecedores',
  '/financeiro/gerar-cobrancas',
  '/financeiro/negociacao-divida',
  '/financeiro/orcamento',
  '/financeiro/plano-contas',
  '/financeiro/planos-contribuicao',
  '/financeiro/razao-contabil',
  '/financeiro/reembolso-despesa',
  '/financeiro/registrar-saida',
  '/financeiro/relatorios',
  '/financeiro/saidas',
  '/financeiro/titulos',
  '/governanca',
  '/governanca/atas',
  '/governanca/deliberacoes',
  '/governanca/disciplina',
  '/governanca/dissolucao',
  '/governanca/estatuto',
  '/governanca/mandatos',
  '/governanca/nova',
  '/governanca/peticoes',
  '/instituicao',
  '/parcerias',
  '/parcerias/nova',
  '/privacidade',
  '/privacidade/avisos',
  '/privacidade/consentimentos',
  '/privacidade/inventario',
  '/privacidade/relatorio-de-impacto',
  '/privacidade/solicitacoes',
  '/privacidade/titulares',
  '/projetos',
  '/regras',
  '/reserva-espaco',
  '/perfil',
]

async function vigiarBloqueios(page: Page): Promise<string[]> {
  const bloqueios: string[] = []
  await page.exposeFunction('asafBloqueio', (texto: string) =>
    bloqueios.push(texto),
  )
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(
        window as unknown as { asafBloqueio: (t: string) => void }
      ).asafBloqueio(
        `${location.pathname}: ${e.violatedDirective} bloqueou ${e.blockedURI || '(inline)'}`,
      )
    })
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text()))
      bloqueios.push(`${page.url()}: ${m.text()}`)
  })
  return bloqueios
}

test('os cabeçalhos do painel e da API', async ({ page, baseURL }) => {
  const painel = await page.request.get(`${baseURL}/`)
  const csp = painel.headers()['content-security-policy'] ?? ''
  expect(csp).toContain("default-src 'none'")
  expect(csp).toContain(`connect-src 'self' ${API_HML}`)
  expect(csp).toMatch(/script-src 'self' 'sha256-[^']+'/)
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  expect(painel.headers()['x-frame-options']).toBe('DENY')
  expect(painel.headers()['permissions-policy']).toContain('camera=(self)')

  const api = await page.request.get(
    `${API_HML}/api/publico/atendimentos/prazos`,
  )
  expect(api.headers()['x-content-type-options']).toBe('nosniff')
  expect(api.headers()['x-frame-options']).toBe('DENY')
  expect(api.headers()['strict-transport-security']).toContain('max-age=')
  expect(api.headers()['content-security-policy']).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  )
})

test('nenhuma tela do painel é bloqueada pela política de conteúdo', async ({
  page,
}) => {
  const bloqueios = await vigiarBloqueios(page)
  await entrar(page, 'presidente')
  for (const tela of TELAS) {
    await page.goto(tela)
    await expect(
      page.locator('main h1').first(),
      `a tela ${tela} apareceu`,
    ).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState('networkidle')
  }
  expect(bloqueios).toEqual([])
})
