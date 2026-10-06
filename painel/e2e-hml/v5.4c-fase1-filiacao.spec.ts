import { expect, test } from '@playwright/test'

import {
  API_HML,
  cadastrarPelaTela,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4c — FASE 1 (v1.2) ao vivo: a caixa de propostas de filiação. O formulário público do site (que faz a proposta) só nasce na v5.5; até
// lá a proposta entra pela MESMA rota pública que o site vai usar (sem login), e tudo o que a diretoria faz com ela é pela tela.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const base = (k: number) => 700000000 + ((RODADA + k * 7919) % 200000000)
const A = {
  nome_completo: `Candidata Aprovada ${RODADA} de Teste`,
  cpf: cpfValido(base(1)).replace(/\D/g, ''),
  email_contato: `candidata.${RODADA}@homologacao.example.com`,
  telefone_whatsapp: '91977776666',
}
const B = {
  nome_completo: `Candidato Recusado ${RODADA} de Teste`,
  cpf: cpfValido(base(2)).replace(/\D/g, ''),
  email_contato: `candidato.${RODADA}@homologacao.example.com`,
  telefone_whatsapp: '91966665555',
}
// mesmo nome e mesmo e-mail de um associado que JÁ EXISTE (criado pela tela no começo do primeiro teste, com nome único desta rodada): o
// sistema tem que desconfiar
const C = {
  nome_completo: `Parecida Robo ${RODADA} de Teste`,
  cpf: cpfValido(base(3)).replace(/\D/g, ''),
  email_contato: `parecida.${RODADA}@homologacao.example.com`,
  telefone_whatsapp: '91955554444',
}

test('as propostas entram pela rota pública e aparecem na caixa; proposta repetida é barrada', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await cadastrarPelaTela(page, {
    nome: C.nome_completo,
    cpf: cpfValido(base(9)),
    email: C.email_contato,
    telefone: C.telefone_whatsapp,
  })
  for (const proposta of [A, B, C]) {
    const r = await page.request.post(`${API_HML}/api/filiacao/propor`, {
      data: proposta,
    })
    expect(r.status(), await r.text()).toBe(200)
  }
  // recusa provocada: o mesmo CPF não abre uma segunda proposta enquanto a primeira está em andamento
  const repetida = await page.request.post(`${API_HML}/api/filiacao/propor`, {
    data: A,
  })
  expect(repetida.status()).toBe(400)
  expect(await repetida.text()).toContain('proposta em andamento')

  await page.goto('/associados/propostas')
  await expect(
    page.getByRole('heading', { name: 'Propostas de filiação' }),
  ).toBeVisible()
  for (const p of [A, B, C]) {
    const item = page.getByRole('listitem', {
      name: `Proposta de ${p.nome_completo}`,
    })
    await expect(item.first()).toBeVisible()
  }
  await expect(
    page
      .getByRole('listitem', { name: `Proposta de ${A.nome_completo}` })
      .getByText('Pendente', { exact: true }),
  ).toBeVisible()
  await ver(page, info, 'caixa de propostas com tres pendentes')
  expect(vigia.problemas()).toEqual([])
})

test('recusar: sem motivo é barrado; com motivo a proposta vira Recusada e o motivo fica visível', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/associados/propostas')
  const item = page.getByRole('listitem', {
    name: `Proposta de ${B.nome_completo}`,
  })
  await item.getByRole('button', { name: 'Recusar proposta' }).click()
  await item.getByRole('button', { name: 'Confirmar recusa' }).click()
  await expect(item.getByRole('alert')).toContainText(
    'Informe o motivo da recusa.',
  )
  await ver(page, info, 'recusa sem motivo barrada')

  await item.getByLabel('Motivo da recusa *').fill('Documentação ilegível')
  await item.getByRole('button', { name: 'Confirmar recusa' }).click()
  await expect(item.getByText('Recusada', { exact: true })).toBeVisible()
  await expect(item).toContainText('Motivo da recusa: Documentação ilegível')
  await ver(page, info, 'proposta recusada com o motivo')
})

test('aprovar: só depois de conferir a documentação; efetiva o associado e abre o cadastro dele', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/associados/propostas')
  const item = page.getByRole('listitem', {
    name: `Proposta de ${A.nome_completo}`,
  })
  // ainda não conferida: não dá para aprovar
  await expect(
    item.getByRole('button', { name: 'Aprovar e efetivar' }),
  ).toHaveCount(0)
  await item
    .getByRole('button', { name: 'Marcar documentação conferida' })
    .click()
  await expect(item.getByText('Em Conferência', { exact: true })).toBeVisible()
  await ver(page, info, 'documentacao conferida')

  await item.getByRole('button', { name: 'Aprovar e efetivar' }).click()
  await item.getByRole('button', { name: 'Efetivar associado' }).click()
  await expect(item.getByText('Aprovada', { exact: true })).toBeVisible()
  await expect(item.getByRole('status')).toContainText('Matrícula')
  await ver(page, info, 'proposta aprovada com a matricula')

  await item
    .getByRole('link', { name: 'Abrir o cadastro do associado' })
    .click()
  await expect(page).toHaveURL(/\/associados\/\d+$/)
  await expect(
    page.getByRole('heading', { name: A.nome_completo }),
  ).toBeVisible()
  await ver(page, info, 'cadastro do associado criado pela aprovacao')
})

test('cadastro parecido: o Secretário não consegue forçar; o Presidente consegue, sabendo o que faz', async ({
  page,
}, info) => {
  // Secretário prepara (confere) e tenta aprovar: o sistema desconfia (mesmo nome e e-mail de quem já é associado)
  await entrar(page, 'secretario')
  await page.goto('/associados/propostas')
  const comoSecretario = page.getByRole('listitem', {
    name: `Proposta de ${C.nome_completo}`,
  })
  await comoSecretario
    .getByRole('button', { name: 'Marcar documentação conferida' })
    .click()
  await expect(
    comoSecretario.getByText('Em Conferência', { exact: true }),
  ).toBeVisible()
  await comoSecretario
    .getByRole('button', { name: 'Aprovar e efetivar' })
    .click()
  await comoSecretario
    .getByRole('button', { name: 'Efetivar associado' })
    .click()
  await expect(comoSecretario.getByRole('alert')).toContainText(
    'Já existe um cadastro parecido',
  )
  await expect(
    comoSecretario.getByRole('button', { name: /Aprovar mesmo assim/ }),
  ).toHaveCount(0)
  await expect(comoSecretario).toContainText('Só quem tem a permissão')
  await ver(page, info, 'Secretario barrado: cadastro parecido')
  await sair(page)

  // Presidente: mesma proposta, o sistema também desconfia, mas ele pode confirmar que é outra pessoa
  await entrar(page, 'presidente')
  await page.goto('/associados/propostas')
  const comoPresidente = page.getByRole('listitem', {
    name: `Proposta de ${C.nome_completo}`,
  })
  await comoPresidente
    .getByRole('button', { name: 'Aprovar e efetivar' })
    .click()
  await comoPresidente
    .getByRole('button', { name: 'Efetivar associado' })
    .click()
  await expect(comoPresidente.getByRole('alert')).toContainText(
    'Já existe um cadastro parecido',
  )
  await comoPresidente
    .getByRole('button', { name: /Aprovar mesmo assim/ })
    .click()
  await expect(
    comoPresidente.getByText('Aprovada', { exact: true }),
  ).toBeVisible()
  await ver(page, info, 'Presidente aprova mesmo assim')

  // fica na Auditoria que o cadastro duplicado foi forçado, e por quem
  await page.goto('/auditoria')
  await expect(
    page.getByRole('cell', { name: 'CADASTRO_DUPLICADO_FORCADO' }).first(),
  ).toBeVisible()
  await ver(page, info, 'auditoria registra o cadastro forcado')
})
