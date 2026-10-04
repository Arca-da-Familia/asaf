/**
 * Conteúdo público lido da API NO BUILD (v5.2): Diretoria, Projetos, Agenda/Eventos e editais de
 * assembleia viram páginas estáticas (rápidas, indexáveis e com a prévia certa ao compartilhar no
 * WhatsApp). O dado que muda a toda hora (vagas livres) continua sendo buscado no navegador.
 *
 * Uma única leitura por build (as páginas compartilham o resultado). Se a API não responder, o
 * build FALHA — nunca se publica um site sem a diretoria e sem os eventos por causa de uma API
 * acordando. O workflow `sincronizar-site` reconstrói o site quando este conteúdo muda.
 */
import {
  buscarConteudoPublico,
  type ConteudoPublico,
} from '../../scripts/lib/conteudo-publico.mjs'
import { anunciarAvisosDeNoticias } from '../../scripts/lib/directus.mjs'
import { API_URL } from '../config/organizacao'

export type {
  AssembleiaPublica,
  ConteudoPublico,
  DocumentoPublico,
  EdicaoDoEvento,
  EventoDaLista,
  EventoDetalhado,
  FotoDoEvento,
  FotoDoProjeto,
  MembroDaDiretoria,
  NoticiaPublica,
  ParceriaDetalhada,
  ParceriaPublica,
  ProjetoDetalhado,
  ProjetoPublico,
  ResumoDeEvento,
  SessaoDoEvento,
} from '../../scripts/lib/conteudo-publico.mjs'

let leitura: Promise<ConteudoPublico> | undefined

export function conteudoPublico(): Promise<ConteudoPublico> {
  leitura ??= buscarConteudoPublico(API_URL).then((conteudo) => {
    anunciarAvisosDeNoticias(conteudo.avisosDeNoticias)
    return conteudo
  })
  return leitura
}

/** Caminho estável de cada recurso (só o id: um título editado nunca quebra um link compartilhado). */
export const caminhoDoEvento = (id: number) => `/eventos/${id}/`
export const caminhoDoProjeto = (id: number) => `/projetos/${id}/`
export const caminhoDaAssembleia = (id: number) =>
  `/transparencia/assembleias/${id}/`
export const caminhoDaNoticia = (slug: string) => `/noticias/${slug}/`
/** Foto da notícia, gerada no build a partir do Directus (src/pages/midia/noticias/[id].webp.ts). */
export const caminhoDaFotoDaNoticia = (idDoArquivo: string) =>
  `/midia/noticias/${idDoArquivo}.webp`
/**
 * Foto de um evento, copiada da API no build (src/pages/midia/eventos/[id].jpg.ts). O id da foto é único: a mesma foto
 * aparece na página do evento e na galeria do projeto, sempre com este mesmo endereço.
 */
export const caminhoDaFotoDoEvento = (idFoto: number) =>
  `/midia/eventos/${idFoto}.jpg`
/** Parcerias: cada uma tem UM endereço, conforme o tipo (emenda parlamentar x demais parcerias). Só o id: título editado nunca quebra o link. */
export const caminhoDaEmenda = (id: number) => `/transparencia/emendas/${id}/`
export const caminhoDaParceria = (id: number) =>
  `/transparencia/parcerias/${id}/`
export const caminhoDeUmaParceria = (p: {
  id_parceria: number
  tipo_codigo: string
}) =>
  p.tipo_codigo === 'EMENDA'
    ? caminhoDaEmenda(p.id_parceria)
    : caminhoDaParceria(p.id_parceria)
