import type { APIRoute } from 'astro'

import {
  baixarImagem,
  configuracaoDoDirectus,
} from '../../../../scripts/lib/directus.mjs'
import { conteudoPublico } from '../../../lib/dados-publicos'

/**
 * Foto de cada notícia, copiada do Directus NO BUILD para o próprio site (`/midia/noticias/<id>.webp`):
 * o site no ar não depende de o Directus estar acordado (partida a frio de ~35 s) nem expõe o endereço do
 * Directus ao visitante. Só entra foto de notícia que passou na validação (texto alternativo + autorização).
 */
export async function getStaticPaths() {
  const { noticias } = await conteudoPublico()
  return noticias
    .filter((n) => n.imagem)
    .map((n) => ({ params: { id: n.imagem!.id } }))
}

export const GET: APIRoute = async ({ params }) => {
  const bytes = await baixarImagem(configuracaoDoDirectus(), params.id!)
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/webp' },
  })
}
