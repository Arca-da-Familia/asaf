import { expect, test } from '@playwright/test'

import { entrar, exigirHomologacao, ver } from './apoio'

// v7.3e - OS SERVIÇOS DE CONSULTA NO INVENTÁRIO: o Minha Receita (recebe só o CNPJ do fornecedor) na atividade de fornecedores e a lista dos serviços, com o
// ViaCEP marcado como sem uso (nenhuma tela o chama). Só leitura: nenhum fornecedor é validado aqui (a trava do CPF é provada na suíte do servidor).
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

test('o inventário mostra os serviços de consulta', async ({ page }, info) => {
  await entrar(page, 'presidente')
  await page.goto('/privacidade/inventario')
  const cartao = page.getByRole('region', { name: 'Fornecedores' })
  await expect(cartao.locator('[data-consulta="MINHA_RECEITA"]')).toContainText(
    'Minha Receita (minhareceita.org) (serviço de consulta, sem contrato): recebe só o CNPJ do fornecedor',
    { timeout: 30_000 },
  )
  const lista = page.getByTestId('servicos-de-consulta')
  await expect(lista).toContainText('ViaCEP (viacep.com.br): recebe só o CEP')
  await expect(lista).toContainText(
    'nenhuma tela do painel nem do site a usa hoje',
  )
  await lista.scrollIntoViewIfNeeded()
  await ver(page, info, 'servicos-de-consulta')
})
