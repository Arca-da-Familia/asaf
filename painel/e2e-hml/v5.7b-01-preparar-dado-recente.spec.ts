import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.7b - a ROTINA DE RETENÇÃO (LGPD): os prazos de guarda de dado pessoal viraram regras editáveis e uma rotina aplica o que JÁ venceu. Este roteiro PREPARA dado recente (um pedido da fila de atendimento e
// um pedido de doação pelo site, com nome de teste) e confere que as seis regras novas estão em "Regras do sistema" com o padrão da Tabela de temporalidade. A publicação de teste que vem depois roda a
// rotina contra o banco de TESTE; o v5.7b-02 prova que o dado recente seguiu INTACTO (a rotina só mexe no que passou do prazo; dado velho de verdade não dá para fabricar na homologação).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

let autorizacao = ''
let ipDaVez = 0
const cabecalho = () => ({ Authorization: autorizacao })
const novoIp = () => `10.58.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`

async function entrarComoPresidente(page: Page): Promise<void> {
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
}

const REGRAS = [
  ['PRAZO_RETENCAO_ACESSOS_DIAS', '183'],
  ['PRAZO_RETENCAO_AVISOS_DO_SINO_DIAS', '365'],
  ['PRAZO_RETENCAO_ATENDIMENTOS_DIAS', '1825'],
  ['PRAZO_RETENCAO_PROPOSTAS_DIAS', '730'],
  ['PRAZO_RETENCAO_PEDIDOS_DE_DOACAO_DIAS', '730'],
  ['PRAZO_RETENCAO_DOADOR_DIAS', '3650'],
  ['PRAZO_RETENCAO_DESLIGADO_DIAS', '1825'],
] as const

test('as regras de prazo de guarda estão em "Regras do sistema" com o padrão da Tabela de temporalidade', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
  await page.goto('/regras')
  await expect(
    page.getByRole('heading', { name: 'Regras do sistema', level: 1 }),
  ).toBeVisible()
  for (const [chave, padrao] of REGRAS) {
    const linha = page.getByRole('listitem', { name: chave })
    await expect(linha, chave).toBeVisible({ timeout: 30_000 })
    await expect(linha.getByRole('spinbutton'), chave).toHaveValue(padrao)
  }
  await ver(page, info, 'regras-de-prazo-de-guarda')
  expect(vigia.problemas()).toEqual([])
})

test('prepara dado RECENTE (um pedido da fila e um pedido de doação) para provar que a rotina não o toca', async ({
  page,
}) => {
  await entrarComoPresidente(page)
  const nome = `Robô Retenção ${RODADA}`

  const atendimento = await page.request.post(
    `${API_HML}/api/publico/atendimentos`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: {
        tipo: 'CONTATO',
        assunto: `Assunto retenção ${RODADA}`,
        mensagem: `Mensagem recente do roteiro de retenção ${RODADA}, com dado pessoal de teste.`,
        nome_completo: nome,
        email_contato: `retencao.${RODADA}@homologacao.example.com`,
        consentimento_lgpd: true,
        versao_texto_consentimento: '1',
      },
    },
  )
  expect(atendimento.status(), await atendimento.text()).toBe(200)
  expect(
    ((await atendimento.json()) as { protocolo: string }).protocolo,
  ).toMatch(/^ASAF-/)

  // o pedido de doação pelo site só existe com a Chave Pix marcada "vai para o site" (o v5.6a-01 deixa assim; aqui se garante)
  const chave = await page.request.put(`${API_HML}/api/instituicao/CHAVE_PIX`, {
    headers: cabecalho(),
    data: {
      valor: 'chave-pix-de-teste@homologacao.example.com',
      publico: true,
    },
  })
  expect(chave.status(), await chave.text()).toBe(200)
  const publica = (await (
    await page.request.get(`${API_HML}/api/publico/doacao`)
  ).json()) as { versao_aviso_de_privacidade: string }
  const doacao = await page.request.post(
    `${API_HML}/api/publico/doacoes/intencoes`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: {
        nome_completo: nome,
        email: `retencao.doacao.${RODADA}@homologacao.example.com`,
        valor: 33,
        consentimento_lgpd: true,
        versao_texto_consentimento: publica.versao_aviso_de_privacidade,
      },
    },
  )
  expect(doacao.status(), await doacao.text()).toBe(200)
  expect(((await doacao.json()) as { protocolo: string }).protocolo).toMatch(
    /^DOA-/,
  )
})
