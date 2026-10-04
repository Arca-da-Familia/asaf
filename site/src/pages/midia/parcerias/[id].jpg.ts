import type { APIRoute } from 'astro'

import { baixarFotoDaTransparencia } from '../../../../scripts/lib/conteudo-publico.mjs'
import { API_URL } from '../../../config/organizacao'
import { conteudoPublico } from '../../../lib/dados-publicos'

/**
 * Foto de cada etapa de parceria APROVADA, copiada da API NO BUILD para o próprio site (`/midia/parcerias/<id>.jpg`): o
 * site no ar não depende de a API estar acordada. A API já regravou a imagem (JPEG, sem localização nem dados do
 * aparelho) e só entrega foto com a autorização de imagem confirmada; aqui o build só aceita o JPEG cujo SHA-256 é o
 * declarado (`baixarFotoDaTransparencia`).
 */
export async function getStaticPaths() {
  const { detalhesDeParcerias } = await conteudoPublico()
  return Object.values(detalhesDeParcerias).flatMap((parceria) =>
    parceria.etapas.flatMap((etapa) =>
      etapa.fotos.map((foto) => ({
        params: { id: String(foto.id_foto) },
        props: { foto },
      })),
    ),
  )
}

export const GET: APIRoute = async ({ props }) => {
  const bytes = await baixarFotoDaTransparencia(API_URL, props.foto)
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/jpeg' },
  })
}
