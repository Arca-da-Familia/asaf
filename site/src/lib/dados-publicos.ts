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
  anunciarAvisosDeFotosDaDiretoria,
  baixarFotosDaDiretoria,
  buscarConteudoPublico,
  nomeDaFotoDaDiretoria,
  type ConteudoPublico,
  type FotoDaDiretoria,
} from '../../scripts/lib/conteudo-publico.mjs'
import { anunciarAvisosDeNoticias } from '../../scripts/lib/directus.mjs'
import { API_URL } from '../config/organizacao'
import {
  organizacaoComInstituicao,
  type OrganizacaoDoSite,
} from './instituicao-publica'

export type {
  AssembleiaPublica,
  ConteudoPublico,
  DocumentoPublico,
  EdicaoDoEvento,
  EventoDaLista,
  EventoDetalhado,
  FotoDaDiretoria,
  FotoDoEvento,
  FotoDoProjeto,
  MembroDaDiretoria,
  NoticiaPublica,
  ParceriaDetalhada,
  ParceriaPublica,
  PerguntaDoEvento,
  ProjetoDetalhado,
  ProjetoPublico,
  ResumoDeEvento,
  SessaoDoEvento,
  StatusDoEvento,
} from '../../scripts/lib/conteudo-publico.mjs'

interface Leitura {
  conteudo: ConteudoPublico
  /** As fotos da Diretoria já conferidas (JPEG e SHA-256), pelo nome da cópia no site (`nomeDaFotoDaDiretoria`). */
  fotosDaDiretoria: Map<string, Buffer>
}

let leitura: Promise<Leitura> | undefined

function ler(): Promise<Leitura> {
  leitura ??= (async () => {
    const lido = await buscarConteudoPublico(API_URL)
    anunciarAvisosDeNoticias(lido.avisosDeNoticias)
    // v5.7c: a foto de cada pessoa da Diretoria é baixada e conferida AQUI, uma vez; a que falhar deixa só aquela pessoa sem foto (o aviso fica no log do build).
    // O conteúdo que as páginas e o /conteudo.json enxergam já é o que vai ao ar: sem a foto que falhou, a impressão difere da da API e a próxima
    // sincronização tenta de novo.
    const { diretoria, fotos, avisos } = await baixarFotosDaDiretoria(
      API_URL,
      lido.diretoria,
    )
    anunciarAvisosDeFotosDaDiretoria(avisos)
    return { conteudo: { ...lido, diretoria }, fotosDaDiretoria: fotos }
  })()
  return leitura
}

export async function conteudoPublico(): Promise<ConteudoPublico> {
  return (await ler()).conteudo
}

/** Os bytes das fotos da Diretoria a copiar para o site (só as que passaram na conferência). */
export async function fotosDaDiretoria(): Promise<Map<string, Buffer>> {
  return (await ler()).fotosDaDiretoria
}

/** Os dados da associação como o site os mostra: os fixos (Estatuto), com o que a Instituição do painel marcou "vai para o site" e é válido por cima (v5.4h). */
export async function organizacaoDoSite(): Promise<OrganizacaoDoSite> {
  const { instituicao } = await conteudoPublico()
  return organizacaoComInstituicao(instituicao)
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
/**
 * Foto de quem está na Diretoria ou no Conselho, copiada da API no build (src/pages/midia/diretoria/[nome].jpg.ts). O endereço leva o número
 * da foto e o começo do SHA-256: quando a pessoa troca de foto o endereço muda, e nenhum navegador mostra a foto velha. A página usa SEMPRE este
 * endereço (nunca o da API), então a política de conteúdo `img-src 'self'` basta.
 */
export const caminhoDaFotoDaDiretoria = (
  foto: Pick<FotoDaDiretoria, 'id_foto' | 'sha256'>,
) => `/midia/diretoria/${nomeDaFotoDaDiretoria(foto)}.jpg`
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
