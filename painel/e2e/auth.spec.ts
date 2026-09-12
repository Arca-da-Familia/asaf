import { expect, test, type Page } from '@playwright/test'

// v0.2.8 — fluxos de autenticação que não podem quebrar. A API é mockada via page.route: estes
// testes validam o comportamento do PAINEL diante de cada resposta possível da API (sucesso,
// MFA pendente, refresh expirado, permissão faltando), não o backend em si.

const CPF_TESTE = '529.982.247-25'
const SENHA_TESTE = 'senha-super-secreta'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

const ME_PADRAO = {
  id_usuario: 1,
  id_associado: 1,
  nome_completo: 'Maria de Teste',
  email: 'maria@example.org',
  nivel: 'Associado',
  mfa_ativado: true,
  mfa_obrigatorio: false,
  mfa_pendente: false,
  permissoes: ['associados'],
}

async function mockRefreshSemSessao(page: Page) {
  // Bootstrap inicial (AuthProvider): sem cookie válido, não autenticado.
  await page.route('**/auth/refresh', (route) => route.fulfill(json({}, 401)))
}

async function mockMe(page: Page, overrides: Partial<typeof ME_PADRAO> = {}) {
  await page.route('**/auth/me', (route) =>
    route.fulfill(json({ ...ME_PADRAO, ...overrides })),
  )
}

test.describe('Login', () => {
  test('login sem MFA leva direto para o início', async ({ page }) => {
    await mockRefreshSemSessao(page)
    await mockMe(page)
    await page.route('**/auth/login', (route) =>
      route.fulfill(
        json({
          access_token: 'token-de-teste',
          token_type: 'bearer',
          expires_in_minutos: 45,
          requer_mfa: false,
        }),
      ),
    )

    await page.goto('/login')
    await page.getByLabel('CPF').fill(CPF_TESTE)
    await page.getByLabel('Senha').fill(SENHA_TESTE)
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
    await expect(
      page.getByText('Maria de Teste', { exact: false }).first(),
    ).toBeVisible()
  })

  test('login com MFA pede o segundo fator antes de liberar o painel', async ({
    page,
  }) => {
    await mockRefreshSemSessao(page)
    await mockMe(page)
    await page.route('**/auth/login', (route) =>
      route.fulfill(
        json({
          access_token: '',
          token_type: 'bearer',
          expires_in_minutos: 45,
          requer_mfa: true,
          login_temp_token: 'temp-token-123',
        }),
      ),
    )
    await page.route('**/auth/login/mfa', (route) =>
      route.fulfill(
        json({
          access_token: 'token-de-teste',
          token_type: 'bearer',
          expires_in_minutos: 45,
          requer_mfa: false,
        }),
      ),
    )

    await page.goto('/login')
    await page.getByLabel('CPF').fill(CPF_TESTE)
    await page.getByLabel('Senha').fill(SENHA_TESTE)
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(
      page.getByText('Informe o código do seu autenticador.'),
    ).toBeVisible()
    await page.getByLabel('Código TOTP').fill('123456')
    await page.getByRole('button', { name: 'Verificar' }).click()

    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
  })

  test('CPF inválido é bloqueado no cliente, sem chamar a API', async ({
    page,
  }) => {
    await mockRefreshSemSessao(page)
    let chamouLogin = false
    await page.route('**/auth/login', (route) => {
      chamouLogin = true
      return route.fulfill(json({}, 200))
    })

    await page.goto('/login')
    await page.getByLabel('CPF').fill('111.111.111-11')
    await page.getByLabel('Senha').fill(SENHA_TESTE)
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.getByRole('alert')).toHaveText(/CPF inválido/)
    expect(chamouLogin).toBe(false)
  })
})

test.describe('Sessão expirada', () => {
  test('refresh que falha depois de logado derruba a sessão e volta pro login', async ({
    page,
  }) => {
    await mockRefreshSemSessao(page)
    await mockMe(page)
    await page.route('**/auth/login', (route) =>
      route.fulfill(
        json({
          access_token: 'token-de-teste',
          token_type: 'bearer',
          expires_in_minutos: 45,
          requer_mfa: false,
        }),
      ),
    )

    await page.goto('/login')
    await page.getByLabel('CPF').fill(CPF_TESTE)
    await page.getByLabel('Senha').fill(SENHA_TESTE)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()

    // A partir de agora, toda rota autenticada devolve 401 (token expirou de verdade no
    // servidor) e o refresh também falha (cookie/refresh token já revogado) — o cenário que
    // este teste existe para cobrir.
    await page.route('**/auth/perfil', (route) => route.fulfill(json({}, 401)))
    await page.route('**/auth/refresh', (route) => route.fulfill(json({}, 401)))

    await page.getByRole('link', { name: 'Meu perfil' }).click()

    await expect(
      page.getByRole('heading', { name: 'ASAF · Painel' }),
    ).toBeVisible()
    await expect(page.getByLabel('CPF')).toBeVisible()
  })
})

test.describe('Permissão', () => {
  test('acesso a módulo sem permissão mostra 403, não o conteúdo', async ({
    page,
  }) => {
    await mockRefreshSemSessao(page)
    // Nível só com a permissão "associados" — sem "financeiro".
    await mockMe(page, { permissoes: ['associados'] })
    await page.route('**/auth/login', (route) =>
      route.fulfill(
        json({
          access_token: 'token-de-teste',
          token_type: 'bearer',
          expires_in_minutos: 45,
          requer_mfa: false,
        }),
      ),
    )

    await page.goto('/login')
    await page.getByLabel('CPF').fill(CPF_TESTE)
    await page.getByLabel('Senha').fill(SENHA_TESTE)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()

    // /financeiro exige um reload de página completo (não há link visível no menu, já que o
    // próprio menu é filtrado por permissão) — simula o cookie de refresh ainda válido nesse
    // reload, como aconteceria numa sessão real ainda não expirada.
    await page.route('**/auth/refresh', (route) =>
      route.fulfill(json({ access_token: 'token-de-teste' })),
    )
    await page.goto('/financeiro')

    await expect(
      page.getByRole('heading', { name: 'Acesso negado' }),
    ).toBeVisible()
    await expect(page.getByText('financeiro', { exact: false })).toBeVisible()
  })
})
