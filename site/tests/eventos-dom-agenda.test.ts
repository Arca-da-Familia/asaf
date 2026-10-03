// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import type { EventoPublico } from '../src/lib/api'
import {
  eventosPassados,
  iniciarEventos,
  lerIdsComPagina,
  renderizarEventos,
} from '../src/lib/eventos-dom'

// v5.2: arquivo da agenda ("eventos anteriores") e link para a página de cada evento.
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

describe('eventosPassados', () => {
  it('só os que já terminaram, do mais recente para o mais antigo', () => {
    const antigo = evento({
      id_evento: 1,
      data_hora_inicio: '2026-08-01T19:00:00',
    })
    const recente = evento({
      id_evento: 2,
      data_hora_inicio: '2026-09-20T19:00:00',
    })
    const futuro = evento({ id_evento: 3 })
    expect(
      eventosPassados([antigo, futuro, recente], AGORA).map((e) => e.id_evento),
    ).toEqual([2, 1])
  })

  it('evento em andamento ainda não é "realizado"', () => {
    const emAndamento = evento({
      data_hora_inicio: '2026-09-30T08:00:00',
      data_hora_fim: '2026-10-02T18:00:00',
    })
    expect(eventosPassados([emAndamento], AGORA)).toHaveLength(0)
  })
})

describe('link para a página do evento', () => {
  it('só vira link quando o evento JÁ tem página publicada (senão seria 404)', () => {
    const container = document.createElement('div')
    renderizarEventos(
      container,
      [
        evento({ id_evento: 7 }),
        evento({ id_evento: 8, titulo: 'Sem página' }),
      ],
      new Set([7]),
    )
    const links = [...container.querySelectorAll('a')]
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute('href')).toBe('/eventos/7/')
    expect(container.textContent).toContain('Sem página')
  })

  it('SEGURANÇA: título malicioso dentro do link continua sendo texto', () => {
    const container = document.createElement('div')
    renderizarEventos(
      container,
      [evento({ id_evento: 7, titulo: '<img src=x onerror=alert(1)>' })],
      new Set([7]),
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')!.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    )
  })

  it('lerIdsComPagina ignora lixo e vazio', () => {
    const el = document.createElement('div')
    el.dataset.idsComPagina = '1, 2,abc,,-3,4.5, 9'
    expect([...lerIdsComPagina(el)].sort()).toEqual([1, 2, 9])
    expect(lerIdsComPagina(document.createElement('div')).size).toBe(0)
  })
})

describe('modo "passados" da ilha', () => {
  it('lista os realizados, sem anunciar vagas, e tem mensagem própria quando vazio', async () => {
    const container = document.createElement('div')
    container.dataset.apiUrl = 'https://api.teste'
    container.dataset.modo = 'passados'
    container.dataset.idsComPagina = '1'
    const passado = evento({
      id_evento: 1,
      data_hora_inicio: '2026-09-01T19:00:00',
      vagas: 10,
      vagas_livres: 2,
    })
    await iniciarEventos(container, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(respostaJson([passado])),
    })
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.textContent).not.toContain('vaga')
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/eventos/1/',
    )

    const vazio = document.createElement('div')
    vazio.dataset.apiUrl = 'https://api.teste'
    vazio.dataset.modo = 'passados'
    await iniciarEventos(vazio, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(respostaJson([])),
    })
    expect(vazio.textContent).toBe('Ainda não há eventos anteriores.')
  })
})
