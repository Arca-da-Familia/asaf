// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventoPublico } from '../src/lib/api'
import {
  eventosFuturos,
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
