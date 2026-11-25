import { randomBytes } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  autorizacaoDaSessao,
  cadastrarPelaTela,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v9.6s - SEGURANÇA DE ACESSO (achados A1, A3 e A7 da revisão de 23/11/2026, defeitos que estavam na produção). Pela API e pelas telas da homologação:
//  1. o Secretário (tem `associados` e `governanca` pelo cargo, e NÃO gerencia os níveis de acesso) cadastra uma pessoa pela tela e tenta dar a ela
//     o nível Presidente pela API: recebe a MESMA recusa para o nível que existe, o que não existe e o associado que não existe, e nada é gravado.
//     Também não consegue pôr `gerenciar_acesso` nas permissões do próprio cargo (o mesmo furo, pelo catálogo de cargos) nem ler as regras do
//     sistema (limites do antifraude, teto da alçada): a mesma recusa para a lista, a regra que existe e a que não existe; o Presidente lê;
//  2. pela tela "Conceder acesso" (que não tem escolha de nível) a conta nasce no nível Associado, como a Auditoria registra; no primeiro login
//     ela cai na troca da senha e, pela API, a senha provisória só serve para ver quem é e trocar a senha (o resto recebe a recusa clara).
// O segundo passo (MFA) não existe na homologação (decisão do Presidente, 05/10/2026): o bloqueio do 2º passo, o código de uso único e o segundo
// passo obrigatório (achados A2 e A4) são provados pela suíte do servidor, não aqui.
test.describe.configure({ mode: 'serial' })
// a tela "Conceder acesso" mostra a senha provisória em texto: sem vídeo e sem o print automático neste roteiro, para ela nunca ir parar num arquivo
// de resultado; os prints de `ver` são tirados só nas telas sem a senha
test.use({ video: 'off', screenshot: 'off' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const RECUSA_DO_NIVEL =
  'Só quem gerencia os níveis de acesso pode escolher o nível da conta. Sem escolher, a conta nasce no nível Associado.'
const RECUSA_DO_CARGO =
  'Só quem gerencia os níveis de acesso pode mudar as permissões que um cargo dá.'
const RECUSA_SENHA_PROVISORIA =
  'A sua senha ainda é a provisória, que outra pessoa definiu. Troque a senha para continuar.'
const NAO_EXISTE = 987654321

const PESSOA = {
  nome: `Nivel Robo Acesso ${RODADA} de Teste`,
  cpf: cpfValido((RODADA + 81) % 999_999_999),
  email: `nivel.${RODADA}@homologacao.example.com`,
}
const CPF_DIGITOS = PESSOA.cpf.replace(/\D/g, '')
// senha provisória só desta rodada, inventada aqui: nunca é impressa, fotografada nem filmada (ver acima)
const SENHA_PROVISORIA = `Hml-${randomBytes(9).toString('base64url')}`

let idAssociado = 0
let tokenDoPresidente = ''
const niveis: Record<string, number> = {}

type OpcaoDoCargo = {
  id_opcao: number
  codigo: string
  metadados: { permissoes?: string[] } | null
}

async function pedir(
  page: Page,
  autorizacao: string,
  metodo: 'GET' | 'POST' | 'PUT',
  rota: string,
  corpo?: unknown,
): Promise<{ status: number; corpo: unknown }> {
  const r = await page.request.fetch(`${API_HML}${rota}`, {
    method: metodo,
    headers: { Authorization: autorizacao },
    data: corpo,
  })
  return { status: r.status(), corpo: await r.json().catch(() => null) }
}

async function aPessoa(
  page: Page,
  autorizacao: string,
): Promise<{ id_associado: number; tem_acesso: boolean }> {
  const { corpo } = await pedir(
    page,
    autorizacao,
    'GET',
    `/api/associados/?busca=${CPF_DIGITOS}`,
  )
  const lista = (
    Array.isArray(corpo) ? corpo : (corpo as { itens: unknown[] }).itens
  ) as { id_associado: number; tem_acesso: boolean }[]
  expect(lista, 'a pessoa do robô na lista de associados').toHaveLength(1)
  return lista[0]!
}

test('o Secretário não dá nível maior pela API: a mesma recusa para o que existe e o que não existe, e nada é gravado', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  tokenDoPresidente = await autorizacaoDaSessao(page, '/acesso')
  const { corpo } = await pedir(
    page,
    tokenDoPresidente,
    'GET',
    '/api/niveis-acesso/',
  )
  for (const n of corpo as { id_nivel: number; nome_nivel: string }[])
    niveis[n.nome_nivel] = n.id_nivel
  expect(niveis['Presidente'] && niveis['Associado']).toBeTruthy()
  await sair(page)

  await entrar(page, 'secretario')
  await cadastrarPelaTela(page, {
    nome: PESSOA.nome,
    cpf: PESSOA.cpf,
    email: PESSOA.email,
  })
  const secretario = await autorizacaoDaSessao(page, '/associados')
  const pessoa = await aPessoa(page, secretario)
  idAssociado = pessoa.id_associado
  expect(pessoa.tem_acesso).toBe(false)

  await test.step('o nível Presidente, um nível que não existe e um associado que não existe', async () => {
    const tentativas = [
      [idAssociado, niveis['Presidente']],
      [idAssociado, NAO_EXISTE],
      [NAO_EXISTE, niveis['Presidente']],
    ] as const
    for (const [alvo, idNivel] of tentativas) {
      const r = await pedir(
        page,
        secretario,
        'POST',
        `/api/associados/${alvo}/conceder-acesso`,
        {
          email: `login.${PESSOA.email}`,
          senha_provisoria: SENHA_PROVISORIA,
          id_nivel: idNivel,
        },
      )
      expect(r.status, `alvo ${alvo}, nível ${idNivel}`).toBe(403)
      expect(r.corpo).toEqual({ detail: RECUSA_DO_NIVEL })
    }
    expect((await aPessoa(page, secretario)).tem_acesso).toBe(false)
  })

  await test.step('as permissões do próprio cargo (1º Secretário) também não mudam', async () => {
    const lista = (
      await pedir(
        page,
        secretario,
        'GET',
        '/api/catalogos/titulo_cargo/opcoes?incluir_inativos=true',
      )
    ).corpo as OpcaoDoCargo[]
    const cargo = lista.find((o) => o.codigo === 'SECRETARIO')!
    expect(cargo, 'o cargo de 1º Secretário').toBeTruthy()
    const antes = cargo.metadados
    const r = await pedir(
      page,
      secretario,
      'PUT',
      `/api/opcoes-catalogo/${cargo.id_opcao}`,
      {
        metadados: {
          ...antes,
          permissoes: [...(antes?.permissoes ?? []), 'gerenciar_acesso'],
        },
      },
    )
    if (r.status !== 403) {
      // nunca deixar a homologação com o furo aberto: o Presidente devolve o que era antes de o roteiro reprovar
      await pedir(
        page,
        tokenDoPresidente,
        'PUT',
        `/api/opcoes-catalogo/${cargo.id_opcao}`,
        { metadados: antes },
      )
    }
    expect(r.status).toBe(403)
    expect(r.corpo).toEqual({ detail: RECUSA_DO_CARGO })
    const depois = (
      (
        await pedir(
          page,
          secretario,
          'GET',
          '/api/catalogos/titulo_cargo/opcoes?incluir_inativos=true',
        )
      ).corpo as OpcaoDoCargo[]
    ).find((o) => o.codigo === 'SECRETARIO')!
    expect(depois.metadados).toEqual(antes)
  })

  await test.step('as regras do sistema (limites do antifraude, teto da alçada) só são lidas por quem as gerencia', async () => {
    const lista = await pedir(page, secretario, 'GET', '/api/configuracoes/')
    const existe = await pedir(
      page,
      secretario,
      'GET',
      '/api/configuracoes/TETO_ALCADA_FINANCEIRA',
    )
    const naoExiste = await pedir(
      page,
      secretario,
      'GET',
      '/api/configuracoes/CHAVE_QUE_NAO_EXISTE',
    )
    for (const r of [lista, existe, naoExiste]) expect(r.status).toBe(403)
    expect(existe.corpo).toEqual(lista.corpo)
    expect(naoExiste.corpo).toEqual(lista.corpo)
    const doPresidente = await pedir(
      page,
      tokenDoPresidente,
      'GET',
      '/api/configuracoes/TETO_ALCADA_FINANCEIRA',
    )
    expect(doPresidente.status).toBe(200)
  })

  await page.goto('/associados')
  await ver(page, info, 'a pessoa cadastrada pelo secretario, ainda sem acesso')
  expect(vigia.problemas()).toEqual([])
})

test('pela tela a conta nasce no nível Associado e a senha provisória só serve para trocar a senha', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  expect(idAssociado, 'a pessoa do teste anterior').toBeGreaterThan(0)
  await entrar(page, 'secretario')
  await page.goto(`/associados/${idAssociado}/conceder-acesso`)
  await expect(
    page.getByRole('heading', { name: 'Conceder acesso' }),
  ).toBeVisible()
  // o formulário só pede o e-mail e a senha provisória: não há escolha de nível
  const formulario = page.locator('form')
  await expect(formulario.locator('input')).toHaveCount(2)
  await expect(formulario.locator('select')).toHaveCount(0)
  await expect(formulario.getByText(/nível/i)).toHaveCount(0)
  await ver(page, info, 'conceder acesso sem escolha de nivel')
  await test.step(
    'preencher o e-mail de login e a senha provisória',
    async () => {
      await page.locator('input[name="email"]').fill(`login.${PESSOA.email}`)
      await page
        .locator('input[name="senha_provisoria"]')
        .fill(SENHA_PROVISORIA)
      await page.getByRole('button', { name: 'Conceder acesso' }).click()
      // a tela seguinte mostra a senha para entregar ao associado: sem print dela
      await expect(
        page.getByRole('heading', { name: 'Acesso concedido' }),
      ).toBeVisible()
    },
    { box: true },
  )
  await page.getByRole('button', { name: 'Voltar para Associados' }).click()
  await sair(page)

  // a Auditoria registra o nível com que a conta nasceu: o padrão (Associado)
  const { corpo } = await pedir(
    page,
    tokenDoPresidente,
    'GET',
    '/api/auditoria/?tabela_afetada=usuarios&acao=CONCESSAO_ACESSO&por_pagina=50',
  )
  const concessao = (
    corpo as { entradas: { dados_depois: string | null }[] }
  ).entradas.find((e) =>
    String(e.dados_depois).includes(`"id_associado": ${idAssociado}`),
  )
  expect(concessao, 'a concessão na Auditoria').toBeTruthy()
  expect(String(concessao!.dados_depois)).toContain(
    `"id_nivel": ${niveis['Associado']}`,
  )

  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await test.step(
    'a pessoa entra pela primeira vez com a senha provisória',
    async () => {
      await page.goto('/login')
      await page.getByLabel('CPF').fill(CPF_DIGITOS)
      await page.getByLabel('Senha').fill(SENHA_PROVISORIA)
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Troque a sua senha' }),
      ).toBeVisible()
    },
    { box: true },
  )
  await ver(page, info, 'o primeiro login leva a troca da senha')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')

  const eu = await pedir(page, autorizacao, 'GET', '/auth/me')
  expect(eu.status).toBe(200)
  expect(eu.corpo).toMatchObject({
    nivel: 'Associado',
    senha_provisoria: true,
  })
  // pela API, com a senha provisória, nada além de ver quem é e trocar a senha
  for (const rota of ['/auth/perfil', '/api/catalogos/', '/auth/sessoes']) {
    const r = await pedir(page, autorizacao, 'GET', rota)
    expect(r.status, rota).toBe(403)
    expect(r.corpo).toEqual({ detail: RECUSA_SENHA_PROVISORIA })
  }
  expect(vigia.problemas()).toEqual([])
})
