import { expect, test } from '@playwright/test'

import {
  campo,
  cpfValido,
  entrar,
  exigirHomologacao,
  fotoDeTeste,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.4c — FASE 1 e 2.5.1 ao vivo: o ciclo do associado na tela do hml-painel. Cada rodada cadastra uma pessoa NOVA (nome e CPF mudam),
// então o roteiro pode rodar de novo sem reiniciar o banco de teste.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const NOME = `Pessoa Cadastrada Pelo Robo ${RODADA} de Teste`
const CPF = cpfValido(300000000 + (RODADA % 600000000))
const EMAIL = `robo.${RODADA}@homologacao.example.com`

async function preencherCadastro(
  page: import('@playwright/test').Page,
  cpf: string,
  email: string,
) {
  await campo(page, 'Nome completo *').fill(NOME)
  await campo(page, 'CPF *').fill(cpf)
  await campo(page, 'E-mail *').fill(email)
  await campo(page, 'Telefone (WhatsApp) *').fill('91988887777')
  await campo(page, 'Categoria *').selectOption({ index: 1 })
  await campo(page, 'CEP *').fill('68515000')
  await campo(page, 'Logradouro *').fill('Rua das Flores de Teste')
  await campo(page, 'Número *').fill('77')
  await campo(page, 'Bairro *').fill('Bairro de Teste')
  await campo(page, 'Cidade *').fill('Parauapebas')
  await campo(page, 'Estado (UF) *').fill('PA')
}

test('a lista mostra os associados de teste e o filtro encontra um deles', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados')
  await expect(page.getByRole('heading', { name: 'Associados' })).toBeVisible()
  await expect(page.getByText('Ana Lúcia Ferreira de Teste')).toBeVisible()
  await ver(page, info, 'lista de associados')

  await page.getByLabel('Filtrar').fill('Carla Menezes')
  await expect(page.getByText('Carla Menezes Souza de Teste')).toBeVisible()
  await expect(page.getByText('Ana Lúcia Ferreira de Teste')).toHaveCount(0)
  await ver(page, info, 'filtro por nome')
  expect(vigia.problemas()).toEqual([])
})

test('cadastrar pela tela: o associado novo aparece na lista e a Auditoria registra', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados/novo')
  await expect(
    page.getByRole('heading', { name: 'Novo associado' }),
  ).toBeVisible()
  await preencherCadastro(page, CPF, EMAIL)
  await ver(page, info, 'formulario preenchido')
  await page.getByRole('button', { name: 'Cadastrar associado' }).click()

  await expect(page).toHaveURL(/\/associados$/)
  await page.getByLabel('Filtrar').fill(String(RODADA))
  await expect(page.getByText(NOME)).toBeVisible()
  await ver(page, info, 'associado novo na lista')

  await page.goto('/auditoria')
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible()
  await ver(page, info, 'auditoria depois do cadastro')
  expect(vigia.problemas()).toEqual([])
})

test('recusas provocadas: CPF repetido, CPF inválido e campo obrigatório vazio', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/associados/novo')

  // 1) o mesmo CPF de novo: o sistema barra na hora, não depois
  await preencherCadastro(page, CPF, `outro.${RODADA}@homologacao.example.com`)
  await page.getByRole('button', { name: 'Cadastrar associado' }).click()
  await expect(page).toHaveURL(/\/associados\/novo$/)
  await expect(page.locator('.text-destructive').first()).toBeVisible()
  await ver(page, info, 'CPF repetido recusado')

  // 2) CPF com dígito verificador errado
  await campo(page, 'CPF *').fill('123.456.789-00')
  await page.getByRole('button', { name: 'Cadastrar associado' }).click()
  await expect(page).toHaveURL(/\/associados\/novo$/)
  await expect(page.locator('.text-destructive').first()).toBeVisible()
  await ver(page, info, 'CPF invalido recusado')

  // 3) nome vazio
  await campo(page, 'Nome completo *').fill('')
  await page.getByRole('button', { name: 'Cadastrar associado' }).click()
  await expect(page).toHaveURL(/\/associados\/novo$/)
  await ver(page, info, 'nome vazio recusado')
})

test('a ficha do associado: abas Dados e foto, Ficha 360, Cargos e Família abrem', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(String(RODADA))
  await page.getByRole('link', { name: NOME }).click()
  await expect(page.getByRole('heading', { name: NOME })).toBeVisible()
  await ver(page, info, 'ficha - dados e foto')

  await page.getByRole('button', { name: 'Ficha 360' }).click()
  await expect(
    page.getByRole('heading', { name: 'Situação financeira' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Linha do tempo' }),
  ).toBeVisible()
  await ver(page, info, 'ficha 360 e linha do tempo')

  await page.getByRole('button', { name: 'Cargos' }).click()
  await expect(
    page.getByRole('heading', { name: 'Histórico de cargos' }),
  ).toBeVisible()
  await ver(page, info, 'cargos')

  await page.getByRole('button', { name: 'Família' }).click()
  await expect(
    page.getByRole('heading', { name: 'Vínculos familiares' }),
  ).toBeVisible()
  await ver(page, info, 'familia')
  expect(vigia.problemas()).toEqual([])
})

async function abrirFicha(page: import('@playwright/test').Page) {
  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(String(RODADA))
  await page.getByRole('link', { name: NOME }).click()
  await expect(page.getByRole('heading', { name: NOME })).toBeVisible()
}

test('situação: licença, desligamento (com confirmação), recusa de anonimizar antes do prazo e readmissão — pela tela, com histórico e Auditoria', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirFicha(page)
  await page.getByRole('button', { name: 'Situação', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Situação do associado' }),
  ).toBeVisible()
  await expect(
    page.getByText('Nenhuma mudança de situação registrada'),
  ).toBeVisible()
  await ver(page, info, 'situacao antes de qualquer mudanca')

  // 1) licença
  const retorno = new Date(Date.now() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  await page.getByRole('button', { name: 'Registrar licença' }).click()
  await page.getByLabel('Motivo *').selectOption('SAUDE')
  await page.getByLabel('Retorno previsto *').fill(retorno)
  await ver(page, info, 'formulario de licenca preenchido')
  await page.getByRole('button', { name: 'Confirmar licença' }).click()
  await expect(page.getByTestId('situacao-atual')).toHaveText('Licenciado')
  await expect(page.getByText('Licença — Saúde')).toBeVisible()
  await ver(page, info, 'licenca registrada e no historico')

  // 2) desligamento: o sistema mostra as consequências e só desliga depois de confirmar
  await page.getByRole('button', { name: 'Desligar associado' }).click()
  await page.getByLabel('Motivo *').selectOption('PEDIDO_VOLUNTARIO')
  await page.getByRole('button', { name: 'Desligar associado…' }).click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText('revoga o acesso ao painel')
  await ver(page, info, 'confirmacao do desligamento com as consequencias')
  await dialogo.getByRole('button', { name: 'Desligar associado' }).click()
  await expect(page.getByTestId('situacao-atual')).toHaveText('Desligado')
  await expect(page.getByText('Desligamento — Pedido voluntário')).toBeVisible()
  await ver(page, info, 'desligado')

  // 3) recusa provocada: anonimizar antes de o prazo de retenção terminar
  await page.getByRole('button', { name: 'Anonimizar dado pessoal' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Anonimizar dado pessoal' })
    .click()
  await expect(page.getByRole('alert')).toContainText('Ainda não elegível')
  await expect(page.getByTestId('situacao-atual')).toHaveText('Desligado')
  await ver(page, info, 'anonimizar antes do prazo: recusado')

  // 4) readmissão: volta o mesmo cadastro
  await page.getByRole('button', { name: 'Readmitir associado' }).click()
  await page.getByRole('button', { name: 'Confirmar readmissão' }).click()
  await expect(page.getByTestId('situacao-atual')).not.toHaveText('Desligado')
  await expect(page.getByText('Readmissão')).toBeVisible()
  await ver(page, info, 'readmitido e historico completo')

  // 5) o que aconteceu aparece na linha do tempo da ficha 360 e na Auditoria
  await page.getByRole('button', { name: 'Ficha 360' }).click()
  await expect(page.getByText('Desligamento registrado')).toBeVisible()
  await expect(page.getByText('Readmitido como associado')).toBeVisible()
  await ver(page, info, 'linha do tempo da ficha 360')
  await page.goto('/auditoria')
  await expect(page.getByText('READMITIDO').first()).toBeVisible()
  await expect(page.getByText('DESLIGADO').first()).toBeVisible()
  await ver(page, info, 'auditoria com licenca, desligamento e readmissao')
  expect(vigia.problemas()).toEqual([])
})

test('foto: sobe pela tela e ABRE de verdade (a imagem carrega, não dá 404)', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(String(RODADA))
  await page.getByRole('link', { name: NOME }).click()
  await expect(page.getByRole('heading', { name: NOME })).toBeVisible()

  const jpeg = await fotoDeTeste(page, NOME)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'foto-de-teste.jpg',
    mimeType: 'image/jpeg',
    buffer: jpeg,
  })
  const imagem = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Foto', exact: true }) })
    .locator('img')
  await expect(imagem).toBeVisible()
  await expect
    .poll(async () =>
      imagem.evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBeGreaterThan(0)
  await ver(page, info, 'foto enviada e carregada')

  // abrir o endereço da imagem direto (item 11 do checklist: o link que a tela oferece tem que abrir)
  const endereco = await imagem.getAttribute('src')
  expect(endereco).toBeTruthy()
  const resposta = await page.request.get(endereco!)
  expect(resposta.status()).toBe(200)
  expect(resposta.headers()['content-type']).toContain('image/')
  expect(vigia.problemas()).toEqual([])
})

test('editar: a mudança é salva e continua lá depois de recarregar a página', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(String(RODADA))
  await page.getByRole('link', { name: NOME }).click()
  await expect(page.getByRole('heading', { name: NOME })).toBeVisible()

  await campo(page, 'Profissão').fill('Professora de Teste')
  const gravou = page.waitForResponse(
    (r) =>
      ['PUT', 'PATCH'].includes(r.request().method()) &&
      r.url().includes('/associados'),
  )
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  expect((await gravou).status()).toBe(200)
  await ver(page, info, 'depois de salvar')
  await page.reload()
  await expect(campo(page, 'Profissão')).toHaveValue('Professora de Teste')
  await ver(page, info, 'depois de recarregar a pagina')
})
