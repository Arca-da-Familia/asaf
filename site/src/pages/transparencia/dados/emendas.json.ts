import type { APIRoute } from 'astro'

import { SITE_URL } from '../../../config/organizacao'
import {
  caminhoDeUmaParceria,
  conteudoPublico,
} from '../../../lib/dados-publicos'
import { ehEmenda } from '../../../lib/transparencia'

/**
 * Dados abertos (v5.4b): cada emenda APROVADA com parcelas, recebimentos, pagamentos, etapas, relatórios e documentos —
 * exatamente o que a página dela mostra (inclusive: pagamento de equipe só com a função, sem o nome).
 */
export const GET: APIRoute = async () => {
  const { parcerias, detalhesDeParcerias } = await conteudoPublico()
  const dados = parcerias.filter(ehEmenda).map((p) => ({
    ...detalhesDeParcerias[p.id_parceria],
    pagina: `${SITE_URL}${caminhoDeUmaParceria(p)}`,
  }))
  return new Response(JSON.stringify(dados, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
