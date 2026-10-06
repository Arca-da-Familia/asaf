import { expect, test } from '@playwright/test'

import {
  atingirQuorum,
  campo,
  entrar,
  escolherPorTexto,
  exigirHomologacao,
  inventariar,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4d — FASE 2 e 2.5 ao vivo: a assembleia de ponta a ponta, pela tela. Criar, convocar, abrir a sessão, credenciar, quórum, votação (com as
// recusas que o sistema tem que fazer), apuração, ocorrência, encerramento e ata.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

let base = ''

test('criar a assembleia: campo obrigatório vazio é recusado; criada, vira rascunho; convocar gera o edital', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/governanca/nova')
  await expect(
    page.getByRole('heading', { name: 'Nova assembleia' }),
  ).toBeVisible()
  // recusa provocada: sem ordem do dia
  await campo(page, 'Tipo *').selectOption({ index: 1 })
  await campo(page, 'Data e hora da 1ª convocação *').fill(
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 16),
  )
  await page
    .getByRole('button', { name: 'Criar assembleia (rascunho)' })
    .click()
  await expect(page).toHaveURL(/\/governanca\/nova$/)
  await expect(
    page.locator('.text-destructive, [role="alert"]').first(),
  ).toBeVisible()
  await ver(page, info, 'assembleia sem ordem do dia: recusada')

  await campo(page, 'Ordem do dia *').fill(
    `Assembleia ${RODADA}: contas do exercício e eleição da diretoria`,
  )
  await campo(page, 'Local físico').fill('Sede de teste, Parauapebas')
  await page
    .getByRole('button', { name: 'Criar assembleia (rascunho)' })
    .click()
  await expect(page).toHaveURL(/\/governanca\/\d+$/)
  base = new URL(page.url()).pathname
  await expect(
    page.getByRole('heading', { name: 'Assembleia Ordinária' }).first(),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Convocar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir sessão' })).toHaveCount(
    0,
  )
  await ver(page, info, 'assembleia criada como rascunho')

  await page.getByRole('button', { name: 'Convocar' }).click()
  await expect(page.getByRole('button', { name: 'Abrir sessão' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ver edital' })).toBeVisible()
  await ver(page, info, 'assembleia convocada')
  await page.getByRole('button', { name: 'Ver edital' }).click()
  await expect(
    page.getByText(/contas do exercício e eleição da diretoria/).first(),
  ).toBeVisible()
  await ver(page, info, 'edital da convocacao')
  expect(vigia.problemas()).toEqual([])
})

test('sessão: chamada (credenciar, saída, código), quórum e a votação barrada sem quórum', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto(base)
  await page.getByRole('button', { name: 'Abrir sessão' }).click()
  await expect(
    page.getByRole('button', { name: 'Encerrar sessão' }),
  ).toBeVisible()
  await page.goto(`${base}/sessao`)
  await expect(page.getByRole('heading', { name: /Chamada/ })).toBeVisible()
  await expect(page.getByText('Não atingido')).toBeVisible()
  await ver(page, info, 'sessao aberta: quorum nao atingido')

  // código de chamada (para a autochamada pelo celular)
  await page.getByRole('button', { name: 'Mostrar código de chamada' }).click()
  await expect(page.getByText(/^\d{6}$/).first()).toBeVisible()
  await ver(page, info, 'codigo de chamada exibido')

  // credenciar, registrar saída e credenciar de novo
  await escolherPorTexto(page.getByLabel('Associado').first(), 'Marta Souza')
  await page.getByRole('button', { name: 'Credenciar' }).first().click()
  await expect(
    page.getByRole('heading', { name: /Presentes \(1\)/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Registrar saída' }).click()
  await expect(
    page.getByRole('heading', { name: /Presentes \(0\)/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /Saíram \(1\)/ }),
  ).toBeVisible()
  await ver(page, info, 'presidente saiu: sai de Presentes e vai para Saíram')
  // quem saiu volta pela própria tela (reabre o mesmo credenciamento) e o quórum acompanha
  await page.getByRole('button', { name: 'Registrar retorno' }).click()
  await expect(
    page.getByRole('heading', { name: /Presentes \(1\)/ }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: /Saíram/ })).toHaveCount(0)
  // credenciar quem JÁ está presente é recusado
  await escolherPorTexto(page.getByLabel('Associado').first(), 'Marta Souza')
  await page.getByRole('button', { name: 'Credenciar' }).first().click()
  await expect(
    page.getByText('Associado já está credenciado e presente nesta sessão.'),
  ).toBeVisible()
  await ver(page, info, 'presidente de volta; credenciar de novo e recusado')

  // pauta + votação ANTES do quórum: o sistema recusa
  await page.getByLabel('Título').first().fill('Aprovação das contas de 2026')
  await page.getByLabel('Tempo (min)').fill('10')
  await page
    .getByLabel('Descrição')
    .first()
    .fill('Votação do parecer do Conselho Fiscal')
  await page.getByRole('button', { name: 'Adicionar item' }).click()
  await expect(
    page.getByText('Aprovação das contas de 2026').first(),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Abrir votação' }).first().click()
  await page.getByRole('button', { name: 'Abrir votação' }).last().click()
  await page.getByLabel('Título').last().fill('Aprovação das contas de 2026')
  await page.getByLabel('Opções (separadas por vírgula)').fill('Sim, Não')
  await page.getByRole('button', { name: 'Abrir votação' }).last().click()
  await expect(
    page.getByText(/Quórum de instalação não atingido/),
  ).toBeVisible()
  await ver(page, info, 'votacao barrada sem quorum (Art. 6)')
  expect(vigia.problemas()).toEqual([])
})

test('quórum atingido: vota, voto repetido recusado, apura e encerra votação, item e sessão; ocorrência registrada', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto(`${base}/sessao`)
  await expect(page.getByRole('heading', { name: /Chamada/ })).toBeVisible()
  const minimo = await atingirQuorum(page)
  await expect(page.getByText('Atingido', { exact: true })).toBeVisible()
  await ver(page, info, `quorum atingido (${minimo} credenciados)`)

  // abre a votação (o item já está "em votação" desde a tentativa anterior; só falta criar a votação)
  const abrirDoItem = page.getByRole('button', { name: 'Abrir votação' })
  if ((await page.getByLabel('Opções (separadas por vírgula)').count()) === 0) {
    await abrirDoItem.last().click()
  }
  await page.getByLabel('Título').last().fill('Aprovação das contas de 2026')
  await page.getByLabel('Opções (separadas por vírgula)').fill('Sim, Não')
  await page.getByRole('button', { name: 'Abrir votação' }).last().click()
  await expect(
    page.getByRole('button', { name: 'Apurar e encerrar votação' }),
  ).toBeVisible()
  await ver(page, info, 'votacao aberta com quorum')

  // quem não está na sala não vota: o Secretário de teste (Daniel) sai, tenta votar e é recusado; depois volta
  const linhaDoDaniel = page
    .locator('div.rounded-md')
    .filter({ hasText: 'Daniel Ribeiro Costa' })
    .filter({ has: page.getByRole('button', { name: 'Registrar saída' }) })
  await linhaDoDaniel.getByRole('button', { name: 'Registrar saída' }).click()
  await expect(
    page.getByRole('heading', { name: /Saíram \(1\)/ }),
  ).toBeVisible()
  await sair(page)
  await entrar(page, 'secretario')
  await page.goto(`${base}/sessao`)
  await page.getByLabel('Sua opção de voto').first().selectOption('Sim')
  await page.getByRole('button', { name: 'Votar', exact: true }).first().click()
  await expect(
    page.getByText(/não está presente na sessão/).first(),
  ).toBeVisible()
  await ver(page, info, 'voto de quem saiu da sala: recusado')
  await sair(page)
  await entrar(page, 'presidente')
  await page.goto(`${base}/sessao`)
  await page
    .locator('div.rounded-md')
    .filter({ hasText: 'Daniel Ribeiro Costa' })
    .getByRole('button', { name: 'Registrar retorno' })
    .click()
  await expect(page.getByRole('heading', { name: /Saíram/ })).toHaveCount(0)

  await page.getByLabel('Sua opção de voto').first().selectOption('Sim')
  await page.getByRole('button', { name: 'Votar', exact: true }).first().click()
  // voto repetido: o sistema recusa
  await page.getByLabel('Sua opção de voto').first().selectOption('Não')
  await page.getByRole('button', { name: 'Votar', exact: true }).first().click()
  await expect(
    page.getByText('Associado já votou nesta votação.'),
  ).toBeVisible()
  await ver(page, info, 'voto repetido recusado')

  await page.getByRole('button', { name: 'Apurar e encerrar votação' }).click()
  await expect(page.getByText(/Hash de integridade/)).toBeVisible()
  await ver(page, info, 'votacao apurada com hash de integridade')

  // ocorrência
  await page
    .getByLabel('Descrição')
    .last()
    .fill('Sem intercorrências durante a votação')
  await page.getByRole('button', { name: 'Registrar ocorrência' }).click()
  await expect(
    page.getByText('Sem intercorrências durante a votação'),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Encerrar item' }).first().click()
  await ver(page, info, 'item da pauta encerrado')
  await page.goto(base)
  await page.getByRole('button', { name: 'Encerrar sessão' }).click()
  await expect(
    page.getByRole('button', { name: 'Encerrar sessão' }),
  ).toHaveCount(0)
  await ver(page, info, 'sessao encerrada')

  await page.goto(`${base}/ata`)
  await expect(page.getByRole('heading', { name: /Ata/ }).first()).toBeVisible()
  await page.waitForTimeout(1500)
  await inventariar(page, info, 'ata-depois-de-encerrar').catch(() => undefined)
  await ver(page, info, 'ata depois de encerrar a sessao')
  expect(vigia.problemas()).toEqual([])
})
