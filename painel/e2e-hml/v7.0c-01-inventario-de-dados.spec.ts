import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
  type Papel,
} from './apoio'

// v7.0c - O INVENTÁRIO DE DADOS (registro das operações de tratamento, LGPD art. 37). Pelas telas:
//  1. a PRESIDENTE DO CARGO abre Privacidade > Inventário de dados: cada atividade com as seções do modelo da ANPD; o atendimento social a beneficiários com
//     "Dado sensível", "Pode ter criança ou adolescente" e "Sem rotina automática de eliminação ainda"; o cadastro com o prazo lido da regra em vigor e o
//     armazenamento nos Estados Unidos (cópias de segurança); "O que falta" conta as bases legais ainda como proposta;
//  2. ajusta os Fornecedores: tirar todas as bases legais é recusado; muda a finalidade e marca "base legal conferida" → versão nova, histórico com a versão;
//  3. baixa a planilha (o cabeçalho com as seções) e abre o PDF;
//  4. o 1º VICE-PRESIDENTE vê o inventário, não tem "Ajustar" e o servidor recusa (403);
//  5. a Auditoria (lida pelo Presidente) tem o ajuste e as exportações, com quem fez.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const FINALIDADE = `Cadastrar fornecedores e pagar o que foi contratado (robô v7.0c ${RODADA}).`

async function comoPapel(page: Page, papel: Papel): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, papel)
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

async function abrirInventario(page: Page) {
  await page.getByRole('link', { name: 'Privacidade' }).first().click()
  await page.getByRole('link', { name: 'Inventário de dados' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Inventário de dados', level: 1 }),
  ).toBeVisible()
}

test('a Presidente do cargo vê as seções, ajusta uma atividade (versão nova) e exporta', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'cargo_presidente')
  await abrirInventario(page)

  const beneficiarios = page.getByRole('region', {
    name: 'Atendimento social a beneficiários',
  })
  await expect(beneficiarios.getByText('Dado sensível')).toBeVisible()
  await expect(
    beneficiarios.getByText('Pode ter criança ou adolescente'),
  ).toBeVisible()
  await expect(
    beneficiarios.getByText('Sem rotina automática de eliminação ainda.'),
  ).toBeVisible()
  const cadastro = page.getByRole('region', {
    name: 'Cadastro e vida associativa',
  })
  await expect(cadastro).toContainText('Associado desligado:')
  await expect(cadastro).toContainText('South Central US (Estados Unidos)')
  await expect(page.getByTestId('pendencias-do-inventario')).toContainText(
    'com a base legal ainda como proposta do sistema',
  )
  await ver(page, info, 'inventario-de-dados')

  // ajustar: sem base legal é recusado; com a finalidade nova e a base conferida, versão nova
  const fornecedores = page.getByRole('region', { name: 'Fornecedores' })
  const versaoAntes = Number(
    /Versão (\d+)/.exec(await fornecedores.innerText())![1],
  )
  await fornecedores.getByRole('button', { name: 'Ajustar' }).click()
  const form = fornecedores.getByRole('form', { name: 'Ajustar Fornecedores' })
  const marcadas = form.locator('fieldset').first().locator('input:checked')
  for (let i = await marcadas.count(); i > 0; i--) {
    await marcadas.first().click()
  }
  await form.getByRole('button', { name: 'Salvar (versão nova)' }).click()
  await expect(form.getByRole('alert')).toContainText(
    'Escolha ao menos uma base legal da lista.',
  )
  await ver(page, info, 'sem-base-legal-recusado')
  await form.getByRole('button', { name: 'Cancelar' }).click()

  await fornecedores.getByRole('button', { name: 'Ajustar' }).click()
  await form.getByLabel('Finalidade').fill(FINALIDADE)
  const conferida = form.getByLabel(
    'O encarregado conferiu a base legal desta atividade',
  )
  if (!(await conferida.isChecked())) await conferida.click()
  await form.getByRole('button', { name: 'Salvar (versão nova)' }).click()
  await expect(form).toHaveCount(0)
  await expect(fornecedores).toContainText(FINALIDADE)
  await expect(fornecedores.getByText('Base legal conferida')).toBeVisible()
  await expect(fornecedores).toContainText(`Versão ${versaoAntes + 1}, de`)
  await fornecedores.getByRole('button', { name: 'Ver o histórico' }).click()
  await expect(
    fornecedores.getByRole('list', { name: 'Versões' }),
  ).toContainText(`Versão ${versaoAntes + 1}`)
  await expect(
    fornecedores.getByRole('list', { name: 'Versões' }),
  ).toContainText('Versão 0 — proposta do sistema')
  await ver(page, info, 'fornecedores-versao-nova-e-historico')

  // exportar
  const baixando = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar a planilha' }).click()
  const download = await baixando
  const { readFileSync } = await import('node:fs')
  const planilha = readFileSync(await download.path()).toString('utf-8')
  expect(planilha).toContain('Atividade;Finalidade;Titulares')
  expect(planilha).toContain(FINALIDADE)
  const pdf = await page.request.get(
    `${API_HML}/api/privacidade/inventario-pdf`,
    {
      headers: { Authorization: token },
    },
  )
  expect(pdf.status()).toBe(200)
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(vigia.problemas()).toEqual([])
})

test('o 1º Vice-Presidente vê o inventário, mas não ajusta', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page, 'vice_presidente')
  await abrirInventario(page)
  await expect(page.getByRole('button', { name: 'Ajustar' })).toHaveCount(0)
  await ver(page, info, 'vice-so-ve-o-inventario')
  const r = await page.request.put(
    `${API_HML}/api/privacidade/inventario/FORNECEDORES`,
    {
      headers: { Authorization: token },
      data: { observacoes: 'tentativa de quem só vê o inventário' },
    },
  )
  expect(r.status()).toBe(403)
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guarda o ajuste e as exportações, com quem fez', async ({
  page,
}, info) => {
  const token = await comoPapel(page, 'presidente')
  for (const acao of ['ATIVIDADE_AJUSTADA', 'INVENTARIO_EXPORTADO']) {
    const r = await page.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=versoes_de_atividade_de_tratamento&acao=${acao}&por_pagina=200`,
      { headers: { Authorization: token } },
    )
    expect(r.status()).toBe(200)
    const { entradas } = (await r.json()) as {
      entradas: Array<{
        id_usuario: number | null
        dados_depois: string | null
      }>
    }
    expect(entradas.length, `${acao} na Auditoria`).toBeGreaterThan(0)
    expect(entradas[0]!.id_usuario).not.toBeNull()
    if (acao === 'ATIVIDADE_AJUSTADA') {
      expect(
        entradas.some((e) => (e.dados_depois ?? '').includes(String(RODADA))),
      ).toBe(true)
    }
  }
  await page.goto('/auditoria')
  await ver(page, info, 'auditoria')
})
