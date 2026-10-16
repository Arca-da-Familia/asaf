import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

// v5.7c — a página Diretoria mostra NOME e FOTO de quem está na Diretoria Executiva e no Conselho Fiscal ("a pessoa se sente representada quando vê o rosto de quem responde pela
// instituição"). A foto só existe de quem autorizou o uso da imagem; quem não tem foto aparece com um círculo de iniciais, do mesmo tamanho. No mock (scripts/mock-api.mjs):
//   - Maria de Teste da Silva, Presidente: COM foto, de pé (300x400)
//   - João de Teste Souza, 1º Secretário: SEM foto
//   - Ana de Teste Lima, Conselheira Fiscal: COM foto, deitada (400x300)
// A foto vem SEMPRE da cópia que o build guardou no próprio site (`/midia/diretoria/...`), nunca da API.

const PORTA_DA_API = process.env.MOCK_API_PORT ?? '4322'
const ORIGEM_DA_API = `http://127.0.0.1:${PORTA_DA_API}`
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

const cartaoDo = (page: Page, nome: string) =>
  page.locator('li[data-ocupante]', { hasText: nome })

/** A imagem terminou de carregar (as lazy só carregam quando chegam perto da tela: rola até elas). */
async function carregada(img: Locator) {
  await img.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      img.evaluate(
        (e) =>
          (e as HTMLImageElement).complete &&
          (e as HTMLImageElement).naturalWidth,
      ),
    )
    .toBeGreaterThan(0)
}

async function auditar(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const resumo = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes.map((n) => `   ${n.target.join(' ')}`).join('\n'),
  )
  expect(resumo, resumo.join('\n')).toEqual([])
}

async function caixa(alvo: Locator) {
  const c = await alvo.boundingBox()
  expect(c).not.toBeNull()
  return c!
}

test.describe('Diretoria com fotos (v5.7c)', () => {
  test('a Presidente é a primeira pessoa da página, em destaque, e só ela está em destaque', async ({
    page,
  }) => {
    await page.goto('/diretoria/')
    const primeira = page.locator('li[data-ocupante]').first()
    await expect(primeira).toContainText('Presidente')
    await expect(primeira).toContainText('Maria de Teste da Silva')
    await expect(page.locator('[data-destaque]')).toHaveCount(1)
    await expect(primeira).toHaveAttribute('data-destaque', '')
    // o período do mandato continua ao lado do nome
    await expect(primeira).toContainText(
      /Mandato: \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}/,
    )
    // "maior": a foto (e o texto) do destaque são maiores que os do cartão comum
    await carregada(primeira.locator('img'))
    const foto = await caixa(primeira.locator('img'))
    const conselheira = cartaoDo(page, 'Ana de Teste Lima').locator('img')
    await carregada(conselheira)
    expect(foto.width).toBeGreaterThan((await caixa(conselheira)).width)
  })

  test('a foto da Presidente carrega de verdade, com o texto alternativo da API, vinda do PRÓPRIO SITE e não da API', async ({
    page,
  }) => {
    const pedidos: string[] = []
    page.on('request', (r) => pedidos.push(r.url()))
    await page.goto('/diretoria/')
    const img = cartaoDo(page, 'Maria de Teste da Silva').locator('img')
    await expect(img).toHaveCount(1)
    await expect(img).toHaveAttribute(
      'alt',
      'Foto de Maria de Teste da Silva, Presidente',
    )
    await carregada(img)
    const dados = await img.evaluate((e) => {
      const i = e as HTMLImageElement
      return {
        naturalWidth: i.naturalWidth,
        naturalHeight: i.naturalHeight,
        origem: new URL(i.currentSrc).origin,
        caminho: new URL(i.currentSrc).pathname,
        origemDaPagina: location.origin,
        largura: i.getAttribute('width'),
        altura: i.getAttribute('height'),
      }
    })
    // o arquivo é o JPEG de 300x400 do mock e o HTML traz as medidas reais (a grade não pula ao carregar)
    expect(dados.naturalWidth).toBe(300)
    expect(dados.naturalHeight).toBe(400)
    expect([dados.largura, dados.altura]).toEqual(['300', '400'])
    expect(dados.origem).toBe(dados.origemDaPagina)
    expect(dados.caminho).toMatch(/^\/midia\/diretoria\/21-[0-9a-f]{12}\.jpg$/)
    // nenhuma foto da Diretoria foi pedida à API, e o HTML nem sabe o endereço dela
    expect(pedidos.filter((u) => u.includes('/diretoria/fotos/'))).toEqual([])
    expect(pedidos.filter((u) => u.startsWith(ORIGEM_DA_API))).toEqual([])
    const html = await page.content()
    expect(html).not.toContain('/api/publico/diretoria/fotos')
    expect(html).not.toContain(ORIGEM_DA_API)
  })

  test('a conselheira também tem a foto (deitada); só a primeira dobra carrega na hora, as demais são preguiçosas', async ({
    page,
  }) => {
    await page.goto('/diretoria/')
    const img = cartaoDo(page, 'Ana de Teste Lima').locator('img')
    await expect(img).toHaveAttribute(
      'alt',
      'Foto de Ana de Teste Lima, Conselheiro Fiscal',
    )
    await expect(img).toHaveAttribute('loading', 'lazy')
    await expect(
      cartaoDo(page, 'Maria de Teste da Silva').locator('img'),
    ).not.toHaveAttribute('loading', 'lazy')
    await carregada(img)
    const natural = await img.evaluate((e) => [
      (e as HTMLImageElement).naturalWidth,
      (e as HTMLImageElement).naturalHeight,
    ])
    expect(natural).toEqual([400, 300])
  })

  test('quem não tem foto mostra as iniciais num círculo enfeite (sem texto alternativo), com nome, cargo e mandato em texto', async ({
    page,
  }) => {
    await page.goto('/diretoria/')
    const joao = cartaoDo(page, 'João de Teste Souza')
    await expect(joao.locator('img')).toHaveCount(0)
    const iniciais = joao.locator('[data-iniciais]')
    await expect(iniciais).toHaveText('JS')
    await expect(iniciais).toHaveAttribute('aria-hidden', 'true')
    await expect(iniciais).not.toHaveAttribute('alt', /.*/)
    await expect(iniciais).not.toHaveAttribute('role', /.*/)
    await expect(joao).toContainText('1º Secretário')
    await expect(joao).toContainText(/Mandato: \d{2}\/\d{2}\/\d{4} a/)
    // quem tem foto não ganha o círculo de iniciais, e as iniciais não passam a ser lidas por leitor de tela
    await expect(
      cartaoDo(page, 'Maria de Teste da Silva').locator('[data-iniciais]'),
    ).toHaveCount(0)
    expect(await joao.getByRole('img').count()).toBe(0)
  })

  for (const [nome, largura] of [
    ['computador', 1280],
    ['celular', 375],
  ] as const) {
    test(`a grade fica uniforme no ${nome}: o círculo de iniciais e a foto (de pé ou deitada) são quadrados do mesmo tamanho`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: largura, height: 800 })
      await page.goto('/diretoria/')
      const foto = cartaoDo(page, 'Ana de Teste Lima').locator('img')
      await carregada(foto)
      const comFoto = await caixa(foto)
      const semFoto = await caixa(
        cartaoDo(page, 'João de Teste Souza').locator('[data-iniciais]'),
      )
      expect(comFoto.width).toBeCloseTo(comFoto.height, 0) // a foto deitada vira quadrado
      expect(semFoto.width).toBeCloseTo(semFoto.height, 0)
      expect(semFoto.width).toBeCloseTo(comFoto.width, 0) // o mesmo tamanho: nada pula de lugar
      const presidente = cartaoDo(page, 'Maria de Teste da Silva').locator(
        'img',
      )
      await carregada(presidente)
      const dePe = await caixa(presidente)
      expect(dePe.width).toBeCloseTo(dePe.height, 0) // a foto de pé também
      expect(dePe.width).toBeGreaterThan(comFoto.width)
      // redonda (50% ou o raio enorme do Tailwind) e recortada, não esticada: a foto de pé ou deitada nunca fica deformada
      for (const alvo of [foto, presidente]) {
        const estilo = await alvo.evaluate((e) => {
          const s = getComputedStyle(e)
          return { raio: s.borderRadius, ajuste: s.objectFit }
        })
        expect(estilo.raio).not.toBe('0px')
        expect(estilo.ajuste).toBe('cover')
      }
      const circulo = await cartaoDo(page, 'João de Teste Souza')
        .locator('[data-iniciais]')
        .evaluate((e) => getComputedStyle(e).borderRadius)
      expect(circulo).not.toBe('0px')
    })
  }

  test('no celular (375 px) nada estoura para o lado e o nome e o cargo continuam legíveis ao lado da foto', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/diretoria/')
    for (const img of await page.locator('img[data-foto-da-diretoria]').all()) {
      await carregada(img)
    }
    const estouro = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(estouro).toBeLessThanOrEqual(0)
    for (const cartao of await page.locator('li[data-ocupante]').all()) {
      const c = await caixa(cartao)
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x + c.width).toBeLessThanOrEqual(375)
      for (const filho of await cartao.locator('p').all()) {
        const f = await caixa(filho)
        expect(f.x + f.width).toBeLessThanOrEqual(c.x + c.width + 0.5)
      }
    }
  })

  test('nenhuma imagem da página está quebrada (todas as fotos, lidas até o fim)', async ({
    page,
  }) => {
    const falhas: string[] = []
    page.on('response', (r) => {
      if (r.request().resourceType() === 'image' && !r.ok())
        falhas.push(`${r.status()} ${r.url()}`)
    })
    await page.goto('/diretoria/')
    const imagens = page.locator('main img')
    await expect(imagens).toHaveCount(2)
    for (const img of await imagens.all()) {
      await carregada(img)
      expect(await img.getAttribute('alt')).toMatch(/^Foto de .+, .+$/)
    }
    await page.waitForLoadState('networkidle')
    expect(falhas).toEqual([])
  })

  test('a cópia do site é exatamente a foto que a API declarou (SHA-256) e é um JPEG', async ({
    page,
    request,
  }) => {
    const lista = (await (
      await request.get(`${ORIGEM_DA_API}/api/publico/diretoria`)
    ).json()) as {
      nome: string
      foto: { id_foto: number; sha256: string } | null
    }[]
    const comFoto = lista.filter((m) => m.foto)
    expect(comFoto.map((m) => m.nome)).toEqual([
      'Maria de Teste da Silva',
      'Ana de Teste Lima',
    ])
    await page.goto('/diretoria/')
    for (const { nome, foto } of comFoto) {
      const src = await cartaoDo(page, nome).locator('img').getAttribute('src')
      expect(src).toBe(
        `/midia/diretoria/${foto!.id_foto}-${foto!.sha256.slice(0, 12)}.jpg`,
      )
      const resposta = await request.get(src!)
      expect(resposta.status()).toBe(200)
      expect(resposta.headers()['content-type']).toBe('image/jpeg')
      const bytes = await resposta.body()
      expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        foto!.sha256,
      )
    }
    // só nasceram os arquivos das duas fotos (a pessoa sem foto não ganha nenhum)
    expect(readdirSync('dist/midia/diretoria')).toHaveLength(2)
  })

  test('a Política de Privacidade (2.0, que mantém o texto da foto da 1.10) conta o que o sistema faz com a foto, e nunca mais diz "nem foto"', async ({
    page,
  }) => {
    await page.goto('/privacidade/')
    await expect(
      page.getByText('Versão 2.0 · em vigor desde 16 de outubro de 2026'),
    ).toBeVisible()
    await expect(
      page.getByText(
        /Esta é a versão 2\.0, em vigor desde 16 de outubro de 2026/,
      ),
    ).toBeVisible()
    const paragrafo = page.locator('[data-diretoria-foto]')
    await expect(paragrafo).toHaveCount(1)
    await expect(paragrafo).toContainText(
      'mostra o nome, o cargo, o período do mandato e, de quem autorizou o uso da imagem, a foto',
    )
    await expect(paragrafo).toContainText(
      'Sem a autorização a foto não é guardada no sistema',
    )
    for (const trecho of [
      'A foto só existe enquanto a pessoa tem mandato vigente ou marcado',
      'o sistema apaga a foto sozinho',
      'tem até 24 horas para ele aparecer',
      'ao registrar o pedido no sistema, ela é apagada na hora',
      'isso costuma levar algumas horas e pode passar de meio dia',
      'ficam apenas cópias de segurança internas, que não são públicas, por até cerca de 30 dias',
      'duram até 35 dias',
      'é preciso enviar a foto de novo',
      'não é usada em nenhuma página deste site; para o público ela só aparece na verificação da carteirinha digital',
      'e só enquanto o QR vale',
      'Esse QR vale por poucos dias a partir de quando é gerado (hoje, 15 dias; no máximo 20)',
    ]) {
      await expect(paragrafo).toContainText(trecho)
    }
    await expect(paragrafo).not.toContainText('15 a 30 minutos')
    await expect(paragrafo).not.toContainText('continua guardada, sem uso')
    await expect(
      paragrafo.getByRole('link', { name: 'Diretoria' }),
    ).toHaveAttribute('href', '/diretoria/')
    const texto = await page.locator('main').innerText()
    expect(texto).not.toMatch(/Não publicamos CPF, telefone, e-mail nem foto/)
    expect(texto).not.toContain('Esta é a versão 1.9')
    expect(texto).not.toContain('Esta é a versão 1.10')
    // a página Diretoria avisa a mesma regra, com link para a Política
    await page.goto('/diretoria/')
    await expect(page.locator('[data-sobre-as-fotos]')).toContainText(
      'A foto só é publicada de quem autorizou o uso da imagem',
    )
    await expect(
      page.locator('[data-sobre-as-fotos]').getByRole('link'),
    ).toHaveAttribute('href', '/privacidade/')
  })

  for (const [nome, largura] of [
    ['computador', 1280],
    ['celular (375px)', 375],
  ] as const) {
    test(`axe, sem nenhuma violação, no ${nome} (fotos já carregadas)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: largura, height: 800 })
      await page.goto('/diretoria/')
      for (const img of await page.locator('main img').all()) {
        await carregada(img)
      }
      await page.waitForLoadState('networkidle')
      await auditar(page)
    })
  }
})

test.describe('o que o build publicou da Diretoria (v5.7c)', () => {
  test('o conteúdo da sincronização continua contando as 3 pessoas e a impressão é válida', async ({
    request,
  }) => {
    const dados = await (await request.get('/conteudo.json')).json()
    expect(dados.contagem.diretoria).toBe(3)
    expect(dados.impressao).toMatch(/^[0-9a-f]{64}$/)
  })

  test('o HTML da Diretoria no disco não guarda estilo nem script dentro e usa só endereço do próprio site para a foto', () => {
    const html = readFileSync('dist/diretoria/index.html', 'utf-8')
    expect(html).not.toMatch(/\sstyle="/)
    expect(html).not.toMatch(/<style\b/)
    const fontes = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(
      (m) => m[1]!,
    )
    // a logo do cabeçalho + as duas fotos: nenhuma vem de fora do site
    expect(fontes.length).toBeGreaterThanOrEqual(2)
    for (const src of fontes) expect(src.startsWith('/')).toBe(true)
  })
})
