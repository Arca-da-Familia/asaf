// Ambiente de HOMOLOGAÇÃO (teste, só com dados inventados): o build do ambiente de teste é feito com
// VITE_AMBIENTE=homologacao. O da produção não define a variável, então nada disto aparece lá.
export const ehHomologacao = (
  valor: string | undefined = import.meta.env.VITE_AMBIENTE,
): boolean => valor === 'homologacao'

export const TEXTO_DO_AMBIENTE_DE_TESTE =
  'AMBIENTE DE TESTE — todos os dados são inventados e nada aqui vale. O sistema de verdade é o painel.asaf.org.br.'
