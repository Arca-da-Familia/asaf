import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

// v5.5c — a inscrição em evento pelo site: o formulário na página do evento e as páginas /cancelar-inscricao/ e /confirmar-inscricao/ (os links dos e-mails do
// sistema), no navegador de verdade, contra o build de teste e a API simulada (`scripts/mock-api.mjs`, que guarda o corpo recebido e responde como a API
// real: inscrição, lista de espera quando não há vaga, 429 e erro de servidor provocados por nomes de teste, CPF já inscrito, resumo e ações pelo código).
//   evento 2: gratuito, duas sessões sem limite de vagas, sem perguntas        evento 3: pago e esgotado (a inscrição é com a secretaria)
//   evento 7: gratuito, 18 vagas livres, sessões (a da tarde lotada) e perguntas de todos os tipos
//   evento 8: gratuito com as vagas esgotadas (lista de espera)              evento 9: gratuito, mas pede um arquivo (a inscrição é com a secretaria)

// vários testes passam o axe duas ou três vezes (computador e celular) com o navegador ocupado por outros testes: 30 s é pouco
test.describe.configure({ timeout: 90_000 })

const PORTA_DA_API = process.env.MOCK_API_PORT ?? '4322'
const MOCK = `http://127.0.0.1:${PORTA_DA_API}`
const NOME_QUE_ESTOURA_O_LIMITE = 'Teste Limite Por IP'
const NOME_QUE_DERRUBA_A_API = 'Teste Erro De Servidor'
const NOME_QUE_VAI_PARA_A_FILA = 'Teste Lista De Espera'
const EMAIL_QUE_NAO_RECEBE = 'sem-envio@example.com'
const CPF_A = '390.533.447-05'
const CPF_B = '111.444.777-35'
const CPF_C = '529.982.247-25'
const CPF_JA_INSCRITO = '123.456.780-62'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']
const TEXTO_DO_CONSENTIMENTO =
  'Texto de teste do consentimento da inscrição (versão 3).\nSegunda linha do texto de teste.'
const AVISO_SEM_VAGAS =
  'As vagas acabaram. Você pode se inscrever na lista de espera e será avisado por e-mail se uma vaga abrir.'

let contador = 0
/** Um nome que só este teste usa: o mock guarda TODOS os corpos recebidos e o teste acha o seu pelo nome. */
const nomeUnico = (base = 'Maria de Teste') =>
  `${base} ${Date.now().toString(36)}${++contador}`

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

type Corpo = Record<string, unknown> & {
  nome_completo: string
  idEvento: number
  participantes_adicionais?: Array<Record<string, unknown>>
}
async function corpoDe(page: Page, nome: string): Promise<Corpo> {
  const r = await page.request.get(`${MOCK}/__inscricoes-de-evento`)
  const lista = (await r.json()) as Corpo[]
  const achado = lista.findLast((c) => c.nome_completo === nome)
  expect(achado, `o mock não recebeu a inscrição de "${nome}"`).toBeTruthy()
  return achado!
}

const formulario = (page: Page) => page.locator('form[data-inscricao-form]')
const principal = (page: Page) =>
  formulario(page).locator('[data-participante][data-indice="0"]')
const resultado = (page: Page) => page.locator('[data-resultado]')
const enviar = (page: Page) =>
  formulario(page).getByRole('button', { name: 'Enviar inscrição' }).click()
const aceitar = async (page: Page) => {
  await expect(
    formulario(page).locator('[data-consentimento-texto]'),
  ).toBeVisible()
  await formulario(page).getByLabel('Li e aceito.').check()
}
const pessoa = (page: Page, numero: number) =>
  page.getByRole('group', { name: `Pessoa ${numero}` })

/** Conta os envios de inscrição (POST) que saem da página. */
function contarEnvios(page: Page) {
  const envios = { total: 0 }
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/inscrever-se'))
      envios.total += 1
  })
  return envios
}

/** O dado de cada pessoa do evento 7 (as 7 perguntas: 4 obrigatórias). `bloco` é a pessoa na página (a principal ou uma adicional). */
async function responderPerguntasDoEvento7(
  bloco: Locator,
  extra: { apelido?: string } = {},
) {
  await bloco.getByLabel('Redes sociais').check()
  await bloco.getByLabel('Qual é a sua idade?').fill('30')
  await bloco
    .getByLabel('Qual o seu nome para o crachá?')
    .fill(extra.apelido ?? 'Maria')
  await bloco.getByLabel('Café da manhã').check()
  await bloco.getByLabel('Jantar').check()
}

async function preencherEvento7(
  page: Page,
  dados: {
    nome: string
    cpf?: string
    email?: string
    telefone?: string
  },
) {
  const p = principal(page)
  await p.getByLabel('Nome completo').fill(dados.nome)
  await p.getByLabel('CPF').fill(dados.cpf ?? CPF_A)
  await formulario(page)
    .getByLabel('E-mail')
    .fill(dados.email ?? 'maria@example.com')
  await formulario(page)
    .getByLabel('Telefone/WhatsApp')
    .fill(dados.telefone ?? '(91) 98888-7777')
  await responderPerguntasDoEvento7(p)
}

async function preencherSimples(
  page: Page,
  dados: { nome: string; cpf?: string; email?: string },
) {
  await principal(page).getByLabel('Nome completo').fill(dados.nome)
  await principal(page)
    .getByLabel('CPF')
    .fill(dados.cpf ?? CPF_A)
  await formulario(page)
    .getByLabel('E-mail')
    .fill(dados.email ?? 'maria@example.com')
  await formulario(page).getByLabel('Telefone/WhatsApp').fill('91988887777')
}

test.describe('formulário de inscrição — evento gratuito com sessões e perguntas (evento 7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/eventos/7/')
  })

  test('mostra os campos, as perguntas no controle de cada tipo, as sessões com as vagas, o consentimento da API e a armadilha escondida', async ({
    page,
  }) => {
    await expect(
      page.getByRole('heading', { name: 'Inscreva-se neste evento', level: 2 }),
    ).toBeVisible()
    const form = formulario(page)
    for (const rotulo of [
      'Nome completo',
      'CPF',
      'E-mail',
      'Telefone/WhatsApp',
      'Sessão (opcional)',
      'Qual é a sua idade?',
      'Qual o seu nome para o crachá?',
      'Tem alguma restrição alimentar? (opcional)',
      'Data de nascimento (opcional)',
      'Tamanho da camiseta (opcional)',
    ]) {
      await expect(form.getByLabel(rotulo)).toBeVisible()
    }
    // a pergunta de uma escolha com até 5 opções é um grupo de botões de marcar; a de várias escolhas, de caixas; a de mais de 5, uma lista
    const fonte = principal(page).getByRole('radiogroup', {
      name: 'Como você ficou sabendo do evento?',
    })
    await expect(fonte.getByRole('radio')).toHaveCount(4)
    await expect(
      principal(page)
        .getByRole('group', {
          name: 'Quais refeições você vai fazer no local?',
        })
        .getByRole('checkbox'),
    ).toHaveCount(3)
    await expect(
      form.getByLabel('Tamanho da camiseta (opcional)').locator('option'),
    ).toHaveText(['Escolha uma opção', 'PP', 'P', 'M', 'G', 'GG', 'XG'])
    // o tipo do controle
    await expect(form.getByLabel('Qual é a sua idade?')).toHaveAttribute(
      'inputmode',
      'decimal',
    )
    await expect(
      form.getByLabel('Data de nascimento (opcional)'),
    ).toHaveAttribute('type', 'date')
    await expect(
      form.getByLabel('Tem alguma restrição alimentar? (opcional)'),
    ).toHaveJSProperty('tagName', 'TEXTAREA')
    // a sessão mostra as vagas livres (a lotada manda para a lista de espera)
    await expect(
      form.getByLabel('Sessão (opcional)').locator('option'),
    ).toHaveText([
      'Todo o evento (sem escolher uma sessão)',
      /^Oficina da manhã, .* — 6 vagas$/,
      /^Oficina da tarde, .* — sem vagas: lista de espera$/,
    ])
    // o consentimento: o texto da API, exatamente como veio (com a quebra de linha), e a caixa liberada só depois
    const texto = form.locator('[data-consentimento-texto]')
    await expect(texto).toBeVisible()
    expect(await texto.evaluate((e) => e.textContent)).toBe(
      TEXTO_DO_CONSENTIMENTO,
    )
    await expect(texto).toHaveCSS('white-space', 'pre-line')
    await expect(form.getByLabel('Li e aceito.')).toBeEnabled()
    await expect(
      form.getByRole('link', { name: 'Política de Privacidade' }),
    ).toHaveAttribute('href', '/privacidade/')
    // o evento tem vagas: sem aviso de "vagas acabaram"
    await expect(page.locator('[data-aviso-esgotado]')).toBeHidden()
    // a armadilha de robô: fora da tela, escondida do leitor de tela e fora da ordem do Tab
    const armadilha = page.locator('input[name="pagina_web"]')
    await expect(armadilha).toHaveAttribute('tabindex', '-1')
    await expect(
      armadilha.locator('xpath=ancestor::div[@aria-hidden="true"]'),
    ).toHaveCount(1)
    expect(
      await armadilha.evaluate((el) => el.getBoundingClientRect().left),
    ).toBeLessThan(-1000)
    await expect(resultado(page)).toBeHidden()
    await semViolacoesNosDois(page)
  })

  test('o texto do consentimento NÃO está escrito na página do build: só vem da API, no navegador', async ({
    request,
  }) => {
    const html = await (await request.get('/eventos/7/')).text()
    expect(html).not.toContain('Texto de teste do consentimento')
    expect(html).not.toContain('Segunda linha do texto de teste')
    // e a página também não escreve o número da versão que a API confere
    expect(html).not.toContain('versao_texto_consentimento')
  })

  test('enviar em branco avisa o que falta, foca o primeiro campo, liga cada aviso ao campo e não chama a API', async ({
    page,
  }) => {
    const envios = contarEnvios(page)
    await expect(
      formulario(page).locator('[data-consentimento-texto]'),
    ).toBeVisible()
    await enviar(page)
    // nome, CPF, e-mail, telefone, as 4 perguntas obrigatórias e o aceite
    await expect(page.getByRole('alert').first()).toHaveText(
      'Há 9 campos para corrigir.',
    )
    const nome = principal(page).getByLabel('Nome completo')
    await expect(nome).toBeFocused()
    await expect(nome).toHaveAttribute('aria-invalid', 'true')
    await expect(nome).toHaveAttribute(
      'aria-describedby',
      'inscricao-erro-nome-0',
    )
    await expect(page.locator('#inscricao-erro-nome-0')).toHaveText(
      'Informe o nome completo.',
    )
    await expect(page.locator('#inscricao-erro-cpf-0')).toHaveText(
      'Informe o CPF.',
    )
    await expect(page.locator('#inscricao-erro-email')).toHaveText(
      'Informe o seu e-mail.',
    )
    await expect(page.locator('#inscricao-erro-telefone')).toContainText(
      'Informe o telefone',
    )
    await expect(page.locator('#inscricao-p0-q701-erro')).toHaveText(
      'Escolha uma opção.',
    )
    await expect(page.locator('#inscricao-p0-q702-erro')).toHaveText(
      'Informe um número.',
    )
    await expect(page.locator('#inscricao-p0-q703-erro')).toHaveText(
      'Responda a esta pergunta.',
    )
    await expect(page.locator('#inscricao-p0-q705-erro')).toHaveText(
      'Escolha ao menos uma opção.',
    )
    // as perguntas opcionais em branco não viram erro
    await expect(page.locator('#inscricao-p0-q704-erro')).toBeHidden()
    await expect(page.locator('#inscricao-erro-consentimento')).toContainText(
      'ler e aceitar o texto de consentimento',
    )
    expect(envios.total).toBe(0)
    // o estado de erro também passa no axe, no computador e no celular
    await semViolacoesNosDois(page)
  })

  test('quem corrige um campo vê o aviso dele sumir na hora; o aviso de pergunta aponta a pergunta (número que não é número, data que não existe)', async ({
    page,
  }) => {
    const envios = contarEnvios(page)
    const nome = nomeUnico()
    await preencherEvento7(page, { nome })
    await aceitar(page)
    await formulario(page).getByLabel('Qual é a sua idade?').fill('abc')
    await formulario(page).getByLabel('Qual o seu nome para o crachá?').fill('')
    await enviar(page)
    await expect(page.getByRole('alert').first()).toHaveText(
      'Há 2 campos para corrigir.',
    )
    await expect(
      formulario(page).getByLabel('Qual é a sua idade?'),
    ).toBeFocused()
    await expect(page.locator('#inscricao-p0-q702-erro')).toContainText(
      'Use só números',
    )
    await expect(page.locator('#inscricao-p0-q703-erro')).toHaveText(
      'Responda a esta pergunta.',
    )
    await formulario(page).getByLabel('Qual é a sua idade?').fill('3,5')
    await expect(page.locator('#inscricao-p0-q702-erro')).toBeHidden()
    await expect(page.getByRole('alert').first()).toHaveText(
      'Há 1 campo para corrigir.',
    )
    expect(envios.total).toBe(0)
  })

  test('CPF, e-mail e telefone que não parecem certos são apontados antes de enviar', async ({
    page,
  }) => {
    const envios = contarEnvios(page)
    await preencherEvento7(page, {
      nome: nomeUnico(),
      cpf: '111.111.111-11',
      email: 'sem-arroba',
      telefone: '123',
    })
    await aceitar(page)
    await enviar(page)
    await expect(page.locator('#inscricao-erro-cpf-0')).toContainText(
      'não confere',
    )
    await expect(page.locator('#inscricao-erro-email')).toContainText(
      'não parece certo',
    )
    await expect(page.locator('#inscricao-erro-telefone')).toContainText(
      '10 ou 11 dígitos',
    )
    await expect(principal(page).getByLabel('CPF')).toBeFocused()
    expect(envios.total).toBe(0)
  })

  test('sem aceitar o consentimento não envia: o aviso aponta a caixa e leva o foco até ela', async ({
    page,
  }) => {
    const envios = contarEnvios(page)
    await preencherEvento7(page, { nome: nomeUnico() })
    await expect(
      formulario(page).locator('[data-consentimento-texto]'),
    ).toBeVisible()
    await enviar(page)
    await expect(page.locator('#inscricao-erro-consentimento')).toContainText(
      'Para se inscrever, é preciso ler e aceitar o texto de consentimento.',
    )
    await expect(formulario(page).getByLabel('Li e aceito.')).toBeFocused()
    expect(envios.total).toBe(0)
    await formulario(page).getByLabel('Li e aceito.').check()
    await expect(page.locator('#inscricao-erro-consentimento')).toBeHidden()
  })

  test('inscrição certa: vai para a API com os dados limpos, e a tela mostra o nome, a vaga reservada, o código em destaque, o link para cancelar e o e-mail', async ({
    page,
  }) => {
    const nome = nomeUnico()
    await preencherEvento7(page, { nome })
    await formulario(page)
      .getByLabel('Tem alguma restrição alimentar? (opcional)')
      .fill('Sem glúten')
    await formulario(page)
      .getByLabel('Tamanho da camiseta (opcional)')
      .selectOption('GG')
    await aceitar(page)
    await enviar(page)
    const tela = resultado(page)
    await expect(tela).toBeVisible()
    await expect(tela).toBeFocused()
    await expect(formulario(page)).toBeHidden()
    await expect(page.getByText('Preencha os dados abaixo.')).toBeHidden()
    await expect(
      tela.getByRole('heading', { name: 'Recebemos a sua inscrição.' }),
    ).toBeVisible()
    await expect(tela).toContainText(
      'Enviamos um e-mail para maria@example.com com o código e o link.',
    )
    const item = tela.locator('li')
    await expect(item).toHaveCount(1)
    await expect(item).toContainText(nome)
    await expect(item).toContainText('Situação: Vaga reservada')
    await expect(item.locator('[data-codigo]')).toHaveText(/^[0-9A-F]{8}$/)
    await expect(item).toContainText(
      'Apresente este código na entrada do evento.',
    )
    await expect(item).toContainText(
      'Guarde este link: é por ele que você cancela ou confirma a sua vaga.',
    )
    const link = item.getByRole('link')
    await expect(link).toHaveAttribute(
      'href',
      /^\/cancelar-inscricao\/\?token=[\w-]+$/,
    )
    await expect(link).toHaveText(
      /^http:\/\/127\.0\.0\.1:\d+\/cancelar-inscricao\/\?token=/,
    )
    await expect(item).not.toContainText('lista de espera')
    await semViolacoesNosDois(page)

    // o que a API recebeu: CPF e telefone só com dígitos, número como número, escolha múltipla como lista, a versão do consentimento que a API mostrou
    const corpo = await corpoDe(page, nome)
    expect(corpo).toMatchObject({
      idEvento: 7,
      cpf: '39053344705',
      email: 'maria@example.com',
      telefone: '91988887777',
      respostas: {
        '701': 'Redes sociais',
        '702': 30,
        '703': 'Maria',
        '704': 'Sem glúten',
        '705': ['Café da manhã', 'Jantar'],
        '707': 'GG',
      },
      participantes_adicionais: [],
      consentimento_lgpd: true,
      versao_texto_consentimento: '3',
      pagina_web: '',
    })
    expect(corpo).not.toHaveProperty('id_sessao')
    expect(corpo).not.toHaveProperty('codigo_cupom')
    // a pergunta opcional que ficou em branco não vai
    expect(corpo.respostas).not.toHaveProperty('706')
  })

  test('com a sessão lotada escolhida: o aviso "as vagas acabaram" aparece, e a inscrição entra na lista de espera, sem código', async ({
    page,
  }) => {
    const nome = nomeUnico()
    await preencherEvento7(page, { nome })
    const aviso = page.locator('[data-aviso-esgotado]')
    await expect(aviso).toBeHidden()
    await formulario(page).getByLabel('Sessão (opcional)').selectOption('72')
    await expect(aviso).toBeVisible()
    await expect(aviso).toHaveText(AVISO_SEM_VAGAS)
    // volta ao evento todo: o aviso some; escolhe de novo a sessão lotada
    await formulario(page).getByLabel('Sessão (opcional)').selectOption('')
    await expect(aviso).toBeHidden()
    await formulario(page).getByLabel('Sessão (opcional)').selectOption('72')
    await expect(aviso).toBeVisible()
    await aceitar(page)
    await enviar(page)
    const item = resultado(page).locator('li')
    await expect(item).toContainText('Situação: Lista de espera')
    await expect(item).toContainText(
      'Você será avisado(a) por e-mail se uma vaga abrir.',
    )
    await expect(item.locator('[data-codigo]')).toHaveCount(0)
    await expect(item).not.toContainText('Código de check-in')
    await expect(item).toContainText('Guarde este link')
    await expect(aviso).toBeHidden() // some junto com o formulário
    expect((await corpoDe(page, nome)).id_sessao).toBe(72)
    await semViolacoes(page)
  })

  test('e-mail que não saiu: a tela manda guardar o código e o link', async ({
    page,
  }) => {
    const nome = nomeUnico()
    await preencherEvento7(page, { nome, email: EMAIL_QUE_NAO_RECEBE })
    await aceitar(page)
    await enviar(page)
    await expect(resultado(page)).toContainText(
      'Não conseguimos enviar o e-mail: guarde o código e o link desta tela.',
    )
    await expect(resultado(page)).not.toContainText('Enviamos um e-mail')
    await expect(resultado(page).locator('[data-codigo]')).toHaveText(
      /^[0-9A-F]{8}$/,
    )
    await expect(resultado(page).getByRole('link')).toBeVisible()
  })

  test('a armadilha preenchida mostra a mesma tela de sucesso, só que sem código nem link', async ({
    page,
  }) => {
    const nome = nomeUnico()
    await preencherEvento7(page, { nome })
    await page.locator('input[name="pagina_web"]').evaluate((e) => {
      ;(e as HTMLInputElement).value = 'http://spam.example'
    })
    await aceitar(page)
    await enviar(page)
    await expect(resultado(page)).toBeVisible()
    await expect(resultado(page)).toContainText('Recebemos a sua inscrição.')
    await expect(resultado(page).locator('li')).toHaveCount(0)
    await expect(resultado(page).locator('[data-codigo]')).toHaveCount(0)
    expect((await corpoDe(page, nome)).pagina_web).toBe('http://spam.example')
  })

  test('um duplo clique no botão manda uma inscrição só', async ({ page }) => {
    const envios = contarEnvios(page)
    await preencherEvento7(page, { nome: nomeUnico() })
    await aceitar(page)
    const botao = formulario(page).getByRole('button', {
      name: 'Enviar inscrição',
    })
    await botao.dblclick()
    await expect(resultado(page)).toBeVisible()
    expect(envios.total).toBe(1)
  })
})

test.describe('formulário de inscrição — o que dá errado', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/eventos/7/')
  })

  const falha = (page: Page, texto: string | RegExp) =>
    page.getByRole('alert').filter({ hasText: texto })

  test('429 (muitas inscrições deste endereço): a pessoa lê o motivo e não perde o que digitou', async ({
    page,
  }) => {
    await preencherEvento7(page, { nome: NOME_QUE_ESTOURA_O_LIMITE })
    await aceitar(page)
    await enviar(page)
    const aviso = falha(page, 'Muitas tentativas - aguarde 60 minutos')
    await expect(aviso).toBeVisible()
    await expect(aviso).toBeFocused()
    await expect(principal(page).getByLabel('Nome completo')).toHaveValue(
      NOME_QUE_ESTOURA_O_LIMITE,
    )
    await expect(
      formulario(page).getByRole('button', { name: 'Enviar inscrição' }),
    ).toBeEnabled()
    await expect(resultado(page)).toBeHidden()
    await semViolacoes(page)
  })

  test('erro de servidor: orientação sem culpar a pessoa, e dá para tentar de novo', async ({
    page,
  }) => {
    await preencherEvento7(page, { nome: NOME_QUE_DERRUBA_A_API })
    await aceitar(page)
    await enviar(page)
    await expect(
      falha(page, 'Não foi possível enviar a inscrição agora'),
    ).toBeVisible()
    await expect(
      formulario(page).getByRole('button', { name: 'Enviar inscrição' }),
    ).toBeEnabled()
    await expect(principal(page).getByLabel('CPF')).toHaveValue(CPF_A)
  })

  test('CPF que já está inscrito: a frase da API e o que fazer', async ({
    page,
  }) => {
    await preencherEvento7(page, { nome: nomeUnico(), cpf: CPF_JA_INSCRITO })
    await aceitar(page)
    await enviar(page)
    const aviso = falha(page, 'já está inscrita neste contexto')
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText(
      'Confira o CPF digitado ou fale com a secretaria.',
    )
    await expect(aviso).not.toContainText('várias pessoas')
    await expect(resultado(page)).toBeHidden()
  })

  test('pergunta obrigatória recusada pela API (422) também é mostrada como veio', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/7/inscrever-se', (rota) =>
      rota.fulfill({
        status: 422,
        json: {
          detail: 'A pergunta "Qual o seu nome para o crachá?" é obrigatória.',
        },
      }),
    )
    await preencherEvento7(page, { nome: nomeUnico() })
    await aceitar(page)
    await enviar(page)
    await expect(
      falha(page, 'A pergunta "Qual o seu nome para o crachá?" é obrigatória.'),
    ).toBeVisible()
  })

  test('evento que acabou de acontecer (400 da API): a frase da API', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/7/inscrever-se', (rota) =>
      rota.fulfill({
        status: 400,
        json: {
          detail:
            'As inscrições deste evento já foram encerradas: o evento já aconteceu.',
        },
      }),
    )
    await preencherEvento7(page, { nome: nomeUnico() })
    await aceitar(page)
    await enviar(page)
    await expect(falha(page, 'já foram encerradas')).toBeVisible()
  })

  test('sem rede: a mensagem manda tentar de novo e avisa que a inscrição pode ter sido feita', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/7/inscrever-se', (rota) =>
      rota.abort(),
    )
    await preencherEvento7(page, { nome: nomeUnico() })
    await aceitar(page)
    await enviar(page)
    const aviso = falha(page, 'pode ter sido registrada')
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('Tente de novo em alguns instantes')
    await expect(
      formulario(page).getByRole('button', { name: 'Enviar inscrição' }),
    ).toBeEnabled()
  })

  test('o texto do consentimento mudou desde que a página abriu: mostra o texto novo, desmarca a caixa e envia a versão nova', async ({
    page,
  }) => {
    let consultas = 0
    await page.route('**/api/publico/eventos/consentimento-lgpd', (rota) => {
      consultas += 1
      return rota.fulfill({
        json:
          consultas === 1
            ? { texto: 'Texto antigo.', versao: '3' }
            : { texto: 'Texto NOVO do consentimento.', versao: '4' },
      })
    })
    let envios = 0
    const nome = nomeUnico()
    await page.route('**/api/publico/eventos/7/inscrever-se', async (rota) => {
      envios += 1
      if (envios === 1)
        return rota.fulfill({
          status: 422,
          json: {
            detail:
              'O texto de consentimento LGPD foi atualizado - recarregue a página e aceite a versão atual.',
          },
        })
      const corpo = rota.request().postDataJSON() as {
        versao_texto_consentimento: string
      }
      expect(corpo.versao_texto_consentimento).toBe('4')
      return rota.fulfill({
        json: {
          participantes: [
            {
              nome_completo: nome,
              status: 'Pré-inscrito',
              codigo_checkin: 'AB12CD34',
              token_cancelamento: 'tok-novo-0001',
              email_enviado: true,
            },
          ],
        },
      })
    })
    await page.goto('/eventos/7/')
    await expect(
      formulario(page).locator('[data-consentimento-texto]'),
    ).toHaveText('Texto antigo.')
    await preencherEvento7(page, { nome })
    await aceitar(page)
    await enviar(page)
    await expect(
      falha(page, 'O texto do consentimento foi atualizado'),
    ).toBeVisible()
    await expect(
      formulario(page).locator('[data-consentimento-texto]'),
    ).toHaveText('Texto NOVO do consentimento.')
    await expect(formulario(page).getByLabel('Li e aceito.')).not.toBeChecked()
    await aceitar(page)
    await enviar(page)
    await expect(resultado(page)).toContainText(nome)
    await expect(resultado(page).locator('[data-codigo]')).toHaveText(
      'AB12CD34',
    )
  })

  test('o texto do consentimento não carregou: erro claro, caixa travada, não envia; "Tentar carregar de novo" resolve', async ({
    page,
  }) => {
    let consultas = 0
    await page.route('**/api/publico/eventos/consentimento-lgpd', (rota) => {
      consultas += 1
      return consultas <= 2 ? rota.abort() : rota.continue()
    })
    const envios = contarEnvios(page)
    await page.goto('/eventos/7/')
    const estado = formulario(page).locator('[data-consentimento-estado]')
    await expect(estado).toContainText(
      'Não foi possível carregar o texto do consentimento',
    )
    await expect(formulario(page).getByLabel('Li e aceito.')).toBeDisabled()
    await expect(
      formulario(page).locator('[data-consentimento-texto]'),
    ).toBeHidden()
    await preencherEvento7(page, { nome: nomeUnico() })
    await enviar(page)
    await expect(page.locator('#inscricao-erro-consentimento')).toContainText(
      'Tentar carregar de novo',
    )
    expect(envios.total).toBe(0)
    await semViolacoesNosDois(page)
    await formulario(page)
      .getByRole('button', { name: 'Tentar carregar de novo' })
      .click()
    await expect(
      formulario(page).locator('[data-consentimento-texto]'),
    ).toBeVisible()
    await expect(formulario(page).getByLabel('Li e aceito.')).toBeEnabled()
    await formulario(page).getByLabel('Li e aceito.').check()
    await enviar(page)
    await expect(resultado(page)).toBeVisible()
  })

  test('API sem a rota do consentimento (404, antiga): não deixa enviar', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/consentimento-lgpd', (rota) =>
      rota.fulfill({ status: 404, json: { detail: 'Not Found' } }),
    )
    await page.goto('/eventos/7/')
    await expect(
      formulario(page).locator('[data-consentimento-estado]'),
    ).toContainText('Não foi possível carregar o texto do consentimento')
    await expect(formulario(page).getByLabel('Li e aceito.')).toBeDisabled()
  })
})

test.describe('inscrição em grupo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/eventos/7/')
  })

  test('"Inscrever mais uma pessoa" acrescenta uma pessoa com nome, CPF e as mesmas perguntas; remover renumera e devolve o foco', async ({
    page,
  }) => {
    const adicionar = formulario(page).getByRole('button', {
      name: 'Inscrever mais uma pessoa',
    })
    await expect(
      formulario(page).getByText('cada pessoa tem a sua própria inscrição'),
    ).toBeVisible()
    await adicionar.click()
    await adicionar.click()
    const p2 = pessoa(page, 2)
    const p3 = pessoa(page, 3)
    await expect(p2).toBeVisible()
    await expect(p3).toBeVisible()
    for (const bloco of [p2, p3]) {
      await expect(bloco.getByLabel('Nome completo')).toBeVisible()
      await expect(bloco.getByLabel('CPF')).toBeVisible()
      await expect(bloco.getByLabel('Qual é a sua idade?')).toBeVisible()
      await expect(bloco.getByLabel('Café da manhã')).toBeVisible()
      // as perguntas do grupo não repetem e-mail, telefone nem sessão: são do grupo
      await expect(bloco.getByLabel('E-mail')).toHaveCount(0)
      await expect(bloco.getByLabel('Telefone/WhatsApp')).toHaveCount(0)
    }
    await expect(p3.getByLabel('Nome completo')).toBeFocused() // o foco vai à pessoa nova
    // ids únicos na página inteira
    const ids = await page
      .locator('[id]')
      .evaluateAll((es) => es.map((e) => e.id))
    expect(new Set(ids).size).toBe(ids.length)
    // remover a pessoa 2: a 3 vira 2 e o foco volta ao botão de adicionar
    await p2.getByRole('button', { name: 'Remover a pessoa 2' }).click()
    await expect(page.getByRole('group', { name: 'Pessoa 3' })).toHaveCount(0)
    await expect(pessoa(page, 2)).toBeVisible()
    await expect(
      pessoa(page, 2).getByRole('button', { name: 'Remover a pessoa 2' }),
    ).toBeVisible()
    await expect(adicionar).toBeFocused()
    await semViolacoesNosDois(page)
  })

  test('o limite é 10 pessoas por inscrição: o botão trava, o aviso aparece e remover destrava', async ({
    page,
  }) => {
    const adicionar = formulario(page).getByRole('button', {
      name: 'Inscrever mais uma pessoa',
    })
    for (let i = 0; i < 9; i++) await adicionar.click()
    await expect(pessoa(page, 10)).toBeVisible()
    await expect(adicionar).toBeDisabled()
    await expect(
      formulario(page).getByText(
        'Chegou ao limite de 10 pessoas por inscrição.',
      ),
    ).toBeVisible()
    await pessoa(page, 10)
      .getByRole('button', { name: 'Remover a pessoa 10' })
      .click()
    await expect(adicionar).toBeEnabled()
    await expect(
      formulario(page).getByText(
        'Chegou ao limite de 10 pessoas por inscrição.',
      ),
    ).toBeHidden()
  })

  test('as perguntas obrigatórias valem para CADA pessoa, e o aviso é da pessoa certa', async ({
    page,
  }) => {
    const envios = contarEnvios(page)
    await preencherEvento7(page, { nome: nomeUnico() })
    await aceitar(page)
    await formulario(page)
      .getByRole('button', { name: 'Inscrever mais uma pessoa' })
      .click()
    await enviar(page)
    // a pessoa 2 está em branco: nome, CPF e as 4 perguntas obrigatórias
    await expect(page.getByRole('alert').first()).toHaveText(
      'Há 6 campos para corrigir.',
    )
    await expect(pessoa(page, 2).getByLabel('Nome completo')).toBeFocused()
    await expect(
      pessoa(page, 2).getByText('Informe o nome completo.'),
    ).toBeVisible()
    await expect(
      principal(page).getByText('Informe o nome completo.'),
    ).toBeHidden()
    await semViolacoesNosDois(page)
    expect(envios.total).toBe(0)
  })

  test('o mesmo CPF para duas pessoas é apontado antes de enviar', async ({
    page,
  }) => {
    await preencherEvento7(page, { nome: nomeUnico(), cpf: CPF_A })
    await aceitar(page)
    await formulario(page)
      .getByRole('button', { name: 'Inscrever mais uma pessoa' })
      .click()
    const p2 = pessoa(page, 2)
    await p2.getByLabel('Nome completo').fill('Pedro de Teste')
    await p2.getByLabel('CPF').fill('390.533.447-05')
    await responderPerguntasDoEvento7(p2)
    await enviar(page)
    await expect(
      p2.getByText(
        'Este CPF já foi informado para outra pessoa desta inscrição.',
      ),
    ).toBeVisible()
    await expect(p2.getByLabel('CPF')).toBeFocused()
  })

  test('envio em grupo: a principal no topo e as outras em `participantes_adicionais`; a tela mostra cada pessoa com o seu código e o seu link', async ({
    page,
  }) => {
    const nome = nomeUnico('Mãe de Teste')
    await preencherEvento7(page, { nome })
    await aceitar(page)
    const adicionar = formulario(page).getByRole('button', {
      name: 'Inscrever mais uma pessoa',
    })
    await adicionar.click()
    await adicionar.click()
    await pessoa(page, 2).getByLabel('Nome completo').fill('Filho de Teste')
    await pessoa(page, 2).getByLabel('CPF').fill(CPF_B)
    await responderPerguntasDoEvento7(pessoa(page, 2), { apelido: 'Filho' })
    await pessoa(page, 3)
      .getByLabel('Nome completo')
      .fill(NOME_QUE_VAI_PARA_A_FILA)
    await pessoa(page, 3).getByLabel('CPF').fill(CPF_C)
    await responderPerguntasDoEvento7(pessoa(page, 3), { apelido: 'Fila' })
    await enviar(page)
    const tela = resultado(page)
    await expect(tela).toBeVisible()
    const itens = tela.locator('li')
    await expect(itens).toHaveCount(3)
    await expect(itens.nth(0)).toContainText(nome)
    await expect(itens.nth(0).locator('[data-codigo]')).toHaveText(
      /^[0-9A-F]{8}$/,
    )
    await expect(itens.nth(1)).toContainText('Filho de Teste')
    await expect(itens.nth(1)).toContainText('Vaga reservada')
    await expect(itens.nth(1).locator('[data-codigo]')).toHaveText(
      /^[0-9A-F]{8}$/,
    )
    // quem caiu na lista de espera não tem código, só o aviso
    await expect(itens.nth(2)).toContainText(NOME_QUE_VAI_PARA_A_FILA)
    await expect(itens.nth(2)).toContainText('Lista de espera')
    await expect(itens.nth(2).locator('[data-codigo]')).toHaveCount(0)
    // um link para cada pessoa, todos diferentes
    const hrefs = await tela
      .getByRole('link')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')))
    expect(hrefs).toHaveLength(3)
    expect(new Set(hrefs).size).toBe(3)
    // o e-mail saiu para todos: uma frase só
    await expect(tela).toContainText(
      'Enviamos um e-mail para maria@example.com com o código e o link.',
    )
    await semViolacoesNosDois(page)

    const corpo = await corpoDe(page, nome)
    expect(corpo.participantes_adicionais).toEqual([
      {
        nome_completo: 'Filho de Teste',
        cpf: '11144477735',
        respostas: {
          '701': 'Redes sociais',
          '702': 30,
          '703': 'Filho',
          '705': ['Café da manhã', 'Jantar'],
        },
      },
      {
        nome_completo: NOME_QUE_VAI_PARA_A_FILA,
        cpf: '52998224725',
        respostas: {
          '701': 'Redes sociais',
          '702': 30,
          '703': 'Fila',
          '705': ['Café da manhã', 'Jantar'],
        },
      },
    ])
  })

  test('falha em grupo: o aviso lembra que parte das pessoas pode já ter sido inscrita', async ({
    page,
  }) => {
    await preencherEvento7(page, { nome: nomeUnico() })
    await aceitar(page)
    await formulario(page)
      .getByRole('button', { name: 'Inscrever mais uma pessoa' })
      .click()
    await pessoa(page, 2).getByLabel('Nome completo').fill('Pedro de Teste')
    await pessoa(page, 2).getByLabel('CPF').fill(CPF_JA_INSCRITO)
    await responderPerguntasDoEvento7(pessoa(page, 2))
    await enviar(page)
    const aviso = page
      .getByRole('alert')
      .filter({ hasText: 'já está inscrita neste contexto' })
    await expect(aviso).toContainText(
      'Como são várias pessoas, algumas podem já ter sido inscritas',
    )
  })
})

test.describe('inscrição em evento gratuito simples (evento 2) e com as vagas esgotadas (evento 8)', () => {
  test('evento 2 (sem perguntas): só os dados da pessoa e a sessão; a sessão escolhida vai no corpo', async ({
    page,
  }) => {
    await page.goto('/eventos/2/')
    await expect(page.locator('[data-aviso-esgotado]')).toBeHidden()
    // sessões sem limite de vagas: o texto da opção não diz vagas
    await expect(
      formulario(page).getByLabel('Sessão (opcional)').locator('option'),
    ).toHaveText([
      'Todo o evento (sem escolher uma sessão)',
      /^Acolhimento e boas-vindas, [^—]*$/,
      /^Roda de conversa, [^—]*$/,
    ])
    await expect(
      formulario(page).locator('[data-pergunta], fieldset'),
    ).toHaveCount(0)
    const nome = nomeUnico()
    await preencherSimples(page, { nome })
    await formulario(page).getByLabel('Sessão (opcional)').selectOption('22')
    await aceitar(page)
    await enviar(page)
    await expect(resultado(page).locator('li')).toContainText(
      'Situação: Vaga reservada',
    )
    const corpo = await corpoDe(page, nome)
    expect(corpo).toMatchObject({ idEvento: 2, id_sessao: 22, respostas: {} })
    await semViolacoes(page)
  })

  test('evento 8 (vagas esgotadas): o aviso da lista de espera aparece antes de preencher, e a inscrição entra na fila', async ({
    page,
  }) => {
    await page.goto('/eventos/8/')
    await expect(page.locator('dd[data-vagas]')).toHaveText('Vagas esgotadas')
    const aviso = page.locator('[data-aviso-esgotado]')
    await expect(aviso).toBeVisible()
    await expect(aviso).toHaveText(AVISO_SEM_VAGAS)
    await semViolacoesNosDois(page)
    const nome = nomeUnico()
    await preencherSimples(page, { nome })
    await aceitar(page)
    await enviar(page)
    const item = resultado(page).locator('li')
    await expect(item).toContainText('Situação: Lista de espera')
    await expect(item).toContainText(
      'Você será avisado(a) por e-mail se uma vaga abrir.',
    )
    await expect(item.locator('[data-codigo]')).toHaveCount(0)
    await expect(item.getByRole('link')).toHaveAttribute(
      'href',
      /^\/cancelar-inscricao\/\?token=/,
    )
    await semViolacoesNosDois(page)
  })

  test('as vagas ao vivo mandam: o evento 7 esgota depois do build (aviso aparece); o evento 8 abre vaga (aviso some)', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/7', (rota) =>
      rota.fulfill({ json: { id_evento: 7, vagas_livres: 0, sessoes: [] } }),
    )
    await page.goto('/eventos/7/')
    await expect(page.locator('[data-aviso-esgotado]')).toBeVisible()
    await expect(page.locator('[data-aviso-esgotado]')).toHaveText(
      AVISO_SEM_VAGAS,
    )
    await page.unroute('**/api/publico/eventos/7')

    await page.route('**/api/publico/eventos/8', (rota) =>
      rota.fulfill({ json: { id_evento: 8, vagas_livres: 2, sessoes: [] } }),
    )
    await page.goto('/eventos/8/')
    await expect(page.locator('dd[data-vagas]')).toHaveText(
      '2 vagas disponíveis',
    )
    await expect(page.locator('[data-aviso-esgotado]')).toBeHidden()
  })

  test('as vagas de cada sessão também chegam ao vivo', async ({ page }) => {
    await page.route('**/api/publico/eventos/7', (rota) =>
      rota.fulfill({
        json: {
          id_evento: 7,
          vagas_livres: 18,
          sessoes: [
            { id_sessao: 71, vagas_livres: 0 },
            { id_sessao: 72, vagas_livres: 4 },
          ],
        },
      }),
    )
    await page.goto('/eventos/7/')
    const opcoes = formulario(page)
      .getByLabel('Sessão (opcional)')
      .locator('option')
    await expect(opcoes.nth(1)).toHaveText(/ — sem vagas: lista de espera$/)
    await expect(opcoes.nth(2)).toHaveText(/ — 4 vagas$/)
    await formulario(page).getByLabel('Sessão (opcional)').selectOption('71')
    await expect(page.locator('[data-aviso-esgotado]')).toBeVisible()
    await formulario(page).getByLabel('Sessão (opcional)').selectOption('72')
    await expect(page.locator('[data-aviso-esgotado]')).toBeHidden()
  })
})

test.describe('quando NÃO há formulário', () => {
  test('evento com valor (3): a inscrição é com a secretaria, e a página diz que o evento tem inscrição com valor', async ({
    page,
  }) => {
    await page.goto('/eventos/3/')
    await expect(page.locator('form[data-inscricao-form]')).toHaveCount(0)
    const bloco = page.getByRole('region', { name: 'Como participar' })
    await expect(bloco).toContainText(
      'Este evento tem inscrição com valor. A inscrição é feita com a secretaria',
    )
    await expect(bloco.getByRole('link', { name: /Ligar:/ })).toBeVisible()
    await expect(
      bloco.getByRole('link', { name: 'Enviar e-mail' }),
    ).toBeVisible()
    await semViolacoes(page)
  })

  test('evento que pede um arquivo (9): "faça a inscrição com a secretaria", sem formulário', async ({
    page,
  }) => {
    await page.goto('/eventos/9/')
    await expect(page.locator('form[data-inscricao-form]')).toHaveCount(0)
    const bloco = page.getByRole('region', { name: 'Como participar' })
    await expect(bloco).toContainText(
      'Este evento pede o envio de um arquivo; faça a inscrição com a secretaria.',
    )
    await expect(bloco.getByRole('link', { name: /Ligar:/ })).toBeVisible()
    await semViolacoes(page)
  })

  test('evento que já aconteceu (1): nem formulário nem "Como participar"', async ({
    page,
  }) => {
    await page.goto('/eventos/1/')
    await expect(page.locator('[data-aviso-realizado]')).toBeVisible()
    await expect(page.locator('form[data-inscricao-form]')).toHaveCount(0)
    await expect(page.locator('[data-como-participar]')).toHaveCount(0)
  })

  test('evento que acontece depois do build mas "já passou" para quem abre a página: o formulário some e fica o aviso', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2035-01-01T12:00:00-03:00'))
    await page.goto('/eventos/7/')
    await expect(page.locator('[data-aviso-realizado]')).toBeVisible()
    await expect(page.locator('[data-como-participar]')).toBeHidden()
    await expect(page.locator('form[data-inscricao-form]')).toBeHidden()
  })

  test('evento retirado da programação depois do build (404 da API): o formulário some e fica o aviso', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/7', (rota) =>
      rota.fulfill({ status: 404, json: { detail: 'Evento não encontrado.' } }),
    )
    await page.goto('/eventos/7/')
    await expect(page.locator('[data-aviso-retirado]')).toBeVisible()
    await expect(page.locator('[data-como-participar]')).toBeHidden()
    await expect(page.locator('form[data-inscricao-form]')).toBeHidden()
  })

  test('API fora do ar: o formulário continua como foi publicado (a consulta de vagas falhar não alarma)', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/7', (rota) => rota.abort())
    await page.goto('/eventos/7/')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-aviso-retirado]')).toBeHidden()
    await expect(formulario(page)).toBeVisible()
  })

  test('sem JavaScript: o aviso manda falar com a secretaria (o formulário precisa do JavaScript para enviar)', async ({
    browser,
  }) => {
    const contexto = await browser.newContext({ javaScriptEnabled: false })
    const page = await contexto.newPage()
    await page.goto('/eventos/7/')
    // (o Playwright não lê o texto de <noscript> pelo getByText; o parágrafo dentro dele é achado e medido pelo CSS)
    const avisos = page.locator('noscript p.font-medium')
    await expect(avisos.first()).toBeVisible()
    const textos = await avisos.evaluateAll((es) =>
      es.map((el) => el.textContent ?? ''),
    )
    expect(
      textos.some((t) =>
        t.includes(
          'Para se inscrever por esta página é preciso ativar o JavaScript do navegador',
        ),
      ),
    ).toBe(true)
    await contexto.close()
  })
})

test.describe('celular (375 px)', () => {
  test.use({ viewport: { width: 375, height: 700 } })

  test('o formulário cabe na tela, sem rolagem para os lados, e o envio funciona', async ({
    page,
  }) => {
    await page.goto('/eventos/7/')
    const nome = nomeUnico()
    await preencherEvento7(page, { nome })
    await formulario(page)
      .getByRole('button', { name: 'Inscrever mais uma pessoa' })
      .click()
    await aceitar(page)
    const folga = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(folga).toBeLessThanOrEqual(0)
    await pessoa(page, 2).getByLabel('Nome completo').fill('Pedro de Teste')
    await pessoa(page, 2).getByLabel('CPF').fill(CPF_B)
    await responderPerguntasDoEvento7(pessoa(page, 2))
    await enviar(page)
    await expect(resultado(page)).toBeVisible()
    const folgaDepois = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(folgaDepois).toBeLessThanOrEqual(0)
    await semViolacoes(page)
  })
})

/* ---------------------------------------------------------------------------------------------------------------------------- */
/* As páginas dos links do e-mail                                                                                                  */
/* ---------------------------------------------------------------------------------------------------------------------------- */

const cancelar = (token?: string) =>
  token === undefined
    ? '/cancelar-inscricao/'
    : `/cancelar-inscricao/?token=${token}`
const confirmar = (token?: string) =>
  token === undefined
    ? '/confirmar-inscricao/'
    : `/confirmar-inscricao/?token=${token}`
const linhaDoResumo = (page: Page, rotulo: string) =>
  page
    .locator('dl > div')
    .filter({ has: page.getByText(rotulo, { exact: true }) })

test.describe('/cancelar-inscricao/', () => {
  test('sem o código no endereço: diz que falta o link e leva à agenda; fora do Google', async ({
    page,
  }) => {
    const chamadas: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/publico/inscricoes')) chamadas.push(r.url())
    })
    await page.goto(cancelar())
    await expect(
      page.getByRole('heading', { name: 'Cancelar inscrição', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'Esta página precisa do link que foi enviado para o seu e-mail.',
      ),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Ver os eventos' }).click()
    await expect(page).toHaveURL(/\/eventos\/$/)
    await page.goto(cancelar())
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    )
    expect(chamadas).toEqual([])
    await semViolacoesNosDois(page)
  })

  test('código que não existe (404): "Esse link não é válido: confira o endereço que veio no e-mail."', async ({
    page,
  }) => {
    await page.goto(cancelar('codigo-que-nao-existe-1234'))
    await expect(
      page.getByText(
        'Esse link não é válido: confira o endereço que veio no e-mail.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Cancelar a minha inscrição' }),
    ).toHaveCount(0)
    await semViolacoesNosDois(page)
  })

  test('código com lixo no endereço: link inválido, sem chamar a API', async ({
    page,
  }) => {
    const chamadas: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/publico/inscricoes')) chamadas.push(r.url())
    })
    await page.goto(cancelar('..%2F..%2Fadmin'))
    await expect(page.getByText('Esse link não é válido')).toBeVisible()
    expect(chamadas).toEqual([])
  })

  test('mostra o evento (dia e hora de Parauapebas), o local, o primeiro nome e a situação; cancela depois de uma etapa de confirmação', async ({
    page,
  }) => {
    await page.goto(cancelar('fixo-reservada'))
    await expect(linhaDoResumo(page, 'Evento')).toContainText(
      'Evento de teste — inscrição com perguntas',
    )
    await expect(linhaDoResumo(page, 'Quando')).toContainText(/às 19:00$/)
    await expect(linhaDoResumo(page, 'Onde')).toContainText(
      'Salão de teste, Parauapebas',
    )
    await expect(linhaDoResumo(page, 'Inscrição de')).toContainText('Maria')
    await expect(linhaDoResumo(page, 'Inscrição de')).not.toContainText('Silva') // só o primeiro nome
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Vaga reservada',
    )
    await expect(linhaDoResumo(page, 'Código de check-in')).toContainText(
      'A1B2C3D4',
    )
    await expect(linhaDoResumo(page, 'Sessão')).toBeHidden()
    await semViolacoesNosDois(page)

    const botao = page.getByRole('button', {
      name: 'Cancelar a minha inscrição',
    })
    await botao.click()
    await expect(
      page.getByText('Tem certeza? Você perde a vaga.'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Sim, cancelar a minha inscrição' }),
    ).toBeFocused()
    await semViolacoes(page)
    await page.getByRole('button', { name: 'Não, voltar' }).click()
    await expect(page.getByText('Tem certeza?')).toBeHidden()
    await expect(botao).toBeFocused()
    await botao.click()
    await page
      .getByRole('button', { name: 'Sim, cancelar a minha inscrição' })
      .click()
    const sucesso = page
      .getByRole('status')
      .filter({ hasText: 'A sua inscrição foi cancelada.' })
    await expect(sucesso).toBeVisible()
    await expect(sucesso).toBeFocused()
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Inscrição cancelada',
    )
    await expect(linhaDoResumo(page, 'Código de check-in')).toBeHidden()
    await expect(
      page.getByRole('button', { name: /cancelar a minha inscrição/i }),
    ).toHaveCount(0)
    await semViolacoesNosDois(page)
  })

  test('quem está na lista de espera lê "Você sai da lista de espera" e não vê código', async ({
    page,
  }) => {
    await page.goto(cancelar('fixo-lista-de-espera'))
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Na lista de espera',
    )
    await expect(linhaDoResumo(page, 'Código de check-in')).toBeHidden()
    await page
      .getByRole('button', { name: 'Cancelar a minha inscrição' })
      .click()
    await expect(
      page.getByText('Tem certeza? Você sai da lista de espera.'),
    ).toBeVisible()
  })

  test('cancelamento com valor a devolver: diz o valor e que a secretaria cuida do pagamento', async ({
    page,
  }) => {
    await page.goto(cancelar('fixo-com-reembolso'))
    await page
      .getByRole('button', { name: 'Cancelar a minha inscrição' })
      .click()
    await page
      .getByRole('button', { name: 'Sim, cancelar a minha inscrição' })
      .click()
    await expect(
      page.getByText(
        /Foi registrado um valor a devolver de R\$\s50,00; a secretaria cuida do pagamento\./,
      ),
    ).toBeVisible()
    await semViolacoes(page)
  })

  test('inscrição já cancelada e evento que já aconteceu: explicação, sem botão', async ({
    page,
  }) => {
    await page.goto(cancelar('fixo-cancelada'))
    await expect(
      page.getByText('Esta inscrição já foi cancelada.'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Cancelar a minha inscrição' }),
    ).toHaveCount(0)
    await semViolacoes(page)
    await page.goto(cancelar('fixo-encerrada'))
    await expect(
      page.getByText(
        'Este evento já aconteceu: não é mais possível cancelar a inscrição.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Cancelar a minha inscrição' }),
    ).toHaveCount(0)
    await semViolacoes(page)
  })

  test('quem foi chamado da lista de espera vê o prazo em horário de Belém, a sessão e o caminho para confirmar', async ({
    page,
  }) => {
    await page.goto(cancelar('fixo-promovida'))
    await expect(linhaDoResumo(page, 'Confirme até')).toContainText(
      /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(horário de Belém\)/,
    )
    await expect(linhaDoResumo(page, 'Sessão')).toContainText(
      'Oficina da manhã',
    )
    const cruzado = page.getByRole('link', {
      name: 'Quero ficar com a vaga: confirmar',
    })
    await expect(cruzado).toHaveAttribute(
      'href',
      '/confirmar-inscricao/?token=fixo-promovida',
    )
    await cruzado.click()
    await expect(page).toHaveURL(
      /\/confirmar-inscricao\/\?token=fixo-promovida$/,
    )
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toBeVisible()
  })

  test('falha ao cancelar (erro de servidor): a pessoa lê o aviso e o botão volta', async ({
    page,
  }) => {
    await page.goto(cancelar('fixo-falha-ao-cancelar'))
    await page
      .getByRole('button', { name: 'Cancelar a minha inscrição' })
      .click()
    const botao = page.getByRole('button', {
      name: 'Sim, cancelar a minha inscrição',
    })
    await botao.click()
    const aviso = page
      .getByRole('alert')
      .filter({ hasText: 'Não foi possível cancelar agora' })
    await expect(aviso).toBeVisible()
    await expect(aviso).toBeFocused()
    await expect(botao).toBeEnabled()
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Vaga confirmada',
    )
    await semViolacoes(page)
  })

  test('limite de consultas (429): mensagem e "Tentar de novo"; erro de servidor também', async ({
    page,
  }) => {
    await page.goto(cancelar('fixo-limite-de-consultas'))
    await expect(
      page.getByText(
        'Muitas consultas vieram deste endereço. Aguarde alguns minutos e tente de novo.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Tentar de novo' }),
    ).toBeVisible()
    await semViolacoes(page)
    await page.goto(cancelar('fixo-erro-de-servidor'))
    await expect(
      page.getByText('Não foi possível buscar a sua inscrição agora'),
    ).toBeVisible()
  })

  test('sem rede: mensagem, e o "Tentar de novo" recupera quando a API volta', async ({
    page,
  }) => {
    await page.route('**/api/publico/inscricoes/fixo-reservada', (rota) =>
      rota.abort(),
    )
    await page.goto(cancelar('fixo-reservada'))
    await expect(
      page.getByText('Não foi possível buscar a sua inscrição agora'),
    ).toBeVisible()
    await page.unroute('**/api/publico/inscricoes/fixo-reservada')
    await page.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(
      page.getByRole('button', { name: 'Cancelar a minha inscrição' }),
    ).toBeVisible()
  })
})

test.describe('/confirmar-inscricao/', () => {
  test('sem o código, com código que não existe e com lixo: mensagens claras; fora do Google', async ({
    page,
  }) => {
    await page.goto(confirmar())
    await expect(
      page.getByRole('heading', { name: 'Confirmar inscrição', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'Esta página precisa do link que foi enviado para o seu e-mail.',
      ),
    ).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    )
    await semViolacoesNosDois(page)
    await page.goto(confirmar('codigo-que-nao-existe-1234'))
    await expect(
      page.getByText(
        'Esse link não é válido: confira o endereço que veio no e-mail.',
      ),
    ).toBeVisible()
    await page.goto(confirmar('x'))
    await expect(page.getByText('Esse link não é válido')).toBeVisible()
  })

  test('quem foi chamado da lista de espera: vê o evento, o prazo e confirma; depois, "A sua vaga está confirmada" com o código', async ({
    page,
  }) => {
    await page.goto(confirmar('fixo-promovida'))
    await expect(linhaDoResumo(page, 'Evento')).toContainText(
      'Evento de teste — inscrição com perguntas',
    )
    await expect(linhaDoResumo(page, 'Sessão')).toContainText(
      'Oficina da manhã',
    )
    await expect(linhaDoResumo(page, 'Confirme até')).toContainText(
      /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(horário de Belém\)/,
    )
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Vaga reservada',
    )
    const cruzado = page.getByRole('link', {
      name: 'Não vou poder ir: cancelar a minha inscrição',
    })
    await expect(cruzado).toHaveAttribute(
      'href',
      '/cancelar-inscricao/?token=fixo-promovida',
    )
    await semViolacoesNosDois(page)
    await page.getByRole('button', { name: 'Confirmar a minha vaga' }).click()
    const sucesso = page
      .getByRole('status')
      .filter({ hasText: 'A sua vaga está confirmada.' })
    await expect(sucesso).toBeVisible()
    await expect(sucesso).toBeFocused()
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Vaga confirmada',
    )
    await expect(linhaDoResumo(page, 'Código de check-in')).toContainText(
      'B2C3D4E5',
    )
    await expect(linhaDoResumo(page, 'Confirme até')).toBeHidden()
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toHaveCount(0)
    await semViolacoesNosDois(page)
  })

  test('lista de espera: a frase da fila, sem botão de confirmar, e o caminho para cancelar', async ({
    page,
  }) => {
    await page.goto(confirmar('fixo-lista-de-espera'))
    await expect(
      page.getByText(
        'Você ainda está na lista de espera; avisamos por e-mail quando uma vaga abrir.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toHaveCount(0)
    await expect(linhaDoResumo(page, 'Código de check-in')).toBeHidden()
    await semViolacoesNosDois(page)
    await page.getByRole('link', { name: 'Cancelar a minha inscrição' }).click()
    await expect(page).toHaveURL(
      /\/cancelar-inscricao\/\?token=fixo-lista-de-espera$/,
    )
    await expect(
      page.getByRole('button', { name: 'Cancelar a minha inscrição' }),
    ).toBeVisible()
  })

  test('já confirmada, cancelada e evento que já aconteceu', async ({
    page,
  }) => {
    await page.goto(confirmar('fixo-confirmada'))
    await expect(page.getByText('A sua vaga está confirmada.')).toBeVisible()
    await expect(linhaDoResumo(page, 'Código de check-in')).toContainText(
      '0F1E2D3C',
    )
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toHaveCount(0)
    await page.goto(confirmar('fixo-cancelada'))
    await expect(
      page.getByText('Esta inscrição foi cancelada: não há o que confirmar.'),
    ).toBeVisible()
    await page.goto(confirmar('fixo-encerrada'))
    await expect(
      page.getByText(
        'Este evento já aconteceu: não é mais possível confirmar a vaga.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toHaveCount(0)
  })

  test('a API recusa (429 ao confirmar): a pessoa lê o motivo e o botão volta', async ({
    page,
  }) => {
    await page.goto(confirmar('fixo-falha-ao-confirmar'))
    await page.getByRole('button', { name: 'Confirmar a minha vaga' }).click()
    const aviso = page
      .getByRole('alert')
      .filter({ hasText: 'Muitas tentativas - aguarde 60 minutos' })
    await expect(aviso).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toBeEnabled()
    await semViolacoes(page)
  })
})

test.describe('do formulário aos links (a jornada de quem se inscreve)', () => {
  test('o link da tela de resultado abre a página de cancelar com a inscrição de quem acabou de se inscrever; cancelar e abrir de novo mostra "cancelada"', async ({
    page,
  }) => {
    const nome = nomeUnico('Joana Teste')
    await page.goto('/eventos/7/')
    await preencherEvento7(page, { nome })
    await aceitar(page)
    await enviar(page)
    const link = resultado(page).getByRole('link')
    const href = (await link.getAttribute('href'))!
    const codigo = await resultado(page).locator('[data-codigo]').textContent()
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[?]/g, '\\?')}$`))
    await expect(linhaDoResumo(page, 'Inscrição de')).toContainText('Joana')
    await expect(linhaDoResumo(page, 'Evento')).toContainText(
      'Evento de teste — inscrição com perguntas',
    )
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Vaga reservada',
    )
    await expect(linhaDoResumo(page, 'Código de check-in')).toContainText(
      codigo!,
    )
    await page
      .getByRole('button', { name: 'Cancelar a minha inscrição' })
      .click()
    await page
      .getByRole('button', { name: 'Sim, cancelar a minha inscrição' })
      .click()
    await expect(page.getByText('A sua inscrição foi cancelada.')).toBeVisible()
    await page.reload()
    await expect(
      page.getByText('Esta inscrição já foi cancelada.'),
    ).toBeVisible()
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Inscrição cancelada',
    )
  })

  test('quem entrou na lista de espera NÃO se confirma sozinho: a página da confirmação diz que ainda está na fila e a API recusa', async ({
    page,
  }) => {
    const nome = nomeUnico('Lia Teste')
    await page.goto('/eventos/8/')
    await preencherSimples(page, { nome })
    await aceitar(page)
    await enviar(page)
    const href = (await resultado(page).getByRole('link').getAttribute('href'))!
    const token = new URL(href, 'http://x').searchParams.get('token')!
    await page.goto(confirmar(token))
    await expect(
      page.getByText(
        'Você ainda está na lista de espera; avisamos por e-mail quando uma vaga abrir.',
      ),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toHaveCount(0)
    // forçando a chamada pela API (como faria quem não usa a página): recusada, com o motivo
    const r = await page.request.post(
      `${MOCK}/api/publico/inscricoes/${token}/confirmar`,
    )
    expect(r.status()).toBe(400)
    expect(((await r.json()) as { detail: string }).detail).toContain(
      'lista de espera',
    )
    await expect(linhaDoResumo(page, 'Situação')).toContainText(
      'Na lista de espera',
    )
  })
})
