import { createHash } from 'node:crypto'

import { expect, test } from '@playwright/test'

// v5.4b — Transparência: emendas, parcerias e documentos APROVADOS no sistema, lidos no build. O servidor de teste
// (scripts/mock-api.mjs) simula a API pública do sistema com 3 parcerias (2 emendas e 1 termo) e 3 documentos, todos
// com "EXEMPLO" no título. Aqui se prova, no navegador, o que aparece, os números certos, o PDF permanente e o que
// NÃO pode aparecer.

const reais = (texto: string) => texto.replace(/\s/g, ' ')

test.describe('Lista de emendas', () => {
  test('mostra as emendas de todos os anos, do mais novo ao mais antigo, com os totais', async ({
    page,
  }) => {
    await page.goto('/transparencia/emendas/')
    await expect(page.locator('h1')).toHaveText('Emendas parlamentares')
    const anos = await page
      .locator('main section[data-ano-grupo] h2')
      .allInnerTexts()
    expect(anos).toEqual(['2026', '2025'])
    const titulos = await page
      .locator('main li[data-parceria] h3')
      .allInnerTexts()
    expect(titulos).toEqual([
      'EXEMPLO – Emenda 123/2026 — Oficinas de música',
      'EXEMPLO – Emenda 77/2025 — Reforço escolar',
    ])
    // totais: 2 emendas; 80.000 de valor; 40.000 recebidos; 32.015 pagos
    await expect(page.locator('[data-total="quantidade"]')).toHaveText('2')
    expect(reais(await page.locator('[data-total="valor"]').innerText())).toBe(
      'R$ 80.000,00',
    )
    expect(
      reais(await page.locator('[data-total="recebido"]').innerText()),
    ).toBe('R$ 40.000,00')
    expect(reais(await page.locator('[data-total="pago"]').innerText())).toBe(
      'R$ 32.015,00',
    )
  })

  test('o termo de fomento NÃO aparece na lista de emendas (tem página própria em Parcerias)', async ({
    page,
  }) => {
    await page.goto('/transparencia/emendas/')
    expect(await page.content()).not.toContain('Termo de fomento 9/2026')
  })

  test('o filtro por ano e por situação esconde o que não casa e avisa quantos sobraram', async ({
    page,
  }) => {
    await page.goto('/transparencia/emendas/')
    const filtro = page.getByRole('search', { name: 'Filtrar as emendas' })
    await expect(filtro).toBeVisible()
    await filtro.getByLabel('Ano').selectOption('2025')
    await expect(page.locator('li[data-parceria]:visible')).toHaveCount(1)
    await expect(page.getByRole('status')).toContainText('Mostrando 1 de 2')
    // o grupo do ano sem emenda visível some (não fica um título "2026" solto)
    await expect(
      page.getByRole('heading', { name: '2026', level: 2 }),
    ).toBeHidden()
    await filtro.getByLabel('Ano').selectOption('')
    await filtro.getByLabel('Situação').selectOption('Em execução')
    await expect(page.locator('li[data-parceria]:visible')).toHaveCount(1)
    await filtro.getByLabel('Situação').selectOption('')
    await expect(page.locator('li[data-parceria]:visible')).toHaveCount(2)
  })

  test('cada emenda leva à própria página', async ({ page }) => {
    await page.goto('/transparencia/emendas/')
    await page.getByRole('link', { name: /Emenda 123\/2026/ }).click()
    await expect(page).toHaveURL(/\/transparencia\/emendas\/1\/$/)
  })
})

test.describe('Página de uma emenda', () => {
  test('valores, parcelas, recebimentos e pagamentos batem com o livro-caixa', async ({
    page,
  }) => {
    await page.goto('/transparencia/emendas/1/')
    await expect(page.locator('h1')).toHaveCount(1)
    expect(reais(await page.locator('[data-valor="total"]').innerText())).toBe(
      'R$ 50.000,00',
    )
    expect(
      reais(await page.locator('[data-valor="recebido"]').innerText()),
    ).toBe('R$ 10.000,00')
    expect(reais(await page.locator('[data-valor="pago"]').innerText())).toBe(
      'R$ 2.015,00',
    )
    expect(reais(await page.locator('[data-valor="saldo"]').innerText())).toBe(
      'R$ 7.985,00',
    )

    const parcelas = page.getByRole('table', {
      name: 'Parcelas previstas e valores recebidos',
    })
    await expect(parcelas.getByRole('row')).toHaveCount(3) // cabeçalho + 2 parcelas
    const pagamentos = page.getByRole('table', {
      name: 'Pagamentos desta parceria',
    })
    await expect(pagamentos.getByRole('row')).toHaveCount(4)
    // a soma das linhas de pagamento é o total pago
    const valores = await pagamentos
      .locator('tbody tr td:last-child')
      .allInnerTexts()
    const soma = valores
      .map((v) =>
        Number(
          reais(v)
            .replace(/[^\d,]/g, '')
            .replace(',', '.'),
        ),
      )
      .reduce((a, b) => a + b, 0)
    expect(soma).toBeCloseTo(2015, 2)
  })

  test('pagamento de equipe sai só com a função; fornecedor com razão social e CNPJ', async ({
    page,
  }) => {
    await page.goto('/transparencia/emendas/1/')
    const pagamentos = page.getByRole('table', {
      name: 'Pagamentos desta parceria',
    })
    await expect(pagamentos).toContainText('Equipe: Oficineiro de música')
    await expect(pagamentos).toContainText(
      'Gráfica Aurora ME (CNPJ 12.345.678/0001-99)',
    )
    const html = await page.content()
    // o histórico interno do livro-caixa e o nome de pessoa nunca chegam ao HTML
    expect(html).not.toMatch(/João da Silva|Pgto /)
  })

  test('avisa que há movimento ainda sendo detalhado, sem mostrar o detalhe', async ({
    page,
  }) => {
    await page.goto('/transparencia/emendas/1/')
    await expect(page.locator('[data-aviso="classificacao"]')).toContainText(
      'Há 1 movimento financeiro ainda não detalhado nas listas abaixo',
    )
    await page.goto('/transparencia/emendas/2/')
    await expect(page.locator('[data-aviso="classificacao"]')).toHaveCount(0)
  })

  test('mostra etapas, a prestação de contas com o prazo de análise e a última atualização', async ({
    page,
  }) => {
    await page.goto('/transparencia/emendas/1/')
    await expect(
      page.getByRole('heading', { name: 'Etapas de execução' }),
    ).toBeVisible()
    await expect(page.getByText('40 pessoas atendidas')).toBeVisible()
    const relatorios = page.getByRole('table', {
      name: 'Relatórios e prestação de contas',
    })
    await expect(relatorios).toContainText('Prestação de contas parcial')
    await expect(relatorios).toContainText('Em análise')
    const atualizacao = page.locator('[data-campo="ultima-atualizacao"]')
    await expect(atualizacao).toContainText('Última atualização')
    // a página não afirma QUEM aprovou por cargo (o sistema exige a permissão, não o cargo)
    await expect(atualizacao).not.toContainText(/Presidente|Secret[áa]rio/)
    await page.goto('/transparencia/emendas/2/')
    await expect(
      page.getByRole('table', { name: 'Relatórios e prestação de contas' }),
    ).toContainText('Regulares com ressalvas')
  })

  test('o documento ligado abre o PDF permanente do próprio site', async ({
    page,
    request,
  }) => {
    await page.goto('/transparencia/emendas/1/')
    const link = page.getByRole('link', {
      name: /Plano de trabalho da Emenda 123\/2026/,
    })
    const href = await link.getAttribute('href')
    expect(href).toBe(
      '/arquivos/transparencia/3-exemplo-plano-de-trabalho-da-emenda-123-2026.pdf',
    )
    const resposta = await request.get(href!)
    expect(resposta.status()).toBe(200)
    expect(resposta.headers()['content-type']).toContain('application/pdf')
    expect((await resposta.body()).subarray(0, 5).toString()).toBe('%PDF-')
    // e o PDF não vem do endereço da API (o site no ar não depende da API acordada)
    expect(href).not.toContain('/api/')
  })

  test('título e descrição cabem no Google e a emenda tem canonical próprio', async ({
    page,
  }) => {
    await page.goto('/transparencia/emendas/1/')
    const titulo = await page.title()
    expect(titulo.length).toBeLessThanOrEqual(70)
    const descricao = await page
      .locator('meta[name="description"]')
      .getAttribute('content')
    expect(descricao!.length).toBeGreaterThanOrEqual(50)
    expect(descricao!.length).toBeLessThanOrEqual(170)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://asaf.org.br/transparencia/emendas/1/',
    )
  })
})

test.describe('Parcerias (termos)', () => {
  test('lista só o que não é emenda, e a página dela abre', async ({
    page,
  }) => {
    await page.goto('/transparencia/parcerias/')
    const titulos = await page
      .locator('main li[data-parceria] h3')
      .allInnerTexts()
    expect(titulos).toEqual(['EXEMPLO – Termo de fomento 9/2026'])
    await page.getByRole('link', { name: /Termo de fomento 9\/2026/ }).click()
    await expect(page).toHaveURL(/\/transparencia\/parcerias\/3\/$/)
    await expect(
      page.getByRole('heading', { name: 'Pagamentos' }),
    ).toBeVisible()
    await expect(
      page.getByText('Nenhum pagamento detalhado até agora.'),
    ).toBeVisible()
    // emenda não tem página em /parcerias/ e termo não tem em /emendas/
    expect(
      (await page.request.get('/transparencia/parcerias/1/')).status(),
    ).toBe(404)
    expect((await page.request.get('/transparencia/emendas/3/')).status()).toBe(
      404,
    )
  })
})

test.describe('Documentos publicados', () => {
  test('organizados por tipo e ano, com link para o PDF permanente', async ({
    page,
  }) => {
    await page.goto('/transparencia/documentos/')
    const tipos = await page
      .locator('main section[data-tipo-grupo] h2')
      .allInnerTexts()
    expect(tipos).toEqual(['Ata', 'Estatuto e alterações', 'Plano de trabalho'])
    const ata = page.getByRole('link', { name: /Ata de eleição da diretoria/ })
    await expect(ata).toHaveAttribute(
      'href',
      '/arquivos/transparencia/2-exemplo-ata-de-eleicao-da-diretoria-2026-2028.pdf',
    )
  })

  test('a busca filtra pelo título, sem acento, e avisa quando não acha nada', async ({
    page,
  }) => {
    await page.goto('/transparencia/documentos/')
    const busca = page.getByRole('search', { name: 'Buscar documentos' })
    await busca.getByLabel('Buscar por título').fill('eleicao')
    await expect(page.locator('li[data-documento]:visible')).toHaveCount(1)
    await expect(
      page.getByRole('heading', { name: 'Estatuto e alterações' }),
    ).toBeHidden()
    await busca.getByLabel('Buscar por título').fill('zzzz')
    await expect(page.getByRole('status')).toContainText(
      'Nenhum documento encontrado.',
    )
    await busca.getByLabel('Buscar por título').fill('')
    await expect(page.locator('li[data-documento]:visible')).toHaveCount(3)
  })

  test('o PDF copiado é exatamente o aprovado (mesmo SHA-256 mostrado na página)', async ({
    page,
    request,
  }) => {
    await page.goto('/transparencia/documentos/')
    const item = page.locator('li[data-documento]', {
      hasText: 'Estatuto Social registrado',
    })
    await item.locator('summary').click()
    const sha = (await item.locator('details p').innerText())
      .replace('SHA-256:', '')
      .trim()
    const href = await item.getByRole('link').first().getAttribute('href')
    const bytes = await (await request.get(href!)).body()
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha)
  })
})

test.describe('Dados abertos', () => {
  test('o CSV tem as colunas combinadas, uma linha por emenda e os mesmos números da página', async ({
    request,
  }) => {
    const resposta = await request.get('/transparencia/dados/emendas.csv')
    expect(resposta.status()).toBe(200)
    expect(resposta.headers()['content-type']).toContain('text/csv')
    const linhas = (await resposta.text()).trim().split('\r\n')
    expect(linhas[0]).toBe(
      'id,ano,tipo,numero_emenda,identificador_unico,proponente,orgao_concedente,titulo,objeto,situacao,numero_termo,valor_total,recebido,pago,saldo,vigencia_inicio,vigencia_fim,ultima_atualizacao,pagina',
    )
    expect(linhas).toHaveLength(3) // cabeçalho + 2 emendas (o termo de fomento fica em parcerias.csv)
    expect(linhas[1]).toContain(',50000,10000,2015,7985,')
    expect(linhas[1]).toContain('https://asaf.org.br/transparencia/emendas/1/')
  })

  test('o JSON traz o detalhe da emenda, e o pagamento de equipe também sai sem nome', async ({
    request,
  }) => {
    const corpo = await (
      await request.get('/transparencia/dados/emendas.json')
    ).json()
    expect(corpo).toHaveLength(2)
    const primeira = corpo.find(
      (e: { id_parceria: number }) => e.id_parceria === 1,
    )
    expect(primeira.pagamentos).toHaveLength(3)
    const equipe = primeira.pagamentos.find(
      (p: { categoria: string }) => p.categoria === 'EQUIPE',
    )
    expect(equipe.funcao).toBe('Oficineiro de música')
    expect(equipe.fornecedor).toBeNull()
    expect(JSON.stringify(corpo)).not.toMatch(
      /João da Silva|id_centro_custo|motivo_recusa|historico/,
    )
  })

  test('a página explica cada coluna e lista os quatro arquivos', async ({
    page,
  }) => {
    await page.goto('/transparencia/dados/')
    await expect(
      page.getByRole('link', { name: 'emendas.csv' }),
    ).toHaveAttribute('href', '/transparencia/dados/emendas.csv')
    await expect(
      page.getByRole('link', { name: 'parcerias.json' }),
    ).toBeVisible()
    const tabela = page.getByRole('table', {
      name: 'Colunas das planilhas de dados abertos',
    })
    await expect(tabela).toContainText('valor_total')
    await expect(tabela).toContainText(
      'Quanto já entrou, segundo o livro-caixa',
    )
  })
})

test.describe('Transparência (página principal) e demais páginas', () => {
  test('mostra os quatro caminhos e o número de emendas, parcerias e documentos', async ({
    page,
  }) => {
    await page.goto('/transparencia/')
    await expect(page.locator('[data-cartao="emendas"]')).toContainText(
      '2 emendas publicadas',
    )
    await expect(page.locator('[data-cartao="parcerias"]')).toContainText(
      '1 parceria publicada',
    )
    await expect(page.locator('[data-cartao="documentos"]')).toContainText(
      '3 documentos publicados',
    )
    await expect(page.locator('[data-cartao="dados"] a')).toHaveAttribute(
      'href',
      '/transparencia/dados/',
    )
    // os documentos aprovados aparecem na lista de documentos publicados, ao lado do Estatuto
    await expect(
      page.getByRole('link', { name: /Ata de eleição da diretoria/ }),
    ).toBeVisible()
    await expect(
      page
        .locator('#conteudo')
        .getByRole('link', { name: 'Estatuto Social', exact: true }),
    ).toBeVisible()
  })

  test('o Contato diz que serve também para pedidos de informação sobre recursos públicos (sem inventar prazo)', async ({
    page,
  }) => {
    await page.goto('/contato/')
    const texto = page.locator('[data-texto="pedido-de-informacao"]')
    await expect(texto).toContainText(
      'pedidos de informação sobre os recursos públicos recebidos',
    )
    await expect(texto).not.toContainText(/prazo|dias úteis|horas/i)
  })

  test('a Home e o rodapé levam às emendas', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('link', { name: 'Emendas parlamentares' }).first(),
    ).toHaveAttribute('href', '/transparencia/emendas/')
    await expect(
      page
        .getByRole('contentinfo')
        .getByRole('link', { name: 'Documentos publicados' }),
    ).toHaveAttribute('href', '/transparencia/documentos/')
  })

  test('nenhuma página da Transparência vaza dado interno do sistema', async ({
    page,
    request,
  }) => {
    const caminhos = [
      '/transparencia/',
      '/transparencia/emendas/',
      '/transparencia/emendas/1/',
      '/transparencia/emendas/2/',
      '/transparencia/parcerias/',
      '/transparencia/parcerias/3/',
      '/transparencia/documentos/',
      '/transparencia/dados/',
    ]
    for (const caminho of caminhos) {
      await page.goto(caminho)
      const html = await page.content()
      expect(html, caminho).not.toMatch(
        /centro de custo|centro_custo|PARC-\d|id_usuario|motivo_recusa|enviado_revisao/i,
      )
      // endereço da API real (e do mock) nunca no HTML: o PDF é do próprio site
      expect(html, caminho).not.toContain('/api/publico/transparencia')
      expect(html, caminho).not.toMatch(/https?:\/\/127\.0\.0\.1:4322/)
    }
    // o CSV/JSON também não
    expect(
      await (await request.get('/transparencia/dados/emendas.csv')).text(),
    ).not.toMatch(/centro_custo/)
  })
})
