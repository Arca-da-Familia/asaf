import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v7.2e - O PEDIDO SOBRE OS PRÓPRIOS DADOS FEITO DE DENTRO DO PAINEL (Meu Perfil > Meus dados pessoais). Pela tela:
//  1. a Secretária abre a aba, tenta enviar sem escolher (a tela recusa), escolhe "Acessar os dados", escreve, lê o aviso e envia: recebe o protocolo e o
//     prazo e o aviso de que a equipe vai conferir a identidade (na homologação o segundo passo está desligado: a entrada no painel não prova a identidade);
//  2. o Presidente acha o pedido na fila, confere a identidade à mão, abre "Conferir e liberar o relatório" e libera; a Auditoria guarda quem pediu;
//  3. a Secretária baixa o relatório pelo próprio painel (o PDF), sem passar pela Minha conta do site.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const MENSAGEM = `Quero saber o que a associação guarda sobre mim (robô da v7.2e, rodada ${RODADA}).`
let protocolo = ''

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

async function abrirMeusDados(page: Page) {
  await page.goto('/perfil')
  await page.getByRole('button', { name: 'Meus dados pessoais' }).click()
}

test('a Secretária faz pelo painel um pedido sobre os próprios dados', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComToken(page, 'secretario')
  await abrirMeusDados(page)
  const formulario = page.getByRole('region', {
    name: 'Fazer um pedido sobre os meus dados',
  })
  await expect(formulario).toBeVisible({ timeout: 30_000 })
  const enviar = formulario.getByRole('button', { name: 'Enviar o pedido' })
  await enviar.click()
  await expect(formulario.getByRole('alert')).toHaveText(
    'Escolha o que você quer pedir.',
  )
  await formulario
    .getByLabel('O que você quer pedir')
    .selectOption({ label: 'Acessar os dados que a associação tem sobre mim' })
  await formulario.getByLabel('Explique o seu pedido').fill(MENSAGEM)
  await formulario.getByText(/Ler o aviso de privacidade/).click()
  await formulario
    .getByRole('checkbox', { name: 'Li o aviso de privacidade' })
    .check()
  await ver(page, info, 'pedido-pelo-painel-preenchido')
  await enviar.click()
  const recebido = formulario.getByRole('status')
  await expect(recebido).toContainText('recebido. Prazo de resposta: até', {
    timeout: 30_000,
  })
  await expect(recebido).toContainText('a equipe vai conferir a sua identidade')
  protocolo = (await recebido.textContent())!.match(/ASAF-\d{4}-\d+/)![0]
  await expect(
    page
      .getByRole('region', { name: 'Meus pedidos sobre dados pessoais' })
      .locator(`[data-meu-pedido="${protocolo}"]`),
  ).toContainText('Acessar os dados')
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('o Presidente confere a identidade e libera o relatório do pedido feito pelo painel', async ({
  page,
}, info) => {
  expect(protocolo).not.toBe('')
  const token = await entrarComToken(page, 'presidente')
  await page.goto('/atendimentos?situacao=todas')
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  const cartao = page.getByRole('listitem', {
    name: `Atendimento ${protocolo}`,
  })
  await cartao.getByRole('button', { name: 'Abrir' }).click()
  await expect(cartao).toContainText(MENSAGEM, { timeout: 30_000 })
  await cartao
    .getByLabel('O que você conferiu')
    .fill(
      'A secretária fez o pedido pelo próprio painel; conferi com ela pessoalmente (robô).',
    )
  await cartao.getByRole('button', { name: 'Validar identidade' }).click()
  await expect(
    cartao.getByRole('region', { name: 'Identidade de quem pediu' }),
  ).toHaveAttribute('data-identidade', 'validada')
  const entrega = cartao.getByRole('region', {
    name: 'Entregar o relatório pela Minha conta',
  })
  await expect(entrega).toContainText(
    'no painel (Meu perfil > Meus dados pessoais)',
  )
  await entrega
    .getByRole('link', { name: 'Conferir e liberar o relatório' })
    .click()
  const relatorio = page.getByRole('article', { name: 'Relatório dos dados' })
  await expect(relatorio).toContainText(protocolo, { timeout: 30_000 })
  const liberacao = relatorio.getByRole('region', {
    name: 'Liberar este relatório na Minha conta',
  })
  await liberacao
    .getByRole('checkbox', {
      name: 'Conferi o relatório: não há nele dado de outra pessoa',
    })
    .check()
  await liberacao
    .getByRole('button', { name: 'Liberar na Minha conta por 15 dias' })
    .click()
  await expect(liberacao.getByRole('status')).toContainText('Liberado')
  await ver(page, info, 'pedido-pelo-painel-liberado')

  const r = await page.request.get(
    `${API_HML}/api/atendimentos/?busca=${encodeURIComponent(protocolo)}`,
    { headers: { Authorization: token } },
  )
  const { itens } = (await r.json()) as {
    itens: { id_atendimento: number; protocolo: string }[]
  }
  const id = itens.find((a) => a.protocolo === protocolo)!.id_atendimento
  const auditoria = await page.request.get(
    `${API_HML}/api/auditoria/?acao=ATENDIMENTO_PELO_PAINEL&por_pagina=20`,
    { headers: { Authorization: token } },
  )
  const { entradas } = (await auditoria.json()) as {
    entradas: { id_registro_afetado: number; id_usuario: number | null }[]
  }
  expect(
    entradas.find((e) => e.id_registro_afetado === id)?.id_usuario,
    'a Auditoria guarda quem pediu',
  ).toBeTruthy()
})

test('a Secretária baixa o relatório pelo próprio painel', async ({
  page,
}, info) => {
  expect(protocolo).not.toBe('')
  await entrarComToken(page, 'secretario')
  await abrirMeusDados(page)
  const pedido = page.locator(`[data-meu-pedido="${protocolo}"]`)
  await expect(pedido.locator('[data-meu-relatorio]')).toBeVisible({
    timeout: 30_000,
  })
  await ver(page, info, 'meus-dados-com-o-relatorio')
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    pedido.getByRole('button', { name: 'Baixar o relatório (PDF)' }).click(),
  ])
  expect(pdf.suggestedFilename()).toBe(`meus-dados-asaf-${protocolo}.pdf`)
})
