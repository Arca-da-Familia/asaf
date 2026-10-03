// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { iniciarEventoVivo } from '../src/lib/evento-vivo'

function pagina(fim = '2026-10-10T21:00:00'): HTMLElement {
  const raiz = document.createElement('div')
  raiz.dataset.apiUrl = 'https://api.teste'
  raiz.dataset.id = '2'
  raiz.dataset.fim = fim
  raiz.innerHTML = `
    <p data-aviso-retirado hidden>retirado</p>
    <p data-aviso-realizado hidden>já aconteceu</p>
    <dd data-vagas>12 vagas disponíveis</dd>`
  return raiz
}

// 1º/out/2026, meio-dia em Parauapebas.
const AGORA = new Date('2026-10-01T15:00:00Z')
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const oculto = (raiz: HTMLElement, seletor: string) =>
  (raiz.querySelector(seletor) as HTMLElement).hidden

describe('iniciarEventoVivo', () => {
  it('atualiza as vagas com o número de AGORA (o do build é velho)', async () => {
    const raiz = pagina()
    const fetchImpl = vi.fn().mockResolvedValue(resposta({ vagas_livres: 1 }))
    await iniciarEventoVivo(raiz, { agora: AGORA, fetchImpl })
    expect(raiz.querySelector('[data-vagas]')!.textContent).toBe(
      '1 vaga disponível',
    )
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.teste/api/publico/eventos/2',
    )
  })

  it('vagas esgotadas e evento sem limite de vagas', async () => {
    const a = pagina()
    await iniciarEventoVivo(a, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ vagas_livres: 0 })),
    })
    expect(a.querySelector('[data-vagas]')!.textContent).toBe('Vagas esgotadas')

    const b = pagina()
    await iniciarEventoVivo(b, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ vagas_livres: null })),
    })
    expect(oculto(b, '[data-vagas]')).toBe(true)
  })

  it('404 = evento retirado do ar depois do build: avisa e esconde as vagas', async () => {
    const raiz = pagina()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404)),
    })
    expect(oculto(raiz, '[data-aviso-retirado]')).toBe(false)
    expect(oculto(raiz, '[data-vagas]')).toBe(true)
  })

  it('erro de rede ou 500 NÃO alarma o visitante (a página continua útil)', async () => {
    for (const fetchImpl of [
      vi.fn().mockRejectedValue(new TypeError('rede')),
      vi.fn().mockResolvedValue(resposta({}, 500)),
    ]) {
      const raiz = pagina()
      await iniciarEventoVivo(raiz, {
        agora: AGORA,
        fetchImpl,
        esperaEntreTentativasMs: 0,
      })
      expect(oculto(raiz, '[data-aviso-retirado]')).toBe(true)
      expect(raiz.querySelector('[data-vagas]')!.textContent).toBe(
        '12 vagas disponíveis',
      )
    }
  })

  it('"já aconteceu" só depois do fim do evento (no horário de Parauapebas)', async () => {
    const api = () => vi.fn().mockResolvedValue(resposta({ vagas_livres: 1 }))
    const passado = pagina('2026-09-30T18:00:00')
    await iniciarEventoVivo(passado, { agora: AGORA, fetchImpl: api() })
    expect(oculto(passado, '[data-aviso-realizado]')).toBe(false)

    const futuro = pagina('2026-10-10T21:00:00')
    await iniciarEventoVivo(futuro, { agora: AGORA, fetchImpl: api() })
    expect(oculto(futuro, '[data-aviso-realizado]')).toBe(true)
  })

  it('SEGURANÇA: nada da API entra como HTML', async () => {
    const raiz = pagina()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          resposta({ vagas_livres: '<img src=x onerror=alert(1)>' }),
        ),
    })
    expect(raiz.querySelector('img')).toBeNull()
  })
})
