import type { APIRoute } from 'astro'

import { API_URL } from '../../../config/organizacao'
import { fotosDosEventosParaCopiar } from '../../../lib/contexto'
import { conteudoPublico } from '../../../lib/dados-publicos'
import {
  LARGURAS,
  baixarUmaVez,
  paraWebp,
  type Largura,
} from '../../../lib/fotos-leves'

/** v9.2c - as versões leves (WebP de 640 e 1.280 px) de cada foto de evento; o JPEG original continua em `[id].jpg` (src/lib/fotos-leves.ts). */
export async function getStaticPaths() {
  const conteudo = await conteudoPublico()
  return fotosDosEventosParaCopiar(conteudo).flatMap((foto) =>
    LARGURAS.map((largura) => ({
      params: { id: String(foto.id_foto), largura: String(largura) },
      props: { foto, largura },
    })),
  )
}

export const GET: APIRoute = async ({ props }) => {
  const bytes = await baixarUmaVez(API_URL, props.foto, {
    descricao: 'do evento',
  })
  return new Response(
    new Uint8Array(await paraWebp(bytes, props.largura as Largura)),
    { headers: { 'Content-Type': 'image/webp' } },
  )
}
