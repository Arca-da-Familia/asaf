import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, inventariar, ver, vigiar } from './apoio'

// v5.4d — FASE 2 e 2.5 (governança) ao vivo, passo 0: cada tela da governança abre sem erro e fica inventariada (o que ela oferece de verdade na
// homologação), para o roteiro de cada fluxo ser escrito sobre o que existe e não sobre o que se supõe.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const TELAS: { nome: string; caminho: string; titulo: RegExp }[] = [
  { nome: 'assembleias', caminho: '/governanca', titulo: /Assembleias/ },
  {
    nome: 'nova-assembleia',
    caminho: '/governanca/nova',
    titulo: /Nova assembleia/,
  },
  { nome: 'peticoes', caminho: '/governanca/peticoes', titulo: /peti/i },
  { nome: 'atas', caminho: '/governanca/atas', titulo: /Atas/ },
  { nome: 'mandatos', caminho: '/governanca/mandatos', titulo: /Mandatos/ },
  {
    nome: 'disciplina',
    caminho: '/governanca/disciplina',
    titulo: /disciplin/i,
  },
  { nome: 'dissolucao', caminho: '/governanca/dissolucao', titulo: /dissolu/i },
  { nome: 'calendario', caminho: '/calendario', titulo: /calend/i },
  {
    nome: 'conselho-fiscal',
    caminho: '/financeiro/conselho-fiscal',
    titulo: /Conselho Fiscal/,
  },
  {
    nome: 'minhas-assembleias',
    caminho: '/minhas-assembleias',
    titulo: /assembleias/i,
  },
  {
    nome: 'meus-processos',
    caminho: '/meus-processos-disciplinares',
    titulo: /processos/i,
  },
]

for (const tela of TELAS) {
  test(`abre sem erro: ${tela.nome}`, async ({ page }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(tela.caminho)
    await expect(
      page.getByRole('heading', { name: tela.titulo }).first(),
    ).toBeVisible()
    await inventariar(page, info, tela.nome)
    await ver(page, info, tela.nome)
    expect(vigia.problemas()).toEqual([])
  })
}

test('detalhe, sessão e ata da assembleia convocada abrem sem erro e ficam inventariados', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/governanca')
  // a lista é uma tabela que chega depois do "Carregando": espera a primeira assembleia (o link é o tipo dela) e lê o endereço
  const primeira = page
    .getByRole('link', { name: /Ordinária|Extraordinária/ })
    .first()
  await expect(primeira).toBeVisible()
  const destino = await primeira.getAttribute('href')
  expect(destino).toMatch(/^\/governanca\/\d+$/)
  const base = destino!.replace(/\/(sessao|ata)$/, '')
  for (const [nome, caminho] of [
    ['assembleia-detalhe', base],
    ['assembleia-sessao', `${base}/sessao`],
    ['assembleia-ata', `${base}/ata`],
  ] as const) {
    await page.goto(caminho)
    await expect(page.locator('h1').first()).toBeVisible()
    await inventariar(page, info, nome)
    await ver(page, info, nome)
  }
  expect(vigia.problemas()).toEqual([])
})

const FORMULARIOS: { nome: string; caminho: string; botao: string | RegExp }[] =
  [
    {
      nome: 'mandato-registrar',
      caminho: '/governanca/mandatos',
      botao: 'Registrar mandato',
    },
    {
      nome: 'mandato-encerrar',
      caminho: '/governanca/mandatos',
      botao: 'Encerrar mandato',
    },
    {
      nome: 'mandato-conflito',
      caminho: '/governanca/mandatos',
      botao: 'Declarar conflito',
    },
    {
      nome: 'peticao-propor',
      caminho: '/governanca/peticoes',
      botao: 'Propor petição',
    },
    {
      nome: 'disciplina-abrir',
      caminho: '/governanca/disciplina',
      botao: 'Abrir processo',
    },
    {
      nome: 'dissolucao-abrir',
      caminho: '/governanca/dissolucao',
      botao: 'Abrir processo',
    },
    {
      nome: 'calendario-agendar',
      caminho: '/calendario',
      botao: 'Agendar evento',
    },
    {
      nome: 'parecer-emitir',
      caminho: '/financeiro/conselho-fiscal',
      botao: 'Emitir parecer',
    },
  ]

for (const f of FORMULARIOS) {
  test(`formulário abre: ${f.nome}`, async ({ page }, info) => {
    const vigia = vigiar(page)
    await entrar(page, 'presidente')
    await page.goto(f.caminho)
    await page.getByRole('button', { name: f.botao }).first().click()
    await page.waitForTimeout(800)
    await inventariar(page, info, `form-${f.nome}`)
    await ver(page, info, `form ${f.nome}`)
    expect(vigia.problemas()).toEqual([])
  })
}
