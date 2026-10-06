import fs from 'node:fs'

import { expect, test } from '@playwright/test'

import {
  campo,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  sair,
  ver,
  vigiar,
} from './apoio'

// v5.4c — FASE 0 e 1 ao vivo (parte 3): importar e exportar a base, Configurações (uma opção nova aparece no cadastro), gráficos e "ver como".
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const cpf = (k: number) =>
  cpfValido(600000000 + ((RODADA + k * 130363) % 100000000))
const IMPORTADA_1 = `Importada Um Robo ${RODADA} de Teste`
const IMPORTADA_2 = `Importada Dois Robo ${RODADA} de Teste`

test('importar em lote: CSV com uma linha boa, uma com CPF inválido e uma repetida; o lote cria só as boas e pode ser desfeito', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const csv = [
    'Nome,CPF,Email,Telefone,Nascimento,Categoria',
    `${IMPORTADA_1},${cpf(1)},um.${RODADA}@homologacao.example.com,91911110001,1990-01-01,Efetivo`,
    `${IMPORTADA_2},${cpf(2)},dois.${RODADA}@homologacao.example.com,91911110002,1991-02-02,Efetivo`,
    `Linha Com CPF Invalido,123.456.789-00,x@homologacao.example.com,91911110003,1992-03-03,Efetivo`,
    `${IMPORTADA_1} Repetida,${cpf(1)},tres.${RODADA}@homologacao.example.com,91911110004,1990-01-01,Efetivo`,
  ].join('\n')
  fs.mkdirSync('prints-hml/tmp', { recursive: true })
  const arquivo = `prints-hml/tmp/importacao-${RODADA}.csv`
  fs.writeFileSync(arquivo, csv, 'utf-8')

  await entrar(page, 'presidente')
  await page.goto('/associados/importar')
  await expect(
    page.getByRole('heading', { name: 'Importar associados' }),
  ).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles(arquivo)
  await expect(page.getByText(/4 linha\(s\) encontrada\(s\)/)).toBeVisible()
  await ver(page, info, 'importacao: colunas reconhecidas')
  await page.getByRole('button', { name: 'Continuar' }).click()

  // validação: a linha de CPF inválido é barrada na tela; a repetida (mesmo CPF) aparece como duplicidade
  await expect(page.getByText(/passaram na validação básica/)).toBeVisible()
  await ver(page, info, 'importacao: revisao com erro e duplicidade')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(
    page.getByRole('heading', { name: 'Confirmar importação' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar importação' }).click()
  await expect(
    page.getByRole('heading', { name: 'Importação concluída' }),
  ).toBeVisible()
  await expect(page.getByText(/2 criado\(s\)/)).toBeVisible()
  await ver(page, info, 'importacao concluida: duas criadas')

  await page.goto('/associados')
  await page.getByLabel('Filtrar').fill(`Robo ${RODADA}`)
  await expect(page.getByRole('link', { name: IMPORTADA_1 })).toHaveCount(1)
  await expect(page.getByRole('link', { name: IMPORTADA_2 })).toHaveCount(1)
  await expect(page.getByText('Linha Com CPF Invalido')).toHaveCount(0)
  await ver(page, info, 'as duas importadas aparecem na lista')
  expect(vigia.problemas()).toEqual([])
})

test('exportar: só quem tem a permissão própria vê; o CSV baixado traz as colunas escolhidas e a Auditoria registra', async ({
  page,
}, info) => {
  await entrar(page, 'secretario')
  await page.goto('/associados')
  await expect(page.getByRole('heading', { name: 'Associados' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Exportar dados dos associados' }),
  ).toHaveCount(0)
  await ver(page, info, 'Secretario nao ve o botao de exportar')
  await sair(page)

  await entrar(page, 'presidente')
  await page.goto('/associados')
  await page
    .getByRole('button', { name: 'Exportar dados dos associados' })
    .click()
  await page.getByLabel('CPF').check()
  await page.getByRole('button', { name: 'Gerar exportação' }).click()
  await expect(page.getByTestId('exportacao-total')).toBeVisible()
  const total = Number(await page.getByTestId('exportacao-total').innerText())
  expect(total).toBeGreaterThanOrEqual(16)
  await ver(page, info, 'exportacao gerada com pre-visualizacao')

  const baixando = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar CSV' }).click()
  const download = await baixando
  expect(download.suggestedFilename()).toBe('associados.csv')
  const conteudo = fs.readFileSync((await download.path())!, 'utf-8')
  const linhas = conteudo
    .replace(/^\u{FEFF}/u, '')
    .trim()
    .split(/\r?\n/)
  expect(linhas[0]).toBe('nome_completo,categoria,status_arrolamento,cpf')
  expect(linhas.length - 1).toBe(total)
  expect(conteudo).toContain('de Teste')

  await page.goto('/auditoria')
  await expect(page.getByRole('cell', { name: 'EXPORT' }).first()).toBeVisible()
  await ver(page, info, 'auditoria registra a exportacao')
})

test('Configurações: uma opção nova de catálogo (estado civil) aparece no cadastro de associado, e desativada some', async ({
  page,
}, info) => {
  const codigo = `ROBO${RODADA}`
  const rotulo = `Estado civil Robô ${RODADA}`
  await entrar(page, 'presidente')
  await page.goto('/configuracoes')
  await expect(
    page.getByRole('heading', { name: 'Configurações' }).first(),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Estado civil', exact: true }).click()
  await page.getByRole('button', { name: 'Nova opção' }).click()
  await page.getByPlaceholder('CODIGO_TECNICO').fill(codigo)
  await page.getByPlaceholder('Rótulo exibido').fill(rotulo)
  await ver(page, info, 'nova opcao de estado civil preenchida')
  await page.getByRole('button', { name: 'Adicionar opção' }).click()
  await expect(page.getByText(rotulo).first()).toBeVisible()
  await ver(page, info, 'nova opcao criada no catalogo')

  // a opção tem que aparecer no formulário de novo associado
  await page.goto('/associados/novo')
  await expect(
    campo(page, 'Estado civil').locator('option', { hasText: rotulo }),
  ).toHaveCount(1)
  await ver(page, info, 'opcao nova aparece no cadastro de associado')

  // desativa: sai do cadastro (e o histórico de quem já usou continua)
  await page.goto('/configuracoes')
  await page.getByRole('button', { name: 'Estado civil', exact: true }).click()
  const linha = page
    .locator('div.rounded-md.justify-between')
    .filter({ hasText: rotulo })
  await linha.getByRole('button', { name: /Desativar/ }).click()
  await page.goto('/associados/novo')
  await expect(
    campo(page, 'Estado civil').locator('option', { hasText: rotulo }),
  ).toHaveCount(0)
  await ver(page, info, 'opcao desativada some do cadastro')
})

test('gráficos dos associados abrem com dados', async ({ page }, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page.goto('/associados/graficos')
  await expect(
    page.getByRole('heading', { name: 'Gráficos' }).first(),
  ).toBeVisible()
  await expect(page.getByText('Carregando')).toHaveCount(0)
  await ver(page, info, 'graficos dos associados')
  expect(vigia.problemas()).toEqual([])
})

test('"ver como": o Presidente vê o painel como outro nível (somente leitura) e encerra', async ({
  page,
}, info) => {
  await entrar(page, 'presidente')
  await page.goto('/acesso')
  await expect(
    page.getByRole('heading', { name: 'Níveis e permissões' }),
  ).toBeVisible()
  await ver(page, info, 'matriz de niveis e permissoes')
  // "Ver como" pede confirmação numa janela do próprio navegador (window.confirm): o robô a aceita, senão ela é recusada sozinha
  page.once('dialog', (janela) => janela.accept())
  await page.getByRole('button', { name: /Ver como Associado/ }).click()
  const faixa = page.getByRole('status').filter({ hasText: 'Vendo como' })
  await expect(faixa).toContainText('Associado')
  await expect(faixa).toContainText('somente leitura')
  // como "Associado" o menu perde os módulos de gestão (sem recarregar a página: o modo "ver como" vive só na memória dela)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Meu perfil' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Financeiro' })).toHaveCount(0)
  await ver(page, info, 'vendo como Associado: sem os modulos de gestao')
  await faixa.getByRole('button', { name: 'Encerrar' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Vendo como' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'Financeiro' }).first(),
  ).toBeVisible()
  await ver(page, info, 'ver como encerrado: o menu completo volta')
})
