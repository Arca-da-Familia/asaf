import { randomBytes } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// ESQUECI A MINHA SENHA (pedido do Presidente em 21/10). Pelas telas, com o associado que o v6.2d-01 aprovou e a quem deu acesso (o mais novo "Experiencia Encerrada Robo"):
//  1. na tela de entrar, "Esqueci a minha senha" → CPF → o código (a homologação não tem servidor de e-mail: o servidor devolve o código e a tela o mostra); código errado é
//     recusado; com o certo a pessoa escolhe a senha nova e entra com ela (sem cair na troca obrigatória);
//  2. o mesmo código não serve de novo; um CPF sem acesso recebe exatamente a mesma resposta (ninguém descobre quem tem conta); a Auditoria guarda a troca.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const PREFIXO = 'Experiencia Encerrada Robo '
const SENHA_NOVA = `Hml-${randomBytes(9).toString('base64url')}`
let cpfDoRobo = ''
let idUsuario = 0
let codigoUsado = ''

async function comToken(page: Page): Promise<() => string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  return () => autorizacao
}

test('esqueci a minha senha: o código pela tela troca a senha e a pessoa entra com a nova', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const associados = (await (
    await page.request.get(`${API_HML}/api/associados/`, {
      headers: { Authorization: token() },
    })
  ).json()) as Array<{
    id_associado: number
    nome_completo: string
    tem_acesso: boolean
    id_usuario?: number | null
  }>
  const doRobo = associados
    .filter((a) => a.nome_completo.startsWith(PREFIXO) && a.tem_acesso)
    .sort((a, b) => b.id_associado - a.id_associado)[0]
  expect(
    doRobo,
    'o associado com acesso criado pelo v6.2d-01 (rode-o antes)',
  ).toBeTruthy()
  // v7.3a: a lista traz o CPF escondido; o Presidente o vê inteiro por "Mostrar o CPF" (registrado na Auditoria)
  const revelado = await page.request.post(`${API_HML}/api/cpf/revelar`, {
    headers: { Authorization: token() },
    data: { origem: 'associado', id: doRobo!.id_associado },
  })
  expect(revelado.status(), await revelado.text()).toBe(200)
  cpfDoRobo = ((await revelado.json()) as { cpf: string }).cpf.replace(
    /\D/g,
    '',
  )
  await sair(page)

  await page.getByRole('link', { name: 'Esqueci a minha senha' }).click()
  await expect(
    page.getByRole('heading', { name: 'Esqueci a minha senha' }),
  ).toBeVisible()
  await page.getByLabel('CPF').fill(cpfDoRobo)
  const resposta = page.waitForResponse((r) =>
    r.url().endsWith('/auth/senha/esqueci'),
  )
  await page.getByRole('button', { name: 'Enviar o código' }).click()
  const corpo = (await (await resposta).json()) as {
    mensagem: string
    codigo_de_teste?: string
  }
  expect(corpo.codigo_de_teste, 'a homologação devolve o código').toMatch(
    /^\d{6}$/,
  )
  codigoUsado = corpo.codigo_de_teste!
  await expect(page.getByTestId('codigo-de-teste')).toHaveText(codigoUsado)
  await ver(page, info, 'o codigo foi pedido')

  // código errado: recusado
  const errado = codigoUsado === '000000' ? '111111' : '000000'
  await page.getByLabel('Código recebido por e-mail').fill(errado)
  await page.getByLabel('Senha nova', { exact: true }).fill(SENHA_NOVA)
  await page.getByLabel('Repita a senha nova').fill(SENHA_NOVA)
  await page.getByRole('button', { name: 'Trocar a senha' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Código inválido ou vencido',
  )
  await ver(page, info, 'codigo errado recusado')

  await page.getByLabel('Código recebido por e-mail').fill(codigoUsado)
  await page.getByRole('button', { name: 'Trocar a senha' }).click()
  // a faixa de "ambiente de teste" também é um aviso (role=status): procura o da troca pelo texto
  await expect(
    page.getByRole('status').filter({ hasText: 'Senha trocada.' }),
  ).toBeVisible()
  await ver(page, info, 'senha trocada')

  await page.getByRole('link', { name: 'Voltar para entrar' }).click()
  await test.step(
    'entra com a senha nova',
    async () => {
      await page.getByLabel('CPF').fill(cpfDoRobo)
      await page.getByLabel('Senha').fill(SENHA_NOVA)
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
    },
    { box: true },
  )
  idUsuario = (
    (await (
      await page.request.get(`${API_HML}/auth/me`, {
        headers: { Authorization: token() },
      })
    ).json()) as { id_usuario: number; senha_provisoria?: boolean }
  ).id_usuario
  expect(idUsuario).toBeGreaterThan(0)
  await ver(page, info, 'entrou com a senha nova')
  expect(vigia.problemas()).toEqual([])
})

test('o mesmo código não serve de novo, CPF sem acesso recebe a mesma resposta e a Auditoria guarda a troca', async ({
  page,
}) => {
  expect(codigoUsado, 'o teste anterior').not.toBe('')
  const deNovo = await page.request.post(
    `${API_HML}/auth/senha/trocar-com-codigo`,
    {
      data: {
        cpf: cpfDoRobo,
        codigo: codigoUsado,
        senha_nova: `${SENHA_NOVA}x`,
      },
    },
  )
  expect(deNovo.status()).toBe(400)

  // um CPF válido que ninguém usa: a resposta é a mesma (sem o código, que só existe para quem tem conta)
  const semConta = await page.request.post(`${API_HML}/auth/senha/esqueci`, {
    data: { cpf: cpfValido(900000000 + (RODADA % 90000000)) },
  })
  expect(semConta.status()).toBe(200)
  const corpo = (await semConta.json()) as Record<string, unknown>
  expect(Object.keys(corpo).sort()).toEqual(['mensagem', 'minutos_de_validade'])

  const token = await comToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const { entradas } = (await (
    await page.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=usuarios&acao=SENHA_TROCADA_PELO_CODIGO&por_pagina=50`,
      { headers: { Authorization: token() } },
    )
  ).json()) as {
    entradas: Array<{
      id_registro_afetado: number
      dados_depois: string | null
    }>
  }
  const daTroca = entradas.find((e) => e.id_registro_afetado === idUsuario)
  expect(daTroca, 'a troca pelo código na Auditoria').toBeTruthy()
  expect(String(daTroca!.dados_depois ?? '')).not.toContain('@')
})
