import { expect, test, type Page } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v5.4h - o site lê a Instituição e a Diretoria do sistema. Este roteiro ABRE o site de teste (hml-site, reconstruído pelo Deploy Homologação, que lê a API NO BUILD)
// como um visitante, num navegador de verdade, e confere que o que a diretoria cadastrou no painel ("vai para o site") é o que a pessoa vê, e que o que não é válido,
// vazio ou só interno não aparece. Deve rodar DEPOIS do v5.4h-02 (que preenche telefone, horário e CNPJ válido da Instituição) e de um deploy da homologação.
// Os mandatos da Diretoria e do Conselho Fiscal vêm da população de teste (dados inventados).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const SITE = 'https://hml-site.asaf.org.br'

type Instituicao = Record<string, string>
type Dirigente = { orgao_codigo: string; cargo: string; nome: string }

const limpo = (texto: string) =>
  texto.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
const digitos = (texto: string) => texto.replace(/\D/g, '')

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

test('contato, rodapé, Privacidade e Transparência mostram os dados válidos da Instituição, e o CNPJ de exemplo nunca aparece', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const inst = await api<Instituicao>(page, '/api/publico/instituicao')
  expect(
    inst['CNPJ'],
    'a Instituição de teste tem um CNPJ (rode o v5.4h-02 antes)',
  ).toBeTruthy()
  expect(
    inst['TELEFONE_INSTITUCIONAL'],
    'a Instituição de teste tem telefone público (rode o v5.4h-02 antes)',
  ).toBeTruthy()
  expect(
    inst['HORARIO_ATENDIMENTO'],
    'a Instituição de teste tem horário público (rode o v5.4h-02 antes)',
  ).toBeTruthy()

  const contato = await abrir(page, '/contato/')
  // o telefone do painel (mesmos dígitos), o horário e o CNPJ, no lugar dos dados fixos do Estatuto
  const telefoneDoSite = contato.match(/\(\d{2}\) \d{4,5}-\d{4}/g) ?? []
  expect(
    telefoneDoSite.map(digitos),
    'o telefone do painel aparece no contato',
  ).toContain(digitos(inst['TELEFONE_INSTITUCIONAL']!))
  expect(contato).toContain(limpo(inst['HORARIO_ATENDIMENTO']!))
  expect(contato).toContain(inst['CNPJ']!)
  await expect(page.locator('[data-horario-de-atendimento]')).toBeVisible()
  await expect(page.locator('a[href^="tel:"]').first()).toHaveAttribute(
    'href',
    new RegExp(`^tel:\\+55${digitos(inst['TELEFONE_INSTITUCIONAL']!)}$`),
  )
  await ver(page, info, 'contato-com-os-dados-da-instituicao')

  // o que NÃO está no painel como "vai para o site" continua o fixo: sem e-mail público, vale o e-mail do Estatuto; sem rede social, não há bloco de redes
  const email = inst['EMAIL_INSTITUCIONAL'] ?? 'asaf@asaf.org.br'
  await expect(page.locator('footer')).toContainText(email)
  if (!inst['SITE_INSTAGRAM'] && !inst['SITE_FACEBOOK']) {
    await expect(page.locator('[data-redes]')).toHaveCount(0)
  }

  for (const caminho of ['/privacidade/', '/transparencia/']) {
    const pagina = await abrir(page, caminho)
    expect(pagina, `${caminho} mostra o CNPJ do painel`).toContain(
      inst['CNPJ']!,
    )
    expect(pagina, `${caminho}: nada do CNPJ de exemplo`).not.toContain(
      '00.000.000/0001-00',
    )
  }
  const rodape = await abrir(page, '/')
  expect(rodape).not.toContain('00.000.000/0001-00')

  // dados estruturados para o Google: o CNPJ do painel
  await page.goto(`${SITE}/`)
  const blocos = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
  const organizacao = blocos
    .map((b) => JSON.parse(b) as Record<string, unknown>)
    .find((j) => j['taxID'])
  expect(organizacao?.['taxID']).toBe(inst['CNPJ'])
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

  // só nome, cargo e mandato: nada de CPF, e-mail ou telefone de dirigente
  expect(pagina).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/)
  expect(pagina).not.toMatch(/@[a-z0-9-]+\.[a-z]/i)
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
