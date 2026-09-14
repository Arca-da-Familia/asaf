import { expect, test, type Page } from '@playwright/test'

// v0.2.9 — "ver como" (impersonação de papel). Cobre o caminho que mais importa: o banner
// aparece, o menu passa a refletir as permissões do papel impersonado (não do admin real), e
// "Encerrar" devolve o admin ao próprio nível. O bloqueio de escrita em si é reforçado no
// backend (middleware + usuario_tem_permissao usando o nível efetivo) e foi validado por
// testes manuais contra um backend real nesta sessão — aqui o alvo é o comportamento do painel.

const CPF_TESTE = '529.982.247-25'
const SENHA_TESTE = 'senha-super-secreta'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function loginComoAdmin(page: Page) {
  let impersonando = false

  await page.route('**/auth/refresh', (route) =>
    route.fulfill(json(impersonando ? {} : {}, 401)),
  )
  await page.route('**/auth/me', (route) =>
    route.fulfill(
      json({
        id_usuario: 1,
        id_associado: 1,
        nome_completo: 'Admin Teste',
        email: 'admin@example.org',
        nivel: impersonando ? 'Associado' : 'Presidente',
        mfa_ativado: true,
        mfa_obrigatorio: false,
        mfa_pendente: false,
        permissoes: impersonando ? [] : ['gerenciar_acesso', 'associados'],
        impersonando: impersonando
          ? { id_nivel: 4, nome_nivel: 'Associado', nivel_real: 'Presidente' }
          : null,
      }),
    ),
  )
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
  await page.route('**/api/niveis-acesso/', (route) =>
    route.fulfill(
      json([
        {
          id_nivel: 1,
          nome_nivel: 'Presidente',
          descricao: null,
          is_conselho_fiscal: false,
          exige_mfa: true,
          permissoes: [1, 2],
        },
        {
          id_nivel: 4,
          nome_nivel: 'Associado',
          descricao: null,
          is_conselho_fiscal: false,
          exige_mfa: false,
          permissoes: [],
        },
      ]),
    ),
  )
  await page.route('**/api/permissoes/', (route) =>
    route.fulfill(
      json([
        {
          id_permissao: 1,
          modulo: 'core',
          codigo_permissao: 'gerenciar_acesso',
          descricao: null,
        },
        {
          id_permissao: 2,
          modulo: 'associados',
          codigo_permissao: 'associados',
          descricao: null,
        },
      ]),
    ),
  )
  await page.route('**/auth/impersonar/4', async (route) => {
    impersonando = true
    await route.fulfill(
      json({
        access_token: 'token-impersonado',
        token_type: 'bearer',
        expires_in_minutos: 45,
      }),
    )
  })
  await page.route('**/auth/impersonar/parar', async (route) => {
    impersonando = false
    await route.fulfill(
      json({
        access_token: 'token-de-teste',
        token_type: 'bearer',
        expires_in_minutos: 45,
      }),
    )
  })

  await page.goto('/login')
  await page.getByLabel('CPF').fill(CPF_TESTE)
  await page.getByLabel('Senha').fill(SENHA_TESTE)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()

  // page.goto faz reload completo (o access token só existe em memória) — simula o cookie de
  // refresh continuar válido para a navegação seguinte (para /acesso).
  await page.route('**/auth/refresh', (route) =>
    route.fulfill(json({ access_token: 'token-de-teste' })),
  )
}

test('"ver como" mostra o banner, filtra o menu pelo papel impersonado e "Encerrar" volta ao normal', async ({
  page,
}) => {
  await loginComoAdmin(page)

  await page.goto('/acesso')
  await expect(
    page.getByRole('heading', { name: 'Níveis e permissões' }),
  ).toBeVisible()

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Ver como Associado' }).click()

  await expect(page.getByText('Vendo como', { exact: false })).toBeVisible()
  await expect(
    page.getByText('Associado', { exact: false }).first(),
  ).toBeVisible()

  // Menu reflete o papel impersonado (Associado não tem "gerenciar_acesso") — some da lateral.
  await expect(
    page.getByRole('link', { name: 'Níveis e permissões' }),
  ).not.toBeVisible()

  await page.getByRole('button', { name: 'Encerrar' }).click()
  await expect(page.getByText('Vendo como', { exact: false })).not.toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Níveis e permissões' }),
  ).toBeVisible()
})
