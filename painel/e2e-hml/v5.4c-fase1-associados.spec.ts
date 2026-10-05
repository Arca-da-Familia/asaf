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
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await ver(page, info, 'depois de salvar')
  await page.reload()
  await expect(campo(page, 'Profissão')).toHaveValue('Professora de Teste')
  await ver(page, info, 'depois de recarregar a pagina')
})
