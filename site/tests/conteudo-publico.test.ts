import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  baixarFotoDaTransparencia,
  baixarPdfDaTransparencia,
  verificarTextoDoDocumento,
  buscarConteudoPublico,
  impressaoDoConteudo,
  ligarNoticias,
  normalizarEvento,
  normalizarEventoDetalhado,
  normalizarProjeto,
  normalizarProjetoDetalhado,
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
    '/api/publico/projetos/7': { id_projeto: 7, nome: 'Horta' },
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

  it('lê as 6 listas e o detalhe de cada evento, de cada projeto e de cada parceria', async () => {
    const { fetchImpl, chamadas } = apiFalsa(rotasBase)
    const c = await buscarConteudoPublico('https://api.teste/', {
      fetchImpl,
      esperaMs: 0,
    })
    expect(c.eventos).toHaveLength(2)
    expect(Object.keys(c.detalhesDeEventos)).toEqual(['1', '2'])
    expect(c.projetos[0]!.nome).toBe('Horta')
    expect(Object.keys(c.detalhesDeProjetos)).toEqual(['7'])
    expect(c.parcerias).toHaveLength(1)
    expect(Object.keys(c.detalhesDeParcerias)).toEqual(['3'])
    expect(c.documentos).toEqual([{ id_documento: 9 }])
    expect(chamadas).toHaveLength(10) // 6 listas + 2 detalhes de evento + 1 de projeto + 1 de parceria
    expect(chamadas).toContain('/api/publico/projetos/7')
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

  it('a mensagem diz de onde é a foto (evento x etapa de parceria)', async () => {
    const outra = Buffer.concat([jpeg, Buffer.from(' adulterada')])
    await expect(
      baixarFotoDaTransparencia('https://api.teste', foto, {
        ...com(() => resposta(outra)),
        descricao: 'do evento',
      }),
    ).rejects.toThrow(/A foto 3 do evento não confere com a aprovada/)
    await expect(
      baixarFotoDaTransparencia(
        'https://api.teste',
        foto,
        com(() => resposta(outra)),
      ),
    ).rejects.toThrow(/A foto 3 da transparência não confere/)
  })
})

// ---------------------------------------------------------------------------------------------------- v5.5
// O projeto principal da associação (Despertai) é um projeto em destaque; cada edição é um evento ligado a ele; relatórios
// são documentos aprovados ligados; fotos só com autorização de imagem. O site lê tudo isso no build — e precisa continuar
// construindo se for publicado ANTES da API nova (os dois deploys saem ao mesmo tempo).
const documentoDoContexto = (extra = {}) => ({
  id_documento: 5,
  tipo_codigo: 'RELATORIO_EVENTO',
  tipo: 'Relatório de evento ou de projeto',
  titulo: 'Relatório da 1ª edição',
  formato: 'TEXTO',
  sha256: 'c'.repeat(64),
  arquivo: null,
  vinculo_tipo: 'evento',
  vinculo_id: 4,
  ...extra,
})
const fotoDoContexto = (extra = {}) => ({
  id_foto: 11,
  alt: 'Participantes reunidos na quadra',
  largura: 600,
  altura: 400,
  tamanho: 1000,
  sha256: 'd'.repeat(64),
  arquivo: '/api/publico/eventos/4/fotos/11',
  ...extra,
})
const resumoDeEdicao = (id: number, extra = {}) => ({
  id_evento: id,
  titulo: `Edição ${id}`,
  categoria: 'Encontro',
  data_hora_inicio: '2026-10-10T19:00:00',
  data_hora_fim: null,
  endereco_avulso: null,
  ...extra,
})

describe('buscarConteudoPublico - contexto de projeto e evento (v5.5)', () => {
  const rotasNovas = {
    '/api/publico/eventos': [
      { ...evento(4), id_projeto: 3 },
      { ...evento(5), id_projeto: 3 },
    ],
    '/api/publico/eventos/4': {
      ...evento(4),
      id_projeto: 3,
      sessoes: [],
      projeto: { id_projeto: 3, nome: 'Principal' },
      edicoes: [
        { ...resumoDeEdicao(4), atual: true },
        { ...resumoDeEdicao(5), atual: false },
      ],
      documentos: [documentoDoContexto()],
      fotos: [fotoDoContexto()],
    },
    '/api/publico/eventos/5': {
      ...evento(5),
      id_projeto: 3,
      sessoes: [],
      projeto: { id_projeto: 3, nome: 'Principal' },
      edicoes: [],
      documentos: [],
      fotos: [],
    },
    '/api/publico/projetos': [
      { id_projeto: 3, nome: 'Principal', destaque: true },
    ],
    '/api/publico/projetos/3': {
      id_projeto: 3,
      nome: 'Principal',
      destaque: true,
      eventos: [resumoDeEdicao(5), resumoDeEdicao(4)],
      documentos: [documentoDoContexto()],
      fotos: [{ ...fotoDoContexto(), id_evento: 4 }],
    },
    '/api/publico/diretoria': [],
    '/api/publico/assembleias': [],
    '/api/publico/transparencia/parcerias': [],
    '/api/publico/transparencia/documentos': [],
  }
  const ler = (rotas: Record<string, unknown>) =>
    buscarConteudoPublico('https://api.teste', {
      fetchImpl: apiFalsa(rotas).fetchImpl,
      esperaMs: 0,
    })

  it('guarda o detalhe de cada projeto, com edições, relatórios e fotos', async () => {
    const c = await ler(rotasNovas)
    const detalhe = c.detalhesDeProjetos[3]!
    expect(detalhe.destaque).toBe(true)
    expect(detalhe.eventos.map((e) => e.id_evento)).toEqual([5, 4])
    expect(detalhe.documentos.map((d) => d.id_documento)).toEqual([5])
    expect(detalhe.fotos[0]).toMatchObject({ id_foto: 11, id_evento: 4 })
    expect(c.projetos[0]!.destaque).toBe(true)
    expect(c.eventos[0]!.id_projeto).toBe(3)
    expect(c.detalhesDeEventos[4]!.projeto).toEqual({
      id_projeto: 3,
      nome: 'Principal',
    })
  })

  it('é TOLERANTE a API antiga: sem eventos/documentos/fotos/projeto/edicoes/destaque o build não quebra', async () => {
    const antigas = {
      ...rotasNovas,
      '/api/publico/eventos': [evento(4)],
      '/api/publico/eventos/4': { ...evento(4), sessoes: [] },
      '/api/publico/projetos': [{ id_projeto: 3, nome: 'Principal' }],
      '/api/publico/projetos/3': { id_projeto: 3, nome: 'Principal' },
    }
    const c = await ler(antigas)
    expect(c.projetos[0]!.destaque).toBe(false)
    expect(c.eventos[0]!.id_projeto).toBeNull()
    expect(c.detalhesDeProjetos[3]).toMatchObject({
      destaque: false,
      eventos: [],
      documentos: [],
      fotos: [],
    })
    expect(c.detalhesDeEventos[4]).toMatchObject({
      id_projeto: null,
      projeto: null,
      edicoes: [],
      documentos: [],
      fotos: [],
    })
  })

  it('a impressão digital MUDA quando muda uma foto, um documento ou uma edição (o site é reconstruído)', async () => {
    const original = impressaoDoConteudo(await ler(rotasNovas))
    expect(impressaoDoConteudo(await ler(rotasNovas))).toBe(original)

    const comMudanca = async (chave: string, valor: unknown) =>
      impressaoDoConteudo(await ler({ ...rotasNovas, [chave]: valor }))
    const projeto = rotasNovas['/api/publico/projetos/3']
    const evento4 = rotasNovas['/api/publico/eventos/4']

    // foto trocada (o arquivo muda, o SHA-256 muda) ou nova foto na galeria do projeto
    expect(
      await comMudanca('/api/publico/eventos/4', {
        ...evento4,
        fotos: [fotoDoContexto({ sha256: 'e'.repeat(64) })],
      }),
    ).not.toBe(original)
    expect(
      await comMudanca('/api/publico/projetos/3', {
        ...projeto,
        fotos: [
          { ...fotoDoContexto({ id_foto: 12 }), id_evento: 4 },
          ...projeto.fotos,
        ],
      }),
    ).not.toBe(original)
    // relatório aprovado novo, ou trocado
    expect(
      await comMudanca('/api/publico/projetos/3', {
        ...projeto,
        documentos: [
          ...projeto.documentos,
          documentoDoContexto({ id_documento: 6 }),
        ],
      }),
    ).not.toBe(original)
    expect(
      await comMudanca('/api/publico/eventos/4', {
        ...evento4,
        documentos: [documentoDoContexto({ sha256: 'f'.repeat(64) })],
      }),
    ).not.toBe(original)
    // nova edição do projeto
    expect(
      await comMudanca('/api/publico/projetos/3', {
        ...projeto,
        eventos: [resumoDeEdicao(6), ...projeto.eventos],
      }),
    ).not.toBe(original)
    // o projeto entra ou sai de destaque
    expect(
      await comMudanca('/api/publico/projetos', [
        { id_projeto: 3, nome: 'Principal', destaque: false },
      ]),
    ).not.toBe(original)
  })
})

describe('normalização (API antiga)', () => {
  it('projeto: destaque só vale se for exatamente true', () => {
    expect(normalizarProjeto({ id_projeto: 1 }).destaque).toBe(false)
    expect(normalizarProjeto({ id_projeto: 1, destaque: 'sim' }).destaque).toBe(
      false,
    )
    expect(normalizarProjeto({ id_projeto: 1, destaque: true }).destaque).toBe(
      true,
    )
  })
  it('projeto detalhado e evento detalhado: ausência vira lista vazia ou null, e o que veio é mantido', () => {
    expect(normalizarProjetoDetalhado({ id_projeto: 1 })).toEqual({
      id_projeto: 1,
      destaque: false,
      eventos: [],
      documentos: [],
      fotos: [],
    })
    const evento = normalizarEventoDetalhado({
      id_evento: 2,
      fotos: [fotoDoContexto()],
    })
    expect(evento).toMatchObject({
      id_projeto: null,
      projeto: null,
      edicoes: [],
      documentos: [],
    })
    expect(evento.fotos).toHaveLength(1)
    expect(normalizarEvento({ id_evento: 2, id_projeto: 3 }).id_projeto).toBe(3)
    // valor que não é lista (resposta torta) também vira lista vazia, nunca quebra o build
    expect(
      normalizarProjetoDetalhado({
        id_projeto: 1,
        eventos: null as never,
        fotos: 'x' as never,
      }),
    ).toMatchObject({ eventos: [], fotos: [] })
  })
})

describe('ligarNoticias', () => {
  const noticia = (extra = {}) => ({
    id: 'n1',
    titulo: 'Encontro',
    slug: 'encontro',
    resumo: 'r',
    corpoHtml: '<p>t</p>',
    publicadaEm: '2026-10-01T10:00:00.000Z',
    atualizadaEm: null,
    imagem: null,
    projetoId: null,
    eventoId: null,
    ...extra,
  })
  const existentes = {
    projetos: [{ id_projeto: 3 }],
    eventos: [{ id_evento: 4 }],
  }

  it('mantém a ligação com projeto e evento que existem (e públicos)', () => {
    const { noticias, avisos } = ligarNoticias(
      [noticia({ projetoId: 3, eventoId: 4 })],
      existentes,
    )
    expect(noticias[0]).toMatchObject({ projetoId: 3, eventoId: 4 })
    expect(avisos).toEqual([])
  })

  it('número que não existe: a notícia É publicada sem a ligação e o aviso diz o motivo em português', () => {
    const { noticias, avisos } = ligarNoticias(
      [noticia({ projetoId: 999, eventoId: 998 })],
      existentes,
    )
    expect(noticias).toHaveLength(1)
    expect(noticias[0]).toMatchObject({ projetoId: null, eventoId: null })
    expect(avisos).toHaveLength(2)
    expect(avisos[0]).toMatchObject({
      id: 'n1',
      titulo: 'Encontro',
      publicada: true,
    })
    expect(avisos[0]!.motivo).toMatch(
      /projeto nº 999 não existe ou não é público/,
    )
    expect(avisos[1]!.motivo).toMatch(
      /evento nº 998 não existe ou não é público/,
    )
  })

  it('desfaz só a ligação que está errada', () => {
    const { noticias, avisos } = ligarNoticias(
      [noticia({ projetoId: 3, eventoId: 998 })],
      existentes,
    )
    expect(noticias[0]).toMatchObject({ projetoId: 3, eventoId: null })
    expect(avisos).toHaveLength(1)
  })

  it('notícia sem ligação (ou de uma versão antiga sem os campos) passa intacta, com null', () => {
    const { projetoId, eventoId, ...antiga } = noticia()
    void projetoId
    void eventoId
    const { noticias, avisos } = ligarNoticias([antiga as never], existentes)
    expect(noticias[0]).toMatchObject({ projetoId: null, eventoId: null })
    expect(avisos).toEqual([])
  })
})
