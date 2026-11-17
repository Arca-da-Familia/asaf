import { expect, test, type Page } from '@playwright/test'

import {
  procurarNaFila,
  AVISO,
  cadastrarPelaTela as cadastrar,
  campo,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
  preencherNovoAssociado,
} from './apoio'

// v5.4c — FASE 1 ao vivo (parte 2): cadastro parecido, Qualidade da base (duplicados, mesclagem, fila), Vínculos (voluntário, funcionário,
// e-mail suspeito), completude, situação calculada, acesso (segundo passo) e recadastramento. Tudo pela tela do hml-painel.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const cpf = (k: number) =>
  cpfValido(500000000 + ((RODADA + k * 104729) % 150000000))
const MESMO_NOME = `Duplicada Robo ${RODADA} de Teste`
const NASCIMENTO = '1981-04-04'

/** v9.5f: no passo "Comparar", marca o valor do cadastro que fica em todo campo que ainda pede escolha. */
async function escolherTudoDoQueFica(page: Page) {
  for (const grupo of await page.getByRole('radiogroup').all()) {
    if ((await grupo.getByRole('radio', { checked: true }).count()) === 0)
      await grupo.getByRole('radio').first().check()
  }
}

async function abrirFicha(page: Page, nome: string) {
  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(nome)
  await page.getByRole('link', { name: nome }).first().click()
  await expect(page.getByRole('heading', { name: nome })).toBeVisible()
}

test('cadastro parecido: o Secretário é barrado e não tem como forçar; o Presidente força e a lista mostra os dois', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await cadastrar(page, {
    nome: MESMO_NOME,
    cpf: cpf(1),
    email: `duplicada1.${RODADA}@homologacao.example.com`,
    nascimento: NASCIMENTO,
  })
  await sair(page)

  // o Secretário usa o formulário (a permissão de cadastrar vem do cargo) e o sistema desconfia do mesmo nome e telefone
  await entrar(page, 'secretario')
  await page.goto('/associados/novo')
  await preencherNovoAssociado(page, {
    nome: MESMO_NOME,
    cpf: cpf(2),
    email: `duplicada2.${RODADA}@homologacao.example.com`,
    telefone: '91911112222',
    nascimento: NASCIMENTO,
  })
  await page.getByRole('button', { name: 'Cadastrar associado' }).click()
  await expect(page.getByRole('alert').first()).toContainText(
    'Já existe um cadastro parecido',
  )
  await expect(
    page.getByRole('button', { name: /Cadastrar mesmo assim/ }),
  ).toHaveCount(0)
  await ver(
    page,
    info,
    'Secretario barrado no cadastro parecido, sem como forcar',
  )
  await sair(page)

  await entrar(page, 'presidente')
  await cadastrar(page, {
    nome: MESMO_NOME,
    cpf: cpf(2),
    email: `duplicada2.${RODADA}@homologacao.example.com`,
    nascimento: NASCIMENTO,
    forcar: true,
  })
  await page.getByLabel('Filtrar').fill(MESMO_NOME)
  await expect(page.getByRole('link', { name: MESMO_NOME })).toHaveCount(2)
  await ver(page, info, 'Presidente forcou: dois cadastros com o mesmo nome')
  expect(vigia.problemas()).toEqual([])
})

test('qualidade da base: o sistema acha o par; comparar campo a campo; juntar recusa nome errado; "não é a mesma pessoa" tira da fila', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados/qualidade')
  await expect(
    page.getByRole('heading', { name: 'Qualidade da base' }),
  ).toBeVisible()
  await ver(page, info, 'qualidade da base antes de procurar')
  await page
    .getByRole('button', { name: 'Procurar cadastros duplicados' })
    .click()
  await expect(page.locator(AVISO)).toContainText('candidato(s)')

  await procurarNaFila(page, MESMO_NOME)
  const par = page
    .getByRole('listitem', {
      name: new RegExp(`Possível cadastro duplicado: ${MESMO_NOME}`),
    })
    .first()
  await expect(par).toBeVisible()
  await expect(par).toContainText('associado, matrícula')
  await ver(page, info, 'par duplicado achado, com as matriculas')

  // v9.5f: passo 2 - os dois cadastros lado a lado; a matrícula mais antiga fica (cadeado) e o que difere pede escolha
  await par.getByRole('button', { name: 'Comparar' }).click()
  await expect(page.getByText(/Fica a \d+, a mais antiga/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  await ver(
    page,
    info,
    'comparacao campo a campo, matricula mais antiga com cadeado',
  )
  await escolherTudoDoQueFica(page)
  await page.getByRole('button', { name: 'Continuar' }).click()
  // passo 3 - recusa provocada: o nome digitado não confere
  await expect(page.getByText('Vai ficar assim')).toBeVisible()
  await page
    .getByLabel(/Para confirmar, digite o nome do cadastro que será juntado/)
    .fill('Fulano de Tal')
  await page.getByRole('button', { name: 'Juntar os dois cadastros' }).click()
  // (os CPFs dos dois são diferentes: o aviso disso também é um alerta na tela)
  await expect(
    page.getByRole('alert').filter({ hasText: 'não confere' }),
  ).toBeVisible()
  await ver(page, info, 'juntar recusado: nome nao confere')

  // "Não é a mesma pessoa" tira da fila (volta ao passo 2 pelo passo do alto)
  await page.getByRole('button', { name: /Comparar campo a campo/ }).click()
  await page.getByRole('button', { name: 'Não é a mesma pessoa' }).click()
  await expect(page.locator(AVISO)).toContainText('ignorado')
  await expect(
    page.getByRole('listitem', {
      name: new RegExp(`Possível cadastro duplicado: ${MESMO_NOME}`),
    }),
  ).toHaveCount(0)
  await ver(page, info, 'ignorado: sai da fila')

  await page
    .getByRole('button', { name: 'Procurar telefones inválidos' })
    .click()
  await expect(page.locator(AVISO)).toContainText('telefone(s)')
  expect(vigia.problemas()).toEqual([])
})

test('qualidade da base: dois cadastros de ASSOCIADO da mesma pessoa - fica a matrícula mais antiga e o número livre vai para o próximo associado (v9.5f)', async ({
  page,
}, info) => {
  const nome = `Juntar Robo ${RODADA} de Teste`
  await entrar(page, 'presidente')
  await cadastrar(page, {
    nome,
    cpf: cpf(7),
    email: `juntar1.${RODADA}@homologacao.example.com`,
    nascimento: '1977-07-07',
  })
  await cadastrar(page, {
    nome,
    cpf: cpf(8),
    email: `juntar2.${RODADA}@homologacao.example.com`,
    telefone: '91977778888',
    nascimento: '1977-07-07',
    forcar: true,
  })
  await page.goto('/associados/qualidade')
  await page
    .getByRole('button', { name: 'Procurar cadastros duplicados' })
    .click()
  await procurarNaFila(page, nome)
  const par = page
    .getByRole('listitem', {
      name: new RegExp(`Possível cadastro duplicado: ${nome}`),
    })
    .first()
  await expect(par).toBeVisible()
  await par.getByRole('button', { name: 'Comparar' }).click()
  await expect(page.getByText(/Fica a \d+, a mais antiga/)).toBeVisible()
  // o telefone difere: fica o do cadastro juntado (o mais novo); o resto, o do que fica
  await page
    .getByRole('radiogroup', { name: 'Telefone' })
    .getByRole('radio', { name: /91977778888/ })
    .check()
  await escolherTudoDoQueFica(page)
  await ver(page, info, 'dois associados: telefone escolhido do juntado')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText(/fica livre/)).toBeVisible()
  await page
    .getByLabel(/Para confirmar, digite o nome do cadastro que será juntado/)
    .fill(nome)
  await page.getByRole('button', { name: 'Juntar os dois cadastros' }).click()
  const aviso = page.locator(AVISO)
  await expect(aviso).toContainText('ficou livre')
  const livre = Number(
    /matrícula nº (\d+) ficou livre/.exec((await aviso.innerText()) ?? '')![1],
  )
  await ver(page, info, `juntados: a matricula ${livre} ficou livre`)

  // um só na lista, com o telefone escolhido
  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(nome)
  await expect(page.getByRole('link', { name: nome })).toHaveCount(1)

  // o próximo associado novo recebe o menor número livre (o liberado, ou um anterior a ele que já estivesse livre)
  const novo = `Chegando Robo ${RODADA} de Teste`
  await cadastrar(page, {
    nome: novo,
    cpf: cpf(9),
    email: `chegando.${RODADA}@homologacao.example.com`,
    telefone: '91966665555',
  })
  await abrirFicha(page, novo)
  const matricula = Number(
    /Matrícula (\d+)/.exec(
      (await page
        .getByText(/^Matrícula \d+/)
        .first()
        .innerText()) ?? '',
    )![1],
  )
  expect(matricula).toBeLessThanOrEqual(livre)
  await ver(page, info, `o proximo associado recebeu a matricula ${matricula}`)
})

test('qualidade da base: mescla de verdade (um associado e uma pessoa sem cadastro de associado, mesmo nome e nascimento)', async ({
  page,
}, info) => {
  const manter = `Mescla Robo ${RODADA} de Teste`
  const anfitria = `Anfitria Robo ${RODADA} de Teste`
  await entrar(page, 'presidente')
  await cadastrar(page, {
    nome: manter,
    cpf: cpf(3),
    email: `mescla.${RODADA}@homologacao.example.com`,
    telefone: '91922223333',
    nascimento: '1975-02-02',
  })
  await cadastrar(page, {
    nome: anfitria,
    cpf: cpf(4),
    email: `anfitria.${RODADA}@homologacao.example.com`,
    telefone: '91933334444',
    nascimento: '1970-01-01',
  })
  // a anfitriã ganha um familiar "pessoa nova" com o MESMO nome e nascimento do associado (sem ser associado)
  await abrirFicha(page, anfitria)
  await page.getByRole('button', { name: 'Família' }).click()
  await page.getByRole('button', { name: 'Adicionar familiar' }).click()
  await campo(page, 'Grau de parentesco *').selectOption({ index: 1 })
  await campo(page, 'Nome (se pessoa nova)').fill(manter)
  await campo(page, 'Data de nascimento (se pessoa nova)').fill('1975-02-02')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await expect(page.getByText(manter).first()).toBeVisible()
  await ver(page, info, 'familiar pessoa nova com o mesmo nome do associado')

  await page.goto('/associados/qualidade')
  await page
    .getByRole('button', { name: 'Procurar cadastros duplicados' })
    .click()
  await procurarNaFila(page, manter)
  const par = page
    .getByRole('listitem', {
      name: new RegExp(`Possível cadastro duplicado: ${manter}`),
    })
    .first()
  await expect(par).toBeVisible()
  await expect(par).toContainText('pessoa sem cadastro de associado')
  // v9.5f: fica o cadastro de ASSOCIADO (o lado com matrícula); a pessoa sem cadastro é juntada a ele
  await par.getByRole('button', { name: 'Comparar' }).click()
  await expect(page.getByText(/Fica a \d+/)).toBeVisible()
  await escolherTudoDoQueFica(page)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page
    .getByLabel(/Para confirmar, digite o nome do cadastro que será juntado/)
    .fill(manter)
  await ver(page, info, 'juncao pronta: fica o associado e a pessoa e juntada')
  await page.getByRole('button', { name: 'Juntar os dois cadastros' }).click()
  await expect(page.locator(AVISO)).toContainText('Cadastros juntados')
  await expect(
    page.getByRole('listitem', {
      name: new RegExp(`Possível cadastro duplicado: ${manter}`),
    }),
  ).toHaveCount(0)
  await ver(page, info, 'mesclado: o par saiu da fila')

  // o associado continua um só na lista
  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(manter)
  await expect(page.getByRole('link', { name: manter })).toHaveCount(1)
})

test('vínculos e cartões da ficha: completude, termo de voluntário (e renovação), funcionário, e-mail suspeito, situação calculada', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const nome = `Vinculos Robo ${RODADA} de Teste`
  await entrar(page, 'presidente')
  await cadastrar(page, {
    nome,
    cpf: cpf(5),
    email: `vinculos.${RODADA}@homologacao.example.com`,
    telefone: '91944445555',
  })
  await abrirFicha(page, nome)

  // completude: sem profissão e naturalidade o cadastro não está completo; preencher faz o percentual subir
  const percentual = async () =>
    Number(
      (await page.getByTestId('completude-percentual').innerText()).replace(
        '%',
        '',
      ),
    )
  await expect(page.getByTestId('completude-percentual')).toBeVisible()
  const antes = await percentual()
  expect(antes).toBeLessThan(100)
  await expect(page.getByText(/Falta: .*profissão/)).toBeVisible()
  await ver(page, info, 'completude do cadastro incompleto')
  await campo(page, 'Profissão').fill('Cozinheira')
  await campo(page, 'Naturalidade').fill('Belém')
  const gravou = page.waitForResponse(
    (r) =>
      ['PUT', 'PATCH'].includes(r.request().method()) &&
      r.url().includes('/associados'),
  )
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  expect((await gravou).status()).toBe(200)
  await expect.poll(percentual).toBeGreaterThan(antes)
  await ver(page, info, 'completude subiu depois de preencher')

  // voluntário: termo de adesão e renovação (a versão sobe)
  const fim = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10)
  await page.getByRole('button', { name: 'Vínculos' }).click()
  await expect(page.getByText(/Sem termo de adesão vigente/)).toBeVisible()
  await page.getByRole('button', { name: 'Registrar termo de adesão' }).click()
  await page.getByRole('button', { name: 'Confirmar termo de adesão' }).click()
  await expect(page.getByRole('alert')).toContainText('Preencha:')
  await ver(page, info, 'termo de adesao: campos obrigatorios barrados')
  await page.getByLabel('Atividade *').fill('Apoio na cozinha comunitária')
  await page.getByLabel('Carga horária semanal *').fill('4')
  await page.getByLabel('Fim da vigência *').fill(fim)
  await page.getByRole('button', { name: 'Confirmar termo de adesão' }).click()
  // recusa provocada: sem data de nascimento no cadastro não dá para provar a maioridade, então o servidor exige a autorização do responsável
  await expect(page.getByRole('alert')).toContainText('menor de idade')
  await ver(
    page,
    info,
    'termo de adesao: sem nascimento no cadastro exige autorizacao do responsavel',
  )
  await page
    .getByLabel('Autorização do responsável (referência)')
    .fill('Autorização de teste, protocolo 001')
  await page.getByRole('button', { name: 'Confirmar termo de adesão' }).click()
  await expect(page.locator(AVISO)).toContainText('Versão 1')
  await expect(page.getByTestId('termo-vigente')).toContainText(
    'Apoio na cozinha comunitária',
  )
  await ver(page, info, 'termo de adesao registrado e vigente')
  await page.getByRole('button', { name: 'Renovar termo de adesão' }).click()
  await page.getByLabel('Atividade *').fill('Apoio na cozinha comunitária')
  await page.getByLabel('Carga horária semanal *').fill('6')
  await page.getByLabel('Fim da vigência *').fill(fim)
  await page
    .getByLabel('Autorização do responsável (referência)')
    .fill('Autorização de teste, protocolo 001')
  await page.getByRole('button', { name: 'Confirmar termo de adesão' }).click()
  await expect(page.locator(AVISO)).toContainText('Versão 2')
  await expect(page.getByTestId('termo-vigente')).toContainText(
    '6 h por semana',
  )

  // funcionário
  await expect(page.getByText(/Não é funcionário/)).toBeVisible()
  await page
    .getByRole('button', { name: 'Cadastrar como funcionário(a)' })
    .click()
  await page.getByLabel('Cargo *').fill('Cozinheira de Teste')
  await page
    .getByRole('button', { name: 'Confirmar cadastro de funcionário(a)' })
    .click()
  await expect(page.getByTestId('funcionario-cadastrado')).toContainText(
    'Cozinheira de Teste',
  )
  await ver(page, info, 'funcionario cadastrado')

  // e-mail suspeito vai para a fila da Qualidade da base
  await page
    .getByRole('button', { name: 'Marcar e-mail como suspeito (devolveu)' })
    .click()
  await page.getByRole('button', { name: 'Confirmar e-mail suspeito' }).click()
  await expect(page.getByRole('alert')).toContainText('Preencha: Motivo')
  await page
    .getByLabel('O que aconteceu? *')
    .fill('a mensagem voltou como endereço inexistente')
  await page.getByRole('button', { name: 'Confirmar e-mail suspeito' }).click()
  await expect(page.locator(AVISO)).toContainText('suspeito')
  await ver(page, info, 'email marcado como suspeito')

  // situação guardada × calculada (o cálculo vem do financeiro)
  await page.getByRole('button', { name: 'Situação', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: /Situação guardada × calculada agora/ }),
  ).toBeVisible()
  await ver(page, info, 'situacao guardada e calculada')

  // linha do tempo e Auditoria mostram o que foi feito
  await page.getByRole('button', { name: 'Ficha 360' }).click()
  await expect(
    page.getByText(/Termo de adesão de voluntário registrado/).first(),
  ).toBeVisible()
  await expect(
    page.getByText(/Cadastrado\(a\) como funcionário\(a\)/),
  ).toBeVisible()
  await ver(page, info, 'linha do tempo com termo e funcionario')
  await page.goto('/associados/qualidade')
  await procurarNaFila(page, nome)
  await expect(
    page.getByRole('listitem', {
      name: new RegExp(`E-mail suspeito \\(devolveu\\): ${nome}`),
    }),
  ).toBeVisible()
  await ver(page, info, 'email suspeito na fila da qualidade da base')
  await page.goto('/auditoria')
  await expect(
    page.locator('[data-acao="FUNCIONARIO_CADASTRADO"]').first(),
  ).toBeVisible()
  await expect(
    page.locator('[data-acao="TERMO_REGISTRADO"]').first(),
  ).toBeVisible()
  expect(vigia.problemas()).toEqual([])
})

test('acesso: só quem gerencia o acesso redefine o segundo passo de outra pessoa, com confirmação e Auditoria', async ({
  page,
}, info) => {
  const alvo = 'Daniel Ribeiro Costa de Teste'
  // o Secretário prepara cadastros, mas não gerencia o acesso: não vê o botão
  await entrar(page, 'secretario')
  await abrirFicha(page, alvo)
  await page.getByRole('button', { name: 'Vínculos' }).click()
  await expect(
    page.getByText(/Termo de adesão|Sem termo/).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Redefinir o segundo passo (MFA)' }),
  ).toHaveCount(0)
  await ver(
    page,
    info,
    'Secretario nao ve o botao de redefinir o segundo passo',
  )
  await sair(page)

  await entrar(page, 'presidente')
  await abrirFicha(page, alvo)
  await page.getByRole('button', { name: 'Vínculos' }).click()
  await page
    .getByRole('button', { name: 'Redefinir o segundo passo (MFA)' })
    .click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText('Remove o autenticador atual')
  await ver(page, info, 'confirmacao de redefinir o segundo passo')
  await dialogo.getByRole('button', { name: 'Redefinir segundo passo' }).click()
  await expect(page.locator(AVISO)).toContainText('MFA do usuário resetado')
  await page.goto('/auditoria')
  await expect(
    page.locator('[data-acao="MFA_RESET_POR_TERCEIRO"]').first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria registra a redefinicao do segundo passo')
})

test('recadastramento: o associado confirma que os dados continuam corretos e a ficha deixa de dizer pendente', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/perfil')
  await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible()
  // v9.5b: no novo visual as partes do perfil começam fechadas (decisão do Presidente): abre "Dados cadastrais"
  await page.getByRole('button', { name: 'Dados cadastrais' }).click()
  await page
    .getByRole('button', { name: 'Confirmo que meus dados estão corretos' })
    .click()
  await expect(
    page.locator(AVISO).filter({ hasText: 'Dados confirmados em' }),
  ).toBeVisible()
  await ver(page, info, 'dados confirmados no meu perfil')
  await page.goto('/auditoria')
  await expect(
    page.locator('[data-acao="DADOS_CONFIRMADOS"]').first(),
  ).toBeVisible()
})
