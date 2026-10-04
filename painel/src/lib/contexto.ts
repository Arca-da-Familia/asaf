import type { Evento, Projeto } from './api'

// v5.5 - o "contexto" de um evento ou de um projeto: tudo o que se liga a ele (relatórios, fotos, notícias).

// Onde se escreve notícia: o editor do site (Directus). As notícias NÃO moram no sistema; elas se ligam a um projeto ou
// a um evento pelo NÚMERO (campos "Número do projeto" e "Número do evento" da notícia).
export const ENDERECO_DE_NOVA_NOTICIA =
  'https://cms.asaf.org.br/admin/content/noticias/+'

export type TipoDeContexto = 'evento' | 'projeto'

// Botão "Novo relatório deste evento/projeto": abre o cadastro de documento já com o tipo e o vínculo preenchidos.
export function enderecoDoNovoRelatorio(
  tipo: TipoDeContexto,
  id: number,
): string {
  return `/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=${tipo}&vinculo_id=${id}`
}

// O projeto guarda a data com hora (meia-noite); o painel só trabalha com o dia (`<input type="date">`).
export function diaDoProjeto(valor: string | null | undefined): string {
  return valor ? valor.slice(0, 10) : ''
}

// Diz, em português simples, se o evento aparece na página do projeto no site (só se os DOIS são Públicos).
export function fraseDaPublicacaoNoProjeto(
  evento: Evento,
  projeto: Projeto | undefined,
): string | null {
  if (evento.id_projeto == null || !projeto) return null
  if (evento.visibilidade !== 'Pública') {
    return 'Este evento é Interno: ele não aparece no site, nem na página do projeto.'
  }
  if (projeto.visibilidade !== 'Pública') {
    return `O projeto “${projeto.nome_projeto}” é Interno: o site não mostra este evento como parte dele. Para isso, deixe o projeto Público.`
  }
  return `Este evento e o projeto são Públicos: ele aparece na página do projeto “${projeto.nome_projeto}” no site.`
}
