import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

import { matrizDoCaminho } from '../src/lib/qr-pix'
import { lerMatriz } from '../tests/ajuda-qr'
import { caminhosIndexaveis } from './paginas'

// v5.6a — doar pelo site com Pix estático, no navegador de verdade, contra o build de teste e a API simulada (`scripts/mock-api.mjs`: as três rotas da doação com as frases e
// os códigos do servidor, o BR Code de verdade, o mesmo pedido devolvendo o mesmo protocolo, 429 e erro de servidor provocados por nome de teste). O que NÃO se pode provocar
// pela API simulada (Pix ainda fechado, API fora do ar, API antiga, resposta de validação do servidor) é provocado trocando a resposta com `page.route`.
// O que a página afirma é o que o servidor faz: a doação só consta depois que a tesouraria confere o Pix no extrato do banco; nada de "na hora" nem de prazo prometido.

const PORTA_DA_API = process.env.MOCK_API_PORT ?? '4322'
const ORIGEM_DA_API = `http://127.0.0.1:${PORTA_DA_API}`
const CAMINHO = '/como-ajudar/doar/'
const NOME_QUE_ESTOURA_O_LIMITE = 'Teste Limite Por IP'
const NOME_QUE_DERRUBA_A_API = 'Teste Erro De Servidor'
const CPF_VALIDO = '390.533.447-05'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']
const CHAVE_PIX = '123e4567-e89b-12d3-a456-426614174000'

const CODIGO_LIVRE =
  '00020126730014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740000211Doacao ASAF5204000053039865802BR5910ASAF TESTE6011PARAUAPEBAS62140510ASAFDOACAO6304C407'

let sequencia = 0
/** Um e-mail que nenhum outro teste usou: o mock devolve o MESMO protocolo para o mesmo pedido, e os testes rodam ao mesmo tempo. */
const emailUnico = () =>
  `doador-${Date.now()}-${++sequencia}-${Math.floor(Math.random() * 1e6)}@example.com`

const anonima = (page: Page) => page.locator('form[data-doacao-anonima]')
const identificada = (page: Page) =>
  page.locator('form[data-doacao-identificada]')
const confirmacao = (page: Page) =>
  page.locator('[data-confirmacao-identificada]')
const resultadoAnonimo = (page: Page) =>
  page.locator('[data-resultado-anonimo]')
const falha = (form: ReturnType<typeof anonima>) =>
  form.locator('[data-falha-do-envio]')

async function abrir(page: Page, largura?: number) {
  if (largura) await page.setViewportSize({ width: largura, height: 800 })
  await page.goto(CAMINHO)
  await expect(
    page.locator('[data-doacao-vivo] > [data-estado="pronto"]'),
  ).toBeVisible()
}

const estadoVisivel = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-estado]')]
      .filter((e) => !e.hidden)
      .map((e) => e.dataset.estado),
  )

async function semViolacoes(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
  ).toEqual([])
}

async function semRolagemLateral(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true)
}

type Corpo = Record<string, unknown>
/** Guarda o corpo de cada pedido identificado que sai da página (e a URL, para provar que não leva dado pessoal). */
function vigiarPedidos(page: Page) {
  const pedidos: Array<{ corpo: Corpo; url: string }> = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/doacoes/intencoes'))
      pedidos.push({ corpo: r.postDataJSON() as Corpo, url: r.url() })
  })
  return pedidos
}

/** Os códigos e consultas da doação sem se identificar que saem da página. */
function vigiarConsultasDoPix(page: Page) {
  const urls: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/publico/doacao/pix')) urls.push(r.url())
  })
  return urls
}

async function preencherIdentificada(
  page: Page,
  extra: {
    nome?: string
    email?: string
    cpf?: string
    campanha?: string
    valor?: string
    aceitar?: boolean
  } = {},
) {
  const form = identificada(page)
  await form.getByLabel('Nome completo').fill(extra.nome ?? 'Maria de Teste')
  await form.getByLabel('E-mail').fill(extra.email ?? emailUnico())
  if (extra.cpf) await form.getByLabel('CPF (opcional)').fill(extra.cpf)
  if (extra.campanha)
    await form
      .getByLabel('Para onde vai a sua doação')
      .selectOption({ label: extra.campanha })
  if (extra.valor) await form.getByLabel('Valor (opcional)').fill(extra.valor)
  if (extra.aceitar !== false)
    await form.getByLabel('Li e aceito o aviso de privacidade.').check()
}

const enviarIdentificada = (page: Page) =>
  identificada(page)
    .getByRole('button', { name: 'Enviar e ver o código Pix' })
    .click()

/** Lê o QR Code que está NA PÁGINA (o `d` do path do SVG, no navegador) e devolve o texto que ele carrega. */
async function textoDoQr(container: ReturnType<Page['locator']>) {
  const svg = container.locator('svg[data-qr-pix]')
  const lado = Number((await svg.getAttribute('viewBox'))!.split(' ')[2])
  const d = (await svg.locator('path').getAttribute('d'))!
  return lerMatriz(matrizDoCaminho(d, lado))
}

async function trocarResposta(
  page: Page,
  padrao: string,
  alterar: (corpo: any) => any,
) {
  await page.route(padrao, async (rota: Route) => {
    const resposta = await rota.fetch()
    await rota.fulfill({
      response: resposta,
      json: alterar(await resposta.json()),
    })
  })
}

test.describe('a página Doar (o que ela explica, sem depender da API)', () => {
  test('título, migalhas, as duas formas de doar e as ressalvas honestas', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await expect(page).toHaveTitle(/^Doar \| ASAF$/)
    await expect(
      page.getByRole('heading', { name: 'Doar', level: 1 }),
    ).toBeVisible()
    const trilha = page.getByRole('navigation', { name: 'Você está em' })
    await expect(trilha.getByRole('link', { name: 'Início' })).toBeVisible()
    await expect(
      trilha.getByRole('link', { name: 'Como ajudar' }),
    ).toHaveAttribute('href', '/como-ajudar/')
    await expect(trilha.locator('[aria-current="page"]')).toHaveText('Doar')

    const sem = page.locator('[data-forma="sem-identificar"]')
    await expect(sem.getByRole('heading', { level: 3 })).toHaveText(
      'Sem se identificar',
    )
    await expect(sem).toContainText('não registra a sua doação')
    await expect(sem).toContainText('o site não tem como mandar o recibo')
    await expect(sem).toContainText(
      'como em qualquer Pix, o extrato do banco da associação mostra quem pagou',
    )
    const com = page.locator('[data-forma="identificando-se"]')
    await expect(com.getByRole('heading', { level: 3 })).toHaveText(
      'Identificando-se',
    )
    await expect(com).toContainText(
      'nome completo, o e-mail e, se quiser, o CPF',
    )
    await expect(com).toContainText('Recebe um protocolo e o código Pix')
    await expect(com).toContainText(
      'Depois que a tesouraria da associação encontrar o seu Pix no extrato do banco e confirmar, a doação passa a constar no sistema',
    )
    await expect(com).toContainText(
      'O sistema tenta enviá-lo para o seu e-mail',
    )

    const antes = page.locator('[data-antes-de-doar]')
    for (const trecho of [
      'O Pix cai direto na conta da associação.',
      'Nada avisa o sistema quando você paga',
      'quem registra a doação é a tesouraria, depois de conferir o extrato do banco',
      'Não é instantâneo, e não há prazo prometido.',
      'citando o protocolo',
      'O pedido não é uma doação.',
      'Confira quem vai receber antes de pagar.',
      'Se for outro nome, não pague.',
      'O recibo não é declaração para abater imposto.',
      'não constitui, por si só, declaração de dedutibilidade fiscal',
      'situação tributária da entidade',
      'integralmente aplicados no território brasileiro',
    ])
      await expect(antes).toContainText(trecho)
    await expect(
      antes.getByRole('link', { name: 'Veja como a ASAF presta contas' }),
    ).toHaveAttribute('href', '/transparencia/')
    await expect(
      antes.getByRole('link', { name: 'Política de Privacidade' }),
    ).toHaveAttribute('href', '/privacidade/#doacao-pelo-site')
    await expect(
      page.getByRole('link', { name: /Ir para a doação/ }),
    ).toHaveAttribute('href', '#doar-agora')
  })

  test('não promete o que o servidor não faz: nada de "na hora", prazo de confirmação ou recibo garantido', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await expect(page.locator('[data-antes-de-doar]')).toBeVisible()
    const texto = await page.locator('main').innerText()
    expect(texto).not.toMatch(
      /na hora|imediat|automaticamente|em até \d+ (dias|horas)|garantid/i,
    )
    // o recibo e o e-mail são sempre "tenta"/"se chegar", nunca certezas
    expect(texto).not.toMatch(/você receber[áa] o recibo|enviaremos o recibo/i)
    // a chave Pix e o beneficiário nunca estão escritos na página estática: vêm da API
    const estatico = await (await page.request.get(CAMINHO)).text()
    expect(estatico.length).toBeGreaterThan(1000)
    expect(estatico).not.toContain(CHAVE_PIX)
    expect(estatico).not.toContain('ASAF TESTE')
  })

  test('entra no sitemap e tem o contato da secretaria', async ({ page }) => {
    expect(caminhosIndexaveis()).toContain(CAMINHO)
    await page.goto(CAMINHO)
    const fale = page.getByRole('region', {
      name: 'Prefere doar de outro jeito?',
    })
    await expect(fale.locator('a[href="tel:+5594984120703"]')).toBeVisible()
    await expect(fale.locator('a[href^="mailto:"]')).toBeVisible()
  })

  test('Como ajudar leva até ela por um destaque claro e pelo cartão; o rodapé também', async ({
    page,
  }) => {
    await page.goto('/como-ajudar/')
    const chamada = page.locator('[data-chamada-para-doar]')
    await expect(
      chamada.getByRole('heading', { name: 'Doar pelo Pix', level: 2 }),
    ).toBeVisible()
    await expect(
      chamada.getByRole('link', { name: 'Quero doar' }),
    ).toHaveAttribute('href', CAMINHO)
    await expect(chamada).toContainText(
      'mostra se a doação pelo site está aberta',
    )
    // o texto antigo, que mandava só falar com a secretaria, saiu
    await expect(page.locator('main')).not.toContainText(
      'A doação pelo site ainda não está disponível',
    )
    await expect(
      page.locator('main').getByRole('link', { name: /Veja como doar/ }),
    ).toHaveAttribute('href', CAMINHO)
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'Doar' }),
    ).toHaveAttribute('href', CAMINHO)
    await page.setViewportSize({ width: 375, height: 800 })
    await semRolagemLateral(page)
  })

  test('sem JavaScript: a explicação e o contato ficam; a parte ao vivo e os formulários não aparecem e o aviso manda falar com a associação', async ({
    browser,
  }) => {
    const contexto = await browser.newContext({ javaScriptEnabled: false })
    const page = await contexto.newPage()
    await page.goto(CAMINHO)
    await expect(page.locator('[data-antes-de-doar]')).toBeVisible()
    await expect(page.locator('[data-doacao-vivo]')).toBeHidden()
    await expect(page.locator('form')).toHaveCount(2)
    await expect(page.locator('form[data-doacao-identificada]')).toBeHidden()
    const aviso = page.locator('noscript p[data-sem-javascript]')
    await expect(aviso).toBeVisible()
    expect(await aviso.evaluate((el) => el.textContent)).toContain(
      'é preciso ativar o JavaScript',
    )
    await expect(
      page
        .getByRole('region', { name: 'Prefere doar de outro jeito?' })
        .locator('a[href^="tel:"]'),
    ).toBeVisible()
    await contexto.close()
  })
})

test.describe('a Política de Privacidade 2.0 (a doação pelo site)', () => {
  test('"Por quanto tempo guardamos" lista os prazos que a rotina aplica, e só esses, com o limite dito com franqueza', async ({
    page,
  }) => {
    await page.goto('/privacidade/')
    const lista = page.locator('[data-prazos-de-guarda]')
    await expect(lista).toBeVisible()
    await expect(lista.locator('li')).toHaveCount(9)
    for (const trecho of [
      'Endereço de rede (IP) guardado no controle do limite de pedidos dos formulários públicos: 6 meses, depois é apagado. O IP que também fica na Auditoria do sistema ainda não tem prazo de eliminação automática.',
      'Avisos do sino do painel (da equipe e dos associados; podem trazer o nome de quem pediu): 1 ano, depois são apagados.',
      // v6.1 (Política 2.4): a prova de leitura do mural de avisos do painel
      'Registro de quem recebeu, leu e confirmou um aviso do mural do painel: 5 anos depois de o aviso sair do mural (vencer ou ser retirado), a lista de quem o recebeu, com as datas de leitura e de confirmação, é apagada; ficam o aviso e os totais. A confirmação de leitura também fica registrada na Auditoria do sistema, que ainda não tem prazo de eliminação automática.',
      '(contato, informação, solicitação de titular e voluntariado): 5 anos depois de respondidos ou encerrados, apagamos o nome, o assunto, a mensagem, a resposta, o motivo do encerramento e os dados de contato e de identificação (e-mail, telefone, CPF, data de nascimento); ficam o número do protocolo, o tipo, a situação e as datas. O pedido que ainda não foi respondido nem encerrado não é apagado.',
      'Pedido de filiação que não virou associado (recusado, ou pendente sem decisão): 2 anos depois da última mudança no pedido ou no voto de um sócio, ele e as decisões dos sócios sobre ele são apagados',
      'Pedido de doação pelo site que ninguém confirmou: 2 anos depois do prazo do pedido, é apagado.',
      // v7.1b (Política 2.11): a prova de um consentimento que acabou
      'Prova de um consentimento que acabou (a autorização de imagem retirada, a foto apagada ou o mandato terminado): 5 anos depois de acabar, é apagada.',
      'Doador identificado: 10 anos depois da doação, tiramos o nome, o documento, o e-mail e a ligação com o cadastro de associado; ficam o valor, a data e o destino',
      'Associado desligado: 5 anos depois do desligamento, apagamos CPF, e-mail, telefone, data de nascimento, estado civil, profissão, naturalidade, as habilidades cadastradas, a foto (inclusive o arquivo), o endereço e, nas mudanças de situação (licença, desligamento, advertência), o motivo e o documento de referência; ficam o nome e a matrícula do livro de associados e o tipo e as datas das mudanças de situação. A rotina automática não inclui quem ainda tem outro papel ativo no cadastro (por exemplo, voluntário). Ainda não há prazo automático para os dependentes cadastrados, os documentos anexados, o histórico de cargos, a linha do tempo da pessoa e as observações internas da ficha.',
    ])
      await expect(lista).toContainText(trecho)
    await expect(
      page.locator('[data-prazos-de-guarda-introducao]'),
    ).toContainText(
      'Os prazos abaixo são os de hoje: ficam nas Regras do sistema, a Presidência pode ajustá-los e nenhum fica abaixo de 30 dias. O que é apagado ainda fica, por até 35 dias, nas cópias de segurança do banco de dados, que não são públicas.',
    )
    await expect(page.locator('[data-prazos-de-guarda-limite]')).toContainText(
      'Ainda não há rotina automática de prazo para os demais dados (por exemplo, quem só se inscreveu em um evento, voluntários, certificados, a Auditoria do sistema e o pedido de filiação aprovado)',
    )
  })

  test('versão 2.11 e o parágrafo da doação, com SÓ o que o servidor faz', async ({
    page,
  }) => {
    await page.goto('/privacidade/')
    await expect(
      page.getByText('Versão 2.11 · em vigor desde 27 de outubro de 2026'),
    ).toBeVisible()
    await expect(
      page.getByText(
        /Esta é a versão 2\.11, em vigor desde 27 de outubro de 2026/,
      ),
    ).toBeVisible()
    const paragrafo = page.locator('[data-doacao]')
    await expect(paragrafo).toHaveCount(1)
    await expect(paragrafo).toHaveAttribute('id', 'doacao-pelo-site')
    for (const trecho of [
      'Sem se identificar: o site só mostra o código Pix e o QR Code (desenhado no seu navegador) e não grava nenhum dado pessoal seu no sistema da ASAF',
      'como em qualquer Pix, o extrato do banco da associação mostra quem pagou',
      'Identificando-se: o formulário pede nome completo, e-mail e, se você quiser, CPF, valor e campanha',
      'o seu aceite do aviso de privacidade (a versão do aviso e o momento do aceite)',
      'um código calculado a partir do pedido, que serve só para reconhecer o mesmo pedido enviado duas vezes',
      'o endereço IP de quem envia fica registrado, por segurança, no controle do limite de pedidos por hora e na Auditoria do sistema',
      'conferir o seu Pix no extrato do banco da associação, registrar a doação e emitir o recibo, que o sistema tenta enviar por e-mail',
      'quem tem a permissão do financeiro',
      'O que nos autoriza a tratar esses dados é o seu pedido de doação (LGPD, art. 7º, V) e, depois que a tesouraria confirma a doação, a escrituração contábil e financeira dela, que a lei obriga a guardar (art. 7º, II)',
      'passa a ser marcado como “prazo vencido” depois dos dias informados na página (o padrão é 15), por uma rotina que roda algumas vezes ao dia, e continua guardado no sistema',
      'até 2 anos depois do prazo do pedido (é o prazo de hoje), quando o sistema o apaga sozinho',
      'a doação já confirmada faz parte da escrituração contábil',
      'o pagamento em si passa pelo banco que você mesmo escolhe',
    ])
      await expect(paragrafo).toContainText(trecho)
    await expect(
      paragrafo.getByRole('link', { name: 'solicitação do titular de dados' }),
    ).toHaveAttribute('href', '/privacidade/solicitacao-do-titular/')
    await expect(paragrafo.getByRole('link', { name: 'Doar' })).toHaveAttribute(
      'href',
      CAMINHO,
    )
    // nenhuma promessa de eliminação nem de prazo de guarda
    const texto = (await paragrafo.innerText()).replace(/\s+/g, ' ')
    expect(texto).not.toMatch(
      /serão apagad|apagaremos|apagados? (em|após|depois de) \d|eliminad\w* (em|após) \d|guardad\w* por \d|por (cinco|\d+) anos/i,
    )
    // os formulários contados pela Política são sete, e a doação sem identificação não pede dado
    await expect(page.locator('main')).toContainText(
      'sete formulários que pedem dados pessoais',
    )
    await expect(page.locator('main')).toContainText(
      'a doação sem se identificar não pede dado nenhum',
    )
    await expect(page.locator('main')).toContainText(
      'Campanhas e Pix da doação.',
    )
    expect(await page.locator('main').innerText()).not.toContain(
      'Esta é a versão 1.10',
    )
  })

  test('o aviso do formulário leva ao parágrafo da Política', async ({
    page,
  }) => {
    await abrir(page)
    const aviso = page.locator('#doar-identificada-aviso')
    await expect(aviso).toContainText('Aviso de privacidade (versão 2)')
    const link = aviso.getByRole('link', { name: 'Política de Privacidade' })
    await expect(link).toHaveAttribute('href', '/privacidade/#doacao-pelo-site')
    await link.click()
    await expect(page).toHaveURL(/\/privacidade\/#doacao-pelo-site$/)
    await expect(page.locator('#doacao-pelo-site')).toBeInViewport()
  })
})

test.describe('as campanhas em andamento', () => {
  test('cada campanha mostra título, descrição, meta, quanto já foi recebido, prazo, uma barra de progresso e o percentual em texto', async ({
    page,
  }) => {
    await abrir(page)
    const itens = page.locator('[data-campanha]')
    await expect(itens).toHaveCount(3)
    const a = page.locator('[data-campanha="1"]')
    await expect(a.getByRole('heading', { level: 4 })).toHaveText(
      'Campanha de teste — cestas básicas',
    )
    await expect(a).toContainText('campanha de cestas básicas para famílias')
    await expect(a.locator('[data-meta]')).toHaveText('R$ 10.000,00')
    await expect(a.locator('[data-recebido]')).toHaveText('R$ 2.500,00')
    // v5.7g: o aplicado (o total gasto no centro de custo da campanha) aparece logo abaixo do recebido
    await expect(a.locator('[data-aplicado]')).toHaveText('R$ 1.800,50')
    await expect(a.getByText('Já aplicado')).toBeVisible()
    await expect(a.locator('[data-prazo]')).toHaveText(
      /^Até \d{2}\/\d{2}\/\d{4}$/,
    )
    await expect(a.locator('[data-percentual]')).toHaveText('25% da meta.')
    const barra = a.locator('progress')
    await expect(barra).toHaveAttribute('max', '10000')
    await expect(barra).toHaveAttribute('value', '2500')
    // a barra tem nome (o título da campanha) e o valor falado é o do texto
    await expect(barra).toHaveAccessibleName(
      'Campanha de teste — cestas básicas',
    )
    await expect(barra).toHaveAttribute('aria-valuetext', '25% da meta.')
    await expect(page.locator('[data-nota-recebido]')).toContainText(
      '“Já recebido” conta só as doações em dinheiro que a tesouraria já conferiu e registrou no sistema',
    )
    await expect(page.locator('[data-nota-recebido]')).toContainText(
      '“Já aplicado” é o total que a tesouraria já registrou como gasto ligado à campanha',
    )
  })

  test('meta ultrapassada (120%): a barra fica cheia e o texto diz o percentual de verdade; sem prazo diz isso; sem descrição não inventa', async ({
    page,
  }) => {
    await abrir(page)
    const b = page.locator('[data-campanha="2"]')
    await expect(b.locator('[data-percentual]')).toHaveText(
      '120% da meta: a meta já foi ultrapassada.',
    )
    await expect(b.locator('progress')).toHaveAttribute('value', '5000')
    await expect(b.locator('progress')).toHaveAttribute('max', '5000')
    await expect(b.locator('[data-recebido]')).toHaveText('R$ 6.000,00')
    // sem centro de custo, o gasto não é acompanhado à parte, e a página diz isso (não inventa um zero)
    await expect(b.locator('[data-aplicado]')).toHaveText(
      'não acompanhado à parte',
    )
    await expect(b.locator('[data-prazo]')).toHaveText('Sem prazo definido')
    await expect(b.locator('p')).toHaveCount(1) // só o percentual: nada de descrição inventada
    const c = page.locator('[data-campanha="3"]')
    await expect(c.locator('[data-percentual]')).toHaveText('0% da meta.')
    await expect(c.locator('[data-recebido]')).toHaveText('R$ 0,00')
    await expect(c.locator('[data-aplicado]')).toHaveText('R$ 0,00')
  })

  test('as campanhas aparecem nas duas listas de escolha dos formulários', async ({
    page,
  }) => {
    await abrir(page)
    for (const form of [anonima(page), identificada(page)]) {
      const opcoes = await form.locator('select option').allTextContents()
      expect(opcoes).toEqual([
        'Para a associação, sem campanha',
        'Campanha de teste — cestas básicas',
        'Campanha de teste — meta ultrapassada',
        'Campanha de teste — recém-aberta',
      ])
    }
  })

  test('campanha encerrada nunca aparece, mesmo que a API a mande', async ({
    page,
  }) => {
    await trocarResposta(page, '**/api/publico/doacao', (corpo) => ({
      ...corpo,
      campanhas: [
        ...corpo.campanhas,
        {
          id_campanha: 99,
          titulo: 'Campanha ENCERRADA de teste',
          descricao: null,
          meta_valor: 100,
          valor_arrecadado: 100,
          percentual: 100,
          prazo: '2020-01-01',
        },
      ],
    }))
    await abrir(page)
    await expect(page.locator('[data-campanha]')).toHaveCount(3)
    await expect(page.locator('main')).not.toContainText('ENCERRADA')
  })

  test('sem campanha em andamento: diz que dá para doar para a associação e esconde a nota do recebido', async ({
    page,
  }) => {
    await trocarResposta(page, '**/api/publico/doacao', (corpo) => ({
      ...corpo,
      campanhas: [],
    }))
    await abrir(page)
    await expect(page.locator('[data-sem-campanhas]')).toContainText(
      'No momento não há nenhuma campanha em andamento. Você pode doar para a associação, sem campanha.',
    )
    await expect(page.locator('[data-nota-recebido]')).toBeHidden()
    await expect(page.locator('[data-campanha]')).toHaveCount(0)
    await semViolacoes(page)
  })

  test('texto de campanha com HTML aparece como texto e não executa', async ({
    page,
  }) => {
    await trocarResposta(page, '**/api/publico/doacao', (corpo) => ({
      ...corpo,
      campanhas: [
        {
          ...corpo.campanhas[0],
          titulo: '<img src=x onerror="window.__invasao=1">Título',
          descricao: '<script>window.__invasao=2</script>Descrição',
        },
      ],
    }))
    await abrir(page)
    await expect(page.locator('[data-campanha] h4')).toContainText(
      '<img src=x onerror="window.__invasao=1">Título',
    )
    await expect(page.locator('[data-campanha] img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__invasao)).toBeUndefined()
  })
})

test.describe('doar sem se identificar', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  test('sem valor e sem campanha: o código livre, o QR Code que carrega esse código, a chave, o beneficiário e a cidade', async ({
    page,
  }) => {
    const consultas = vigiarConsultasDoPix(page)
    await abrir(page)
    await anonima(page)
      .getByRole('button', { name: 'Mostrar o código Pix' })
      .click()
    const resultado = resultadoAnonimo(page)
    await expect(resultado).toBeVisible()
    await expect(resultado).toBeFocused()
    expect(consultas).toEqual([`${ORIGEM_DA_API}/api/publico/doacao/pix`])
    await expect(resultado).toContainText(
      'Como você não se identificou, o site não guarda nada sobre você e não manda recibo.',
    )
    await expect(resultado.locator('[data-codigo-pix]')).toHaveText(
      CODIGO_LIVRE,
    )
    await expect(resultado.locator('[data-valor-pix]')).toHaveText(
      'Sem valor definido: você digita o valor no aplicativo do seu banco.',
    )
    await expect(resultado.locator('[data-chave-pix]')).toHaveText(CHAVE_PIX)
    await expect(resultado.locator('[data-beneficiario]')).toHaveText(
      'ASAF TESTE',
    )
    await expect(resultado.locator('[data-cidade]')).toHaveText('PARAUAPEBAS')
    // o QR tem texto alternativo e carrega EXATAMENTE o código que está escrito ao lado
    const qr = resultado.locator('svg[data-qr-pix]')
    await expect(qr).toHaveAttribute('role', 'img')
    await expect(qr).toHaveAttribute('aria-label', /QR Code do Pix da ASAF/)
    expect(await textoDoQr(resultado)).toBe(CODIGO_LIVRE)
    // a política de conteúdo do site não deixa estilo escrito na página: o SVG não usa nenhum
    expect(
      await qr.evaluate((svg) =>
        [svg, ...svg.querySelectorAll('*')].some((e) =>
          e.hasAttribute('style'),
        ),
      ),
    ).toBe(false)
  })

  test('com valor e campanha: a consulta leva só valor e campanha, o código traz os dois e o painel diz o valor', async ({
    page,
  }) => {
    const consultas = vigiarConsultasDoPix(page)
    await abrir(page)
    const form = anonima(page)
    await form
      .getByLabel('Para onde vai a sua doação')
      .selectOption({ label: 'Campanha de teste — cestas básicas' })
    await form.getByLabel('Valor (opcional)').fill('R$ 25,50')
    await form.getByRole('button', { name: 'Mostrar o código Pix' }).click()
    const resultado = resultadoAnonimo(page)
    await expect(resultado).toBeVisible()
    expect(consultas).toEqual([
      `${ORIGEM_DA_API}/api/publico/doacao/pix?valor=25.50&id_campanha=1`,
    ])
    await expect(resultado.locator('[data-valor-pix]')).toContainText(
      /Valor: R\$\s25,50\. Ele já está dentro do código\./,
    )
    const codigo = (await resultado.locator('[data-codigo-pix]').textContent())!
    expect(codigo).toContain('540525.50')
    expect(codigo).toContain('ASAFCAMP1')
    expect(await textoDoQr(resultado)).toBe(codigo)
  })

  test('o botão Copiar põe o código inteiro na área de transferência e avisa em uma região role="status"', async ({
    page,
  }) => {
    await abrir(page)
    await anonima(page)
      .getByRole('button', { name: 'Mostrar o código Pix' })
      .click()
    const resultado = resultadoAnonimo(page)
    const aviso = resultado.locator('[data-aviso-da-copia]')
    await expect(aviso).toHaveAttribute('role', 'status')
    await expect(aviso).toHaveText('')
    await resultado.getByRole('button', { name: 'Copiar o código' }).click()
    await expect(aviso).toHaveText(
      'Copiado. Agora é só colar no aplicativo do seu banco.',
    )
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      CODIGO_LIVRE,
    )
  })

  test('sem a área de transferência do navegador: usa a alternativa e ainda avisa', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined })
    })
    await abrir(page)
    await anonima(page)
      .getByRole('button', { name: 'Mostrar o código Pix' })
      .click()
    const resultado = resultadoAnonimo(page)
    await resultado.getByRole('button', { name: 'Copiar o código' }).click()
    const aviso = resultado.locator('[data-aviso-da-copia]')
    await expect(aviso).toHaveText(
      /^(Copiado\. Agora é só colar no aplicativo do seu banco\.|Não consegui copiar sozinho\. O texto está selecionado: toque nele, segure e escolha “Copiar”\.)$/,
    )
    // de um jeito ou de outro, o código fica selecionado (dá para copiar com o dedo)
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(
      CODIGO_LIVRE,
    )
  })

  test('valor que não vale: a página aponta o campo, foca nele e nem consulta a API; corrigir apaga o aviso', async ({
    page,
  }) => {
    const consultas = vigiarConsultasDoPix(page)
    await abrir(page)
    const form = anonima(page)
    const valor = form.getByLabel('Valor (opcional)')
    for (const [texto, trecho] of [
      ['dez reais', 'Confira o valor: escreva só números'],
      ['0', 'O valor da doação precisa ser maior que zero.'],
      [
        '1.000.000,01',
        'Esse valor é alto demais para o Pix pelo site: fale com a secretaria.',
      ],
    ] as const) {
      await valor.fill(texto)
      await form.getByRole('button', { name: 'Mostrar o código Pix' }).click()
      await expect(form.locator('[data-erro="valor"]')).toHaveText(
        new RegExp(trecho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      )
      await expect(valor).toBeFocused()
      await expect(valor).toHaveAttribute('aria-invalid', 'true')
      await expect(valor).toHaveAttribute(
        'aria-describedby',
        'doar-anonima-dica-valor doar-anonima-erro-valor',
      )
    }
    expect(consultas).toEqual([])
    await valor.fill('50')
    await expect(form.locator('[data-erro="valor"]')).toBeHidden()
    await expect(valor).not.toHaveAttribute('aria-invalid', 'true')
    await expect(resultadoAnonimo(page)).toBeHidden()
  })

  test('mexer no valor depois de gerar o código tira o código antigo da tela', async ({
    page,
  }) => {
    await abrir(page)
    const form = anonima(page)
    await form.getByRole('button', { name: 'Mostrar o código Pix' }).click()
    await expect(resultadoAnonimo(page)).toBeVisible()
    await form.getByLabel('Valor (opcional)').fill('10')
    await expect(resultadoAnonimo(page)).toBeHidden()
  })

  test('a API recusa a campanha (400): a frase da API num alerta, o foco nele e o botão volta', async ({
    page,
  }) => {
    await abrir(page)
    await page.route('**/api/publico/doacao/pix*', (rota) =>
      rota.fulfill({
        status: 400,
        json: {
          detail:
            'Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.',
        },
      }),
    )
    const form = anonima(page)
    await form.getByRole('button', { name: 'Mostrar o código Pix' }).click()
    const alerta = falha(form)
    await expect(alerta).toHaveText(
      'Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.',
    )
    await expect(alerta).toBeFocused()
    await expect(alerta).toHaveAttribute('role', 'alert')
    await expect(
      form.getByRole('button', { name: 'Mostrar o código Pix' }),
    ).toBeEnabled()
    await expect(resultadoAnonimo(page)).toBeHidden()
  })

  test('sem rede: orientação humana e a saída pela secretaria', async ({
    page,
  }) => {
    await abrir(page)
    await page.route('**/api/publico/doacao/pix*', (rota) => rota.abort())
    const form = anonima(page)
    await form.getByRole('button', { name: 'Mostrar o código Pix' }).click()
    await expect(falha(form)).toContainText(
      'Não foi possível gerar o código agora',
    )
    await expect(falha(form)).toContainText('fale com a secretaria')
  })

  test('duplo clique: uma consulta só', async ({ page }) => {
    const consultas = vigiarConsultasDoPix(page)
    await abrir(page)
    await page.route('**/api/publico/doacao/pix*', async (rota) => {
      await new Promise((r) => setTimeout(r, 600))
      await rota.continue()
    })
    const botao = anonima(page).getByRole('button', {
      name: /Mostrar o código Pix|Gerando/,
    })
    await botao.dblclick()
    await expect(botao).toBeDisabled()
    await expect(resultadoAnonimo(page)).toBeVisible()
    expect(consultas).toHaveLength(1)
  })
})

test.describe('doar se identificando', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  test('mostra o formulário com os campos certos, o aviso de privacidade com a versão da API e a armadilha de robô escondida de verdade', async ({
    page,
  }) => {
    await abrir(page)
    const form = identificada(page)
    for (const rotulo of [
      'Nome completo',
      'E-mail',
      'CPF (opcional)',
      'Para onde vai a sua doação',
      'Valor (opcional)',
    ])
      await expect(form.getByLabel(rotulo)).toBeVisible()
    await expect(form.getByLabel('Valor (opcional)')).toHaveAttribute(
      'inputmode',
      'decimal',
    )
    await expect(form.getByLabel('Nome completo')).toHaveAttribute(
      'autocomplete',
      'name',
    )
    await expect(form.getByLabel('E-mail')).toHaveAttribute('type', 'email')
    // o aviso, com a versão que a API mandou ler, o que se guarda e para quê
    const aviso = page.locator('#doar-identificada-aviso')
    await expect(aviso).toContainText('Aviso de privacidade (versão 2)')
    for (const trecho of [
      'Vamos guardar o seu nome, o seu e-mail, o CPF (se você informar), o valor e a campanha que escolheu, o seu aceite deste aviso e o endereço de internet (IP) de onde veio o pedido.',
      'para conferir o seu Pix no extrato do banco da associação, registrar a doação e emitir o recibo, que tentamos enviar por e-mail. Se o CPF for de um associado, a doação fica ligada ao cadastro dele',
      'Quem confere é a tesouraria da associação.',
      'continua guardado no sistema por um prazo (hoje, 2 anos depois do prazo do pedido) e depois o sistema o apaga sozinho',
    ])
      await expect(aviso).toContainText(trecho)
    await expect(
      aviso.getByRole('link', { name: 'solicitação do titular de dados' }),
    ).toHaveAttribute('href', '/privacidade/solicitacao-do-titular/')
    await expect(
      form.getByLabel('Li e aceito o aviso de privacidade.'),
    ).not.toBeChecked()
    // a armadilha: fora da tela, escondida do leitor de tela e fora da ordem do Tab
    const armadilha = form.locator('input[name="pagina_web"]')
    await expect(armadilha).toHaveAttribute('tabindex', '-1')
    await expect(armadilha).toHaveAttribute('autocomplete', 'off')
    await expect(
      armadilha.locator('xpath=ancestor::div[@aria-hidden="true"]'),
    ).toHaveCount(1)
    expect(
      await armadilha.evaluate((el) => el.getBoundingClientRect().left),
    ).toBeLessThan(-1000)
    await expect(confirmacao(page)).toBeHidden()
    // a ordem do Tab nunca para na armadilha
    await form.getByLabel('Li e aceito o aviso de privacidade.').focus()
    await page.keyboard.press('Tab')
    await expect(
      form.getByRole('button', { name: 'Enviar e ver o código Pix' }),
    ).toBeFocused()
  })

  test('enviar em branco: avisa o que falta, resume, foca o primeiro campo, liga cada aviso ao campo e não chama a API', async ({
    page,
  }) => {
    const pedidos = vigiarPedidos(page)
    await abrir(page)
    await enviarIdentificada(page)
    const form = identificada(page)
    await expect(form.locator('[data-resumo-de-erros]')).toHaveText(
      'Há 3 campos para corrigir.',
    )
    const nome = form.getByLabel('Nome completo')
    await expect(nome).toBeFocused()
    await expect(nome).toHaveAttribute('aria-invalid', 'true')
    await expect(nome).toHaveAttribute(
      'aria-describedby',
      'doar-identificada-erro-nome',
    )
    await expect(form.locator('#doar-identificada-erro-nome')).toHaveText(
      'Informe o seu nome completo.',
    )
    await expect(form.locator('#doar-identificada-erro-email')).toHaveText(
      'Esse e-mail não parece certo: confira se está escrito sem erro.',
    )
    await expect(
      form.locator('#doar-identificada-erro-consentimento'),
    ).toHaveText(
      'Para continuar, é preciso ler e aceitar o aviso de privacidade.',
    )
    // CPF, valor e campanha são opcionais
    for (const opcional of ['cpf', 'valor', 'campanha'])
      await expect(
        form.locator(`#doar-identificada-erro-${opcional}`),
      ).toBeHidden()
    expect(pedidos).toEqual([])
    // o estado de erro também passa no axe, no computador e no celular
    await semViolacoes(page)
    await page.setViewportSize({ width: 375, height: 800 })
    await semViolacoes(page)
    await semRolagemLateral(page)
  })

  test('cada erro de campo, com a frase do servidor: nome curto, e-mail, CPF, valor e o aceite', async ({
    page,
  }) => {
    const pedidos = vigiarPedidos(page)
    await abrir(page)
    const form = identificada(page)
    await preencherIdentificada(page, {
      nome: 'Ma',
      email: 'sem-arroba',
      cpf: '111.444.777-36',
      valor: 'dez',
      aceitar: false,
    })
    await enviarIdentificada(page)
    await expect(form.locator('#doar-identificada-erro-nome')).toHaveText(
      'Informe o seu nome completo.',
    )
    await expect(form.locator('#doar-identificada-erro-email')).toHaveText(
      'Esse e-mail não parece certo: confira se está escrito sem erro.',
    )
    await expect(form.locator('#doar-identificada-erro-cpf')).toHaveText(
      'Esse CPF não confere: confira os números ou deixe em branco.',
    )
    await expect(form.locator('#doar-identificada-erro-valor')).toContainText(
      'Confira o valor: escreva só números',
    )
    await expect(
      form.locator('#doar-identificada-erro-consentimento'),
    ).toContainText('aceitar o aviso de privacidade')
    await expect(form.locator('[data-resumo-de-erros]')).toHaveText(
      'Há 5 campos para corrigir.',
    )
    await expect(form.getByLabel('Nome completo')).toBeFocused()
    // corrigir um campo apaga o aviso dele na hora; o foco segue a ordem da página
    await form.getByLabel('Nome completo').fill('Maria de Teste')
    await expect(form.locator('#doar-identificada-erro-nome')).toBeHidden()
    await expect(form.locator('[data-resumo-de-erros]')).toHaveText(
      'Há 4 campos para corrigir.',
    )
    await form.getByLabel('E-mail').fill(emailUnico())
    await enviarIdentificada(page)
    await expect(form.getByLabel('CPF (opcional)')).toBeFocused()
    await form.getByLabel('CPF (opcional)').fill('')
    await enviarIdentificada(page)
    await expect(form.getByLabel('Valor (opcional)')).toBeFocused()
    await form.getByLabel('Valor (opcional)').fill('0')
    await enviarIdentificada(page)
    await expect(form.locator('#doar-identificada-erro-valor')).toHaveText(
      'O valor da doação precisa ser maior que zero.',
    )
    await form.getByLabel('Valor (opcional)').fill('')
    await enviarIdentificada(page)
    await expect(
      form.getByLabel('Li e aceito o aviso de privacidade.'),
    ).toBeFocused()
    expect(pedidos).toEqual([])
    await form.getByLabel('Li e aceito o aviso de privacidade.').check()
    await expect(
      form.locator('#doar-identificada-erro-consentimento'),
    ).toBeHidden()
  })

  test('pedido certo: o corpo leva os dados limpos, a versão do aviso e a armadilha vazia; nada de dado pessoal na URL', async ({
    page,
  }) => {
    const pedidos = vigiarPedidos(page)
    await abrir(page)
    const email = emailUnico()
    await preencherIdentificada(page, {
      nome: '  Maria   de  Teste ',
      email,
      cpf: CPF_VALIDO,
      campanha: 'Campanha de teste — cestas básicas',
      valor: '25,50',
    })
    await enviarIdentificada(page)
    await expect(confirmacao(page)).toBeVisible()
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]!.corpo).toEqual({
      nome_completo: 'Maria de Teste',
      email,
      cpf: '39053344705',
      valor: 25.5,
      id_campanha: 1,
      consentimento_lgpd: true,
      versao_texto_consentimento: '2',
      pagina_web: '',
    })
    expect(pedidos[0]!.url).toBe(
      `${ORIGEM_DA_API}/api/publico/doacoes/intencoes`,
    )
    // nem localStorage nem cookie
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0)
    expect(await page.context().cookies()).toEqual([])
  })

  test('o CPF é formatado ao sair do campo', async ({ page }) => {
    await abrir(page)
    const cpf = identificada(page).getByLabel('CPF (opcional)')
    await cpf.fill('39053344705')
    await cpf.blur()
    await expect(cpf).toHaveValue('390.533.447-05')
  })

  test('sucesso: protocolo em destaque e fácil de copiar, aviso de que ainda falta pagar, validade, "se o e-mail chegar", e o painel com o código e o QR', async ({
    page,
  }) => {
    await abrir(page)
    await preencherIdentificada(page, {
      campanha: 'Campanha de teste — cestas básicas',
      valor: '25,50',
    })
    await enviarIdentificada(page)
    const c = confirmacao(page)
    await expect(c).toBeVisible()
    await expect(c).toBeFocused()
    await expect(identificada(page)).toBeHidden()
    await expect(
      c.getByRole('heading', { name: 'Recebemos o seu pedido.' }),
    ).toBeVisible()
    const protocolo = c.locator('[data-protocolo]')
    await expect(protocolo).toHaveText(
      new RegExp(`^DOA-${new Date().getUTCFullYear()}-\\d{5}$`),
    )
    await expect(c).toContainText('Guarde este número.')
    await expect(c.locator('[data-aviso-de-pagamento]')).toContainText(
      'Ainda falta pagar.',
    )
    await expect(c.locator('[data-aviso-de-pagamento]')).toContainText(
      'O pedido não é uma doação',
    )
    await expect(c.locator('[data-aviso-de-pagamento]')).toContainText(
      'A doação só passa a constar no sistema depois que a tesouraria da ASAF encontrar o seu Pix no extrato do banco e confirmar. Isso não é instantâneo e não há prazo prometido.',
    )
    // a validade vem da API (15 dias) e o dia é o da associação
    const validade = c.locator('[data-validade]')
    const ate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Belem',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const antes = ate.format(new Date(Date.now() + 15 * 86_400_000))
    const textoDaValidade = (await validade.textContent())!
    expect(textoDaValidade).toMatch(
      /^O pedido vale por 15 dias \(até \d{1,2} de \p{L}+ de \d{4}\)\.$/u,
    )
    const depois = ate.format(new Date(Date.now() + 15 * 86_400_000))
    expect([antes, depois]).toContain(/\(até (.+)\)/.exec(textoDaValidade)![1])
    await expect(c.locator('[data-aviso-do-vencimento]')).toContainText(
      'Passado esse prazo, o pedido que ainda espera conferência passa a ser marcado como “prazo vencido” (uma rotina faz isso algumas vezes ao dia). Mas, se você tiver pago, a tesouraria ainda pode confirmá-lo.',
    )
    // o e-mail é "se chegar": melhor esforço, nunca promessa
    await expect(c.locator('[data-aviso-do-email]')).toContainText(
      'Se o e-mail chegar, ele traz o protocolo e o código Pix. O envio pode falhar',
    )
    await expect(c.locator('[data-aviso-do-email]')).toContainText(
      'o sistema tenta mandar o recibo para o e-mail que você informou',
    )
    // o código traz o valor e o protocolo; o QR carrega exatamente esse código
    const codigo = (await c.locator('[data-codigo-pix]').textContent())!
    expect(codigo).toContain('540525.50')
    expect(codigo).toContain(
      `ASAF${(await protocolo.textContent())!.replace(/-/g, '')}`,
    )
    expect(await textoDoQr(c)).toBe(codigo)
    await expect(c.locator('[data-valor-pix]')).toContainText(
      /Valor: R\$\s25,50\. Ele já está dentro do código\./,
    )
    await expect(c.locator('[data-beneficiario]')).toHaveText('ASAF TESTE')
    // copiar o protocolo e o código
    await c.getByRole('button', { name: 'Copiar o protocolo' }).click()
    await expect(c.locator('[data-aviso-da-copia-do-protocolo]')).toContainText(
      'Copiado',
    )
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      (await protocolo.textContent())!,
    )
    await c.getByRole('button', { name: 'Copiar o código' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      codigo,
    )
    // a tela de sucesso passa no axe, no computador e no celular
    await semViolacoes(page)
    await page.setViewportSize({ width: 375, height: 800 })
    await semViolacoes(page)
    await semRolagemLateral(page)
  })

  test('o MESMO pedido mandado de novo devolve o mesmo protocolo; outro pedido, outro', async ({
    page,
  }) => {
    const email = emailUnico()
    const protocolos: string[] = []
    for (const valor of ['', '', '10']) {
      await abrir(page)
      await preencherIdentificada(page, { email, valor })
      await enviarIdentificada(page)
      // o protocolo só chega depois da resposta da API: lê o texto SÓ quando ele já está na tela (antes, o teste lia o campo vazio e reprovava na máquina mais lenta do CI)
      const numero = confirmacao(page).locator('[data-protocolo]')
      await expect(numero).toHaveText(/^DOA-\d{4}-\d{5}$/)
      protocolos.push((await numero.textContent())!)
    }
    expect(protocolos[1]).toBe(protocolos[0])
    expect(protocolos[2]).not.toBe(protocolos[0])
  })

  test('armadilha de robô: vai vazia no pedido de verdade; preenchida, a pessoa vê a mesma tela de sucesso, só que sem protocolo, sem código e sem promessa', async ({
    page,
  }) => {
    const pedidos = vigiarPedidos(page)
    await abrir(page)
    await preencherIdentificada(page)
    await page.locator('input[name="pagina_web"]').evaluate((el) => {
      ;(el as HTMLInputElement).value = 'http://spam.example'
    })
    await enviarIdentificada(page)
    const c = confirmacao(page)
    await expect(c).toBeVisible()
    expect(pedidos[0]!.corpo.pagina_web).toBe('http://spam.example')
    await expect(
      c.getByRole('heading', { name: 'Recebemos o seu pedido.' }),
    ).toBeVisible()
    await expect(c.locator('[data-bloco-do-protocolo]')).toBeHidden()
    await expect(c.locator('[data-aviso-de-pagamento]')).toBeHidden()
    await expect(c.locator('[data-validade]')).toBeHidden()
    await expect(c.locator('[data-aviso-do-email]')).toBeHidden()
    await expect(c.locator('[data-painel]')).toBeEmpty()
    await expect(c).not.toContainText('Protocolo:', { useInnerText: true })
    await expect(c.locator('[data-codigo-pix]')).toHaveCount(0)
  })

  test('duplo clique: UM pedido só; o botão fica desligado e diz "Enviando…"', async ({
    page,
  }) => {
    const pedidos = vigiarPedidos(page)
    await abrir(page)
    await page.route('**/api/publico/doacoes/intencoes', async (rota) => {
      await new Promise((r) => setTimeout(r, 700))
      await rota.continue()
    })
    await preencherIdentificada(page)
    const botao = identificada(page).getByRole('button', {
      name: /Enviar e ver o código Pix|Enviando/,
    })
    await botao.dblclick()
    await expect(botao).toBeDisabled()
    await expect(botao).toHaveText('Enviando…')
    await expect(confirmacao(page)).toBeVisible()
    expect(pedidos).toHaveLength(1)
  })

  test('limite de pedidos por endereço (429): a frase do servidor e a saída pela secretaria; nada do que foi digitado se perde', async ({
    page,
  }) => {
    await abrir(page)
    await preencherIdentificada(page, { nome: NOME_QUE_ESTOURA_O_LIMITE })
    await enviarIdentificada(page)
    const alerta = falha(identificada(page))
    await expect(alerta).toHaveText(
      'Muitas tentativas - aguarde 60 minutos antes de tentar novamente. Se preferir, fale com a secretaria.',
    )
    await expect(alerta).toBeFocused()
    await expect(alerta).toHaveAttribute('role', 'alert')
    await expect(identificada(page).getByLabel('Nome completo')).toHaveValue(
      NOME_QUE_ESTOURA_O_LIMITE,
    )
    await expect(
      identificada(page).getByRole('button', {
        name: 'Enviar e ver o código Pix',
      }),
    ).toBeEnabled()
    await expect(confirmacao(page)).toBeHidden()
    await semViolacoes(page)
  })

  test('Pix fechado depois que a página abriu (503): a frase do servidor, sem culpar a pessoa', async ({
    page,
  }) => {
    await abrir(page)
    await page.route('**/api/publico/doacoes/intencoes', (rota) =>
      rota.fulfill({
        status: 503,
        json: {
          detail:
            'A doação pelo site ainda não está disponível. Fale com a secretaria da associação.',
        },
      }),
    )
    await preencherIdentificada(page)
    await enviarIdentificada(page)
    await expect(falha(identificada(page))).toHaveText(
      'A doação pelo site ainda não está disponível. Fale com a secretaria da associação.',
    )
    await expect(confirmacao(page)).toBeHidden()
  })

  test('erro de servidor: orientação e dá para tentar de novo; sem rede: a garantia do mesmo protocolo', async ({
    page,
  }) => {
    await abrir(page)
    await preencherIdentificada(page, { nome: NOME_QUE_DERRUBA_A_API })
    await enviarIdentificada(page)
    await expect(falha(identificada(page))).toContainText(
      'Erro interno do servidor.',
    )
    await expect(
      identificada(page).getByRole('button', {
        name: 'Enviar e ver o código Pix',
      }),
    ).toBeEnabled()
    await page.route('**/api/publico/doacoes/intencoes', (rota) => rota.abort())
    await identificada(page).getByLabel('Nome completo').fill('Maria de Teste')
    await enviarIdentificada(page)
    await expect(falha(identificada(page))).toContainText(
      'Não foi possível enviar o seu pedido agora',
    )
    await expect(falha(identificada(page))).toContainText(
      'você recebe o mesmo protocolo',
    )
    await expect(falha(identificada(page))).toContainText(
      'fale com a secretaria',
    )
  })

  test('a API recusa por validação (422 em lista): cada motivo no seu campo, o foco no primeiro, nada digitado se perde', async ({
    page,
  }) => {
    await abrir(page)
    await page.route('**/api/publico/doacoes/intencoes', (rota) =>
      rota.fulfill({
        status: 422,
        json: {
          detail: [
            {
              type: 'value_error',
              loc: ['body', 'email'],
              msg: 'Value error, Esse e-mail não parece certo: confira se está escrito sem erro.',
            },
            {
              type: 'value_error',
              loc: ['body', 'cpf'],
              msg: 'Value error, Esse CPF não confere: confira os números ou deixe em branco.',
            },
          ],
        },
      }),
    )
    await preencherIdentificada(page, { cpf: CPF_VALIDO })
    await enviarIdentificada(page)
    const form = identificada(page)
    await expect(form.locator('#doar-identificada-erro-email')).toHaveText(
      'Esse e-mail não parece certo: confira se está escrito sem erro.',
    )
    await expect(form.locator('#doar-identificada-erro-cpf')).toHaveText(
      'Esse CPF não confere: confira os números ou deixe em branco.',
    )
    await expect(form.getByLabel('E-mail')).toBeFocused()
    await expect(form.getByLabel('E-mail')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(form.getByLabel('Nome completo')).toHaveValue('Maria de Teste')
    await expect(form.locator('[data-resumo-de-erros]')).toHaveText(
      'Há 2 campos para corrigir.',
    )
    await expect(falha(form)).toBeHidden()
  })

  test('aviso de privacidade: a versão enviada é a que a API mandou ler, e se ela mudar a pessoa lê que é para recarregar', async ({
    page,
  }) => {
    const pedidos = vigiarPedidos(page)
    await trocarResposta(page, '**/api/publico/doacao', (corpo) => ({
      ...corpo,
      versao_aviso_de_privacidade: '9',
    }))
    await abrir(page)
    await expect(page.locator('#doar-identificada-aviso')).toContainText(
      'Aviso de privacidade (versão 9)',
    )
    await preencherIdentificada(page)
    await enviarIdentificada(page)
    expect(pedidos[0]!.corpo.versao_texto_consentimento).toBe('9')
    // o mock só conhece a versão 2: recusa com a frase do servidor
    await expect(falha(identificada(page))).toHaveText(
      'O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.',
    )
  })
})

test.describe('os estados da parte ao vivo', () => {
  test('Pix ainda não aberto para o site: aviso gentil com o contato da secretaria, nenhum formulário, nenhuma campanha; a explicação continua', async ({
    page,
  }) => {
    await trocarResposta(page, '**/api/publico/doacao', (corpo) => ({
      ...corpo,
      pix_disponivel: false,
      chave_pix: null,
      beneficiario: null,
      cidade: null,
    }))
    await page.goto(CAMINHO)
    const caixa = page.locator('[data-estado="indisponivel"]')
    await expect(caixa).toBeVisible()
    expect(await estadoVisivel(page)).toEqual(['indisponivel'])
    await expect(
      caixa.getByRole('heading', {
        name: 'A doação pelo site ainda não está disponível',
      }),
    ).toBeVisible()
    await expect(caixa).toContainText('Para doar, fale com a secretaria')
    await expect(caixa.locator('a[href="tel:+5594984120703"]')).toBeVisible()
    await expect(caixa.locator('a[href^="mailto:"]')).toBeVisible()
    await expect(page.locator('form[data-doacao-anonima]')).toBeHidden()
    await expect(page.locator('form[data-doacao-identificada]')).toBeHidden()
    await expect(page.locator('[data-campanha]')).toHaveCount(0)
    await expect(page.locator('[data-doacao-vivo]')).toHaveAttribute(
      'aria-busy',
      'false',
    )
    await expect(page.locator('[data-antes-de-doar]')).toBeVisible()
    await semViolacoes(page)
    await page.setViewportSize({ width: 375, height: 800 })
    await semViolacoes(page)
    await semRolagemLateral(page)
  })

  test('API antiga (a rota não existe, 404): também "ainda não está disponível"', async ({
    page,
  }) => {
    await page.route('**/api/publico/doacao', (rota) =>
      rota.fulfill({ status: 404, json: { detail: 'Não encontrado.' } }),
    )
    await page.goto(CAMINHO)
    await expect(page.locator('[data-estado="indisponivel"]')).toBeVisible()
    expect(await estadoVisivel(page)).toEqual(['indisponivel'])
  })

  test('API fora do ar: avisa que não conseguiu carregar, com o contato; "Tentar de novo" recupera quando ela volta', async ({
    page,
  }) => {
    await page.route('**/api/publico/doacao', (rota) => rota.abort())
    await page.goto(CAMINHO)
    const erro = page.locator('[data-estado="erro"]')
    await expect(erro).toBeVisible()
    expect(await estadoVisivel(page)).toEqual(['erro'])
    await expect(erro).toHaveAttribute('role', 'alert')
    await expect(erro).toContainText(
      'Não conseguimos carregar as formas de doar agora',
    )
    await expect(erro.locator('a[href^="tel:"]')).toBeVisible()
    await expect(page.locator('[data-doacao-vivo]')).toHaveAttribute(
      'aria-busy',
      'false',
    )
    // a página explica tudo mesmo assim (conteúdo estático útil)
    await expect(page.locator('[data-antes-de-doar]')).toBeVisible()
    await semViolacoes(page)
    await page.setViewportSize({ width: 375, height: 800 })
    await semViolacoes(page)
    await semRolagemLateral(page)
    await page.unroute('**/api/publico/doacao')
    await erro.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(page.locator('[data-estado="pronto"]')).toBeVisible()
    await expect(page.locator('[data-campanha]')).toHaveCount(3)
  })

  test('resposta fora do formato: erro, nunca um formulário pela metade', async ({
    page,
  }) => {
    await page.route('**/api/publico/doacao', (rota) =>
      rota.fulfill({ json: { pix_disponivel: true } }),
    )
    await page.goto(CAMINHO)
    await expect(page.locator('[data-estado="erro"]')).toBeVisible()
    await expect(page.locator('form[data-doacao-identificada]')).toBeHidden()
  })

  test('enquanto carrega, diz que está carregando', async ({ page }) => {
    await page.route('**/api/publico/doacao', async (rota) => {
      await new Promise((r) => setTimeout(r, 800))
      await rota.continue()
    })
    await page.goto(CAMINHO)
    await expect(page.locator('[data-estado="carregando"]')).toHaveText(
      'Carregando as formas de doar…',
    )
    await expect(page.locator('[data-doacao-vivo]')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await expect(page.locator('[data-estado="pronto"]')).toBeVisible()
  })
})

test.describe('acessibilidade, celular e política de conteúdo', () => {
  for (const [nome, largura] of [
    ['computador (1280px)', 1280],
    ['celular (375px)', 375],
  ] as const) {
    test(`axe sem violações e sem rolagem lateral — ${nome} — página pronta, código gerado e pedido enviado`, async ({
      page,
    }) => {
      await abrir(page, largura)
      await semViolacoes(page)
      await semRolagemLateral(page)
      await anonima(page)
        .getByRole('button', { name: 'Mostrar o código Pix' })
        .click()
      await expect(resultadoAnonimo(page)).toBeVisible()
      await semViolacoes(page)
      await semRolagemLateral(page)
      await preencherIdentificada(page, { valor: '10' })
      await enviarIdentificada(page)
      await expect(confirmacao(page)).toBeVisible()
      await semViolacoes(page)
      await semRolagemLateral(page)
    })
  }

  test('o código Pix e os dados cabem no celular sem rolagem lateral (quebram de linha)', async ({
    page,
  }) => {
    await abrir(page, 375)
    await anonima(page)
      .getByRole('button', { name: 'Mostrar o código Pix' })
      .click()
    const codigo = resultadoAnonimo(page).locator('[data-codigo-pix]')
    await expect(codigo).toBeVisible()
    const caixa = await codigo.boundingBox()
    expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(375)
    await semRolagemLateral(page)
  })

  test('a política de conteúdo não é violada nem pelo QR Code nem pelos fluxos; nada em cookie nem em armazenamento do navegador', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.addInitScript(() => {
      const violacoes: string[] = []
      ;(window as unknown as { __violacoes: string[] }).__violacoes = violacoes
      document.addEventListener('securitypolicyviolation', (e) => {
        violacoes.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'}`)
      })
    })
    const erros: string[] = []
    page.on('console', (m) => {
      if (
        m.type() === 'error' &&
        /Content Security Policy|Refused to/i.test(m.text())
      )
        erros.push(m.text())
    })
    const resposta = await page.goto(CAMINHO, { waitUntil: 'networkidle' })
    expect(resposta!.headers()['content-security-policy']).toContain(
      "default-src 'none'",
    )
    await expect(page.locator('[data-estado="pronto"]')).toBeVisible()
    await anonima(page)
      .getByRole('button', { name: 'Mostrar o código Pix' })
      .click()
    await expect(
      resultadoAnonimo(page).locator('svg[data-qr-pix]'),
    ).toBeVisible()
    await resultadoAnonimo(page)
      .getByRole('button', { name: 'Copiar o código' })
      .click()
    await preencherIdentificada(page, { valor: '10', cpf: CPF_VALIDO })
    await enviarIdentificada(page)
    await expect(confirmacao(page).locator('svg[data-qr-pix]')).toBeVisible()
    expect(
      await page.evaluate(
        () => (window as unknown as { __violacoes: string[] }).__violacoes,
      ),
    ).toEqual([])
    expect(erros).toEqual([])
    expect(await context.cookies()).toEqual([])
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0)
  })

  test('a página não pede nada a ninguém além do site e da API (nem imagem do QR, nem serviço de terceiro)', async ({
    page,
  }) => {
    // só o servidor do site (127.0.0.1, em qualquer porta de teste) e a API simulada
    const deFora = new Set<string>()
    page.on('request', (r) => {
      const url = new URL(r.url())
      if (url.protocol === 'data:' || url.protocol === 'blob:') return
      if (url.hostname !== '127.0.0.1') deFora.add(url.origin)
    })
    await abrir(page)
    await anonima(page)
      .getByRole('button', { name: 'Mostrar o código Pix' })
      .click()
    await expect(resultadoAnonimo(page)).toBeVisible()
    await preencherIdentificada(page)
    await enviarIdentificada(page)
    await expect(confirmacao(page)).toBeVisible()
    expect([...deFora]).toEqual([])
    // o QR é um <svg> desenhado ali: nenhuma <img> na parte ao vivo
    await expect(page.locator('[data-doacao-vivo] img')).toHaveCount(0)
  })
})
