import { expect, test, type Page } from '@playwright/test'

import {
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
} from './apoio'

// v5.4c — FASE 1 ao vivo (parte 2): cadastro parecido, Qualidade da base (duplicados, mesclagem, fila), Vínculos (voluntário, funcionário,
// e-mail suspeito), completude, situação calculada, acesso (segundo passo) e recadastramento. Tudo pela tela do hml-painel.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const cpf = (k: number) =>
  cpfValido(500000000 + ((RODADA + k * 104729) % 150000000))
const MESMO_NOME = `Duplicada Robo ${RODADA} de Teste`
const NASCIMENTO = '1981-04-04'

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
  await campo(page, 'Nome completo *').fill(MESMO_NOME)
  await campo(page, 'CPF *').fill(cpf(2))
  await campo(page, 'E-mail *').fill(
    `duplicada2.${RODADA}@homologacao.example.com`,
  )
  await campo(page, 'Telefone (WhatsApp) *').fill('91911112222')
  await campo(page, 'Categoria *').selectOption({ index: 1 })
  await campo(page, 'Data de nascimento').fill(NASCIMENTO)
  await campo(page, 'CEP *').fill('68515000')
  await campo(page, 'Logradouro *').fill('Rua das Flores de Teste')
  await campo(page, 'Número *').fill('5')
  await campo(page, 'Bairro *').fill('Bairro de Teste')
  await campo(page, 'Cidade *').fill('Parauapebas')
  await campo(page, 'Estado (UF) *').fill('PA')
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

test('qualidade da base: o sistema acha o par; mesclar recusa nome errado e dois associados; ignorar tira da fila', async ({
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

  const par = page
    .getByRole('listitem', {
      name: new RegExp(`Possível cadastro duplicado: ${MESMO_NOME}`),
    })
    .first()
  await expect(par).toBeVisible()
  await expect(par).toContainText('associado, matrícula')
  await ver(page, info, 'par duplicado achado, com as matriculas')

  await par.getByRole('button', { name: 'Mesclar os dois cadastros' }).click()
  const confirmacao = par.getByLabel(
    'Digite o nome de quem será absorvido para confirmar',
  )
  // recusa provocada 1: o nome digitado não confere
  await confirmacao.fill('Fulano de Tal')
  await par.getByRole('button', { name: 'Mesclar (irreversível)' }).click()
  await expect(page.getByRole('alert')).toContainText('não confere')
  await ver(page, info, 'mesclar recusado: nome nao confere')
  // recusa provocada 2: os dois já são associados (o sistema não adivinha qual matrícula prevalece)
  await confirmacao.fill(MESMO_NOME)
  await par.getByRole('button', { name: 'Mesclar (irreversível)' }).click()
  await expect(page.getByRole('alert')).toContainText('já são Associado')
  await ver(page, info, 'mesclar recusado: os dois ja sao associados')

  await par.getByRole('button', { name: 'Não é duplicado — ignorar' }).click()
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
  const par = page
    .getByRole('listitem', {
      name: new RegExp(`Possível cadastro duplicado: ${manter}`),
    })
    .first()
  await expect(par).toBeVisible()
  await expect(par).toContainText('pessoa sem cadastro de associado')
  await par.getByRole('button', { name: 'Mesclar os dois cadastros' }).click()
  // mantém o ASSOCIADO (o lado com matrícula) e absorve a pessoa sem cadastro
  await par.getByLabel(/Manter .*\(associado, matrícula \d+\)/).check()
  await par
    .getByLabel('Digite o nome de quem será absorvido para confirmar')
    .fill(manter)
  await ver(
    page,
    info,
    'mesclagem pronta: mantem o associado e absorve a pessoa',
  )
  await par.getByRole('button', { name: 'Mesclar (irreversível)' }).click()
  await expect(page.locator(AVISO)).toContainText('mescladas com sucesso')
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
  await expect(page.locator(AVISO)).toContainText('Versão 1')
  await expect(page.getByTestId('termo-vigente')).toContainText(
    'Apoio na cozinha comunitária',
  )
  await ver(page, info, 'termo de adesao registrado e vigente')
  await page.getByRole('button', { name: 'Renovar termo de adesão' }).click()
  await page.getByLabel('Atividade *').fill('Apoio na cozinha comunitária')
  await page.getByLabel('Carga horária semanal *').fill('6')
  await page.getByLabel('Fim da vigência *').fill(fim)
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
  await expect(
    page.getByRole('listitem', {
      name: new RegExp(`E-mail suspeito \\(devolveu\\): ${nome}`),
    }),
  ).toBeVisible()
  await ver(page, info, 'email suspeito na fila da qualidade da base')
  await page.goto('/auditoria')
  await expect(
    page.getByRole('cell', { name: 'FUNCIONARIO_CADASTRADO' }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'TERMO_REGISTRADO' }).first(),
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
    page.getByRole('cell', { name: 'MFA_RESET_POR_TERCEIRO' }).first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria registra a redefinicao do segundo passo')
})

test('recadastramento: o associado confirma que os dados continuam corretos e a ficha deixa de dizer pendente', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/perfil')
  await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible()
  await page
    .getByRole('button', { name: 'Confirmo que meus dados estão corretos' })
    .click()
  await expect(
    page.locator(AVISO).filter({ hasText: 'Dados confirmados em' }),
  ).toBeVisible()
  await ver(page, info, 'dados confirmados no meu perfil')
  await page.goto('/auditoria')
  await expect(
    page.getByRole('cell', { name: 'DADOS_CONFIRMADOS' }).first(),
  ).toBeVisible()
})
