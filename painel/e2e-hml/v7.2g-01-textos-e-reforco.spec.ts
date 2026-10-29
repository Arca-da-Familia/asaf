import { expect, test, type Page } from '@playwright/test'

import textos from '../../site/src/data/textos-de-privacidade.json' with { type: 'json' }

import {
  API_HML,
  cadastrarPelaTela,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
} from './apoio'

// v7.2g - OS TEXTOS DA V7.2 E O REFORÇO DA IDENTIDADE NA ELIMINAÇÃO:
//  1. a Política de Privacidade 2.16 no site de homologação: como o pedido é atendido (os canais, a identidade, o relatório para baixar por 15 dias, a
//     eliminação, o total no relatório anual) e o prazo da cópia do relatório entregue;
//  2. no painel: uma associada pede a eliminação pelo site com o CPF e o e-mail do cadastro (a identidade nasce automática); a prévia diz que o cadastro não
//     sai só pelo e-mail; o Presidente reforça a identidade por outro meio e a prévia passa a mostrar o vínculo dela (associada: o cadastro fica). Nada é eliminado.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const VERSAO_DO_AVISO = (textos as Record<string, { versao: string }>)
  .ATENDIMENTO_TITULAR!.versao
const NOME = `Associada Do Reforco ${RODADA}`
const CPF = cpfValido((RODADA + 79) % 999_999_999)
const EMAIL = `reforco.v72g.${RODADA}@homologacao.example.com`

async function entrarComToken(page: Page): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

test('a Política de Privacidade 2.16 no site', async ({ page }, info) => {
  await page.goto(`${SITE}/privacidade/`)
  await expect(page.getByText(/Versão 2\.16 · em vigor desde/)).toBeVisible()
  await expect(page.locator('[data-como-atendemos]')).toContainText(
    'a confirmação pelo e-mail não basta',
  )
  await expect(page.locator('[data-relatorio-dos-seus-dados]')).toContainText(
    'Por 15 dias você baixa o relatório em PDF',
  )
  await expect(page.locator('[data-eliminacao-a-pedido]')).toContainText(
    'o registro de que você participou fica, para a contagem do evento',
  )
  await expect(page.locator('[data-prazo-relatorio-entregue]')).toContainText(
    '15 dias depois de liberado',
  )
  await ver(page, info, 'politica-2-16')
})

test('a identidade automática não tira o cadastro até a equipe reforçar', async ({
  page,
}, info) => {
  await entrarComToken(page)
  await cadastrarPelaTela(page, { nome: NOME, cpf: CPF, email: EMAIL })
  const r = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    headers: {
      'X-Forwarded-For': `10.76.${(RODADA >> 8) & 255}.${(RODADA % 250) + 1}`,
    },
    data: {
      tipo: 'TITULAR_LGPD',
      subtipo: 'ELIMINACAO',
      mensagem: `Quero que apaguem os meus dados (robô da v7.2g, rodada ${RODADA}).`,
      nome_completo: NOME,
      cpf: CPF.replace(/\D/g, ''),
      email_contato: EMAIL,
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO,
    },
  })
  expect(r.status(), await r.text()).toBe(200)
  const protocolo = ((await r.json()) as { protocolo: string }).protocolo

  await page.goto('/atendimentos?situacao=todas')
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  const cartao = page.getByRole('listitem', {
    name: `Atendimento ${protocolo}`,
  })
  await cartao.getByRole('button', { name: 'Abrir' }).click()
  await expect(cartao.locator('[data-reforcar-identidade]')).toBeVisible({
    timeout: 30_000,
  })
  const bloco = cartao.getByRole('region', { name: 'Eliminar a pedido' })
  await bloco
    .getByRole('button', { name: 'Ver o que sai e o que fica' })
    .click()
  await expect(bloco.locator('[data-fica]')).toContainText(
    'O cadastro ligado a este e-mail',
    { timeout: 30_000 },
  )
  await ver(page, info, 'previa-so-pelo-email')

  await cartao
    .getByLabel('O que você conferiu')
    .fill('Conferi o documento com foto da associada na secretaria (robô).')
  await cartao.getByRole('button', { name: 'Validar identidade' }).click()
  await expect(cartao.locator('[data-reforcar-identidade]')).toHaveCount(0, {
    timeout: 30_000,
  })
  await page.reload()
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  await cartao.getByRole('button', { name: 'Abrir' }).click()
  await cartao
    .getByRole('region', { name: 'Eliminar a pedido' })
    .getByRole('button', { name: 'Ver o que sai e o que fica' })
    .click()
  await expect(
    cartao
      .getByRole('region', { name: 'Eliminar a pedido' })
      .locator('[data-vinculos]'),
  ).toContainText('está no quadro de associados', { timeout: 30_000 })
  await ver(page, info, 'previa-depois-do-reforco')
})
