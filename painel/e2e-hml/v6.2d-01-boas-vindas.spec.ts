import { randomBytes } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
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

// v6.2d - OS AUTOMÁTICOS (parte 1). Pelas telas:
//  1. um candidato pede a filiação (pela rota pública que o site usa), o Presidente confere, três sócios propõem e o Presidente aprova: a Auditoria guarda as boas-vindas
//     (a homologação não tem servidor de e-mail, então o registro diz "sem servidor de e-mail"; o envio em si é provado pelos testes do servidor);
//  2. o Presidente libera o acesso do novo associado ao painel; ele entra pela primeira vez com a senha provisória e o painel o OBRIGA a trocá-la (a correção do achado
//     da v6.2d: nenhuma tela abre antes; a senha atual errada é recusada pelo servidor); trocada, o painel abre e o sino diz "Bem-vindo(a) ao painel da ASAF".
// A parte 2 (v6.2d-02) roda depois de uma nova publicação da homologação: ali (e só ali) os "90 dias" do candidato passam e a rotina do fim da experiência roda.
test.describe.configure({ mode: 'serial' })
// a tela "Conceder acesso" mostra a senha provisória em texto (é para a secretaria entregar ao associado): sem vídeo e sem o print automático neste roteiro, para ela nunca
// ir parar num arquivo de resultado; os prints de `ver` são tirados só nas telas sem a senha
test.use({ video: 'off', screenshot: 'off' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const CANDIDATO = {
  // o roteiro da homologação reconhece o candidato do robô por este começo de nome (e pelo e-mail de teste)
  nome_completo: `Experiencia Encerrada Robo ${RODADA} de Teste`,
  cpf: cpfValido(800000000 + (RODADA % 90000000)).replace(/\D/g, ''),
  email_contato: `fimexp.${RODADA}@homologacao.example.com`,
  telefone_whatsapp: '91944443333',
}
// senha provisória só desta rodada, inventada aqui: nunca é impressa, fotografada nem filmada (ver acima)
const SENHA_PROVISORIA = `Hml-${randomBytes(9).toString('base64url')}`
const SENHA_DEFINITIVA = `Hml-${randomBytes(9).toString('base64url')}`
let idAssociado = 0

async function comToken(page: Page): Promise<() => string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  return () => autorizacao
}

test('aprovar a filiação registra as boas-vindas na Auditoria', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const pedido = await page.request.post(`${API_HML}/api/filiacao/propor`, {
    data: { ...PEDIDO_PUBLICO, ...CANDIDATO },
  })
  expect(pedido.status(), await pedido.text()).toBe(200)

  await entrar(page, 'presidente')
  await page.goto('/associados/propostas')
  const item = page.getByRole('listitem', {
    name: `Proposta de ${CANDIDATO.nome_completo}`,
  })
  await item
    .getByRole('button', { name: 'Marcar documentação conferida' })
    .click()
  await expect(item.getByText('Em Conferência', { exact: true })).toBeVisible()
  await sair(page)
  for (const papel of [
    'secretario',
    'tesoureiro',
    'vice_presidente',
  ] as const) {
    await socioPropoe(page, papel, [CANDIDATO.nome_completo])
  }

  const token = await comToken(page)
  await entrar(page, 'presidente')
  await page.goto('/associados/propostas')
  const liberado = page.getByRole('listitem', {
    name: `Proposta de ${CANDIDATO.nome_completo}`,
  })
  await liberado.getByRole('button', { name: 'Aprovar e efetivar' }).click()
  await liberado.getByRole('button', { name: 'Efetivar associado' }).click()
  await expect(liberado.getByText('Aprovada', { exact: true })).toBeVisible()
  await ver(page, info, 'filiacao aprovada')
  await liberado
    .getByRole('link', { name: 'Abrir o cadastro do associado' })
    .click()
  await expect(page).toHaveURL(/\/associados\/\d+$/)
  idAssociado = Number(page.url().match(/\/associados\/(\d+)$/)![1])
  await page.getByRole('button', { name: 'Situação', exact: true }).click()
  await expect(page.getByTestId('situacao-atual')).toHaveText('Em Experiência')

  // a Auditoria: as boas-vindas do novo associado, com o resultado e sem o endereço
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const { entradas } = (await (
    await page.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=associados&acao=BOAS_VINDAS_ENVIADAS&por_pagina=50`,
      { headers: { Authorization: token() } },
    )
  ).json()) as {
    entradas: Array<{ id_registro_afetado: number; dados_depois: string }>
  }
  const meu = entradas.find((e) => e.id_registro_afetado === idAssociado)
  expect(meu, 'as boas-vindas na Auditoria').toBeTruthy()
  const dados = String(meu!.dados_depois)
  expect(dados).toContain('sem_servidor_de_email')
  expect(dados).not.toContain(CANDIDATO.email_contato)

  await page.goto('/auditoria')
  await expect(
    page.getByRole('cell', { name: 'BOAS_VINDAS_ENVIADAS' }).first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria com as boas-vindas')
  expect(vigia.problemas()).toEqual([])
})

test('liberar o acesso: no primeiro login o sino dá as boas-vindas ao painel', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  expect(idAssociado, 'o associado do teste anterior').toBeGreaterThan(0)
  await entrar(page, 'presidente')
  await page.goto(`/associados/${idAssociado}/conceder-acesso`)
  await expect(
    page.getByRole('heading', { name: 'Conceder acesso' }),
  ).toBeVisible()
  await test.step(
    'preencher o e-mail de login e a senha provisória',
    async () => {
      await page
        .locator('input[name="email"]')
        .fill(`login.${CANDIDATO.email_contato}`)
      await page
        .locator('input[name="senha_provisoria"]')
        .fill(SENHA_PROVISORIA)
      await page.getByRole('button', { name: 'Conceder acesso' }).click()
      // a tela seguinte mostra a senha para entregar ao associado: sem print dela
      await expect(
        page.getByRole('heading', { name: 'Acesso concedido' }),
      ).toBeVisible()
    },
    { box: true },
  )
  await page.getByRole('button', { name: 'Voltar para Associados' }).click()
  await sair(page)

  await test.step(
    'o novo associado entra pela primeira vez',
    async () => {
      await page.goto('/login')
      await page.getByLabel('CPF').fill(CANDIDATO.cpf)
      await page.getByLabel('Senha').fill(SENHA_PROVISORIA)
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Troque a sua senha' }),
      ).toBeVisible()
    },
    { box: true },
  )
  await ver(page, info, 'o primeiro login leva a troca da senha')
  // nenhuma tela abre antes da troca: o endereço direto volta para ela
  await page.goto('/perfil')
  await expect(
    page.getByRole('heading', { name: 'Troque a sua senha' }),
  ).toBeVisible()
  await test.step(
    'a senha atual errada é recusada; a certa troca a senha',
    async () => {
      await page.getByLabel('Senha provisória').fill(`${SENHA_PROVISORIA}x`)
      await page
        .getByLabel('Senha nova', { exact: true })
        .fill(SENHA_DEFINITIVA)
      await page.getByLabel('Repita a senha nova').fill(SENHA_DEFINITIVA)
      await page.getByRole('button', { name: 'Trocar a senha' }).click()
      await expect(page.getByRole('alert')).toContainText(
        'Senha atual incorreta.',
      )
      await page.getByLabel('Senha provisória').fill(SENHA_PROVISORIA)
      await page.getByRole('button', { name: 'Trocar a senha' }).click()
      await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
    },
    { box: true },
  )
  await page.getByRole('button', { name: /^Notificações/ }).click()
  const boasVindas = page.getByRole('link', {
    name: 'Bem-vindo(a) ao painel da ASAF',
  })
  await expect(boasVindas).toBeVisible()
  await ver(page, info, 'o sino da boas-vindas')
  await boasVindas.click()
  await expect(page).toHaveURL(/\/meus-avisos$/)
  await ver(page, info, 'o link do sino abre os avisos')
  expect(vigia.problemas()).toEqual([])
})
