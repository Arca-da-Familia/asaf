import { expect, test, type Page } from '@playwright/test'

import textos from '../../site/src/data/textos-de-privacidade.json' with { type: 'json' }

import {
  API_HML,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v7.2f - O RELATÓRIO DE ATENDIMENTO DAS SOLICITAÇÕES DO TITULAR, para a Diretoria (Privacidade > Relatório de atendimento). Pela tela, como o Presidente:
//  1. o robô faz um pedido pelo site (para o ano ter ao menos um, em qualquer dia); a tela abre no ano de hoje em Belém (dado pelo servidor) com o mesmo
//     total que a API dá, por direito, resultado, canal e fundamento, o prazo e o tempo médio; trocar o ano pede o daquele ano;
//  2. o Tesoureiro (sem a permissão de Privacidade) não lê o relatório.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const VERSAO_DO_AVISO = (textos as Record<string, { versao: string }>)
  .ATENDIMENTO_TITULAR!.versao

async function entrarComToken(
  page: Page,
  papel: Parameters<typeof entrar>[1],
): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, papel)
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

test('o Presidente vê o relatório de atendimento do ano pela tela', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const pedido = await page.request.post(
    `${API_HML}/api/publico/atendimentos`,
    {
      headers: {
        'X-Forwarded-For': `10.75.${(RODADA >> 8) & 255}.${(RODADA % 250) + 1}`,
      },
      data: {
        tipo: 'TITULAR_LGPD',
        subtipo: 'ACESSO',
        mensagem: `Quero saber o que a associação tem sobre mim (robô da v7.2f, rodada ${RODADA}).`,
        nome_completo: `Pessoa Do Relatorio ${RODADA}`,
        cpf: cpfValido((RODADA + 78) % 999_999_999).replace(/\D/g, ''),
        email_contato: `relatorio.v72f.${RODADA}@homologacao.example.com`,
        consentimento_lgpd: true,
        versao_texto_consentimento: VERSAO_DO_AVISO,
      },
    },
  )
  expect(pedido.status(), await pedido.text()).toBe(200)

  const token = await entrarComToken(page, 'presidente')
  const r = await page.request.get(
    `${API_HML}/api/privacidade/solicitacoes-do-titular/relatorio`,
    { headers: { Authorization: token } },
  )
  const dados = (await r.json()) as {
    ano: number
    ano_atual: number
    total: number
    por_canal: { codigo: string; total: number }[]
  }
  expect(dados.ano).toBe(dados.ano_atual)
  expect(dados.total).toBeGreaterThan(0)
  expect(dados.por_canal.map((c) => c.codigo)).toContain('site')

  await page.goto('/privacidade/solicitacoes')
  await expect(
    page.getByRole('heading', { name: 'Relatório de atendimento', level: 1 }),
  ).toBeVisible()
  const relatorio = page.locator(
    `[data-relatorio-de-atendimento="${dados.ano}"]`,
  )
  await expect(relatorio).toBeVisible({ timeout: 30_000 })
  await expect(relatorio).toContainText(`Pedidos no ano${dados.total}`)
  await expect(
    relatorio.getByRole('region', { name: 'Por canal' }),
  ).toContainText('Formulário do site')
  await expect(
    relatorio.getByRole('region', { name: 'Por direito pedido' }),
  ).toContainText('Acessar os dados que a associação tem sobre mim')
  await ver(page, info, 'relatorio-de-atendimento')
  await page.getByLabel('Ano').selectOption(String(dados.ano - 1))
  await expect(
    page.locator(`[data-relatorio-de-atendimento="${dados.ano - 1}"]`),
  ).toBeVisible({ timeout: 30_000 })
  expect(vigia.problemas()).toEqual([])
})

test('o Tesoureiro não lê o relatório de atendimento', async ({ page }) => {
  const token = await entrarComToken(page, 'tesoureiro')
  const r = await page.request.get(
    `${API_HML}/api/privacidade/solicitacoes-do-titular/relatorio`,
    { headers: { Authorization: token } },
  )
  expect(r.status()).toBe(403)
})
