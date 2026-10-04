import type { APIRoute } from 'astro'

import { baixarPdfDaTransparencia } from '../../../../scripts/lib/conteudo-publico.mjs'
import { API_URL } from '../../../config/organizacao'
import { conteudoPublico } from '../../../lib/dados-publicos'
import { nomeDoPdf } from '../../../lib/transparencia'

/**
 * PDF de cada documento APROVADO, copiado da API NO BUILD para o próprio site, num endereço permanente
 * (`/arquivos/transparencia/<id>-<titulo>.pdf`): o site no ar não depende de a API estar acordada (partida a frio de
 * ~20-35 s) e o link compartilhado não quebra. Só entra o arquivo que É o aprovado: o SHA-256 do que chegou tem que
 * ser o que a API diz ter aprovado, e os bytes têm que ser um PDF (`baixarPdfDaTransparencia`); senão o build falha.
 */
export async function getStaticPaths() {
  const { documentos } = await conteudoPublico()
  return documentos.map((documento) => ({
    params: { arquivo: nomeDoPdf(documento) },
    props: { documento },
  }))
}

export const GET: APIRoute = async ({ props }) => {
  const bytes = await baixarPdfDaTransparencia(API_URL, props.documento)
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf' },
  })
}
