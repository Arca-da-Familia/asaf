import type { AreaDoModulo } from '@/lib/modulos'

// v9.5b - a cor de cada área no novo visual (aprovado pelo Presidente, 13/11): fundo em tinta clara e o ícone na cor forte da mesma família. Todo par passa de
// 4,5:1 nos dois modos (painel/src/test/tokens-contraste.test.ts).
export const COR_DA_AREA: Record<AreaDoModulo, string> = {
  pessoas: 'bg-azul-tinta text-azul-texto',
  dinheiro: 'bg-ouro-tinta text-ouro-texto',
  associacao: 'bg-verde-tinta text-verde-texto',
  administracao: 'bg-accent text-foreground',
}

export const ORDEM_DAS_AREAS: AreaDoModulo[] = [
  'pessoas',
  'dinheiro',
  'associacao',
  'administracao',
]
