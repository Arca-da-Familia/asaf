import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.5c - a inscrição em evento pelo SITE de teste (hml-site), de ponta a ponta, como um visitante: a página do evento tem o formulário (com as perguntas do evento e o texto de
// consentimento que vem do sistema); uma pessoa se inscreve e recebe código e link; duas se inscrevem juntas e a que não cabe cai na lista de espera; quem está na fila NÃO
// consegue se confirmar sozinha; quem cancela pelo link libera a vaga, a fila anda e quem foi promovido confirma pelo link; evento com valor não tem formulário; código inventado
// mostra mensagem clara; a Auditoria guarda cada passo. Roda DEPOIS do v5.5c-01 (que cria os eventos) e de a homologação ser publicada de novo com esta versão.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(420_000)

const SITE_HML = 'https://hml-site.asaf.org.br'
const S = String(RODADA)
const PREFIXO_GRATUITO = 'Oficina de Inscrição do Robô'
const PREFIXO_COM_VALOR = 'Jantar com Valor do Robô'
const base = (k: number) => 600000000 + ((RODADA + k * 7919) % 300000000)

const PESSOAS = {
  um: {
    nome: `Participante Um ${S} de Teste`,
    cpf: cpfValido(base(1)),
    email: `um.${S}@homologacao.example.com`,
    telefone: '(91) 98888-0001',
  },
  dois: {
    nome: `Participante Dois ${S} de Teste`,
    cpf: cpfValido(base(2)),
    email: `dois.${S}@homologacao.example.com`,
    telefone: '(91) 98888-0002',
  },
  tres: { nome: `Participante Tres ${S} de Teste`, cpf: cpfValido(base(3)) },
}

const ids: Record<string, number> = {}
const tokens: Record<string, string> = {}
const codigos: Record<string, string> = {}
const antes: Record<string, number> = {}

type EventoPublico = {
  id_evento: number
  titulo: string
  gratuito: boolean
  vagas: number | null
  vagas_livres: number | null
}

async function eventoMaisNovo(
  page: Page,
  prefixo: string,
): Promise<EventoPublico> {
  const r = await page.request.get(`${API_HML}/api/publico/eventos`)
  expect(r.status()).toBe(200)
  const lista = ((await r.json()) as EventoPublico[])
    .filter((e) => e.titulo.startsWith(prefixo))
    .sort((a, b) => b.id_evento - a.id_evento)
  expect(
    lista.length,
    `o roteiro v5.5c-01 criou o evento "${prefixo}"`,
  ).toBeGreaterThan(0)
  return lista[0]!
}

async function totalNaAuditoria(page: Page, tabela: string): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${tabela}`),
  )
  await campo(page, 'Tabela').fill(tabela)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

const pessoaDoFormulario = (page: Page, indice: number): Locator =>
  page.locator(`[data-participante][data-indice="${indice}"]`)

async function abrirOEvento(page: Page, id: number): Promise<void> {
  await page.goto(`${SITE_HML}/eventos/${id}/`, { waitUntil: 'networkidle' })
  await expect(
    page.getByRole('heading', { name: 'Inscreva-se neste evento' }),
  ).toBeVisible()
}

async function esperarOConsentimento(page: Page): Promise<string> {
  const texto = page.locator('[data-consentimento-texto]')
  await expect(texto).toBeVisible({ timeout: 60_000 })
  return (await texto.innerText()).trim()
}

async function preencherPrincipal(
  page: Page,
  p: { nome: string; cpf: string; email: string; telefone: string },
): Promise<void> {
  const principal = pessoaDoFormulario(page, 0)
  await principal.getByLabel('Nome completo').fill(p.nome)
  await principal.getByLabel('CPF').fill(p.cpf)
  await page.getByLabel('E-mail', { exact: true }).fill(p.email)
  await page.getByLabel('Telefone/WhatsApp').fill(p.telefone)
}

/** Responde a pergunta obrigatória (rádios) de quem está no bloco informado. */
async function responderComoSoube(
  bloco: Locator,
  opcao: string,
): Promise<void> {
  await bloco
    .getByRole('radiogroup', { name: /Como você soube da oficina/ })
    .getByLabel(opcao)
    .check()
}

async function lerResultado(page: Page, nome: string) {
  const resultado = page.locator('[data-resultado]')
  await expect(resultado).toBeVisible({ timeout: 60_000 })
  await expect(resultado).toContainText('Recebemos a sua inscrição.')
  const item = resultado.locator(`li[data-pessoa-inscrita="${nome}"]`)
  await expect(item).toBeVisible()
  const link = await item
    .locator('a[data-link-da-inscricao]')
    .getAttribute('href')
  expect(link, `o link de cancelar de ${nome}`).toMatch(
    /^\/cancelar-inscricao\/\?token=.+/,
  )
  return { item, token: new URL(link!, SITE_HML).searchParams.get('token')! }
}

test('o formulário aparece no evento gratuito, mostra as perguntas e o consentimento do sistema, e recusa o que falta; evento com valor não tem formulário', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  antes['inscricoes'] = await totalNaAuditoria(page, 'inscricoes')

  const gratuito = await eventoMaisNovo(page, PREFIXO_GRATUITO)
  const comValor = await eventoMaisNovo(page, PREFIXO_COM_VALOR)
  ids['gratuito'] = gratuito.id_evento
  ids['comValor'] = comValor.id_evento
  expect(gratuito.vagas_livres).toBe(2)

  await abrirOEvento(page, ids['gratuito']!)
  const consentimentoDoSite = await esperarOConsentimento(page)
  const consentimentoDaApi = (await (
    await page.request.get(`${API_HML}/api/publico/eventos/consentimento-lgpd`)
  ).json()) as { texto: string; versao: string }
  // v7.1a: o aviso vem em parágrafos, com os links desenhados; o texto lido é o mesmo, só a quebra entre parágrafos pode variar
  const semEspacos = (t: string) => t.replace(/\s+/g, ' ').trim()
  expect(semEspacos(consentimentoDoSite)).toBe(
    semEspacos(consentimentoDaApi.texto),
  )
  await expect(
    page
      .locator('[data-consentimento-texto]')
      .getByRole('link', { name: 'Política de Privacidade' }),
  ).toHaveAttribute('href', '/privacidade/')
  await expect(
    page.getByRole('radiogroup', { name: /Como você soube da oficina/ }),
  ).toBeVisible()
  await expect(
    page.getByText('Alguma restrição alimentar? (opcional)'),
  ).toBeVisible()
  await ver(page, info, 'evento-gratuito-com-o-formulario')

  // em branco: diz o que falta
  await page.getByRole('button', { name: 'Enviar inscrição' }).click()
  await expect(
    pessoaDoFormulario(page, 0).locator('[data-erro]:not([hidden])').first(),
  ).toBeVisible()
  await expect(page.locator('[data-resultado]')).toBeHidden()
  await ver(page, info, 'inscricao-em-branco-diz-o-que-falta')

  // CPF que não confere
  await preencherPrincipal(page, { ...PESSOAS.um, cpf: '111.111.111-11' })
  await responderComoSoube(page.locator('form[data-inscricao-form]'), 'Amigos')
  await page.getByLabel('Li o aviso de privacidade.').check()
  await page.getByRole('button', { name: 'Enviar inscrição' }).click()
  await expect(
    page.getByText('Esse CPF não confere', { exact: false }).first(),
  ).toBeVisible()
  await expect(page.locator('[data-resultado]')).toBeHidden()

  // evento com valor: sem formulário, com o caminho pela secretaria
  await page.goto(`${SITE_HML}/eventos/${ids['comValor']}/`, {
    waitUntil: 'networkidle',
  })
  await expect(
    page.getByRole('heading', { name: 'Inscreva-se neste evento' }),
  ).toHaveCount(0)
  await expect(page.getByText(/inscrição com valor/)).toBeVisible()
  await ver(page, info, 'evento-com-valor-sem-formulario')
  expect(vigia.problemas()).toEqual([])
})

test('uma pessoa se inscreve: vaga reservada, código de check-in e link de cancelar na própria tela', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await abrirOEvento(page, ids['gratuito']!)
  await esperarOConsentimento(page)
  await preencherPrincipal(page, PESSOAS.um)
  await responderComoSoube(page.locator('form[data-inscricao-form]'), 'Amigos')
  await page.getByLabel('Li o aviso de privacidade.').check()
  await page.getByRole('button', { name: 'Enviar inscrição' }).click()

  const { item, token } = await lerResultado(page, PESSOAS.um.nome)
  tokens['um'] = token
  await expect(item).toContainText('Vaga reservada')
  codigos['um'] = (await item.locator('[data-codigo]').innerText()).trim()
  expect(codigos['um']).toMatch(/^[0-9A-F]{8}$/)
  await expect(item).toContainText(
    'Apresente este código na entrada do evento.',
  )
  await expect(item).toContainText('Guarde este link')
  await ver(page, info, 'inscricao-recebida-com-codigo-e-link')
  expect(vigia.problemas()).toEqual([])
})

test('duas pessoas se inscrevem juntas: uma tem vaga e a outra cai na lista de espera; o evento passa a mostrar que as vagas acabaram', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await abrirOEvento(page, ids['gratuito']!)
  await esperarOConsentimento(page)
  await preencherPrincipal(page, PESSOAS.dois)
  await responderComoSoube(
    pessoaDoFormulario(page, 0).locator('xpath=ancestor::form'),
    'Redes sociais',
  )
  await page.getByRole('button', { name: 'Inscrever mais uma pessoa' }).click()
  const adicional = pessoaDoFormulario(page, 1)
  await expect(adicional).toBeVisible()
  await adicional.getByLabel('Nome completo').fill(PESSOAS.tres.nome)
  await adicional.getByLabel('CPF').fill(PESSOAS.tres.cpf)
  await responderComoSoube(adicional, 'Igreja')
  await page.getByLabel('Li o aviso de privacidade.').check()
  await ver(page, info, 'inscricao-em-grupo-preenchida')
  await page.getByRole('button', { name: 'Enviar inscrição' }).click()

  const dois = await lerResultado(page, PESSOAS.dois.nome)
  const tres = await lerResultado(page, PESSOAS.tres.nome)
  tokens['dois'] = dois.token
  tokens['tres'] = tres.token
  await expect(dois.item).toContainText('Vaga reservada')
  await expect(tres.item).toContainText('Lista de espera')
  await expect(tres.item).toContainText(
    'Se uma vaga abrir e chegar a sua vez, você recebe um e-mail e tem um prazo para confirmar; sem confirmar, a vaga passa ao próximo.',
  )
  // quem está na lista de espera não tem código de check-in
  await expect(tres.item.locator('[data-codigo]')).toHaveCount(0)
  await ver(page, info, 'grupo-uma-vaga-e-uma-lista-de-espera')

  // o evento agora está esgotado: a página avisa que dá para entrar na lista de espera
  await abrirOEvento(page, ids['gratuito']!)
  await expect(page.getByText(/As vagas acabaram/)).toBeVisible({
    timeout: 30_000,
  })
  expect(vigia.problemas()).toEqual([])
})

test('quem está na lista de espera não se confirma sozinha: a página diz que ainda está na fila e não oferece confirmar', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await page.goto(`${SITE_HML}/confirmar-inscricao/?token=${tokens['tres']}`, {
    waitUntil: 'networkidle',
  })
  await expect(page.locator('[data-situacao]')).toContainText(
    'Na lista de espera',
    {
      timeout: 30_000,
    },
  )
  await expect(page.getByText(/ainda está na lista de espera/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Confirmar a minha vaga' }),
  ).toBeHidden()
  await ver(page, info, 'lista-de-espera-nao-confirma-sozinha')

  // nem pela API, com o código dela: recusado e a vaga não é tomada
  const tentativa = await page.request.post(
    `${API_HML}/api/publico/inscricoes/${tokens['tres']}/confirmar`,
  )
  expect(tentativa.status()).toBe(400)
  expect(await tentativa.text()).toContain('lista de espera')
  expect(vigia.problemas()).toEqual([])
})

test('quem cancela pelo link libera a vaga: a fila anda, e quem foi promovida confirma pelo link e vê o código', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  // a primeira pessoa cancela, com a etapa de confirmação
  await page.goto(`${SITE_HML}/cancelar-inscricao/?token=${tokens['um']}`, {
    waitUntil: 'networkidle',
  })
  await expect(page.locator('[data-situacao]')).toContainText(
    'Vaga reservada',
    {
      timeout: 30_000,
    },
  )
  await expect(
    page.getByText(PREFIXO_GRATUITO, { exact: false }).first(),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar a minha inscrição' }).click()
  await ver(page, info, 'cancelar-pede-confirmacao')
  await page
    .getByRole('button', { name: 'Sim, cancelar a minha inscrição' })
    .click()
  await expect(page.getByText('A sua inscrição foi cancelada.')).toBeVisible({
    timeout: 30_000,
  })
  await ver(page, info, 'inscricao-cancelada')

  // reabrindo o mesmo link: já está cancelada
  await page.goto(`${SITE_HML}/cancelar-inscricao/?token=${tokens['um']}`, {
    waitUntil: 'networkidle',
  })
  await expect(page.getByText('Esta inscrição já foi cancelada.')).toBeVisible({
    timeout: 30_000,
  })

  // a terceira foi promovida: agora pode confirmar, com prazo
  await page.goto(`${SITE_HML}/confirmar-inscricao/?token=${tokens['tres']}`, {
    waitUntil: 'networkidle',
  })
  await expect(
    page.getByRole('button', { name: 'Confirmar a minha vaga' }),
  ).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Confirme até')).toBeVisible()
  await ver(page, info, 'promovida-pode-confirmar')
  await page.getByRole('button', { name: 'Confirmar a minha vaga' }).click()
  await expect(page.getByText('A sua vaga está confirmada.')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator('[data-codigo]')).toHaveText(/^[0-9A-F]{8}$/)
  await ver(page, info, 'vaga-confirmada-com-codigo')
  expect(vigia.problemas()).toEqual([])
})

test('link inventado mostra mensagem clara e as duas páginas ficam fora do Google', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  for (const pagina of ['cancelar-inscricao', 'confirmar-inscricao']) {
    await page.goto(`${SITE_HML}/${pagina}/?token=codigo-que-nao-existe`, {
      waitUntil: 'networkidle',
    })
    await expect(page.getByText(/Esse link não é válido/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    )
    await page.goto(`${SITE_HML}/${pagina}/`, { waitUntil: 'networkidle' })
    await expect(
      page.getByRole('link', { name: /eventos/i }).first(),
    ).toBeVisible()
  }
  await ver(page, info, 'link-invalido')
  const mapa = await (
    await page.request.get(`${SITE_HML}/sitemap-0.xml`)
  ).text()
  expect(mapa).not.toContain('cancelar-inscricao')
  expect(mapa).not.toContain('confirmar-inscricao')
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guardou cada passo: 3 inscrições, 1 cancelamento e 1 confirmação pelo link', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const total = await totalNaAuditoria(page, 'inscricoes')
  expect(
    total - antes['inscricoes']!,
    'ações do roteiro na Auditoria de inscrições',
  ).toBe(5)
  for (const acao of [
    'INSCRICAO_PUBLICA',
    'CANCELAMENTO_PUBLICO',
    'CONFIRMACAO_PUBLICA',
  ]) {
    await expect(
      page
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: acao, exact: true }) })
        .first(),
    ).toBeVisible()
  }
  await ver(page, info, 'auditoria-das-inscricoes')
  expect(vigia.problemas()).toEqual([])
})
