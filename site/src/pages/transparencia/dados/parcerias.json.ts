import type { APIRoute } from 'astro'

import { SITE_URL } from '../../../config/organizacao'
import {
  caminhoDeUmaParceria,
  conteudoPublico,
} from '../../../lib/dados-publicos'
import { ehEmenda } from '../../../lib/transparencia'

/** Dados abertos (v5.4b): cada parceria APROVADA que não é emenda, com todos os detalhes da página dela. */
export const GET: APIRoute = async () => {
  const { parcerias, detalhesDeParcerias } = await conteudoPublico()
  const dados = parcerias
    .filter((p) => !ehEmenda(p))
    .map((p) => ({
      ...detalhesDeParcerias[p.id_parceria],
      pagina: `${SITE_URL}${caminhoDeUmaParceria(p)}`,
    }))
  return new Response(JSON.stringify(dados, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
