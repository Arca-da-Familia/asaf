import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Núcleo familiar do beneficiário (a tela que faltava): na lista de beneficiários, "Núcleo familiar" mostra quem é quem na família, de
// qualquer lado do vínculo (a mãe vê o filho; o filho vê a mãe), com o grau por extenso; sem vínculo, a tela diz onde cadastrar; quem não tem a
// permissão de projetos (Secretário) é barrado.
test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const S = String(RODADA)
const MAE = `Mãe do Robô ${S}`
const FILHO = `Filho do Robô ${S}`
const SOZINHO = `Sem Família do Robô ${S}`

async function capturarToken(page: Page): Promise<() => string> {
  let token = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token = cab
  })
  return () => token
}

async function abrirBeneficiarios(page: Page, busca: string) {
  await page.goto('/beneficiarios')
  await expect(
    page.getByRole('heading', { name: 'Beneficiários', level: 1 }),
  ).toBeVisible()
  await page.getByPlaceholder('Nome do beneficiário…').fill(busca)
  await expect(page.getByRole('row', { name: new RegExp(busca) })).toHaveCount(
    1,
  )
}

test('preparo: três beneficiários e o vínculo de mãe e filho', async ({
  page,
}) => {
  exigirHomologacao()
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const chamar = async (
    metodo: 'GET' | 'POST',
    caminho: string,
    corpo?: unknown,
  ) => {
    const r = await page.request.fetch(`${API_HML}${caminho}`, {
      method: metodo,
      headers: { Authorization: token(), 'Content-Type': 'application/json' },
      data: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
    return { status: r.status(), corpo: (await r.json()) as never }
  }
  const idsDePessoa: Record<string, number> = {}
  for (const nome of [MAE, FILHO, SOZINHO]) {
    const criado = await chamar('POST', '/api/beneficiarios/', {
      nome_completo: nome,
      consentimento_lgpd_registrado: true,
    })
    expect(criado.status, `criar ${nome}`).toBe(200)
    const lista = (
      await chamar(
        'GET',
        `/api/beneficiarios/?busca=${encodeURIComponent(nome)}`,
      )
    ).corpo as { id_pessoa: number; nome_completo: string }[]
    idsDePessoa[nome] = lista.find((b) => b.nome_completo === nome)!.id_pessoa
  }
  const vinculo = await chamar(
    'POST',
    `/api/pessoas/${idsDePessoa[MAE]}/dependentes`,
    { id_pessoa_vinculada: idsDePessoa[FILHO], grau_parentesco: 'FILHO_A' },
  )
  expect(vinculo.status, 'vincular mãe e filho').toBe(200)
  expect(vigia.problemas()).toEqual([])
})

test('a mãe vê o filho no núcleo familiar; o filho vê a mãe; quem não tem vínculo vê onde cadastrar', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')

  await abrirBeneficiarios(page, MAE)
  await page.getByRole('button', { name: `Núcleo familiar de ${MAE}` }).click()
  const quadroDaMae = page.getByRole('region', {
    name: `Núcleo familiar de ${MAE}`,
  })
  await expect(
    quadroDaMae.getByText(`${FILHO} é Filho(a) de ${MAE}`),
  ).toBeVisible()
  await ver(page, info, 'nucleo-familiar-da-mae')

  await abrirBeneficiarios(page, FILHO)
  await page
    .getByRole('button', { name: `Núcleo familiar de ${FILHO}` })
    .click()
  await expect(
    page
      .getByRole('region', { name: `Núcleo familiar de ${FILHO}` })
      .getByText(`${FILHO} é Filho(a) de ${MAE}`),
  ).toBeVisible()
  await ver(page, info, 'nucleo-familiar-do-filho')

  await abrirBeneficiarios(page, SOZINHO)
  await page
    .getByRole('button', { name: `Núcleo familiar de ${SOZINHO}` })
    .click()
  await expect(
    page
      .getByRole('region', { name: `Núcleo familiar de ${SOZINHO}` })
      .getByText(/Nenhum vínculo familiar cadastrado/),
  ).toContainText('aba Vínculos')
  await ver(page, info, 'sem-vinculo-diz-onde-cadastrar')

  // "Fechar" tira o quadro
  await page
    .getByRole('region', { name: `Núcleo familiar de ${SOZINHO}` })
    .getByRole('button', { name: 'Fechar' })
    .click()
  await expect(
    page.getByRole('region', { name: `Núcleo familiar de ${SOZINHO}` }),
  ).toHaveCount(0)
  expect(vigia.problemas()).toEqual([])
})

test('quem não tem a permissão de projetos (Secretário) é barrado na tela e na API', async ({
  page,
}) => {
  const token = await capturarToken(page)
  await entrar(page, 'secretario')
  await page.goto('/beneficiarios')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  const r = await page.request.fetch(
    `${API_HML}/api/beneficiarios/1/nucleo-familiar`,
    { headers: { Authorization: token() } },
  )
  expect(r.status()).toBe(403)
})
