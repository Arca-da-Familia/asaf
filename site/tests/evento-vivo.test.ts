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

// v5.5c — a inscrição acompanha o evento ao vivo: vagas de agora no formulário, e o bloco "Como participar" some quando o evento já aconteceu ou saiu do ar.
describe('a inscrição na página do evento', () => {
  function paginaComInscricao(fim = '2026-10-10T21:00:00'): HTMLElement {
    const raiz = pagina(fim)
    raiz.insertAdjacentHTML(
      'beforeend',
      `<div data-como-participar>
        <section data-inscricao-formulario data-vagas-livres="12">
          <p data-aviso-esgotado hidden>As vagas acabaram.</p>
          <select data-campo="sessao">
            <option value="">Todo o evento</option>
            <option value="21" data-sessao="21" data-rotulo="Oficina" data-vagas-livres="5">Oficina — 5 vagas</option>
          </select>
        </section>
      </div>`,
    )
    return raiz
  }

  it('as vagas de agora chegam ao formulário: o aviso aparece quando o evento esgota e o texto das sessões muda', async () => {
    const raiz = paginaComInscricao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(
        resposta({
          vagas_livres: 0,
          sessoes: [{ id_sessao: 21, vagas_livres: 2 }],
        }),
      ),
    })
    expect(oculto(raiz, '[data-aviso-esgotado]')).toBe(false)
    expect(raiz.querySelector('option[data-sessao="21"]')!.textContent).toBe(
      'Oficina — 2 vagas',
    )
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
  })

  it('evento que já aconteceu: o bloco "Como participar" (e o formulário) some', async () => {
    const raiz = paginaComInscricao('2026-09-30T18:00:00')
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ vagas_livres: 1 })),
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
  })

  it('evento retirado do ar (404): o bloco "Como participar" some', async () => {
    const raiz = paginaComInscricao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404)),
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
  })

  it('API fora do ar: a inscrição continua como foi publicada', async () => {
    const raiz = paginaComInscricao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('rede')),
      esperaEntreTentativasMs: 0,
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
    expect(oculto(raiz, '[data-aviso-esgotado]')).toBe(true)
  })

  it('quem acabou de se inscrever não perde a tela de resultado, mesmo que o evento "acabe" depois', async () => {
    const raiz = paginaComInscricao('2026-09-30T18:00:00')
    raiz
      .querySelector('[data-inscricao-formulario]')!
      .setAttribute('data-concluida', '')
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ vagas_livres: 1 })),
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
  })
})
