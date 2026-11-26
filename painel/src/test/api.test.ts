import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, alterarSenha, apiFetch, me } from '@/lib/api'
import { clearSession, getAccessToken, setAccessToken } from '@/lib/auth'
import { obterEstado } from '@/lib/network-status'

function jsonResponse(
  status: number,
  body: unknown,
  headers: HeadersInit = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('apiFetch', () => {
  beforeEach(() => {
    setAccessToken('token-antigo')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  it('em 401, tenta renovar via refresh e refaz a chamada original UMA vez', async () => {
    const fetchMock = vi
      .fn()
      // 1ª chamada: a rota protegida devolve 401
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Token expirado' }))
      // 2ª chamada: /auth/refresh renova com sucesso
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'token-novo' }))
      // 3ª chamada: a rota protegida repetida agora funciona
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await apiFetch<{ ok: boolean }>('/rota-protegida')

    expect(resultado).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/auth/refresh')
  })

  it('em 401 com refresh falho, derruba a sessão e lança ApiError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Token expirado' }))
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Refresh inválido' }))
    vi.stubGlobal('fetch', fetchMock)

    const chamada = apiFetch('/rota-protegida')
    await expect(chamada).rejects.toBeInstanceOf(ApiError)
    await expect(chamada).rejects.toThrow('Sessão expirada')
  })

  it('mapeia erro 422 do FastAPI para lista de campos', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(422, {
        detail: [
          { loc: ['body', 'cpf'], msg: 'CPF inválido', type: 'value_error' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/rota')).rejects.toMatchObject({
      status: 422,
      errosCampos: [{ campo: 'cpf', mensagem: 'CPF inválido' }],
    })
  })

  it('tira o prefixo técnico "Value error," da frase que o usuário lê (achado ao vivo na homologação)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(422, {
          detail: [
            {
              loc: ['body', 'cpf'],
              msg: 'Value error, CPF inválido (dígito verificador não confere).',
              type: 'value_error',
            },
          ],
        }),
      ),
    )

    await expect(apiFetch('/rota')).rejects.toMatchObject({
      detail: 'CPF inválido (dígito verificador não confere).',
      errosCampos: [
        {
          campo: 'cpf',
          mensagem: 'CPF inválido (dígito verificador não confere).',
        },
      ],
    })
  })

  it('falha de transporte (fetch lança) marca o estado de rede como offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )

    await expect(apiFetch('/rota')).rejects.toThrow('Failed to fetch')
    expect(obterEstado()).toBe('offline')
  })
})

describe('me() — contrato Zod da resposta de /auth/me', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('aceita uma resposta que bate com o contrato', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          id_usuario: 1,
          mfa_ativado: true,
          mfa_obrigatorio: true,
          mfa_pendente: false,
          permissoes: ['financeiro'],
        }),
      ),
    )
    await expect(me()).resolves.toMatchObject({ id_usuario: 1 })
  })

  it('rejeita quando o backend muda o nome de um campo esperado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          id_usuario: 1,
          // "mfa_ativado" renomeado para "mfaAtivado" — simula uma mudança de contrato do
          // backend sem avisar o front. Isto é o que a v0.2.8 pede para pegar antes do usuário.
          mfaAtivado: true,
          mfa_obrigatorio: true,
          mfa_pendente: false,
          permissoes: ['financeiro'],
        }),
      ),
    )
    await expect(me()).rejects.toThrow(/não bate com o contrato esperado/)
  })
})

// v9.6s (I1 da revisão de portão): trocar a senha encerra todo token de antes da troca, inclusive o desta aba; o servidor devolve o token
// novo da sessão de quem trocou e o painel passa a usá-lo, sem cair fora nem depender da renovação.
describe('alterarSenha', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  it('guarda o token novo que a troca devolve e o usa no pedido seguinte', async () => {
    setAccessToken('token-de-antes-da-troca')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          mensagem: 'Senha alterada com sucesso.',
          access_token: 'token-da-troca',
          expires_in_minutos: 45,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await alterarSenha({ senha_atual: 'Provisoria1', senha_nova: 'MinhaNova9' })

    expect(getAccessToken()).toBe('token-da-troca')
    await apiFetch('/auth/perfil')
    const cabecalhos = new Headers(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).headers,
    )
    expect(cabecalhos.get('Authorization')).toBe('Bearer token-da-troca')
  })
})
