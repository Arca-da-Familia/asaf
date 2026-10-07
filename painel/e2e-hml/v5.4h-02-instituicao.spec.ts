import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Instituição: os dados da própria associação num lugar só do painel, cada campo marcado "aparece no site" ou "só interno".
// O que o roteiro prova, pela tela: os campos por grupo; salvar grava (e continua gravado depois de recarregar); a marca "aparece no site"
// decide o que a rota pública entrega (o que o site vai mostrar); o servidor recusa valor inválido em português; o que é interno de
// verdade não tem a opção; tudo fica na Auditoria; quem não administra o acesso (Secretário) é barrado.
test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const S = String(RODADA)
const TELEFONE = `(91) 98888-${S.slice(-4).padStart(4, '0')}`
const HORARIO = `Segunda a sexta, 8h às 17h (rodada ${S.slice(-4)})`
const TABELA = 'configuracoes_institucionais'

/** O quadro de um campo (o rótulo é o nome do campo; as seções são `rounded-xl`, os campos `rounded-md`). */
const quadro = (page: Page, rotulo: string) =>
  page
    .locator('div.rounded-md.border')
    .filter({ has: page.getByLabel(rotulo, { exact: true }) })

async function abrirInstituicao(page: Page): Promise<void> {
  await page
    .getByRole('complementary')
    .getByRole('link', { name: 'Instituição', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Instituição', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await expect(page.getByLabel('Nome da instituição')).toBeVisible()
}

/** O que o site público recebe agora (rota aberta, sem login). */
async function dadosPublicos(page: Page): Promise<Record<string, string>> {
  const r = await page.request.get(`${API_HML}/api/publico/instituicao`)
  expect(r.status(), 'a rota pública responde sem login').toBe(200)
  return (await r.json()) as Record<string, string>
}

/** Abre a Auditoria filtrada pela tabela e devolve o total de registros (lido da resposta da própria tela). */
async function totalNaAuditoria(page: Page): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${TABELA}`),
  )
  await campo(page, 'Tabela').fill(TABELA)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

let totalAntes = 0

test('a Instituição mostra os campos por grupo e diz o que vai para o site e o que é só interno', async ({
  page,
}, info) => {
  exigirHomologacao()
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  totalAntes = await totalNaAuditoria(page)
  await page.goto('/')
  await abrirInstituicao(page)

  for (const grupo of [
    'Identidade',
    'Contato',
    'Redes',
    'Aparência',
    'Financeiro',
    'Sistema',
  ]) {
    await expect(page.getByRole('region', { name: grupo })).toBeVisible()
  }
  // o nome vai para o site por padrão; a chave Pix só vai se alguém decidir
  await expect(
    quadro(page, 'Nome da instituição').getByLabel('Aparece no site'),
  ).toBeChecked()
  await expect(
    quadro(page, 'Chave Pix').getByLabel('Aparece no site'),
  ).not.toBeChecked()
  // o que é interno de verdade não oferece a opção
  for (const interno of [
    'E-mail remetente das notificações',
    'Texto de rodapé dos documentos',
  ]) {
    const q = quadro(page, interno)
    await expect(q.getByText('Só interno')).toBeVisible()
    await expect(q.getByLabel('Aparece no site')).toHaveCount(0)
  }
  await ver(page, info, 'instituicao-campos-por-grupo')

  const publico = await dadosPublicos(page)
  expect(publico['NOME_INSTITUICAO'], 'o nome vai para o site').toBeTruthy()
  expect(Object.keys(publico)).not.toContain('EMAIL_REMETENTE')
  expect(Object.keys(publico)).not.toContain('TEXTO_PADRAO_DOCUMENTO')
  expect(vigia.problemas()).toEqual([])
})

test('salvar grava, continua gravado ao recarregar, e a marca decide o que o site recebe', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirInstituicao(page)

  const tel = quadro(page, 'Telefone / WhatsApp')
  const salvar = tel.getByRole('button', { name: 'Salvar', exact: true })
  await expect(salvar, 'sem mudança, não há o que salvar').toBeDisabled()
  await tel.getByLabel('Telefone / WhatsApp', { exact: true }).fill(TELEFONE)
  await salvar.click()
  await expect(tel.getByText('Salvo.')).toBeVisible()
  await expect(tel.getByText(/^Última alteração em/)).toBeVisible()
  await ver(page, info, 'instituicao-telefone-salvo')

  // um segundo campo, num grupo diferente
  const hor = quadro(page, 'Horário de atendimento')
  await hor.getByLabel('Horário de atendimento', { exact: true }).fill(HORARIO)
  await hor.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(hor.getByText('Salvo.')).toBeVisible()

  // depois de recarregar a tela, o valor veio do servidor
  await page.reload()
  await expect(page.getByLabel('Nome da instituição')).toBeVisible()
  await expect(
    quadro(page, 'Telefone / WhatsApp').getByLabel('Telefone / WhatsApp', {
      exact: true,
    }),
  ).toHaveValue(TELEFONE)

  // marcado "aparece no site" (o padrão), o site recebe
  let publico = await dadosPublicos(page)
  expect(publico['TELEFONE_INSTITUCIONAL']).toBe(TELEFONE)
  expect(publico['HORARIO_ATENDIMENTO']).toBe(HORARIO)

  // desmarcar: some do site na hora, mas o valor continua guardado
  const marca = quadro(page, 'Telefone / WhatsApp').getByLabel(
    'Aparece no site',
  )
  await marca.uncheck()
  await expect(
    quadro(page, 'Telefone / WhatsApp').getByText('Agora é só interno.'),
  ).toBeVisible()
  publico = await dadosPublicos(page)
  expect(Object.keys(publico)).not.toContain('TELEFONE_INSTITUCIONAL')
  expect(publico['HORARIO_ATENDIMENTO'], 'o outro campo não muda').toBe(HORARIO)
  await expect(
    quadro(page, 'Telefone / WhatsApp').getByLabel('Telefone / WhatsApp', {
      exact: true,
    }),
  ).toHaveValue(TELEFONE)
  await ver(page, info, 'instituicao-telefone-so-interno')

  // marcar de novo: volta para o site com o mesmo valor
  await quadro(page, 'Telefone / WhatsApp')
    .getByLabel('Aparece no site')
    .check()
  await expect(
    quadro(page, 'Telefone / WhatsApp').getByText('Agora aparece no site.'),
  ).toBeVisible()
  publico = await dadosPublicos(page)
  expect(publico['TELEFONE_INSTITUCIONAL']).toBe(TELEFONE)
  expect(vigia.problemas()).toEqual([])
})

test('o servidor recusa o que está errado, em português, e o valor guardado não muda', async ({
  page,
}, info) => {
  // as recusas são respostas 4xx esperadas: só o 5xx e o erro de página reprovam
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirInstituicao(page)

  const tentativas: { rotulo: string; valor: string; mensagem: RegExp }[] = [
    {
      rotulo: 'CNPJ',
      valor: '11.111.111/1111-11',
      mensagem: /CNPJ inválido/,
    },
    {
      rotulo: 'E-mail de contato',
      valor: 'sem-arroba',
      mensagem: /“E-mail de contato” precisa ser um e-mail válido/,
    },
    {
      rotulo: 'Cor primária',
      valor: 'azul',
      mensagem: /“Cor primária” precisa ser uma cor hexadecimal/,
    },
    {
      rotulo: 'Nome no Pix',
      valor: 'N'.repeat(30),
      mensagem: /no máximo 25/,
    },
  ]
  for (const t of tentativas) {
    const q = quadro(page, t.rotulo)
    const entrada = q.getByLabel(t.rotulo, { exact: true })
    const antes = await entrada.inputValue()
    await entrada.fill(t.valor)
    await q.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(q.getByRole('alert'), `recusa de ${t.rotulo}`).toContainText(
      t.mensagem,
    )
    // o que ficou guardado é o de antes
    await page.reload()
    await expect(page.getByLabel('Nome da instituição')).toBeVisible()
    await expect(
      quadro(page, t.rotulo).getByLabel(t.rotulo, { exact: true }),
    ).toHaveValue(antes)
  }
  await ver(page, info, 'instituicao-depois-das-recusas')
  expect(vigia.problemas()).toEqual([])
})

test('um CNPJ válido grava e as alterações aparecem na Auditoria', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await abrirInstituicao(page)

  const q = quadro(page, 'CNPJ')
  const entrada = q.getByLabel('CNPJ', { exact: true })
  const anterior = await entrada.inputValue()
  // 11.222.333/0001-81 é um CNPJ de teste com dígitos verificadores corretos
  const novo = anterior === '11.222.333/0001-81' ? '' : '11.222.333/0001-81'
  await entrada.fill(novo)
  await q.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(q.getByText('Salvo.')).toBeVisible()
  await page.reload()
  await expect(
    quadro(page, 'CNPJ').getByLabel('CNPJ', { exact: true }),
  ).toHaveValue(novo)

  // Auditoria: telefone (salvar, desmarcar, marcar), horário (salvar) e CNPJ (salvar) = 5 ações novas
  const total = await totalNaAuditoria(page)
  expect(total - totalAntes, 'cinco alterações na Auditoria').toBe(5)
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('cell', {
        name: 'UPDATE_INSTITUICAO',
        exact: true,
      }),
    }),
  ).not.toHaveCount(0)
  await ver(page, info, 'auditoria-da-instituicao')
  expect(vigia.problemas()).toEqual([])
  await sair(page)
})

test('quem não administra o acesso (Secretário) não vê a Instituição nem entra por endereço direto', async ({
  page,
}) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  await expect(
    page
      .getByRole('complementary')
      .getByRole('link', { name: 'Instituição', exact: true }),
  ).toHaveCount(0)
  await page.goto('/instituicao')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})
