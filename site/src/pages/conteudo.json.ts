import type { APIRoute } from 'astro'

import { impressaoDoConteudo } from '../../scripts/lib/conteudo-publico.mjs'
import { conteudoPublico } from '../lib/dados-publicos'

/**
 * `/conteudo.json` — a "impressão digital" do conteúdo público com que ESTE build foi gerado
 * (eventos, projetos, diretoria, editais, notícias do Directus, parcerias/emendas e documentos aprovados). O workflow `sincronizar-site` compara com a impressão do
 * que a API tem AGORA: se diferem, algo mudou no sistema (evento novo, dirigente empossado...) e o
 * site é reconstruído. Sem isto, página nova só nasceria quando alguém lembrasse de republicar.
 */
export const GET: APIRoute = async () => {
  const conteudo = await conteudoPublico()
  return new Response(
    JSON.stringify({
      impressao: impressaoDoConteudo(conteudo),
      geradoEm: new Date().toISOString(),
      contagem: {
        eventos: conteudo.eventos.length,
        projetos: conteudo.projetos.length,
        diretoria: conteudo.diretoria.length,
        assembleias: conteudo.assembleias.length,
        noticias: conteudo.noticias.length,
        parcerias: conteudo.parcerias.length,
        documentos: conteudo.documentos.length,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
