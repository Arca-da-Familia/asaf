import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  cpfValido,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.5b - o voluntário é uma PESSOA: quem se oferece pelo site não precisa ser associado. De ponta a ponta, como na vida: o visitante preenche o formulário do site de teste
// (hml-site, página "Seja voluntário") e recebe protocolo e prazo; o Presidente abre o pedido na fila, vê a idade (e o aviso de quem é menor de 18 anos), cadastra a pessoa como
// voluntária, registra o termo de adesão (o de menor exige a autorização do responsável) e a escala no projeto, onde ela aparece com o nome e a marca de não associada. A
// Auditoria guarda cada passo. O formulário recusa data de nascimento que falta ou no futuro.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(420_000)

const SITE_HML = 'https://hml-site.asaf.org.br'
const S = String(RODADA)
const NOME_ADULTA = `Voluntária do Site ${S} de Teste`
const NOME_MENOR = `Voluntário Menor ${S} de Teste`
const NOME_DO_PROJETO = `Projeto dos Voluntários ${S}`
const CPF_ADULTA = cpfValido(400000000 + (RODADA % 250000000))
const FUNCAO = `Apoio na recepção ${S.slice(-4)}`

const protocolos: Record<string, string> = {}
const ids: Record<string, number> = {}

const hoje = new Date()
const dataDeAnosAtras = (anos: number, dias = 0): string => {
  const d = new Date(
    Date.UTC(
      hoje.getUTCFullYear() - anos,
      hoje.getUTCMonth(),
      hoje.getUTCDate() - dias,
    ),
  )
  return d.toISOString().slice(0, 10)
}
const daquiADias = (dias: number): string =>
  new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10)

const cartao = (page: Page, protocolo: string): Locator =>
  page.getByRole('listitem', { name: `Atendimento ${protocolo}` })

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

async function abrirOPedido(page: Page, protocolo: string): Promise<Locator> {
  await page
    .getByRole('link', { name: /^Atendimento/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Atendimento', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Buscar atendimento').fill(protocolo)
  const c = cartao(page, protocolo)
  await expect(c).toBeVisible()
  await c.getByRole('button', { name: 'Abrir' }).click()
  return c
}

const antes: Record<string, number> = {}

test('o visitante se oferece pelo site: a página não diz mais que precisa ser associado, recusa a data que falta ou no futuro e dá protocolo e prazo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  antes['atendimentos'] = await totalNaAuditoria(page, 'atendimentos')
  antes['termos_adesao_voluntario'] = await totalNaAuditoria(
    page,
    'termos_adesao_voluntario',
  )
  antes['alocacoes_voluntarios'] = await totalNaAuditoria(
    page,
    'alocacoes_voluntarios',
  )

  await page.goto(`${SITE_HML}/seja-voluntario/`)
  await expect(
    page.getByRole('heading', { name: 'Seja voluntário', level: 1 }),
  ).toBeVisible()
  // o texto antigo (a escala usa o cadastro de associados) deixou de ser verdade
  await expect(page.getByText(/usa o cadastro de associados/)).toHaveCount(0)
  await expect(page.getByText(/não é preciso ser associado/)).toBeVisible()

  await page.getByLabel('Nome completo').fill(NOME_ADULTA)
  await page.getByLabel('Telefone/WhatsApp').fill('(91) 98888-7777')
  await page.getByLabel(/^CPF/).fill(CPF_ADULTA)
  await page
    .getByLabel(/Como você gostaria de ajudar/)
    .fill(
      `Posso ajudar aos sábados de manhã, em atividades com as crianças. Rodada ${S}.`,
    )
  await page.getByLabel('Li e aceito o aviso de privacidade.').check()
  // sem a data de nascimento
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(
    page.getByText('Informe a sua data de nascimento.').first(),
  ).toBeVisible()
  await ver(page, info, 'voluntariado-sem-data-de-nascimento')
  // data no futuro
  await page.getByLabel(/^Data de nascimento/).fill(daquiADias(30))
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(page.getByText(/no futuro/).first()).toBeVisible()

  await page.getByLabel(/^Data de nascimento/).fill('1990-05-10')
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  const confirmacao = page.locator('div[data-confirmacao]')
  await expect(confirmacao).toBeVisible({ timeout: 60_000 })
  protocolos['adulta'] = (
    await confirmacao.locator('[data-protocolo]').innerText()
  ).trim()
  expect(protocolos['adulta']).toMatch(/^ASAF-\d{4}-\d{5}$/)
  await expect(page.locator('[data-prazo-da-resposta]')).toContainText(
    /Respondemos em até 10 dias/,
  )
  await ver(page, info, 'voluntariado-recebido')

  // a pessoa menor de idade se oferece pela mesma rota pública (o formulário é o mesmo)
  const r = await page.request.post(`${API_HML}/api/publico/atendimentos`, {
    data: {
      tipo: 'VOLUNTARIO',
      nome_completo: NOME_MENOR,
      telefone_whatsapp: '(91) 98888-8888',
      data_nascimento: dataDeAnosAtras(16, 40),
      mensagem: `Quero ajudar nas oficinas depois da escola. Rodada ${S}.`,
      consentimento_lgpd: true,
      versao_texto_consentimento: '1',
    },
  })
  expect(r.status(), await r.text()).toBe(200)
  protocolos['menor'] = ((await r.json()) as { protocolo: string }).protocolo
  expect(vigia.problemas()).toEqual([])
})

test('o Presidente cadastra a voluntária que não é associada e registra o termo de adesão; o pedido do menor avisa e exige a autorização do responsável', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')

  // a adulta
  let c = await abrirOPedido(page, protocolos['adulta']!)
  await expect(c).toContainText('Voluntariado')
  const secao = (): Locator => c.getByRole('region', { name: 'Voluntário' })
  await expect(secao()).toContainText('10/05/1990')
  await expect(secao()).not.toContainText('Menor de 18 anos')
  await ver(page, info, 'pedido-de-voluntariado-aberto')
  await secao()
    .getByRole('button', { name: 'Cadastrar como voluntário' })
    .click()
  // cadastrada: aparece o formulário do termo
  const termo = c.getByRole('form', { name: 'Termo de adesão' })
  await expect(termo).toBeVisible()
  await termo.getByLabel('Atividade').fill(`Apoio com as crianças (robô ${S})`)
  await termo.getByLabel('Carga horária semanal (horas)').fill('4')
  await termo.getByLabel('Início da vigência').fill(daquiADias(0))
  await termo.getByLabel('Fim da vigência').fill(daquiADias(180))
  await termo.getByRole('button', { name: 'Registrar termo de adesão' }).click()
  await expect(secao()).toContainText('Termo de adesão vigente até')
  await expect(
    secao().getByRole('link', { name: 'Escalar em um projeto' }),
  ).toBeVisible()
  await ver(page, info, 'voluntaria-com-termo')

  // o menor de idade
  c = await abrirOPedido(page, protocolos['menor']!)
  await expect(secao()).toContainText('Menor de 18 anos')
  await secao()
    .getByRole('button', { name: 'Cadastrar como voluntário' })
    .click()
  const termoMenor = c.getByRole('form', { name: 'Termo de adesão' })
  await expect(termoMenor).toBeVisible()
  await termoMenor.getByLabel('Atividade').fill(`Oficinas (robô ${S})`)
  await termoMenor.getByLabel('Carga horária semanal (horas)').fill('2')
  await termoMenor.getByLabel('Início da vigência').fill(daquiADias(0))
  await termoMenor.getByLabel('Fim da vigência').fill(daquiADias(90))
  // sem a autorização do responsável: não registra
  await termoMenor
    .getByRole('button', { name: 'Registrar termo de adesão' })
    .click()
  await expect(secao()).not.toContainText('Termo de adesão vigente até')
  await expect(termoMenor).toBeVisible()
  await ver(page, info, 'menor-sem-autorizacao-do-responsavel')
  await termoMenor
    .getByLabel('Autorização do responsável (referência)')
    .fill(`Autorização assinada pela mãe, pasta ${S.slice(-4)}`)
  await termoMenor
    .getByRole('button', { name: 'Registrar termo de adesão' })
    .click()
  await expect(secao()).toContainText('Termo de adesão vigente até')
  await ver(page, info, 'menor-com-termo')
  expect(vigia.problemas()).toEqual([])
})

test('a voluntária que não é associada é escalada no projeto: aparece na lista de voluntários e na escala com a marca de não associada', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token: { valor: string } = { valor: '' }
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token.valor = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => token.valor, { timeout: 15_000 }).not.toBe('')
  const criado = await page.request.fetch(`${API_HML}/projetos/`, {
    method: 'POST',
    headers: { Authorization: token.valor, 'Content-Type': 'application/json' },
    data: JSON.stringify({
      nome_projeto: NOME_DO_PROJETO,
      tipo_foco: 'Social',
      necessita_alvara_bombeiros: false,
      data_inicio: new Date(Date.now() + 86_400_000).toISOString(),
      data_fim_prevista: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    }),
  })
  expect(criado.status(), 'criar o projeto de teste').toBe(200)
  ids['projeto'] = ((await criado.json()) as { id_projeto: number }).id_projeto

  await page.goto('/projetos')
  await expect(
    page.getByRole('heading', { name: 'Projetos', level: 1 }),
  ).toBeVisible()
  await page
    .locator('div[role="button"][aria-pressed]')
    .filter({ hasText: new RegExp(NOME_DO_PROJETO) })
    .click()
  const detalhe = page
    .getByRole('heading', { name: NOME_DO_PROJETO, level: 2, exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  const bloco = detalhe.locator(
    'xpath=.//p[starts-with(normalize-space(.), "Alocar voluntário direto num turno")]/..',
  )
  await expect(bloco).toBeVisible()
  await expect(bloco.getByText(/^Carregando/)).toHaveCount(0)

  const seletor = bloco.getByLabel('Voluntário', { exact: true })
  await expect(
    seletor.locator('option', { hasText: NOME_ADULTA }).first(),
  ).toBeAttached()
  // a opção diz que não é associada e que tem termo vigente (não diz "sem termo")
  const textoDaOpcao = await seletor
    .locator('option', { hasText: NOME_ADULTA })
    .first()
    .innerText()
  expect(textoDaOpcao).toContain('(não associado)')
  expect(textoDaOpcao).not.toContain('sem termo vigente')
  await escolherPorTexto(seletor, NOME_ADULTA)
  await bloco.getByLabel('Função do voluntário').fill(FUNCAO)
  await bloco
    .getByLabel('Início do turno do voluntário')
    .fill('2088-03-02T08:00')
  await bloco.getByLabel('Fim do turno do voluntário').fill('2088-03-02T12:00')
  await bloco.getByLabel('Horas previstas do voluntário').fill('4')
  await bloco.getByRole('button', { name: 'Alocar agora' }).click()

  const linha = bloco
    .locator('div.rounded-md.border')
    .filter({ hasText: new RegExp(`${NOME_ADULTA}.* — ${FUNCAO}`) })
  await expect(linha).toHaveCount(1)
  await expect(linha).toContainText('(não associado)')
  await expect(linha).toContainText('4 h previstas · CONFIRMADA')
  await ver(page, info, 'voluntaria-na-escala')

  // por um endereço novo: veio do servidor
  await page.reload()
  await page
    .locator('div[role="button"][aria-pressed]')
    .filter({ hasText: new RegExp(NOME_DO_PROJETO) })
    .click()
  await expect(
    page.getByText(new RegExp(`${NOME_ADULTA}.* — ${FUNCAO}`)),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guardou cada passo: os dois envios do site, os dois cadastros de voluntário, os dois termos e a alocação', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  expect(
    (await totalNaAuditoria(page, 'atendimentos')) - antes['atendimentos']!,
    'atendimentos: 2 envios do site + 2 cadastros de voluntário',
  ).toBe(4)
  expect(
    (await totalNaAuditoria(page, 'termos_adesao_voluntario')) -
      antes['termos_adesao_voluntario']!,
    'termos de adesão registrados',
  ).toBe(2)
  expect(
    (await totalNaAuditoria(page, 'alocacoes_voluntarios')) -
      antes['alocacoes_voluntarios']!,
    'alocações na escala',
  ).toBe(1)
  await ver(page, info, 'auditoria-do-voluntariado')
  expect(vigia.problemas()).toEqual([])
})
