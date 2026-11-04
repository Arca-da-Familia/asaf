import type { APIRoute } from 'astro'

import { API_URL } from '../../../config/organizacao'
import { conteudoPublico } from '../../../lib/dados-publicos'
import {
  LARGURAS,
  baixarUmaVez,
  paraWebp,
  type Largura,
} from '../../../lib/fotos-leves'

/** v9.2c - as versões leves (WebP de 640 e 1.280 px) de cada foto de etapa de parceria; o JPEG original continua em `[id].jpg`. */
export async function getStaticPaths() {
  const { detalhesDeParcerias } = await conteudoPublico()
  return Object.values(detalhesDeParcerias).flatMap((parceria) =>
    parceria.etapas.flatMap((etapa) =>
      etapa.fotos.flatMap((foto) =>
        LARGURAS.map((largura) => ({
          params: { id: String(foto.id_foto), largura: String(largura) },
          props: { foto, largura },
        })),
      ),
    ),
  )
}

export const GET: APIRoute = async ({ props }) => {
  const bytes = await baixarUmaVez(API_URL, props.foto)
  return new Response(
    new Uint8Array(await paraWebp(bytes, props.largura as Largura)),
    { headers: { 'Content-Type': 'image/webp' } },
  )
}
