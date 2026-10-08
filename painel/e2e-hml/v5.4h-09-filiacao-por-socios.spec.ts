import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  cpfValido,
  entrar,
  exigirHomologacao,
  PEDIDO_PUBLICO,
  RODADA,
  sair,
  socioPropoe,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Filiação de ponta a ponta com a regra do Estatuto (Art. 12, par. único VI: o pedido de adesão tem de ser PROPOSTO por 3 sócios, e passa pela
// análise da Diretoria Executiva). O pedido entra pela MESMA rota pública que o site vai usar (sem login); os sócios aptos são avisados no SINO do painel,
// abrem "Pedidos de filiação" (sem CPF, e-mail nem telefone do candidato), propõem ou recusam (recusar pede o motivo); a Diretoria vê quem propôs e quem
// recusou, confere a documentação e só aprova com os 3; a aprovação efetiva o associado com a matrícula; cada decisão fica na Auditoria.
test.describe.configure({ mode: 'serial' })
test.setTimeout(420_000)

const S = String(RODADA)
const NOME = `Candidato por Sócios ${S} de Teste`
const CPF = cpfValido(700000000 + (RODADA % 200000000)).replace(/\D/g, '')
const EMAIL = `candidato.socios.${S}@homologacao.example.com`
const TELEFONE = '91955551234'
const TABELA = 'propostas_de_socios'
const NASCIMENTO = '1990-05-10'
/** A idade de hoje de quem nasceu em NASCIMENTO (o pedido mostra a idade, calculada no servidor). */
const IDADE = (() => {
  const hoje = new Date()
  const [a, m, d] = NASCIMENTO.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  return (
    hoje.getUTCFullYear() -
    a -
    (hoje.getUTCMonth() + 1 < m ||
    (hoje.getUTCMonth() + 1 === m && hoje.getUTCDate() < d)
      ? 1
      : 0)
  )
})()

let totalAntes = 0

async function totalNaAuditoria(page: Page): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${TABELA}`),
  )
  await campo(page, 'Tabela').fill(TABELA)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

const cartaoDoPedido = (page: Page) =>
  page.getByRole('listitem', { name: `Pedido de ${NOME}` })
const cartaoDaDiretoria = (page: Page) =>
  page.getByRole('listitem', { name: `Proposta de ${NOME}` })

test('o pedido chega pela rota pública e o sócio é avisado no sino, abre o aviso e propõe', async ({
  page,
}, info) => {
  exigirHomologacao()
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  totalAntes = await totalNaAuditoria(page)
  await sair(page)

  const r = await page.request.post(`${API_HML}/api/filiacao/propor`, {
    data: {
      nome_completo: NOME,
      cpf: CPF,
      email_contato: EMAIL,
      telefone_whatsapp: TELEFONE,
      ...PEDIDO_PUBLICO,
      data_nascimento: NASCIMENTO,
    },
  })
  expect(r.status(), await r.text()).toBe(200)

  await entrar(page, 'secretario')
  // o sino mostra que há aviso novo; abrir a lista leva ao pedido
  const sino = page.getByRole('button', {
    name: /^Notificações \(\d+ novas?\)$/,
  })
  await expect(sino).toBeVisible()
  await sino.click()
  const painel = page.getByRole('region', { name: 'Avisos do painel' })
  const aviso = painel.getByRole('listitem').filter({ hasText: NOME })
  await expect(aviso).toContainText('Novo pedido de filiação')
  await ver(page, info, 'sino-com-o-aviso-do-pedido')
  await aviso.getByRole('link', { name: 'Novo pedido de filiação' }).click()

  await expect(
    page.getByRole('heading', { name: 'Pedidos de filiação', level: 1 }),
  ).toBeVisible()
  const cartao = cartaoDoPedido(page)
  await expect(cartao).toContainText(`${IDADE} anos`)
  await expect(cartao).toContainText('0 de 3 sócios já propuseram — faltam 3.')
  // o sócio não vê CPF, e-mail nem telefone do candidato
  await expect(page.getByText(CPF)).toHaveCount(0)
  await expect(page.getByText(EMAIL)).toHaveCount(0)
  await expect(page.getByText(TELEFONE)).toHaveCount(0)
  await cartao.getByRole('button', { name: `Propor ${NOME}` }).click()
  await expect(cartao.getByRole('status')).toContainText(
    'Você propôs este candidato.',
  )
  await expect(cartao).toContainText('1 de 3 sócios já propuseram — faltam 2.')
  await ver(page, info, 'socio-propos-o-candidato')
  // por um endereço novo: a decisão veio do servidor
  await page.reload()
  await expect(cartaoDoPedido(page).getByRole('status')).toContainText(
    'Você propôs este candidato.',
  )
  expect(vigia.problemas()).toEqual([])
})

test('um segundo sócio propõe e um terceiro recusa, com o motivo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await page.goto('/filiacao/para-propor')
  await cartaoDoPedido(page)
    .getByRole('button', { name: `Propor ${NOME}` })
    .click()
  await expect(cartaoDoPedido(page)).toContainText(
    '2 de 3 sócios já propuseram — faltam 1.',
  )
  await sair(page)

  await entrar(page, 'vice_presidente_2')
  await page.goto('/filiacao/para-propor')
  const cartao = cartaoDoPedido(page)
  await cartao.getByRole('button', { name: `Recusar ${NOME}` }).click()
  const confirmar = cartao.getByRole('button', { name: 'Confirmar recusa' })
  await expect(confirmar).toBeDisabled()
  await cartao.getByLabel(/Motivo da recusa/).fill('não')
  await expect(confirmar).toBeDisabled()
  await cartao
    .getByLabel(/Motivo da recusa/)
    .fill('Não conheço a família do candidato.')
  await confirmar.click()
  await expect(cartao.getByRole('status')).toContainText(
    'Você recusou este candidato: “Não conheço a família do candidato.”.',
  )
  // quem recusa não conta para os 3
  await expect(cartao).toContainText('2 de 3 sócios já propuseram — faltam 1.')
  await ver(page, info, 'socio-recusou-com-o-motivo')
  expect(vigia.problemas()).toEqual([])
})

test('a Diretoria vê quem propôs e quem recusou, confere a documentação e não aprova com só 2 sócios', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados/propostas')
  const cartao = cartaoDaDiretoria(page)
  await expect(cartao).toContainText('Sócios que propõem: 2 de 3 — faltam 1.')
  const lista = cartao.getByRole('list', {
    name: `Sócios sobre o pedido de ${NOME}`,
  })
  await expect(lista).toContainText('Propõe')
  await expect(lista).toContainText(
    'Recusa — “Não conheço a família do candidato.”',
  )
  // a Diretoria vê os dados do candidato (CPF, e-mail e telefone são dela)
  await expect(cartao).toContainText(EMAIL)
  await cartao
    .getByRole('button', { name: 'Marcar documentação conferida' })
    .click()
  await expect(
    cartao.getByText('Em Conferência', { exact: true }),
  ).toBeVisible()
  await expect(
    cartao.getByRole('button', { name: 'Aprovar e efetivar' }),
  ).toBeDisabled()
  await ver(page, info, 'diretoria-ve-2-de-3-e-nao-aprova')
  expect(vigia.problemas()).toEqual([])
})

test('o terceiro sócio propõe e a Diretoria aprova: o associado entra com a matrícula', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await socioPropoe(page, 'vice_presidente', [NOME])

  await entrar(page, 'presidente')
  await page.goto('/associados/propostas')
  const cartao = cartaoDaDiretoria(page)
  await expect(cartao).toContainText('Sócios que propõem: 3 de 3')
  await cartao.getByRole('button', { name: 'Aprovar e efetivar' }).click()
  await cartao.getByRole('button', { name: 'Efetivar associado' }).click()
  await expect(cartao.getByText('Aprovada', { exact: true })).toBeVisible()
  await expect(cartao.getByRole('status')).toContainText('Matrícula')
  await ver(page, info, 'diretoria-aprovou-com-os-3-socios')
  await cartao
    .getByRole('link', { name: 'Abrir o cadastro do associado' })
    .click()
  await expect(page).toHaveURL(/\/associados\/\d+$/)
  await expect(page.getByRole('heading', { name: NOME })).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('o pedido decidido sai da lista dos sócios e a Auditoria guarda as 4 decisões dos sócios', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  await page.goto('/filiacao/para-propor')
  await expect(
    page.getByRole('heading', { name: 'Pedidos de filiação', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await expect(cartaoDoPedido(page)).toHaveCount(0)
  await sair(page)

  await entrar(page, 'presidente')
  const total = await totalNaAuditoria(page)
  expect(total - totalAntes, '3 propostas e 1 recusa de sócios').toBe(4)
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('cell', { name: 'PROPOSTA_DO_SOCIO', exact: true }),
    }),
  ).not.toHaveCount(0)
  await ver(page, info, 'auditoria-das-decisoes-dos-socios')
  expect(vigia.problemas()).toEqual([])
})
