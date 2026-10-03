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
import { API_URL } from '../config/organizacao'

export type {
  AssembleiaPublica,
  ConteudoPublico,
  EventoDaLista,
  EventoDetalhado,
  MembroDaDiretoria,
  ProjetoPublico,
  SessaoDoEvento,
} from '../../scripts/lib/conteudo-publico.mjs'

let leitura: Promise<ConteudoPublico> | undefined

export function conteudoPublico(): Promise<ConteudoPublico> {
  leitura ??= buscarConteudoPublico(API_URL)
  return leitura
}

/** Caminho estável de cada recurso (só o id: um título editado nunca quebra um link compartilhado). */
export const caminhoDoEvento = (id: number) => `/eventos/${id}/`
export const caminhoDoProjeto = (id: number) => `/projetos/${id}/`
export const caminhoDaAssembleia = (id: number) =>
  `/transparencia/assembleias/${id}/`
