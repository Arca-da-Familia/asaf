import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

// v5.5d — a SITUAÇÃO do evento (Programado, Adiado, Cancelado, Realizado; "remarcado" é programado com a data de antes), no navegador de verdade, contra o build de
// teste e a API simulada (`scripts/mock-api.mjs`):
//   evento 10: cancelado, com motivo            evento 11: adiado, com motivo (a data é a original)
//   evento 12: remarcado (a data de antes e um motivo), com duas sessões e o formulário de inscrição
//   evento 13: realizado (já aconteceu)         eventos 10 a 13: as quatro edições da mesma série e do projeto 1 (reforço escolar)
//   evento 2: programado e comum (a referência: nada de aviso)
// Os quatro de situação ficam DEPOIS dos seis eventos que a Home mostra (ela mostra seis): os testes das listas pedem a lista à API de teste e ficam só com os de situação.
// Tokens de inscrição de teste: "fixo-evento-cancelado" (vaga reservada em evento cancelado) e "fixo-evento-adiado" (vaga confirmada em evento adiado).

test.describe.configure({ timeout: 90_000 })

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']
const MOTIVO_DO_CANCELADO = 'O local ficou indisponível por causa da chuva.'
const MOTIVO_DO_ADIADO =
  'Estamos aguardando a liberação do espaço pela prefeitura.'
const MOTIVO_DO_REMARCADO = 'O espaço estava ocupado na data original.'

async function semViolacoes(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
  ).toEqual([])
}
/** Axe no computador e no celular (375 px). */
async function semViolacoesNosDois(page: Page) {
  await semViolacoes(page)
  await page.setViewportSize({ width: 375, height: 700 })
  await semViolacoes(page)
  await page.setViewportSize({ width: 1280, height: 720 })
}

type Json = Record<string, unknown>

/** O JSON-LD de tipo Event da página. */
async function jsonLdDoEvento(page: Page): Promise<Json> {
  const blocos = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
  const evento = blocos
    .map((b) => JSON.parse(b) as Json)
    .find((d) => d['@type'] === 'Event')
  expect(evento, 'a página não tem JSON-LD de evento').toBeTruthy()
  return evento!
}

const aviso = (page: Page, situacao: string) =>
  page.locator(`[data-aviso-situacao][data-situacao-do-evento="${situacao}"]`)
const formulario = (page: Page) => page.locator('form[data-inscricao-form]')

/**
 * Responde o detalhe do evento `id` com o que a API de teste devolve, mudando só os campos de `mudanca` — é a diretoria mudando a situação no painel DEPOIS de o site
 * ter sido construído (a ilha da página confere a API a cada visita).
 */
async function mudarDetalheAoVivo(page: Page, id: number, mudanca: Json) {
  await page.route(`**/api/publico/eventos/${id}`, async (rota: Route) => {
    const resposta = await rota.fetch()
    const detalhe = (await resposta.json()) as Json
    await rota.fulfill({ response: resposta, json: { ...detalhe, ...mudanca } })
  })
}

/** Responde a lista da agenda com os eventos de teste que passam em `filtro`, deixando `ajustar` mexer em cada um. */
async function listaDaAgenda(
  page: Page,
  filtro: (e: Json) => boolean,
  ajustar: (e: Json) => Json = (e) => e,
) {
  await page.route('**/api/publico/eventos', async (rota: Route) => {
    const resposta = await rota.fetch()
    const lista = (await resposta.json()) as Json[]
    await rota.fulfill({
      response: resposta,
      json: lista.filter(filtro).map(ajustar),
    })
  })
}
const soOsDeSituacao = (e: Json) => Number(e.id_evento) >= 10

/** "sábado, 10 de outubro de 2026, às 19:00" do instante `iso` (com fuso), no horário de Parauapebas. */
function diaEHoraEmPalavras(iso: string): string {
  const instante = new Date(iso)
  const dia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Belem',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instante)
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Belem',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instante)
  return `${dia}, às ${hora}`
}

test.describe('página do evento CANCELADO (10)', () => {
  test('o aviso vem no topo, escrito, com o motivo; não há formulário e a frase curta ocupa o lugar', async ({
    page,
  }) => {
    await page.goto('/eventos/10/')
    const topo = aviso(page, 'Cancelado')
    await expect(topo).toBeVisible()
    await expect(topo).toHaveAttribute('role', 'status')
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      'Este evento foi cancelado.',
    )
    await expect(topo.locator('[data-situacao-motivo]')).toHaveText(
      `Motivo: ${MOTIVO_DO_CANCELADO}`,
    )
    await expect(topo.locator('[data-situacao-complemento]')).toBeHidden()
    await expect(topo).not.toHaveAttribute('data-evento-remarcado', /.*/)

    // nada de formulário (o bloco fica no HTML, escondido, para voltar se a diretoria reativar o evento)
    await expect(formulario(page)).toBeHidden()
    await expect(page.locator('[data-como-participar]')).toBeHidden()
    await expect(page.locator('[data-inscricoes-paradas]')).toBeVisible()
    await expect(page.locator('[data-inscricoes-paradas]')).toHaveText(
      'As inscrições estão encerradas porque o evento foi cancelado.',
    )
    await expect(
      page.getByRole('heading', { name: 'Inscreva-se neste evento' }),
    ).toBeHidden()
    // evento parado não anuncia vagas nem diz que "a data passou"
    await expect(page.locator('[data-vagas]')).toBeHidden()
    await expect(page.getByText(/vagas? dispon/)).toBeHidden()
    await expect(page.locator('[data-aviso-realizado]')).toBeHidden()
  })

  test('o aviso é a PRIMEIRA coisa depois do título: vem antes da data, do projeto e da inscrição na ordem de leitura', async ({
    page,
  }) => {
    await page.goto('/eventos/10/')
    await expect(aviso(page, 'Cancelado')).toBeVisible()
    const ordem = await page.evaluate(() => {
      const aviso = document.querySelector('[data-aviso-situacao]')!
      const raiz = document.querySelector('[data-evento-vivo]')!
      const antes = (seletor: string) =>
        !!(
          aviso.compareDocumentPosition(document.querySelector(seletor)!) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      return {
        primeiroDaPagina: raiz.firstElementChild === aviso,
        titulo: !!(
          document.querySelector('h1')!.compareDocumentPosition(aviso) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
        antesDoProjeto: antes('[data-projeto-do-evento]'),
        antesDoQuando: antes('[data-quando]'),
        antesDaInscricao: antes('[data-inscricoes-paradas]'),
      }
    })
    expect(ordem).toEqual({
      primeiroDaPagina: true,
      titulo: true,
      antesDoProjeto: true,
      antesDoQuando: true,
      antesDaInscricao: true,
    })
  })

  test('o Google recebe EventCancelled, com a data ORIGINAL', async ({
    page,
  }) => {
    await page.goto('/eventos/10/')
    const evento = await jsonLdDoEvento(page)
    expect(evento.eventStatus).toBe('https://schema.org/EventCancelled')
    expect(evento.startDate).toMatch(/T19:00:00-03:00$/)
    expect(evento).not.toHaveProperty('previousStartDate')
  })

  test('acessível no computador e no celular', async ({ page }) => {
    await page.goto('/eventos/10/')
    await expect(aviso(page, 'Cancelado')).toBeVisible()
    await semViolacoesNosDois(page)
  })
})

test.describe('página do evento ADIADO (11)', () => {
  test('o aviso diz que a nova data ainda não foi definida, o motivo e quando as inscrições reabrem; sem formulário', async ({
    page,
  }) => {
    await page.goto('/eventos/11/')
    const topo = aviso(page, 'Adiado')
    await expect(topo).toBeVisible()
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      'Este evento foi adiado. A nova data ainda não foi definida.',
    )
    await expect(topo.locator('[data-situacao-motivo]')).toHaveText(
      `Motivo: ${MOTIVO_DO_ADIADO}`,
    )
    await expect(topo.locator('[data-situacao-complemento]')).toHaveText(
      'As inscrições reabrem quando a nova data for definida.',
    )
    await expect(formulario(page)).toBeHidden()
    await expect(page.locator('[data-como-participar]')).toBeHidden()
    await expect(page.locator('[data-inscricoes-paradas]')).toHaveText(
      'As inscrições reabrem quando a nova data for definida.',
    )
    await expect(page.locator('[data-vagas]')).toBeHidden()
  })

  test('o Google recebe EventPostponed, com a data original', async ({
    page,
  }) => {
    await page.goto('/eventos/11/')
    const evento = await jsonLdDoEvento(page)
    expect(evento.eventStatus).toBe('https://schema.org/EventPostponed')
    expect(evento.startDate).toMatch(/T19:00:00-03:00$/)
    expect(evento).not.toHaveProperty('previousStartDate')
  })

  test('acessível no computador e no celular', async ({ page }) => {
    await page.goto('/eventos/11/')
    await expect(aviso(page, 'Adiado')).toBeVisible()
    await semViolacoesNosDois(page)
  })
})

test.describe('página do evento REMARCADO (12)', () => {
  test('o aviso diz a data anterior e o motivo, e o formulário de inscrição CONTINUA', async ({
    page,
  }) => {
    await page.goto('/eventos/12/')
    const evento = await jsonLdDoEvento(page)
    const topo = aviso(page, 'Programado')
    await expect(topo).toBeVisible()
    await expect(topo).toHaveAttribute('data-evento-remarcado', '')
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      `Este evento foi remarcado. A data anterior era ${diaEHoraEmPalavras(String(evento.previousStartDate))}.`,
    )
    await expect(topo.locator('[data-situacao-motivo]')).toHaveText(
      `Motivo: ${MOTIVO_DO_REMARCADO}`,
    )
    // remarcado segue como um evento programado: tem formulário, vagas e nenhuma frase de inscrição encerrada
    await expect(formulario(page)).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Inscreva-se neste evento' }),
    ).toBeVisible()
    await expect(page.locator('[data-vagas]')).toHaveText('9 vagas disponíveis')
    await expect(page.locator('[data-inscricoes-paradas]')).toBeHidden()
    await expect(page.locator('[data-aviso-realizado]')).toBeHidden()
  })

  test('o Google recebe EventRescheduled, com a data NOVA em startDate e a de antes em previousStartDate', async ({
    page,
  }) => {
    await page.goto('/eventos/12/')
    const evento = await jsonLdDoEvento(page)
    expect(evento.eventStatus).toBe('https://schema.org/EventRescheduled')
    expect(evento.previousStartDate).toMatch(/T19:00:00-03:00$/)
    expect(Date.parse(String(evento.previousStartDate))).toBeLessThan(
      Date.parse(String(evento.startDate)),
    )
  })

  test('acessível no computador e no celular', async ({ page }) => {
    await page.goto('/eventos/12/')
    await expect(aviso(page, 'Programado')).toBeVisible()
    await semViolacoesNosDois(page)
  })
})

test.describe('página do evento REALIZADO (13)', () => {
  test('o aviso diz que o evento já foi realizado, sem formulário, e não repete "a data passou"', async ({
    page,
  }) => {
    await page.goto('/eventos/13/')
    const topo = aviso(page, 'Realizado')
    await expect(topo).toBeVisible()
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      'Este evento já foi realizado.',
    )
    await expect(topo.locator('[data-situacao-motivo]')).toBeHidden()
    await expect(formulario(page)).toHaveCount(0)
    await expect(page.locator('[data-inscricoes-paradas]')).toHaveText(
      'As inscrições estão encerradas.',
    )
    await expect(page.locator('[data-aviso-realizado]')).toBeHidden()
    const evento = await jsonLdDoEvento(page)
    expect(evento.eventStatus).toBe('https://schema.org/EventScheduled')
  })

  test('acessível no computador e no celular', async ({ page }) => {
    await page.goto('/eventos/13/')
    await expect(aviso(page, 'Realizado')).toBeVisible()
    await semViolacoesNosDois(page)
  })
})

test.describe('evento programado comum (2): nada muda', () => {
  test('sem aviso, sem selo e com o formulário; o Google recebe EventScheduled', async ({
    page,
  }) => {
    await page.goto('/eventos/2/')
    await expect(page.locator('[data-aviso-situacao]')).toBeHidden()
    await expect(page.locator('[data-aviso-situacao]')).toHaveAttribute(
      'data-situacao-do-evento',
      'Programado',
    )
    await expect(page.locator('[data-evento-remarcado]')).toHaveCount(0)
    await expect(page.locator('[data-inscricoes-paradas]')).toBeHidden()
    await expect(formulario(page)).toBeVisible()
    await expect(page.locator('[data-vagas]')).toHaveText(
      '12 vagas disponíveis',
    )
    const evento = await jsonLdDoEvento(page)
    expect(evento.eventStatus).toBe('https://schema.org/EventScheduled')
    expect(evento).not.toHaveProperty('previousStartDate')
  })
})

test.describe('sem JavaScript: a página como o build a entrega (a ilha só a mantém em dia)', () => {
  test.use({ javaScriptEnabled: false })

  test('cancelado: o aviso e o motivo já estão escritos, o formulário já nasce escondido e a frase curta já está no lugar', async ({
    page,
  }) => {
    await page.goto('/eventos/10/')
    const topo = aviso(page, 'Cancelado')
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      'Este evento foi cancelado.',
    )
    await expect(topo.locator('[data-situacao-motivo]')).toHaveText(
      `Motivo: ${MOTIVO_DO_CANCELADO}`,
    )
    await expect(formulario(page)).toBeHidden()
    await expect(page.locator('[data-como-participar]')).toBeHidden()
    await expect(page.locator('[data-inscricoes-paradas]')).toHaveText(
      'As inscrições estão encerradas porque o evento foi cancelado.',
    )
    await expect(page.locator('[data-vagas]')).toBeHidden()
  })

  test('adiado: o aviso, o complemento e a frase curta já estão escritos e não há formulário à vista', async ({
    page,
  }) => {
    await page.goto('/eventos/11/')
    const topo = aviso(page, 'Adiado')
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      'Este evento foi adiado. A nova data ainda não foi definida.',
    )
    await expect(topo.locator('[data-situacao-complemento]')).toBeVisible()
    await expect(formulario(page)).toBeHidden()
    await expect(page.locator('[data-inscricoes-paradas]')).toBeVisible()
  })

  test('remarcado: o aviso com a data anterior já está escrito e o formulário já está à vista', async ({
    page,
  }) => {
    await page.goto('/eventos/12/')
    const evento = await jsonLdDoEvento(page)
    const topo = aviso(page, 'Programado')
    await expect(topo).toHaveAttribute('data-evento-remarcado', '')
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      `Este evento foi remarcado. A data anterior era ${diaEHoraEmPalavras(String(evento.previousStartDate))}.`,
    )
    await expect(page.locator('[data-como-participar]')).toBeVisible()
    await expect(page.locator('[data-inscricoes-paradas]')).toBeHidden()
  })

  test('realizado: o aviso e a frase "As inscrições estão encerradas." já estão escritos', async ({
    page,
  }) => {
    await page.goto('/eventos/13/')
    await expect(
      aviso(page, 'Realizado').locator('[data-situacao-frase]'),
    ).toHaveText('Este evento já foi realizado.')
    await expect(page.locator('[data-inscricoes-paradas]')).toHaveText(
      'As inscrições estão encerradas.',
    )
  })

  test('evento programado comum: nenhum aviso e nenhuma frase de inscrição encerrada', async ({
    page,
  }) => {
    await page.goto('/eventos/2/')
    await expect(page.locator('[data-aviso-situacao]')).toBeHidden()
    await expect(page.locator('[data-inscricoes-paradas]')).toBeHidden()
    await expect(page.locator('[data-como-participar]')).toBeVisible()
  })
})

test.describe('o selo da situação nas edições (projeto e "Outras edições")', () => {
  test('"Outras edições" do evento mostra o selo de cada edição, escrito, e a edição atual também', async ({
    page,
  }) => {
    await page.goto('/eventos/10/')
    const edicoes = page.locator('section[aria-labelledby="outras-edicoes"]')
    const itens = edicoes.locator('li[data-edicao]')
    await expect(itens).toHaveCount(4)
    await expect(itens.locator('h3')).toContainText([
      'Evento de teste — cancelado',
      'Evento de teste — adiado',
      'Evento de teste — remarcado',
      'Evento de teste — realizado',
    ])
    const selos = await itens.evaluateAll((lis) =>
      lis.map((li) => ({
        situacao: li.getAttribute('data-status-do-evento'),
        selo: li.querySelector('[data-selo-do-evento]')?.textContent ?? null,
      })),
    )
    expect(selos).toEqual([
      { situacao: 'Cancelado', selo: 'Cancelado' },
      { situacao: 'Adiado', selo: 'Adiado' },
      // o resumo das edições só traz a situação (não a data de antes): a remarcada é, ali, uma edição programada e fica sem selo
      { situacao: 'Programado', selo: null },
      { situacao: 'Realizado', selo: 'Realizado' },
    ])
    await expect(itens.first()).toContainText('você está nesta edição')
    // "Já realizado" é do relógio e só vale para o evento programado: o realizado já tem o selo, e o cancelado e o adiado NÃO aconteceram
    await expect(edicoes.locator('[data-realizado]:visible')).toHaveCount(0)
  })

  test('a página do projeto mostra o selo de cada edição que não é só programada', async ({
    page,
  }) => {
    await page.goto('/projetos/1/')
    const itens = page.locator(
      'section[aria-labelledby="edicoes"] li[data-edicao]',
    )
    await expect(itens).toHaveCount(5)
    const selos = await itens.evaluateAll((lis) =>
      lis.map((li) => li.querySelector('[data-selo-do-evento]')?.textContent),
    )
    // remarcado (o resumo da edição não traz a data de antes: sem selo), adiado, cancelado, a edição comum do reforço escolar (sem selo) e o realizado
    expect(selos).toEqual([
      undefined,
      'Adiado',
      'Cancelado',
      undefined,
      'Realizado',
    ])
    // a edição comum que já passou continua com o "Já realizado" do relógio
    await expect(itens.nth(3).getByText('Já realizado')).toBeVisible()
  })
})

test.describe('a lista da agenda e a Home', () => {
  test('/eventos/: os próximos mostram o selo de Cancelado, Adiado e Remarcado; os anteriores, o de Realizado', async ({
    page,
  }) => {
    await listaDaAgenda(page, soOsDeSituacao)
    await page.goto('/eventos/')
    const proximos = page.locator('#eventos [data-estado="lista"] li')
    await expect(proximos).toHaveCount(3)
    await expect(proximos.locator('h3')).toHaveText([
      'Evento de teste — cancelado',
      'Evento de teste — adiado',
      'Evento de teste — remarcado',
    ])
    await expect(proximos.locator('[data-selo-do-evento]')).toHaveText([
      'Cancelado',
      'Adiado',
      'Remarcado',
    ])
    await expect(proximos.nth(1)).toContainText('Nova data a definir')
    // evento parado não anuncia vagas; o remarcado (programado) anuncia
    await expect(proximos.nth(0)).not.toContainText(/vaga/)
    await expect(proximos.nth(1)).not.toContainText(/vaga/)
    await expect(proximos.nth(2)).toContainText('9 vagas disponíveis')
    // cada cartão leva à página do evento
    await expect(
      proximos
        .nth(0)
        .getByRole('link', { name: 'Evento de teste — cancelado' }),
    ).toHaveAttribute('href', '/eventos/10/')

    const anteriores = page.locator('#anteriores [data-estado="lista"] li')
    await expect(anteriores).toHaveCount(1)
    await expect(anteriores.locator('h3')).toHaveText(
      'Evento de teste — realizado',
    )
    await expect(anteriores.locator('[data-selo-do-evento]')).toHaveText(
      'Realizado',
    )
  })

  test('a HOME não lista o evento cancelado (ele fica na agenda e na própria página); o adiado e o remarcado aparecem com o selo', async ({
    page,
  }) => {
    await listaDaAgenda(page, soOsDeSituacao)
    await page.goto('/')
    const cartoes = page.locator('#eventos [data-estado="lista"] li')
    await expect(cartoes).toHaveCount(2)
    await expect(cartoes.locator('h3')).toHaveText([
      'Evento de teste — adiado',
      'Evento de teste — remarcado',
    ])
    await expect(cartoes.locator('[data-selo-do-evento]')).toHaveText([
      'Adiado',
      'Remarcado',
    ])
    await expect(page.locator('#eventos')).not.toContainText('cancelado')
    await expect(
      page.locator('#eventos [data-selo-do-evento="Cancelado"]'),
    ).toHaveCount(0)
  })

  test('só há evento cancelado: a Home diz que não há evento aberto, e a agenda completa mostra o cancelado com o selo', async ({
    page,
  }) => {
    await listaDaAgenda(page, (e) => e.id_evento === 10)
    await page.goto('/')
    await expect(page.locator('#eventos [data-estado="vazio"]')).toContainText(
      'Nenhum evento aberto no momento',
    )
    await page.goto('/eventos/')
    await expect(
      page.locator('#eventos [data-estado="lista"] li [data-selo-do-evento]'),
    ).toHaveText('Cancelado')
  })

  test('evento ADIADO com a data original já no passado continua nos PRÓXIMOS (não aconteceu e não tem data nova) e não vai para os anteriores', async ({
    page,
  }) => {
    await listaDaAgenda(
      page,
      (e) => e.id_evento === 11,
      (e) => ({
        ...e,
        data_hora_inicio: '2026-01-10T19:00:00',
        data_hora_fim: null,
      }),
    )
    await page.goto('/eventos/')
    const proximos = page.locator('#eventos [data-estado="lista"] li')
    await expect(proximos).toHaveCount(1)
    await expect(proximos.locator('[data-selo-do-evento]')).toHaveText('Adiado')
    await expect(
      page.locator('#anteriores [data-estado="vazio"]'),
    ).toBeVisible()
    await page.goto('/')
    await expect(
      page.locator('#eventos [data-estado="lista"] li [data-selo-do-evento]'),
    ).toHaveText('Adiado')
  })

  test('as listas com os selos são acessíveis (computador e celular)', async ({
    page,
  }) => {
    await listaDaAgenda(page, soOsDeSituacao)
    await page.goto('/eventos/')
    await expect(
      page.locator('#anteriores [data-selo-do-evento]'),
    ).toBeVisible()
    await semViolacoesNosDois(page)
  })
})

test.describe('a situação muda DEPOIS do build: a página acompanha ao vivo', () => {
  test('evento programado é CANCELADO no painel: o aviso e o motivo aparecem, o formulário e as vagas somem', async ({
    page,
  }) => {
    await mudarDetalheAoVivo(page, 2, {
      status: 'Cancelado',
      motivo_status: MOTIVO_DO_CANCELADO,
    })
    await page.goto('/eventos/2/')
    const topo = aviso(page, 'Cancelado')
    await expect(topo).toBeVisible()
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      'Este evento foi cancelado.',
    )
    await expect(topo.locator('[data-situacao-motivo]')).toHaveText(
      `Motivo: ${MOTIVO_DO_CANCELADO}`,
    )
    await expect(formulario(page)).toBeHidden()
    await expect(page.locator('[data-inscricoes-paradas]')).toHaveText(
      'As inscrições estão encerradas porque o evento foi cancelado.',
    )
    await expect(page.locator('[data-vagas]')).toBeHidden()
    await semViolacoesNosDois(page)
  })

  test('evento programado é ADIADO no painel: o aviso, o complemento e a frase de inscrição', async ({
    page,
  }) => {
    await mudarDetalheAoVivo(page, 2, {
      status: 'Adiado',
      motivo_status: MOTIVO_DO_ADIADO,
    })
    await page.goto('/eventos/2/')
    const topo = aviso(page, 'Adiado')
    await expect(topo).toBeVisible()
    await expect(topo.locator('[data-situacao-complemento]')).toHaveText(
      'As inscrições reabrem quando a nova data for definida.',
    )
    await expect(formulario(page)).toBeHidden()
    await semViolacoes(page)
  })

  test('evento CANCELADO no build é REATIVADO no painel: o aviso some e o formulário e as vagas VOLTAM, sem reconstruir o site', async ({
    page,
  }) => {
    await mudarDetalheAoVivo(page, 10, {
      status: 'Programado',
      motivo_status: null,
    })
    await page.goto('/eventos/10/')
    await expect(page.locator('[data-aviso-situacao]')).toBeHidden()
    await expect(page.locator('[data-inscricoes-paradas]')).toBeHidden()
    await expect(page.locator('[data-como-participar]')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Inscreva-se neste evento' }),
    ).toBeVisible()
    await expect(formulario(page)).toBeVisible()
    await expect(page.locator('[data-vagas]')).toHaveText(
      '25 vagas disponíveis',
    )
    await semViolacoes(page)
  })

  test('evento ADIADO no build é REMARCADO no painel: o aviso diz a data anterior, a data NOVA entra no "Quando" e na programação, e o formulário volta', async ({
    page,
  }) => {
    await mudarDetalheAoVivo(page, 11, {
      status: 'Programado',
      motivo_status: 'A prefeitura liberou o espaço.',
      data_hora_inicio_anterior: '2030-05-04T19:00:00',
      data_hora_inicio: '2030-06-08T18:30:00',
      data_hora_fim: '2030-06-08T21:00:00',
    })
    await page.goto('/eventos/11/')
    const topo = aviso(page, 'Programado')
    await expect(topo).toBeVisible()
    await expect(topo).toHaveAttribute('data-evento-remarcado', '')
    await expect(topo.locator('[data-situacao-frase]')).toHaveText(
      'Este evento foi remarcado. A data anterior era sábado, 4 de maio de 2030, às 19:00.',
    )
    await expect(topo.locator('[data-situacao-complemento]')).toBeHidden()
    await expect(page.locator('[data-quando]')).toContainText(
      'sábado, 8 de junho de 2030, às 18:30',
    )
    await expect(page.locator('[data-quando]')).toContainText('até 21:00')
    await expect(page.locator('[data-quando] time').first()).toHaveAttribute(
      'datetime',
      '2030-06-08T18:30:00-03:00',
    )
    await expect(formulario(page)).toBeVisible()
    await expect(page.locator('[data-inscricoes-paradas]')).toBeHidden()
    await semViolacoes(page)
  })

  test('remarcar leva a programação junto: cada sessão mostra o horário de agora', async ({
    page,
  }) => {
    await mudarDetalheAoVivo(page, 12, {
      data_hora_inicio_anterior: '2030-05-04T19:00:00',
      data_hora_inicio: '2030-06-08T18:30:00',
      data_hora_fim: '2030-06-08T21:00:00',
      sessoes: [
        {
          id_sessao: 121,
          data_hora_inicio: '2030-06-08T18:30:00',
          vagas_livres: null,
        },
        {
          id_sessao: 122,
          data_hora_inicio: '2030-06-08T19:45:00',
          vagas_livres: null,
        },
      ],
    })
    await page.goto('/eventos/12/')
    const horarios = page.locator('time[data-sessao-horario]')
    await expect(horarios.nth(0)).toHaveText(
      'sábado, 8 de junho de 2030, 18:30',
    )
    await expect(horarios.nth(1)).toHaveText(
      'sábado, 8 de junho de 2030, 19:45',
    )
    await expect(horarios.nth(1)).toHaveAttribute(
      'datetime',
      '2030-06-08T19:45:00-03:00',
    )
  })

  test('SEGURANÇA: o motivo digitado é só texto — HTML e script vindos da API aparecem como texto e não executam', async ({
    page,
  }) => {
    let dialogoAberto = false
    page.on('dialog', async (d) => {
      dialogoAberto = true
      await d.dismiss()
    })
    const malicioso =
      '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>x</b>'
    await mudarDetalheAoVivo(page, 2, {
      status: 'Cancelado',
      motivo_status: malicioso,
    })
    await page.goto('/eventos/2/')
    await expect(
      aviso(page, 'Cancelado').locator('[data-situacao-motivo]'),
    ).toHaveText(`Motivo: ${malicioso}`)
    await expect(
      aviso(page, 'Cancelado').locator('img, script, b'),
    ).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(dialogoAberto).toBe(false)
    expect(
      await page.evaluate(() => (window as { __xss?: number }).__xss),
    ).toBe(undefined)
  })

  test('API fora do ar: a página fica como foi publicada (a de um evento cancelado segue sem formulário)', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/10', (rota) => rota.abort())
    await page.goto('/eventos/10/')
    await page.waitForLoadState('networkidle')
    await expect(aviso(page, 'Cancelado')).toBeVisible()
    await expect(formulario(page)).toBeHidden()
    await expect(page.locator('[data-aviso-retirado]')).toBeHidden()
  })

  test('evento cancelado e RETIRADO da programação (404): fica só o aviso de retirado', async ({
    page,
  }) => {
    await page.route('**/api/publico/eventos/10', (rota) =>
      rota.fulfill({ status: 404, json: { detail: 'Evento não encontrado.' } }),
    )
    await page.goto('/eventos/10/')
    await expect(page.locator('[data-aviso-retirado]')).toBeVisible()
    await expect(page.locator('[data-aviso-situacao]')).toBeHidden()
    await expect(page.locator('[data-inscricoes-paradas]')).toBeHidden()
  })
})

test.describe('o link do e-mail de quem está inscrito (cancelar e confirmar)', () => {
  const link = (pagina: 'cancelar' | 'confirmar', token: string) =>
    `/${pagina}-inscricao/?token=${token}`
  const avisoDoEvento = (page: Page) => page.locator('[data-aviso-do-evento]')

  test('CONFIRMAR com o evento cancelado: o aviso com o motivo vem no topo, SEM o botão de confirmar a vaga, e dá para cancelar a inscrição', async ({
    page,
  }) => {
    await page.goto(link('confirmar', 'fixo-evento-cancelado'))
    await expect(avisoDoEvento(page)).toBeVisible()
    await expect(avisoDoEvento(page)).toHaveAttribute('role', 'status')
    await expect(avisoDoEvento(page)).toHaveText(
      `O evento foi cancelado: ${MOTIVO_DO_CANCELADO}`,
    )
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toBeHidden()
    await expect(page.locator('[data-explicacao]')).toHaveText(
      'Este evento foi cancelado: não há o que confirmar.',
    )
    await expect(
      page.getByRole('link', {
        name: 'Não vou poder ir: cancelar a minha inscrição',
      }),
    ).toHaveAttribute(
      'href',
      '/cancelar-inscricao/?token=fixo-evento-cancelado',
    )
    // o aviso é a primeira coisa do resumo, antes da inscrição
    expect(
      await page.evaluate(() =>
        document
          .querySelector('[data-estado="resumo"]')!
          .firstElementChild!.hasAttribute('data-aviso-do-evento'),
      ),
    ).toBe(true)
    await semViolacoesNosDois(page)
  })

  test('CANCELAR com o evento cancelado: o aviso, e o botão de cancelar a inscrição continua e funciona', async ({
    page,
  }) => {
    await page.goto(link('cancelar', 'fixo-evento-cancelado'))
    await expect(avisoDoEvento(page)).toHaveText(
      `O evento foi cancelado: ${MOTIVO_DO_CANCELADO}`,
    )
    await page
      .getByRole('button', { name: 'Cancelar a minha inscrição' })
      .click()
    await page
      .getByRole('button', { name: 'Sim, cancelar a minha inscrição' })
      .click()
    await expect(page.locator('[data-resultado-da-acao]')).toContainText(
      'A sua inscrição foi cancelada.',
    )
    await semViolacoes(page)
  })

  test('evento ADIADO: o aviso com o motivo nas duas páginas, e a vaga confirmada continua confirmada', async ({
    page,
  }) => {
    await page.goto(link('confirmar', 'fixo-evento-adiado'))
    await expect(avisoDoEvento(page)).toHaveText(
      `O evento foi adiado: ${MOTIVO_DO_ADIADO}`,
    )
    await expect(avisoDoEvento(page)).toHaveAttribute(
      'data-situacao-do-evento',
      'Adiado',
    )
    await expect(page.locator('[data-explicacao]')).toHaveText(
      'A sua vaga está confirmada.',
    )
    await page.goto(link('cancelar', 'fixo-evento-adiado'))
    await expect(avisoDoEvento(page)).toHaveText(
      `O evento foi adiado: ${MOTIVO_DO_ADIADO}`,
    )
    await expect(
      page.getByRole('button', { name: 'Cancelar a minha inscrição' }),
    ).toBeVisible()
    await semViolacoesNosDois(page)
  })

  test('evento programado: nenhum aviso (e o botão de confirmar segue como sempre)', async ({
    page,
  }) => {
    await page.goto(link('confirmar', 'fixo-reservada'))
    await expect(
      page.getByRole('button', { name: 'Confirmar a minha vaga' }),
    ).toBeVisible()
    await expect(avisoDoEvento(page)).toBeHidden()
  })

  test('SEGURANÇA: o motivo do cancelamento é só texto no aviso do link', async ({
    page,
  }) => {
    const malicioso = '<img src=x onerror="window.__xss=1"><b>x</b>'
    await page.route(
      '**/api/publico/inscricoes/fixo-evento-cancelado',
      async (rota) => {
        const resposta = await rota.fetch()
        const dados = (await resposta.json()) as { evento: Json }
        await rota.fulfill({
          response: resposta,
          json: {
            ...dados,
            evento: { ...dados.evento, motivo_status: malicioso },
          },
        })
      },
    )
    await page.goto(link('cancelar', 'fixo-evento-cancelado'))
    await expect(avisoDoEvento(page)).toHaveText(
      `O evento foi cancelado: ${malicioso}`,
    )
    await expect(avisoDoEvento(page).locator('img, b')).toHaveCount(0)
    expect(
      await page.evaluate(() => (window as { __xss?: number }).__xss),
    ).toBe(undefined)
  })
})

test.describe('Política de Privacidade 1.7', () => {
  test('mostra a versão 1.7 e o aviso por e-mail quando o evento é cancelado, adiado ou remarcado', async ({
    page,
  }) => {
    await page.goto('/privacidade/')
    await expect(
      page.getByText('Versão 1.7 · em vigor desde 13 de outubro de 2026'),
    ).toBeVisible()
    await expect(
      page.getByText(
        /Esta é a versão 1\.7, em vigor desde 13 de outubro de 2026/,
      ),
    ).toBeVisible()
    const paragrafo = page.locator('[data-inscricao-em-evento]')
    await expect(paragrafo).toContainText(
      'Se o evento for cancelado, adiado ou remarcado, o sistema envia um aviso por e-mail a quem está inscrito, inclusive a quem está na lista de espera',
    )
    expect(await page.locator('main').innerText()).not.toContain('versão 1.6')
  })
})
