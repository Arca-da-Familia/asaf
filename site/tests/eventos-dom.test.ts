// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventoPublico } from '../src/lib/api'
import {
  eventosFuturos,
  eventosPassados,
  iniciarEventos,
  renderizarEventos,
} from '../src/lib/eventos-dom'

function evento(parcial: Partial<EventoPublico> = {}): EventoPublico {
  return {
    id_evento: 1,
    titulo: 'Encontro de Famílias',
    descricao: null,
    categoria: 'Encontro',
    data_hora_inicio: '2026-10-10T19:00:00',
    data_hora_fim: null,
    id_espaco: null,
    endereco_avulso: null,
    vagas: null,
    vagas_livres: null,
    gratuito: false,
    ...parcial,
  }
}

// 1º/out/2026, meio-dia em Parauapebas.
const AGORA = new Date('2026-10-01T15:00:00Z')

function respostaJson(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('eventosFuturos', () => {
  it('descarta evento que já terminou e mantém o futuro', () => {
    const passado = evento({
      id_evento: 1,
      data_hora_inicio: '2026-09-01T19:00:00',
    })
    const futuro = evento({ id_evento: 2 })
    expect(
      eventosFuturos([passado, futuro], AGORA).map((e) => e.id_evento),
    ).toEqual([2])
  })

  it('evento em andamento (começou, ainda não terminou) continua aparecendo', () => {
    const emAndamento = evento({
      data_hora_inicio: '2026-09-30T08:00:00',
      data_hora_fim: '2026-10-02T18:00:00',
    })
    expect(eventosFuturos([emAndamento], AGORA)).toHaveLength(1)
  })

  it('ordena do mais próximo ao mais distante', () => {
    const depois = evento({
      id_evento: 1,
      data_hora_inicio: '2026-12-01T10:00:00',
    })
    const antes = evento({
      id_evento: 2,
      data_hora_inicio: '2026-10-05T10:00:00',
    })
    expect(
      eventosFuturos([depois, antes], AGORA).map((e) => e.id_evento),
    ).toEqual([2, 1])
  })

  it('limita a quantidade (a home não vira lista infinita)', () => {
    const muitos = Array.from({ length: 10 }, (_, i) =>
      evento({ id_evento: i + 1 }),
    )
    expect(eventosFuturos(muitos, AGORA)).toHaveLength(6)
    expect(eventosFuturos(muitos, AGORA, 3)).toHaveLength(3)
  })
})

describe('renderizarEventos', () => {
  let container: HTMLElement
  beforeEach(() => {
    container = document.createElement('div')
  })

  it('mostra título, data e horário no fuso da ASAF, e local', () => {
    renderizarEventos(container, [
      evento({ endereco_avulso: 'Salão Paroquial' }),
    ])
    expect(container.querySelector('h3')?.textContent).toBe(
      'Encontro de Famílias',
    )
    expect(container.textContent).toContain(
      'sábado, 10 de outubro de 2026 · 19:00',
    )
    expect(container.textContent).toContain('Salão Paroquial')
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-10-10T19:00:00-03:00',
    )
  })

  it('SEGURANÇA: HTML no título/descrição/local aparece como texto, nunca executa', () => {
    renderizarEventos(container, [
      evento({
        titulo: '<img src=x onerror="window.__xss=1">Ataque',
        descricao: '<script>window.__xss=2</script>',
        endereco_avulso: '<b onmouseover="window.__xss=3">local</b>',
      }),
    ])
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('h3')?.textContent).toBe(
      '<img src=x onerror="window.__xss=1">Ataque',
    )
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('rótulos de vaga: esgotada, singular, plural e sem limite', () => {
    const texto = (vagas_livres: number | null) => {
      renderizarEventos(container, [evento({ vagas_livres })])
      return container.textContent ?? ''
    }
    expect(texto(0)).toContain('Vagas esgotadas')
    expect(texto(1)).toContain('1 vaga disponível')
    expect(texto(5)).toContain('5 vagas disponíveis')
    expect(texto(null)).not.toMatch(/vaga/i)
  })

  it('selo "Gratuito" só em evento gratuito', () => {
    renderizarEventos(container, [evento({ gratuito: true })])
    expect(container.textContent).toContain('Gratuito')
    renderizarEventos(container, [evento({ gratuito: false })])
    expect(container.textContent).not.toContain('Gratuito')
  })
})

describe('iniciarEventos', () => {
  let container: HTMLElement
  beforeEach(() => {
    container = document.createElement('div')
    container.dataset.apiUrl = 'https://api.exemplo.org'
  })

  it('sucesso: desenha a lista e libera o aria-busy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respostaJson([evento()]))
    await iniciarEventos(container, { agora: AGORA, fetchImpl })
    expect(container.querySelector('[data-estado="lista"]')).not.toBeNull()
    expect(container.getAttribute('aria-busy')).toBe('false')
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.exemplo.org/api/publico/eventos',
    )
  })

  it('sem eventos futuros: mensagem clara, não uma área em branco', async () => {
    const passado = evento({ data_hora_inicio: '2026-01-01T10:00:00' })
    const fetchImpl = vi.fn().mockResolvedValue(respostaJson([passado]))
    await iniciarEventos(container, { agora: AGORA, fetchImpl })
    expect(
      container.querySelector('[data-estado="vazio"]')?.textContent,
    ).toMatch(/Nenhum evento/)
  })

  it('API fora do ar de verdade: tenta 2 vezes, mostra erro, e "Tentar novamente" recupera', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    await iniciarEventos(container, {
      agora: AGORA,
      fetchImpl,
      esperaEntreTentativasMs: 0,
    })
    expect(container.querySelector('[data-estado="erro"]')).not.toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2) // 1ª tentativa + 1 nova antes de desistir

    fetchImpl.mockResolvedValue(respostaJson([evento()]))
    container.querySelector('button')!.click()
    await vi.waitFor(() =>
      expect(container.querySelector('[data-estado="lista"]')).not.toBeNull(),
    )
  })

  it('PARTIDA A FRIO: falha passageira na 1ª tentativa (API acordando) se resolve sozinha, sem mostrar erro', async () => {
    // Foi o defeito achado em produção: a API escala a zero e a 1ª chamada depois de um tempo
    // parado falha/demora. O visitante não pode ver "erro" por algo que passa em segundos.
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(respostaJson([evento()]))
    await iniciarEventos(container, {
      agora: AGORA,
      fetchImpl,
      esperaEntreTentativasMs: 0,
    })
    expect(container.querySelector('[data-estado="lista"]')).not.toBeNull()
    expect(container.querySelector('[data-estado="erro"]')).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('avisa que pode demorar quando a API leva tempo, e o aviso some quando chega', async () => {
    let entregar!: (r: Response) => void
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolver) => (entregar = resolver)),
    ) as unknown as typeof fetch
    const carregando = iniciarEventos(container, {
      agora: AGORA,
      fetchImpl,
      dicaAposMs: 20,
    })
    await vi.waitFor(() =>
      expect(container.textContent).toContain('pode levar alguns segundos'),
    )
    expect(container.querySelector('[data-estado="carregando"]')).not.toBeNull()

    entregar(respostaJson([evento()]))
    await carregando
    expect(container.querySelector('[data-estado="lista"]')).not.toBeNull()
    expect(container.textContent).not.toContain('pode levar alguns segundos')
  })
})

// v5.5d — a situação do evento (cancelado, adiado, remarcado, realizado) na lista da Agenda e da Home
describe('eventosFuturos e eventosPassados — a situação do evento', () => {
  const ids = (lista: EventoPublico[]) => lista.map((e) => e.id_evento)

  it('evento cancelado com data futura fica na lista; a Home (semCancelados) o tira, e só ele', () => {
    const lista = [
      evento({ id_evento: 1, status: 'Cancelado' }),
      evento({ id_evento: 2, status: 'Programado' }),
      evento({ id_evento: 3 }), // sem situação (API antiga)
    ]
    expect(ids(eventosFuturos(lista, AGORA))).toEqual([1, 2, 3])
    expect(
      ids(eventosFuturos(lista, AGORA, undefined, { semCancelados: true })),
    ).toEqual([2, 3])
  })

  it('tirar o cancelado vale ANTES do limite (o cancelado não ocupa vaga da Home)', () => {
    const lista = [
      evento({ id_evento: 1, status: 'Cancelado' }),
      evento({ id_evento: 2 }),
      evento({ id_evento: 3 }),
    ]
    expect(
      ids(eventosFuturos(lista, AGORA, 2, { semCancelados: true })),
    ).toEqual([2, 3])
  })

  it('evento ADIADO continua nos próximos mesmo com a data original já passada; o REALIZADO sai, ainda que o horário de fim não tenha chegado', () => {
    const lista = [
      evento({
        id_evento: 1,
        status: 'Adiado',
        data_hora_inicio: '2026-09-01T19:00:00',
      }),
      evento({
        id_evento: 2,
        status: 'Realizado',
        data_hora_inicio: '2026-09-30T08:00:00',
        data_hora_fim: '2026-10-02T18:00:00',
      }),
      evento({ id_evento: 3 }),
    ]
    expect(ids(eventosFuturos(lista, AGORA))).toEqual([1, 3])
    expect(ids(eventosPassados(lista, AGORA))).toEqual([2])
  })

  it('no arquivo: o adiado nunca entra; o cancelado entra só quando a data já passou', () => {
    const lista = [
      evento({
        id_evento: 1,
        status: 'Adiado',
        data_hora_inicio: '2026-09-01T19:00:00',
      }),
      evento({
        id_evento: 2,
        status: 'Cancelado',
        data_hora_inicio: '2026-09-02T19:00:00',
      }),
      evento({ id_evento: 3, status: 'Cancelado' }), // data futura
    ]
    expect(ids(eventosPassados(lista, AGORA))).toEqual([2])
  })
})

describe('renderizarEventos — o selo da situação', () => {
  let container: HTMLElement
  beforeEach(() => {
    container = document.createElement('div')
  })
  const selo = () =>
    container.querySelector<HTMLElement>('[data-selo-do-evento]')

  it('evento só programado (ou de API antiga) não leva selo', () => {
    renderizarEventos(container, [evento(), evento({ status: 'Programado' })])
    expect(selo()).toBeNull()
  })

  it('cada situação aparece ESCRITA no cartão: Cancelado, Adiado, Realizado e Remarcado', () => {
    const casos: Array<[Partial<EventoPublico>, string]> = [
      [{ status: 'Cancelado' }, 'Cancelado'],
      [{ status: 'Adiado' }, 'Adiado'],
      [{ status: 'Realizado' }, 'Realizado'],
      [
        {
          status: 'Programado',
          data_hora_inicio_anterior: '2026-10-03T19:00:00',
        },
        'Remarcado',
      ],
    ]
    for (const [parcial, esperado] of casos) {
      renderizarEventos(container, [evento(parcial)])
      expect(selo()!.textContent, esperado).toBe(esperado)
      expect(selo()!.getAttribute('data-selo-do-evento')).toBe(esperado)
    }
  })

  it('o evento adiado diz que a nova data está por definir', () => {
    renderizarEventos(container, [evento({ status: 'Adiado' })])
    expect(container.textContent).toContain('Nova data a definir')
    renderizarEventos(container, [evento({ status: 'Cancelado' })])
    expect(container.textContent).not.toContain('Nova data a definir')
  })

  it('na lista dos que já passaram, "Remarcado" não aparece (já passou); os outros selos continuam', () => {
    renderizarEventos(
      container,
      [
        evento({
          data_hora_inicio_anterior: '2026-10-03T19:00:00',
          data_hora_inicio: '2026-09-01T19:00:00',
        }),
      ],
      new Set(),
      'passados',
    )
    expect(selo()).toBeNull()
    renderizarEventos(
      container,
      [
        evento({
          status: 'Realizado',
          data_hora_inicio: '2026-09-01T19:00:00',
        }),
      ],
      new Set(),
      'passados',
    )
    expect(selo()!.textContent).toBe('Realizado')
  })

  it('evento parado (cancelado, adiado, realizado) não anuncia vagas — ele não recebe inscrição', () => {
    for (const status of ['Cancelado', 'Adiado', 'Realizado']) {
      renderizarEventos(container, [evento({ status, vagas_livres: 5 })])
      expect(container.textContent, status).not.toMatch(/vaga/i)
    }
    renderizarEventos(container, [evento({ vagas_livres: 5 })])
    expect(container.textContent).toContain('5 vagas disponíveis')
  })

  it('o selo vem antes da data no cartão (a pessoa lê a situação primeiro)', () => {
    renderizarEventos(container, [evento({ status: 'Cancelado' })])
    const cartao = container.querySelector('li')!
    expect(cartao.firstElementChild!.contains(selo())).toBe(true)
  })
})

describe('iniciarEventos — a Home não lista o evento cancelado', () => {
  const lista = [
    evento({ id_evento: 1, titulo: 'Cancelado', status: 'Cancelado' }),
    evento({ id_evento: 2, titulo: 'Adiado', status: 'Adiado' }),
    evento({
      id_evento: 3,
      titulo: 'Remarcado',
      data_hora_inicio_anterior: '2026-10-03T19:00:00',
    }),
    evento({ id_evento: 4, titulo: 'Normal' }),
  ]
  const titulos = (container: HTMLElement) =>
    [...container.querySelectorAll('h3')].map((h) => h.textContent)
  const selos = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-selo-do-evento]')].map(
      (e) => e.textContent,
    )

  async function abrir(semCancelados: boolean) {
    const container = document.createElement('div')
    container.dataset.apiUrl = 'https://api.exemplo.org'
    if (semCancelados) container.dataset.semCancelados = ''
    await iniciarEventos(container, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(respostaJson(lista)),
    })
    return container
  }

  it('com data-sem-cancelados (a Home): o cancelado some; o adiado e o remarcado ficam, com o selo', async () => {
    const container = await abrir(true)
    expect(titulos(container)).toEqual(['Adiado', 'Remarcado', 'Normal'])
    expect(selos(container)).toEqual(['Adiado', 'Remarcado'])
  })

  it('sem o atributo (a agenda completa): o cancelado aparece, com o selo', async () => {
    const container = await abrir(false)
    expect(titulos(container)).toEqual([
      'Cancelado',
      'Adiado',
      'Remarcado',
      'Normal',
    ])
    expect(selos(container)).toEqual(['Cancelado', 'Adiado', 'Remarcado'])
  })
})
