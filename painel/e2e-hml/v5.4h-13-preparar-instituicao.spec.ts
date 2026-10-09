import { expect, test, type Page } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao, sair, ver, vigiar } from './apoio'

// v5.4h - preparo para o roteiro v5.4h-14 (o site de teste mostrando a Instituição): a diretoria "preenche" a Instituição de teste PELA TELA, com valores FIXOS e válidos
// (não depende do estado que outro roteiro deixou: o v5.4h-02, por exemplo, alterna o CNPJ), e confere que a rota pública passa a entregar exatamente isso. Depois deste
// roteiro é preciso publicar a homologação de novo (o site de teste lê a API NO BUILD) e só então rodar o v5.4h-14.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

const DADOS: Array<{ rotulo: string; chave: string; valor: string }> = [
  { rotulo: 'CNPJ', chave: 'CNPJ', valor: '11.222.333/0001-81' },
  {
    rotulo: 'Telefone / WhatsApp',
    chave: 'TELEFONE_INSTITUCIONAL',
    valor: '(94) 99999-8888',
  },
  {
    rotulo: 'E-mail de contato',
    chave: 'EMAIL_INSTITUCIONAL',
    valor: 'contato.teste@asaf.org.br',
  },
  {
    rotulo: 'Horário de atendimento',
    chave: 'HORARIO_ATENDIMENTO',
    valor: 'Segunda a sexta, das 8h às 17h',
  },
  { rotulo: 'Instagram', chave: 'SITE_INSTAGRAM', valor: '@asaf.teste' },
  {
    rotulo: 'Facebook',
    chave: 'SITE_FACEBOOK',
    valor: 'https://www.facebook.com/asaf.teste',
  },
]

const quadro = (page: Page, rotulo: string) =>
  page
    .locator('div.rounded-md.border')
    .filter({ has: page.getByLabel(rotulo, { exact: true }) })

test('a diretoria preenche a Instituição pela tela e a rota pública entrega exatamente isso', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  await page
    .getByRole('link', { name: /^Instituição/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Instituição', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)

  for (const d of DADOS) {
    const q = quadro(page, d.rotulo)
    const entrada = q.getByLabel(d.rotulo, { exact: true })
    if ((await entrada.inputValue()) !== d.valor) {
      await entrada.fill(d.valor)
      await q.getByRole('button', { name: 'Salvar', exact: true }).click()
      await expect(q.getByText('Salvo.')).toBeVisible()
    }
    // tem de estar marcado "aparece no site"
    const marca = q.getByLabel('Aparece no site')
    if (!(await marca.isChecked())) {
      await marca.click()
      await expect(marca).toBeChecked()
    }
  }
  await ver(page, info, 'instituicao-preenchida')

  // o que a rota pública entrega é exatamente o que foi preenchido
  await page.reload()
  await expect(page.getByLabel('Nome da instituição')).toBeVisible()
  const r = await page.request.get(`${API_HML}/api/publico/instituicao`)
  expect(r.status()).toBe(200)
  const publico = (await r.json()) as Record<string, string>
  for (const d of DADOS) expect(publico[d.chave], d.chave).toBe(d.valor)
  // o que é só interno nunca sai
  expect(Object.keys(publico)).not.toContain('EMAIL_REMETENTE')
  expect(Object.keys(publico)).not.toContain('TEXTO_PADRAO_DOCUMENTO')
  expect(vigia.problemas()).toEqual([])
  await sair(page)
})
