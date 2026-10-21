// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import {
  fraseDaSituacao,
  fraseDoResultado,
  iniciarPaginaDeDescadastro,
  lerToken,
} from '../src/lib/descadastro'

// v6.2b - a página /descadastrar/: o token do link e o que a página faz com ele.
const TOKEN = '101.avisos.0123456789abcdef0123456789abcdef'

describe('o token do link', () => {
  it('aceita só o formato do servidor (número.tipo.assinatura)', () => {
    expect(lerToken(`?token=${TOKEN}`)).toEqual({ estado: 'ok', token: TOKEN })
    expect(lerToken('')).toEqual({ estado: 'ausente' })
    expect(lerToken('?token=')).toEqual({ estado: 'ausente' })
    for (const ruim of [
      '101.avisos.0123',
      'abc.avisos.0123456789abcdef0123456789abcdef',
      '101.Avisos.0123456789abcdef0123456789abcdef',
      '101.avisos.0123456789ABCDEF0123456789ABCDEF',
      '<script>',
    ])
      expect(lerToken(`?token=${encodeURIComponent(ruim)}`)).toEqual({
        estado: 'invalido',
      })
  })

  it('as frases dizem o que vale agora', () => {
    const s = {
      tipo: 'avisos',
      rotulo: 'Lembretes de mensalidade',
      recebe: true,
    }
    expect(fraseDaSituacao(s)).toBe(
      'Você recebe este tipo de e-mail da ASAF: Lembretes de mensalidade.',
    )
    expect(fraseDaSituacao({ ...s, recebe: false })).toContain(
      'NÃO recebe mais',
    )
    expect(fraseDoResultado({ ...s, recebe: true })).toBe(
      'Pronto: você voltará a receber este tipo de e-mail.',
    )
  })
})

function montar() {
  document.body.innerHTML = `
    <div data-descadastro data-api-url="https://api.teste">
      <p data-estado="carregando"></p>
      <div data-estado="sem-token" hidden></div>
      <div data-estado="invalido" hidden></div>
      <div data-estado="erro" hidden></div>
      <div data-estado="ok" hidden>
        <p data-situacao></p>
        <button data-parar hidden></button>
        <button data-voltar-a-receber hidden></button>
        <p data-resultado hidden></p>
        <p data-falha hidden></p>
      </div>
    </div>`
  return document.querySelector<HTMLElement>('[data-descadastro]')!
}

const resposta = (corpo: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

describe('a página', () => {
  it('sem token, não chama a API', () => {
    const raiz = montar()
    const fetchImpl = vi.fn()
    iniciarPaginaDeDescadastro(raiz, {
      busca: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(
      raiz.querySelector<HTMLElement>('[data-estado="sem-token"]')!.hidden,
    ).toBe(false)
  })

  it('mostra a escolha como TEXTO e só muda quando a pessoa clica', async () => {
    const raiz = montar()
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(
        resposta({ tipo: 'avisos', rotulo: '<b>Avisos</b>', recebe: true }),
      )
      .mockReturnValueOnce(
        resposta({ tipo: 'avisos', rotulo: '<b>Avisos</b>', recebe: false }),
      )
    iniciarPaginaDeDescadastro(raiz, {
      busca: `?token=${TOKEN}`,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await vi.waitFor(() =>
      expect(
        raiz.querySelector<HTMLElement>('[data-estado="ok"]')!.hidden,
      ).toBe(false),
    )
    expect(raiz.querySelector('b')).toBeNull()
    expect(raiz.querySelector('[data-situacao]')!.textContent).toContain(
      '<b>Avisos</b>',
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    raiz.querySelector<HTMLButtonElement>('[data-parar]')!.click()
    await vi.waitFor(() =>
      expect(raiz.querySelector<HTMLElement>('[data-resultado]')!.hidden).toBe(
        false,
      ),
    )
    const [, init] = fetchImpl.mock.calls[1]!
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      token: TOKEN,
      recebe: false,
    })
    expect(
      raiz.querySelector<HTMLElement>('[data-voltar-a-receber]')!.hidden,
    ).toBe(false)
  })

  it('token que o servidor não reconhece (404) mostra "link inválido"', async () => {
    const raiz = montar()
    const fetchImpl = vi
      .fn()
      .mockReturnValue(
        resposta({ detail: 'Link inválido ou incompleto.' }, 404),
      )
    iniciarPaginaDeDescadastro(raiz, {
      busca: `?token=${TOKEN}`,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await vi.waitFor(() =>
      expect(
        raiz.querySelector<HTMLElement>('[data-estado="invalido"]')!.hidden,
      ).toBe(false),
    )
  })
})
