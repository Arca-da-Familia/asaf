/**
 * Texto de metadados para páginas feitas a partir de dado da API (projeto, evento, assembleia).
 * O e2e exige título <= 70 caracteres (com " | ASAF") e descrição de 50 a 170: título e descrição
 * de um projeto vêm digitados pela diretoria e podem ser qualquer tamanho, então são ajustados aqui.
 */
const MAX_DESCRICAO = 160
const MIN_DESCRICAO = 50
const MAX_TITULO = 58

function limpar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}

/** Corta na última palavra inteira que cabe e acrescenta reticências. */
function cortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto
  const corte = texto.slice(0, maximo - 1)
  const ultimoEspaco = corte.lastIndexOf(' ')
  const base =
    ultimoEspaco > maximo * 0.6 ? corte.slice(0, ultimoEspaco) : corte
  return `${base.replace(/[\s,;:.\-–—]+$/, '')}…`
}

/** Descrição (<meta>) a partir do texto da página; cai no `reserva` se o texto for curto demais. */
export function descricaoParaMeta(
  texto: string | null | undefined,
  reserva: string,
): string {
  const limpo = texto ? limpar(texto) : ''
  if (limpo.length < MIN_DESCRICAO)
    return cortar(limpar(reserva), MAX_DESCRICAO)
  return cortar(limpo, MAX_DESCRICAO)
}

/**
 * Trecho do início de um texto, para cartões (ex.: o projeto em destaque na Home). Diferente de `descricaoParaMeta`, um texto curto
 * é mantido como veio (nunca é trocado por uma frase de reserva); texto longo é cortado na última palavra inteira.
 */
export function trechoDoTexto(
  texto: string | null | undefined,
  maximo = 220,
): string {
  return texto ? cortar(limpar(texto), maximo) : ''
}

/** Título curto o bastante para caber em "Título | ASAF" dentro dos 70 caracteres. */
export function tituloCurto(titulo: string): string {
  return cortar(limpar(titulo), MAX_TITULO)
}
