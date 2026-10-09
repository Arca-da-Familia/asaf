import { expect, test, type Page } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v5.4h - o site lê a Instituição e a Diretoria do sistema. Este roteiro ABRE o site de teste (hml-site, reconstruído pelo Deploy Homologação, que lê a API NO BUILD)
// como um visitante, num navegador de verdade, e confere que o que a diretoria cadastrou no painel ("aparece no site") é o que a pessoa vê, no lugar dos dados fixos do
// Estatuto, e que o CNPJ de exemplo nunca aparece. Ordem: v5.4h-13 (preenche a Instituição pela tela) -> publicar a homologação de novo -> este roteiro.
// Os mandatos da Diretoria e do Conselho Fiscal vêm da população de teste (dados inventados).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const SITE = 'https://hml-site.asaf.org.br'

// os mesmos valores que o v5.4h-13 preenche
const CNPJ = '11.222.333/0001-81'
const TELEFONE = '(94) 99999-8888'
const EMAIL = 'contato.teste@asaf.org.br'
const HORARIO = 'Segunda a sexta, das 8h às 17h'
const INSTAGRAM = 'https://www.instagram.com/asaf.teste/'
const FACEBOOK = 'https://www.facebook.com/asaf.teste'
// o que o Estatuto traz (o site mostra isto quando a Instituição não tem o dado)
const FIXOS = ['17.631.942/0001-70', '(94) 98412-0703', 'asaf@asaf.org.br']

type Dirigente = { orgao_codigo: string; cargo: string; nome: string }

const limpo = (texto: string) => texto.replace(/\s+/g, ' ')

async function api<T>(page: Page, caminho: string): Promise<T> {
  const r = await page.request.get(`${API_HML}${caminho}`)
  expect(r.status(), caminho).toBe(200)
  return (await r.json()) as T
}

async function abrir(page: Page, caminho: string): Promise<string> {
  const resposta = await page.goto(`${SITE}${caminho}`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status(), `${caminho} abre`).toBe(200)
  return limpo(await page.locator('body').innerText())
}

test('contato, rodapé, Privacidade e Transparência mostram os dados da Instituição no lugar dos fixos, e o CNPJ de exemplo nunca aparece', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const inst = await api<Record<string, string>>(
    page,
    '/api/publico/instituicao',
  )
  expect(inst['CNPJ'], 'a API pública tem o CNPJ do v5.4h-13').toBe(CNPJ)
  expect(inst['TELEFONE_INSTITUCIONAL']).toBe(TELEFONE)

  // contato: tudo o que a diretoria preencheu, e nenhum dado fixo no lugar
  const contato = await abrir(page, '/contato/')
  for (const valor of [CNPJ, TELEFONE, EMAIL, HORARIO]) {
    expect(contato, `o contato mostra "${valor}"`).toContain(valor)
  }
  for (const fixo of FIXOS) {
    expect(contato, `o contato não mostra mais o fixo "${fixo}"`).not.toContain(
      fixo,
    )
  }
  await expect(page.locator('[data-horario-de-atendimento]')).toBeVisible()
  await expect(
    page.locator('a[href="tel:+5594999998888"]').first(),
  ).toBeVisible()
  await expect(page.locator('main a[href^="mailto:"]').first()).toHaveAttribute(
    'href',
    `mailto:${EMAIL}`,
  )
  const redes = page.locator('[data-redes]')
  await expect(redes).toBeVisible()
  await expect(redes.locator(`a[href="${INSTAGRAM}"]`)).toBeVisible()
  await expect(redes.locator(`a[href="${FACEBOOK}"]`)).toBeVisible()
  await expect(redes.locator('a[rel="noopener noreferrer"]')).toHaveCount(2)
  await ver(page, info, 'contato-com-os-dados-da-instituicao')

  // rodapé (em toda página): o e-mail novo e as redes
  const rodape = page.locator('footer')
  await expect(rodape).toContainText(EMAIL)
  await expect(rodape.locator(`a[href="${INSTAGRAM}"]`)).toBeVisible()
  await expect(rodape.locator(`a[href="${FACEBOOK}"]`)).toBeVisible()

  for (const caminho of ['/privacidade/', '/termos/', '/transparencia/']) {
    const pagina = await abrir(page, caminho)
    expect(pagina, `${caminho} mostra o e-mail do painel`).toContain(EMAIL)
    expect(pagina, `${caminho}: nada do CNPJ de exemplo`).not.toContain(
      '00.000.000/0001-00',
    )
    for (const fixo of FIXOS) {
      expect(pagina, `${caminho}: nada do fixo "${fixo}"`).not.toContain(fixo)
    }
  }
  expect(await abrir(page, '/privacidade/')).toContain(CNPJ)
  expect(await abrir(page, '/transparencia/')).toContain(CNPJ)
  expect(await abrir(page, '/')).not.toContain('00.000.000/0001-00')

  // dados estruturados para o Google
  await page.goto(`${SITE}/`)
  const blocos = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
  const organizacao = blocos
    .map((b) => JSON.parse(b) as Record<string, unknown>)
    .find((j) => j['taxID'])
  expect(organizacao?.['taxID']).toBe(CNPJ)
  expect(organizacao?.['email']).toBe(EMAIL)
  expect(organizacao?.['sameAs']).toEqual([INSTAGRAM, FACEBOOK])
  expect(vigia.problemas()).toEqual([])
})

test('a Diretoria do site lista todos os mandatos vigentes do sistema, por órgão, e não vaza dado pessoal', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const dirigentes = await api<Dirigente[]>(page, '/api/publico/diretoria')
  expect(
    dirigentes.length,
    'a população de teste tem mandatos (Diretoria Executiva e Conselho Fiscal)',
  ).toBeGreaterThanOrEqual(10)

  const pagina = await abrir(page, '/diretoria/')
  // cada nome aparece na seção do próprio órgão (a página usa os cargos do Estatuto; quem ocupa vem do sistema)
  const secaoDoOrgao: Record<string, string> = {
    DIRETORIA_EXECUTIVA: 'Diretoria Executiva',
    CONSELHO_FISCAL: 'Conselho Fiscal',
  }
  for (const d of dirigentes) {
    const secao = secaoDoOrgao[d.orgao_codigo]
    expect(secao, `órgão conhecido: ${d.orgao_codigo}`).toBeTruthy()
    const texto = limpo(
      await page.locator(`[data-orgao="${secao}"]`).innerText(),
    )
    expect(texto, `${d.nome} aparece em ${secao}`).toContain(d.nome)
  }
  await ver(page, info, 'diretoria-com-os-mandatos-do-sistema')

  // só nome, cargo e mandato: nada de CPF, e-mail ou telefone de dirigente (olha o conteúdo da página; o rodapé tem o e-mail da associação)
  const principal = limpo(await page.locator('main').innerText())
  expect(principal).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/)
  expect(principal).not.toMatch(/@[a-z0-9-]+\.[a-z]/i)
  expect(pagina).toContain(dirigentes[0]!.nome)
  // o que a API pública devolve também não tem esses campos
  for (const d of dirigentes) {
    expect(Object.keys(d).sort()).toEqual(
      [
        'cargo',
        'cargo_codigo',
        'data_fim_previsto',
        'data_inicio',
        'nome',
        'orgao',
        'orgao_codigo',
      ].sort(),
    )
  }
  expect(vigia.problemas()).toEqual([])
})
