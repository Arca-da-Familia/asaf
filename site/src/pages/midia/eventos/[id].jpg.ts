import type { APIRoute } from 'astro'

import { baixarFotoDaTransparencia } from '../../../../scripts/lib/conteudo-publico.mjs'
import { API_URL } from '../../../config/organizacao'
import { conteudoPublico } from '../../../lib/dados-publicos'
import { fotosDosEventosParaCopiar } from '../../../lib/contexto'

/**
 * Foto de cada EVENTO público (v5.5), copiada da API NO BUILD para o próprio site (`/midia/eventos/<id>.jpg`, o id é o da
 * foto): o site no ar não depende de a API estar acordada. A API já regravou a imagem (JPEG, sem localização nem dados do
 * aparelho) e só entrega foto com a autorização de imagem confirmada; aqui o build só aceita o JPEG cujo SHA-256 é o
 * declarado (`baixarFotoDaTransparencia`).
 *
 * A mesma foto aparece no detalhe do evento e na galeria do projeto: `fotosDosEventosParaCopiar` entrega cada uma UMA vez.
 */
export async function getStaticPaths() {
  const conteudo = await conteudoPublico()
  return fotosDosEventosParaCopiar(conteudo).map((foto) => ({
    params: { id: String(foto.id_foto) },
    props: { foto },
  }))
}

export const GET: APIRoute = async ({ props }) => {
  const bytes = await baixarFotoDaTransparencia(API_URL, props.foto, {
    descricao: 'do evento',
  })
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/jpeg' },
  })
}
