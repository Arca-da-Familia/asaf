import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// v5.5 — O projeto principal da associação e o contexto do evento. O servidor de teste (scripts/mock-api.mjs) simula:
//   - o "Projeto Principal de Teste" (id 3, em destaque), com duas edições (eventos 4 e 5), um relatório aprovado em
//     TEXTO ligado à edição passada (4), duas fotos (11 e 12) dessa edição e duas notícias do Directus (uma ligada ao
//     projeto, outra ao evento 4);
//   - uma edição de OUTRO projeto (evento 6, do reforço escolar) e eventos avulsos (1, 2 e 3);
//   - uma notícia ligada a projeto e evento que NÃO existem (publicada, mas sem a ligação).
// Aqui se prova, no navegador, o que aparece — e que NENHUMA seção aparece quando não há conteúdo.

const PROJETO = 'Projeto Principal de Teste'
const EDICAO_1 = 'Projeto Principal de Teste — 1ª edição'
const EDICAO_2 = 'Projeto Principal de Teste — 2ª edição'
const ALT_FOTO_11 =
  'Participantes reunidos na quadra durante a 1ª edição de teste (foto de teste)'
const ALT_FOTO_12 =
  'Mesa com os materiais da oficina da 1ª edição de teste (foto de teste)'

const secao = (page: Page, id: string) =>
  page.locator(`section[aria-labelledby="${id}"]`)

test.describe('Página do projeto principal', () => {
  test('mostra o que já existia: descrição, resumo e o convite para ajudar', async ({
    page,
  }) => {
    await page.goto('/projetos/3/')
    await expect(page.locator('h1')).toHaveText(PROJETO)
    await expect(
      page.getByRole('heading', { name: 'Sobre o projeto' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Em resumo' })).toBeVisible()
    await expect(page.getByText('Comunidades de teste')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Quer ajudar?' }),
    ).toBeVisible()
    // Nenhum selo inventado: o destaque é só ordem na lista e a seção da Home.
    expect(await page.locator('main').innerText()).not.toMatch(
      /Principal programa|Programa principal/i,
    )
  })

  test('"Edições e eventos": só as do projeto, a mais recente primeiro, com link e a marca de já realizado', async ({
    page,
  }) => {
    await page.goto('/projetos/3/')
    const edicoes = secao(page, 'edicoes')
    await expect(
      edicoes.getByRole('heading', { name: 'Edições e eventos', level: 2 }),
    ).toBeVisible()
    await expect(edicoes.locator('li[data-edicao]')).toHaveCount(2)
    await expect(edicoes.locator('li h3')).toHaveText([EDICAO_2, EDICAO_1])
    await expect(edicoes.getByRole('link', { name: EDICAO_2 })).toHaveAttribute(
      'href',
      '/eventos/5/',
    )
    await expect(edicoes.getByRole('link', { name: EDICAO_1 })).toHaveAttribute(
      'href',
      '/eventos/4/',
    )
    // A edição de OUTRO projeto (evento 6) e os eventos avulsos nunca aparecem aqui.
    await expect(edicoes).not.toContainText('reforço escolar')
    await expect(edicoes).not.toContainText('encontro de famílias')
    // Data com horário de Parauapebas (nunca omite o fuso).
    const horario = await edicoes
      .locator('time')
      .first()
      .getAttribute('datetime')
    expect(horario).toMatch(/T19:00:00-03:00$/)
    // "Já realizado" é acrescentado no navegador: só na edição cuja data passou.
    await expect(
      edicoes.locator('li[data-edicao]').nth(1).getByText('Já realizado'),
    ).toBeVisible()
    await expect(
      edicoes.locator('li[data-edicao]').nth(0).getByText('Já realizado'),
    ).toBeHidden()
  })

  test('a marca "Já realizado" acompanha o relógio (uma edição futura deixa de ser futura sem reconstruir o site)', async ({
    page,
  }) => {
    // 40 dias depois: a 2ª edição (daqui a 21 dias) já aconteceu quando a pessoa abre a página.
    await page.clock.setFixedTime(new Date(Date.now() + 40 * 86_400_000))
    await page.goto('/projetos/3/')
    const edicoes = secao(page, 'edicoes')
    await expect(edicoes.getByText('Já realizado')).toHaveCount(2)
    await expect(edicoes.getByText('Já realizado').first()).toBeVisible()
    await expect(edicoes.getByText('Já realizado').nth(1)).toBeVisible()
  })

  test('"Relatórios e documentos": o relatório aprovado abre a página do texto, dito de qual edição é', async ({
    page,
  }) => {
    await page.goto('/projetos/3/')
    const documentos = secao(page, 'relatorios-e-documentos')
    await expect(
      documentos.getByRole('heading', {
        name: 'Relatórios e documentos',
        level: 2,
      }),
    ).toBeVisible()
    await expect(documentos.locator('li')).toHaveCount(1)
    const link = documentos.getByRole('link', {
      name: /Relatório da 1ª edição do projeto principal de teste/,
    })
    // endereço permanente: começa pelo id do documento (título editado não quebra o link)
    await expect(link).toHaveAttribute(
      'href',
      /^\/transparencia\/documentos\/5-[a-z0-9-]+\/$/,
    )
    await expect(documentos.locator('li')).toContainText(
      'Relatório de evento ou de projeto',
    )
    await expect(documentos.locator('li')).toContainText('2026')
    await expect(documentos.locator('li')).toContainText('Texto')
    await expect(documentos.locator('li')).toContainText(EDICAO_1)
    await link.click()
    await expect(page.locator('h1')).toContainText(
      'Relatório da 1ª edição do projeto principal de teste',
    )
    await expect(
      page.getByText('Segundo parágrafo de teste do relatório.'),
    ).toBeVisible()
  })

  test('"Fotos": cada uma com o texto alternativo real, medidas, carregamento tardio e a legenda do evento', async ({
    page,
    request,
  }) => {
    await page.goto('/projetos/3/')
    const fotos = secao(page, 'fotos')
    await expect(
      fotos.getByRole('heading', { name: 'Fotos', level: 2 }),
    ).toBeVisible()
    const imagens = fotos.locator('img')
    await expect(imagens).toHaveCount(2) // a mesma foto não se repete
    // as mais recentes primeiro (id 12, depois 11)
    await expect(imagens.nth(0)).toHaveAttribute('alt', ALT_FOTO_12)
    await expect(imagens.nth(0)).toHaveAttribute('src', '/midia/eventos/12.jpg')
    await expect(imagens.nth(0)).toHaveAttribute('width', '400')
    await expect(imagens.nth(0)).toHaveAttribute('height', '600')
    await expect(imagens.nth(1)).toHaveAttribute('alt', ALT_FOTO_11)
    await expect(imagens.nth(1)).toHaveAttribute('src', '/midia/eventos/11.jpg')
    await expect(imagens.nth(1)).toHaveAttribute('width', '600')
    await expect(imagens.nth(1)).toHaveAttribute('height', '400')
    for (const i of [0, 1]) {
      await expect(imagens.nth(i)).toHaveAttribute('loading', 'lazy')
    }
    // legenda com o evento (e o link para ele)
    const legendas = fotos.locator('figcaption')
    await expect(legendas).toHaveCount(2)
    await expect(
      legendas.first().getByRole('link', { name: EDICAO_1 }),
    ).toHaveAttribute('href', '/eventos/4/')
    // o arquivo vem do próprio site, é JPEG de verdade, e o endereço da API nunca vai para o HTML
    for (const id of [11, 12]) {
      const resposta = await request.get(`/midia/eventos/${id}.jpg`)
      expect(resposta.status()).toBe(200)
      expect(resposta.headers()['content-type']).toBe('image/jpeg')
      expect((await resposta.body()).subarray(0, 3).toString('hex')).toBe(
        'ffd8ff',
      )
    }
    expect(await page.content()).not.toContain('/api/publico/')
  })

  test('"Notícias": as ligadas ao projeto ou a uma edição dele, da mais recente para a mais antiga', async ({
    page,
  }) => {
    await page.goto('/projetos/3/')
    const noticias = secao(page, 'noticias')
    await expect(
      noticias.getByRole('heading', { name: 'Notícias', level: 2 }),
    ).toBeVisible()
    await expect(noticias.locator('li h3')).toHaveText([
      'Notícia de teste ligada ao projeto',
      'Notícia de teste ligada ao evento',
    ])
    await expect(
      noticias.getByRole('link', {
        name: 'Notícia de teste ligada ao projeto',
      }),
    ).toHaveAttribute('href', '/noticias/noticia-de-teste-ligada-ao-projeto/')
    // sem notícia solta, sem a de ligação quebrada e sem "ver todas" (não há mais do que as mostradas)
    await expect(noticias).not.toContainText('sem foto')
    await expect(noticias).not.toContainText('ligação quebrada')
    await expect(noticias.getByRole('link', { name: /Ver todas/ })).toHaveCount(
      0,
    )
  })

  test('projeto de outro tema: só mostra o que é dele (uma edição) e nenhuma seção vazia', async ({
    page,
  }) => {
    await page.goto('/projetos/1/')
    const edicoes = secao(page, 'edicoes')
    await expect(edicoes.locator('li[data-edicao]')).toHaveCount(1)
    await expect(edicoes.locator('li h3')).toHaveText([
      'Edição de teste do reforço escolar',
    ])
    await expect(page.locator('[data-secao]')).toHaveCount(1)
    await expect(page.locator('#relatorios-e-documentos')).toHaveCount(0)
    await expect(page.locator('#fotos')).toHaveCount(0)
    await expect(page.locator('#noticias')).toHaveCount(0)
  })

  test('projeto sem nada ligado: nenhuma seção de contexto (nem título solto)', async ({
    page,
  }) => {
    await page.goto('/projetos/2/')
    await expect(page.locator('[data-secao]')).toHaveCount(0)
    for (const titulo of [
      'Edições e eventos',
      'Relatórios e documentos',
      'Fotos',
      'Notícias',
    ]) {
      await expect(
        page.getByRole('heading', { name: titulo, level: 2, exact: true }),
      ).toHaveCount(0)
    }
    await expect(
      page.getByRole('heading', { name: 'Quer ajudar?' }),
    ).toBeVisible()
  })
})

test.describe('Página de um evento com contexto', () => {
  test('a edição passada: projeto, outras edições, relatório, fotos e notícia — cada bloco com o seu conteúdo', async ({
    page,
  }) => {
    await page.goto('/eventos/4/')
    await expect(page.locator('h1')).toHaveText(EDICAO_1)

    // "Faz parte do projeto"
    const projeto = page.locator('[data-projeto-do-evento]')
    await expect(projeto).toContainText('Faz parte do projeto')
    await expect(projeto.getByRole('link', { name: PROJETO })).toHaveAttribute(
      'href',
      '/projetos/3/',
    )

    // "Outras edições": a cadeia, da mais antiga à mais nova, com a atual marcada e SEM link
    const edicoes = secao(page, 'outras-edicoes')
    await expect(
      edicoes.getByRole('heading', { name: 'Outras edições', level: 2 }),
    ).toBeVisible()
    await expect(edicoes.locator('li h3')).toContainText([EDICAO_1, EDICAO_2])
    await expect(edicoes.getByRole('link')).toHaveCount(1)
    await expect(edicoes.getByRole('link', { name: EDICAO_2 })).toHaveAttribute(
      'href',
      '/eventos/5/',
    )
    await expect(edicoes.locator('li').first()).toContainText(
      'você está nesta edição',
    )

    // "Relatório e documentos"
    const documentos = secao(page, 'relatorio-e-documentos')
    await expect(
      documentos.getByRole('heading', {
        name: 'Relatório e documentos',
        level: 2,
      }),
    ).toBeVisible()
    await expect(
      documentos.getByRole('link', {
        name: /Relatório da 1ª edição do projeto principal de teste/,
      }),
    ).toHaveAttribute('href', /^\/transparencia\/documentos\/5-/)

    // "Fotos do evento": as duas, com texto alternativo real e sem legenda (já se está no evento)
    const fotos = secao(page, 'fotos-do-evento')
    await expect(
      fotos.getByRole('heading', { name: 'Fotos do evento', level: 2 }),
    ).toBeVisible()
    const imagens = fotos.locator('img')
    await expect(imagens).toHaveCount(2)
    await expect(imagens.nth(0)).toHaveAttribute('alt', ALT_FOTO_11)
    await expect(imagens.nth(0)).toHaveAttribute('src', '/midia/eventos/11.jpg')
    await expect(imagens.nth(1)).toHaveAttribute('alt', ALT_FOTO_12)
    await expect(imagens.nth(1)).toHaveAttribute('width', '400')
    await expect(imagens.nth(1)).toHaveAttribute('loading', 'lazy')
    await expect(fotos.locator('figcaption')).toHaveCount(0)

    // "Notícias sobre este evento": só a ligada a ESTE evento (a do projeto não entra)
    const noticias = secao(page, 'noticias-do-evento')
    await expect(
      noticias.getByRole('heading', {
        name: 'Notícias sobre este evento',
        level: 2,
      }),
    ).toBeVisible()
    await expect(noticias.locator('li h3')).toHaveText([
      'Notícia de teste ligada ao evento',
    ])
  })

  test('a página continua viva: aviso de "já passou" e o aviso de evento retirado (ilha) funcionam no mesmo layout', async ({
    page,
  }) => {
    await page.goto('/eventos/4/')
    await expect(page.locator('[data-aviso-realizado]')).toBeVisible()
    await expect(page.locator('[data-evento-vivo]')).toHaveAttribute(
      'data-id',
      '4',
    )
    await page.route('**/api/publico/eventos/4', (rota) =>
      rota.fulfill({ status: 404, json: { detail: 'Evento não encontrado.' } }),
    )
    await page.goto('/eventos/4/')
    await expect(page.locator('[data-aviso-retirado]')).toBeVisible()
    // o contexto continua na página (o que foi construído não some)
    await expect(secao(page, 'fotos-do-evento')).toBeVisible()
  })

  test('a próxima edição: projeto e outras edições, mas nenhum bloco vazio (sem relatório, fotos nem notícia)', async ({
    page,
  }) => {
    await page.goto('/eventos/5/')
    await expect(page.locator('h1')).toHaveText(EDICAO_2)
    await expect(
      page.locator('[data-projeto-do-evento]').getByRole('link'),
    ).toHaveAttribute('href', '/projetos/3/')
    const edicoes = secao(page, 'outras-edicoes')
    await expect(edicoes.locator('li')).toHaveCount(2)
    await expect(edicoes.locator('li').nth(1)).toContainText(
      'você está nesta edição',
    )
    await expect(edicoes.getByRole('link', { name: EDICAO_1 })).toHaveAttribute(
      'href',
      '/eventos/4/',
    )
    await expect(page.locator('#relatorio-e-documentos')).toHaveCount(0)
    await expect(page.locator('#fotos-do-evento')).toHaveCount(0)
    await expect(page.locator('#noticias-do-evento')).toHaveCount(0)
    // "Já realizado" só na edição passada
    await expect(
      edicoes.locator('li').nth(0).getByText('Já realizado'),
    ).toBeVisible()
    await expect(
      edicoes.locator('li').nth(1).getByText('Já realizado'),
    ).toBeHidden()
  })

  test('edição de outro projeto sem outras edições: leva ao projeto, sem "Outras edições"', async ({
    page,
  }) => {
    await page.goto('/eventos/6/')
    await expect(
      page.locator('[data-projeto-do-evento]').getByRole('link'),
    ).toHaveAttribute('href', '/projetos/1/')
    await expect(page.locator('[data-secao]')).toHaveCount(0)
  })

  test('evento avulso (sem projeto): a página é a de sempre, sem nenhum bloco de contexto', async ({
    page,
  }) => {
    await page.goto('/eventos/2/')
    await expect(page.locator('[data-projeto-do-evento]')).toHaveCount(0)
    await expect(page.locator('[data-secao]')).toHaveCount(0)
    await expect(page.getByText('Faz parte do projeto')).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: 'Programação' }),
    ).toBeVisible()
    await expect(page.locator('[data-vagas]')).toHaveText(
      '12 vagas disponíveis',
    )
  })

  test('sem foto, sem relatório e sem notícia, nada de seção vazia em nenhum evento', async ({
    page,
  }) => {
    for (const id of [1, 2, 3, 6]) {
      await page.goto(`/eventos/${id}/`)
      for (const marca of [
        '#relatorio-e-documentos',
        '#fotos-do-evento',
        '#noticias-do-evento',
        '#outras-edicoes',
      ]) {
        await expect(
          page.locator(marca),
          `/eventos/${id}/ ${marca}`,
        ).toHaveCount(0)
      }
    }
  })
})

test.describe('Notícia ligada a projeto ou evento', () => {
  test('a ligada ao projeto mostra o link "Sobre o projeto" (e só ele)', async ({
    page,
  }) => {
    await page.goto('/noticias/noticia-de-teste-ligada-ao-projeto/')
    const ligacoes = page.locator('[data-ligacoes-da-noticia]')
    await expect(
      ligacoes.getByRole('link', { name: `Sobre o projeto ${PROJETO}` }),
    ).toHaveAttribute('href', '/projetos/3/')
    await expect(ligacoes.getByRole('link')).toHaveCount(1)
  })

  test('a ligada ao evento mostra o link "Sobre o evento" (e só ele)', async ({
    page,
  }) => {
    await page.goto('/noticias/noticia-de-teste-ligada-ao-evento/')
    const ligacoes = page.locator('[data-ligacoes-da-noticia]')
    await expect(
      ligacoes.getByRole('link', { name: `Sobre o evento ${EDICAO_1}` }),
    ).toHaveAttribute('href', '/eventos/4/')
    await expect(ligacoes.getByRole('link')).toHaveCount(1)
  })

  test('ligação com número que não existe: a notícia VAI ao ar, sem a ligação (nenhum link quebrado)', async ({
    page,
    request,
  }) => {
    const resposta = await request.get(
      '/noticias/noticia-de-teste-com-ligacao-quebrada/',
    )
    expect(resposta.status()).toBe(200)
    await page.goto('/noticias/noticia-de-teste-com-ligacao-quebrada/')
    await expect(page.locator('h1')).toHaveText(
      'Notícia de teste com ligação quebrada',
    )
    await expect(page.locator('[data-ligacoes-da-noticia]')).toHaveCount(0)
    await expect(page.getByText(/Sobre o (projeto|evento)/)).toHaveCount(0)
  })

  test('notícia sem ligação: nada de "Sobre o projeto"', async ({ page }) => {
    await page.goto('/noticias/noticia-de-teste-sem-foto/')
    await expect(page.locator('[data-ligacoes-da-noticia]')).toHaveCount(0)
  })
})

test.describe('Home com o projeto em destaque', () => {
  test('mostra o destaque com nome, trecho da descrição, próxima edição e o caminho para a página', async ({
    page,
  }) => {
    await page.goto('/')
    const destaque = page.getByRole('region', { name: 'Em destaque' })
    await expect(destaque).toBeVisible()
    const cartao = destaque.locator('[data-destaque="3"]')
    await expect(
      cartao.getByRole('heading', { name: PROJETO, level: 3 }),
    ).toBeVisible()
    await expect(cartao).toContainText(
      'Descrição de teste do projeto principal',
    )
    // próxima edição: data e link para a página dela
    const proxima = cartao.locator('[data-proxima-edicao]:visible')
    await expect(proxima).toHaveCount(1)
    await expect(proxima).toContainText('Próxima edição:')
    await expect(proxima.getByRole('link', { name: EDICAO_2 })).toHaveAttribute(
      'href',
      '/eventos/5/',
    )
    await expect(proxima.locator('time')).toHaveAttribute(
      'datetime',
      /T19:00:00-03:00$/,
    )
    await expect(
      cartao.getByRole('link', {
        name: /Conheça o projeto\s*:\s*Projeto Principal de Teste/,
      }),
    ).toHaveAttribute('href', '/projetos/3/')
  })

  test('o destaque vem logo depois da abertura e antes de "Quem somos"', async ({
    page,
  }) => {
    await page.goto('/')
    const ordem = await page.evaluate(() => {
      const posicao = (seletor: string) => {
        const elemento = document.querySelector(seletor)
        return elemento
          ? elemento.getBoundingClientRect().top + window.scrollY
          : -1
      }
      return {
        abertura: posicao('main section'),
        destaque: posicao('[data-secao="destaque"]'),
        quemSomos: posicao('#quem-somos'),
      }
    })
    expect(ordem.destaque).toBeGreaterThan(ordem.abertura)
    expect(ordem.destaque).toBeLessThan(ordem.quemSomos)
  })

  test('o projeto em destaque não se repete em "Nossos projetos"', async ({
    page,
  }) => {
    await page.goto('/')
    const projetos = page.getByRole('region', { name: 'Nossos projetos' })
    await expect(projetos).toContainText('reforço escolar')
    await expect(projetos).not.toContainText(PROJETO)
  })

  test('a "próxima edição" some quando a data passa (o site só é reconstruído quando o conteúdo muda, não porque o relógio andou)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(Date.now() + 40 * 86_400_000))
    await page.goto('/')
    // o destaque continua; só a "próxima edição" que já aconteceu deixa de ser anunciada
    await expect(page.locator('[data-destaque="3"]')).toBeVisible()
    await expect(page.locator('[data-proximas-edicoes]')).toBeHidden()
    await expect(page.getByText('Próxima edição:')).toBeHidden()
  })
})

test.describe('Home com o destaque, sem JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('o destaque aparece como foi construído (a conferência da data é um acréscimo do navegador)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('[data-destaque="3"]')).toBeVisible()
    await expect(page.getByText('Próxima edição:')).toBeVisible()
  })
})

test.describe('Acessibilidade e celular das páginas novas', () => {
  const PAGINAS = [
    '/',
    '/projetos/',
    '/projetos/3/',
    '/projetos/1/',
    '/eventos/4/',
    '/eventos/5/',
    '/noticias/noticia-de-teste-ligada-ao-projeto/',
    '/noticias/noticia-de-teste-ligada-ao-evento/',
  ]
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

  async function auditar(page: Page) {
    const { violations } = await new AxeBuilder({ page })
      .withTags(TAGS)
      .analyze()
    const resumo = violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `   ${n.target.join(' ')}`).join('\n'),
    )
    expect(resumo, resumo.join('\n')).toEqual([])
  }

  for (const caminho of PAGINAS) {
    test(`axe desktop — ${caminho}`, async ({ page }) => {
      await page.goto(caminho)
      await page.waitForLoadState('networkidle')
      await auditar(page)
    })

    test(`axe celular (375px) e sem rolagem lateral — ${caminho}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 700 })
      await page.goto(caminho)
      await page.waitForLoadState('networkidle')
      await auditar(page)
      const sobra = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )
      expect(sobra, 'a página rola para o lado no celular').toBeLessThanOrEqual(
        0,
      )
    })
  }

  test('a "próxima edição" que já passou deixa a Home acessível também (estado alterado pelo navegador)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(Date.now() + 40 * 86_400_000))
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await auditar(page)
  })
})
