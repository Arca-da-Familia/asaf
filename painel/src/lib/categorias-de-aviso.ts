// v9.5b - a cor da etiqueta da categoria do aviso no novo visual (aprovado pelo Presidente, 13/11): Convocação e Financeiro em ouro, Mudança de regra em azul,
// Evento e Projeto em verde, Geral (e qualquer categoria nova do catálogo) no neutro. Vermelho fica só para atraso e erro.
const CORES: Record<string, string> = {
  Convocação: 'bg-ouro-tinta text-ouro-texto',
  Financeiro: 'bg-ouro-tinta text-ouro-texto',
  'Mudança de regra': 'bg-azul-tinta text-azul-texto',
  Evento: 'bg-verde-tinta text-verde-texto',
  Projeto: 'bg-verde-tinta text-verde-texto',
}

export function corDaCategoria(rotulo: string | null | undefined): string {
  return CORES[rotulo ?? ''] ?? 'bg-accent text-foreground'
}

/** "Pede a sua confirmação" é uma ação esperada, não um erro: vai em ouro. */
export const COR_DA_CONFIRMACAO = 'bg-ouro-tinta text-ouro-texto'
