import { describe, expect, it } from 'vitest'

import type {
  DocumentoPublico,
  FotoDoEvento,
  NoticiaPublica,
  ResumoDeEvento,
} from '../scripts/lib/conteudo-publico.mjs'
import {
  fimDoEvento,
  fotosDosEventosParaCopiar,
  ligacoesDaNoticia,
  noticiasDoEvento,
  noticiasDoProjeto,
  ordenarDocumentos,
  ordenarProjetos,
  proximasEdicoes,
  rotuloDoFormato,
  soComPagina,
  soDocumentosPublicados,
} from '../src/lib/contexto'
import {
  caminhoDaFotoDoEvento,
  caminhoDoEvento,
  caminhoDoProjeto,
} from '../src/lib/dados-publicos'
import { caminhoDoDocumento } from '../src/lib/transparencia'

const noticia = (
  slug: string,
  publicadaEm: string,
  extra: Partial<NoticiaPublica> = {},
): NoticiaPublica => ({
  id: slug,
  titulo: `Notícia ${slug}`,
  slug,
  resumo: 'r',
  corpoHtml: '<p>t</p>',
  publicadaEm,
  atualizadaEm: null,
  imagem: null,
  projetoId: null,
  eventoId: null,
  ...extra,
})

const edicao = (
  id: number,
  inicio: string,
  extra: Partial<ResumoDeEvento> = {},
): ResumoDeEvento => ({
  id_evento: id,
  titulo: `Edição ${id}`,
  categoria: 'Encontro',
  data_hora_inicio: inicio,
  data_hora_fim: null,
  endereco_avulso: null,
  ...extra,
})

const foto = (id: number, extra: Partial<FotoDoEvento> = {}): FotoDoEvento => ({
  id_foto: id,
  alt: `Foto ${id}`,
  largura: 600,
  altura: 400,
  tamanho: 1000,
  sha256: 'a'.repeat(64),
  arquivo: `/api/publico/eventos/4/fotos/${id}`,
  ...extra,
})

const documento = (
  id: number,
  extra: Partial<DocumentoPublico> = {},
): DocumentoPublico => ({
  id_documento: id,
  tipo_codigo: 'RELATORIO_EVENTO',
  tipo: 'Relatório de evento ou de projeto',
  titulo: `Relatório ${id}`,
  descricao: null,
  data_documento: null,
  ano: 2026,
  versao: 1,
  vigente: true,
  paginas: null,
  tamanho: 10,
  sha256: 'b'.repeat(64),
  aprovado_em: null,
  formato: 'TEXTO',
  arquivo: null,
  ...extra,
})

describe('caminhos', () => {
  it('foto de evento: um endereço por foto, pelo id da foto', () => {
    expect(caminhoDaFotoDoEvento(11)).toBe('/midia/eventos/11.jpg')
    expect(caminhoDaFotoDoEvento(12)).not.toBe(caminhoDaFotoDoEvento(11))
  })
  it('evento e projeto: só o id (título editado não quebra o link)', () => {
    expect(caminhoDoEvento(4)).toBe('/eventos/4/')
    expect(caminhoDoProjeto(3)).toBe('/projetos/3/')
  })
  it('documento ligado: PDF no endereço permanente e TEXTO na página, os dois começando pelo id', () => {
    expect(
      caminhoDoDocumento({
        id_documento: 5,
        titulo: 'Relatório da edição de 2026',
        formato: 'TEXTO',
      }),
    ).toBe('/transparencia/documentos/5-relatorio-da-edicao-de-2026/')
    expect(
      caminhoDoDocumento({ id_documento: 6, titulo: 'Ata', formato: 'PDF' }),
    ).toBe('/arquivos/transparencia/6-ata.pdf')
  })
})

describe('noticiasDoProjeto', () => {
  const todas = [
    noticia('do-projeto', '2026-09-01T10:00:00Z', { projetoId: 3 }),
    noticia('do-evento', '2026-09-05T10:00:00Z', { eventoId: 4 }),
    noticia('de-outro-projeto', '2026-09-06T10:00:00Z', { projetoId: 9 }),
    noticia('de-evento-de-outro', '2026-09-07T10:00:00Z', { eventoId: 8 }),
    noticia('sem-ligacao', '2026-09-08T10:00:00Z'),
  ]

  it('pega as ligadas ao projeto OU a um evento dele, da mais recente para a mais antiga', () => {
    const { lista, total } = noticiasDoProjeto(todas, 3, [4, 5])
    expect(lista.map((n) => n.slug)).toEqual(['do-evento', 'do-projeto'])
    expect(total).toBe(2)
  })

  it('não mistura notícia de outro projeto, de evento de outro projeto nem sem ligação', () => {
    const { lista } = noticiasDoProjeto(todas, 3, [4])
    expect(lista.map((n) => n.slug)).not.toContain('de-outro-projeto')
    expect(lista.map((n) => n.slug)).not.toContain('de-evento-de-outro')
    expect(lista.map((n) => n.slug)).not.toContain('sem-ligacao')
  })

  it('mostra no máximo 6 (as mais recentes) e diz quantas existem', () => {
    const muitas = Array.from({ length: 9 }, (_, i) =>
      noticia(`n${i}`, `2026-09-0${i + 1}T10:00:00Z`, { projetoId: 3 }),
    )
    const { lista, total } = noticiasDoProjeto(muitas, 3, [])
    expect(lista).toHaveLength(6)
    expect(total).toBe(9)
    expect(lista[0]!.slug).toBe('n8')
    expect(lista[5]!.slug).toBe('n3')
  })

  it('empate de data: ordem estável pelo endereço', () => {
    const iguais = [
      noticia('b', '2026-09-01T10:00:00Z', { projetoId: 3 }),
      noticia('a', '2026-09-01T10:00:00Z', { projetoId: 3 }),
    ]
    expect(noticiasDoProjeto(iguais, 3, []).lista.map((n) => n.slug)).toEqual([
      'a',
      'b',
    ])
  })

  it('notícia de versão antiga (sem os campos) nunca casa por engano', () => {
    const antiga = { ...noticia('antiga', '2026-09-01T10:00:00Z') } as Record<
      string,
      unknown
    >
    delete antiga.projetoId
    delete antiga.eventoId
    expect(
      noticiasDoProjeto([antiga as unknown as NoticiaPublica], 3, [4]).total,
    ).toBe(0)
  })
})

describe('noticiasDoEvento', () => {
  it('só as ligadas àquele evento, da mais recente para a mais antiga', () => {
    const todas = [
      noticia('a', '2026-09-01T10:00:00Z', { eventoId: 4 }),
      noticia('b', '2026-09-03T10:00:00Z', { eventoId: 4 }),
      noticia('c', '2026-09-02T10:00:00Z', { eventoId: 5 }),
      noticia('d', '2026-09-04T10:00:00Z', { projetoId: 3 }),
    ]
    expect(noticiasDoEvento(todas, 4).map((n) => n.slug)).toEqual(['b', 'a'])
    expect(noticiasDoEvento(todas, 99)).toEqual([])
  })
})

describe('ligacoesDaNoticia', () => {
  const projetos = [{ id_projeto: 3, nome: 'Principal' }]
  const eventos = [{ id_evento: 4, titulo: '1ª edição' }]

  it('devolve só o que existe, com o nome para o link', () => {
    expect(
      ligacoesDaNoticia({ projetoId: 3, eventoId: 4 }, projetos, eventos),
    ).toEqual({
      projeto: { id_projeto: 3, nome: 'Principal' },
      evento: { id_evento: 4, titulo: '1ª edição' },
    })
    expect(
      ligacoesDaNoticia({ projetoId: 3, eventoId: 9 }, projetos, eventos),
    ).toEqual({
      projeto: { id_projeto: 3, nome: 'Principal' },
      evento: null,
    })
    expect(
      ligacoesDaNoticia({ projetoId: null, eventoId: null }, projetos, eventos),
    ).toEqual({ projeto: null, evento: null })
  })
})

describe('soComPagina / soDocumentosPublicados', () => {
  it('descarta o evento sem página (link seria 404), mantendo a ordem', () => {
    const itens = [
      edicao(1, '2026-01-01T10:00:00'),
      edicao(2, '2026-02-01T10:00:00'),
    ]
    expect(soComPagina(itens, [2]).map((e) => e.id_evento)).toEqual([2])
    expect(soComPagina(itens, new Set([1, 2]))).toHaveLength(2)
    expect(soComPagina(itens, [])).toEqual([])
  })
  it('descarta o documento que não está na lista de publicados', () => {
    const docs = [documento(5), documento(6)]
    expect(
      soDocumentosPublicados(docs, [{ id_documento: 6 }]).map(
        (d) => d.id_documento,
      ),
    ).toEqual([6])
  })
})

describe('proximasEdicoes', () => {
  // 10/out/2026, meio-dia em Parauapebas
  const AGORA = new Date('2026-10-10T15:00:00Z')
  const eventos = [
    edicao(1, '2026-09-01T19:00:00'),
    edicao(2, '2026-11-20T19:00:00'),
    edicao(3, '2026-10-20T19:00:00'),
    edicao(4, '2026-10-10T19:00:00'), // hoje à noite: ainda vai acontecer
    edicao(5, '2026-10-10T08:00:00', { data_hora_fim: '2026-10-10T20:00:00' }), // já começou, ainda não terminou
    edicao(6, '2026-10-10T08:00:00', { data_hora_fim: '2026-10-10T11:00:00' }), // terminou há uma hora
  ]

  it('só as que não terminaram, da mais próxima para a mais distante', () => {
    expect(proximasEdicoes(eventos, AGORA).map((e) => e.id_evento)).toEqual([
      5, 4, 3,
    ])
  })
  it('respeita o limite', () => {
    expect(proximasEdicoes(eventos, AGORA, 1).map((e) => e.id_evento)).toEqual([
      5,
    ])
  })
  it('nenhuma futura = lista vazia (a Home não mostra "próxima edição")', () => {
    expect(proximasEdicoes([edicao(1, '2026-01-01T19:00:00')], AGORA)).toEqual(
      [],
    )
    expect(proximasEdicoes([], AGORA)).toEqual([])
  })
  it('não altera a lista recebida', () => {
    const copia = [...eventos]
    proximasEdicoes(eventos, AGORA)
    expect(eventos).toEqual(copia)
  })
  it('o fim do evento é o fim, ou o início quando o sistema não tem o fim', () => {
    expect(fimDoEvento(edicao(1, '2026-10-10T19:00:00'))).toBe(
      '2026-10-10T19:00:00',
    )
    expect(
      fimDoEvento(
        edicao(1, '2026-10-10T19:00:00', {
          data_hora_fim: '2026-10-10T21:00:00',
        }),
      ),
    ).toBe('2026-10-10T21:00:00')
  })
})

describe('ordenarProjetos', () => {
  const p = (nome: string, status: string | null, destaque?: boolean) => ({
    nome,
    status_codigo: status,
    destaque: destaque as boolean,
  })
  it('os em destaque primeiro; depois em execução, planejamento e encerrados', () => {
    const ordenados = ordenarProjetos([
      p('concluido', 'CONCLUIDO', false),
      p('principal', 'CONCLUIDO', true),
      p('em-execucao', 'EM_EXECUCAO', false),
      p('planejando', 'PLANEJAMENTO', false),
      p('sem-status', null, false),
    ])
    expect(ordenados.map((x) => x.nome)).toEqual([
      'principal',
      'em-execucao',
      'planejando',
      'concluido',
      'sem-status',
    ])
  })
  it('API antiga (sem destaque) mantém a ordem de sempre, e a lista original não é alterada', () => {
    const original = [
      p('concluido', 'CONCLUIDO'),
      p('em-execucao', 'EM_EXECUCAO'),
    ]
    const copia = [...original]
    expect(ordenarProjetos(original).map((x) => x.nome)).toEqual([
      'em-execucao',
      'concluido',
    ])
    expect(original).toEqual(copia)
  })
  it('vários em destaque: a ordem de status vale entre eles', () => {
    expect(
      ordenarProjetos([
        p('a', 'CONCLUIDO', true),
        p('b', 'EM_EXECUCAO', true),
      ]).map((x) => x.nome),
    ).toEqual(['b', 'a'])
  })
})

describe('fotosDosEventosParaCopiar', () => {
  const evento = (fotos: FotoDoEvento[]) =>
    ({ fotos }) as never as { fotos: FotoDoEvento[] }

  it('a mesma foto no evento e na galeria do projeto é copiada UMA vez só', () => {
    const fotos = fotosDosEventosParaCopiar({
      detalhesDeEventos: {
        4: evento([foto(11), foto(12)]),
        5: evento([]),
      } as never,
      detalhesDeProjetos: {
        3: {
          fotos: [
            { ...foto(12), id_evento: 4 },
            { ...foto(11), id_evento: 4 },
          ],
        },
      } as never,
    })
    expect(fotos.map((f) => f.id_foto)).toEqual([11, 12])
  })

  it('foto que só aparece na galeria do projeto também é copiada', () => {
    const fotos = fotosDosEventosParaCopiar({
      detalhesDeEventos: {} as never,
      detalhesDeProjetos: {
        3: { fotos: [{ ...foto(40), id_evento: 4 }] },
      } as never,
    })
    expect(fotos.map((f) => f.id_foto)).toEqual([40])
  })

  it('API antiga (sem fotos, sem detalhe de projeto) = nenhuma foto, sem quebrar', () => {
    expect(
      fotosDosEventosParaCopiar({
        detalhesDeEventos: { 1: {} } as never,
        detalhesDeProjetos: undefined as never,
      }),
    ).toEqual([])
    expect(
      fotosDosEventosParaCopiar({
        detalhesDeEventos: {},
        detalhesDeProjetos: {},
      }),
    ).toEqual([])
  })
})

describe('documentos do contexto', () => {
  it('o ano mais novo primeiro; depois a data, a versão e o título', () => {
    const ordenados = ordenarDocumentos([
      documento(1, { ano: 2025, titulo: 'B' }),
      documento(2, { ano: 2026, titulo: 'Z' }),
      documento(3, { ano: 2026, titulo: 'A' }),
      documento(4, { ano: 2026, titulo: 'M', data_documento: '2026-05-01' }),
      documento(5, { ano: null, titulo: 'Sem ano' }),
    ])
    expect(ordenados.map((d) => d.id_documento)).toEqual([4, 3, 2, 1, 5])
  })
  it('rótulo do formato: Texto ou PDF', () => {
    expect(rotuloDoFormato(documento(1))).toBe('Texto')
    expect(rotuloDoFormato(documento(1, { formato: 'PDF' }))).toBe('PDF')
  })
})
