import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, RODADA, ver } from './apoio'

// v7.4b - O REGISTRO DE INCIDENTES (decisões do Presidente, 30/10): o plano de resposta com os 3 dias úteis; o precedente nº 1 (o e-mail nos registros públicos,
// registrado pela migração); o Presidente faz um ENSAIO (registra, tenta encerrar sem completar e é recusado, completa e encerra) e a Auditoria registra; o
// 1º Vice-Presidente lê o registro, sem o formulário.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const TITULO = `Ensaio do robô ${RODADA}`

test('o Presidente faz o ensaio anual pelo registro de incidentes', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/privacidade/incidentes')
  await expect(
    page.getByRole('region', { name: 'Plano de resposta' }),
  ).toContainText('Comunicar em até 3 dias úteis', { timeout: 30_000 })
  const precedente = page.getByRole('listitem', { name: 'Incidente nº 1' })
  await expect(precedente).toContainText('registrado depois, como precedente')
  await expect(precedente).toContainText('Sem risco relevante')
  await ver(page, info, 'plano-e-precedente')

  const form = page.getByRole('form', { name: 'Registrar incidente' })
  await form.getByLabel('Título').fill(TITULO)
  await form
    .getByLabel('O que aconteceu')
    .fill(
      'Simulação: a lista de inscritos de um evento foi enviada a outra pessoa.',
    )
  await form.getByLabel('Quando a associação soube').fill('2026-11-02T09:00')
  await form.getByRole('checkbox').check()
  await form.getByRole('button', { name: 'Registrar' }).click()

  const cartao = page.getByRole('listitem').filter({ hasText: TITULO })
  await expect(cartao).toContainText(
    'Ensaio: não se comunica a ninguém de fora',
    {
      timeout: 30_000,
    },
  )
  await cartao.getByRole('button', { name: 'Completar o registro' }).click()
  await cartao.getByRole('button', { name: 'Salvar e encerrar' }).click()
  await expect(cartao.getByRole('alert')).toContainText('Para encerrar falta')
  await cartao
    .getByLabel('Avaliação do risco às pessoas')
    .selectOption('RELEVANTE')
  await cartao
    .getByLabel('Por que o risco é (ou não é) relevante')
    .fill('Simulado: contato de inscritos, inclusive de famílias com crianças.')
  await cartao
    .getByLabel('O que foi feito para conter')
    .fill('Simulado: pedimos a exclusão e trocamos a rotina de envio.')
  await cartao
    .getByLabel('Lição aprendida')
    .fill('O passo a passo funcionou; conferir o destinatário antes de enviar.')
  await cartao.getByRole('button', { name: 'Salvar e encerrar' }).click()
  await expect(cartao).toHaveAttribute('data-situacao', 'ENCERRADO', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('ensaio-anual')).toHaveAttribute(
    'data-pendente',
    'nao',
  )
  await ver(page, info, 'ensaio-encerrado')

  await page.goto('/auditoria')
  await expect(
    page.getByRole('cell', { name: 'INCIDENTE_ENCERRADO' }).first(),
  ).toBeVisible({ timeout: 30_000 })
  await ver(page, info, 'auditoria-do-incidente')
})

test('o 1º Vice-Presidente lê o registro, sem o formulário', async ({
  page,
}, info) => {
  await entrar(page, 'vice_presidente')
  await page.goto('/privacidade/incidentes')
  await expect(
    page.getByRole('listitem', { name: 'Incidente nº 1' }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByRole('form', { name: 'Registrar incidente' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Completar o registro' }),
  ).toHaveCount(0)
  await ver(page, info, 'vice-so-le')
})
