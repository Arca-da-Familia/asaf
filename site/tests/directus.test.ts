import { describe, expect, it, vi } from 'vitest'

import {
  buscarConteudoPublico,
  impressaoDoConteudo,
} from '../scripts/lib/conteudo-publico.mjs'
import {
  anunciarAvisosDeNoticias,
  baixarImagem,
  buscarNoticias,
  configuracaoDoDirectus,
  sanitizarCorpo,
  validarNoticias,
} from '../scripts/lib/directus.mjs'

const AGORA = new Date('2026-10-10T12:00:00Z')

const bruta = (extra: Record<string, unknown> = {}) => ({
  id: 'n1',
  status: 'publicado',
  titulo: 'Encontro de famílias',
  slug: 'encontro-de-familias',
  resumo: 'Resumo da notícia.',
  corpo: '<p>Texto da notícia.</p>',
  publicada_em: '2026-10-01T10:00:00Z',
  date_updated: '2026-10-02T10:00:00Z',
  imagem: null,
  imagem_alt: null,
  autorizacao_imagem: false,
  ...extra,
})

const comFoto = (extra: Record<string, unknown> = {}) =>
  bruta({
    imagem: { id: 'arq-1', width: 1600, height: 900 },
    imagem_alt: 'Crianças lendo no pátio da sede',
    autorizacao_imagem: true,
    ...extra,
  })

describe('sanitizarCorpo', () => {
  it('remove script, evento, estilo, iframe e imagem solta', () => {
    const limpo = sanitizarCorpo(
      '<p onclick="x()">Oi</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><img src="a.png" alt="">',
    )
    expect(limpo).toBe('<p>Oi</p>')
  })

  it('só deixa link http, https, mailto e tel, e põe rel seguro', () => {
    const limpo = sanitizarCorpo(
      '<a href="javascript:alert(1)">ruim</a> <a href="https://exemplo.org/x">bom</a> <a href="//evil.com">rel</a>',
    )
    expect(limpo).not.toContain('javascript:')
    expect(limpo).not.toContain('//evil.com')
    expect(limpo).toContain('href="https://exemplo.org/x"')
    expect(limpo).toContain('rel="noopener noreferrer"')
  })

  it('link com destino barrado vira só texto (nunca um <a> sem href)', () => {
    const limpo = sanitizarCorpo(
      '<p>Veja <a href="javascript:alert(1)">aqui</a> e <a href="https://exemplo.org">ali</a>.</p>',
    )
    expect(limpo).not.toMatch(/<a(?![^>]*href)/)
    expect(limpo).toContain('Veja aqui e <a')
    expect(limpo).toContain('href="https://exemplo.org"')
  })

  it('rebaixa h1 para h2 (o título da notícia é o h1 da página) e h5/h6 para h4', () => {
    expect(sanitizarCorpo('<h1>A</h1><h5>B</h5><h6>C</h6>')).toBe(
      '<h2>A</h2><h4>B</h4><h4>C</h4>',
    )
  })

  it('descarta parágrafo vazio do editor', () => {
    expect(sanitizarCorpo('<p>&nbsp;</p><p><br></p><p>Texto</p>')).toBe(
      '<p>Texto</p>',
    )
  })

  it('aceita lista, ênfase e citação', () => {
    const html =
      '<ul><li><strong>a</strong></li></ul><blockquote><em>b</em></blockquote>'
    expect(sanitizarCorpo(html)).toBe(html)
  })
})

describe('validarNoticias', () => {
  it('aceita a notícia completa, sem foto', () => {
    const { noticias, avisos } = validarNoticias([bruta()], AGORA)
    expect(avisos).toEqual([])
    expect(noticias).toHaveLength(1)
    expect(noticias[0]).toMatchObject({
      id: 'n1',
      slug: 'encontro-de-familias',
      corpoHtml: '<p>Texto da notícia.</p>',
      imagem: null,
      publicadaEm: '2026-10-01T10:00:00.000Z',
    })
  })

  it('aceita foto COM texto alternativo e autorização, guardando as dimensões', () => {
    const { noticias } = validarNoticias([comFoto()], AGORA)
    expect(noticias[0]!.imagem).toEqual({
      id: 'arq-1',
      alt: 'Crianças lendo no pátio da sede',
      largura: 1600,
      altura: 900,
    })
  })

  it('RECUSA a notícia inteira se a foto não tem texto alternativo', () => {
    const { noticias, avisos } = validarNoticias(
      [comFoto({ imagem_alt: '  ' })],
      AGORA,
    )
    expect(noticias).toEqual([])
    expect(avisos[0]!.motivo).toMatch(/texto alternativo/)
  })

  it('RECUSA a notícia inteira se a autorização de imagem não foi confirmada', () => {
    for (const autorizacao of [false, null, undefined, 'true', 1]) {
      const { noticias, avisos } = validarNoticias(
        [comFoto({ autorizacao_imagem: autorizacao })],
        AGORA,
      )
      expect(noticias).toEqual([])
      expect(avisos[0]!.motivo).toMatch(/autorização/)
    }
  })

  it('só publica o que está "publicado" e com data já vencida', () => {
    const { noticias, avisos } = validarNoticias(
      [
        bruta({ id: 'rascunho', status: 'rascunho', slug: 'a' }),
        bruta({ id: 'revisao', status: 'revisao', slug: 'b' }),
        bruta({
          id: 'futura',
          slug: 'c',
          publicada_em: '2026-10-11T00:00:00Z',
        }),
        bruta({ id: 'boa', slug: 'd' }),
      ],
      AGORA,
    )
    expect(noticias.map((n) => n.id)).toEqual(['boa'])
    // rascunho/revisão que escapou do filtro do Directus é alarme; agendada ainda é normal (sem aviso)
    expect(avisos.map((a) => a.id).sort()).toEqual(['rascunho', 'revisao'])
  })

  it('recusa slug inválido ou repetido, título, resumo e texto vazios', () => {
    const { noticias, avisos } = validarNoticias(
      [
        bruta({ id: 'a', slug: 'Com Espaço' }),
        bruta({ id: 'b', slug: 'ok' }),
        bruta({ id: 'c', slug: 'ok' }),
        bruta({ id: 'd', slug: 'sem-titulo', titulo: ' ' }),
        bruta({ id: 'e', slug: 'sem-resumo', resumo: '' }),
        bruta({ id: 'f', slug: 'sem-texto', corpo: '<script>x</script>' }),
        bruta({ id: 'g', slug: 'data-ruim', publicada_em: 'ontem' }),
      ],
      AGORA,
    )
    expect(noticias.map((n) => n.id)).toEqual(['b'])
    expect(avisos.map((a) => a.id).sort()).toEqual([
      'a',
      'c',
      'd',
      'e',
      'f',
      'g',
    ])
  })

  it('ordena da mais recente para a mais antiga', () => {
    const { noticias } = validarNoticias(
      [
        bruta({
          id: 'velha',
          slug: 'velha',
          publicada_em: '2026-01-01T00:00:00Z',
        }),
        bruta({
          id: 'nova',
          slug: 'nova',
          publicada_em: '2026-09-01T00:00:00Z',
        }),
      ],
      AGORA,
    )
    expect(noticias.map((n) => n.id)).toEqual(['nova', 'velha'])
  })
})

function directusFalso(
  corpo: unknown,
  status = 200,
  falhasAntes: number[] = [],
) {
  const chamadas: { url: string; auth: string | null }[] = []
  const fetchImpl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({
        url: String(url),
        auth: new Headers(init?.headers).get('Authorization'),
      })
      const falha = falhasAntes[chamadas.length - 1]
      if (falha) return new Response('{}', { status: falha })
      return new Response(JSON.stringify(corpo), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  )
  return { fetchImpl: fetchImpl as unknown as typeof fetch, chamadas }
}

const CONFIG = {
  url: 'https://cms.teste',
  token: 'tok-secreto',
  obrigatorio: false,
}

describe('buscarNoticias', () => {
  it('pede só o publicado e já vencido, com o token, e devolve as notícias validadas', async () => {
    const { fetchImpl, chamadas } = directusFalso({ data: [comFoto()] })
    const r = await buscarNoticias(CONFIG, {
      fetchImpl,
      esperaMs: 0,
      agora: AGORA,
    })
    expect(r.noticias).toHaveLength(1)
    expect(chamadas).toHaveLength(1)
    const url = decodeURIComponent(chamadas[0]!.url)
    expect(url).toContain('https://cms.teste/items/noticias?')
    expect(url).toContain('filter[status][_eq]=publicado')
    expect(url).toContain('filter[publicada_em][_lte]=$NOW')
    expect(url).toContain('sort=-publicada_em')
    expect(url).toContain('imagem.id')
    expect(chamadas[0]!.auth).toBe('Bearer tok-secreto')
  })

  it('repete erro passageiro (503, Directus acordando) mas não repete 401/403', async () => {
    const passageiro = directusFalso({ data: [bruta()] }, 200, [503, 502])
    const r = await buscarNoticias(CONFIG, {
      fetchImpl: passageiro.fetchImpl,
      esperaMs: 0,
      agora: AGORA,
    })
    expect(r.noticias).toHaveLength(1)
    expect(passageiro.chamadas).toHaveLength(3)

    const recusado = directusFalso({}, 401)
    await expect(
      buscarNoticias(CONFIG, { fetchImpl: recusado.fetchImpl, esperaMs: 0 }),
    ).rejects.toThrow(/o Directus respondeu 401/)
    expect(recusado.chamadas).toHaveLength(1)
  })

  it('desiste depois das tentativas e a mensagem cita o Directus (não a API)', async () => {
    const { fetchImpl, chamadas } = directusFalso({}, 200, [500, 500, 500])
    await expect(
      buscarNoticias(CONFIG, { fetchImpl, esperaMs: 0 }),
    ).rejects.toThrow(/de o Directus \(3 tentativas\)/)
    expect(chamadas).toHaveLength(3)
  })

  it('sem token: vazio no desenvolvimento, ERRO na publicação (obrigatório)', async () => {
    const { fetchImpl, chamadas } = directusFalso({ data: [] })
    const livre = await buscarNoticias(
      { url: 'https://cms.teste', token: '', obrigatorio: false },
      { fetchImpl },
    )
    expect(livre).toEqual({ noticias: [], avisos: [], semDirectus: true })
    expect(chamadas).toHaveLength(0)
    await expect(
      buscarNoticias(
        { url: 'https://cms.teste', token: '', obrigatorio: true },
        { fetchImpl },
      ),
    ).rejects.toThrow(/DIRECTUS_SITE_TOKEN/)
  })

  it('o token nunca aparece no resultado nem na URL', async () => {
    const { fetchImpl, chamadas } = directusFalso({ data: [bruta()] })
    const r = await buscarNoticias(CONFIG, {
      fetchImpl,
      esperaMs: 0,
      agora: AGORA,
    })
    expect(JSON.stringify(r)).not.toContain('tok-secreto')
    expect(chamadas[0]!.url).not.toContain('tok-secreto')
  })
})

describe('configuracaoDoDirectus', () => {
  it('lê o ambiente, tira a barra final e só é obrigatório com DIRECTUS_OBRIGATORIO=1', () => {
    expect(configuracaoDoDirectus({})).toEqual({
      url: 'https://cms.asaf.org.br',
      token: '',
      obrigatorio: false,
    })
    expect(
      configuracaoDoDirectus({
        DIRECTUS_URL: 'http://x/y/',
        DIRECTUS_SITE_TOKEN: 't',
        DIRECTUS_OBRIGATORIO: '1',
      }),
    ).toEqual({ url: 'http://x/y', token: 't', obrigatorio: true })
  })
})

describe('baixarImagem', () => {
  it('pede WebP de até 1280 px com o token e devolve os bytes', async () => {
    const chamadas: { url: string; auth: string | null }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      chamadas.push({
        url,
        auth: new Headers(init?.headers).get('Authorization'),
      })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }) as unknown as typeof fetch
    const bytes = await baixarImagem(CONFIG, 'arq-1', { fetchImpl })
    expect([...bytes]).toEqual([1, 2, 3])
    expect(chamadas[0]!.url).toBe(
      'https://cms.teste/assets/arq-1?width=1280&fit=inside&format=webp&quality=80',
    )
    expect(chamadas[0]!.auth).toBe('Bearer tok-secreto')
  })

  it('403/404 derrubam na hora; 5xx repete', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n++
      return new Response('x', { status: n < 3 ? 503 : 200 })
    }) as unknown as typeof fetch
    await baixarImagem(CONFIG, 'a', { fetchImpl, esperaMs: 0 })
    expect(n).toBe(3)
    const proibido = (async () =>
      new Response('x', { status: 403 })) as unknown as typeof fetch
    await expect(
      baixarImagem(CONFIG, 'a', { fetchImpl: proibido, esperaMs: 0 }),
    ).rejects.toThrow(/respondeu 403/)
  })
})

describe('notícias dentro do conteúdo público', () => {
  const rotas: Record<string, unknown> = {
    '/api/publico/eventos': [],
    '/api/publico/projetos': [],
    '/api/publico/diretoria': [],
    '/api/publico/assembleias': [],
    '/api/publico/transparencia/parcerias': [],
    '/api/publico/transparencia/documentos': [],
  }
  const fetchComDirectus = (noticias: unknown[]) =>
    (async (url: string) => {
      const u = String(url)
      if (u.startsWith('https://cms.teste/items/noticias'))
        return new Response(JSON.stringify({ data: noticias }), { status: 200 })
      const caminho = u.replace('https://api.teste', '')
      return new Response(JSON.stringify(rotas[caminho] ?? {}), { status: 200 })
    }) as unknown as typeof fetch

  const ler = (noticias: unknown[]) =>
    buscarConteudoPublico('https://api.teste', {
      fetchImpl: fetchComDirectus(noticias),
      esperaMs: 0,
      directus: CONFIG,
    })

  it('inclui as notícias e a impressão digital muda quando o texto, a foto ou a data de edição mudam', async () => {
    const base = impressaoDoConteudo(await ler([bruta()]))
    expect(impressaoDoConteudo(await ler([bruta()]))).toBe(base) // igual = igual
    expect(
      impressaoDoConteudo(await ler([bruta({ corpo: '<p>Outro texto.</p>' })])),
    ).not.toBe(base)
    expect(
      impressaoDoConteudo(
        await ler([bruta({ date_updated: '2026-10-03T10:00:00Z' })]),
      ),
    ).not.toBe(base)
    expect(impressaoDoConteudo(await ler([comFoto()]))).not.toBe(base)
    expect(impressaoDoConteudo(await ler([]))).not.toBe(base)
  })

  it('o diagnóstico de notícia recusada NÃO muda a impressão (não justifica reconstruir o site)', async () => {
    const limpo = await ler([bruta()])
    const comRecusada = await ler([
      bruta(),
      comFoto({ id: 'n2', slug: 'outra', autorizacao_imagem: false }),
    ])
    expect(comRecusada.avisosDeNoticias).toHaveLength(1)
    expect(impressaoDoConteudo(comRecusada)).toBe(impressaoDoConteudo(limpo))
  })
})

describe('anunciarAvisosDeNoticias', () => {
  const avisos = [
    {
      id: 'a',
      titulo: 'Encontro',
      motivo: 'tem foto, mas falta o texto alternativo',
    },
    { id: 'b', titulo: 'Outra\nlinha', motivo: 'sem resumo' },
  ]

  it('no GitHub Actions vira aviso amarelo (anotação), numa linha só', () => {
    const linhas: string[] = []
    anunciarAvisosDeNoticias(avisos, (l: string) => linhas.push(l), true)
    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toBe(
      '::warning title=Notícia não publicada::Notícia NÃO publicada: "Encontro" — tem foto, mas falta o texto alternativo',
    )
    expect(linhas[1]).not.toMatch(/[\r\n]/)
  })

  it('fora do GitHub é uma linha de texto comum, e sem avisos não escreve nada', () => {
    const linhas: string[] = []
    anunciarAvisosDeNoticias(avisos, (l: string) => linhas.push(l), false)
    expect(linhas[0]).toBe(
      'Notícia NÃO publicada: "Encontro" — tem foto, mas falta o texto alternativo',
    )
    const nada: string[] = []
    anunciarAvisosDeNoticias([], (l: string) => nada.push(l), true)
    anunciarAvisosDeNoticias(undefined, (l: string) => nada.push(l), true)
    expect(nada).toEqual([])
  })
})
