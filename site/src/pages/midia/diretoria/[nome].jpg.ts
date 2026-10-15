import type { APIRoute } from 'astro'

import { fotosDaDiretoria } from '../../../lib/dados-publicos'

/**
 * Foto de cada pessoa da Diretoria e do Conselho Fiscal que AUTORIZOU o uso da imagem (v5.7c), copiada da API NO BUILD para o próprio site
 * (`/midia/diretoria/<número da foto>-<começo do SHA-256>.jpg`): o site no ar não depende de a API estar acordada e a política de conteúdo
 * (`img-src 'self'`) continua valendo sem ampliar nada. A API já regravou a imagem (JPEG, sem localização nem dados do aparelho).
 *
 * A conferência (é JPEG e o SHA-256 é o declarado) acontece UMA vez, ao ler o conteúdo (`baixarFotosDaDiretoria`): aqui só nascem os arquivos das
 * fotos que passaram. Foto que falhou não tem rota (a pessoa aparece só com nome e cargo), então esta rota nunca derruba o build por causa dela.
 */
export async function getStaticPaths() {
  const fotos = await fotosDaDiretoria()
  return [...fotos].map(([nome, bytes]) => ({
    params: { nome },
    props: { bytes },
  }))
}

export const GET: APIRoute = ({ props }) =>
  new Response(new Uint8Array(props.bytes as Buffer), {
    headers: { 'Content-Type': 'image/jpeg' },
  })
