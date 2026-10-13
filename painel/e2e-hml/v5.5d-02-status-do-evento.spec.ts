import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  API_HML,
  campo,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.5d - a SITUAÇÃO do evento (Programado, Adiado, Cancelado, Realizado), de ponta a ponta: o Presidente muda a situação pelo painel (motivo obrigatório, cancelar em dois passos,
// voltar para a data original, remarcar, marcar como realizado) e o efeito aparece na API pública e no SITE de teste (aviso na página do evento, formulário que some e volta,
// página de cancelar a inscrição). Roda DEPOIS do v5.5d-01 (que cria os três eventos e as inscrições) e de a homologação ser publicada de novo com esta versão (o site de teste
// só ganha a página de cada evento no deploy).
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(420_000)

const SITE_HML = 'https://hml-site.asaf.org.br'
const S = String(RODADA)
const PREFIXO_CANCELAR = 'Oficina para Cancelar do Robô'
const PREFIXO_ADIAR = 'Encontro para Adiar do Robô'
const PREFIXO_REALIZAR = 'Evento para Realizar do Robô'
const base = (k: number) => 800000000 + ((RODADA + k * 5003) % 150000000)
const MOTIVO_DO_CANCELAMENTO =
  'O salão ficou indisponível no dia (evento de teste do robô)'
const MOTIVO_DO_ADIAMENTO =
  'Aguardando a liberação do espaço (evento de teste do robô)'

const ids: Record<string, number> = {}
const tokens: Record<string, string> = {}
const antes: Record<string, number> = {}
const autorizacao: { valor: string } = { valor: '' }

type EventoPublico = {
  id_evento: number
  titulo: string
  status: string
  motivo_status: string | null
  data_hora_inicio: string
  data_hora_inicio_anterior: string | null
}

async function eventoMaisNovo(
  page: Page,
  prefixo: string,
): Promise<EventoPublico> {
  const r = await page.request.get(`${API_HML}/api/publico/eventos`)
  expect(r.status()).toBe(200)
  const lista = ((await r.json()) as EventoPublico[])
    .filter((e) => e.titulo.startsWith(prefixo))
    .sort((a, b) => b.id_evento - a.id_evento)
  expect(
    lista.length,
    `o roteiro v5.5d-01 criou o evento "${prefixo}"`,
  ).toBeGreaterThan(0)
  return lista[0]!
}

async function eventoPorId(page: Page, id: number): Promise<EventoPublico> {
  const r = await page.request.get(`${API_HML}/api/publico/eventos/${id}`)
  expect(r.status()).toBe(200)
  return (await r.json()) as EventoPublico
}

async function totalNaAuditoria(page: Page, tabela: string): Promise<number> {
  await page.goto('/auditoria')
  await expect(
    page.getByRole('heading', { name: 'Auditoria', level: 1 }),
  ).toBeVisible()
  const resposta = page.waitForResponse(
    (r) =>
      r.url().includes('/api/auditoria/?') &&
      r.url().includes(`tabela_afetada=${tabela}`),
  )
  await campo(page, 'Tabela').fill(tabela)
  const { total } = (await (await resposta).json()) as { total: number }
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  return total
}

const detalheDoEvento = (page: Page, titulo: string) =>
  page
    .locator('div.rounded-xl')
    .filter({
      has: page.getByRole('heading', { name: titulo, level: 2, exact: true }),
    })
    .last()

/** Abre o evento pelo endereço `/eventos?evento=N` e devolve a seção "Situação do evento". */
async function abrirASituacao(
  page: Page,
  id: number,
  titulo: string,
): Promise<Locator> {
  await page.goto(`/eventos?evento=${id}`)
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  const detalhe = detalheDoEvento(page, titulo)
  await expect(detalhe).toBeVisible()
  const situacao = detalhe.getByRole('region', { name: 'Situação do evento' })
  await expect(situacao).toBeVisible()
  return situacao
}

async function inscreverPelaApi(
  page: Page,
  idEvento: number,
  k: number,
  nome: string,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const consentimento = (await (
    await page.request.get(`${API_HML}/api/publico/eventos/consentimento-lgpd`)
  ).json()) as { versao: string }
  const r = await page.request.post(
    `${API_HML}/api/publico/eventos/${idEvento}/inscrever-se`,
    {
      data: {
        nome_completo: `${nome} ${S} de Teste`,
        cpf: cpfValido(base(k)),
        email: `situacao.${k}.${S}@homologacao.example.com`,
        telefone: `9198777${String(1000 + k).slice(-4)}`,
        consentimento_lgpd: true,
        versao_texto_consentimento: consentimento.versao,
      },
    },
  )
  return {
    status: r.status(),
    corpo: (await r.json()) as Record<string, unknown>,
  }
}

async function postarStatus(
  page: Page,
  idEvento: number,
  corpo: Record<string, unknown>,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const r = await page.request.fetch(
    `${API_HML}/api/eventos/${idEvento}/status`,
    {
      method: 'POST',
      headers: {
        Authorization: autorizacao.valor,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify(corpo),
    },
  )
  return {
    status: r.status(),
    corpo: (await r.json()) as Record<string, unknown>,
  }
}

/** A página do evento no site de teste, já com a situação que o sistema tem agora (a página se atualiza sozinha com o dado vivo). */
async function paginaDoEventoNoSite(page: Page, id: number): Promise<Locator> {
  await page.goto(`${SITE_HML}/eventos/${id}/`, { waitUntil: 'networkidle' })
  return page.locator('[data-situacao-do-evento]')
}

const dataFutura = (dias: number): string =>
  `${new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10)}T19:00`

test('cancelar: sem motivo, com motivo curto ou com dado pessoal é recusado; com motivo pede confirmação, avisa e fecha as inscrições', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao.valor = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao.valor, { timeout: 15_000 }).not.toBe('')
  antes['eventos'] = await totalNaAuditoria(page, 'eventos')

  const evento = await eventoMaisNovo(page, PREFIXO_CANCELAR)
  ids['cancelar'] = evento.id_evento
  expect(evento.status).toBe('Programado')
  // uma inscrição a mais pela API (como o formulário do site): dela vem o link de cancelar que o teste do site usa depois
  const extra = await inscreverPelaApi(
    page,
    ids['cancelar']!,
    11,
    'Inscrita Link',
  )
  expect(extra.status, JSON.stringify(extra.corpo)).toBe(200)
  tokens['cancelar'] = String(extra.corpo['token_cancelamento'])

  const situacao = await abrirASituacao(page, ids['cancelar']!, evento.titulo)
  await expect(situacao.getByText('Programado', { exact: true })).toBeVisible()
  await expect(
    situacao.getByRole('button', { name: 'Marcar como realizado' }),
  ).toBeDisabled()
  await ver(page, info, 'evento-programado-com-os-botoes-de-situacao')

  await situacao.getByRole('button', { name: 'Cancelar evento' }).click()
  const form = situacao.getByRole('form', { name: 'Cancelar o evento' })
  await expect(form).toBeVisible()
  const motivo = form.getByLabel('Motivo do cancelamento')
  // sem motivo
  await form.getByRole('button', { name: 'Continuar' }).click()
  await expect(form.getByRole('alert')).toContainText(
    'Diga o motivo do cancelamento',
  )
  // motivo curto
  await motivo.fill('xis')
  await form.getByRole('button', { name: 'Continuar' }).click()
  await expect(form.getByRole('alert')).toContainText(
    'Diga o motivo do cancelamento',
  )
  // dado pessoal no motivo: o servidor recusa (o texto vai ao site) e o formulário volta ao primeiro passo
  await motivo.fill('Falar com fulano@exemplo.com sobre o assunto')
  await form.getByRole('button', { name: 'Continuar' }).click()
  await form.getByRole('button', { name: 'Sim, cancelar o evento' }).click()
  await expect(form.getByRole('alert')).toContainText('dado pessoal')
  expect((await eventoPorId(page, ids['cancelar']!)).status).toBe('Programado')
  // o motivo certo: pede a confirmação
  await motivo.fill(MOTIVO_DO_CANCELAMENTO)
  await form.getByRole('button', { name: 'Continuar' }).click()
  await expect(
    form.getByText(
      'Cancelar o evento? Quem está inscrito será avisado por e-mail.',
    ),
  ).toBeVisible()
  await ver(page, info, 'cancelar-pede-confirmacao')
  await form.getByRole('button', { name: 'Sim, cancelar o evento' }).click()

  const resultado = situacao.getByRole('status')
  await expect(resultado).toContainText('Evento cancelado.')
  await expect(resultado).toContainText(
    /Aviso por e-mail: \d+ de 3 endereço\(s\) avisado\(s\)\./,
  )
  await expect(situacao.getByText('Cancelado', { exact: true })).toBeVisible()
  await expect(
    situacao.getByText(`Motivo: ${MOTIVO_DO_CANCELAMENTO}`),
  ).toBeVisible()
  await expect(
    situacao.getByRole('button', { name: 'Reativar o evento' }),
  ).toBeVisible()
  await expect(situacao.getByRole('button', { name: 'Adiar' })).toHaveCount(0)
  await ver(page, info, 'evento-cancelado-no-painel')

  // a API pública diz o mesmo, e a inscrição nova é recusada
  const publico = await eventoPorId(page, ids['cancelar']!)
  expect(publico.status).toBe('Cancelado')
  expect(publico.motivo_status).toBe(MOTIVO_DO_CANCELAMENTO)
  const recusada = await inscreverPelaApi(
    page,
    ids['cancelar']!,
    12,
    'Inscrita Tarde',
  )
  expect(recusada.status).toBe(400)
  expect(String(recusada.corpo['detail'])).toContain('foi cancelado')
  expect(vigia.problemas()).toEqual([])
})

test('o site de teste mostra o cancelamento, sem formulário, e a página de cancelar a inscrição avisa e não oferece confirmar', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  const aviso = await paginaDoEventoNoSite(page, ids['cancelar']!)
  await expect(aviso).toHaveAttribute('data-situacao-do-evento', 'Cancelado', {
    timeout: 60_000,
  })
  await expect(aviso).toContainText('Este evento foi cancelado.')
  await expect(aviso).toContainText(MOTIVO_DO_CANCELAMENTO)
  await expect(page.locator('[data-inscricao-formulario]')).toBeHidden()
  await expect(
    page.getByText(
      'As inscrições estão encerradas porque o evento foi cancelado.',
    ),
  ).toBeVisible()
  await ver(page, info, 'site-evento-cancelado')

  // a página de quem tem o link da inscrição
  await page.goto(
    `${SITE_HML}/cancelar-inscricao/?token=${encodeURIComponent(tokens['cancelar']!)}`,
    { waitUntil: 'networkidle' },
  )
  await expect(page.locator('[data-situacao]')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/O evento foi cancelado/)).toBeVisible()
  await expect(page.getByText(MOTIVO_DO_CANCELAMENTO)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Confirmar a minha vaga' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Cancelar a minha inscrição' }),
  ).toBeVisible()
  await ver(page, info, 'site-cancelar-inscricao-de-evento-cancelado')
  expect(vigia.problemas()).toEqual([])
})

test('adiar, voltar para a data original, adiar de novo e remarcar: cada passo aparece no painel, na API e no site, e as inscrições fecham e reabrem', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const evento = await eventoMaisNovo(page, PREFIXO_ADIAR)
  ids['adiar'] = evento.id_evento
  const dataOriginal = evento.data_hora_inicio
  const situacao = await abrirASituacao(page, ids['adiar']!, evento.titulo)

  // adiar: sem motivo é recusado
  await situacao.getByRole('button', { name: 'Adiar', exact: true }).click()
  let form = situacao.getByRole('form', { name: 'Adiar o evento' })
  await form.getByRole('button', { name: 'Confirmar adiamento' }).click()
  await expect(form.getByRole('alert')).toContainText(
    'Diga o motivo do adiamento',
  )
  await form.getByLabel('Motivo do adiamento').fill(MOTIVO_DO_ADIAMENTO)
  await form.getByRole('button', { name: 'Confirmar adiamento' }).click()
  await expect(situacao.getByRole('status')).toContainText('Evento adiado.')
  await expect(situacao.getByText('Adiado', { exact: true })).toBeVisible()
  await expect(
    situacao.getByText(`Motivo: ${MOTIVO_DO_ADIAMENTO}`),
  ).toBeVisible()
  await ver(page, info, 'evento-adiado-no-painel')
  let publico = await eventoPorId(page, ids['adiar']!)
  expect(publico.status).toBe('Adiado')
  const fechada = await inscreverPelaApi(
    page,
    ids['adiar']!,
    21,
    'Inscrito Adiado',
  )
  expect(fechada.status).toBe(400)
  expect(String(fechada.corpo['detail'])).toContain('foi adiado')

  // o site mostra o adiamento, sem formulário
  let aviso = await paginaDoEventoNoSite(page, ids['adiar']!)
  await expect(aviso).toHaveAttribute('data-situacao-do-evento', 'Adiado', {
    timeout: 60_000,
  })
  await expect(aviso).toContainText('Este evento foi adiado.')
  await expect(aviso).toContainText(MOTIVO_DO_ADIAMENTO)
  await expect(page.locator('[data-inscricao-formulario]')).toBeHidden()
  await ver(page, info, 'site-evento-adiado')

  // voltar para a data original (ela ainda é futura): o evento fica Programado, sem "remarcado"
  const situacao2 = await abrirASituacao(page, ids['adiar']!, evento.titulo)
  await situacao2
    .getByRole('button', { name: 'Voltar para a data original' })
    .click()
  form = situacao2.getByRole('form', { name: 'Voltar para a data original' })
  await form
    .getByRole('button', { name: 'Confirmar volta à data original' })
    .click()
  await expect(situacao2.getByRole('status')).toContainText(
    'Evento programado.',
  )
  await expect(situacao2.getByText('Programado', { exact: true })).toBeVisible()
  await expect(situacao2.getByText(/^Remarcado:/)).toHaveCount(0)
  publico = await eventoPorId(page, ids['adiar']!)
  expect(publico.status).toBe('Programado')
  expect(publico.data_hora_inicio).toBe(dataOriginal)
  expect(publico.data_hora_inicio_anterior).toBeNull()

  // adiar de novo e remarcar para uma data nova
  await situacao2.getByRole('button', { name: 'Adiar', exact: true }).click()
  form = situacao2.getByRole('form', { name: 'Adiar o evento' })
  await form.getByLabel('Motivo do adiamento').fill(MOTIVO_DO_ADIAMENTO)
  await form.getByRole('button', { name: 'Confirmar adiamento' }).click()
  await expect(situacao2.getByRole('status')).toContainText('Evento adiado.')
  await situacao2
    .getByRole('button', { name: 'Remarcar (definir nova data)' })
    .click()
  form = situacao2.getByRole('form', { name: 'Remarcar o evento' })
  // sem data nova: recusado
  await form.getByRole('button', { name: 'Confirmar nova data' }).click()
  await expect(form.getByRole('alert')).toContainText('nova data de início')
  await form.getByLabel('Nova data de início').fill(dataFutura(2))
  await form
    .getByLabel('Motivo (opcional)')
    .fill('Nova data combinada com a igreja anfitriã (teste do robô)')
  await form.getByRole('button', { name: 'Confirmar nova data' }).click()
  await expect(situacao2.getByRole('status')).toContainText(
    'Evento programado.',
  )
  await expect(situacao2.getByText('Programado', { exact: true })).toBeVisible()
  await expect(
    situacao2.getByText(/^Remarcado: a data anterior era/),
  ).toBeVisible()
  await ver(page, info, 'evento-remarcado-no-painel')

  publico = await eventoPorId(page, ids['adiar']!)
  expect(publico.status).toBe('Programado')
  expect(publico.data_hora_inicio_anterior).toBe(dataOriginal)
  expect(publico.data_hora_inicio).not.toBe(dataOriginal)
  // as inscrições reabriram
  const aberta = await inscreverPelaApi(
    page,
    ids['adiar']!,
    22,
    'Inscrito Remarcado',
  )
  expect(aberta.status, JSON.stringify(aberta.corpo)).toBe(200)

  // o site mostra o evento remarcado, com o formulário de volta
  aviso = await paginaDoEventoNoSite(page, ids['adiar']!)
  await expect(aviso).toHaveAttribute('data-situacao-do-evento', 'Programado', {
    timeout: 60_000,
  })
  await expect(page.locator('[data-evento-remarcado]')).toBeVisible()
  await expect(page.getByText(/Este evento foi remarcado\./)).toBeVisible()
  await expect(page.locator('[data-inscricao-formulario]')).toBeVisible()
  await ver(page, info, 'site-evento-remarcado-com-formulario')
  expect(vigia.problemas()).toEqual([])
})

test('marcar como realizado: o botão trava antes do início, depois pede confirmação, e o evento realizado não volta atrás', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  const evento = await eventoMaisNovo(page, PREFIXO_REALIZAR)
  ids['realizar'] = evento.id_evento
  // a API também recusa marcar como realizado um evento que ainda não começou (o do adiamento, remarcado, está de pé e no futuro)
  const cedo = await postarStatus(page, ids['adiar']!, { status: 'Realizado' })
  expect(cedo.status).toBe(400)
  expect(String(cedo.corpo['detail'])).toContain('ainda não começou')

  const situacao = await abrirASituacao(page, ids['realizar']!, evento.titulo)
  const botao = situacao.getByRole('button', { name: 'Marcar como realizado' })
  await expect(botao).toBeEnabled()
  await botao.click()
  const form = situacao.getByRole('form', {
    name: 'Marcar o evento como realizado',
  })
  await expect(form).toContainText('não volta atrás')
  await form.getByRole('button', { name: 'Sim, marcar como realizado' }).click()
  await expect(situacao.getByRole('status')).toContainText(
    'Evento marcado como realizado.',
  )
  await expect(situacao.getByText('Realizado', { exact: true })).toBeVisible()
  await expect(
    situacao.getByText('Um evento realizado não volta atrás.'),
  ).toBeVisible()
  await expect(situacao.getByRole('button', { name: 'Adiar' })).toHaveCount(0)
  await expect(
    situacao.getByRole('button', { name: 'Cancelar evento' }),
  ).toHaveCount(0)
  await ver(page, info, 'evento-realizado-no-painel')

  const volta = await postarStatus(page, ids['realizar']!, {
    status: 'Cancelado',
    motivo: 'Tentativa de cancelar um evento já realizado',
  })
  expect(volta.status).toBe(400)
  expect(String(volta.corpo['detail'])).toMatch(
    /não pode passar|não volta atrás/,
  )

  const aviso = await paginaDoEventoNoSite(page, ids['realizar']!)
  await expect(aviso).toHaveAttribute('data-situacao-do-evento', 'Realizado', {
    timeout: 60_000,
  })
  await expect(aviso).toContainText('Este evento já foi realizado.')
  await expect(page.locator('[data-inscricao-formulario]')).toBeHidden()
  await ver(page, info, 'site-evento-realizado')
  expect(vigia.problemas()).toEqual([])
})

test('a Auditoria guardou cada mudança de situação (6) e a lista do painel mostra o selo de cada uma', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrar(page, 'presidente')
  // cancelar (1) + adiar, voltar, adiar, remarcar (4) + realizar (1)
  const depois = await totalNaAuditoria(page, 'eventos')
  expect(depois - antes['eventos']!).toBe(6)

  await page.goto('/eventos')
  await expect(
    page.getByRole('heading', { name: 'Eventos', level: 1 }),
  ).toBeVisible()
  for (const [prefixo, selo] of [
    [PREFIXO_CANCELAR, 'Cancelado'],
    [PREFIXO_REALIZAR, 'Realizado'],
  ] as const) {
    const linha = page
      .locator('div[role="button"]')
      .filter({ hasText: `${prefixo} ${S}` })
    await expect(linha.getByText(selo, { exact: true })).toBeVisible()
  }
  await ver(page, info, 'lista-de-eventos-com-os-selos')
  expect(vigia.problemas()).toEqual([])
})
