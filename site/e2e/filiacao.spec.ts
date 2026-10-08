import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// v5.4h — o formulário público do pedido de filiação (`/seja-associado/`), no navegador de verdade, contra o build de teste e a API simulada
// (`scripts/mock-api.mjs`, que guarda o corpo recebido e responde como a API real: duplicado → 400 com o motivo; erro de servidor → 500).

const PORTA_DA_API = process.env.MOCK_API_PORT ?? '4322'
const CPF_QUE_JA_TEM_PEDIDO = '111.444.777-35' // o mock recusa como pedido duplicado
const CPF_QUE_DERRUBA_A_API = '529.982.247-25'
const CPF_NOVO = '390.533.447-05'

async function pedidosRecebidos(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  const r = await page.request.get(
    `http://127.0.0.1:${PORTA_DA_API}/__pedidos-de-filiacao`,
  )
  return (await r.json()) as Array<Record<string, unknown>>
}

async function preencher(
  page: Page,
  v: { cpf: string; nascimento?: string; email?: string; telefone?: string },
) {
  await page.getByLabel('Nome completo').fill('Maria de Teste Silva')
  await page.getByLabel('CPF').fill(v.cpf)
  await page.getByLabel('Data de nascimento').fill(v.nascimento ?? '1990-05-10')
  await page.getByLabel('E-mail').fill(v.email ?? 'maria@example.com')
  if (v.telefone) await page.getByLabel('Telefone ou WhatsApp').fill(v.telefone)
}

const aceitar = (page: Page) =>
  page.getByLabel(/Li o aviso de privacidade/).check()
const enviar = (page: Page) =>
  page.getByRole('button', { name: 'Enviar pedido de filiação' }).click()

test.describe('formulário de filiação', () => {
  // o mock guarda os pedidos numa lista só: em série, "o último pedido" é sempre o do teste que está rodando
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({ page }) => {
    await page.goto('/seja-associado/')
  })

  test('mostra o formulário com cada campo rotulado, o aviso de privacidade e a armadilha escondida', async ({
    page,
  }) => {
    await expect(
      page.getByRole('heading', { name: 'Faça o seu pedido de filiação' }),
    ).toBeVisible()
    for (const rotulo of [
      'Nome completo',
      'CPF',
      'Data de nascimento',
      'E-mail',
      'Telefone ou WhatsApp',
    ]) {
      await expect(page.getByLabel(rotulo)).toBeVisible()
    }
    await expect(page.locator('#aviso-de-privacidade')).toContainText(
      'Aviso de privacidade (versão 1)',
    )
    await expect(
      page.locator('#aviso-de-privacidade').getByRole('link', {
        name: 'Política de Privacidade',
      }),
    ).toHaveAttribute('href', '/privacidade/')
    // a armadilha de robô: fora da tela, escondida do leitor de tela e fora da ordem do Tab
    const armadilha = page.locator('input[name="pagina_web"]')
    await expect(armadilha).toHaveAttribute('tabindex', '-1')
    await expect(
      armadilha.locator('xpath=ancestor::div[@aria-hidden="true"]'),
    ).toHaveCount(1)
    expect(
      await armadilha.evaluate((el) => el.getBoundingClientRect().left),
    ).toBeLessThan(-1000)
    // a declaração dos pais só aparece quando a idade pede
    await expect(
      page.getByLabel(/autorização expressa e por escrito/),
    ).toBeHidden()
  })

  test('enviar em branco avisa o que falta, foca o primeiro campo e não chama a API', async ({
    page,
  }) => {
    const antes = (await pedidosRecebidos(page)).length
    await enviar(page)
    await expect(page.getByRole('alert').first()).toContainText(
      /Há \d+ campos para corrigir\./,
    )
    await expect(page.getByLabel('Nome completo')).toBeFocused()
    await expect(page.getByLabel('Nome completo')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(page.locator('#erro-cpf')).toContainText('Informe o seu CPF.')
    await expect(page.locator('#erro-contato')).toContainText(
      'e-mail ou um telefone',
    )
    await expect(page.locator('#erro-consentimento')).toContainText(
      'aviso de privacidade',
    )
    expect((await pedidosRecebidos(page)).length).toBe(antes)
    // o estado de erro também passa no axe
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze()
    expect(violations.map((v) => v.id)).toEqual([])
  })

  test('CPF que não confere é apontado antes de enviar', async ({ page }) => {
    await preencher(page, { cpf: '111.444.777-36' })
    await aceitar(page)
    await enviar(page)
    await expect(page.locator('#erro-cpf')).toContainText('não confere')
    await expect(page.getByLabel('CPF')).toBeFocused()
  })

  test('pedido certo: vai para a API com os dados limpos e a página confirma', async ({
    page,
  }) => {
    await preencher(page, {
      cpf: CPF_NOVO,
      email: 'maria.nova@example.com',
      telefone: '(91) 98888-7777',
    })
    await aceitar(page)
    await enviar(page)
    const confirmacao = page
      .getByRole('status')
      .filter({ hasText: 'Recebemos o seu pedido de filiação' })
    await expect(confirmacao).toBeVisible()
    await expect(confirmacao).toBeFocused()
    await expect(page.getByLabel('Nome completo')).toBeHidden()
    const corpo = (await pedidosRecebidos(page)).at(-1)
    expect(corpo).toMatchObject({
      nome_completo: 'Maria de Teste Silva',
      cpf: '39053344705',
      data_nascimento: '1990-05-10',
      email_contato: 'maria.nova@example.com',
      telefone_whatsapp: '91988887777',
      consentimento_lgpd: true,
      versao_texto_consentimento: '1',
      autorizacao_responsavel: false,
      pagina_web: '',
    })
  })

  test('quando a API diz que já existe pedido, a pessoa lê o motivo e não perde o que digitou', async ({
    page,
  }) => {
    await preencher(page, { cpf: CPF_QUE_JA_TEM_PEDIDO })
    await aceitar(page)
    await enviar(page)
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Já existe um pedido em andamento' }),
    ).toBeVisible()
    await expect(page.getByLabel('Nome completo')).toHaveValue(
      'Maria de Teste Silva',
    )
    await expect(
      page.getByRole('button', { name: 'Enviar pedido de filiação' }),
    ).toBeEnabled()
  })

  test('erro de servidor: orientação sem culpar a pessoa, e dá para tentar de novo', async ({
    page,
  }) => {
    await preencher(page, { cpf: CPF_QUE_DERRUBA_A_API })
    await aceitar(page)
    await enviar(page)
    const aviso = page
      .getByRole('alert')
      .filter({ hasText: 'Erro interno do servidor.' })
    await expect(aviso).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Enviar pedido de filiação' }),
    ).toBeEnabled()
  })

  test('de 16 a 17 anos aparece a declaração dos pais e ela é obrigatória; abaixo de 16 não se filia', async ({
    page,
  }) => {
    const hoje = new Date()
    const nasceu = (anos: number, dias = 0) => {
      const d = new Date(
        hoje.getFullYear() - anos,
        hoje.getMonth(),
        hoje.getDate() + dias,
      )
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    await preencher(page, { cpf: CPF_NOVO, nascimento: nasceu(17) })
    await aceitar(page)
    const declaracao = page.getByLabel(/autorização expressa e por escrito/)
    await expect(declaracao).toBeVisible()
    await enviar(page)
    await expect(page.locator('#erro-autorizacao')).toContainText(
      'pais ou responsáveis',
    )
    // com a declaração, passa o filtro da página e chega à API
    await declaracao.check()
    await enviar(page)
    await expect(
      page.getByRole('status').filter({ hasText: 'Recebemos o seu pedido' }),
    ).toBeVisible()
    expect((await pedidosRecebidos(page)).at(-1)).toMatchObject({
      autorizacao_responsavel: true,
    })
  })

  test('menor de 16 anos é barrado na página', async ({ page }) => {
    const d = new Date()
    const quinze = `${d.getFullYear() - 15}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await preencher(page, { cpf: CPF_NOVO, nascimento: quinze })
    await aceitar(page)
    const antes = (await pedidosRecebidos(page)).length
    await enviar(page)
    await expect(page.locator('#erro-nascimento')).toContainText(
      'a partir dos 16 anos',
    )
    expect((await pedidosRecebidos(page)).length).toBe(antes)
  })

  test('o estado com a declaração dos pais visível também passa no axe, no celular', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    const d = new Date()
    const dezessete = `${d.getFullYear() - 17}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await page.getByLabel('Data de nascimento').fill(dezessete)
    await expect(
      page.getByLabel(/autorização expressa e por escrito/),
    ).toBeVisible()
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze()
    expect(violations.map((v) => v.id)).toEqual([])
  })
})

test('sem JavaScript o formulário não aparece e a página manda falar com a secretaria', async ({
  browser,
}) => {
  const contexto = await browser.newContext({ javaScriptEnabled: false })
  const page = await contexto.newPage()
  await page.goto('/seja-associado/')
  await expect(page.locator('form[data-filiacao-form]')).toBeHidden()
  // (o Playwright não lê o texto de <noscript> pelo getByText; o parágrafo dentro dele é achado e medido pelo CSS)
  const aviso = page.locator('noscript p.font-medium')
  await expect(aviso).toBeVisible()
  expect(await aviso.evaluate((el) => el.textContent)).toContain(
    'é preciso ativar o JavaScript',
  )
  await expect(
    page.getByRole('heading', { name: 'Prefere falar com a secretaria?' }),
  ).toBeVisible()
  await contexto.close()
})
