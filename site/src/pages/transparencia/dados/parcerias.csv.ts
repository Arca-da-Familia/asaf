import type { APIRoute } from 'astro'

import { SITE_URL } from '../../../config/organizacao'
import {
  caminhoDeUmaParceria,
  conteudoPublico,
} from '../../../lib/dados-publicos'
import {
  COLUNAS_DOS_DADOS_ABERTOS,
  ehEmenda,
  linhasDosDadosAbertos,
  paraCsv,
} from '../../../lib/transparencia'

/** Dados abertos (v5.4b): uma linha por parceria APROVADA que não é emenda (termos de fomento, de colaboração...). */
export const GET: APIRoute = async () => {
  const { parcerias } = await conteudoPublico()
  const linhas = linhasDosDadosAbertos(
    parcerias.filter((p) => !ehEmenda(p)),
    (p) => `${SITE_URL}${caminhoDeUmaParceria(p)}`,
  )
  return new Response(paraCsv(COLUNAS_DOS_DADOS_ABERTOS, linhas), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  })
}
