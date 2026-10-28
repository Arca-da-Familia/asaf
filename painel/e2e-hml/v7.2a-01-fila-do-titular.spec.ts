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
  vigiar,
} from './apoio'

// v7.2a - A FILA DA SOLICITAÇÃO DO TITULAR COMPLETA (decisões do Presidente, 2026-10-28):
//  1. o site oferece os dois direitos que faltavam (consequência de não consentir; oposição);
//  2. a confirmação simples sai NA HORA quando a identidade nasce validada (o e-mail do cadastro de associado);
//  3. pelo painel: validar a identidade marcando que quem pediu é o responsável; responder exige o resultado e, se não atendido por inteiro, o fundamento
//     escolhido da lista; o cartão mostra o resultado e o fundamento; a Auditoria guarda.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const SITE = 'https://hml-site.asaf.org.br'
const VERSAO_DO_AVISO = (textos as Record<string, { versao: string }>)
  .ATENDIMENTO_TITULAR!.versao
let ipDaVez = 0
const novoIp = () => `10.72.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`
const NOME = `Associada Titular ${RODADA}`
const CPF = cpfValido((RODADA + 72) % 999_999_999)
const EMAIL = `titular.v72a.${RODADA}@homologacao.example.com`

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

async function pedir(
  page: Page,
  corpo: Record<string, unknown>,
): Promise<string> {
  const r = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    headers: { 'X-Forwarded-For': novoIp() },
    data: {
      tipo: 'TITULAR_LGPD',
      mensagem: 'Pedido de teste do robô da v7.2a sobre os meus dados.',
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO,
      ...corpo,
    },
  })
  expect(r.status(), await r.text()).toBe(200)
  return ((await r.json()) as { protocolo: string }).protocolo
}

type Pedido = {
  id_atendimento: number
  protocolo: string
  status: string
  resposta: string | null
  resultado: string | null
}

async function daFila(
  page: Page,
  token: string,
  protocolo: string,
): Promise<Pedido> {
  const r = await page.request.get(
    `${API_HML}/api/atendimentos/?busca=${encodeURIComponent(protocolo)}`,
    {
      headers: { Authorization: token },
    },
  )
  expect(r.status()).toBe(200)
  const { itens } = (await r.json()) as { itens: Pedido[] }
  return itens.find((a) => a.protocolo === protocolo)!
}

test('o site oferece os dois direitos novos', async ({ page }, info) => {
  await page.goto(`${SITE}/privacidade/solicitacao-do-titular/`)
  const lista = page.locator('main ul').first()
  await expect(lista).toContainText(
    'Saber o que acontece se eu não der (ou retirar) o consentimento',
  )
  await expect(lista).toContainText(
    'Me opor a um uso dos meus dados que não depende do meu consentimento',
  )
  await ver(page, info, 'site-com-os-direitos-novos')
})

test('a confirmação simples sai na hora para quem tem a identidade validada pelo cadastro', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await entrarComToken(page)
  await cadastrarPelaTela(page, { nome: NOME, cpf: CPF, email: EMAIL })
  const protocolo = await pedir(page, {
    subtipo: 'CONFIRMACAO',
    nome_completo: NOME,
    cpf: CPF.replace(/\D/g, ''),
    email_contato: EMAIL,
  })
  const a = await daFila(page, token, protocolo)
  expect(a.status).toBe('Respondido')
  expect(a.resultado).toBe('ATENDIDO')
  expect(a.resposta).toMatch(/^Sim\. A ASAF trata dados pessoais seus/)
  await page.goto('/atendimentos?situacao=todas')
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  const cartao = page.getByRole('listitem', {
    name: `Atendimento ${protocolo}`,
  })
  await cartao.getByRole('button', { name: 'Abrir' }).click()
  await expect(cartao.locator('[data-resultado]')).toContainText('Atendido')
  await expect(
    cartao.getByRole('link', { name: 'Abrir a ficha do associado' }),
  ).toBeVisible()
  await ver(page, info, 'confirmacao-na-hora')
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('pelo painel: o responsável marcado, o resultado e o fundamento escolhidos da lista', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await entrarComToken(page)
  const protocolo = await pedir(page, {
    subtipo: 'ELIMINACAO',
    nome_completo: `Mae de Teste ${RODADA}`,
    cpf: cpfValido((RODADA + 73) % 999_999_999).replace(/\D/g, ''),
    email_contato: `mae.v72a.${RODADA}@homologacao.example.com`,
  })
  const { id_atendimento } = await daFila(page, token, protocolo)
  await page.goto('/atendimentos?situacao=todas')
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  const painel = page.getByRole('listitem', {
    name: `Atendimento ${protocolo}`,
  })
  await expect(painel).toBeVisible()
  await painel.getByRole('button', { name: 'Abrir' }).click()
  await expect(painel.getByLabel('O que você conferiu')).toBeVisible({
    timeout: 30_000,
  })
  await painel
    .getByLabel('O que você conferiu')
    .fill('A mãe mostrou a certidão de nascimento do filho (teste do robô).')
  await painel
    .getByLabel(/Quem pediu é um dos pais ou o responsável legal/)
    .check()
  await painel.getByRole('button', { name: 'Validar identidade' }).click()
  await expect(painel.locator('[data-por-representante]')).toBeVisible()

  await painel
    .getByLabel('Resposta')
    .fill(
      'O seu filho ainda é atendido no projeto: os registros ficam enquanto durar o vínculo.',
    )
  await painel.getByRole('button', { name: 'Registrar resposta' }).click()
  await expect(painel.getByRole('alert').first()).toContainText(
    'Diga o resultado do pedido',
  )
  await painel.getByLabel('Resultado').selectOption('NEGADO')
  await painel.getByRole('button', { name: 'Registrar resposta' }).click()
  await expect(painel.getByRole('alert').first()).toContainText(
    'Escolha o fundamento',
  )
  await painel.getByLabel('Fundamento').selectOption('OUTRO')
  await ver(page, info, 'resposta-com-resultado-e-fundamento')
  await painel.getByRole('button', { name: 'Registrar resposta' }).click()
  await expect(painel.locator('[data-resultado]')).toContainText(
    'Não atendido, com o fundamento',
  )
  await expect(painel.locator('[data-resultado]')).toContainText(
    'Outro motivo, explicado na resposta.',
  )
  await ver(page, info, 'cartao-com-o-resultado')

  // a Minha conta (entrando com o e-mail do pedido e o código que a API de teste devolve) mostra o resultado e o fundamento
  const emailDaMae = `mae.v72a.${RODADA}@homologacao.example.com`
  const pedidoDoCodigo = await page.request.post(
    `${API_HML}/api/publico/visitante/codigo`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: { email: emailDaMae },
    },
  )
  expect(pedidoDoCodigo.status(), await pedidoDoCodigo.text()).toBe(200)
  const { codigo_de_teste: codigo } = (await pedidoDoCodigo.json()) as {
    codigo_de_teste?: string
  }
  const entrada = await page.request.post(
    `${API_HML}/api/publico/visitante/entrar`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: { email: emailDaMae, codigo },
    },
  )
  expect(entrada.status(), await entrada.text()).toBe(200)
  const { token: tokenDaMae } = (await entrada.json()) as { token: string }
  const minhaConta = await page.request.get(
    `${API_HML}/api/visitante/minha-conta`,
    {
      headers: { Authorization: `Bearer ${tokenDaMae}` },
    },
  )
  const { pedidos_do_titular: pedidos } = (await minhaConta.json()) as {
    pedidos_do_titular: {
      protocolo: string
      resultado: string | null
      fundamento: string | null
    }[]
  }
  expect(pedidos.find((x) => x.protocolo === protocolo)).toMatchObject({
    resultado: 'Não atendido, com o fundamento',
    fundamento: 'Outro motivo, explicado na resposta.',
  })

  const auditoria = await page.request.get(
    `${API_HML}/api/auditoria/?acao=ATENDIMENTO_RESPONDIDO&tabela_afetada=atendimentos&por_pagina=20`,
    {
      headers: { Authorization: token },
    },
  )
  const { entradas } = (await auditoria.json()) as {
    entradas: { id_registro_afetado: number; dados_depois: string | null }[]
  }
  const minha = entradas.find((e) => e.id_registro_afetado === id_atendimento)
  expect(minha?.dados_depois).toContain('"resultado": "NEGADO"')
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})
