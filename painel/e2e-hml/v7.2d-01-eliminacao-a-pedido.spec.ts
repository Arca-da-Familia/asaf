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

// v7.2d - A ELIMINAÇÃO A PEDIDO (decisões do Presidente de 28/10 e 29/10, A a G). Pela tela, como o Presidente:
//  1. uma pessoa (só pelo site) tem um pedido antigo e pede a eliminação pela Minha conta (a identidade é só o código do e-mail): a prévia mostra o pedido antigo
//     saindo e este pedido ficando como prova; "conferi" e eliminar; o pedido antigo perde o texto; a Auditoria guarda o protocolo; o resultado sugerido vai para a
//     resposta;
//  2. uma associada ATIVA pede a eliminação: a prévia diz que o cadastro fica pelo vínculo e não há nada a eliminar (o botão não age); o Tesoureiro (sem a
//     permissão do encarregado) não abre a prévia.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const VERSAO_DO_AVISO = (textos as Record<string, { versao: string }>)
  .ATENDIMENTO_TITULAR!.versao
let ipDaVez = 0
const novoIp = () => `10.74.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`
const EMAIL_DO_SITE = `eliminacao.v72d.${RODADA}@homologacao.example.com`
const NOME_ASSOCIADA = `Associada Que Pede Eliminacao ${RODADA}`
const CPF_ASSOCIADA = cpfValido((RODADA + 76) % 999_999_999)
const EMAIL_ASSOCIADA = `ativa.v72d.${RODADA}@homologacao.example.com`

async function entrarComToken(
  page: Page,
  papel: Parameters<typeof entrar>[1] = 'presidente',
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

async function pedirPeloSite(
  page: Page,
  dados: Record<string, unknown>,
): Promise<string> {
  const r = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    headers: { 'X-Forwarded-For': novoIp() },
    data: {
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO,
      ...dados,
    },
  })
  expect(r.status(), await r.text()).toBe(200)
  return ((await r.json()) as { protocolo: string }).protocolo
}

async function idDoPedido(
  page: Page,
  token: string,
  protocolo: string,
): Promise<number> {
  const r = await page.request.get(
    `${API_HML}/api/atendimentos/?busca=${encodeURIComponent(protocolo)}`,
    { headers: { Authorization: token } },
  )
  const { itens } = (await r.json()) as {
    itens: { id_atendimento: number; protocolo: string }[]
  }
  return itens.find((a) => a.protocolo === protocolo)!.id_atendimento
}

async function abrirNoPainel(page: Page, protocolo: string) {
  await page.goto('/atendimentos?situacao=todas')
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  const cartao = page.getByRole('listitem', {
    name: `Atendimento ${protocolo}`,
  })
  await cartao.getByRole('button', { name: 'Abrir' }).click()
  return cartao
}

test('pedido pela Minha conta: a prévia, "conferi" e a eliminação do que foi feito com o e-mail', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await entrarComToken(page)
  // um pedido antigo, já encerrado, e um pedido do titular (que abre a Minha conta)
  const antigo = await pedirPeloSite(page, {
    tipo: 'CONTATO',
    assunto: 'Pergunta antiga',
    mensagem: `Mensagem antiga do robô da v7.2d com dado pessoal ${RODADA}.`,
    nome_completo: `Pessoa Do Site ${RODADA}`,
    email_contato: EMAIL_DO_SITE,
  })
  const idAntigo = await idDoPedido(page, token, antigo)
  const encerrou = await page.request.post(
    `${API_HML}/api/atendimentos/${idAntigo}/encerrar`,
    {
      headers: { Authorization: token },
      data: { motivo: 'Respondido por telefone (robô da v7.2d).' },
    },
  )
  expect(encerrou.status(), await encerrou.text()).toBe(200)
  await pedirPeloSite(page, {
    tipo: 'TITULAR_LGPD',
    subtipo: 'CONFIRMACAO',
    mensagem: 'Vocês têm dados meus? (robô da v7.2d)',
    nome_completo: `Pessoa Do Site ${RODADA}`,
    cpf: cpfValido((RODADA + 77) % 999_999_999).replace(/\D/g, ''),
    email_contato: EMAIL_DO_SITE,
  })

  // a pessoa entra na Minha conta (o código vem na resposta da API de teste) e pede a eliminação
  const codigo = await page.request.post(
    `${API_HML}/api/publico/visitante/codigo`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: { email: EMAIL_DO_SITE },
    },
  )
  const { codigo_de_teste } = (await codigo.json()) as {
    codigo_de_teste?: string
  }
  const entrada = await page.request.post(
    `${API_HML}/api/publico/visitante/entrar`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: { email: EMAIL_DO_SITE, codigo: codigo_de_teste },
    },
  )
  expect(entrada.status(), await entrada.text()).toBe(200)
  const { token: sessao } = (await entrada.json()) as { token: string }
  const pedido = await page.request.post(
    `${API_HML}/api/visitante/pedir-apagamento`,
    {
      headers: {
        Authorization: `Bearer ${sessao}`,
        'X-Forwarded-For': novoIp(),
      },
    },
  )
  expect(pedido.status(), await pedido.text()).toBe(200)
  const { protocolo } = (await pedido.json()) as { protocolo: string }
  const idPedido = await idDoPedido(page, token, protocolo)

  const cartao = await abrirNoPainel(page, protocolo)
  const bloco = cartao.getByRole('region', { name: 'Eliminar a pedido' })
  await expect(bloco).toBeVisible({ timeout: 30_000 })
  await bloco
    .getByRole('button', { name: 'Ver o que sai e o que fica' })
    .click()
  await expect(bloco.locator('[data-sai]')).toContainText(
    'pedido(s) antigo(s) feito(s) pelo site',
    { timeout: 30_000 },
  )
  await expect(bloco.locator('[data-fica]')).toContainText(
    'Este pedido de eliminação',
  )
  const eliminar = bloco.getByRole('button', {
    name: 'Eliminar o que pode sair',
  })
  await expect(eliminar, 'só elimina depois de conferir').toBeDisabled()
  await ver(page, info, 'previa-da-eliminacao')
  await bloco
    .getByRole('checkbox', {
      name: 'Conferi o que sai e o que fica: a eliminação não tem volta',
    })
    .check()
  await eliminar.click()
  await expect(bloco.getByRole('status')).toContainText('Eliminado', {
    timeout: 30_000,
  })
  await expect(cartao.getByLabel('Resultado')).toHaveValue('ATENDIDO_EM_PARTE')
  await ver(page, info, 'eliminacao-feita')

  const antigoAgora = await page.request.get(
    `${API_HML}/api/atendimentos/${idAntigo}`,
    { headers: { Authorization: token } },
  )
  const corpo = (await antigoAgora.json()) as {
    mensagem: string
    email_contato: string | null
  }
  expect(corpo.mensagem).toBe('(apagado a pedido do titular)')
  expect(corpo.email_contato).toBeNull()

  const auditoria = await page.request.get(
    `${API_HML}/api/auditoria/?acao=ELIMINACAO_A_PEDIDO&por_pagina=20`,
    { headers: { Authorization: token } },
  )
  const { entradas } = (await auditoria.json()) as {
    entradas: { id_registro_afetado: number; dados_depois: string | null }[]
  }
  const minha = entradas.find((e) => e.id_registro_afetado === idPedido)
  expect(minha, 'a eliminação ficou na Auditoria').toBeDefined()
  expect(minha!.dados_depois).toContain(protocolo)
  expect(minha!.dados_depois).not.toContain('Mensagem antiga')
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('associada ativa: o cadastro fica pelo vínculo e nada sai; o Tesoureiro não abre a prévia', async ({
  page,
}, info) => {
  const token = await entrarComToken(page)
  await cadastrarPelaTela(page, {
    nome: NOME_ASSOCIADA,
    cpf: CPF_ASSOCIADA,
    email: EMAIL_ASSOCIADA,
  })
  const protocolo = await pedirPeloSite(page, {
    tipo: 'TITULAR_LGPD',
    subtipo: 'ELIMINACAO',
    mensagem: 'Quero que apaguem os meus dados (robô da v7.2d).',
    nome_completo: NOME_ASSOCIADA,
    cpf: CPF_ASSOCIADA.replace(/\D/g, ''),
    email_contato: EMAIL_ASSOCIADA,
  })
  const idPedido = await idDoPedido(page, token, protocolo)
  const cartao = await abrirNoPainel(page, protocolo)
  const bloco = cartao.getByRole('region', { name: 'Eliminar a pedido' })
  await bloco
    .getByRole('button', { name: 'Ver o que sai e o que fica' })
    .click()
  await expect(bloco.locator('[data-vinculos]')).toContainText(
    'está no quadro de associados',
    {
      timeout: 30_000,
    },
  )
  await expect(bloco.locator('[data-sai]')).toContainText(
    'Nada pode sair agora',
  )
  await bloco
    .getByRole('checkbox', {
      name: 'Conferi o que sai e o que fica: a eliminação não tem volta',
    })
    .check()
  await expect(
    bloco.getByRole('button', { name: 'Eliminar o que pode sair' }),
  ).toBeDisabled()
  await ver(page, info, 'associada-ativa-fica')

  const tesoureiro = await entrarComToken(page, 'tesoureiro')
  const r = await page.request.get(
    `${API_HML}/api/privacidade/titulares/eliminacoes/${idPedido}`,
    { headers: { Authorization: tesoureiro } },
  )
  expect(r.status()).toBe(403)
})
