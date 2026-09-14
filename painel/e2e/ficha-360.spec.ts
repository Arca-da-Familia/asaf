import { expect, test, type Page } from '@playwright/test'

// v1.5 — a aba "Linha do tempo" do Meu Perfil junta situação financeira, cargos e o histórico
// unificado (EventoLinhaDoTempo) numa tela só. API mockada via page.route, mesmo padrão de
// auth.spec.ts: valida o comportamento do PAINEL diante da resposta da API, não o backend em si.

const CPF_TESTE = '529.982.247-25'
const SENHA_TESTE = 'senha-super-secreta'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function logar(page: Page) {
  await page.route('**/auth/refresh', (route) => route.fulfill(json({}, 401)))
  await page.route('**/auth/me', (route) =>
    route.fulfill(
      json({
        id_usuario: 1,
        id_associado: 1,
        nome_completo: 'Maria de Teste',
        email: 'maria@example.org',
        nivel: 'Associado',
        mfa_ativado: true,
        mfa_obrigatorio: false,
        mfa_pendente: false,
        permissoes: ['associados'],
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

  await page.goto('/login')
  await page.getByLabel('CPF').fill(CPF_TESTE)
  await page.getByLabel('Senha').fill(SENHA_TESTE)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
}

test('linha do tempo mostra financeiro, cargos e o histórico unificado', async ({ page }) => {
  await logar(page)

  await page.route('**/auth/perfil', (route) =>
    route.fulfill(
      json({
        id_associado: 1,
        nome_completo: 'Maria de Teste',
        cpf: '52998224725',
        email_contato: 'maria@example.org',
        telefone_whatsapp: '11999999999',
        categoria: 'Efetivo',
        status_arrolamento: 'Ativo - Em Dia',
        data_admissao: '2024-01-01T00:00:00',
        endereco: null,
      }),
    ),
  )
  await page.route('**/auth/me/ficha-360', (route) =>
    route.fulfill(
      json({
        dados: {
          id_associado: 1,
          nome_completo: 'Maria de Teste',
          numero_matricula: 5,
          categoria: 'Efetivo',
          status_arrolamento: 'Ativo - Em Dia',
          data_admissao: '2024-01-01T00:00:00',
        },
        situacao_financeira: { saldo_devedor_total: 150.5, quantidade_titulos_pendentes: 1 },
        cargos: [
          {
            id_historico: 1,
            titulo_cargo: 'Tesoureira',
            data_posse: '2024-02-01T00:00:00',
            data_saida: null,
            atual: true,
          },
        ],
        documentos: [],
        linha_do_tempo: [
          {
            id_evento: 2,
            modulo_origem: 'cargos',
            tipo: 'CARGO_INICIADO',
            titulo: 'Assumiu o cargo de Tesoureira',
            descricao: null,
            data_evento: '2024-02-01T00:00:00',
          },
          {
            id_evento: 1,
            modulo_origem: 'filiacao',
            tipo: 'FILIACAO_APROVADA',
            titulo: 'Filiação aprovada',
            descricao: 'Matrícula 5 atribuída.',
            data_evento: '2024-01-01T00:00:00',
          },
        ],
      }),
    ),
  )

  await page.getByRole('link', { name: 'Meu perfil' }).click()
  await page.getByRole('button', { name: 'Linha do tempo' }).click()

  await expect(page.getByText('R$ 150,50')).toBeVisible()
  await expect(page.getByText('1 título(s) pendente(s)')).toBeVisible()
  await expect(page.getByText('Tesoureira', { exact: true })).toBeVisible()
  await expect(page.getByText('atual')).toBeVisible()

  await expect(page.getByText('Filiação aprovada')).toBeVisible()
  await expect(page.getByText('Matrícula 5 atribuída.')).toBeVisible()
  await expect(page.getByText('Assumiu o cargo de Tesoureira')).toBeVisible()
})

test('linha do tempo vazia mostra estado vazio, não erro', async ({ page }) => {
  await logar(page)
  await page.route('**/auth/perfil', (route) => route.fulfill(json({}, 200)))
  await page.route('**/auth/me/ficha-360', (route) =>
    route.fulfill(
      json({
        dados: { id_associado: 1 },
        situacao_financeira: { saldo_devedor_total: 0, quantidade_titulos_pendentes: 0 },
        cargos: [],
        documentos: [],
        linha_do_tempo: [],
      }),
    ),
  )

  await page.getByRole('link', { name: 'Meu perfil' }).click()
  await page.getByRole('button', { name: 'Linha do tempo' }).click()

  await expect(page.getByText('Nada por aqui ainda')).toBeVisible()
  await expect(page.getByText('Nenhum cargo registrado.')).toBeVisible()
})
