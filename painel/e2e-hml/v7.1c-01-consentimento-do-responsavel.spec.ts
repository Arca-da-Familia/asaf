import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  entrar,
  exigirHomologacao,
  preencherOTermoDeImagem,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v7.1c - O CONSENTIMENTO DO ATENDIMENTO SOCIAL (e o do responsável pela criança). Pelas telas:
//  1. o PRESIDENTE monta, pela API, um projeto com uma CRIANÇA atendida (10 anos) e ele na equipe; na tela Beneficiários o bloco "Consentimento" diz que
//     sem o termo o prontuário não grava; a própria criança não pode consentir; sem o nome e sem o vínculo do responsável é recusado; com a mãe, entra:
//     "dado por ... (Mãe)", termo versão N; o prontuário abre o formulário;
//  2. Privacidade > Consentimentos mostra o consentimento com quem consentiu pela criança; "Ler o aviso desta versão" abre o termo assinado;
//  3. a mãe retira o consentimento: revogar pede confirmação; o prontuário avisa e a rota recusa (409) o atendimento novo; o que já existe continua;
//  4. a Auditoria guarda o registro e a revogação, com quem fez.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const PROJETO = `Projeto do termo do responsavel ${RODADA}`
const CRIANCA = `Crianca do Robo ${RODADA} de Teste`
const MAE = `Mae do Robo ${RODADA}`
const MOTIVO = `A mae pediu para parar (robo v7.1c ${RODADA}).`
const RELATO = `Atendimento de teste ${RODADA}: orientacao inventada.`
const desta = { idBeneficiario: 0, idVinculo: 0 }

async function entrarComToken(page: Page): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

async function abrirBloco(page: Page): Promise<Locator> {
  await page.goto('/beneficiarios')
  // espera a busca responder (a lista muda depois da digitação) antes de abrir o bloco
  const respondeu = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/beneficiarios/' &&
      new URL(r.url()).searchParams.get('busca') === CRIANCA,
  )
  await campo(page, 'Buscar por nome').fill(CRIANCA)
  await respondeu
  await page
    .getByRole('row')
    .filter({ hasText: CRIANCA })
    .first()
    .getByRole('button', { name: `Consentimento de ${CRIANCA}` })
    .click()
  const bloco = page.getByRole('region', {
    name: `Consentimento do atendimento social de ${CRIANCA}`,
  })
  await expect(bloco).toBeVisible()
  return bloco
}

/** O quadro do prontuário da criança no detalhe do projeto (o mesmo caminho do robô v7.0d-01). */
async function abrirProntuario(page: Page): Promise<Locator> {
  await page.goto('/projetos')
  await page
    .locator('div[role="button"][aria-pressed]')
    .filter({ hasText: new RegExp(`^\\s*${PROJETO}\\s+nº\\s+\\d+`) })
    .click()
  const detalhe = page
    .getByRole('heading', { name: PROJETO, level: 2, exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  const cartao = detalhe
    .locator(
      'xpath=.//h3[starts-with(normalize-space(.), "Beneficiários")]/../..',
    )
    .locator('div.rounded-md.border')
    .first()
  await cartao.getByRole('button', { name: 'Prontuário', exact: true }).click()
  return cartao.locator(
    'xpath=.//p[starts-with(normalize-space(.), "Prontuário de atendimento")]/..',
  )
}

test('o Presidente registra o termo assinado pela mãe da criança: a própria criança não consente, o responsável precisa de nome e vínculo', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await entrarComToken(page)
  const cab = { Authorization: token }
  const json = async (r: Awaited<ReturnType<Page['request']['post']>>) => {
    expect(r.status(), `${r.url()}: ${await r.text()}`).toBe(200)
    return (await r.json()) as Record<string, unknown>
  }
  const iso = (d: Date) => d.toISOString().slice(0, 19)
  const agora = new Date()
  const projeto = await json(
    await page.request.post(`${API_HML}/projetos/`, {
      headers: cab,
      data: {
        nome_projeto: PROJETO,
        tipo_foco: 'Assistencial',
        necessita_alvara_bombeiros: false,
        data_inicio: iso(agora),
        data_fim_prevista: iso(new Date(agora.getTime() + 90 * 86_400_000)),
      },
    }),
  )
  const nascimento = new Date(agora.getTime() - 10 * 365 * 86_400_000)
  const beneficiario = await json(
    await page.request.post(`${API_HML}/api/beneficiarios/`, {
      headers: cab,
      data: {
        nome_completo: CRIANCA,
        data_nascimento: `${nascimento.toISOString().slice(0, 10)}T00:00:00`,
      },
    }),
  )
  desta.idBeneficiario = Number(beneficiario.id_beneficiario)
  const vinculo = await json(
    await page.request.post(`${API_HML}/api/beneficiarios-projeto/`, {
      headers: cab,
      data: {
        id_beneficiario: desta.idBeneficiario,
        id_projeto: projeto.id_projeto,
        papel: 'ATENDIDO',
        atendimento_por_familia: false,
      },
    }),
  )
  desta.idVinculo = Number(vinculo.id_vinculo)
  const eu = await json(
    await page.request.get(`${API_HML}/auth/me`, { headers: cab }),
  )
  await json(
    await page.request.post(
      `${API_HML}/api/projetos/${String(projeto.id_projeto)}/equipe`,
      {
        headers: cab,
        data: { id_associado: eu.id_associado, papel: 'COORDENADOR' },
      },
    ),
  )

  // sem o termo: o prontuário avisa e não abre o formulário
  let prontuario = await abrirProntuario(page)
  await expect(
    prontuario.getByTestId('prontuario-sem-consentimento'),
  ).toBeVisible()
  await expect(
    prontuario.getByPlaceholder('Relato do atendimento'),
  ).toHaveCount(0)
  await ver(page, info, 'prontuario-sem-consentimento')

  // o bloco do consentimento na tela Beneficiários
  const bloco = await abrirBloco(page)
  await expect(bloco.locator('[data-sem-consentimento]')).toBeVisible()
  await expect(bloco).toContainText(
    'Tinha menos de 18 anos na data da assinatura',
  )
  await bloco
    .getByRole('button', { name: 'Registrar o termo assinado' })
    .click()
  await expect(
    bloco.getByRole('radio', { name: 'A própria pessoa atendida' }),
  ).toBeDisabled()
  await bloco
    .getByRole('radio', { name: 'Um dos pais ou o responsável legal' })
    .check()
  const termo = bloco.locator('[data-termo="ATENDIMENTO_SOCIAL"]')
  await expect(termo).toBeVisible({ timeout: 30_000 })
  await termo.getByText('Ler o termo').click()
  await expect(termo).toContainText('CRIANÇA OU ADOLESCENTE')
  const registrar = bloco.getByRole('button', {
    name: 'Registrar o consentimento',
  })
  await registrar.click()
  await expect(bloco.getByRole('alert').last()).toContainText(
    'Informe o nome de quem consentiu',
  )
  await bloco.getByLabel('Nome de quem consentiu').fill(MAE)
  await registrar.click()
  await expect(bloco.getByRole('alert').last()).toContainText(
    'Informe o vínculo',
  )
  await bloco.getByLabel('Vínculo com a pessoa atendida').selectOption('mae')
  await preencherOTermoDeImagem(bloco)
  await ver(page, info, 'termo-do-responsavel-preenchido')
  const [registrou] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname ===
          `/api/beneficiarios/${desta.idBeneficiario}/consentimento`,
    ),
    registrar.click(),
  ])
  expect(registrou.status(), await registrou.text()).toBe(200)
  const vigente = bloco.locator('[data-consentimento-vigente]')
  await expect(vigente).toContainText(`dado por ${MAE} (Mãe)`)
  await expect(vigente).toContainText(/termo versão \d+/)
  await ver(page, info, 'consentimento-da-mae-registrado')

  // a rota também recusa a própria criança (a tela já não deixa)
  const termoDaTela = await json(
    await page.request.get(
      `${API_HML}/api/consentimentos/termo-da-tela/beneficiario`,
      { headers: cab },
    ),
  )
  const propria = await page.request.post(
    `${API_HML}/api/beneficiarios/${desta.idBeneficiario}/consentimento`,
    {
      headers: cab,
      data: {
        dado_por: 'titular',
        nome_responsavel: null,
        vinculo: null,
        meio: 'termo_em_papel',
        id_documento: null,
        assinado_em: new Date(Date.now() - 86_400_000)
          .toISOString()
          .slice(0, 10),
        versao_do_termo: termoDaTela.versao,
      },
    },
  )
  expect(propria.status()).toBe(400)
  const pdf = await page.request.get(
    `${API_HML}/api/consentimentos/termos/ATENDIMENTO_SOCIAL/pdf`,
    { headers: cab },
  )
  expect(pdf.status()).toBe(200)
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // com o termo, o prontuário grava
  prontuario = await abrirProntuario(page)
  await expect(
    prontuario.getByTestId('prontuario-sem-consentimento'),
  ).toHaveCount(0)
  await prontuario.getByPlaceholder('Relato do atendimento').fill(RELATO)
  await prontuario.getByRole('button', { name: 'Registrar' }).click()
  await expect(prontuario).toContainText(RELATO)
  await ver(page, info, 'prontuario-grava-com-o-termo')
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('Privacidade > Consentimentos mostra quem consentiu pela criança; a mãe revoga e o prontuário deixa de gravar (o que já existe fica)', async ({
  page,
}, info) => {
  expect(desta.idBeneficiario, 'a 1ª parte rodou').toBeGreaterThan(0)
  const vigia = vigiar(page)
  const token = await entrarComToken(page)
  const cab = { Authorization: token }

  await page.goto('/privacidade/consentimentos')
  await page.getByLabel('O que ele cobre').selectOption('beneficiario')
  const linha = page.locator('li').filter({ hasText: CRIANCA }).first()
  await expect(linha).toContainText(`consentido por ${MAE} (Mãe)`)
  await expect(linha).toContainText('Vigente')
  await linha.getByRole('button', { name: 'Ler o aviso desta versão' }).click()
  await expect(linha.getByTestId('aviso-da-versao')).toContainText(
    'CRIANÇA OU ADOLESCENTE',
  )
  await ver(page, info, 'consentimento-na-lista-com-o-responsavel')

  const bloco = await abrirBloco(page)
  await bloco.getByRole('button', { name: 'Revogar o consentimento' }).click()
  await bloco.getByLabel('Motivo da revogação (opcional)').fill(MOTIVO)
  await ver(page, info, 'revogar-pede-confirmacao')
  await bloco.getByRole('button', { name: 'Confirmar a revogação' }).click()
  await expect(bloco.getByRole('status')).toContainText(
    'Consentimento revogado',
  )
  await expect(bloco.locator('[data-sem-consentimento]')).toBeVisible()

  const prontuario = await abrirProntuario(page)
  await expect(
    prontuario.getByTestId('prontuario-sem-consentimento'),
  ).toBeVisible()
  await expect(prontuario).toContainText(RELATO)
  await ver(
    page,
    info,
    'revogado-o-prontuario-nao-grava-mas-mostra-o-que-existe',
  )
  const recusa = await page.request.post(
    `${API_HML}/api/beneficiarios-projeto/${desta.idVinculo}/atendimentos`,
    { headers: cab, data: { relato: 'Tentativa depois da revogação.' } },
  )
  expect(recusa.status()).toBe(409)
  expect(((await recusa.json()) as { detail: string }).detail).toContain(
    'consentimento',
  )

  await page.goto('/privacidade/consentimentos')
  await page.getByLabel('Situação').selectOption('encerrados')
  await page.getByLabel('O que ele cobre').selectOption('beneficiario')
  const encerrado = page.locator('li').filter({ hasText: CRIANCA }).first()
  await expect(encerrado).toContainText(MOTIVO)
  await ver(page, info, 'consentimento-revogado-como-prova')
  expect(vigia.problemas().filter((p) => !/^4\d\d /.test(p))).toEqual([])
})

test('a Auditoria guarda o registro e a revogação do consentimento, com quem fez', async ({
  page,
}) => {
  expect(desta.idBeneficiario, 'a 1ª parte rodou').toBeGreaterThan(0)
  const token = await entrarComToken(page)
  const r = await page.request.get(
    `${API_HML}/api/privacidade/consentimentos?situacao=encerrados&origem=beneficiario`,
    { headers: { Authorization: token } },
  )
  expect(r.status()).toBe(200)
  const { consentimentos } = (await r.json()) as {
    consentimentos: {
      id_consentimento: number
      id_origem: number
      encerramento: string
      vinculo_responsavel: string
    }[]
  }
  const meu = consentimentos.find((c) => c.id_origem === desta.idBeneficiario)
  expect(meu?.encerramento).toBe('revogado')
  expect(meu?.vinculo_responsavel).toBe('mae')

  await page.goto('/auditoria')
  await campo(page, 'Tabela').fill('consentimentos')
  for (const acao of ['CONSENTIMENTO_REGISTRADO', 'CONSENTIMENTO_REVOGADO']) {
    await expect(
      page
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: acao, exact: true }) })
        .filter({
          has: page.getByRole('cell', {
            name: String(meu!.id_consentimento),
            exact: true,
          }),
        }),
      acao,
    ).toHaveCount(1)
  }
})
