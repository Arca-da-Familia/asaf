// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  marcarEdicoesRealizadas,
  mostrarSoAProximaEdicao,
} from '../src/lib/edicoes-vivas'

// 10/out/2026, meio-dia em Parauapebas.
const AGORA = new Date('2026-10-10T15:00:00Z')

function pagina(html: string): HTMLElement {
  const raiz = document.createElement('div')
  raiz.innerHTML = html
  return raiz
}

describe('marcarEdicoesRealizadas', () => {
  const lista = () =>
    pagina(`
      <ul>
        <li data-edicao data-fim="2026-11-20T21:00:00"><span data-realizado hidden>Já realizado</span></li>
        <li data-edicao data-fim="2026-10-10T11:00:00"><span data-realizado hidden>Já realizado</span></li>
        <li data-edicao data-fim="2025-10-10T21:00:00"><span data-realizado hidden>Já realizado</span></li>
      </ul>`)

  it('mostra "Já realizado" só nas edições cuja data já passou', () => {
    const raiz = lista()
    marcarEdicoesRealizadas(raiz, AGORA)
    const marcas = [...raiz.querySelectorAll<HTMLElement>('[data-realizado]')]
    expect(marcas.map((m) => m.hidden)).toEqual([true, false, false])
  })

  it('item sem data de fim é ignorado (a marca continua escondida)', () => {
    const raiz = pagina(
      '<li data-edicao><span data-realizado hidden>x</span></li>',
    )
    marcarEdicoesRealizadas(raiz, AGORA)
    expect(raiz.querySelector<HTMLElement>('[data-realizado]')!.hidden).toBe(
      true,
    )
  })
})

describe('mostrarSoAProximaEdicao', () => {
  const bloco = (fins: string[]) =>
    pagina(`
      <div data-proximas-edicoes>
        ${fins
          .map(
            (fim, i) =>
              `<p data-proxima-edicao data-fim="${fim}" ${i > 0 ? 'hidden' : ''}>edição ${i}</p>`,
          )
          .join('')}
      </div>`)
  const escondidos = (raiz: HTMLElement) =>
    [...raiz.querySelectorAll<HTMLElement>('[data-proxima-edicao]')].map(
      (p) => p.hidden,
    )
  const blocoEscondido = (raiz: HTMLElement) =>
    raiz.querySelector<HTMLElement>('[data-proximas-edicoes]')!.hidden

  it('antes da data: a primeira edição fica visível e as outras escondidas', () => {
    const raiz = bloco(['2026-10-20T21:00:00', '2026-11-20T21:00:00'])
    mostrarSoAProximaEdicao(raiz, AGORA)
    expect(escondidos(raiz)).toEqual([false, true])
    expect(blocoEscondido(raiz)).toBe(false)
  })

  it('a primeira já passou: some e a seguinte vira a "próxima edição"', () => {
    const raiz = bloco(['2026-10-09T21:00:00', '2026-11-20T21:00:00'])
    mostrarSoAProximaEdicao(raiz, AGORA)
    expect(escondidos(raiz)).toEqual([true, false])
    expect(blocoEscondido(raiz)).toBe(false)
  })

  it('todas já passaram: o bloco inteiro some (nada de "próxima edição" que já aconteceu)', () => {
    const raiz = bloco(['2026-10-01T21:00:00', '2026-10-09T21:00:00'])
    mostrarSoAProximaEdicao(raiz, AGORA)
    expect(escondidos(raiz)).toEqual([true, true])
    expect(blocoEscondido(raiz)).toBe(true)
  })

  it('o evento de hoje à noite ainda vale ao meio-dia', () => {
    const raiz = bloco(['2026-10-10T21:00:00'])
    mostrarSoAProximaEdicao(raiz, AGORA)
    expect(escondidos(raiz)).toEqual([false])
  })

  it('sem bloco na página não faz nada nem quebra', () => {
    expect(() =>
      mostrarSoAProximaEdicao(pagina('<p>oi</p>'), AGORA),
    ).not.toThrow()
  })
})
