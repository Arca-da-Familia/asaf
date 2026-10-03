import { describe, expect, it, vi } from 'vitest'

import {
  buscarConteudoPublico,
  impressaoDoConteudo,
} from '../scripts/lib/conteudo-publico.mjs'

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** API falsa que responde pelo caminho. */
function apiFalsa(
  rotas: Record<string, unknown>,
  falhas: Record<string, number[]> = {},
) {
  const chamadas: string[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const caminho = String(url).replace('https://api.teste', '')
    chamadas.push(caminho)
    const contador = chamadas.filter((c) => c === caminho).length
    const status = falhas[caminho]?.[contador - 1]
    if (status) return json({}, status)
    if (caminho in rotas) return json(rotas[caminho])
    return json({ detail: 'não existe' }, 404)
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, chamadas }
}

const evento = (id: number, extra = {}) => ({
  id_evento: id,
  titulo: `Evento ${id}`,
  vagas: 10,
  vagas_livres: 4,
  ...extra,
})

describe('buscarConteudoPublico', () => {
  const rotasBase = {
    '/api/publico/eventos': [evento(1), evento(2)],
    '/api/publico/eventos/1': { ...evento(1), sessoes: [] },
    '/api/publico/eventos/2': { ...evento(2), sessoes: [] },
    '/api/publico/projetos': [{ id_projeto: 7, nome: 'Horta' }],
    '/api/publico/diretoria': [],
    '/api/publico/assembleias': [],
  }

  it('lê as 4 listas e o detalhe de cada evento', async () => {
    const { fetchImpl, chamadas } = apiFalsa(rotasBase)
    const c = await buscarConteudoPublico('https://api.teste/', {
      fetchImpl,
      esperaMs: 0,
    })
    expect(c.eventos).toHaveLength(2)
    expect(Object.keys(c.detalhesDeEventos)).toEqual(['1', '2'])
    expect(c.projetos[0]!.nome).toBe('Horta')
    expect(chamadas).toHaveLength(6) // 4 listas + 2 detalhes
  })

  it('repete o que é passageiro (API acordando: 503 e depois 200)', async () => {
    const { fetchImpl } = apiFalsa(rotasBase, {
      '/api/publico/projetos': [503, 502],
    })
    const c = await buscarConteudoPublico('https://api.teste', {
      fetchImpl,
      esperaMs: 0,
    })
    expect(c.projetos).toHaveLength(1)
  })

  it('FALHA o build se a API continuar fora (nunca publica um site sem dados)', async () => {
    const { fetchImpl } = apiFalsa(rotasBase, {
      '/api/publico/diretoria': [503, 503, 503],
    })
    await expect(
      buscarConteudoPublico('https://api.teste', {
        fetchImpl,
        esperaMs: 0,
        tentativas: 3,
      }),
    ).rejects.toThrow(/diretoria/)
  })

  it('erro 4xx não é repetido (pedido errado continua errado)', async () => {
    const { fetchImpl, chamadas } = apiFalsa({}) // tudo 404
    await expect(
      buscarConteudoPublico('https://api.teste', { fetchImpl, esperaMs: 0 }),
    ).rejects.toThrow(/404/)
    // Cada rota foi tentada UMA vez.
    expect(new Set(chamadas).size).toBe(chamadas.length)
  })
})

describe('impressaoDoConteudo', () => {
  const base = () => ({
    eventos: [evento(1)],
    detalhesDeEventos: { 1: { ...evento(1), sessoes: [] } },
    projetos: [{ id_projeto: 7, nome: 'Horta' }],
    diretoria: [],
    assembleias: [],
  })

  it('é estável: o mesmo conteúdo dá sempre a mesma impressão', () => {
    expect(impressaoDoConteudo(base())).toBe(impressaoDoConteudo(base()))
    expect(impressaoDoConteudo(base())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('não depende da ordem das chaves do JSON', () => {
    const a = { ...base(), projetos: [{ id_projeto: 7, nome: 'Horta' }] }
    const b = { ...base(), projetos: [{ nome: 'Horta', id_projeto: 7 }] }
    expect(impressaoDoConteudo(a)).toBe(impressaoDoConteudo(b))
  })

  it('IGNORA vagas livres: uma inscrição nova não reconstrói o site', () => {
    const depois = base()
    depois.eventos[0]!.vagas_livres = 0
    ;(depois.detalhesDeEventos[1] as { vagas_livres: number }).vagas_livres = 0
    expect(impressaoDoConteudo(depois)).toBe(impressaoDoConteudo(base()))
  })

  it('MUDA quando algo que as páginas mostram muda', () => {
    const titulo = base()
    titulo.eventos[0]!.titulo = 'Outro título'
    const projeto = base()
    projeto.projetos.push({ id_projeto: 8, nome: 'Nova horta' })
    const original = impressaoDoConteudo(base())
    expect(impressaoDoConteudo(titulo)).not.toBe(original)
    expect(impressaoDoConteudo(projeto)).not.toBe(original)
  })
})
