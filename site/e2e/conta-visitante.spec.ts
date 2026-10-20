import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// v5.6b — a conta do visitante (/minha-conta/): entrar com o e-mail e um código de uso único (sem senha) e ver as inscrições, os certificados e as doações feitas pelo site,
// no navegador de verdade, contra o build de teste e a API simulada (`scripts/mock-api.mjs`). Os e-mails de teste mandam no resultado:
//   visitante@example.com e visitante.<sufixo>@example.com   têm vínculo (o código é 123456): 3 inscrições (vaga reservada, evento encerrado, evento cancelado), 1 certificado, 2 doações (pendente e confirmada)
//   sessao-curta.<sufixo>@example.com  entra, mas a SEGUNDA leitura da conta dá 401 (a sessão "acabou")
//   limite@example.com        é recusado pelo limite de pedidos (429)        falha@example.com   dá erro de servidor (500)
//   qualquer outro            recebe a MESMA resposta de sempre, e nenhum código vale (o servidor real não diz se há vínculo)

test.describe.configure({ timeout: 90_000 })

const PORTA_DA_API = process.env.MOCK_API_PORT ?? '4322'
const MOCK = `http://127.0.0.1:${PORTA_DA_API}`
const CAMINHO = '/minha-conta/'
let contador = 0
/** Um e-mail só deste teste (os testes rodam em paralelo e o mock guarda o contador de tentativas de cada e-mail): `visitante.<sufixo>@example.com` tem vínculo. */
const emailUnico = (base = 'visitante') =>
  `${base}.${Date.now().toString(36)}${++contador}@example.com`
let EMAIL = emailUnico()
test.beforeEach(() => {
  EMAIL = emailUnico()
})
const CODIGO = '123456'
const MENSAGEM_DO_CODIGO_INVALIDO =
  'Código inválido ou vencido: confira os números ou peça um novo código.'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

async function semViolacoes(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
  ).toEqual([])
}
/** Axe no computador e no celular (375 px). */
async function semViolacoesNosDois(page: Page) {
  await semViolacoes(page)
  await page.setViewportSize({ width: 375, height: 700 })
  await semViolacoes(page)
  await page.setViewportSize({ width: 1280, height: 720 })
}

const telaVisivel = (page: Page, estado: string) =>
  page.locator(`[data-estado="${estado}"]`)

async function pedirOCodigo(page: Page, email: string) {
  await page
    .getByLabel(
      'E-mail usado na inscrição, na doação ou no pedido sobre dados pessoais',
    )
    .fill(email)
  await page
    .getByRole('button', { name: 'Receber o código por e-mail' })
    .click()
}

async function entrar(page: Page, email = EMAIL, codigo = CODIGO) {
  await page.goto(CAMINHO)
  await pedirOCodigo(page, email)
  await expect(telaVisivel(page, 'codigo')).toBeVisible()
  await page.getByLabel('Código de 6 números').fill(codigo)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}

async function entrarNaConta(page: Page) {
  await entrar(page)
  await expect(telaVisivel(page, 'conta')).toBeVisible()
}

async function eventosDoMock(page: Page) {
  const r = await page.request.get(`${MOCK}/__visitante`)
  return (await r.json()) as Array<{ tipo: string; email: string }>
}

test.describe('a página', () => {
  test('título, migalhas, o formulário do e-mail e o texto de quem cuida dos dados', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Minha conta' }),
    ).toBeVisible()
    await expect(telaVisivel(page, 'email')).toBeVisible()
    await expect(telaVisivel(page, 'codigo')).toBeHidden()
    await expect(telaVisivel(page, 'conta')).toBeHidden()
    await expect(page.getByText('Não existe senha')).toBeVisible()
    await expect(
      page
        .locator('[data-estado="email"]')
        .getByRole('link', { name: 'Política de Privacidade' }),
    ).toHaveAttribute('href', '/privacidade/#conta-do-visitante')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    )
  })

  test('o rodapé leva à conta', async ({ page }) => {
    await page.goto('/')
    const link = page
      .locator('footer')
      .getByRole('link', { name: 'Minha conta' })
    await expect(link).toHaveAttribute('href', '/minha-conta/')
    await link.click()
    await expect(page).toHaveURL(/\/minha-conta\/$/)
  })

  test('acessibilidade nas três telas (computador e celular)', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await expect(telaVisivel(page, 'email')).toBeVisible()
    await semViolacoesNosDois(page)

    await pedirOCodigo(page, EMAIL)
    await expect(telaVisivel(page, 'codigo')).toBeVisible()
    await semViolacoesNosDois(page)

    await page.getByLabel('Código de 6 números').fill(CODIGO)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(telaVisivel(page, 'conta')).toBeVisible()
    await semViolacoesNosDois(page)

    await page
      .getByRole('button', { name: 'Pedir a eliminação dos meus dados' })
      .click()
    await expect(page.locator('[data-passo-de-confirmacao]')).toBeVisible()
    await semViolacoesNosDois(page)
  })
})

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('a página diz o que fazer', async ({ page }) => {
    await page.goto(CAMINHO)
    // o Playwright não lê o texto de <noscript> pelo getByText: o parágrafo dentro dele é achado pelo CSS
    await expect(page.locator('noscript p.font-medium')).toContainText(
      'é preciso ativar o JavaScript do navegador',
    )
  })
})

test.describe('pedir o código', () => {
  test('e-mail torto: a mensagem aparece e nada vai para a API', async ({
    page,
  }) => {
    const chamadas: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/publico/visitante/')) chamadas.push(r.url())
    })
    await page.goto(CAMINHO)
    await pedirOCodigo(page, 'isto-nao-e-email')
    await expect(
      page.getByText(
        'Esse e-mail não parece certo: confira se está escrito sem erro.',
      ),
    ).toBeVisible()
    await expect(
      page.getByLabel(
        'E-mail usado na inscrição, na doação ou no pedido sobre dados pessoais',
      ),
    ).toHaveAttribute('aria-invalid', 'true')
    expect(chamadas).toEqual([])
    await expect(telaVisivel(page, 'email')).toBeVisible()
  })

  test('com ou sem vínculo a tela seguinte e a mensagem são as mesmas', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await pedirOCodigo(page, EMAIL)
    await expect(telaVisivel(page, 'codigo')).toBeVisible()
    const comVinculo = await page
      .locator('[data-mensagem-do-pedido]')
      .textContent()

    await page.getByRole('button', { name: 'Usar outro e-mail' }).click()
    await expect(telaVisivel(page, 'email')).toBeVisible()
    await pedirOCodigo(page, 'ninguem@example.com')
    await expect(telaVisivel(page, 'codigo')).toBeVisible()
    const semVinculo = await page
      .locator('[data-mensagem-do-pedido]')
      .textContent()

    expect(semVinculo).toBe(comVinculo)
    expect(comVinculo).toContain(
      'Se houver inscrição em evento, pedido de doação ou solicitação do titular de dados feitos pelo site',
    )
    await expect(page.locator('[data-email-informado]')).toHaveText(
      'ninguem@example.com',
    )
  })

  test('o limite de pedidos e o erro de servidor têm a sua frase', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await pedirOCodigo(page, 'limite@example.com')
    await expect(
      page.getByText('Muitos pedidos vieram deste e-mail ou deste endereço.'),
    ).toBeVisible()
    await expect(telaVisivel(page, 'email')).toBeVisible()

    await pedirOCodigo(page, 'falha@example.com')
    await expect(
      page.getByText('Não foi possível pedir o código agora.'),
    ).toBeVisible()
    await expect(telaVisivel(page, 'email')).toBeVisible()
  })

  test('a armadilha de robô é enviada preenchida e o mock a registra, sem avançar de tela errada', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await page
      .locator('input[name="pagina_web"]')
      .fill('http://spam.example', { force: true })
    await pedirOCodigo(page, 'robo@example.com')
    await expect(telaVisivel(page, 'codigo')).toBeVisible()
    const eventos = await eventosDoMock(page)
    expect(
      eventos.some(
        (e) => e.tipo === 'armadilha' && e.email === 'robo@example.com',
      ),
    ).toBe(true)
  })
})

test.describe('entrar com o código', () => {
  test('código com tamanho errado não vai à API; código errado dá a frase única; sem vínculo, nenhum código vale', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await pedirOCodigo(page, EMAIL)
    await expect(telaVisivel(page, 'codigo')).toBeVisible()

    await page.getByLabel('Código de 6 números').fill('123')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(
      page.getByText('O código tem 6 números: confira o e-mail que enviamos.'),
    ).toBeVisible()

    await page.getByLabel('Código de 6 números').fill('000000')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByText(MENSAGEM_DO_CODIGO_INVALIDO)).toBeVisible()
    await expect(telaVisivel(page, 'codigo')).toBeVisible()

    // outro e-mail (sem vínculo) com o código "certo": a MESMA frase
    await page.getByRole('button', { name: 'Usar outro e-mail' }).click()
    await pedirOCodigo(page, 'ninguem@example.com')
    await page.getByLabel('Código de 6 números').fill(CODIGO)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByText(MENSAGEM_DO_CODIGO_INVALIDO)).toBeVisible()
  })

  test('cinco erros queimam o código, até para quem acerta depois; pedir um novo resolve', async ({
    page,
  }) => {
    await page.goto(CAMINHO)
    await pedirOCodigo(page, EMAIL)
    for (let i = 0; i < 5; i++) {
      await page.getByLabel('Código de 6 números').fill('000000')
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await expect(page.getByText(MENSAGEM_DO_CODIGO_INVALIDO)).toBeVisible()
    }
    await page.getByLabel('Código de 6 números').fill(CODIGO)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByText(MENSAGEM_DO_CODIGO_INVALIDO)).toBeVisible()
    await expect(telaVisivel(page, 'conta')).toBeHidden()

    await page.getByRole('button', { name: 'Pedir um novo código' }).click()
    // ao receber o novo código a página limpa o campo e some com o aviso de código inválido: só depois disso se digita (antes, o teste digitava
    // cedo demais, a página limpava o campo e a entrada falhava na máquina mais lenta do CI)
    await expect(page.getByText(MENSAGEM_DO_CODIGO_INVALIDO)).toBeHidden()
    await page.getByLabel('Código de 6 números').fill(CODIGO)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(telaVisivel(page, 'conta')).toBeVisible()
  })

  test('o código aceita espaço e hífen do que a pessoa copiou', async ({
    page,
  }) => {
    await entrar(page, EMAIL, '123 456')
    await expect(telaVisivel(page, 'conta')).toBeVisible()
  })
})

test.describe('dentro da conta', () => {
  test('mostra as inscrições, o certificado e as doações, cada coisa com a sua frase honesta', async ({
    page,
  }) => {
    const leitura = page.waitForRequest((r) =>
      r.url().endsWith('/api/visitante/minha-conta'),
    )
    await entrarNaConta(page)
    const pedido = await leitura
    expect(pedido.headers()['authorization']).toMatch(
      /^Bearer sessao-de-teste-/,
    )
    expect(pedido.url()).not.toContain('sessao-de-teste')

    await expect(page.locator('[data-email-da-conta]')).toHaveText(EMAIL)
    await expect(page.locator('[data-fim-da-sessao]')).toContainText(
      'horário de Belém',
    )

    const inscricoes = page.locator('[data-lista="inscricoes"] > li')
    await expect(inscricoes).toHaveCount(3)
    const reservada = inscricoes.filter({ hasText: 'A1B2C3D4' })
    await expect(reservada).toHaveCount(1)
    await expect(reservada).toContainText('Vaga reservada')
    await expect(
      reservada.getByRole('link', { name: 'Cancelar a minha inscrição' }),
    ).toHaveAttribute('href', '/cancelar-inscricao/?token=fixo-reservada')
    await expect(
      reservada.getByRole('link', { name: 'Confirmar a minha vaga' }),
    ).toHaveAttribute('href', '/confirmar-inscricao/?token=fixo-reservada')

    const cancelado = inscricoes.filter({
      has: page.locator('[data-i-aviso]:not([hidden])'),
    })
    await expect(cancelado).toHaveCount(1)
    await expect(cancelado).toContainText('O evento foi cancelado')
    await expect(
      cancelado.getByRole('link', { name: 'Confirmar a minha vaga' }),
    ).toBeHidden()
    await expect(
      cancelado.getByRole('link', { name: 'Cancelar a minha inscrição' }),
    ).toBeVisible()

    const encerrada = inscricoes.filter({
      has: page.locator('[data-i-encerrado]:not([hidden])'),
    })
    await expect(encerrada).toHaveCount(1)
    await expect(encerrada).toContainText('Evento encerrado')
    await expect(encerrada.getByRole('link')).toHaveCount(0)
    await expect(
      page.locator('[data-nota-de-eventos-encerrados]'),
    ).toBeVisible()

    const certificados = page.locator('[data-lista="certificados"] > li')
    await expect(certificados).toHaveCount(1)
    await expect(certificados.getByText('9F8E7D6C5B4A3210')).toBeVisible()
    await expect(
      certificados.getByRole('link', { name: 'Abrir o certificado (PDF)' }),
    ).toHaveAttribute('href', `${MOCK}/uploads/documentos/9F8E7D6C5B4A3210.pdf`)

    const doacoes = page.locator('[data-lista="doacoes"] > li')
    await expect(doacoes).toHaveCount(2)
    const pendente = doacoes.filter({ hasText: 'DOA-2026-00012' })
    await expect(pendente).toContainText(
      'Aguardando a confirmação da tesouraria',
    )
    await expect(pendente).toContainText('Ainda sem recibo')
    await expect(pendente).toContainText('Até lá não há recibo')
    const confirmada = doacoes.filter({ hasText: 'DOA-2026-00007' })
    await expect(confirmada).toContainText('Doação confirmada')
    await expect(confirmada).toContainText('Recibo nº 12')
    await expect(confirmada).toContainText('Cestas de Natal')
    await expect(confirmada).toContainText('O e-mail com o recibo não saiu')

    await expect(page.locator('[data-vazio]:not([hidden])')).toHaveCount(0)
  })

  test('mostra os pedidos sobre dados pessoais: a resposta (só aqui), o pedido em andamento e o encerrado com o motivo; texto da equipe nunca vira HTML', async ({
    page,
  }) => {
    await entrarNaConta(page)
    await expect(
      page.getByRole('heading', { name: 'Meus pedidos sobre dados pessoais' }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'A resposta a um pedido sobre os seus dados pessoais só é mostrada aqui',
      ),
    ).toBeVisible()
    const pedidos = page.locator('[data-lista="pedidos-do-titular"] > li')
    await expect(pedidos).toHaveCount(3)

    const respondido = pedidos.filter({ hasText: 'ASAF-2026-00031' })
    await expect(respondido).toContainText('Acessar os dados que a associação')
    await expect(respondido).toContainText('Respondido')
    const resposta = respondido.locator('[data-p-resposta]')
    await expect(resposta).toContainText(
      'Guardamos o seu <strong>nome</strong>',
    )
    await expect(resposta).toContainText('Não guardamos o seu CPF completo.')
    await expect(resposta.locator('strong')).toHaveCount(0)
    await expect(respondido.locator('[data-p-resposta-rotulo]')).toHaveText(
      'Resposta da associação',
    )
    await expect(respondido.locator('[data-p-resposta-quando]')).toContainText(
      'Respondido em',
    )
    await expect(respondido.locator('[data-p-explicacao]')).toBeHidden()

    const andamento = pedidos.filter({ hasText: 'ASAF-2026-00040' })
    await expect(andamento).toContainText('Em andamento')
    await expect(andamento.locator('[data-p-explicacao]')).toContainText(
      'ela confere que quem pediu é o titular dos dados',
    )
    await expect(andamento.locator('[data-p-resposta-caixa]')).toBeHidden()

    const encerrado = pedidos.filter({ hasText: 'ASAF-2026-00022' })
    await expect(encerrado).toContainText('Encerrado')
    await expect(encerrado.locator('[data-p-resposta-rotulo]')).toHaveText(
      'Motivo do encerramento',
    )
    await expect(encerrado.locator('[data-p-resposta]')).toHaveText(
      'Não foi possível conferir a identidade de quem fez o pedido.',
    )
    await expect(page.locator('[data-vazio="pedidos-do-titular"]')).toBeHidden()
  })

  test('a sessão fica só na aba e o endereço da página nunca a leva', async ({
    page,
  }) => {
    await entrarNaConta(page)
    expect(page.url()).toMatch(/\/minha-conta\/$/)
    const guardado = await page.evaluate(() => ({
      sessao: sessionStorage.getItem('asaf-conta-visitante'),
      local: Object.keys(localStorage),
      cookies: document.cookie,
    }))
    expect(guardado.sessao).toContain('sessao-de-teste-')
    expect(guardado.local).toEqual([])
    expect(guardado.cookies).toBe('')
  })

  test('recarregar a página abre direto na conta; a aba nova não tem a sessão', async ({
    page,
    context,
  }) => {
    await entrarNaConta(page)
    await page.reload()
    await expect(telaVisivel(page, 'conta')).toBeVisible()
    await expect(page.locator('[data-email-da-conta]')).toHaveText(EMAIL)

    const outraAba = await context.newPage()
    await outraAba.goto(CAMINHO)
    await expect(telaVisivel(outraAba, 'email')).toBeVisible()
    await expect(outraAba.getByText(EMAIL)).toHaveCount(0)
    await outraAba.close()
  })

  test('Sair volta ao e-mail, avisa, apaga a sessão e tira os dados da tela', async ({
    page,
  }) => {
    await entrarNaConta(page)
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await expect(telaVisivel(page, 'email')).toBeVisible()
    await expect(page.getByText('Você saiu da sua conta.')).toBeVisible()
    expect(
      await page.evaluate(() => sessionStorage.getItem('asaf-conta-visitante')),
    ).toBeNull()
    const texto = (await page.locator('body').textContent()) ?? ''
    expect(texto).not.toContain('Encontro')
    expect(texto).not.toContain('DOA-2026')
    expect(texto).not.toContain('9F8E7D6C5B4A3210')
    // o e-mail também sai da tela (computador compartilhado): nem no campo, nem no texto
    expect(texto).not.toContain(EMAIL)
    await expect(
      page.getByLabel(
        'E-mail usado na inscrição, na doação ou no pedido sobre dados pessoais',
      ),
    ).toHaveValue('')
    await expect(page.locator('[data-email-informado]')).toHaveText('')

    await page.reload()
    await expect(telaVisivel(page, 'email')).toBeVisible()
    expect(
      (await eventosDoMock(page)).some(
        (e) => e.tipo === 'saiu' && e.email === EMAIL,
      ),
    ).toBe(true)
  })

  test('sessão que o servidor encerrou: volta ao e-mail e diz por quê', async ({
    page,
  }) => {
    await entrar(page, emailUnico('sessao-curta'))
    await expect(telaVisivel(page, 'conta')).toBeVisible()
    await page.reload()
    await expect(telaVisivel(page, 'email')).toBeVisible()
    await expect(
      page.getByText(
        'A sua sessão acabou: peça um novo código para entrar de novo.',
      ),
    ).toBeVisible()
    expect(
      await page.evaluate(() => sessionStorage.getItem('asaf-conta-visitante')),
    ).toBeNull()
  })

  test('passada uma hora a página encerra a sessão sozinha', async ({
    page,
  }) => {
    await page.clock.install()
    await entrarNaConta(page)
    await page.clock.fastForward('01:01:00')
    await expect(telaVisivel(page, 'email')).toBeVisible()
    await expect(
      page.getByText(
        'A sua sessão acabou: peça um novo código para entrar de novo.',
      ),
    ).toBeVisible()
    expect(
      await page.evaluate(() => sessionStorage.getItem('asaf-conta-visitante')),
    ).toBeNull()
  })
})

test.describe('a Política de Privacidade', () => {
  test('o trecho da conta diz o que o servidor faz e o formulário aponta para ele', async ({
    page,
  }) => {
    await page.goto('/privacidade/')
    const trecho = page.locator('[data-conta-visitante-politica]')
    await expect(trecho).toBeVisible()
    await expect(trecho).toHaveAttribute('id', 'conta-do-visitante')
    await expect(trecho).toContainText('código de 6 números')
    await expect(trecho).toContainText(
      'vale 10 minutos, serve uma vez e aceita 5 tentativas',
    )
    await expect(trecho).toContainText('A sessão vale no máximo 60 minutos')
    await expect(trecho).toContainText('nada é apagado na hora')
    await expect(
      trecho.getByRole('link', { name: 'Minha conta' }),
    ).toHaveAttribute('href', '/minha-conta/')
    await expect(page.locator('[data-prazos-de-guarda] > li')).toHaveCount(8)
    // a Política não pode dizer que o site não guarda nada no navegador: a sessão da conta fica no `sessionStorage` da aba
    const dados = page.locator('[data-cookies-e-dados]')
    await expect(dados).toContainText('Este site não instala cookies.')
    await expect(dados).toContainText(
      'a sessão de até 60 minutos, só naquela aba',
    )
    await expect(dados).not.toContainText('nem guarda dados no seu navegador')
    await expect(
      dados.getByRole('link', { name: 'Minha conta' }),
    ).toHaveAttribute('href', '/minha-conta/')
  })
})

test.describe('pedir a eliminação dos dados', () => {
  test('dois passos, o protocolo e o prazo; depois o pedido aparece como em andamento', async ({
    page,
  }) => {
    await entrarNaConta(page)
    await expect(page.locator('[data-apagamento-em-andamento]')).toBeHidden()

    await page
      .getByRole('button', { name: 'Pedir a eliminação dos meus dados' })
      .click()
    await expect(
      page.getByText('Tem certeza? Abriremos um pedido para eliminar'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Não, voltar' }).click()
    await expect(page.locator('[data-passo-de-confirmacao]')).toBeHidden()
    expect(
      (await eventosDoMock(page)).some(
        (e) => e.tipo === 'apagamento' && e.email === EMAIL,
      ),
    ).toBe(false)

    await page
      .getByRole('button', { name: 'Pedir a eliminação dos meus dados' })
      .click()
    await page.getByRole('button', { name: 'Sim, pedir a eliminação' }).click()
    const resultado = page.locator('[data-resultado-do-apagamento]')
    await expect(resultado).toBeVisible()
    await expect(resultado).toContainText('ASAF-2026-00042')
    await expect(resultado).toContainText('Prazo de resposta: até')
    await expect(page.locator('[data-apagamento-formulario]')).toBeHidden()
    expect(
      (await eventosDoMock(page)).filter(
        (e) => e.tipo === 'apagamento' && e.email === EMAIL,
      ),
    ).toHaveLength(1)

    await page.reload()
    await expect(telaVisivel(page, 'conta')).toBeVisible()
    const andamento = page.locator('[data-apagamento-em-andamento]')
    await expect(andamento).toBeVisible()
    await expect(andamento).toContainText('ASAF-2026-00042')
    await expect(page.locator('[data-apagamento-formulario]')).toBeHidden()
  })

  test('pedido que já existia: a tela diz isso e não promete o e-mail de confirmação', async ({
    page,
  }) => {
    await entrarNaConta(page)
    // o pedido é feito por fora (outra aba, por exemplo) sem a página saber; depois a pessoa clica
    const sessao = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('asaf-conta-visitante') ?? '{}'),
    )
    const feito = await page.request.post(
      `${MOCK}/api/visitante/pedir-apagamento`,
      { headers: { Authorization: `Bearer ${sessao.token}` } },
    )
    expect(feito.status()).toBe(200)
    await page
      .getByRole('button', { name: 'Pedir a eliminação dos meus dados' })
      .click()
    await page.getByRole('button', { name: 'Sim, pedir a eliminação' }).click()
    const resultado = page.locator('[data-resultado-do-apagamento]')
    await expect(resultado).toBeVisible()
    await expect(resultado).toContainText(
      'Você já tinha este pedido em andamento.',
    )
    await expect(resultado).toContainText('ASAF-2026-00042')
    await expect(resultado.locator('[data-confirmacao-por-email]')).toBeHidden()
    await expect(resultado).not.toContainText('Pedido recebido.')
  })

  test('a sessão que o servidor não reconhece mais leva de volta ao e-mail', async ({
    page,
  }) => {
    await entrar(page, EMAIL)
    await expect(telaVisivel(page, 'conta')).toBeVisible()
    // o servidor esquece a sessão (como se tivesse vencido) sem a página saber
    await page.evaluate(() =>
      sessionStorage.setItem(
        'asaf-conta-visitante',
        JSON.stringify({
          token: 'sessao-que-nao-existe',
          expira_em: '2999-01-01T00:00:00',
        }),
      ),
    )
    await page.reload()
    await expect(telaVisivel(page, 'email')).toBeVisible()
    await expect(
      page.getByText(
        'A sua sessão acabou: peça um novo código para entrar de novo.',
      ),
    ).toBeVisible()
  })
})
