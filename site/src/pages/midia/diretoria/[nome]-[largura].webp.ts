import type { APIRoute } from 'astro'

import { fotosDaDiretoria } from '../../../lib/dados-publicos'
import { LARGURAS, paraWebp, type Largura } from '../../../lib/fotos-leves'

/** v9.2c - as versões leves (WebP de 640 e 1.280 px) da foto de cada pessoa da Diretoria e do Conselho; o JPEG original continua em `[nome].jpg`. */
export async function getStaticPaths() {
  const fotos = await fotosDaDiretoria()
  return [...fotos].flatMap(([nome, bytes]) =>
    LARGURAS.map((largura) => ({
      params: { nome, largura: String(largura) },
      props: { bytes, largura },
    })),
  )
}

export const GET: APIRoute = async ({ props }) =>
  new Response(
    new Uint8Array(
      await paraWebp(props.bytes as Buffer, props.largura as Largura),
    ),
    { headers: { 'Content-Type': 'image/webp' } },
  )
