import { describe, expect, it, vi } from 'vitest'

import { ApiError, buscarEventosPublicos, buscarJson } from '../src/lib/api'

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('buscarJson', () => {
  it('junta a base ao caminho e devolve o JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respostaJson([{ a: 1 }]))
    const dados = await buscarJson<{ a: number }[]>('/api/x', {
      baseUrl: 'https://api.exemplo.org',
      fetchImpl,
    })
    expect(dados).toEqual([{ a: 1 }])
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.exemplo.org/api/x')
  })

  it('nunca envia cookie/credencial do navegador (rotas públicas)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respostaJson([]))
    await buscarJson('/api/x', { baseUrl: 'https://a.org', fetchImpl })
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' })
  })

  it('resposta de erro vira ApiError com o status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respostaJson({}, 503))
    const erro = await buscarJson('/x', {
      baseUrl: 'https://a.org',
      fetchImpl,
    }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ApiError)
    expect((erro as ApiError).status).toBe(503)
  })

  it('falha de rede vira ApiError, não exceção solta', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      buscarJson('/x', { baseUrl: 'https://a.org', fetchImpl }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('desiste depois do tempo máximo (API que escala a zero pode travar)', async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, rejeitar) => {
          init?.signal?.addEventListener('abort', () =>
            rejeitar(new DOMException('abortado', 'AbortError')),
          )
        }),
    ) as unknown as typeof fetch
    const erro = await buscarJson('/x', {
      baseUrl: 'https://a.org',
      fetchImpl,
      timeoutMs: 20,
    }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ApiError)
    expect((erro as ApiError).message).toMatch(/demorou/)
  })
})

describe('buscarEventosPublicos', () => {
  it('chama a rota pública de leitura de eventos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respostaJson([]))
    await buscarEventosPublicos({
      baseUrl: 'https://api.asaf.org.br',
      fetchImpl,
    })
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.asaf.org.br/api/publico/eventos',
    )
  })
})
