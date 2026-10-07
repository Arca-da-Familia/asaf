import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  AVISO,
  campo,
  entrar,
  exigirHomologacao,
  type Papel,
  RODADA,
  sair,
  senhaDe,
  ver,
  vigiar,
} from './apoio'

// v5.4h - Auditoria financeira do Conselho Fiscal: os três conselheiros conferem, título a título, as entradas e saídas do mês.
// O que o roteiro prova, pela tela: o Conselho vê o mês com o resumo; aprovar um por um; ressalva e reprovação exigem explicação e
// suspendem o título; a tesouraria responde no próprio cartão e isso libera; aprovar em lote (mês + filtro) pula o que não deve; a
// MAIORIA (2 de 3) aprova e o título fica travado; só um conselheiro, com explicação, reabre; quem lança só acompanha; o Secretário é
// barrado; cada decisão e cada lote ficam na Auditoria do sistema.
// Os títulos de teste vencem em julho de 2088 e levam o nome da rodada: rodadas anteriores deixam os seus no mesmo mês.
test.describe.configure({ mode: 'serial' })
test.setTimeout(600_000)

const S = String(RODADA)
const MES = '2088-07'
const PREFIXO = `Auditoria de teste ${S}`
const descricao = (n: number) => `${PREFIXO} nº ${n}`
const SAIDAS = [1, 2, 3, 4, 5, 6]
const ENTRADA = 7
const TABELA = 'auditorias_de_titulo'
const ROTULO_DA_ENTRADA_NA_AUDITORIA = 'AUDITORIA_FINANCEIRA_DECISAO'
const SENHAS_DE_PAPEL: Papel[] = ['conselheiro_2', 'conselheiro_3']
const CPF_DIGITOS: Record<string, string> = {
  conselheiro_2: '22206335271',
  conselheiro_3: '22207127109',
}

async function capturarToken(page: Page): Promise<() => string> {
  let token = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token = cab
  })
  return () => token
}

async function api(
  page: Page,
  token: () => string,
  metodo: 'GET' | 'POST',
  caminho: string,
  corpo?: unknown,
) {
  const r = await page.request.fetch(`${API_HML}${caminho}`, {
    method: metodo,
    headers: { Authorization: token(), 'Content-Type': 'application/json' },
    data: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  return {
    status: r.status(),
    corpo: (await r.json().catch(() => null)) as unknown,
  }
}

const cartao = (page: Page, n: number): Locator =>
  page.locator('div.rounded-md.border').filter({
    has: page.locator('p.font-medium', {
      hasText: new RegExp(`${descricao(n)}$`),
    }),
  })

const resumo = (
  total: number,
  pendentes: number,
  suspensos: number,
  aprovados: number,
) =>
  `${total} título(s) no mês · ${pendentes} pendente(s) · ${suspensos} suspenso(s) · ${aprovados} aprovado(s) · Para aprovar, 2 conselheiros precisam concordar.`

async function esperarCarregar(page: Page) {
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  await expect(cartao(page, 1)).toBeVisible()
}

/** Abre a Auditoria financeira do mês de teste, já só com os títulos desta rodada (pelo endereço: dá para mandar o link). */
async function abrirDoMes(page: Page) {
  await page.goto(
    `/financeiro/auditoria-financeira?mes=${MES}&busca=${encodeURIComponent(PREFIXO)}`,
  )
  await expect(
    page.getByRole('heading', { name: 'Auditoria financeira', level: 1 }),
  ).toBeVisible()
  await esperarCarregar(page)
}

async function totalNaAuditoriaDoSistema(page: Page): Promise<number> {
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

test('preparo: o Presidente de teste dá acesso ao 2º e ao 3º conselheiro fiscal (se ainda não têm) e anota o total da Auditoria', async ({
  page,
}) => {
  exigirHomologacao()
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'presidente')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const associados = (await api(page, token, 'GET', '/api/associados/'))
    .corpo as { id_associado: number; cpf: string | null }[]
  for (const papel of SENHAS_DE_PAPEL) {
    const a = associados.find(
      (x) => (x.cpf ?? '').replace(/\D/g, '') === CPF_DIGITOS[papel],
    )
    expect(a, `o associado do ${papel} existe na homologação`).toBeTruthy()
    const r = await api(
      page,
      token,
      'POST',
      `/api/associados/${a!.id_associado}/conceder-acesso`,
      {
        email: `${papel}@homologacao.example.com`,
        senha_provisoria: senhaDe(papel),
      },
    )
    if (r.status !== 200) {
      expect(r.status, `conceder acesso ao ${papel}`).toBe(400)
      expect(JSON.stringify(r.corpo)).toContain('já tem acesso')
    }
  }
  totalAntes = await totalNaAuditoriaDoSistema(page)
  expect(vigia.problemas()).toEqual([])
})

test('a tesouraria lança os títulos de teste (6 saídas e 1 entrada em julho de 2088)', async ({
  page,
}) => {
  const vigia = vigiar(page)
  const token = await capturarToken(page)
  await entrar(page, 'tesoureiro')
  await page.goto('/financeiro/titulos')
  await expect.poll(() => token(), { timeout: 15_000 }).not.toBe('')
  const contas = (await api(page, token, 'GET', '/api/plano-contas/'))
    .corpo as { id_conta: number; tipo: string; sintetica?: boolean }[]
  const despesa = contas.find((c) => c.tipo === 'Despesa' && !c.sintetica)
  const receita = contas.find((c) => c.tipo === 'Receita' && !c.sintetica)
  expect(despesa && receita).toBeTruthy()
  for (const n of SAIDAS) {
    const r = await api(page, token, 'POST', '/titulos/', {
      tipo_titulo: 'A Pagar',
      id_conta_contabil: despesa!.id_conta,
      descricao: descricao(n),
      valor_original: 20 + n,
      data_vencimento: `${MES}-0${n}T00:00:00`,
    })
    expect(r.status, `lançar a saída ${n}`).toBe(200)
  }
  const r = await api(page, token, 'POST', '/titulos/', {
    tipo_titulo: 'A Receber',
    id_conta_contabil: receita!.id_conta,
    descricao: descricao(ENTRADA),
    valor_original: 50,
    data_vencimento: `${MES}-15T00:00:00`,
  })
  expect(r.status, 'lançar a entrada').toBe(200)
  expect(vigia.problemas()).toEqual([])
})

test('o 1º conselheiro abre a Auditoria financeira pelo menu, vê o resumo do mês e aprova um título', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'conselheiro')
  await page.getByRole('link', { name: 'Financeiro' }).first().click()
  await page
    .getByRole('complementary')
    .getByRole('link', { name: 'Auditoria financeira', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Auditoria financeira', level: 1 }),
  ).toBeVisible()
  await page.getByLabel('Mês de vencimento').fill(MES)
  await page
    .getByLabel('Buscar por descrição, nome ou fornecedor')
    .fill(PREFIXO)
  await esperarCarregar(page)
  await expect(page.getByText(resumo(7, 7, 0, 0))).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Aprovar os pendentes do filtro' }),
  ).toBeVisible()
  await ver(page, info, 'auditoria-financeira-mes-de-teste')

  await page.getByRole('button', { name: `Aprovar: ${descricao(1)}` }).click()
  await expect(cartao(page, 1)).toContainText('Pendente: 1 de 2 aprovações')
  await expect(
    page.getByRole('button', { name: `Aprovar: ${descricao(1)}` }),
  ).toBeDisabled()
  await expect(cartao(page, 1)).toContainText('Você aprovou')

  // depois de recarregar, o que aparece veio do servidor
  await page.reload()
  await esperarCarregar(page)
  await expect(cartao(page, 1)).toContainText('Pendente: 1 de 2 aprovações')
  await ver(page, info, 'primeira-aprovacao-guardada')
  expect(vigia.problemas()).toEqual([])
})

test('ressalva e reprovação só seguem com a explicação, e o título fica suspenso', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'conselheiro')
  await abrirDoMes(page)

  await page
    .getByRole('button', { name: `Com ressalva: ${descricao(2)}` })
    .click()
  const confirmar = cartao(page, 2).getByRole('button', {
    name: 'Confirmar ressalva',
  })
  await expect(confirmar).toBeDisabled()
  const explicacao = cartao(page, 2).getByLabel('Explicação (obrigatória)')
  await explicacao.fill('curto')
  await expect(confirmar).toBeDisabled()
  await explicacao.fill('Falta a nota fiscal deste lançamento.')
  await expect(confirmar).toBeEnabled()
  await confirmar.click()
  await expect(cartao(page, 2)).toContainText(
    'Suspenso: aguardando a resposta da tesouraria',
  )
  await expect(cartao(page, 2).getByRole('list')).toContainText(
    'Falta a nota fiscal deste lançamento.',
  )
  await expect(cartao(page, 2).getByRole('list')).toContainText(
    '(pergunta aberta)',
  )

  await page.getByRole('button', { name: `Reprovar: ${descricao(3)}` }).click()
  await cartao(page, 3)
    .getByLabel('Explicação (obrigatória)')
    .fill('O valor não confere com o contrato.')
  await cartao(page, 3)
    .getByRole('button', { name: 'Confirmar reprovação' })
    .click()
  await expect(cartao(page, 3)).toContainText(
    'Suspenso: aguardando a resposta da tesouraria',
  )
  await expect(page.getByText(resumo(7, 5, 2, 0))).toBeVisible()
  // quem pergunta não responde: o conselheiro não vê o botão de responder
  await expect(page.getByRole('button', { name: /^Responder a / })).toHaveCount(
    0,
  )
  await ver(page, info, 'ressalva-e-reprovacao-suspendem')
  expect(vigia.problemas()).toEqual([])
})

test('a tesouraria só acompanha: não decide, mas responde à pergunta no próprio cartão e isso libera o título', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'tesoureiro')
  await abrirDoMes(page)
  // quem lança não audita: nenhum botão de decidir
  await expect(page.getByRole('button', { name: /^Aprovar: / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Reprovar: / })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Aprovar os pendentes do filtro' }),
  ).toHaveCount(0)
  await expect(page.getByText(resumo(7, 5, 2, 0))).toBeVisible()

  await cartao(page, 2)
    .getByRole('button', { name: /^Responder a .+: / })
    .click()
  const enviar = cartao(page, 2).getByRole('button', {
    name: 'Enviar resposta',
  })
  await expect(enviar).toBeDisabled()
  await cartao(page, 2)
    .getByLabel(/^Resposta da tesouraria a /)
    .fill('Nota fiscal anexada hoje, pode conferir.')
  await enviar.click()
  await expect(cartao(page, 2)).toContainText('Pendente: 0 de 2 aprovações')
  await expect(cartao(page, 2).getByRole('list')).toContainText(
    '(pergunta respondida)',
  )
  // a reprovação do nº 3 continua sem resposta: segue suspenso
  await expect(cartao(page, 3)).toContainText(
    'Suspenso: aguardando a resposta da tesouraria',
  )
  await expect(page.getByText(resumo(7, 6, 1, 0))).toBeVisible()
  await ver(page, info, 'tesouraria-respondeu-a-ressalva')
  expect(vigia.problemas()).toEqual([])
})

test('o 2º conselheiro completa a maioria: o título fica aprovado e travado; o lote pula o suspenso e o travado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'conselheiro_2')
  await abrirDoMes(page)
  await page.getByRole('button', { name: `Aprovar: ${descricao(1)}` }).click()
  await expect(cartao(page, 1)).toContainText('Aprovado (2 de 2) — travado')
  // travado: nada de aprovar nem reprovar; só reabrir
  await expect(
    page.getByRole('button', { name: `Aprovar: ${descricao(1)}` }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: `Reabrir auditoria: ${descricao(1)}` }),
  ).toBeVisible()
  await ver(page, info, 'maioria-aprova-e-trava')

  await page
    .getByRole('button', { name: 'Aprovar os pendentes do filtro' })
    .click()
  await expect(
    page.getByText(/Aprovar de uma vez os títulos pendentes de 2088-07/),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Confirmar aprovação em lote' })
    .click()
  await expect(page.locator(AVISO)).toContainText(
    '5 título(s) aprovado(s) por você. Pulados: 1 suspenso(s), 1 já aprovado(s) e travado(s).',
  )
  await expect(page.getByText(resumo(7, 5, 1, 1))).toBeVisible()
  await ver(page, info, 'lote-do-segundo-conselheiro')
  expect(vigia.problemas()).toEqual([])
})

test('o 3º conselheiro aprova o lote (a maioria trava os títulos) e reabre um título aprovado com explicação', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'conselheiro_3')
  await abrirDoMes(page)
  await page
    .getByRole('button', { name: 'Aprovar os pendentes do filtro' })
    .click()
  await page
    .getByRole('button', { name: 'Confirmar aprovação em lote' })
    .click()
  await expect(page.locator(AVISO)).toContainText(
    '5 título(s) aprovado(s) por você. Pulados: 1 suspenso(s), 1 já aprovado(s) e travado(s).',
  )
  await expect(page.getByText(resumo(7, 0, 1, 6))).toBeVisible()
  // o nº 2 tinha a ressalva (já respondida): com os dois votos de aprovação, fica aprovado e travado
  await expect(cartao(page, 2)).toContainText('Aprovado (2 de 2) — travado')
  await expect(cartao(page, 3)).toContainText(
    'Suspenso: aguardando a resposta da tesouraria',
  )
  await ver(page, info, 'maioria-do-lote')

  // reabrir exige a explicação; depois, as aprovações antigas não valem mais
  await page
    .getByRole('button', { name: `Reabrir auditoria: ${descricao(1)}` })
    .click()
  const confirmar = cartao(page, 1).getByRole('button', {
    name: 'Confirmar reabertura',
  })
  await expect(confirmar).toBeDisabled()
  await cartao(page, 1)
    .getByLabel('Explicação (obrigatória)')
    .fill('Foi aprovado antes de conferir a nota.')
  await confirmar.click()
  await expect(cartao(page, 1)).toContainText('Pendente: 0 de 2 aprovações')
  await expect(cartao(page, 1).getByRole('list')).toContainText('Reaberto')
  await expect(cartao(page, 1).getByRole('list')).toContainText(
    'Foi aprovado antes de conferir a nota.',
  )
  await expect(page.getByText(resumo(7, 1, 1, 5))).toBeVisible()
  await ver(page, info, 'reabertura-com-explicacao')
  expect(vigia.problemas()).toEqual([])
})

test('quem não é do Financeiro (Secretário) é barrado; a Auditoria do sistema guarda as 7 ações', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'secretario')
  await page.goto('/financeiro/auditoria-financeira')
  await expect(
    page.getByRole('heading', { name: 'Acesso negado' }),
  ).toBeVisible()
  await sair(page)

  await entrar(page, 'presidente')
  const total = await totalNaAuditoriaDoSistema(page)
  // decisões: 1ª aprovação, ressalva, reprovação, 2ª aprovação, reabertura (5) + 2 lotes = 7
  expect(total - totalAntes, 'sete ações novas na Auditoria').toBe(7)
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('cell', {
        name: ROTULO_DA_ENTRADA_NA_AUDITORIA,
        exact: true,
      }),
    }),
  ).not.toHaveCount(0)
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('cell', {
        name: 'AUDITORIA_FINANCEIRA_LOTE',
        exact: true,
      }),
    }),
  ).not.toHaveCount(0)
  await ver(page, info, 'auditoria-do-sistema-da-auditoria-financeira')
  expect(vigia.problemas()).toEqual([])
})
