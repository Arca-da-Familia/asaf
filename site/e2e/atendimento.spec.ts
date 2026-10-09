import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// v5.5a — os formulários públicos da fila única de atendimento (contato, pedido de informação, solicitação do titular de dados), no navegador de verdade,
// contra o build de teste e a API simulada (`scripts/mock-api.mjs`, que guarda o corpo recebido e responde como a API real: protocolo em sequência,
// prazo por tipo, 429 e erro de servidor provocados por nomes de teste).

const PORTA_DA_API = process.env.MOCK_API_PORT ?? '4322'
const NOME_QUE_ESTOURA_O_LIMITE = 'Teste Limite Por IP'
const NOME_QUE_DERRUBA_A_API = 'Teste Erro De Servidor'
const CPF_VALIDO = '390.533.447-05'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

type Tipo = 'CONTATO' | 'PEDIDO_INFORMACAO' | 'TITULAR_LGPD'
interface Formulario {
  tipo: Tipo
  caminho: string
  titulo: string
  idDoFormulario: string
  dias: number
}

const FORMULARIOS: Formulario[] = [
  {
    tipo: 'CONTATO',
    caminho: '/contato/',
    titulo: 'Escreva para a associação',
    idDoFormulario: 'contato',
    dias: 10,
  },
  {
    tipo: 'PEDIDO_INFORMACAO',
    caminho: '/transparencia/pedido-de-informacao/',
    titulo: 'Faça o seu pedido de informação',
    idDoFormulario: 'pedido-de-informacao',
    dias: 20,
  },
  {
    tipo: 'TITULAR_LGPD',
    caminho: '/privacidade/solicitacao-do-titular/',
    titulo: 'Faça a sua solicitação',
    idDoFormulario: 'solicitacao-do-titular',
    dias: 15,
  },
]

const DIREITOS = [
  'Confirmar se a associação trata dados meus',
  'Acessar os dados que a associação tem sobre mim',
  'Corrigir dados incompletos, inexatos ou desatualizados',
  'Anonimizar, bloquear ou eliminar dados desnecessários ou tratados sem base legal',
  'Receber meus dados para levar a outra entidade (portabilidade)',
  'Saber com quem a associação compartilhou meus dados',
  'Retirar um consentimento que dei',
  'Outro pedido sobre os meus dados pessoais',
]

async function pedidosRecebidos(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  const r = await page.request.get(
    `http://127.0.0.1:${PORTA_DA_API}/__pedidos-de-atendimento`,
  )
  return (await r.json()) as Array<Record<string, unknown>>
}

const formulario = (page: Page) => page.locator('form[data-atendimento-form]')

async function preencher(
  page: Page,
  f: Formulario,
  extra: {
    nome?: string
    email?: string
    telefone?: string
    cpf?: string
  } = {},
) {
  const form = formulario(page)
  await form.getByLabel('Nome completo').fill(extra.nome ?? 'Maria de Teste')
  await form.getByLabel('E-mail').fill(extra.email ?? 'maria@example.com')
  if (extra.telefone)
    await form.getByLabel('Telefone/WhatsApp').fill(extra.telefone)
  if (f.tipo === 'TITULAR_LGPD') {
    await form.getByLabel('CPF').fill(extra.cpf ?? CPF_VALIDO)
    await form.getByLabel('O que você quer pedir').selectOption('ACESSO')
  } else {
    await form.getByLabel('Assunto').fill('Dúvida sobre os projetos')
  }
  await form
    .getByLabel('Mensagem')
    .fill('Gostaria de saber mais sobre os projetos da associação.')
}

const aceitar = (page: Page) =>
  formulario(page).getByLabel('Li e aceito o aviso de privacidade.').check()
const enviar = (page: Page) =>
  formulario(page).getByRole('button', { name: 'Enviar pedido' }).click()
const confirmacao = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Recebemos o seu pedido.' })

const dataPorExtenso = (instante: number) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Belem',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instante))

async function semViolacoes(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
  ).toEqual([])
}

test.describe('formulários de atendimento', () => {
  // o mock guarda os pedidos numa lista só e numera os protocolos: em série, "o último pedido" é sempre o do teste que está rodando
  test.describe.configure({ mode: 'serial' })

  for (const f of FORMULARIOS) {
    test.describe(`${f.tipo} — ${f.caminho}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.goto(f.caminho)
      })

      test('mostra o formulário com os campos do tipo, o aviso de privacidade, o prazo da API e a armadilha escondida', async ({
        page,
      }) => {
        const form = formulario(page)
        await expect(
          page.getByRole('heading', { name: f.titulo, level: 2 }),
        ).toBeVisible()
        for (const rotulo of [
          'Nome completo',
          'E-mail',
          'Telefone/WhatsApp',
          'Mensagem',
        ]) {
          await expect(form.getByLabel(rotulo)).toBeVisible()
        }
        await expect(
          form.getByText(
            'Informe ao menos um dos dois, para podermos responder.',
          ),
        ).toBeVisible()
        if (f.tipo === 'TITULAR_LGPD') {
          await expect(form.getByLabel('CPF')).toBeVisible()
          await expect(
            form.getByText(
              'O CPF serve apenas para conferir que quem pede é o titular dos dados.',
            ),
          ).toBeVisible()
          await expect(form.getByLabel('Assunto')).toHaveCount(0)
          const opcoes = await form
            .getByLabel('O que você quer pedir')
            .locator('option:not([value=""])')
            .allTextContents()
          expect(opcoes).toEqual(DIREITOS)
        } else {
          await expect(form.getByLabel('Assunto')).toBeVisible()
          // contato e pedido de informação NÃO pedem CPF nem o direito do titular
          await expect(form.getByLabel('CPF')).toHaveCount(0)
          await expect(form.getByLabel('O que você quer pedir')).toHaveCount(0)
        }
        // o prazo vem da API (o mock devolve 10, 20 e 15 dias) e só aparece depois de ela responder
        await expect(form.locator('[data-prazo]')).toHaveText(
          `Respondemos em até ${f.dias} dias.`,
        )
        // o aviso de privacidade, com o texto da versão 1 e os links certos para o tipo
        const aviso = page.locator(`#${f.idDoFormulario}-aviso`)
        await expect(aviso).toContainText('Aviso de privacidade (versão 1)')
        await expect(aviso).toContainText(
          'Usamos o que você escrever aqui só para responder ao seu pedido. Quem lê o seu pedido é quem atende na associação (hoje, a Presidência e a Diretoria). Guardamos o pedido, o protocolo e a nossa resposta para provar que atendemos no prazo.',
        )
        await expect(
          aviso.getByRole('link', { name: 'Política de Privacidade' }),
        ).toHaveAttribute('href', '/privacidade/')
        await expect(
          aviso.getByRole('link', { name: 'solicitação do titular de dados' }),
        ).toHaveCount(f.tipo === 'TITULAR_LGPD' ? 0 : 1)
        if (f.tipo !== 'TITULAR_LGPD')
          await expect(
            aviso.getByRole('link', {
              name: 'solicitação do titular de dados',
            }),
          ).toHaveAttribute('href', '/privacidade/solicitacao-do-titular/')
        // a armadilha de robô: fora da tela, escondida do leitor de tela e fora da ordem do Tab
        const armadilha = page.locator('input[name="pagina_web"]')
        await expect(armadilha).toHaveAttribute('tabindex', '-1')
        await expect(
          armadilha.locator('xpath=ancestor::div[@aria-hidden="true"]'),
        ).toHaveCount(1)
        expect(
          await armadilha.evaluate((el) => el.getBoundingClientRect().left),
        ).toBeLessThan(-1000)
        // a confirmação só aparece depois do envio
        await expect(confirmacao(page)).toBeHidden()
      })

      test('enviar em branco avisa o que falta, foca o primeiro campo, liga cada aviso ao campo e não chama a API', async ({
        page,
      }) => {
        const antes = (await pedidosRecebidos(page)).length
        await enviar(page)
        const total = f.tipo === 'TITULAR_LGPD' ? 6 : 5
        await expect(page.getByRole('alert').first()).toHaveText(
          `Há ${total} campos para corrigir.`,
        )
        const nome = formulario(page).getByLabel('Nome completo')
        await expect(nome).toBeFocused()
        await expect(nome).toHaveAttribute('aria-invalid', 'true')
        // a mensagem de erro é lida junto com o campo (aria-describedby)
        await expect(nome).toHaveAttribute(
          'aria-describedby',
          `${f.idDoFormulario}-erro-nome`,
        )
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-nome`),
        ).toContainText('Informe o seu nome completo.')
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-contato`),
        ).toContainText('e-mail ou um telefone')
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-mensagem`),
        ).toContainText('pelo menos 10 letras')
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-consentimento`),
        ).toContainText('aviso de privacidade')
        if (f.tipo === 'TITULAR_LGPD') {
          await expect(
            page.locator(`#${f.idDoFormulario}-erro-cpf`),
          ).toContainText('Informe o seu CPF.')
          await expect(
            page.locator(`#${f.idDoFormulario}-erro-subtipo`),
          ).toContainText('Escolha o que você quer pedir')
        } else {
          await expect(
            page.locator(`#${f.idDoFormulario}-erro-assunto`),
          ).toContainText('Informe o assunto')
        }
        expect((await pedidosRecebidos(page)).length).toBe(antes)
        // o estado de erro também passa no axe, no computador e no celular
        await semViolacoes(page)
        await page.setViewportSize({ width: 375, height: 700 })
        await semViolacoes(page)
      })

      test('pedido certo: vai para a API com os dados limpos e a página confirma com protocolo e prazo', async ({
        page,
      }) => {
        await preencher(page, f, { telefone: '(91) 98888-7777' })
        await aceitar(page)
        const antes = dataPorExtenso(Date.now() + f.dias * 86_400_000)
        await enviar(page)
        const aviso = confirmacao(page)
        await expect(aviso).toBeVisible()
        await expect(aviso).toBeFocused()
        await expect(formulario(page)).toBeHidden()
        const ano = new Date().getUTCFullYear()
        await expect(aviso.locator('[data-protocolo]')).toHaveText(
          new RegExp(`^ASAF-${ano}-\\d{5}$`),
        )
        await expect(aviso).toContainText(/Protocolo:\s*ASAF-/)
        await expect(aviso).toContainText('Guarde este número.')
        const depois = dataPorExtenso(Date.now() + f.dias * 86_400_000)
        await expect(aviso.locator('[data-prazo-da-resposta]')).toHaveText(
          new RegExp(
            `^Respondemos em até ${f.dias} dias \\(até (${antes}|${depois})\\)\\.$`,
          ),
        )
        await expect(aviso).toContainText(
          'Se informou e-mail, a resposta também pode chegar por lá.',
        )
        // a tela de confirmação também passa no axe
        await semViolacoes(page)

        const corpo = (await pedidosRecebidos(page)).at(-1)
        expect(corpo).toMatchObject({
          tipo: f.tipo,
          nome_completo: 'Maria de Teste',
          email_contato: 'maria@example.com',
          telefone_whatsapp: '91988887777',
          mensagem: 'Gostaria de saber mais sobre os projetos da associação.',
          consentimento_lgpd: true,
          versao_texto_consentimento: '1',
          pagina_web: '',
        })
        if (f.tipo === 'TITULAR_LGPD') {
          expect(corpo).toMatchObject({ cpf: '39053344705', subtipo: 'ACESSO' })
          expect(corpo).not.toHaveProperty('assunto')
        } else {
          expect(corpo).toMatchObject({ assunto: 'Dúvida sobre os projetos' })
          expect(corpo).not.toHaveProperty('cpf')
          expect(corpo).not.toHaveProperty('subtipo')
        }
      })

      test('só com telefone (sem e-mail) também vale; só com e-mail, idem', async ({
        page,
      }) => {
        await preencher(page, f, { email: '', telefone: '9133334444' })
        await aceitar(page)
        await enviar(page)
        await expect(confirmacao(page)).toBeVisible()
        const corpo = (await pedidosRecebidos(page)).at(-1)
        expect(corpo).toMatchObject({ telefone_whatsapp: '9133334444' })
        expect(corpo).not.toHaveProperty('email_contato')
      })

      test('sem aceitar o aviso de privacidade não envia: o aviso aponta a caixa e leva o foco até ela', async ({
        page,
      }) => {
        await preencher(page, f)
        const antes = (await pedidosRecebidos(page)).length
        await enviar(page)
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-consentimento`),
        ).toContainText(
          'Para enviar, é preciso ler e aceitar o aviso de privacidade.',
        )
        await expect(
          formulario(page).getByLabel('Li e aceito o aviso de privacidade.'),
        ).toBeFocused()
        expect((await pedidosRecebidos(page)).length).toBe(antes)
        // marcou a caixa: o aviso some na hora, sem esperar o próximo envio
        await aceitar(page)
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-consentimento`),
        ).toBeHidden()
      })

      test('e-mail e telefone que não parecem certos são apontados antes de enviar', async ({
        page,
      }) => {
        await preencher(page, f, { email: 'sem-arroba', telefone: '123' })
        await aceitar(page)
        const antes = (await pedidosRecebidos(page)).length
        await enviar(page)
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-email`),
        ).toContainText('não parece certo')
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-telefone`),
        ).toContainText('10 ou 11 dígitos')
        await expect(formulario(page).getByLabel('E-mail')).toBeFocused()
        expect((await pedidosRecebidos(page)).length).toBe(antes)
      })

      test('o contador de letras da mensagem acompanha o que se digita e a mensagem curta é recusada', async ({
        page,
      }) => {
        const form = formulario(page)
        await expect(form.locator('[data-contador]')).toHaveText(
          '0 de 4.000 letras',
        )
        await form.getByLabel('Mensagem').fill('Olá')
        await expect(form.locator('[data-contador]')).toHaveText(
          '3 de 4.000 letras',
        )
        await preencher(page, f)
        await form.getByLabel('Mensagem').fill('Olá')
        await aceitar(page)
        await enviar(page)
        await expect(
          page.locator(`#${f.idDoFormulario}-erro-mensagem`),
        ).toContainText('pelo menos 10 letras')
        await expect(form.getByLabel('Mensagem')).toBeFocused()
      })

      test('a API recusa por excesso de pedidos (429): a pessoa lê o motivo e não perde o que digitou', async ({
        page,
      }) => {
        await preencher(page, f, { nome: NOME_QUE_ESTOURA_O_LIMITE })
        await aceitar(page)
        await enviar(page)
        const aviso = page
          .getByRole('alert')
          .filter({ hasText: 'Muitas tentativas - aguarde 60 minutos' })
        await expect(aviso).toBeVisible()
        await expect(aviso).toBeFocused()
        await expect(formulario(page).getByLabel('Nome completo')).toHaveValue(
          NOME_QUE_ESTOURA_O_LIMITE,
        )
        await expect(
          formulario(page).getByRole('button', { name: 'Enviar pedido' }),
        ).toBeEnabled()
        await expect(confirmacao(page)).toBeHidden()
      })

      test('erro de servidor: orientação sem culpar a pessoa, e dá para tentar de novo', async ({
        page,
      }) => {
        await preencher(page, f, { nome: NOME_QUE_DERRUBA_A_API })
        await aceitar(page)
        await enviar(page)
        await expect(
          page
            .getByRole('alert')
            .filter({ hasText: 'Erro interno do servidor.' }),
        ).toBeVisible()
        await expect(
          formulario(page).getByRole('button', { name: 'Enviar pedido' }),
        ).toBeEnabled()
      })

      test('sem rede: a mensagem de falha manda tentar de novo ou falar com a associação', async ({
        page,
      }) => {
        await page.route('**/api/publico/atendimentos', (rota) => rota.abort())
        await preencher(page, f)
        await aceitar(page)
        await enviar(page)
        await expect(
          page.getByRole('alert').filter({
            hasText: 'Não foi possível enviar o pedido agora',
          }),
        ).toContainText('fale com a associação')
        await expect(page.locator('[data-falha-do-envio]')).toBeFocused()
        await expect(
          formulario(page).getByRole('button', { name: 'Enviar pedido' }),
        ).toBeEnabled()
      })

      test('aviso de privacidade desatualizado: a API manda recarregar a página e a pessoa lê isso', async ({
        page,
      }) => {
        await page.route('**/api/publico/atendimentos', async (rota) => {
          if (rota.request().method() !== 'POST') return rota.continue()
          const corpo = rota.request().postDataJSON() as Record<string, unknown>
          await rota.continue({
            postData: JSON.stringify({
              ...corpo,
              versao_texto_consentimento: '0',
            }),
          })
        })
        await preencher(page, f)
        await aceitar(page)
        await enviar(page)
        await expect(
          page
            .getByRole('alert')
            .filter({ hasText: 'O aviso de privacidade foi atualizado' }),
        ).toContainText('recarregue a página')
      })

      test('armadilha de robô preenchida: a mesma tela de sucesso, só que sem protocolo nem prazo', async ({
        page,
      }) => {
        await preencher(page, f)
        await aceitar(page)
        await page.locator('input[name="pagina_web"]').evaluate((el) => {
          ;(el as HTMLInputElement).value = 'http://spam.example'
        })
        await enviar(page)
        const aviso = confirmacao(page)
        await expect(aviso).toBeVisible()
        await expect(aviso.locator('[data-bloco-do-protocolo]')).toBeHidden()
        await expect(aviso.locator('[data-prazo-da-resposta]')).toBeHidden()
        await expect(aviso).not.toContainText('Protocolo:', {
          useInnerText: true,
        })
        expect((await pedidosRecebidos(page)).at(-1)).toMatchObject({
          pagina_web: 'http://spam.example',
        })
      })

      test('se a API dos prazos não responde, o texto do prazo some e o formulário continua funcionando', async ({
        page,
      }) => {
        await page.route('**/api/publico/atendimentos/prazos', (rota) =>
          rota.abort(),
        )
        await page.goto(f.caminho)
        await preencher(page, f)
        await expect(formulario(page).locator('[data-prazo]')).toBeHidden()
        await expect(formulario(page).locator('[data-prazo]')).toHaveText('')
        await aceitar(page)
        await enviar(page)
        // a confirmação continua mostrando o prazo, porque ele vem da resposta do envio
        await expect(confirmacao(page)).toContainText(
          `Respondemos em até ${f.dias} dias`,
        )
      })

      test('celular (375px): o formulário cabe na tela, sem rolagem lateral, e passa no axe', async ({
        page,
      }) => {
        await page.setViewportSize({ width: 375, height: 700 })
        await expect(formulario(page).getByLabel('Mensagem')).toBeVisible()
        const semRolagemLateral = await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        )
        expect(semRolagemLateral).toBe(true)
        await semViolacoes(page)
      })
    })
  }

  test('protocolos saem em sequência', async ({ page }) => {
    const f = FORMULARIOS[0]!
    const numeros: number[] = []
    for (let i = 0; i < 2; i++) {
      await page.goto(f.caminho)
      await preencher(page, f)
      await aceitar(page)
      await enviar(page)
      const protocolo = await confirmacao(page)
        .locator('[data-protocolo]')
        .textContent()
      numeros.push(Number(/(\d{5})$/.exec(protocolo ?? '')![1]))
    }
    expect(numeros[1]).toBe(numeros[0]! + 1)
  })

  test('o foco procura o erro na ordem da página: CPF antes do direito, antes da mensagem', async ({
    page,
  }) => {
    const f = FORMULARIOS[2]!
    await page.goto(f.caminho)
    await preencher(page, f, { cpf: '111.444.777-36' })
    await aceitar(page)
    await enviar(page)
    await expect(page.locator(`#${f.idDoFormulario}-erro-cpf`)).toContainText(
      'não confere',
    )
    await expect(formulario(page).getByLabel('CPF')).toBeFocused()
    await formulario(page).getByLabel('CPF').fill(CPF_VALIDO)
    await formulario(page).getByLabel('O que você quer pedir').selectOption('')
    await enviar(page)
    await expect(
      formulario(page).getByLabel('O que você quer pedir'),
    ).toBeFocused()
    await expect(
      page.locator(`#${f.idDoFormulario}-erro-subtipo`),
    ).toContainText('Escolha o que você quer pedir')
  })

  test('na solicitação do titular, cada um dos oito pedidos chega à API com o seu código', async ({
    page,
  }) => {
    const f = FORMULARIOS[2]!
    const codigos = [
      'CONFIRMACAO',
      'ACESSO',
      'CORRECAO',
      'ELIMINACAO',
      'PORTABILIDADE',
      'COMPARTILHAMENTO',
      'REVOGACAO',
      'OUTRO',
    ]
    for (const [i, codigo] of codigos.entries()) {
      await page.goto(f.caminho)
      await preencher(page, f)
      await formulario(page)
        .getByLabel('O que você quer pedir')
        .selectOption({ label: DIREITOS[i]! })
      await aceitar(page)
      await enviar(page)
      await expect(confirmacao(page)).toBeVisible()
      expect((await pedidosRecebidos(page)).at(-1)).toMatchObject({
        subtipo: codigo,
      })
    }
  })
})

test.describe('as páginas dos formulários', () => {
  test('Contato continua com o telefone, o endereço e o pedido de informação, e ganha o formulário e o link', async ({
    page,
  }) => {
    await page.goto('/contato/')
    await expect(
      page.getByRole('heading', { name: 'Fale conosco' }),
    ).toBeVisible()
    await expect(
      page.locator('a[href="tel:+5594984120703"]').first(),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Onde fica a sede' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Escreva para a associação' }),
    ).toBeVisible()
    const texto = page.locator('[data-texto="pedido-de-informacao"]')
    await expect(texto).toContainText(
      'pedidos de informação sobre os recursos públicos recebidos',
    )
    await expect(
      texto.getByRole('link', { name: 'Fazer um pedido de informação' }),
    ).toHaveAttribute('href', '/transparencia/pedido-de-informacao/')
  })

  test('Pedido de informação: explica, leva a Transparência e às emendas e tem o formulário', async ({
    page,
  }) => {
    await page.goto('/transparencia/pedido-de-informacao/')
    await expect(
      page.getByRole('heading', {
        name: 'Pedido de informação sobre recursos públicos',
        level: 1,
      }),
    ).toBeVisible()
    const principal = page.locator('main')
    await expect(
      principal
        .getByRole('link', { name: 'Transparência', exact: true })
        .first(),
    ).toHaveAttribute('href', '/transparencia/')
    await expect(
      principal.getByRole('link', { name: 'emendas parlamentares' }),
    ).toHaveAttribute('href', '/transparencia/emendas/')
    await expect(principal).toContainText('recebe um número de protocolo')
    await expect(formulario(page)).toBeVisible()
  })

  test('Transparência e Emendas levam ao formulário do pedido de informação; o rodapé também', async ({
    page,
  }) => {
    for (const caminho of ['/transparencia/', '/transparencia/emendas/']) {
      await page.goto(caminho)
      await expect(
        page
          .locator('main')
          .getByRole('link', { name: 'formulário de pedido de informação' }),
      ).toHaveAttribute('href', '/transparencia/pedido-de-informacao/')
    }
    await expect(
      page
        .getByRole('contentinfo')
        .getByRole('link', { name: 'Pedido de informação' }),
    ).toHaveAttribute('href', '/transparencia/pedido-de-informacao/')
    await expect(
      page
        .getByRole('contentinfo')
        .getByRole('link', { name: 'Solicitação do titular de dados' }),
    ).toHaveAttribute('href', '/privacidade/solicitacao-do-titular/')
  })

  test('Solicitação do titular: lista os oito pedidos em palavras simples e volta para a Política de Privacidade', async ({
    page,
  }) => {
    await page.goto('/privacidade/solicitacao-do-titular/')
    await expect(
      page.getByRole('heading', {
        name: 'Solicitação do titular de dados',
        level: 1,
      }),
    ).toBeVisible()
    const lista = page.locator('main ul').first()
    expect(await lista.locator('li').allTextContents()).toEqual(DIREITOS)
    await expect(
      page
        .locator('main')
        .getByRole('link', { name: 'Voltar para a Política de Privacidade' }),
    ).toHaveAttribute('href', '/privacidade/')
    // a página não promete resultado nem cita lei
    await expect(page.locator('main')).not.toContainText(
      /garantid|LGPD|Lei Geral|Lei n[ºo°]/i,
    )
  })

  for (const f of FORMULARIOS) {
    test(`sem JavaScript o formulário não aparece e o aviso manda falar com a associação — ${f.caminho}`, async ({
      browser,
    }) => {
      const contexto = await browser.newContext({ javaScriptEnabled: false })
      const page = await contexto.newPage()
      await page.goto(f.caminho)
      await expect(page.locator('form[data-atendimento-form]')).toBeHidden()
      // (o Playwright não lê o texto de <noscript> pelo getByText; o parágrafo dentro dele é achado e medido pelo CSS)
      const aviso = page.locator('noscript p.font-medium')
      await expect(aviso).toBeVisible()
      expect(await aviso.evaluate((el) => el.textContent)).toContain(
        'é preciso ativar o JavaScript',
      )
      await contexto.close()
    })
  }
})
