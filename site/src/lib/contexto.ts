/**
 * Funções puras do CONTEXTO de projetos e eventos (v5.5): o que a página de um projeto (ex.: o programa principal da
 * associação) e a de um evento mostram além dos próprios dados — edições, relatórios, fotos e notícias do Directus
 * ligadas pelo número. Ficam fora das páginas para serem testadas uma a uma.
 *
 * Regra de ouro: aqui só se ESCOLHE e ORDENA o que a API e o Directus já entregaram; nada é inventado.
 */
import type {
  ConteudoPublico,
  DocumentoPublico,
  EventoDaLista,
  FotoDoEvento,
  NoticiaPublica,
  ProjetoPublico,
  ResumoDeEvento,
} from '../../scripts/lib/conteudo-publico.mjs'
import { jaAconteceu, paraInstante } from './datas'

/** Quantas notícias a página de um projeto mostra (as mais recentes). */
export const NOTICIAS_NA_PAGINA_DO_PROJETO = 6
/** Quantas próximas edições a Home deixa prontas (a ilha mostra só a primeira que ainda não passou). */
export const PROXIMAS_EDICOES_NA_HOME = 3

const maisRecentePrimeiro = (a: NoticiaPublica, b: NoticiaPublica) =>
  b.publicadaEm.localeCompare(a.publicadaEm) || a.slug.localeCompare(b.slug)

/**
 * Notícias da página de um projeto: as ligadas ao projeto OU a um evento dele, da mais recente para a mais antiga.
 * `total` conta todas (para avisar quando a lista foi cortada em `limite`).
 */
export function noticiasDoProjeto(
  noticias: NoticiaPublica[],
  idProjeto: number,
  idsDosEventos: number[],
  limite = NOTICIAS_NA_PAGINA_DO_PROJETO,
): { lista: NoticiaPublica[]; total: number } {
  const eventos = new Set(idsDosEventos)
  const ligadas = noticias
    .filter(
      (n) =>
        n.projetoId === idProjeto ||
        (n.eventoId != null && eventos.has(n.eventoId)),
    )
    .sort(maisRecentePrimeiro)
  return { lista: ligadas.slice(0, limite), total: ligadas.length }
}

/** Notícias ligadas a um evento, da mais recente para a mais antiga. */
export function noticiasDoEvento(
  noticias: NoticiaPublica[],
  idEvento: number,
): NoticiaPublica[] {
  return noticias
    .filter((n) => n.eventoId === idEvento)
    .sort(maisRecentePrimeiro)
}

/** O projeto e o evento a que uma notícia se liga (só os que existem), com o nome para o link. */
export function ligacoesDaNoticia(
  noticia: Pick<NoticiaPublica, 'projetoId' | 'eventoId'>,
  projetos: Pick<ProjetoPublico, 'id_projeto' | 'nome'>[],
  eventos: Pick<EventoDaLista, 'id_evento' | 'titulo'>[],
): {
  projeto: { id_projeto: number; nome: string } | null
  evento: { id_evento: number; titulo: string } | null
} {
  const projeto = projetos.find((p) => p.id_projeto === noticia.projetoId)
  const evento = eventos.find((e) => e.id_evento === noticia.eventoId)
  return {
    projeto: projeto
      ? { id_projeto: projeto.id_projeto, nome: projeto.nome }
      : null,
    evento: evento
      ? { id_evento: evento.id_evento, titulo: evento.titulo }
      : null,
  }
}

/** Fica só o que tem página própria no site: link para uma página que não existe seria um 404. */
export function soComPagina<T extends { id_evento: number }>(
  itens: T[],
  idsComPagina: Iterable<number>,
): T[] {
  const ids = new Set(idsComPagina)
  return itens.filter((i) => ids.has(i.id_evento))
}

/**
 * Fica só o documento que está na lista de documentos publicados (a que gera o PDF copiado e a página do texto): link
 * para um documento fora dela seria um 404.
 */
export function soDocumentosPublicados(
  documentos: DocumentoPublico[],
  publicados: Pick<DocumentoPublico, 'id_documento'>[],
): DocumentoPublico[] {
  const ids = new Set(publicados.map((d) => d.id_documento))
  return documentos.filter((d) => ids.has(d.id_documento))
}

/** Quando o evento termina (ou começa, se o sistema não tem o fim): a conta de "já aconteceu". */
export const fimDoEvento = (
  e: Pick<ResumoDeEvento, 'data_hora_inicio' | 'data_hora_fim'>,
) => e.data_hora_fim ?? e.data_hora_inicio

/**
 * As próximas edições (as que ainda não terminaram), da mais próxima para a mais distante. É conta do BUILD: a página
 * estática não sabe que dia é quando alguém a abre meses depois — por isso quem mostra isto ao visitante confere de
 * novo no navegador (src/lib/edicoes-vivas.ts).
 */
export function proximasEdicoes<T extends ResumoDeEvento>(
  eventos: T[],
  agora: Date = new Date(),
  limite = PROXIMAS_EDICOES_NA_HOME,
): T[] {
  return eventos
    .filter((e) => !jaAconteceu(fimDoEvento(e), agora))
    .sort(
      (a, b) =>
        paraInstante(a.data_hora_inicio).getTime() -
        paraInstante(b.data_hora_inicio).getTime(),
    )
    .slice(0, limite)
}

const ORDEM_DOS_STATUS = [
  'EM_EXECUCAO',
  'PLANEJAMENTO',
  'SUSPENSO',
  'CONCLUIDO',
  'CANCELADO',
]
const posicaoDoStatus = (codigo: string | null) => {
  const i = ORDEM_DOS_STATUS.indexOf(codigo ?? '')
  return i === -1 ? ORDEM_DOS_STATUS.length : i
}

/** Lista de projetos: os em destaque primeiro; depois em execução, planejamento, suspenso, concluído, cancelado. */
export function ordenarProjetos<
  T extends Pick<ProjetoPublico, 'destaque' | 'status_codigo'>,
>(projetos: T[]): T[] {
  return [...projetos].sort(
    (a, b) =>
      Number(b.destaque === true) - Number(a.destaque === true) ||
      posicaoDoStatus(a.status_codigo) - posicaoDoStatus(b.status_codigo),
  )
}

/**
 * Toda foto de evento que o build precisa copiar, UMA vez cada (a mesma foto aparece no detalhe do evento e na galeria
 * do projeto: o endereço dela, `/midia/eventos/<id>.jpg`, é o mesmo).
 */
export function fotosDosEventosParaCopiar(
  conteudo: Pick<ConteudoPublico, 'detalhesDeEventos' | 'detalhesDeProjetos'>,
): FotoDoEvento[] {
  const unicas = new Map<number, FotoDoEvento>()
  const fotos = [
    ...Object.values(conteudo.detalhesDeEventos).flatMap((e) => e.fotos ?? []),
    ...Object.values(conteudo.detalhesDeProjetos ?? {}).flatMap(
      (p) => p.fotos ?? [],
    ),
  ]
  for (const foto of fotos) {
    if (!unicas.has(foto.id_foto)) unicas.set(foto.id_foto, foto)
  }
  return [...unicas.values()].sort((a, b) => a.id_foto - b.id_foto)
}

/** Relatórios e documentos de uma página de contexto: o ano mais novo primeiro, depois a data e o título. */
export function ordenarDocumentos(
  documentos: DocumentoPublico[],
): DocumentoPublico[] {
  return [...documentos].sort(
    (a, b) =>
      (b.ano ?? 0) - (a.ano ?? 0) ||
      (b.data_documento ?? '').localeCompare(a.data_documento ?? '') ||
      b.versao - a.versao ||
      a.titulo.localeCompare(b.titulo, 'pt-BR'),
  )
}

export const rotuloDoFormato = (d: Pick<DocumentoPublico, 'formato'>) =>
  d.formato === 'TEXTO' ? 'Texto' : 'PDF'
