import { expect, type Page } from '@playwright/test'

// A VARREDURA do painel: os robôs que passam por todas as telas (v9.1a-01 acessibilidade, v9.3a-01 usabilidade no celular) começam no Início e seguem os
// links do próprio painel (menu, abas e a primeira ficha de cada tipo: /associados/12 representa todas).

// fora da varredura: telas sem sessão (a de entrar tem roteiro próprio), a portaria (link com código de uso único) e o catálogo de componentes de quem desenvolve
export const PULAR =
  /^\/(login|esqueci-a-senha|trocar-senha|mfa\/|portaria\/|dev\/)/

/** /associados/12/sessao -> /associados/:n/sessao: uma ficha de cada tipo basta. */
export function padrao(caminho: string): string {
  return caminho.replace(/\/\d+(?=\/|$)/g, '/:n')
}

/** Os links internos do painel na tela aberta, sem endereço externo, âncora nem parâmetro. */
/** v9.5b: as telas pessoais (Meu perfil, Meus avisos, Minhas assembleias...) ficam na lista suspensa do botão com o nome da pessoa, que só existe na página
 * aberta; os robôs que percorrem o painel pelos links começam também por elas (as mesmas do MenuPessoal). */
export const ROTAS_PESSOAIS = [
  '/perfil',
  '/meus-avisos',
  '/minhas-assembleias',
  '/peticoes-de-convocacao',
  '/filiacao/para-propor',
  '/meu-voluntariado',
  '/meus-processos-disciplinares',
  '/calendario',
  '/configuracoes',
]

export async function linksInternos(page: Page): Promise<string[]> {
  const hrefs = await page.$$eval('a[href]', (as) =>
    as.map((a) => a.getAttribute('href') ?? ''),
  )
  return [
    ...new Set(
      hrefs
        .filter((h) => h.startsWith('/') && !h.startsWith('//'))
        .map((h) => h.split(/[?#]/)[0].replace(/\/$/, '') || '/'),
    ),
  ]
}

/** Espera a tela terminar de carregar (nada mais em "Carregando…"). */
export async function esperarATela(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  await expect(
    page.getByText(/^Carregando/).filter({ visible: true }),
  ).toHaveCount(0, { timeout: 30_000 })
}
