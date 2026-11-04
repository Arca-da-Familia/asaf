import { expect, test, type Locator, type Page } from '@playwright/test'

// v9.1c - os FORMULÁRIOS do site usados SÓ COM O TECLADO (o que o axe não vê): para cada formulário dos fluxos críticos, o robô anda com Tab do topo da página
// e prova que (1) todo campo e botão visível do formulário é alcançado, (2) na ordem em que aparece na página, sem `tabindex` positivo que embaralhe, (3) com o
// contorno de foco visível em cada um; e, enviando com Enter o formulário em branco, (4) o foco vai para o primeiro campo com erro e (5) cada campo com erro
// está marcado (`aria-invalid`) e ligado à mensagem que explica o erro (`aria-describedby` apontando para um texto visível), que o leitor de tela lê junto.
const FORMULARIOS = [
  {
    nome: 'inscrição em evento',
    caminho: '/eventos/7/',
    form: 'form[data-inscricao-form]',
  },
  {
    nome: 'filiação',
    caminho: '/seja-associado/',
    form: 'form[data-filiacao-form]',
  },
  {
    nome: 'fale conosco',
    caminho: '/contato/',
    form: 'form[data-atendimento-form]',
  },
  {
    nome: 'voluntariado',
    caminho: '/seja-voluntario/',
    form: 'form[data-atendimento-form]',
  },
  {
    nome: 'pedido do titular de dados',
    caminho: '/privacidade/solicitacao-do-titular/',
    form: 'form[data-atendimento-form]',
  },
  {
    nome: 'pedido de informação',
    caminho: '/transparencia/pedido-de-informacao/',
    form: 'form[data-atendimento-form]',
  },
  {
    nome: 'doação com recibo',
    caminho: '/como-ajudar/doar/',
    form: 'form[data-doacao-identificada]',
  },
]

const CONTROLES = 'input:not([type="hidden"]), select, textarea, button'

/** Anda com Tab até o foco entrar no formulário e segue até ele sair; devolve os elementos na ordem em que receberam o foco (marcados com data-ordem-do-tab). */
async function andarComTab(page: Page, form: Locator): Promise<number> {
  await page.locator('body').evaluate((b) => (b as HTMLElement).focus())
  let dentro = false
  let passos = 0
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press('Tab')
    const estado = await form.evaluate((f, n) => {
      const ativo = document.activeElement as HTMLElement | null
      if (!ativo || !f.contains(ativo)) return 'fora'
      if (!ativo.hasAttribute('data-ordem-do-tab'))
        ativo.setAttribute('data-ordem-do-tab', String(n))
      return 'dentro'
    }, passos)
    if (estado === 'dentro') {
      dentro = true
      passos++
    } else if (dentro) {
      return passos
    }
  }
  throw new Error(
    'o foco nunca entrou no formulário, ou nunca saiu dele (armadilha de teclado)',
  )
}

for (const f of FORMULARIOS) {
  test(`só com o teclado — ${f.nome} (${f.caminho})`, async ({ page }) => {
    await page.goto(f.caminho)
    const form = page.locator(f.form).first()
    await expect(form).toBeVisible()
    await page.waitForLoadState('networkidle')

    expect(
      await page
        .locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')
        .count(),
      'tabindex positivo embaralha a ordem',
    ).toBe(0)

    const passos = await andarComTab(page, form)
    expect(passos).toBeGreaterThan(0)

    // (1) todo controle visível foi alcançado (de um grupo de botões de opção, basta um: o Tab entra no grupo e as setas andam dentro dele)
    const faltando = await form.evaluate((f2, seletor) => {
      const visiveis = [...f2.querySelectorAll<HTMLElement>(seletor)].filter(
        (el) =>
          !(el as HTMLInputElement).disabled &&
          // fora do Tab DE PROPÓSITO: a armadilha anti-robô (pagina_web) tem tabindex=-1 e fica escondida do leitor de tela
          el.tabIndex >= 0 &&
          !el.closest('[aria-hidden="true"]') &&
          el.offsetParent !== null &&
          getComputedStyle(el).visibility !== 'hidden',
      )
      const gruposAlcancados = new Set(
        visiveis
          .filter(
            (el) =>
              el.hasAttribute('data-ordem-do-tab') &&
              (el as HTMLInputElement).type === 'radio',
          )
          .map((el) => (el as HTMLInputElement).name),
      )
      return visiveis
        .filter((el) => !el.hasAttribute('data-ordem-do-tab'))
        .filter(
          (el) =>
            !(
              (el as HTMLInputElement).type === 'radio' &&
              gruposAlcancados.has((el as HTMLInputElement).name)
            ),
        )
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}[name=${el.getAttribute('name') ?? ''}] "${(el.textContent ?? '').trim().slice(0, 40)}"`,
        )
    }, CONTROLES)
    expect(faltando, 'campos que o Tab não alcança').toEqual([])

    // (2) a ordem do Tab é a ordem da página
    const foraDeOrdem = await form.evaluate((f2) => {
      const tocados = [
        ...f2.querySelectorAll<HTMLElement>('[data-ordem-do-tab]'),
      ]
      const pelaOrdemDoTab = [...tocados].sort(
        (a, b) => Number(a.dataset.ordemDoTab) - Number(b.dataset.ordemDoTab),
      )
      return pelaOrdemDoTab
        .filter((el, i) => el !== tocados[i])
        .map((el) => el.getAttribute('name') ?? el.tagName)
    })
    expect(foraDeOrdem, 'a ordem do Tab não segue a página').toEqual([])

    // (3) o contorno de foco aparece em cada um (o foco por teclado liga o :focus-visible)
    const semContorno: string[] = []
    const tocados = form.locator('[data-ordem-do-tab]')
    for (let i = 0; i < (await tocados.count()); i++) {
      const el = tocados.nth(i)
      await el.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      const visivel = await el.evaluate((e) => {
        if (document.activeElement !== e) return true // um grupo de opções devolve o foco à opção marcada: conferida no seu próprio passo
        const estilo = getComputedStyle(e)
        return (
          (estilo.outlineStyle !== 'none' &&
            parseFloat(estilo.outlineWidth) > 0) ||
          (estilo.boxShadow !== 'none' && estilo.boxShadow !== '')
        )
      })
      if (!visivel)
        semContorno.push(
          (await el.getAttribute('name')) ??
            (await el.evaluate((e) => e.tagName)),
        )
    }
    expect(semContorno, 'sem contorno de foco visível').toEqual([])

    // (4) e (5): enviar em branco com Enter
    const enviar = form.locator('button[type="submit"]').first()
    await enviar.focus()
    await page.keyboard.press('Enter')
    const comErro = form.locator('[aria-invalid="true"]')
    await expect(comErro.first()).toBeVisible()
    await expect(comErro.first()).toBeFocused()
    const desligados = await comErro.evaluateAll((campos) =>
      campos
        .filter((c) => {
          const ids = (c.getAttribute('aria-describedby') ?? '')
            .split(/\s+/)
            .filter(Boolean)
          return !ids.some((id) => {
            const msg = document.getElementById(id)
            return (
              msg &&
              !msg.hidden &&
              msg.offsetParent !== null &&
              (msg.textContent ?? '').trim().length > 0
            )
          })
        })
        .map((c) => c.getAttribute('name') ?? c.id),
    )
    expect(desligados, 'campo com erro sem a mensagem ligada').toEqual([])
  })
}
