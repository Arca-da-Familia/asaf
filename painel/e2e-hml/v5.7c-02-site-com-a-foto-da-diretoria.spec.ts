import { createHash } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { API_HML, exigirHomologacao, ver, vigiar } from './apoio'

// v5.7c - o que o VISITANTE do site de teste (hml-site) vê na página Diretoria, num navegador de verdade, DEPOIS de a homologação ser publicada de novo (o site lê a API no build):
// a foto de quem autorizou o uso da imagem (a da Presidente, subida pelo v5.7c-01), no próprio site e não na API, com o texto alternativo do nome e do cargo; quem não tem foto
// (o Bruno, cuja foto o v5.7c-01 apagou) aparece com as iniciais; a Política de Privacidade está na versão 2.0 com o parágrafo da foto. Nada violou a política de conteúdo do site.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const SITE = 'https://hml-site.asaf.org.br'
const PRESIDENTE = 'Ana Lúcia Ferreira'
const OUTRO = 'Bruno Carvalho Lima'

type Dirigente = {
  nome: string
  cargo: string
  foto: { alt: string; sha256: string; arquivo: string } | null
}

async function dirigente(page: Page, nome: string): Promise<Dirigente> {
  const r = await page.request.get(`${API_HML}/api/publico/diretoria`)
  expect(r.status()).toBe(200)
  const achado = ((await r.json()) as Dirigente[]).find((d) =>
    d.nome.startsWith(nome),
  )
  expect(achado, `${nome} está na Diretoria pública`).toBeDefined()
  return achado!
}

test('a página Diretoria mostra a foto da Presidente, do próprio site, e as iniciais de quem não tem foto', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const violacoes: string[] = []
  await page.addInitScript(() => {
    ;(window as unknown as { __v: string[] }).__v = []
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(window as unknown as { __v: string[] }).__v.push(
        `${e.violatedDirective} ← ${e.blockedURI || 'inline'}`,
      )
    })
  })
  const pedidosParaAApi: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith(API_HML) && r.resourceType() === 'image')
      pedidosParaAApi.push(r.url())
  })

  const ana = await dirigente(page, PRESIDENTE)
  const bruno = await dirigente(page, OUTRO)
  expect(ana.foto, 'a Presidente tem foto na API (v5.7c-01)').not.toBeNull()
  expect(bruno.foto, `${OUTRO} está sem foto (v5.7c-01 a apagou)`).toBeNull()

  const resposta = await page.goto(`${SITE}/diretoria/`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)

  // a Presidente: em destaque, com a foto copiada para o site (não a da API) e o texto alternativo certo
  const cartaoAna = page
    .locator('[data-ocupante]')
    .filter({ hasText: ana.nome })
    .first()
  await expect(cartaoAna).toHaveAttribute('data-destaque', '')
  const imagem = cartaoAna.locator('img[data-foto-da-diretoria]')
  await expect(imagem).toBeVisible()
  await expect(imagem).toHaveAttribute('alt', ana.foto!.alt)
  expect(ana.foto!.alt).toBe(`Foto de ${ana.nome}, ${ana.cargo}`)
  const src = await imagem.getAttribute('src')
  expect(src, 'a foto é do próprio site').toMatch(
    /^\/midia\/diretoria\/\d+-[0-9a-f]{12}\.jpg$/,
  )
  expect(
    await imagem.evaluate((el) => (el as HTMLImageElement).naturalWidth),
    'a imagem carregou de verdade',
  ).toBeGreaterThan(0)
  expect(pedidosParaAApi, 'o navegador não foi buscar foto na API').toEqual([])

  // o arquivo do site é exatamente o que a API declarou (impressão digital)
  const arquivo = await page.request.get(`${SITE}${src}`)
  expect(arquivo.status()).toBe(200)
  expect(arquivo.headers()['content-type']).toBe('image/jpeg')
  expect(
    createHash('sha256')
      .update(Buffer.from(await arquivo.body()))
      .digest('hex'),
  ).toBe(ana.foto!.sha256)

  // quem não tem foto: as iniciais no lugar (só enfeite), o nome e o cargo em texto, nenhuma imagem com o nome dele
  const cartaoBruno = page
    .locator('[data-ocupante]')
    .filter({ hasText: bruno.nome })
    .first()
  await expect(cartaoBruno).toBeVisible()
  await expect(cartaoBruno.locator('[data-iniciais]')).toHaveAttribute(
    'aria-hidden',
    'true',
  )
  await expect(cartaoBruno.locator('img')).toHaveCount(0)
  await expect(cartaoBruno).toContainText(bruno.cargo)

  // o aviso da página e nenhuma imagem quebrada
  await expect(page.locator('[data-sobre-as-fotos]')).toContainText(
    'só é publicada de quem autorizou',
  )
  const quebradas = await page
    .locator('img')
    .evaluateAll(
      (imgs) =>
        imgs.filter((i) => !(i as HTMLImageElement).naturalWidth).length,
    )
  expect(quebradas, 'nenhuma imagem quebrada na página').toBe(0)
  violacoes.push(
    ...(await page.evaluate(
      () => (window as unknown as { __v: string[] }).__v,
    )),
  )
  expect(violacoes, 'nenhuma violação da política de conteúdo').toEqual([])
  await ver(page, info, 'diretoria-com-a-foto-e-as-iniciais')
  expect(vigia.problemas()).toEqual([])
})

test('a Política de Privacidade está na versão 2.2 (a da rotina de retenção), com o parágrafo da foto da Diretoria', async ({
  page,
}, info) => {
  const resposta = await page.goto(`${SITE}/privacidade/`, {
    waitUntil: 'networkidle',
  })
  expect(resposta?.status()).toBe(200)
  const texto = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  expect(texto).toContain('Versão 2.2')
  const paragrafo = page.locator('[data-diretoria-foto]')
  await expect(paragrafo).toBeVisible()
  await expect(paragrafo).toContainText(
    'só existe enquanto a pessoa tem mandato',
  )
  await expect(paragrafo).toContainText('apaga a foto sozinho')
  await expect(paragrafo).toContainText('cópias de segurança internas')
  await expect(paragrafo).toContainText(
    'algumas horas e pode passar de meio dia',
  )
  await expect(paragrafo).toContainText('verificação da carteirinha digital')
  expect(
    texto,
    'a frase antiga (nenhuma foto de dirigente) saiu',
  ).not.toContain('Não publicamos CPF, telefone, e-mail nem foto')
  await ver(page, info, 'politica-de-privacidade-1-9')
})
