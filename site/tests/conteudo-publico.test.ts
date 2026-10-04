import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  baixarFotoDaTransparencia,
  baixarPdfDaTransparencia,
  verificarTextoDoDocumento,
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
    '/api/publico/transparencia/parcerias': [
      { id_parceria: 3, titulo: 'Emenda' },
    ],
    '/api/publico/transparencia/parcerias/3': {
      id_parceria: 3,
      titulo: 'Emenda',
      parcelas: [],
    },
    '/api/publico/transparencia/documentos': [{ id_documento: 9 }],
  }

  it('lê as 6 listas e o detalhe de cada evento e de cada parceria', async () => {
    const { fetchImpl, chamadas } = apiFalsa(rotasBase)
    const c = await buscarConteudoPublico('https://api.teste/', {
      fetchImpl,
      esperaMs: 0,
    })
    expect(c.eventos).toHaveLength(2)
    expect(Object.keys(c.detalhesDeEventos)).toEqual(['1', '2'])
    expect(c.projetos[0]!.nome).toBe('Horta')
    expect(c.parcerias).toHaveLength(1)
    expect(Object.keys(c.detalhesDeParcerias)).toEqual(['3'])
    expect(c.documentos).toEqual([{ id_documento: 9 }])
    expect(chamadas).toHaveLength(9) // 6 listas + 2 detalhes de evento + 1 de parceria
  })

  it('FALHA o build se a lista de parcerias não responder (nunca publica uma Transparência incompleta)', async () => {
    const { fetchImpl } = apiFalsa(rotasBase, {
      '/api/publico/transparencia/parcerias': [503, 503, 503],
    })
    await expect(
      buscarConteudoPublico('https://api.teste', {
        fetchImpl,
        esperaMs: 0,
        tentativas: 3,
      }),
    ).rejects.toThrow(/transparencia\/parcerias/)
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
    parcerias: [{ id_parceria: 3, titulo: 'Emenda', valor_total: 100 }],
    detalhesDeParcerias: { 3: { id_parceria: 3, parcelas: [] } },
    documentos: [{ id_documento: 9, sha256: 'a'.repeat(64) }],
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

describe('impressaoDoConteudo - Transparência (v5.4b)', () => {
  const com = () => ({
    eventos: [],
    detalhesDeEventos: {},
    projetos: [],
    diretoria: [],
    assembleias: [],
    parcerias: [{ id_parceria: 3, titulo: 'Emenda', recebido: 100 }],
    detalhesDeParcerias: { 3: { id_parceria: 3, pagamentos: [] } },
    documentos: [{ id_documento: 9, sha256: 'a'.repeat(64) }],
  })

  it('MUDA quando entra dinheiro, um pagamento ou um documento é trocado (o site é reconstruído)', () => {
    const original = impressaoDoConteudo(com())
    const recebido = com()
    recebido.parcerias[0]!.recebido = 200
    const trocado = com()
    trocado.documentos[0]!.sha256 = 'b'.repeat(64)
    const novo = com()
    novo.parcerias.push({ id_parceria: 4, titulo: 'Outra', recebido: 0 })
    expect(impressaoDoConteudo(recebido)).not.toBe(original)
    expect(impressaoDoConteudo(trocado)).not.toBe(original)
    expect(impressaoDoConteudo(novo)).not.toBe(original)
  })
})

describe('baixarPdfDaTransparencia', () => {
  const bytes = Buffer.from('%PDF-1.4\nconteudo aprovado\n%%EOF\n')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const documento = {
    id_documento: 9,
    titulo: 'Ata de eleição',
    sha256,
    arquivo: '/api/publico/transparencia/documentos/9/arquivo',
  }

  function apiComPdf(resposta: () => Response) {
    const fetchImpl = vi.fn(async () => resposta()) as unknown as typeof fetch
    return { fetchImpl }
  }
  const pdf = (conteudo: Buffer, status = 200) =>
    new Response(new Uint8Array(conteudo), {
      status,
      headers: { 'Content-Type': 'application/pdf' },
    })

  it('devolve os bytes quando é PDF e o SHA-256 bate com o aprovado', async () => {
    const { fetchImpl } = apiComPdf(() => pdf(bytes))
    const recebido = await baixarPdfDaTransparencia(
      'https://api.teste/',
      documento,
      {
        fetchImpl,
        esperaMs: 0,
      },
    )
    expect(Buffer.compare(recebido, bytes)).toBe(0)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.teste/api/publico/transparencia/documentos/9/arquivo',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/pdf' }),
      }),
    )
  })

  it('RECUSA (derruba o build) um arquivo diferente do aprovado', async () => {
    const outro = Buffer.from('%PDF-1.4\nOUTRO conteudo\n%%EOF\n')
    const { fetchImpl } = apiComPdf(() => pdf(outro))
    await expect(
      baixarPdfDaTransparencia('https://api.teste', documento, {
        fetchImpl,
        esperaMs: 0,
      }),
    ).rejects.toThrow(/não confere com o que foi aprovado/)
  })

  it('RECUSA o que não é PDF, mesmo com o SHA-256 igual ao declarado', async () => {
    const html = Buffer.from('<html>erro</html>')
    const { fetchImpl } = apiComPdf(() => pdf(html))
    await expect(
      baixarPdfDaTransparencia(
        'https://api.teste',
        {
          ...documento,
          sha256: createHash('sha256').update(html).digest('hex'),
        },
        { fetchImpl, esperaMs: 0 },
      ),
    ).rejects.toThrow(/não é um PDF/)
  })

  it('repete o que é passageiro (API acordando) e desiste de erro 404', async () => {
    let chamadas = 0
    const acordando = vi.fn(async () => {
      chamadas += 1
      return chamadas < 3 ? new Response('', { status: 503 }) : pdf(bytes)
    }) as unknown as typeof fetch
    const ok = await baixarPdfDaTransparencia('https://api.teste', documento, {
      fetchImpl: acordando,
      esperaMs: 0,
    })
    expect(Buffer.compare(ok, bytes)).toBe(0)
    expect(chamadas).toBe(3)

    const naoExiste = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch
    await expect(
      baixarPdfDaTransparencia('https://api.teste', documento, {
        fetchImpl: naoExiste,
        esperaMs: 0,
      }),
    ).rejects.toThrow(/404/)
    expect(naoExiste).toHaveBeenCalledTimes(1)
  })
})

describe('verificarTextoDoDocumento', () => {
  const texto = 'ART. 1 - Texto aprovado.\n\nART. 2 - Outro artigo.'
  const sha = createHash('sha256').update(texto, 'utf8').digest('hex')
  const detalhe = { id_documento: 4, titulo: 'Estatuto', sha256: sha, texto }

  it('aceita o texto cujo SHA-256 (dos bytes UTF-8) bate com o aprovado', () => {
    expect(() => verificarTextoDoDocumento(detalhe)).not.toThrow()
  })
  it('RECUSA (derruba o build) texto diferente do aprovado, vazio ou ausente', () => {
    expect(() =>
      verificarTextoDoDocumento({ ...detalhe, texto: texto + ' alterado' }),
    ).toThrow(/não confere com o que foi aprovado/)
    expect(() =>
      verificarTextoDoDocumento({ ...detalhe, texto: '   ' }),
    ).toThrow(/veio sem texto/)
    expect(() =>
      verificarTextoDoDocumento({ ...detalhe, texto: null }),
    ).toThrow(/veio sem texto/)
  })
  it('acento conta: o SHA-256 é dos bytes UTF-8', () => {
    const acentuado = 'Associação — ação'
    expect(() =>
      verificarTextoDoDocumento({
        ...detalhe,
        texto: acentuado,
        sha256: createHash('sha256').update(acentuado, 'utf8').digest('hex'),
      }),
    ).not.toThrow()
  })
})

describe('buscarConteudoPublico - documentos em texto', () => {
  const texto = 'ART. 1 - Texto aprovado do estatuto.'
  const sha = createHash('sha256').update(texto, 'utf8').digest('hex')
  const rotas = {
    '/api/publico/eventos': [],
    '/api/publico/projetos': [],
    '/api/publico/diretoria': [],
    '/api/publico/assembleias': [],
    '/api/publico/transparencia/parcerias': [],
    '/api/publico/transparencia/documentos': [
      {
        id_documento: 4,
        formato: 'TEXTO',
        titulo: 'Estatuto',
        sha256: sha,
        arquivo: null,
      },
      {
        id_documento: 5,
        formato: 'PDF',
        titulo: 'Ata',
        sha256: 'a'.repeat(64),
        arquivo: '/x',
      },
    ],
    '/api/publico/transparencia/documentos/4': {
      id_documento: 4,
      formato: 'TEXTO',
      titulo: 'Estatuto',
      sha256: sha,
      texto,
    },
  }
  const fetchDe = (r: Record<string, unknown>) =>
    (async (url: string) => {
      const caminho = String(url).replace('https://api.teste', '')
      return caminho in r
        ? new Response(JSON.stringify(r[caminho]), { status: 200 })
        : new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

  it('busca o detalhe SÓ do documento em texto (o PDF não precisa)', async () => {
    const c = await buscarConteudoPublico('https://api.teste', {
      fetchImpl: fetchDe(rotas),
      esperaMs: 0,
    })
    expect(Object.keys(c.detalhesDeDocumentos)).toEqual(['4'])
    expect(c.detalhesDeDocumentos[4]!.texto).toBe(texto)
  })

  it('FALHA o build se o texto que a API entrega não é o aprovado', async () => {
    const adulterada = {
      ...rotas,
      '/api/publico/transparencia/documentos/4': {
        ...rotas['/api/publico/transparencia/documentos/4'],
        texto: texto + ' (editado por fora)',
      },
    }
    await expect(
      buscarConteudoPublico('https://api.teste', {
        fetchImpl: fetchDe(adulterada),
        esperaMs: 0,
      }),
    ).rejects.toThrow(/não confere com o que foi aprovado/)
  })
})

describe('baixarFotoDaTransparencia', () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('conteudo da foto aprovada'),
  ])
  const foto = {
    id_foto: 3,
    sha256: createHash('sha256').update(jpeg).digest('hex'),
    arquivo: '/api/publico/transparencia/parcerias/1/fotos/3',
  }
  const resposta = (conteudo: Buffer, status = 200) =>
    new Response(new Uint8Array(conteudo), { status })
  const com = (fn: () => Response) => ({
    fetchImpl: vi.fn(async () => fn()) as unknown as typeof fetch,
    esperaMs: 0,
  })

  it('devolve os bytes quando é JPEG e o SHA-256 bate com o aprovado', async () => {
    const recebido = await baixarFotoDaTransparencia(
      'https://api.teste/',
      foto,
      com(() => resposta(jpeg)),
    )
    expect(Buffer.compare(recebido, jpeg)).toBe(0)
  })

  it('RECUSA (derruba o build) foto diferente da aprovada ou que não é JPEG', async () => {
    const outra = Buffer.concat([jpeg, Buffer.from(' adulterada')])
    await expect(
      baixarFotoDaTransparencia(
        'https://api.teste',
        foto,
        com(() => resposta(outra)),
      ),
    ).rejects.toThrow(/não confere com a aprovada/)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(
      baixarFotoDaTransparencia(
        'https://api.teste',
        { ...foto, sha256: createHash('sha256').update(png).digest('hex') },
        com(() => resposta(png)),
      ),
    ).rejects.toThrow(/não é um JPEG/)
  })

  it('foto retirada (404) não é repetida e derruba o build', async () => {
    const e = com(() => resposta(Buffer.from(''), 404))
    await expect(
      baixarFotoDaTransparencia('https://api.teste', foto, e),
    ).rejects.toThrow(/404/)
    expect(e.fetchImpl).toHaveBeenCalledTimes(1)
  })
})
