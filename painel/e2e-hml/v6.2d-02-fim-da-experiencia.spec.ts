import { expect, test, type Page } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao, ver, vigiar } from './apoio'

// v6.2d - OS AUTOMÁTICOS (parte 2): depois de uma nova publicação da homologação (que, só ali, faz passar os "90 dias" do candidato que o v6.2d-01 aprovou e roda a rotina do
// fim da experiência, como a tarefa periódica faz na produção), o Presidente (que cuida de Associados) vê no sino "Fim do período de experiência", o link abre o cadastro, a
// situação mudou de "Em Experiência" para a de verdade e a Auditoria guarda a mudança pelo sistema.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const PREFIXO = 'Experiencia Encerrada Robo '

async function comoPapel(page: Page): Promise<string> {
  let autorizacao = ''
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
  return autorizacao
}

test('o sino avisa o fim da experiência, o cadastro mostra a situação nova e a Auditoria guarda a mudança', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const token = await comoPapel(page)
  // o candidato MAIS NOVO do robô
  const associados = (await (
    await page.request.get(`${API_HML}/api/associados/`, {
      headers: { Authorization: token },
    })
  ).json()) as Array<{
    id_associado: number
    nome_completo: string
    numero_matricula: number
    status_arrolamento: string
  }>
  const doRobo = associados
    .filter((a) => a.nome_completo.startsWith(PREFIXO))
    .sort((a, b) => b.id_associado - a.id_associado)[0]
  expect(doRobo, 'o candidato aprovado pelo v6.2d-01').toBeTruthy()
  expect(
    doRobo!.status_arrolamento,
    'a publicação da homologação não rodou depois do v6.2d-01 (rode o v6.2d-01, publique a homologação e rode o v6.2d-02)',
  ).not.toBe('Em Experiência')

  await page.getByRole('button', { name: /^Notificações/ }).click()
  const aviso = page.getByRole('link', {
    name: `Fim do período de experiência: matrícula nº ${doRobo!.numero_matricula}`,
  })
  await expect(aviso).toBeVisible()
  await ver(page, info, 'o sino avisa o fim da experiencia')
  await aviso.click()
  await expect(page).toHaveURL(
    new RegExp(`/associados/${doRobo!.id_associado}$`),
  )
  await expect(
    page.getByRole('heading', { name: doRobo!.nome_completo }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Situação', exact: true }).click()
  await expect(page.getByTestId('situacao-atual')).toHaveText(
    doRobo!.status_arrolamento,
  )
  await ver(page, info, 'o cadastro com a situacao nova')

  const { entradas } = (await (
    await page.request.get(
      `${API_HML}/api/auditoria/?tabela_afetada=associados&acao=CATEGORIA_RECALCULADA&por_pagina=50`,
      { headers: { Authorization: token } },
    )
  ).json()) as {
    entradas: Array<{
      id_registro_afetado: number
      id_usuario: number | null
      dados_antes: string
    }>
  }
  const mudanca = entradas.find(
    (e) => e.id_registro_afetado === doRobo!.id_associado,
  )
  expect(mudanca, 'a mudança de situação na Auditoria').toBeTruthy()
  expect(mudanca!.id_usuario, 'quem mudou foi o sistema').toBeNull()
  expect(mudanca!.dados_antes).toContain('Em Experiência')
  expect(vigia.problemas()).toEqual([])
})
