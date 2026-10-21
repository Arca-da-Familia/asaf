import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import {
  TOKEN_DE_DESCADASTRO,
  TOKEN_JA_DESCADASTRADO,
} from '../scripts/mock-api.mjs'

// v6.2b - a página /descadastrar/: o link do fim dos e-mails que se podem desligar. Ela lê o token no navegador, mostra o tipo de e-mail e se a pessoa recebe (nada
// que a identifique), e só muda quando a pessoa clica; o mesmo link deixa voltar a receber. Fora do Google e do sitemap. O mock reconhece dois tokens.

test.describe('a página do link "não quero mais receber"', () => {
  test('mostra o tipo de e-mail, para de receber ao clicar e deixa voltar', async ({
    page,
  }) => {
    await page.goto(`/descadastrar/?token=${TOKEN_DE_DESCADASTRO}`)
    const situacao = page.locator('[data-situacao]')
    await expect(situacao).toHaveText(
      'Você recebe este tipo de e-mail da ASAF: Avisos do mural da ASAF que não são obrigatórios (por e-mail).',
    )
    await expect(page.locator('[data-obrigatorias]')).toContainText(
      'A convocação de assembleia e a mudança de regra são comunicações obrigatórias',
    )
    const acessibilidade = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(acessibilidade.violations).toEqual([])

    await page.getByRole('button', { name: 'Não quero mais receber' }).click()
    await expect(page.locator('[data-resultado]')).toContainText(
      'você não receberá mais este tipo de e-mail',
    )
    await expect(situacao).toContainText('Você NÃO recebe mais')
    await expect(
      page.getByRole('button', { name: 'Não quero mais receber' }),
    ).toBeHidden()

    await page.getByRole('button', { name: 'Quero voltar a receber' }).click()
    await expect(page.locator('[data-resultado]')).toHaveText(
      'Pronto: você voltará a receber este tipo de e-mail.',
    )
    await expect(situacao).toContainText('Você recebe este tipo de e-mail')
  })

  test('quem já desligou vê o botão de voltar a receber', async ({ page }) => {
    await page.goto(`/descadastrar/?token=${TOKEN_JA_DESCADASTRADO}`)
    await expect(page.locator('[data-situacao]')).toContainText(
      'Você NÃO recebe mais este tipo de e-mail da ASAF: Lembretes de mensalidade.',
    )
    await expect(
      page.getByRole('button', { name: 'Quero voltar a receber' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Não quero mais receber' }),
    ).toBeHidden()
  })

  test('sem token, token torto ou token que o servidor não reconhece', async ({
    page,
  }) => {
    await page.goto('/descadastrar/')
    await expect(
      page.getByText('use o link que vem no fim do próprio e-mail da ASAF'),
    ).toBeVisible()
    await page.goto('/descadastrar/?token=<script>alert(1)</script>')
    await expect(
      page
        .getByText('Este link não é válido ou está incompleto')
        .filter({ visible: true }),
    ).toBeVisible()
    await page.goto(
      '/descadastrar/?token=999.avisos.0123456789abcdef0123456789abcdef',
    )
    await expect(
      page
        .getByText('Este link não é válido ou está incompleto')
        .filter({ visible: true }),
    ).toBeVisible()
  })

  test('fica fora do Google e do sitemap', async ({ page, request }) => {
    await page.goto(`/descadastrar/?token=${TOKEN_DE_DESCADASTRO}`)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    )
    const sitemap = await (await request.get('/sitemap-0.xml')).text()
    expect(sitemap).not.toContain('/descadastrar')
  })
})

test('a Política de Privacidade 2.5 diz como parar de receber os e-mails da ASAF', async ({
  page,
}) => {
  await page.goto('/privacidade/')
  const trecho = page.locator('[data-emails-da-asaf]')
  await expect(trecho).toContainText(
    'trazem no fim um link para parar de receber aquele tipo de mensagem',
  )
  await expect(trecho).toContainText(
    'A convocação de assembleia e a mudança de regra são comunicações obrigatórias',
  )
  await expect(trecho).toContainText(
    'O sistema não registra se você abriu o e-mail.',
  )
})
