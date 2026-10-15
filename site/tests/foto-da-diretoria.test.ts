import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  anunciarAvisosDeFotosDaDiretoria,
  baixarFotosDaDiretoria,
  buscarConteudoPublico,
  impressaoDoConteudo,
  nomeDaFotoDaDiretoria,
  normalizarFotoDaDiretoria,
  normalizarMembroDaDiretoria,
  type FotoDaDiretoria,
  type MembroDaDiretoria,
} from '../scripts/lib/conteudo-publico.mjs'
import { caminhoDaFotoDaDiretoria } from '../src/lib/dados-publicos'

// v5.7c: a foto de quem está na Diretoria e no Conselho Fiscal. O servidor só a entrega de quem autorizou a imagem; o site lê a lista no build,
// baixa cada JPEG conferindo o SHA-256 e o guarda no próprio endereço. Uma foto que falha deixa só aquela pessoa sem foto (nunca derruba o build).

const jpeg = (conteudo: string) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(conteudo)])
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** A foto como a API a entrega, para os bytes dados. */
const fotoDe = (id: number, bytes: Buffer, extra = {}): FotoDaDiretoria => ({
  id_foto: id,
  alt: `Foto de Pessoa ${id}, Presidente`,
  sha256: sha(bytes),
  largura: 300,
  altura: 400,
  arquivo: `/api/publico/diretoria/fotos/${id}`,
  ...extra,
})

const membro = (
  cargo_codigo: string,
  foto: FotoDaDiretoria | null,
  extra = {},
): MembroDaDiretoria => ({
  orgao_codigo: 'DIRETORIA_EXECUTIVA',
  orgao: 'Diretoria Executiva',
  cargo_codigo,
  cargo: cargo_codigo,
  nome: `Pessoa de ${cargo_codigo}`,
  data_inicio: '2026-02-10',
  data_fim_previsto: '2030-02-10',
  foto,
  ...extra,
})

describe('normalizarFotoDaDiretoria (o que a API entrega vira o que o site usa)', () => {
  const bytes = jpeg('foto')
  const valida = fotoDe(21, bytes)

  it('a foto no formato do contrato passa inteira', () => {
    expect(normalizarFotoDaDiretoria(valida)).toEqual(valida)
  })

  it('ausente, nula ou que não é um objeto = sem foto', () => {
    for (const lixo of [undefined, null, 'x', 7, true, [], [valida]]) {
      expect(normalizarFotoDaDiretoria(lixo)).toBeNull()
    }
  })

  it('formato inválido = sem foto (campo faltando, tipo errado, impressão que não é SHA-256, endereço fora do contrato)', () => {
    const quebrada: Record<string, object> = {
      'sem número': { id_foto: undefined },
      'número zero': { id_foto: 0 },
      'número em texto': { id_foto: '21' },
      'número quebrado': { id_foto: 2.5 },
      'sem texto alternativo': { alt: undefined },
      'texto alternativo em branco': { alt: '   ' },
      'impressão curta': { sha256: 'abc' },
      'impressão que não é hexadecimal': { sha256: 'z'.repeat(64) },
      'impressão ausente': { sha256: undefined },
      'sem largura': { largura: undefined },
      'altura zero': { altura: 0 },
      'endereço de outra rota': { arquivo: '/api/publico/eventos/1/fotos/21' },
      'endereço de outra foto': {
        arquivo: '/api/publico/diretoria/fotos/22',
      },
      'endereço de outro servidor': {
        arquivo: 'https://outro.exemplo/api/publico/diretoria/fotos/21',
      },
      'endereço com consulta': {
        arquivo: '/api/publico/diretoria/fotos/21?x=1',
      },
      'sem endereço': { arquivo: undefined },
    }
    for (const [descricao, defeito] of Object.entries(quebrada)) {
      expect(
        normalizarFotoDaDiretoria({ ...valida, ...defeito }),
        descricao,
      ).toBeNull()
    }
  })

  it('a impressão digital em maiúscula vira minúscula (uma foto, uma impressão) e o alt perde os espaços das pontas', () => {
    const f = normalizarFotoDaDiretoria({
      ...valida,
      sha256: valida.sha256.toUpperCase(),
      alt: '  Foto de Fulano, Presidente ',
    })
    expect(f?.sha256).toBe(valida.sha256)
    expect(f?.alt).toBe('Foto de Fulano, Presidente')
  })

  it('só os campos do contrato seguem adiante (nada a mais vaza para o site)', () => {
    const f = normalizarFotoDaDiretoria({
      ...valida,
      arquivo_interno: 'fotos-diretoria/abc.jpg',
    })
    expect(Object.keys(f!).sort()).toEqual([
      'alt',
      'altura',
      'arquivo',
      'id_foto',
      'largura',
      'sha256',
    ])
  })

  it('o membro de uma API antiga (sem o campo foto) fica sem foto, e o resto dele não muda', () => {
    const antigo = {
      orgao_codigo: 'CONSELHO_FISCAL',
      nome: 'Ana',
      cargo: 'Conselheiro Fiscal',
    }
    expect(normalizarMembroDaDiretoria(antigo)).toEqual({
      ...antigo,
      foto: null,
    })
    expect(
      normalizarMembroDaDiretoria({ ...antigo, foto: { id_foto: 'x' } }).foto,
    ).toBeNull()
    expect(
      normalizarMembroDaDiretoria({ ...antigo, foto: valida }).foto,
    ).toEqual(valida)
  })
})

describe('nomeDaFotoDaDiretoria e caminhoDaFotoDaDiretoria (o endereço da cópia no site)', () => {
  it('leva o número da foto e o começo da impressão digital; foto nova na mesma linha do banco = endereço novo', () => {
    const velha = fotoDe(21, jpeg('velha'))
    const nova = fotoDe(21, jpeg('nova'))
    expect(nomeDaFotoDaDiretoria(velha)).toBe(`21-${velha.sha256.slice(0, 12)}`)
    expect(caminhoDaFotoDaDiretoria(velha)).toBe(
      `/midia/diretoria/21-${velha.sha256.slice(0, 12)}.jpg`,
    )
    expect(caminhoDaFotoDaDiretoria(nova)).not.toBe(
      caminhoDaFotoDaDiretoria(velha),
    )
  })

  it('o endereço é do próprio site, nunca o da API', () => {
    const caminho = caminhoDaFotoDaDiretoria(fotoDe(21, jpeg('a')))
    expect(caminho.startsWith('/midia/diretoria/')).toBe(true)
    expect(caminho).not.toContain('/api/')
  })
})

describe('baixarFotosDaDiretoria (a foto que falha deixa só aquela pessoa sem foto)', () => {
  const bytesA = jpeg('foto da presidente')
  const bytesB = jpeg('foto da conselheira')
  const fotoA = fotoDe(21, bytesA)
  const fotoB = fotoDe(22, bytesB)

  /** API que serve cada caminho com os bytes dados (ou o status dado). */
  const api = (rotas: Record<string, Buffer | number>) => {
    const chamadas: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const caminho = String(url).replace('https://api.teste', '')
      chamadas.push(caminho)
      const r = rotas[caminho]
      if (r === undefined) return new Response('{}', { status: 404 })
      if (typeof r === 'number') return new Response('{}', { status: r })
      return new Response(new Uint8Array(r), { status: 200 })
    })
    return { fetchImpl: fetchImpl as unknown as typeof fetch, chamadas }
  }
  const caminhoDa = (f: FotoDaDiretoria) => f.arquivo

  it('baixa, confere e devolve cada foto pelo nome da cópia; os membros ficam como vieram', async () => {
    const { fetchImpl } = api({
      [caminhoDa(fotoA)]: bytesA,
      [caminhoDa(fotoB)]: bytesB,
    })
    const lista = [
      membro('PRESIDENTE', fotoA),
      membro('SECRETARIO', null),
      membro('CONSELHO_FISCAL', fotoB),
    ]
    const r = await baixarFotosDaDiretoria('https://api.teste/', lista, {
      fetchImpl,
      esperaMs: 0,
    })
    expect(r.diretoria).toEqual(lista)
    expect([...r.fotos.keys()].sort()).toEqual(
      [nomeDaFotoDaDiretoria(fotoA), nomeDaFotoDaDiretoria(fotoB)].sort(),
    )
    expect(
      Buffer.compare(r.fotos.get(nomeDaFotoDaDiretoria(fotoA))!, bytesA),
    ).toBe(0)
    expect(r.avisos).toEqual([])
  })

  it('FOTO ADULTERADA (o arquivo não é o declarado): só aquela pessoa sai sem foto, a outra segue, e o build NÃO cai', async () => {
    const { fetchImpl } = api({
      [caminhoDa(fotoA)]: Buffer.concat([bytesA, Buffer.from(' adulterada')]),
      [caminhoDa(fotoB)]: bytesB,
    })
    const r = await baixarFotosDaDiretoria(
      'https://api.teste',
      [membro('PRESIDENTE', fotoA), membro('CONSELHO_FISCAL', fotoB)],
      { fetchImpl, esperaMs: 0 },
    )
    expect(r.diretoria[0]!.foto).toBeNull()
    expect(r.diretoria[0]!.nome).toBe('Pessoa de PRESIDENTE') // o membro continua na lista, com nome e cargo
    expect(r.diretoria[1]!.foto).toEqual(fotoB)
    expect([...r.fotos.keys()]).toEqual([nomeDaFotoDaDiretoria(fotoB)])
    expect(r.avisos).toHaveLength(1)
    expect(r.avisos[0]).toMatchObject({ id_foto: 21, cargo: 'PRESIDENTE' })
    expect(r.avisos[0]!.motivo).toMatch(
      /A foto 21 da Diretoria não confere com a aprovada/,
    )
  })

  it('arquivo que não é JPEG (mesmo com a impressão certa) também deixa só a pessoa sem foto', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const foto = fotoDe(21, png)
    const { fetchImpl } = api({ [caminhoDa(foto)]: png })
    const r = await baixarFotosDaDiretoria(
      'https://api.teste',
      [membro('PRESIDENTE', foto)],
      { fetchImpl, esperaMs: 0 },
    )
    expect(r.diretoria[0]!.foto).toBeNull()
    expect(r.fotos.size).toBe(0)
    expect(r.avisos[0]!.motivo).toMatch(/não é um JPEG/)
  })

  it('a pessoa deixou o cargo ou retirou a autorização no meio do caminho (404): sem foto, sem repetir, sem derrubar', async () => {
    const e = api({ [caminhoDa(fotoA)]: 404, [caminhoDa(fotoB)]: bytesB })
    const r = await baixarFotosDaDiretoria(
      'https://api.teste',
      [membro('PRESIDENTE', fotoA), membro('CONSELHO_FISCAL', fotoB)],
      { fetchImpl: e.fetchImpl, esperaMs: 0 },
    )
    expect(r.diretoria[0]!.foto).toBeNull()
    expect(r.diretoria[1]!.foto).toEqual(fotoB)
    expect(r.avisos[0]!.motivo).toMatch(/404/)
    expect(e.chamadas.filter((c) => c === caminhoDa(fotoA))).toHaveLength(1)
  })

  it('API fora do ar (erro de servidor em todas as tentativas): ninguém tem foto, o build segue', async () => {
    const e = api({ [caminhoDa(fotoA)]: 503, [caminhoDa(fotoB)]: 503 })
    const r = await baixarFotosDaDiretoria(
      'https://api.teste',
      [membro('PRESIDENTE', fotoA), membro('CONSELHO_FISCAL', fotoB)],
      { fetchImpl: e.fetchImpl, esperaMs: 0, tentativas: 2 },
    )
    expect(r.diretoria.map((m) => m.foto)).toEqual([null, null])
    expect(r.avisos).toHaveLength(2)
    expect(e.chamadas).toHaveLength(4)
  })

  it('a mesma foto em dois mandatos da mesma pessoa é baixada uma vez e vale para os dois', async () => {
    const e = api({ [caminhoDa(fotoA)]: bytesA })
    const r = await baixarFotosDaDiretoria(
      'https://api.teste',
      [membro('PRESIDENTE', fotoA), membro('CONSELHO_FISCAL', fotoA)],
      { fetchImpl: e.fetchImpl, esperaMs: 0 },
    )
    expect(e.chamadas).toHaveLength(1)
    expect(r.diretoria.map((m) => m.foto)).toEqual([fotoA, fotoA])
    expect(r.fotos.size).toBe(1)
  })

  it('sem nenhuma foto (ou lista vazia) não há nenhum pedido à API', async () => {
    const e = api({})
    const r = await baixarFotosDaDiretoria(
      'https://api.teste',
      [membro('PRESIDENTE', null)],
      { fetchImpl: e.fetchImpl, esperaMs: 0 },
    )
    await baixarFotosDaDiretoria('https://api.teste', [], {
      fetchImpl: e.fetchImpl,
      esperaMs: 0,
    })
    expect(e.chamadas).toEqual([])
    expect(r.fotos.size).toBe(0)
    expect(r.avisos).toEqual([])
  })

  it('o conteúdo que o build publica, depois de uma foto que falhou, tem impressão DIFERENTE da da API: a próxima sincronização tenta de novo', async () => {
    const { fetchImpl } = api({
      [caminhoDa(fotoA)]: Buffer.concat([bytesA, Buffer.from('x')]),
    })
    const daApi = [membro('PRESIDENTE', fotoA)]
    const { diretoria } = await baixarFotosDaDiretoria(
      'https://api.teste',
      daApi,
      { fetchImpl, esperaMs: 0 },
    )
    expect(impressaoDoConteudo({ diretoria })).not.toBe(
      impressaoDoConteudo({ diretoria: daApi }),
    )
    // e com a foto no ar, a impressão do build é IGUAL à da API (senão o site seria reconstruído a cada 15 minutos)
    const boa = api({ [caminhoDa(fotoA)]: bytesA })
    const publicado = await baixarFotosDaDiretoria('https://api.teste', daApi, {
      fetchImpl: boa.fetchImpl,
      esperaMs: 0,
    })
    expect(impressaoDoConteudo({ diretoria: publicado.diretoria })).toBe(
      impressaoDoConteudo({ diretoria: daApi }),
    )
  })
})

describe('impressaoDoConteudo com a foto da Diretoria (foto nova tem de ir ao ar)', () => {
  const com = (foto: FotoDaDiretoria | null) =>
    impressaoDoConteudo({ diretoria: [membro('PRESIDENTE', foto)] })
  const a = fotoDe(21, jpeg('a'))

  it('muda quando a foto ENTRA, SAI ou é TROCADA (mesmo número de foto, outro arquivo)', () => {
    expect(com(a)).not.toBe(com(null))
    expect(com(fotoDe(21, jpeg('b')))).not.toBe(com(a))
    expect(com(fotoDe(22, jpeg('a')))).not.toBe(com(a))
  })

  it('não muda se nada mudou (a mesma leitura duas vezes dá a mesma impressão)', () => {
    expect(com(a)).toBe(com({ ...a }))
    expect(com(null)).toBe(com(null))
  })

  it('o texto alternativo mudar (a pessoa trocou de cargo e a foto foi enviada de novo) também reconstrói', () => {
    expect(com({ ...a, alt: 'Foto de Fulano, Tesoureiro' })).not.toBe(com(a))
  })
})

describe('buscarConteudoPublico com a foto da Diretoria', () => {
  const rotas = (diretoria: unknown) => ({
    '/api/publico/eventos': [],
    '/api/publico/projetos': [],
    '/api/publico/diretoria': diretoria,
    '/api/publico/assembleias': [],
    '/api/publico/transparencia/parcerias': [],
    '/api/publico/transparencia/documentos': [],
  })
  const ler = (diretoria: unknown) => {
    const tabela = rotas(diretoria) as Record<string, unknown>
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const caminho = String(url).replace('https://api.teste', '')
      return caminho in tabela
        ? new Response(JSON.stringify(tabela[caminho]), { status: 200 })
        : new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    return buscarConteudoPublico('https://api.teste', {
      fetchImpl,
      esperaMs: 0,
      directus: {
        url: 'https://directus.teste',
        token: '',
        obrigatorio: false,
      },
    })
  }
  const bruto = (extra = {}) => ({
    orgao_codigo: 'DIRETORIA_EXECUTIVA',
    orgao: 'Diretoria Executiva',
    cargo_codigo: 'PRESIDENTE',
    cargo: 'Presidente',
    nome: 'Maria',
    data_inicio: '2026-02-10',
    data_fim_previsto: '2030-02-10',
    ...extra,
  })

  it('API ANTIGA (sem o campo foto): o site constrói e ninguém tem foto', async () => {
    const c = await ler([bruto(), bruto({ nome: 'João' })])
    expect(c.diretoria.map((m) => m.foto)).toEqual([null, null])
    expect(c.diretoria.map((m) => m.nome)).toEqual(['Maria', 'João'])
  })

  it('a foto no contrato chega ao conteúdo; a nula e a malformada viram sem foto', async () => {
    const valida = fotoDe(21, jpeg('a'))
    const c = await ler([
      bruto({ foto: valida }),
      bruto({ nome: 'Sem foto', foto: null }),
      bruto({ nome: 'Quebrada', foto: { ...valida, sha256: 'curta' } }),
    ])
    expect(c.diretoria.map((m) => m.foto)).toEqual([valida, null, null])
  })
})

describe('anunciarAvisosDeFotosDaDiretoria (o log do build)', () => {
  const avisos = [
    {
      id_foto: 21,
      cargo: 'Presidente',
      motivo: 'A foto 21 da Diretoria não confere com a aprovada',
    },
  ]

  it('uma linha por foto que ficou de fora, dizendo qual e por quê', () => {
    const escrito: string[] = []
    anunciarAvisosDeFotosDaDiretoria(avisos, (t) => escrito.push(t), false)
    expect(escrito).toHaveLength(1)
    expect(escrito[0]).toContain('Foto da Diretoria NÃO publicada')
    expect(escrito[0]).toContain('foto nº 21')
    expect(escrito[0]).toContain('Presidente')
    expect(escrito[0]).toContain('não confere com a aprovada')
  })

  it('no GitHub Actions vira aviso destacado, numa linha só', () => {
    const escrito: string[] = []
    anunciarAvisosDeFotosDaDiretoria(
      [{ ...avisos[0]!, motivo: 'duas\nlinhas' }],
      (t) => escrito.push(t),
      true,
    )
    expect(escrito[0]).toMatch(
      /^::warning title=Foto da Diretoria não publicada::/,
    )
    expect(escrito[0]).not.toContain('\n')
  })

  it('sem aviso, não escreve nada', () => {
    const escrito: string[] = []
    anunciarAvisosDeFotosDaDiretoria([], (t) => escrito.push(t), true)
    anunciarAvisosDeFotosDaDiretoria(undefined as never, (t) => escrito.push(t))
    expect(escrito).toEqual([])
  })
})
