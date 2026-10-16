import { describe, expect, it, vi } from 'vitest'

import { ApiError, buscarJson, enviarJson } from '../src/lib/api'

// v5.6a — o motivo que a API dá quando recusa: texto (regra de negócio) ou lista de validação do FastAPI (um motivo por campo). A doação pelo site liga cada motivo ao campo
// certo e mostra a frase da consulta recusada (valor ou campanha que não valem, Pix indisponível).

const resposta = (corpo: unknown, status: number) =>
  new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

async function falhaDo(promessa: Promise<unknown>): Promise<ApiError> {
  const erro = await promessa.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(erro).toBeInstanceOf(ApiError)
  return erro as ApiError
}

describe('enviarJson: o motivo da recusa', () => {
  it('detail em texto vira `detalhe`, sem lista de erros', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(resposta({ detail: 'Pix indisponível.' }, 503))
    const erro = await falhaDo(
      enviarJson('/x', {}, { baseUrl: 'https://api.teste', fetchImpl }),
    )
    expect(erro.status).toBe(503)
    expect(erro.detalhe).toBe('Pix indisponível.')
    expect(erro.erros).toBeUndefined()
  })

  it('detail em lista (422): `detalhe` é o primeiro motivo e `erros` traz todos, cada um com o campo e sem o "Value error, "', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta(
        {
          detail: [
            {
              type: 'value_error',
              loc: ['body', 'nome_completo'],
              msg: 'Value error, Informe o seu nome completo.',
            },
            {
              type: 'value_error',
              loc: ['body', 'email'],
              msg: 'Value error, Esse e-mail não parece certo.',
            },
            { type: 'missing', loc: ['body', 'cpf'], msg: 'Field required' },
            { type: 'x', loc: [], msg: 'Sem campo' },
          ],
        },
        422,
      ),
    )
    const erro = await falhaDo(
      enviarJson('/x', {}, { baseUrl: 'https://api.teste', fetchImpl }),
    )
    expect(erro.detalhe).toBe('Informe o seu nome completo.')
    expect(erro.erros).toEqual([
      { campo: 'nome_completo', mensagem: 'Informe o seu nome completo.' },
      { campo: 'email', mensagem: 'Esse e-mail não parece certo.' },
      { campo: 'cpf', mensagem: 'Field required' },
      { campo: '', mensagem: 'Sem campo' },
    ])
  })

  it('lista sem nenhuma mensagem legível, ou corpo que não é JSON: sem detalhe', async () => {
    const semMsg = await falhaDo(
      enviarJson(
        '/x',
        {},
        {
          baseUrl: 'https://api.teste',
          fetchImpl: vi
            .fn()
            .mockResolvedValue(resposta({ detail: [{ loc: ['body'] }] }, 422)),
        },
      ),
    )
    expect(semMsg.detalhe).toBeUndefined()
    expect(semMsg.erros).toBeUndefined()
    const html = await falhaDo(
      enviarJson(
        '/x',
        {},
        {
          baseUrl: 'https://api.teste',
          fetchImpl: vi.fn().mockResolvedValue(resposta('<html>', 502)),
        },
      ),
    )
    expect(html.status).toBe(502)
    expect(html.detalhe).toBeUndefined()
  })
})

describe('buscarJson: a consulta recusada também explica por quê', () => {
  it('400 com o motivo em texto: `detalhe` (e nenhuma nova tentativa: pedido errado continua errado)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        resposta(
          { detail: 'O valor da doação precisa ser maior que zero.' },
          400,
        ),
      )
    const erro = await falhaDo(
      buscarJson('/x', {
        baseUrl: 'https://api.teste',
        fetchImpl,
        tentativas: 3,
        esperaEntreTentativasMs: 0,
      }),
    )
    expect(erro.status).toBe(400)
    expect(erro.detalhe).toBe('O valor da doação precisa ser maior que zero.')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('503 sem corpo legível continua sendo repetido e termina só com o status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta('', 503))
    const erro = await falhaDo(
      buscarJson('/x', {
        baseUrl: 'https://api.teste',
        fetchImpl,
        tentativas: 2,
        esperaEntreTentativasMs: 0,
      }),
    )
    expect(erro.status).toBe(503)
    expect(erro.detalhe).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
